import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const run = promisify(execFile);
test("isolated native duck: Temp scarf, quiet snooze, authenticated control, stopping and keyboard settings", { skip: process.platform !== "darwin", timeout: 120000 }, async () => {
    const home = await mkdtemp(join(tmpdir(), "duck-native-test-"));
    const dir = join(home, "state", "little-intermissions");
    const priorHome = process.env.COPILOT_HOME;
    process.env.COPILOT_HOME = home;
    const installed = join(home, "extensions", "little-intermissions");
    await cp(fileURLToPath(new URL(".", import.meta.url)), installed, { recursive: true });
    const { duckStatus, isStale, sendCommand, sendHome, wakeDuck } = await import(pathToFileURL(join(installed, "duck-control.mjs")));
    const source = join(installed, "duck", "Duck.swift");
    const cli = join(installed, "duck-cli.mjs");
    let started = false;
    try {
        await mkdir(dir, { recursive: true });
        const swift = await readFile(source, "utf8");
        // The real controller and entry point run, but no test window is ever ordered onto the desktop.
        const hidden = swift.replaceAll("panel.orderFrontRegardless()", "/* test window stays hidden */")
            .replace("func goHome(force: Bool) {", `func goHome(force: Bool) {
                if FileManager.default.fileExists(atPath: stateDir.appendingPathComponent("hold-home").path) { return }`)
            .replace("controller.start()", `
            if CommandLine.arguments.contains("--check-snooze") {
                precondition(controller.buildMenu().items.contains { $0.action == #selector(DuckController.menuFlip) && $0.title == "Flip" }, "menu offers Flip")
                precondition(controller.handleCommand(["cmd": "flip"]), "flip command is recognized")
                precondition(controller.busy, "flip starts an action")
                controller.interrupt()
                controller.busy = true
                precondition(!controller.handleCommand(["cmd": "flip"]), "busy flip waits")
                controller.interrupt()
                controller.menuSnooze()
                controller.busy = false
                controller.doCute()
                precondition(!controller.busy, "snooze must suppress spontaneous cute actions")
                controller.handleReturn(away: 600, now: Date())
                precondition(!controller.busy, "snooze must suppress unsolicited welcomes")
                controller.menuCute()
                precondition(controller.busy, "explicit cute action remains available")
                controller.interrupt()
                controller.menuFlip()
                precondition(controller.busy, "explicit flip remains available during snooze")
                controller.startSprint(minutes: 25)
                controller.menuFlip()
                precondition(controller.mode == .sprinting, "flip does not interrupt a sprint")
                controller.menuSnooze()
                precondition(controller.mode == .sprinting, "snooze must not cancel a sprint")
                controller.finishSprint(end: Date(), now: Date())
                precondition(controller.mode == .nudging, "sprint completion still prompts")
                let quietUntil = controller.snoozeUntil
                controller.nudgeIgnored(now: Date())
                precondition(controller.snoozeUntil >= quietUntil, "a sprint response must not shorten quiet time")
                controller.accessory = .scarf
                controller.startDebate()
                precondition(controller.wornAccessory == .scarf, "debate is not Temp duty")
                controller.beginDuty()
                precondition(controller.wornAccessory == .nude, "the scarf comes off for Temp duty")
                controller.nextGagAt = .distantPast
                controller.maybeGag(now: Date())
                precondition(!controller.busy, "quiet time suppresses unsolicited duty quips too")
                controller.finishDuty(early: true, away: 0)
                precondition(controller.wornAccessory == .nude, "the scarf stays off through the report")
                controller.toNap()
                precondition(controller.wornAccessory == .scarf, "the selected scarf returns after the report")
                controller.beginDuty()
                controller.accessory = .topHat
                precondition(controller.wornAccessory == .topHat, "a hat can replace the scarf on duty")
                controller.toNap()
                precondition(controller.wornAccessory == .topHat, "ending duty must not restore an old choice")
                exit(0)
            }
            controller.start()`);
        await writeFile(source, hidden);
        const binary = join(home, "check-duck");
        await run("swiftc", ["-swift-version", "5", source, "-o", binary], { timeout: 90000 });
        await run(binary, ["--state", dir, "--sprite", join(installed, "duck", "sprite.html"), "--check-snooze"], { timeout: 10000 });

        started = true;
        const first = await wakeDuck();
        assert.equal(first.started, true);
        assert.equal(first.running, true);
        assert.equal(await isStale(), false);
        const record = JSON.parse(await readFile(join(dir, "control.json"), "utf8"));
        assert.equal((await duckStatus()).running, true);
        const saveRecord = (value) => writeFile(join(dir, "control.json"), JSON.stringify(value));
        try {
            await saveRecord({ ...record, token: "0".repeat(64) });
            await assert.rejects(sendHome(), /did not answer/);
            await saveRecord(record);
            assert.equal((await duckStatus()).running, true, "wrong secret cannot stop the native instance");
            await saveRecord({ ...record, fingerprint: "old" });
            assert.equal(await isStale(), true);
            await assert.rejects(sendCommand({ cmd: "say", text: "Outdated." }), /older build/);
        } finally {
            await saveRecord(record);
        }
        await sendCommand({ cmd: "say", text: "Authenticated command." });
        const cliRun = (...args) => run(process.execPath, [cli, ...args], { env: { ...process.env, COPILOT_HOME: home } });
        assert.match((await cliRun("flip")).stdout, /Asked the duck/);
        for (const args of [["nudges", "off"], ["nudges", "30"], ["playfulness", "lively"], ["snooze"]]) {
            await cliRun(...args);
        }
        const status = await duckStatus();
        assert.equal(status.settings.nudgeEveryMinutes, 30);
        assert.equal(status.settings.playfulness, "lively");
        assert.ok(status.snoozeUntil > Date.now() + 3500000);
        for (const args of [["nudges", "1"], ["playfulness", "wild"], ["snooze", "forever"], ["flip", "extra"]]) {
            await assert.rejects(cliRun(...args), (error) => error.code === 2);
        }
        await writeFile(join(dir, "hold-home"), "");
        const stopAt = Date.now();
        try {
            await assert.rejects(sendHome(), /still stopping/);
            assert.ok(Date.now() - stopAt < 9000, "stopping has a bounded wait");
            assert.equal((await duckStatus()).running, true);
        } finally {
            await rm(join(dir, "hold-home"), { force: true });
        }
        const stopping = sendHome();
        await new Promise((resolve) => setTimeout(resolve, 300));
        const returning = wakeDuck();
        assert.equal((await stopping).running, false);
        const fresh = await returning;
        assert.equal(fresh.started, true);
        assert.equal(fresh.running, true);
        assert.equal(fresh.settings.playfulness, "lively");
        assert.notEqual(JSON.parse(await readFile(join(dir, "control.json"), "utf8")).instance, record.instance);
        await sendHome();
        started = false;
    } finally {
        if (started) await sendHome();
        if (priorHome === undefined) delete process.env.COPILOT_HOME; else process.env.COPILOT_HOME = priorHome;
        await rm(home, { recursive: true, force: true });
    }
});

test("copied packages launch matching native and sprite versions regardless of timestamps", { skip: process.platform !== "darwin", timeout: 180000 }, async () => {
    const home = await mkdtemp(join(tmpdir(), "duck-package-test-"));
    const priorHome = process.env.COPILOT_HOME;
    process.env.COPILOT_HOME = home;
    const dir = join(home, "state", "little-intermissions");
    let active;
    try {
        const original = fileURLToPath(new URL(".", import.meta.url));
        const probe = join(dir, "flip-probe.json");
        const launch = async (version, oldVoice) => {
            const installed = join(home, version, "extensions", "little-intermissions");
            await cp(original, installed, { recursive: true });
            const source = join(installed, "duck", "Duck.swift");
            const swift = (await readFile(source, "utf8"))
                .replaceAll("panel.orderFrontRegardless()", "/* test window stays hidden */")
                .replace("        enter()\n", "        menuFlip()\n")
                .replace("            guard let self, let done, self.gen == g else { return }", `
            if kind == "flip", let self {
                self.web.evaluateJavaScript("document.body.dataset.act || null") { value, error in
                    let evidence: [String: Any] = [
                        "native": "${version}", "sprite": self.spriteURL.path,
                        "act": value ?? NSNull(), "cue": result ?? NSNull(),
                        "error": error?.localizedDescription ?? ""
                    ]
                    let data = try! JSONSerialization.data(withJSONObject: evidence)
                    try! data.write(to: self.stateDir.appendingPathComponent("flip-probe.json"), options: .atomic)
                }
            }
            guard let self, let done, self.gen == g else { return }`);
            await writeFile(source, swift);
            if (oldVoice) {
                const voice = join(installed, "duck", "voice.js");
                await writeFile(voice, (await readFile(voice, "utf8")).replace('case "flip":', 'case "unavailable-flip":'));
            }
            // A copied older checkout can have an earlier mtime than the shared executable.
            await utimes(source, new Date(0), new Date(0));
            const controls = await import(pathToFileURL(join(installed, "duck-control.mjs")));
            active = controls;
            await run(process.execPath, [join(installed, "duck-cli.mjs"), "wake"], { env: { ...process.env }, timeout: 90000 });
            let evidence;
            for (const deadline = Date.now() + 5000; Date.now() < deadline;) {
                try { evidence = JSON.parse(await readFile(probe, "utf8")); break; }
                catch (error) { if (error.code !== "ENOENT") throw error; }
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
            assert.ok(evidence, "the native menu action reached the loaded sprite");
            assert.equal(evidence.error, "");
            assert.equal(evidence.native, version, "the executable must come from this package");
            const record = JSON.parse(await readFile(join(dir, "control.json"), "utf8"));
            assert.equal(record.fingerprint, await controls.buildFingerprint());
            assert.equal(await controls.isStale(), false);
            await controls.sendHome();
            active = null;
            await rm(probe);
            return { installed, evidence };
        };
        const old = await launch("old", true);
        assert.equal(old.evidence.act, null);
        assert.equal(old.evidence.cue, null, "reproduce the old sprite ignoring Flip");
        const updated = await launch("updated", false);
        assert.ok(["deskflip", "vasetoss", "chainsaw"].includes(updated.evidence.act), "Flip starts an animation through the native menu action");
        assert.equal(updated.evidence.act, updated.evidence.cue.act);
        assert.ok(updated.evidence.cue.ms >= 2600);
        assert.notEqual(updated.evidence.sprite, old.evidence.sprite);
        const bundle = join(updated.evidence.sprite, "..");
        for (const name of ["Duck.swift", "sprite.html", "voice.js", "lines.js"]) {
            assert.deepEqual(await readFile(join(bundle, name)), await readFile(join(updated.installed, "duck", name)));
        }
        const binary = join(bundle, "duck");
        const compiledAt = (await stat(binary)).mtimeMs;
        // The running bundle remains unchanged if the installed artwork is updated.
        await writeFile(join(updated.installed, "duck", "voice.js"), "// next update\n");
        assert.notEqual(await readFile(join(bundle, "voice.js"), "utf8"), "// next update\n");
        await cp(join(bundle, "voice.js"), join(updated.installed, "duck", "voice.js"));
        active = await import(pathToFileURL(join(updated.installed, "duck-control.mjs")));
        await active.wakeDuck();
        assert.equal((await stat(binary)).mtimeMs, compiledAt, "unchanged content reuses its own build");
    } finally {
        if (active) await active.sendHome();
        if (priorHome === undefined) delete process.env.COPILOT_HOME; else process.env.COPILOT_HOME = priorHome;
        await rm(home, { recursive: true, force: true });
    }
});
