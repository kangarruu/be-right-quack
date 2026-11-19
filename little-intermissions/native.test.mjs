import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { duckStatus, isStale, sendCommand, sendHome, wakeDuck } from "./duck-control.mjs";

const run = promisify(execFile);
test("isolated native duck: quiet snooze, authenticated control, stopping and keyboard settings", { skip: process.platform !== "darwin", timeout: 120000 }, async () => {
    const home = await mkdtemp(join(tmpdir(), "duck-native-test-"));
    const dir = join(home, "state", "little-intermissions");
    const priorHome = process.env.COPILOT_HOME;
    process.env.COPILOT_HOME = home;
    const source = fileURLToPath(new URL("./duck/Duck.swift", import.meta.url));
    const cli = fileURLToPath(new URL("./duck-cli.mjs", import.meta.url));
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
                controller.menuSnooze()
                controller.busy = false
                controller.doCute()
                precondition(!controller.busy, "snooze must suppress spontaneous cute actions")
                controller.handleReturn(away: 600, now: Date())
                precondition(!controller.busy, "snooze must suppress unsolicited welcomes")
                controller.menuCute()
                precondition(controller.busy, "explicit cute action remains available")
                controller.startSprint(minutes: 25)
                controller.menuSnooze()
                precondition(controller.mode == .sprinting, "snooze must not cancel a sprint")
                controller.finishSprint(end: Date(), now: Date())
                precondition(controller.mode == .nudging, "sprint completion still prompts")
                let quietUntil = controller.snoozeUntil
                controller.nudgeIgnored(now: Date())
                precondition(controller.snoozeUntil >= quietUntil, "a sprint response must not shorten quiet time")
                controller.beginDuty()
                controller.nextGagAt = .distantPast
                controller.maybeGag(now: Date())
                precondition(!controller.busy, "quiet time suppresses unsolicited duty quips too")
                exit(0)
            }
            controller.start()`);
        const harness = join(home, "Duck.swift");
        await writeFile(harness, hidden);
        const binary = join(dir, "duck");
        await run("swiftc", ["-swift-version", "5", harness, "-o", binary], { timeout: 90000 });
        await run(binary, ["--state", dir, "--sprite", fileURLToPath(new URL("./duck/sprite.html", import.meta.url)), "--check-snooze"], { timeout: 10000 });

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
        for (const args of [["nudges", "off"], ["nudges", "30"], ["playfulness", "lively"], ["snooze"]]) {
            await cliRun(...args);
        }
        const status = await duckStatus();
        assert.equal(status.settings.nudgeEveryMinutes, 30);
        assert.equal(status.settings.playfulness, "lively");
        assert.ok(status.snoozeUntil > Date.now() + 3500000);
        for (const args of [["nudges", "1"], ["playfulness", "wild"], ["snooze", "forever"]]) {
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
