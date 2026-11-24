// Pure voice and debate logic for the duck. No DOM and no timers, so
// sprite.html and the Node tests load this same file.
(function () {
  "use strict";

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const readMs = (text) => clamp(1400 + 55 * text.length, 1800, 11000);
  const lasts = (floor, text) => Math.max(floor, readMs(text));
  const localHour = () => {
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60;
  };

  // 1500 -> "25:00", 59 -> "00:59", 5400 -> "1:30:00". Negative and fractional input is clamped and floored.
  function formatClock(totalSeconds) {
    const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const two = (n) => String(n).padStart(2, "0");
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return (h ? `${h}:${two(m)}` : two(m)) + `:${two(s % 60)}`;
  }

  function shuffle(list, rng) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  // Shuffled deck that never repeats the previous card, even across reshuffles.
  function createBag(items, rng) {
    let queue = [];
    let last;
    return {
      next() {
        if (queue.length === 0) {
          queue = shuffle(items.slice(), rng);
          const top = queue.length - 1;
          if (top > 0 && queue[top] === last) {
            const j = Math.floor(rng() * top);
            [queue[j], queue[top]] = [queue[top], queue[j]];
          }
        }
        last = queue.pop();
        return last;
      },
    };
  }

  const nudgeKey = (hour) => {
    if (hour >= 22 || hour < 5) return "nudgeLate";
    if (hour >= 11.5 && hour < 14) return "nudgeLunch";
    return "nudge";
  };

  function createVoice({ lines, rng = Math.random, hour = localHour }) {
    const bags = new Map();
    const draw = (key, items) => {
      if (!bags.has(key)) bags.set(key, createBag(items, rng));
      return bags.get(key).next();
    };
    let shiftLog = [];

    const remember = (entry) => {
      if (!shiftLog.includes(entry)) shiftLog.push(entry);
    };

    // Up to `max` remembered entries, kept in the order they happened.
    function logEntries(max) {
      let chosen = shiftLog;
      if (chosen.length > max) {
        const keep = shuffle(chosen.map((_, i) => i), rng).slice(0, max).sort((a, b) => a - b);
        chosen = keep.map((i) => shiftLog[i]);
      }
      return chosen.length ? chosen : [draw("logFiller", lines.logFiller)];
    }

    function composeReport({ awayMin = 0, early = false }) {
      const bucket = early ? "early" : awayMin < 2 ? "short" : awayMin < 8 ? "medium" : "long";
      return [
        draw(`report.${bucket}`, lines.report[bucket]),
        "Shift log:",
        ...logEntries(2).map((entry) => `\u2022 ${entry}`),
        draw("report.tails", lines.report.tails),
      ].join("\n");
    }

    const plain = (key, floor) => {
      const text = draw(key, lines[key]);
      return { text, ms: lasts(floor, text) };
    };

    // Lines with {n} ("25 min") need o.n, so a cue without a count is refused.
    const counted = (key, floor, o) => {
      if (!Number.isFinite(o.n) || o.n <= 0) return null;
      const text = draw(key, lines[key]).replaceAll("{n}", String(Math.max(1, Math.round(o.n))));
      return { text, ms: lasts(floor, text) };
    };

    // kind: entrance | hello | click | nudge | announce | gag | report | decline |
    //       welcome | quip | snooze | sneeze | spin | bow | flip | say (speaks o.text) |
    //       sprintStart | sprintCheck | sprintEnd (o.n minutes) | sprintExtend | sprintCancel
    // Returns { text, ms, act? }, or null when the kind is unknown or lacks what it needs.
    // ms === 0 means the bubble stays until replaced.
    function cue(kind, o = {}) {
      let out = null;
      switch (kind) {
        case "entrance": out = plain("entrance", 5000); break;
        case "hello": out = plain("hello", 3500); break;
        case "click": out = plain("click", 1800); break;
        case "decline": out = plain("decline", 5000); break;
        case "welcome": out = plain("welcome", 6000); break;
        case "quip": out = plain("quips", 5000); break;
        case "snooze": out = plain("snooze", 4500); break;
        case "nudge": {
          const key = nudgeKey(hour());
          out = { text: draw(key, lines[key]), ms: 0 };
          break;
        }
        case "announce": {
          shiftLog = [];
          const key = o.win ? "announceWin" : "announce";
          const text = draw(key, lines[key]);
          out = { text, ms: lasts(9000, text) };
          break;
        }
        case "gag": {
          const gag = draw("gags", lines.gags);
          remember(gag.log);
          out = { text: gag.say, act: gag.act, ms: lasts(3500, gag.say) };
          break;
        }
        case "flip": {
          const gag = draw("flip", lines.flip);
          out = { text: gag.say, act: gag.act, ms: lasts(3200, gag.say) };
          break;
        }
        case "report": out = { text: composeReport(o), ms: 0 }; break;
        case "say": {
          if (typeof o.text !== "string" || o.text === "") return null;
          out = { text: o.text, ms: lasts(4000, o.text) };
          break;
        }
        case "sprintStart": out = counted("sprintStart", 4000, o); break;
        case "sprintCheck": out = counted("sprintCheck", 3500, o); break;
        case "sprintEnd": {
          const end = counted("sprintEnd", 0, o);
          out = end && { text: end.text, ms: 0, act: "hop" };
          break;
        }
        case "sprintExtend": out = plain("sprintExtend", 3500); break;
        case "sprintCancel": out = plain("sprintCancel", 4000); break;
        case "sneeze":
        case "spin":
        case "bow": {
          const text = draw(`cute.${kind}`, lines.cute[kind]);
          out = { text, act: kind, ms: lasts(2600, text) };
          break;
        }
        default: return null;
      }
      if (!out) return null;
      if (o.ms !== undefined) out.ms = o.ms;
      return out;
    }

    return {
      cue,
      draw,
      startDuty() { shiftLog = []; },
      get shiftLog() { return shiftLog.slice(); },
    };
  }

  // The duck's mood climbs with every excuse you pick.
  const MOODS = [
    { mood: "calm", pose: "sit", act: null },
    { mood: "firm", pose: "proud", act: "quack" },
    { mood: "pleading", pose: "wave", act: "hop" },
    { mood: "frantic", pose: "wave", act: "shake" },
  ];
  const FAINT = { mood: "faint", pose: "faint", act: null };
  const WON = { mood: "won", pose: "sit", act: "happy" };
  const FAINT_WAIT_MS = 10000;

  // One debate. open() starts it; pick(id) answers each click. Every turn is
  // { text, pose, act, mood, chips, end, ms?, autoWinMs? }. `end` is null while the
  // debate continues, then "won" (duck takes the desk) or "declined" (user stays).
  function createDebate({ lines, rng = Math.random, draw }) {
    const d = lines.debate;
    const pickLine = draw || ((key, items) => items[Math.floor(rng() * items.length)]);
    const byId = new Map(d.excuses.map((e) => [e.id, e]));
    const used = new Set();
    let offered = [];
    let picks = 0;
    let phase = "idle"; // idle | asking | fainted | done

    const exitChips = () => [
      { id: "yield", label: d.exits.yield, kind: "yield" },
      { id: "decline", label: d.exits.decline, kind: "decline" },
    ];

    function excuseChips() {
      const pool = d.excuses.filter((e) => !used.has(e.id));
      offered = shuffle(pool, rng).slice(0, 2).map((e) => e.id);
      return offered.map((id) => ({ id, label: byId.get(id).label, kind: "excuse" }));
    }

    const turn = (text, m, chips, more = {}) =>
      ({ text, pose: m.pose, act: m.act, mood: m.mood, chips, end: null, ...more });

    function finish(outcome, text) {
      phase = "done";
      const won = outcome === "won";
      return turn(text, won ? WON : MOODS[0], [], { end: outcome, ms: won ? 9000 : 5000 });
    }

    return {
      get phase() { return phase; },

      open() {
        used.clear();
        picks = 0;
        phase = "asking";
        return turn(pickLine("debate.open", d.open), MOODS[0], [...excuseChips(), ...exitChips()]);
      },

      pick(id) {
        if (phase !== "asking" && phase !== "fainted") return null;
        if (id === "yield") return finish("won", pickLine("announceWin", lines.announceWin));
        if (id === "decline") {
          return phase === "fainted"
            ? finish("declined", pickLine("debate.revive", d.revive))
            : finish("declined", pickLine("debate.decline", d.decline));
        }
        if (phase !== "asking" || !offered.includes(id)) return null;
        used.add(id);
        picks += 1;
        if (picks > MOODS.length) {
          phase = "fainted";
          offered = [];
          return turn(pickLine("debate.faint", d.faint), FAINT, exitChips(), { autoWinMs: FAINT_WAIT_MS });
        }
        const tiers = byId.get(id).tiers;
        const tier = picks - 1;
        return turn(tiers[Math.min(tier, tiers.length - 1)], MOODS[tier], [...excuseChips(), ...exitChips()]);
      },

      // The user left the duck on the floor, so the duck wins by fainting.
      timeout() {
        if (phase !== "fainted") return null;
        return finish("won", pickLine("debate.faintWin", d.faintWin));
      },

      stop() {
        phase = "done";
        offered = [];
      },
    };
  }

  globalThis.DuckVoice = { readMs, formatClock, createBag, createVoice, createDebate, MOODS, FAINT_WAIT_MS };
})();
