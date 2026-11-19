import { spawn, execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, release } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const duckFile = (name) => fileURLToPath(new URL(`./duck/${name}`, import.meta.url));
const source = duckFile("Duck.swift");
const sprite = duckFile("sprite.html");
const duckFiles = ["Duck.swift", "sprite.html", "voice.js", "lines.js"].map(duckFile);
const desktopSupported = process.platform === "darwin" && Number(release().split(".")[0]) >= 22;
let building;

export const stateDir = () => join(process.env.COPILOT_HOME || join(homedir(), ".copilot"), "state", "little-intermissions");
const binaryPath = () => join(stateDir(), "duck");
const controlFile = () => join(stateDir(), "control.json");

// Whole minutes from 1 to 180. Anything else is refused and never rounded, so a typo such as 250 or 2.5 is not guessed at.
export function sprintMinutes(value) {
    const text = typeof value === "number" ? String(value) : value;
    const minutes = typeof text === "string" && /^\d{1,3}$/.test(text) ? Number(text) : NaN;
    if (!(minutes >= 1 && minutes <= 180)) throw new Error("A focus sprint is 1 to 180 whole minutes.");
    return minutes;
}

export const sayLimit = 120;

// The text for `duck say`. The duck cuts anything longer, so a long line is refused here rather than cut without a word.
export function sayText(value) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!text) throw new Error("Give the duck some text to say.");
    if (text.length > sayLimit) throw new Error(`The duck can say up to ${sayLimit} characters.`);
    return text;
}

// The duck writes sprint.json while a focus sprint runs and removes it when the sprint ends. A file
// whose end time has passed is a leftover from a duck that was stopped without cleaning up.
export async function readSprint(dir = stateDir(), now = Date.now()) {
    try {
        const { endsAt, startedAt, minutes } = JSON.parse(await readFile(join(dir, "sprint.json"), "utf8"));
        if (![endsAt, startedAt, minutes].every(Number.isFinite) || endsAt <= now) return null;
        return { endsAt, startedAt, minutes };
    } catch { return null; }
}

let lastStamp = 0;

// One small JSON file per command. The duck takes them in name order, which is send order, and skips
// names that start with a dot, so a file is never read half written. The stamp grows by at least one
// millisecond per call, so two commands from one process never swap, even inside the same millisecond.
export async function writeInbox(dir, command) {
    lastStamp = Math.max(Date.now(), lastStamp + 1);
    const name = `${String(lastStamp).padStart(13, "0")}-${randomBytes(4).toString("hex")}.json`;
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temporary = join(dir, `.${name}`);
    await writeFile(temporary, JSON.stringify(command), { mode: 0o600 });
    await rename(temporary, join(dir, name));
    return join(dir, name);
}

async function waitFor(check, timeoutMs) {
    for (const deadline = Date.now() + timeoutMs; ;) {
        const result = await check();
        if (result || Date.now() >= deadline) return result;
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
}

// PID existence is only used to wait for exit, never to authorize or send a signal.
async function pidExists(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        const { stdout } = await run("/bin/ps", ["-p", String(pid), "-o", "pid="], { timeout: 2000 });
        return Number(stdout.trim()) === pid;
    } catch (error) {
        if (error.code === 1 && !error.stderr?.trim()) return false;
        throw error;
    }
}

async function optionalText(path) {
    try { return await readFile(path, "utf8"); }
    catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
    }
}

async function controlRecord() {
    const text = await optionalText(controlFile());
    if (text !== null) {
        const record = JSON.parse(text);
        if (!/^[a-f0-9-]{36}$/.test(record.instance) || !/^[a-f0-9]{64}$/.test(record.token) ||
            !Number.isInteger(record.pid) || record.pid <= 0) throw new Error("The duck control record is invalid. No process was signalled.");
        if (await pidExists(record.pid)) return record;
    }
    const legacy = Number(await optionalText(join(stateDir(), "duck.pid")));
    if (await pidExists(legacy)) {
        throw new Error("Cannot authenticate this duck. An older duck may still be running. Quit it from its right-click menu, then wake it again. No process was signalled.");
    }
    return null;
}

async function requestControl(record, action, command) {
    const id = randomBytes(16).toString("hex");
    const reply = join(stateDir(), "control-replies", `${id}.json`);
    const request = await writeInbox(join(stateDir(), "control-inbox"), {
        id, instance: record.instance, token: record.token, action, command,
    });
    try {
        const response = await waitFor(async () => {
            const text = await optionalText(reply);
            if (text === null) return null;
            const value = JSON.parse(text);
            if (value.id !== id || value.instance !== record.instance || value.token !== record.token || value.pid !== record.pid) {
                throw new Error("The duck control response could not be authenticated.");
            }
            return value;
        }, 2000);
        if (!response) throw new Error("The duck did not answer its control request. No process was signalled. If an older duck is running, quit it from its menu.");
        if (response.error) throw new Error(response.error);
        return response;
    } finally {
        await rm(request, { force: true });
        await rm(reply, { force: true });
    }
}

async function waitForExit(record) {
    if (!await waitFor(async () => !await pidExists(record.pid), 6000)) {
        throw new Error("The duck is still stopping. Wait and try again. No process was signalled.");
    }
}

export async function duckStatus() {
    const supported = desktopSupported;
    if (!supported) return { supported, running: false, built: false, sprint: null };
    const built = await stat(binaryPath()).then(() => true, () => false);
    let record;
    try { record = await controlRecord(); }
    catch (error) { return { supported, running: false, built, sprint: null, controlError: error.message }; }
    if (!record) return { supported, running: false, built, sprint: null };
    const status = await requestControl(record, "status");
    return { supported, running: true, built, stopping: status.stopping, ready: status.ready,
        settings: status.settings, snoozeUntil: status.snoozeUntil, sprint: await readSprint() };
}

// A hash of the files the duck is built from and loads.
export async function buildFingerprint() {
    const hash = createHash("sha256");
    for (const file of duckFiles) hash.update(await readFile(file));
    return hash.digest("hex");
}

// The instance records its loaded content, not file timestamps or a reusable PID.
export async function isStale() {
    const record = await controlRecord();
    return record !== null && record.fingerprint !== await buildFingerprint();
}

async function ensureBuilt() {
    if (!desktopSupported) throw new Error("The floating duck needs macOS 13 or later.");
    const binary = binaryPath();
    const [src, bin] = await Promise.all([stat(source), stat(binary).catch(() => null)]);
    if (bin && bin.mtimeMs >= src.mtimeMs) return;
    building ??= (async () => {
        await mkdir(stateDir(), { recursive: true, mode: 0o700 });
        const temporary = `${binary}.${randomBytes(8).toString("hex")}.building`;
        try {
            const arch = process.arch === "arm64" ? "arm64" : "x86_64";
            await run("swiftc", ["-O", "-swift-version", "5", "-target", `${arch}-apple-macosx13.0`, source, "-o", temporary], { timeout: 240000 });
            await rename(temporary, binary);
        } catch (error) {
            await rm(temporary, { force: true });
            const diagnostic = error.stderr?.trim() || error.message;
            const logPath = join(stateDir(), "duck-build.log");
            let logNote = `Full diagnostics: ${logPath}`;
            try { await writeFile(logPath, `${diagnostic}\n`, { mode: 0o600 }); }
            catch (logError) { logNote = `Could not write build diagnostics: ${logError.message}`; }
            const hint = error.code === "ENOENT" ? " Install the Xcode command line tools (swiftc was not found)." : "";
            throw new Error(`The duck could not be built.${hint}\n${diagnostic}\n${logNote}`, { cause: error });
        }
    })().finally(() => { building = undefined; });
    await building;
}

async function startDuck() {
    await ensureBuilt();
    const fingerprint = await buildFingerprint();
    const log = await open(join(stateDir(), "duck.log"), "a", 0o600);
    try {
        const child = spawn(binaryPath(), ["--sprite", sprite, "--state", stateDir(), "--fingerprint", fingerprint], {
            detached: true,
            stdio: ["ignore", log.fd, log.fd],
        });
        await new Promise((resolve, reject) => {
            child.once("spawn", resolve);
            child.once("error", reject);
        });
        child.unref();
    } finally {
        await log.close();
    }
    const ready = await waitFor(async () => {
        const record = await controlRecord();
        return record && (await requestControl(record, "status")).ready;
    }, 8000);
    if (ready) return;
    throw new Error("The duck did not start. See duck.log in the Little intermissions state folder.");
}

export async function wakeDuck() {
    if (!desktopSupported) throw new Error("The floating duck needs macOS 13 or later.");
    const existing = await controlRecord();
    if (existing) {
        const result = await requestControl(existing, "wake");
        if (!result.stopping) return { ...(await duckStatus()), started: false, greeted: result.greeted };
        await waitForExit(existing);
    }
    await startDuck();
    return { ...(await duckStatus()), started: true };
}

export async function sendHome() {
    const record = await controlRecord();
    if (record) {
        await requestControl(record, "home");
        await waitForExit(record);
    }
    return { supported: desktopSupported, running: false, built: await stat(binaryPath()).then(() => true, () => false), sprint: null };
}

// Wakes the duck if it is at home, then leaves it a command. The duck takes the command on its next
// one-second tick, or later if it is busy. Settings are applied before acknowledgement.
export async function sendCommand(command) {
    if (!desktopSupported) throw new Error("The floating duck needs macOS 13 or later.");
    let started = false;
    let record = await controlRecord();
    if (record && (await requestControl(record, "status")).stopping) {
        await waitForExit(record);
        record = null;
    }
    if (record === null) {
        await startDuck();
        started = true;
    } else if (await isStale()) {
        throw new Error("The duck on duty is an older build. Run `duck home`, then `duck`.");
    }
    record = await controlRecord();
    if (!record) throw new Error("The duck exited before it could accept the command.");
    await requestControl(record, "command", command);
    return { started };
}

// accepted is false when the duck has not started the sprint after a few seconds, for example because it is
// being carried. The request stays in the inbox for a minute, so it can still start.
export async function startSprint(minutes) {
    const wanted = sprintMinutes(minutes);
    const sentAt = Date.now();
    const { started } = await sendCommand({ cmd: "sprint", minutes: wanted });
    const sprint = await waitFor(async () => {
        const current = await readSprint();
        return current && current.startedAt >= sentAt ? current : null;
    }, 6000);
    return { ...(await duckStatus()), started, requested: wanted, accepted: sprint !== null };
}

export async function stopSprint() {
    const before = await duckStatus();
    if (before.controlError) throw new Error(before.controlError);
    if (!before.sprint) return { ...before, wasRunning: false, stopped: false };
    await sendCommand({ cmd: "sprint-stop" });
    const gone = await waitFor(async () => (await readSprint()) === null, 4000);
    return { ...(await duckStatus()), wasRunning: true, stopped: gone === true };
}
