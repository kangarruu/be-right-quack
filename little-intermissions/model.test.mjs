import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, rmdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { request } from "node:http";
import { initialState, transition } from "./model.mjs";
import { startServer, readState } from "./server.mjs";
import { duckStatus, readSprint, sayText, sprintMinutes, writeInbox } from "./duck-control.mjs";

test("all three demos end without awarding real-break keepsakes", () => {
    for (const mode of ["frog", "bakery", "duck"]) {
        let s = transition(initialState(), { action:"select", mode });
        s = transition(s, { action:"start", demo:true, note:"Find the next small step." }, 1000);
        assert.equal(s.active.endsAt, 9000);
        s = transition(s, { action:"finish" }, 9000);
        assert.equal(s.result.mode, mode);
        assert.equal(s.result.demo, true);
        assert.equal(s.keepsakes.length, 0);
        assert.equal(s.note, "Find the next small step.");
    }
});
test("real breaks accept an early return; cancel does not reward or lose notes", () => {
    const started = transition(initialState(), { action:"start", demo:false, note:"Unfinished is fine." }, 1000);
    assert.equal(started.active.endsAt, 301000);
    assert.throws(() => transition(started, { action:"select", mode:"duck" }), /before switching/);
    const ended = transition(started, { action:"finish" }, 1200);
    assert.equal(ended.keepsakes.length, 1);
    assert.equal(ended.active, null);
    assert.throws(() => transition(ended, { action:"finish" }), /no break/);
    const cancelled = transition(started, { action:"cancel" });
    assert.equal(cancelled.keepsakes.length, 0);
    assert.equal(cancelled.note, "Unfinished is fine.");
});
test("invalid inputs do not mutate saved state", () => {
    const s = initialState();
    for (const command of [{ action:"select", mode:"bad" }, { action:"start", demo:"yes" }, { action:"note", note:"x".repeat(501) }, { action:"oops" }]) {
        assert.throws(() => transition(s, command));
    }
    assert.deepEqual(s, initialState());
});
test("duplicate view completions do not award twice or finish a different break", () => {
    const first = transition(initialState(), { action:"start", demo:false }, 1000);
    const completed = transition(first, { action:"finish", startedAt:1000 }, 2000);
    assert.deepEqual(transition(completed, { action:"finish", startedAt:1000 }, 2100), completed);
    const second = transition(completed, { action:"start", demo:false }, 3000);
    assert.throws(() => transition(second, { action:"finish", startedAt:1000 }, 3100), /changed in another view/);
    assert.equal(second.keepsakes.length, 1);
});
test("reports keep rotating beyond the retained shelf, separately for each companion", () => {
    let s = initialState();
    const seen = { frog: [], bakery: [], duck: [] };
    for (let i = 0; i < 90; i++) {
        const mode = ["duck", "frog", "duck", "bakery"][i % 4];
        s = transition(s, { action: "select", mode });
        s = transition(s, { action: "start", demo: false }, i * 1000);
        s = transition(s, { action: "finish" }, i * 1000 + 1);
        const titles = seen[mode];
        if (titles.length) assert.notEqual(s.result.title, titles.at(-1), `${mode} break ${titles.length + 1}`);
        if (titles.length >= 4) assert.equal(s.result.title, titles[titles.length % 4]);
        titles.push(s.result.title);
    }
    assert.equal(s.keepsakes.length, 24);
});
test("old saved shelves migrate from the last report without losing an active break", () => {
    let s = initialState();
    for (let i = 0; i < 24; i++) {
        s = transition(s, { action: "start", demo: false }, i);
        s = transition(s, { action: "finish" }, i + 1);
    }
    delete s.sequences;
    const last = s.result.title;
    s = transition(s, { action: "start", demo: false }, 100);
    s = transition(s, { action: "finish" }, 101);
    assert.notEqual(s.result.title, last);
    const first = s.result.title;
    delete s.sequences;
    s = transition(s, { action: "start", demo: false }, 102);
    delete s.sequences;
    s = transition(s, { action: "finish" }, 103);
    assert.notEqual(s.result.title, first);
});
test("HTTP preserves split UTF-8 and limits raw bytes, not decoded characters", async () => {
    const dir = await mkdtemp(join(tmpdir(), "little-intermissions-utf8-"));
    const entry = await startServer(join(dir, "state.json"));
    const post = (body, split) => new Promise((resolve, reject) => {
        const req = request(entry.url + "command", { method: "POST", headers: { "Content-Type": "application/json" } }, (res) => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks)) }));
        });
        req.on("error", reject);
        req.write(body.subarray(0, split));
        setTimeout(() => req.end(body.subarray(split)), 30);
    });
    try {
        const note = "Hello 👩 café";
        const body = Buffer.from(JSON.stringify({ action: "note", note }));
        const result = await post(body, body.indexOf(Buffer.from("👩")) + 1);
        assert.equal(result.status, 200);
        assert.equal(result.body.note, note);
        assert.equal((await readState(join(dir, "state.json"))).note, note);
        const boundary = Buffer.concat([Buffer.from('{"action":"note","note":"👩"}'), Buffer.alloc(8192 - Buffer.byteLength('{"action":"note","note":"👩"}'), 32)]);
        assert.equal((await post(boundary, 25)).status, 200);
        assert.equal((await post(Buffer.concat([boundary, Buffer.from(" ")]), 25)).status, 413);
    } finally {
        await new Promise((resolve) => entry.server.close(resolve));
        await rm(dir, { recursive: true, force: true });
    }
});
test("a focus sprint is whole minutes from 1 to 180, and a spoken line is short and plain", () => {
    for (const ok of [1, 25, 180, "7", "180"]) assert.equal(sprintMinutes(ok), Number(ok));
    for (const bad of [0, 181, 2.5, -5, 1000, NaN, "0", "2.5", "-5", "1e2", " 25", "", "abc", null, undefined, true]) {
        assert.throws(() => sprintMinutes(bad), /1 to 180 whole minutes/, String(bad));
    }
    assert.equal(sayText("  Stand \n up,\tplease "), "Stand up, please");
    assert.equal(sayText("x".repeat(120)).length, 120);
    assert.throws(() => sayText("   "), /some text/);
    assert.throws(() => sayText("x".repeat(121)), /120 characters/);
});
test("a sprint file counts only while its end time is ahead and every field is a number", async () => {
    const dir = await mkdtemp(join(tmpdir(), "little-intermissions-sprint-"));
    const now = 1_000_000;
    const read = async (text) => {
        await writeFile(join(dir, "sprint.json"), text);
        return readSprint(dir, now);
    };
    try {
        assert.equal(await readSprint(dir, now), null);
        const live = { endsAt: now + 60_000, startedAt: now, minutes: 0.2 };
        assert.deepEqual(await read(JSON.stringify(live)), live);
        assert.equal(await read(JSON.stringify({ ...live, endsAt: now })), null);
        assert.equal(await read(JSON.stringify({ ...live, endsAt: "soon" })), null);
        assert.equal(await read(JSON.stringify({ endsAt: live.endsAt, minutes: 1 })), null);
        assert.equal(await read("not json"), null);
    } finally {
        await rm(dir, { recursive:true, force:true });
    }
});
test("inbox files are private, written whole, and read back in send order", async () => {
    const home = await mkdtemp(join(tmpdir(), "little-intermissions-inbox-"));
    const dir = join(home, "inbox");
    try {
        await Promise.all(Array.from({ length: 25 }, (_, i) => writeInbox(dir, { cmd:"say", text:String(i) })));
        for (let i = 25; i < 50; i += 1) await writeInbox(dir, { cmd:"say", text:String(i) });
        const names = (await readdir(dir)).sort();
        assert.equal(names.length, 50);
        assert.ok(names.every((name) => /^\d{13}-[0-9a-f]{8}\.json$/.test(name)), "no temporary file is left behind");
        const texts = await Promise.all(names.map(async (name) => JSON.parse(await readFile(join(dir, name), "utf8")).text));
        assert.deepEqual(texts, Array.from({ length: 50 }, (_, i) => String(i)));
        assert.equal((await stat(dir)).mode & 0o777, 0o700);
        assert.equal((await stat(join(dir, names[0]))).mode & 0o777, 0o600);
    } finally {
        await rm(home, { recursive:true, force:true });
    }
});
test("duck status never treats an unauthenticated PID as a controlled duck", async () => {
    const home = await mkdtemp(join(tmpdir(), "little-intermissions-duck-"));
    const priorHome = process.env.COPILOT_HOME;
    process.env.COPILOT_HOME = home;
    const dir = join(home, "state", "little-intermissions");
    try {
        assert.equal((await duckStatus()).running, false);
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, "duck.pid"), "999999");
        assert.equal((await duckStatus()).running, false);
        await writeFile(join(dir, "duck.pid"), String(process.pid));
        assert.equal((await duckStatus()).running, false);
        await rm(join(dir, "duck.pid"));

        const path = join(home, "state.json");
        const entry = await startServer(path);
        try {
            const post = (body, type = "application/json") => fetch(entry.url + "duck", { method:"POST", headers:{ "Content-Type":type }, body });
            assert.equal((await post(JSON.stringify({ action:"toString" }))).status, 400);
            assert.equal((await post(JSON.stringify({ action:"wake" }), "text/plain")).status, 415);
            for (const minutes of [181, 2.5, undefined]) {
                const refused = await post(JSON.stringify({ action:"sprint", minutes }));
                assert.equal(refused.status, 400);
                assert.match((await refused.json()).error, /1 to 180 whole minutes/);
            }
            const stopped = await post(JSON.stringify({ action:"sprint_stop" }));
            assert.equal(stopped.status, 200);
            assert.equal((await stopped.json()).wasRunning, false);
            assert.equal((await fetch(entry.url + "duck", { headers:{ Origin:"https://example.com" } })).status, 403);
            assert.equal((await (await fetch(entry.url + "duck")).json()).running, false);
        } finally {
            await new Promise((resolve) => entry.server.close(resolve));
        }
    } finally {
        if (priorHome === undefined) delete process.env.COPILOT_HOME; else process.env.COPILOT_HOME = priorHome;
        await rm(home, { recursive:true, force:true });
    }
});
test("duck command reports an absent duck and rejects unknown commands", { skip: process.platform !== "darwin" }, async () => {
    const home = await mkdtemp(join(tmpdir(), "little-intermissions-cli-"));
    const cli = fileURLToPath(new URL("./duck-cli.mjs", import.meta.url));
    const run = (...args) => promisify(execFile)(process.execPath, [cli, ...args], { env: { ...process.env, COPILOT_HOME: home } });
    try {
        assert.match((await run("status")).stdout, /at home/);
        assert.match((await run("home")).stdout, /already at home/);
        assert.match((await run("sprint", "stop")).stdout, /No focus sprint is running/);
        assert.match((await run("help")).stdout, /sprint \[minutes\]/);
        await assert.rejects(run("dance"), (error) => error.code === 2 && /Usage/.test(error.stderr));
        // None of these may reach the duck: a valid command would build and start it.
        for (const args of [["sprint", "0"], ["sprint", "181"], ["sprint", "2.5"], ["sprint", "-5"], ["sprint", "abc"], ["sprint", "10", "20"],
            ["say"], ["say", "x".repeat(121)], ["cover", "now"]]) {
            await assert.rejects(run(...args), (error) => error.code === 2 && /Usage/.test(error.stderr), args.join(" "));
        }
    } finally {
        await rm(home, { recursive:true, force:true });
    }
});
test("HTTP controls persist across restart and reject cross-origin requests", async () => {
    const dir = await mkdtemp(join(tmpdir(), "little-intermissions-test-"));
    const path = join(dir, "state.json");
    let entry = await startServer(path);
    const close = () => new Promise((resolve) => entry.server.close(resolve));
    try {
        const command = async (value, extra = {}) => fetch(entry.url + "command", {
            method:"POST", headers:{ "Content-Type":"application/json", ...extra }, body:JSON.stringify(value),
        });
        assert.equal((await fetch(entry.url)).status, 200);
        assert.equal((await command({ action:"select", mode:"bakery" })).status, 200);
        assert.equal((await command({ action:"favorite" })).status, 200);
        assert.equal((await command({ action:"note", note:"<script>not executable</script>" })).status, 200);
        assert.equal((await command({ action:"start", demo:false })).status, 200);
        assert.equal((await command({ action:"finish" }, { Origin:"https://example.com" })).status, 403);
        assert.equal((await fetch(new URL("/state", entry.url))).status, 404);
        await close();
        entry = await startServer(path);
        const restored = await (await fetch(entry.url + "state")).json();
        assert.equal(restored.favorite, "bakery");
        assert.equal(restored.active.demo, false);
        assert.equal(restored.note, "<script>not executable</script>");
        assert.equal((await command({ action:"finish" })).status, 200);
        assert.equal(JSON.parse(await readFile(path, "utf8")).keepsakes.length, 1);
        await writeFile(path, "broken data");
        await assert.rejects(() => readState(path));
        assert.equal(await readFile(path, "utf8"), "broken data");
    } finally {
        await close();
        await rm(join(dir, "state.json"), { force:true });
        await rmdir(dir);
    }
});
