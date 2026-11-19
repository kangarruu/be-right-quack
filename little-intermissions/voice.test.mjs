import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const read = (name) => readFileSync(fileURLToPath(new URL("./duck/" + name, import.meta.url)), "utf8");
const sprite = read("sprite.html");
const page = vm.createContext({});
vm.runInContext(read("lines.js"), page);
vm.runInContext(read("voice.js"), page);
const { DUCK_LINES: lines, DuckVoice: V } = page;

const seeded = (seed) => {
    let s = seed >>> 0;
    return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
};
const voiceAt = (hour, seed = 1) => V.createVoice({ lines, rng: seeded(seed), hour: () => hour });
const debateWith = (seed, voice = voiceAt(15, seed)) => V.createDebate({ lines, rng: seeded(seed), draw: voice.draw });
const chipIds = (turn) => Array.from(turn.chips, (c) => c.id);
const toFaint = (debate) => {
    let turn = debate.open();
    while (turn.mood !== "faint") turn = debate.pick(turn.chips.find((c) => c.kind === "excuse").id);
    return turn;
};

test("every duck line is short enough for the bubble and appears only once", () => {
    const pools = {
        entrance: [lines.entrance, 80], hello: [lines.hello, 80], click: [lines.click, 80], announce: [lines.announce, 80],
        announceWin: [lines.announceWin, 80], decline: [lines.decline, 80], welcome: [lines.welcome, 80],
        quips: [lines.quips, 80], snooze: [lines.snooze, 80], nudge: [lines.nudge, 110], nudgeLate: [lines.nudgeLate, 110],
        nudgeLunch: [lines.nudgeLunch, 110], sneeze: [lines.cute.sneeze, 80], spin: [lines.cute.spin, 80],
        bow: [lines.cute.bow, 80], gagSay: [lines.gags.map((g) => g.say), 80], gagLog: [lines.gags.map((g) => g.log), 40],
        sprintStart: [lines.sprintStart, 80], sprintCheck: [lines.sprintCheck, 80], sprintEnd: [lines.sprintEnd, 80],
        sprintExtend: [lines.sprintExtend, 80], sprintCancel: [lines.sprintCancel, 80],
        logFiller: [lines.logFiller, 40], early: [lines.report.early, 80], short: [lines.report.short, 80],
        medium: [lines.report.medium, 80], long: [lines.report.long, 80], tails: [lines.report.tails, 80],
        debateOpen: [lines.debate.open, 80], debateDecline: [lines.debate.decline, 80], faint: [lines.debate.faint, 80],
        faintWin: [lines.debate.faintWin, 80], revive: [lines.debate.revive, 80],
        tiers: [lines.debate.excuses.flatMap((e) => e.tiers), 80],
    };
    const owner = new Map();
    for (const [name, [list, cap]] of Object.entries(pools)) {
        assert.ok(list.length >= 3, `${name} needs a few lines to rotate through`);
        for (const text of list) {
            assert.equal(typeof text, "string", name);
            assert.ok(text.length > 0 && text === text.trim() && !/[\u0000-\u001f]/.test(text), `${name}: ${JSON.stringify(text)}`);
            assert.ok(text.length <= cap, `${name} is ${text.length} characters: ${text}`);
            assert.equal(owner.get(text), undefined, `"${text}" is in both ${name} and ${owner.get(text)}`);
            owner.set(text, name);
        }
    }
    const { excuses, exits } = lines.debate;
    assert.equal(new Set(excuses.map((e) => e.id)).size, excuses.length);
    for (const e of excuses) {
        assert.ok(e.label.length <= 15, e.label);
        assert.equal(e.tiers.length, 4, e.id);
        assert.equal(e.tiers[3], e.tiers[3].toUpperCase(), `${e.id} frantic tier is shouted`);
    }
    assert.ok(exits.yield.length <= 15 && exits.decline.length <= 15);
});

test("poses and acts the voice asks for exist in the sprite", () => {
    const poses = new Set(["faint", "sit", ...V.MOODS.map((m) => m.pose)]);
    const acts = new Set(["happy", "sneeze", "spin", "bow", ...V.MOODS.map((m) => m.act).filter(Boolean), ...lines.gags.map((g) => g.act)]);
    const timings = sprite.match(/const actMs = \{([^}]*)\}/)[1];
    for (const pose of poses) assert.ok(sprite.includes(`data-pose="${pose}"`), `pose ${pose}`);
    for (const act of acts) {
        assert.ok(sprite.includes(`data-act="${act}"`), `act ${act}`);
        assert.match(timings, new RegExp(`\\b${act}:`), `act ${act} needs a duration`);
    }
    const order = ['src="lines.js"', 'src="voice.js"', "window.duck = {"].map((needle) => sprite.indexOf(needle));
    assert.ok(order[0] > 0 && order[0] < order[1] && order[1] < order[2], "scripts load before the sprite script");
});

// A native window shorter than the page cuts the duck down to its head.
test("the native window is exactly as big as the sprite page", () => {
    const swift = read("Duck.swift");
    const native = ["windowWidth", "windowHeight"].map((name) => Number(swift.match(new RegExp(`let ${name}: CGFloat = (\\d+)`))[1]));
    const [, width, height] = sprite.match(/html, body \{[^}]*?width: (\d+)px; height: (\d+)px/);
    assert.deepEqual(native, [Number(width), Number(height)]);
});

// Swift reaches the page only through strings, so a misspelt call fails silently on the desktop.
test("every page call the native duck makes, and every message the page sends back, has a match", () => {
    const swift = read("Duck.swift");
    const found = (source, pattern, floor) => {
        const names = new Set(Array.from(source.matchAll(pattern), (m) => m[1]));
        assert.ok(names.size >= floor, `${pattern} found ${names.size} names, expected at least ${floor}`);
        return names;
    };
    const api = sprite.slice(sprite.indexOf("window.duck = {"), sprite.indexOf("new URLSearchParams"));
    const methods = found(api, /^ {4}([A-Za-z]+)\(/gm, 12);
    for (const call of found(swift, /\bduck\.([A-Za-z]+)\(/g, 12)) assert.ok(methods.has(call), `duck.${call}() exists in the sprite`);

    const timings = sprite.match(/const actMs = \{([^}]*)\}/)[1];
    for (const pose of found(swift, /duck\.base\('([a-z]+)'\)/g, 8)) assert.ok(sprite.includes(`data-pose="${pose}"`), `pose ${pose}`);
    for (const act of found(swift, /duck\.play\('([a-z]+)'\)/g, 8)) {
        assert.ok(sprite.includes(`data-act="${act}"`), `act ${act}`);
        assert.match(timings, new RegExp(`\\b${act}:`), `act ${act} needs a duration`);
    }
    const kinds = [...found(swift, /\bcue\("([A-Za-z]+)"/g, 15), ...found(swift, /\bspoken\("([A-Za-z]+)"\)/g, 3)];
    for (const kind of kinds) assert.ok(read("voice.js").includes(`case "${kind}"`), `the voice has a ${kind} cue`);

    for (const type of found(sprite, /\bt: "([a-z]+)"/g, 2)) assert.ok(swift.includes(`case "${type}":`), `Swift handles ${type} messages`);
    for (const event of found(sprite, /\bevent: "([a-z]+)"/g, 2)) assert.ok(swift.includes(`case "${event}"`), `Swift handles ${event} events`);
});

test("a deck never repeats a card back to back, even after reshuffling", () => {
    for (let seed = 1; seed <= 8; seed++) {
        const bag = V.createBag(["a", "b", "c"], seeded(seed));
        const drawn = Array.from({ length: 90 }, () => bag.next());
        drawn.forEach((card, i) => i && assert.notEqual(card, drawn[i - 1]));
        for (let i = 0; i < drawn.length; i += 3) assert.deepEqual(drawn.slice(i, i + 3).sort(), ["a", "b", "c"]);
    }
});

test("nudges follow the time of day and stay on screen until replaced", () => {
    const seen = (hour) => {
        const voice = voiceAt(hour);
        return new Set(Array.from({ length: 30 }, () => voice.cue("nudge").text));
    };
    const only = (hour, pool) => [...seen(hour)].every((text) => pool.includes(text));
    for (const hour of [22, 23, 0, 4.99]) assert.ok(only(hour, lines.nudgeLate), `late ${hour}`);
    for (const hour of [11.5, 12, 13.99]) assert.ok(only(hour, lines.nudgeLunch), `lunch ${hour}`);
    for (const hour of [5, 9, 11.49, 14, 17, 21.99]) assert.ok(only(hour, lines.nudge), `day ${hour}`);
    assert.equal(voiceAt(15).cue("nudge").ms, 0);
});

test("cues last long enough to read, carry their act, and accept an override", () => {
    const voice = voiceAt(15);
    assert.equal(voice.cue("nope"), null);
    const floors = { entrance: 5000, hello: 3500, click: 1800, decline: 5000, welcome: 6000, quip: 5000, snooze: 4500,
        announce: 9000, gag: 3500, sneeze: 2600, spin: 2600, bow: 2600 };
    for (const [kind, floor] of Object.entries(floors)) {
        for (let i = 0; i < 10; i++) {
            const cue = voice.cue(kind);
            assert.equal(cue.ms, Math.max(floor, V.readMs(cue.text)), kind);
        }
    }
    for (const kind of ["sneeze", "spin", "bow"]) assert.equal(voice.cue(kind).act, kind);
    assert.equal(voice.cue("click", { ms: 0 }).ms, 0);
    assert.equal(V.readMs(""), 1800);
    assert.equal(V.readMs("x".repeat(40)), 3600);
    assert.equal(V.readMs("x".repeat(400)), 11000);
});

test("say speaks the caller's own text, and refuses empty or non-text", () => {
    const voice = voiceAt(15);
    const cue = voice.cue("say", { text: "Close the laptop." });
    assert.deepEqual([cue.text, cue.ms], ["Close the laptop.", 4000]);
    const long = "x".repeat(120);
    assert.equal(voice.cue("say", { text: long }).ms, V.readMs(long));
    assert.equal(voice.cue("say", { text: "hi", ms: 0 }).ms, 0);
    for (const bad of [undefined, "", 7, null, {}]) assert.equal(voice.cue("say", { text: bad }), null, String(bad));
    assert.equal(voice.cue("say"), null);
});

test("sprint cues fill in the minutes, refuse a bad count, and the end bubble waits for a click", () => {
    const voice = voiceAt(15, 5);
    for (const kind of ["sprintStart", "sprintCheck", "sprintEnd"]) {
        assert.equal(voice.cue(kind), null, `${kind} needs a count`);
        for (const bad of [0, -3, NaN, Infinity, "25", null]) assert.equal(voice.cue(kind, { n: bad }), null, `${kind} ${String(bad)}`);
    }
    for (const [kind, floor] of [["sprintStart", 4000], ["sprintCheck", 3500], ["sprintExtend", 3500], ["sprintCancel", 4000]]) {
        for (let i = 0; i < 30; i++) {
            const cue = voice.cue(kind, { n: 25 });
            assert.ok(!/[{}]/.test(cue.text), cue.text);
            assert.equal(cue.ms, Math.max(floor, V.readMs(cue.text)), kind);
            assert.equal(cue.act, undefined, kind);
        }
    }
    const counts = new Set(Array.from({ length: 40 }, () => voice.cue("sprintCheck", { n: 25 }).text));
    assert.ok([...counts].some((text) => text.includes("25")), "the minutes appear in the text");
    for (let i = 0; i < 20; i++) assert.ok(!voice.cue("sprintStart", { n: 0.4 }).text.includes("0"), "a sliver of a minute reads as 1, never 0");
    assert.equal(voice.cue("sprintCheck", { n: 24.6, ms: 0 }).ms, 0);

    for (let i = 0; i < 20; i++) {
        const end = voice.cue("sprintEnd", { n: 25 });
        assert.ok(!/[{}]/.test(end.text), end.text);
        assert.deepEqual([end.ms, end.act], [0, "hop"]);
    }
    assert.ok(lines.sprintEnd.every((line) => /click me/i.test(line)), "a bubble that stays says what a click does");
});

test("the sprint clock shows minutes and seconds, then hours", () => {
    const cases = [[1500, "25:00"], [59, "00:59"], [0, "00:00"], [-5, "00:00"], [0.9, "00:00"], [NaN, "00:00"], [3599, "59:59"],
        [3600, "1:00:00"], [5400, "1:30:00"], [10800, "3:00:00"]];
    for (const [seconds, text] of cases) assert.equal(V.formatClock(seconds), text, String(seconds));
});

test("the return report scales with the break and lists a short shift log in order", () => {
    const voice = voiceAt(15, 7);
    const report = (o) => voice.cue("report", o);
    const empty = report({ awayMin: 5 }).text.split("\n");
    assert.equal(report({ awayMin: 5 }).ms, 0);
    assert.equal(empty.length, 4);
    assert.equal(empty[1], "Shift log:");
    assert.ok(lines.logFiller.some((filler) => empty[2] === "\u2022 " + filler));
    assert.ok(lines.report.tails.includes(empty[3]));

    const buckets = [[{ early: true, awayMin: 20 }, "early"], [{ awayMin: 1.9 }, "short"], [{ awayMin: 2 }, "medium"],
        [{ awayMin: 7.9 }, "medium"], [{ awayMin: 8 }, "long"]];
    for (const [options, bucket] of buckets) {
        assert.ok(lines.report[bucket].includes(report(options).text.split("\n")[0]), JSON.stringify(options));
    }

    voice.cue("announce");
    for (let i = 0; i < 4; i++) voice.cue("gag");
    const log = voice.shiftLog;
    assert.equal(log.length, 4);
    const bullets = report({ awayMin: 10 }).text.split("\n").filter((l) => l.startsWith("\u2022 ")).map((l) => l.slice(2));
    assert.equal(bullets.length, 2);
    assert.ok(log.indexOf(bullets[0]) >= 0 && log.indexOf(bullets[0]) < log.indexOf(bullets[1]));

    voice.cue("announce");
    assert.equal(voice.shiftLog.length, 0);
    voice.cue("gag");
    voice.startDuty();
    assert.equal(voice.shiftLog.length, 0);
});

test("the debate escalates through four moods, then the duck faints", () => {
    const debate = debateWith(3);
    let turn = debate.open();
    const moods = [turn.mood];
    const used = new Set();
    for (let n = 1; n <= 5; n++) {
        const offered = turn.chips.filter((c) => c.kind === "excuse").map((c) => c.id);
        assert.equal(new Set(offered).size, 2);
        offered.forEach((id) => assert.ok(!used.has(id), `${id} was already used`));
        assert.deepEqual(chipIds(turn).slice(2), ["yield", "decline"]);
        const excuse = lines.debate.excuses.find((e) => e.id === offered[0]);
        used.add(excuse.id);
        turn = debate.pick(excuse.id);
        moods.push(turn.mood);
        if (n <= 4) assert.equal(turn.text, excuse.tiers[n - 1]);
    }
    assert.deepEqual(moods, ["calm", "calm", "firm", "pleading", "frantic", "faint"]);
    assert.equal(turn.pose, "faint");
    assert.equal(turn.end, null);
    assert.equal(turn.autoWinMs, V.FAINT_WAIT_MS);
    assert.deepEqual(chipIds(turn), ["yield", "decline"]);
    assert.equal(debate.phase, "fainted");
});

test("every way out of the debate ends it, and nothing answers afterwards", () => {
    let debate = debateWith(1);
    assert.equal(debate.pick("yield"), null, "no debate is open yet");
    debate.open();
    assert.equal(debate.timeout(), null, "the duck only wins by waiting after it faints");
    const offered = debate.open().chips.filter((c) => c.kind === "excuse").map((c) => c.id);
    const stale = lines.debate.excuses.map((e) => e.id).find((id) => !offered.includes(id));
    assert.equal(debate.pick(stale), null, "an excuse that was not offered is ignored");
    const won = debate.pick("yield");
    assert.deepEqual([won.end, won.pose, won.act, won.ms, won.chips.length], ["won", "sit", "happy", 9000, 0]);
    assert.ok(lines.announceWin.includes(won.text));
    assert.equal(debate.pick("decline"), null);

    debate = debateWith(2);
    debate.open();
    const declined = debate.pick("decline");
    assert.deepEqual([declined.end, declined.ms], ["declined", 5000]);
    assert.ok(lines.debate.decline.includes(declined.text));

    debate = debateWith(3);
    toFaint(debate);
    const revived = debate.pick("decline");
    assert.equal(revived.end, "declined");
    assert.ok(lines.debate.revive.includes(revived.text));

    debate = debateWith(4);
    toFaint(debate);
    assert.equal(debate.pick(lines.debate.excuses[0].id), null, "a fainted duck ignores excuses");
    const waited = debate.timeout();
    assert.equal(waited.end, "won");
    assert.ok(lines.debate.faintWin.includes(waited.text));
    assert.equal(debate.timeout(), null);

    debate = debateWith(5);
    debate.open();
    debate.stop();
    assert.equal(debate.pick("yield"), null);
});

test("a random debate always ends, always offers both exits, and replays the same for a seed", () => {
    const play = (seed) => {
        const rng = seeded(seed);
        const voice = V.createVoice({ lines, rng, hour: () => 15 });
        const debate = V.createDebate({ lines, rng, draw: voice.draw });
        const script = [];
        let turn = debate.open();
        for (let i = 0; i < 10 && !turn.end; i++) {
            script.push(turn.text);
            assert.ok(["yield", "decline"].every((id) => turn.chips.some((c) => c.id === id)), "exits stay on offer");
            turn = debate.pick(turn.chips[Math.floor(rng() * turn.chips.length)].id);
            assert.ok(turn, "every offered chip is accepted");
        }
        assert.ok(turn.end, "the debate terminates");
        return [...script, turn.text];
    };
    for (let seed = 1; seed <= 200; seed++) assert.deepEqual(play(seed), play(seed));
});

test("win lines share one deck between the debate and the walk-away announcement", () => {
    const voice = voiceAt(15, 9);
    const debate = debateWith(9, voice);
    let previous;
    for (let i = 0; i < 40; i++) {
        let text;
        if (i % 2) {
            text = voice.cue("announce", { win: true }).text;
        } else {
            debate.open();
            text = debate.pick("yield").text;
        }
        assert.notEqual(text, previous);
        previous = text;
    }
});
