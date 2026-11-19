export const modes = ["frog", "bakery", "duck"];
export const quests = [
    "Find a window. Look for something that is not a rectangle.",
    "Refill your water. Inspect one interesting thing on the way.",
    "Visit another room. Notice one thing you usually walk past.",
    "Look outside for a leaf, a cloud, or a particularly good patch of sky.",
];
const souvenirs = ["A very ordinary pebble", "An excellent leaf", "A suspicious mushroom", "A stick with potential"];
const loaves = ["A loaf of good enough", "A slightly wonky bun", "A fresh perspective pretzel", "An unreasonably small baguette"];
const reports = [
    "Inspected the cursor. Suspicious.",
    "Held a meeting with the mouse. Neither of us took notes.",
    "Reviewed the keyboard. Too many letters, not enough ponds.",
    "Rearranged absolutely nothing. You're welcome.",
];
const titlesByMode = { frog: souvenirs, bakery: loaves, duck: reports };
export function initialState() {
    return { version: 1, selected: "frog", favorite: null, note: "", active: null, result: null, keepsakes: [],
        sequences: { frog: 0, bakery: 0, duck: 0 } };
}
export function validState(s) {
    return s?.version === 1 && modes.includes(s.selected) &&
        (s.favorite === null || modes.includes(s.favorite)) &&
        typeof s.note === "string" && s.note.length <= 500 &&
        Array.isArray(s.keepsakes) && s.keepsakes.length <= 24 &&
        s.keepsakes.every(validResult) &&
        (s.sequences === undefined || (s.sequences && modes.every((mode) =>
            Number.isInteger(s.sequences[mode]) && s.sequences[mode] >= 0 && s.sequences[mode] < titlesByMode[mode].length))) &&
        (s.result === null || validResult(s.result)) &&
        (s.active === null || (modes.includes(s.active.mode) && s.active.mode === s.selected &&
            typeof s.active.demo === "boolean" && Number.isFinite(s.active.startedAt) &&
            Number.isFinite(s.active.endsAt) && s.active.endsAt >= s.active.startedAt &&
            Number.isInteger(s.active.index) && s.active.index >= 0));
}
function validResult(r) {
    return r && modes.includes(r.mode) && typeof r.title === "string" &&
        typeof r.demo === "boolean" && Number.isFinite(r.at);
}
export function transition(state, command, now = Date.now()) {
    if (!command || typeof command !== "object" || Array.isArray(command)) throw new Error("A command object is required.");
    const s = structuredClone(state);
    // Older shelves have no cursor. Continue from each companion's last retained result.
    s.sequences ??= Object.fromEntries(modes.map((mode) => {
        const last = s.keepsakes.filter((item) => item.mode === mode).at(-1);
        return [mode, (titlesByMode[mode].indexOf(last?.title) + 1) % titlesByMode[mode].length];
    }));
    switch (command.action) {
        case "select":
            if (!modes.includes(command.mode)) throw new Error("Unknown companion.");
            if (s.active) throw new Error("Return from this break, or cancel it, before switching companions.");
            s.selected = command.mode;
            s.result = null;
            break;
        case "favorite":
            s.favorite = s.favorite === s.selected ? null : s.selected;
            break;
        case "note":
            setNote(s, command.note);
            break;
        case "start":
            if (s.active) throw new Error("A break is already in progress.");
            if (typeof command.demo !== "boolean") throw new Error("Choose demo or real-break mode.");
            if (command.note !== undefined) setNote(s, command.note);
            s.result = null;
            s.active = {
                mode: s.selected, demo: command.demo, startedAt: now,
                endsAt: now + (command.demo ? 8000 : 300000),
                index: s.sequences[s.selected],
            };
            break;
        case "finish": {
            // Two open views can finish the same demo at once.
            if (!s.active && s.result && Number.isFinite(command.startedAt) && command.startedAt <= s.result.at) return s;
            if (!s.active) throw new Error("There is no break to return from.");
            if (command.startedAt !== undefined && command.startedAt !== s.active.startedAt) {
                throw new Error("This break changed in another view. Reopen the playground to refresh it.");
            }
            const a = s.active;
            const titles = titlesByMode[a.mode];
            s.result = { mode: a.mode, demo: a.demo, title: titles[a.index % titles.length], at: now };
            if (!a.demo) {
                s.keepsakes = [...s.keepsakes, s.result].slice(-24);
                s.sequences[a.mode] = (a.index + 1) % titles.length;
            }
            s.active = null;
            break;
        }
        case "cancel":
            s.active = null;
            s.result = null;
            break;
        default: throw new Error("Unknown playground action.");
    }
    return s;
}
function setNote(s, note) {
    if (typeof note !== "string" || note.length > 500) throw new Error("Your note must be 500 characters or fewer.");
    s.note = note;
}
