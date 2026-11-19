import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { duckStatus, sendHome, wakeDuck } from "./duck-control.mjs";

test("stale PID for another executable named duck is never signalled or reported as controlled", { skip: process.platform !== "darwin" }, async () => {
    const home = await mkdtemp(join(tmpdir(), "duck-control-test-"));
    const priorHome = process.env.COPILOT_HOME;
    process.env.COPILOT_HOME = home;
    const dir = join(home, "state", "little-intermissions");
    const child = spawn(process.execPath, ["-e", `
        process.title = "/review-only/unrelated/duck";
        process.on("SIGUSR1", () => process.send("SIGUSR1"));
        process.on("SIGTERM", () => process.send("SIGTERM"));
        process.on("message", () => process.exit(0));
        process.send("ready");
        setInterval(() => {}, 1000);
    `], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
    const signals = [];
    try {
        await once(child, "message");
        child.on("message", (signal) => signals.push(signal));
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, "duck.pid"), String(child.pid));
        const { stdout } = await promisify(execFile)("ps", ["-p", String(child.pid), "-o", "comm="]);
        assert.match(stdout.trim(), /\/duck$/);
        for (const action of [wakeDuck, sendHome]) {
            await assert.rejects(action, /authenticate|older|control/i);
        }
        for (const name of ["wake", "home"]) {
            await assert.rejects(promisify(execFile)(process.execPath, [new URL("./duck-cli.mjs", import.meta.url).pathname, name], {
                env: { ...process.env, COPILOT_HOME: home },
            }), (error) => error.code === 1 && /Cannot authenticate/.test(error.stderr));
        }
        assert.equal((await duckStatus()).running, false);
        assert.deepEqual(signals, []);
        assert.equal(child.exitCode, null);
        await writeFile(join(dir, "control.json"), JSON.stringify({
            pid: child.pid, instance: "00000000-0000-0000-0000-000000000000", token: "a".repeat(64),
        }));
        for (const action of [wakeDuck, sendHome]) await assert.rejects(action, /did not answer/);
        assert.deepEqual(signals, []);
        assert.equal(child.exitCode, null);
    } finally {
        const exited = once(child, "exit");
        child.send("exit");
        await exited;
        if (priorHome === undefined) delete process.env.COPILOT_HOME; else process.env.COPILOT_HOME = priorHome;
        await rm(home, { recursive: true, force: true });
    }
});

test("compiler failure keeps real diagnostics and never points at a nonexistent log", { skip: process.platform !== "darwin" }, async () => {
    const home = await mkdtemp(join(tmpdir(), "duck-build-test-"));
    const cli = new URL("./duck-cli.mjs", import.meta.url);
    try {
        const tools = join(home, "tools");
        await mkdir(tools);
        await writeFile(join(tools, "swiftc"), '#!/bin/sh\necho "Duck.swift:42: error: deliberate compiler failure" >&2\nexit 1\n', { mode: 0o700 });
        await assert.rejects(promisify(execFile)(process.execPath, [cli.pathname, "wake"], {
            env: { ...process.env, COPILOT_HOME: home, PATH: `${tools}:${process.env.PATH}` },
        }), (error) => {
            assert.match(error.stderr, /Duck.swift:42: error: deliberate compiler failure/);
            assert.doesNotMatch(error.stderr, /See the Swift output in duck.log/);
            return true;
        });
        assert.match(await readFile(join(home, "state", "little-intermissions", "duck-build.log"), "utf8"), /deliberate compiler failure/);
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});
