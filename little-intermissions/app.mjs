import { quests } from "./model.mjs";

const $ = (id) => document.getElementById(id);
let state;
let busy = false;
let requestQueue = Promise.resolve();
const names = { frog: "Little expedition", bakery: "Brain Bakery", duck: "Duck takes over" };
const icons = { frog: "\u{1f343}", bakery: "\u{1f35e}", duck: "\u{1f986}" };
const scenes = {
    frog: `<svg viewBox="0 0 680 300" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="340" cy="180" rx="236" ry="110" fill="#eef1df"/>
      <circle cx="477" cy="81" r="31" fill="#efcf83"/><path d="M473 53q-7 27 19 40" fill="none" stroke="#fff4cc" stroke-width="2"/>
      <g fill="#fffdf6" class="float"><ellipse cx="209" cy="93" rx="41" ry="12"/><ellipse cx="201" cy="85" rx="18" ry="15"/><ellipse cx="222" cy="88" rx="17" ry="12"/></g>
      <path d="M110 225q70-53 164-12t147-13q85-26 149 25v40H110" fill="#dbe4c6"/>
      <ellipse cx="357" cy="250" rx="146" ry="24" fill="#b9d5c9"/><ellipse cx="357" cy="250" rx="108" ry="12" fill="none" stroke="#d7e8dd" stroke-width="2"/>
      <path d="M224 253q24-18 60-7l-21 7 11 8q-28 7-50-8" fill="#799e72"/>
      <g class="sway" stroke="#8da579" stroke-width="4" stroke-linecap="round"><path d="M157 242q-4-46-18-62M162 241q3-31 16-43M511 245q-2-42 9-64M518 244q13-20 21-23" fill="none"/><path d="M139 191v-18M522 190l2-20" stroke="#a57e54" stroke-width="9"/></g>
      <ellipse cx="339" cy="249" rx="62" ry="10" fill="#8da66d" opacity=".22"/>
      <g class="frog">
        <g class="away-only"><rect x="375" y="175" width="36" height="55" rx="12" fill="#b67a49" stroke="#835331" stroke-width="2"/><path d="M383 177q-5-16 12-15" fill="none" stroke="#835331" stroke-width="4"/><path d="M383 200h20" stroke="#e6c19a" stroke-width="2"/></g>
        <g class="breathe"><ellipse cx="340" cy="210" rx="53" ry="37" fill="#8ba969" stroke="#526f43" stroke-width="2.5"/><ellipse cx="340" cy="220" rx="31" ry="24" fill="#cad99a"/>
        <ellipse cx="301" cy="242" rx="23" ry="10" fill="#8ba969" stroke="#526f43" stroke-width="2.5"/><ellipse cx="380" cy="242" rx="23" ry="10" fill="#8ba969" stroke="#526f43" stroke-width="2.5"/>
        <path d="M293 188q-14-29 10-40 23-10 34 15 13-27 35-15 24 11 13 40" fill="#8ba969" stroke="#526f43" stroke-width="2.5"/>
        <ellipse cx="340" cy="188" rx="53" ry="34" fill="#8ba969"/>
        <g class="blink" fill="#334a31"><ellipse cx="311" cy="170" rx="5" ry="7"/><ellipse cx="369" cy="170" rx="5" ry="7"/></g>
        <g fill="#e2a494" opacity=".8"><ellipse cx="301" cy="190" rx="9" ry="5"/><ellipse cx="378" cy="190" rx="9" ry="5"/></g>
        <path d="M324 191q16 15 32 0" fill="none" stroke="#334a31" stroke-width="2.5" stroke-linecap="round"/>
        <g class="away-only"><path d="M297 207q44 13 86-2l-3 10q-44 12-79-1" fill="#e7b94f"/><path d="M369 211l11 26 10-4-7-25" fill="#e7b94f"/></g></g>
      </g>
      <g class="returned-only"><path d="M420 219q18-20 35-13-4 23-35 22" fill="#819951" stroke="#526f43" stroke-width="2"/><path d="M421 229l25-18" stroke="#526f43" stroke-width="2"/></g>
      <g fill="#a97a40"><circle cx="228" cy="169" r="3" class="float"/><path d="M437 150v10m-5-5h10" stroke="#a97a40" stroke-width="2"/></g>
      <text x="340" y="286" text-anchor="middle" fill="#849076" font-family="Georgia,serif" font-size="12" font-style="italic">the outside is still there.</text>
    </svg>`,
    bakery: `<svg viewBox="0 0 680 300" xmlns="http://www.w3.org/2000/svg">
      <rect x="127" y="44" width="426" height="212" rx="65" fill="#f3e9db"/>
      <rect x="203" y="65" width="274" height="177" rx="8" fill="#f8efd9" stroke="#c7ab8e" stroke-width="2"/>
      <path d="M197 67h286l-10 32H207z" fill="#bd7863"/><g fill="#f4d8b8"><path d="M220 67h25l-3 32h-27zM270 67h25l-1 32h-27zM320 67h25v32h-27zM370 67h25l3 32h-27zM420 67h25l6 32h-27z"/></g>
      <rect x="250" y="110" width="180" height="32" rx="4" fill="#fffaf0"/><text x="340" y="132" text-anchor="middle" fill="#9c674b" font-family="Georgia,serif" font-size="18" letter-spacing="3">BRAIN BAKERY</text>
      <rect x="270" y="155" width="140" height="96" rx="15" fill="#ad6b58" stroke="#87513f" stroke-width="2"/>
      <rect x="284" y="177" width="112" height="58" rx="13" fill="#73584b" class="oven-glow"/><path d="M300 166h80" stroke="#e2af82" stroke-width="5" stroke-linecap="round"/>
      <g fill="#e7c393"><circle cx="287" cy="165" r="4"/><circle cx="393" cy="165" r="4"/></g>
      <path d="M174 253h332" stroke="#c7ab8e" stroke-width="7" stroke-linecap="round"/>
      <g class="loaf"><ellipse cx="341" cy="231" rx="53" ry="7" fill="#674b35" opacity=".15"/><path d="M297 222q-3-47 44-48 46 2 44 48z" fill="#e7b976" stroke="#b37c44" stroke-width="2.5"/>
      <g stroke="#f8dc9c" stroke-width="5" stroke-linecap="round"><path d="M321 185l-7 17M342 181l-7 19M364 187l-7 16"/></g>
      <g class="blink" fill="#674b35"><circle cx="326" cy="213" r="2.5"/><circle cx="357" cy="213" r="2.5"/></g><path d="M337 217q5 5 10 0" fill="none" stroke="#674b35" stroke-width="2"/></g>
      <g fill="none" stroke="#bc9676" stroke-width="3" stroke-linecap="round">
      <path class="steam" d="M319 168q-10-10 0-19t0-17"/><path class="steam" d="M342 165q-10-10 0-19t0-17"/><path class="steam" d="M365 168q-10-10 0-19t0-17"/></g>
      <g class="sway"><path d="M214 247v-39m0 14-13-14m13 24 14-16" stroke="#8c9a6e" stroke-width="3" fill="none"/><ellipse cx="200" cy="206" rx="5" ry="10" transform="rotate(-30 200 206)" fill="#8c9a6e"/><ellipse cx="227" cy="214" rx="5" ry="10" transform="rotate(30 227 214)" fill="#8c9a6e"/></g>
      <path d="M454 230v-22h-16v22q0 11 8 11t8-11m0-16q17 0 11 12h-11" fill="#e6d6ba" stroke="#b79a78" stroke-width="2"/>
      <g class="returned-only" fill="#ba824c"><path d="M245 154v12m-6-6h12M445 166v12m-6-6h12" stroke="#ba824c" stroke-width="2"/><circle cx="235" cy="186" r="3"/><circle cx="454" cy="145" r="3"/></g>
      <text x="340" y="286" text-anchor="middle" fill="#a0846b" font-family="Georgia,serif" font-size="12" font-style="italic">some things get better when left alone.</text>
    </svg>`,
    duck: `<svg viewBox="0 0 680 300" xmlns="http://www.w3.org/2000/svg">
      <rect x="128" y="44" width="424" height="213" rx="65" fill="#e9edf0"/>
      <rect x="424" y="77" width="66" height="79" rx="4" fill="#f8fbf6" stroke="#b8c5c9" stroke-width="3"/><path d="M456 79v75m-30-38h62" stroke="#b8c5c9" stroke-width="3"/><circle cx="468" cy="98" r="10" fill="#ecd7a2"/>
      <path d="M175 240h332" stroke="#a79680" stroke-width="8" stroke-linecap="round"/><path d="M194 244v22m294-22v22" stroke="#a79680" stroke-width="6"/>
      <rect x="245" y="146" width="120" height="80" rx="8" fill="#80939c" stroke="#5d727d" stroke-width="3"/><rect x="254" y="155" width="102" height="61" rx="3" fill="#d2dfd8"/>
      <path d="M267 172h38m-38 10h71m-71 10h51" stroke="#96b1a3" stroke-width="3" stroke-linecap="round"/>
      <path d="M288 226v12m-15 0h44" stroke="#5d727d" stroke-width="5" stroke-linecap="round"/>
      <g class="breathe"><path d="M378 210q-19-24-2-49-16-26 4-41 22-18 43-1 14 15 2 34 31 12 33 42 18 2 27-6-1 27-28 37-45 18-79-16" fill="#f3d880" stroke="#ba9b57" stroke-width="2.5"/>
      <path d="M378 137q-29-1-26 10 6 9 28 1" fill="#d98f51" stroke="#b87b42" stroke-width="2"/>
      <circle cx="396" cy="133" r="4" fill="#3c4849" class="blink"/>
      <ellipse cx="412" cy="149" rx="8" ry="5" fill="#e4b98e"/>
      <path class="duck-wing" d="M418 184q-27-13-44 20 20 7 38-1" fill="#edc66c" stroke="#ba9b57" stroke-width="2"/>
      <g class="away-only"><circle cx="392" cy="134" r="12" fill="none" stroke="#495862" stroke-width="3"/><path d="M404 130l16 4m-40-5-9 3" stroke="#495862" stroke-width="3"/><rect x="416" y="205" width="25" height="15" rx="2" fill="#faf7e9" transform="rotate(-10 416 205)"/><text x="429" y="215" text-anchor="middle" fill="#62737c" font-family="monospace" font-size="7" transform="rotate(-10 429 215)">TEMP</text></g></g>
      <rect x="240" y="231" width="117" height="7" rx="3" fill="#c1cbca"/>
      <path d="M210 219v-18h20v18q0 12-10 12t-10-12m20-14q15-1 11 11h-11" fill="#c8a9a0" stroke="#a08077" stroke-width="2"/><path class="steam" d="M220 195q-7-8 0-17" stroke="#b0a5a0" stroke-width="2" fill="none"/>
      <g class="returned-only"><rect x="343" y="92" width="56" height="30" rx="5" fill="#fffdf6"/><path d="M370 120l7 10 4-10" fill="#fffdf6"/><text x="371" y="112" text-anchor="middle" font-family="Georgia,serif" font-size="12" fill="#617580">quack.</text></g>
      <g class="float"><path d="M191 103v12m-6-6h12" stroke="#b1bbc0" stroke-width="2"/></g>
      <text x="340" y="286" text-anchor="middle" fill="#859198" font-family="Georgia,serif" font-size="12" font-style="italic">absolutely unqualified. completely available.</text>
    </svg>`,
};
const copy = {
    frog: {
        chapter: "01 / A LITTLE EXPEDITION", kicker: "MEET FERN. VERY SMALL. BIG PLANS.",
        title: "The world is bigger than this tab.",
        speech: '"I packed a bag. It contains nothing useful. Let\'s go."',
        detail: "Borrow a little curiosity. There is no problem to solve outside.",
        button: "Let's go on a little walk",
        awayTitle: "We're inspecting the outside.", awayKicker: "AN EXPEDITION OF NO PARTICULAR IMPORTANCE",
        returnedTitle: "Look what we brought back.", returnedKicker: "A HIGHLY SUCCESSFUL LITTLE NOTHING",
    },
    bakery: {
        chapter: "02 / THE BRAIN BAKERY", kicker: "FRESH IDEAS NOT GUARANTEED. BREAD, YES.",
        title: "This problem needs to prove.",
        speech: '"So do you. Leave it here. I\'ll keep the oven warm."',
        detail: "You are not abandoning the problem. Just giving it somewhere to wait.",
        button: "Put it in the oven",
        awayTitle: "Nothing to do but let it rest.", awayKicker: "THE BAKERY IS TAKING CARE OF THINGS",
        returnedTitle: "A little warmer. A little softer.", returnedKicker: "WELCOME BACK TO THE BAKERY",
    },
    duck: {
        chapter: "03 / YOUR TEMPORARY REPLACEMENT", kicker: "REFERENCES AVAILABLE. ALL FROM OTHER DUCKS.",
        title: "Someone else can sit here.",
        speech: '"I have absolutely no qualifications. Leave it with me."',
        detail: "A ceremonial handover. Duck cannot see, change, or do any of your work.",
        button: "Hand over to Duck",
        awayTitle: "Your desk is in very small wings.", awayKicker: "PLEASE DO NOT DISTURB THE PROFESSIONAL",
        returnedTitle: "Duck has prepared a report.", returnedKicker: "AN EXCEPTIONAL PERIOD OF DOING NOTHING",
    },
};

async function load() {
    try {
        const response = await fetch("state");
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        state = data;
        render();
    } catch (error) { showError(error); }
}
function showError(error) {
    $("error").hidden = false;
    $("error").textContent = error.message || "The playground could not be loaded. Please reopen it.";
}
function send(command) {
    requestQueue = requestQueue.then(async () => {
        const noteOnly = command.action === "note";
        if (!noteOnly) {
            busy = true;
            setBusy();
        }
        try {
            const response = await fetch("command", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(command) });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);
            state = data;
            $("error").hidden = true;
        } catch (error) { showError(error); }
        finally {
            if (!noteOnly) {
                busy = false;
                if (state) render();
            }
        }
    });
    return requestQueue;
}
function setBusy() {
    $("companion").setAttribute("aria-busy", String(busy));
    $("primary").disabled = busy || !state;
    $("secondary").disabled = busy;
    $("favorite").disabled = busy || !state;
    document.querySelectorAll("[data-mode][role=tab]").forEach((tab) => { tab.disabled = busy || !!state?.active; });
}
function render() {
    const mode = state.selected;
    const c = copy[mode];
    const phase = state.active ? "away" : state.result ? "returned" : "idle";
    $("companion").dataset.mode = mode;
    $("companion").dataset.phase = phase;
    $("companion").setAttribute("aria-labelledby", `tab-${mode}`);
    document.querySelectorAll("[role=tab]").forEach((tab) => {
        tab.setAttribute("aria-selected", String(tab.dataset.mode === mode));
        tab.tabIndex = tab.dataset.mode === mode ? 0 : -1;
    });
    if ($("scene").dataset.mode !== mode) {
        $("scene").innerHTML = scenes[mode];
        $("scene").dataset.mode = mode;
    }
    $("chapter").textContent = c.chapter;
    $("favorite").textContent = state.favorite === mode ? "\u2665 Your pick" : "\u2661 Pick this one";
    $("favorite").setAttribute("aria-pressed", String(state.favorite === mode));
    $("note-wrap").hidden = mode !== "bakery" || phase !== "idle";
    if (document.activeElement !== $("note")) $("note").value = state.note;
    $("return-note").hidden = !(mode === "bakery" && phase === "returned" && state.note);
    $("saved-note").textContent = state.note;
    $("timer-wrap").hidden = phase !== "away";
    $("demo-wrap").hidden = phase === "away";
    $("away-help").hidden = phase !== "away";
    $("secondary").hidden = phase !== "away";
    if (phase === "idle") {
        $("kicker").textContent = c.kicker;
        $("title").textContent = c.title;
        $("speech").textContent = c.speech;
        $("detail").textContent = c.detail;
        $("primary").textContent = c.button;
    } else if (phase === "away") {
        $("kicker").textContent = state.active.demo ? "QUICK PEEK / NOT A REAL BREAK" : c.awayKicker;
        $("title").textContent = c.awayTitle;
        $("speech").textContent = mode === "frog" ? quests[state.active.index % quests.length]
            : mode === "bakery" ? '"No peeking necessary. The dough has this covered."'
            : '"You may close your laptop. I have located the space bar."';
        $("detail").textContent = state.active.demo ? "An eight-second preview of what your return could feel like."
            : "Step away from the screen. Come back when you're ready, even if that's sooner.";
        $("primary").textContent = state.active.demo ? "Skip to the ending" : "I'm back";
        $("away-help").textContent = state.active.demo ? "Demo time is pretend. Your choice and notes are real."
            : "No sound, notifications, or activity tracking. It's safe to close this panel.";
    } else {
        $("kicker").textContent = state.result.demo ? "A PREVIEW OF YOUR RETURN" : c.returnedKicker;
        $("title").textContent = c.returnedTitle;
        $("speech").textContent = state.result.title;
        $("detail").textContent = state.result.demo ? "That was a quick peek. Try another companion, or switch it off for a five-minute break."
            : mode === "duck" ? "Your work is untouched. Duck is proud of the contribution."
            : "No need to come back transformed. Coming back is enough.";
        $("primary").textContent = "Another little intermission";
    }
    const list = document.createElement("ul");
    list.className = "keepsake-list";
    for (const item of state.keepsakes.slice(-6)) {
        const li = document.createElement("li");
        li.textContent = `${icons[item.mode]} ${item.title}`;
        list.append(li);
    }
    if (list.childElementCount) $("keepsakes").replaceChildren(list);
    else {
        const p = document.createElement("p");
        p.className = "empty";
        p.textContent = "Take a real break when you feel like it. A little something will be waiting here.";
        $("keepsakes").replaceChildren(p);
    }
    setBusy();
    updateDemoHelp();
    tick();
}
function updateDemoHelp() {
    $("demo-help").textContent = $("demo").checked ? "A tiny preview. No real break or keepsake recorded." : "A five-minute invitation. You can return early. No proof required.";
}
function tick() {
    if (!state?.active) return;
    const remaining = Math.max(0, Math.ceil((state.active.endsAt - Date.now()) / 1000));
    $("timer").textContent = remaining ? `${state.active.demo ? "Preview" : "A little space"} \u00b7 ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
        : "Take all the time you need.";
    if (remaining === 0 && state.active.demo && !busy) send({ action:"finish", startedAt:state.active.startedAt });
}
$("primary").addEventListener("click", () => {
    if (!state || busy) return;
    if (state.active) send({ action:"finish", startedAt:state.active.startedAt });
    else if (state.result) send({ action:"cancel" });
    else send({ action:"start", demo:$("demo").checked, note:$("note").value });
});
$("secondary").addEventListener("click", () => send({ action:"cancel" }));
$("favorite").addEventListener("click", () => send({ action:"favorite" }));
$("note").addEventListener("change", () => send({ action:"note", note:$("note").value }));
$("demo").addEventListener("change", updateDemoHelp);
const tabs = [...document.querySelectorAll("[role=tab]")];
for (const tab of tabs) {
    tab.addEventListener("click", () => send({ action:"select", mode:tab.dataset.mode }));
    tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft","ArrowRight","Home","End"].includes(event.key) || state?.active || busy) return;
        event.preventDefault();
        let index = tabs.indexOf(tab);
        index = event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3;
        tabs[index].focus();
        tabs[index].click();
    });
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && !busy) { load(); loadDuck(); } });
setInterval(tick, 250);
load();

let duckBusy = false;
let duckState = { supported:true, running:false, sprint:null };
let duckNote = { text:"", until:0 };
const minutesText = (count) => `${count} ${count === 1 ? "minute" : "minutes"}`;
// Same look as the clock beside the duck: mm:ss, or h:mm:ss from an hour up.
function clockText(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const two = (value) => String(value).padStart(2, "0");
    const hours = Math.floor(total / 3600);
    return `${hours ? `${hours}:${two(Math.floor(total / 60) % 60)}` : two(Math.floor(total / 60))}:${two(total % 60)}`;
}
// The readout comes from the end time, not from counting ticks, so it never drifts.
function paintSprint() {
    const { sprint } = duckState;
    const live = Boolean(sprint) && sprint.endsAt > Date.now();
    $("sprint-start").hidden = live;
    $("sprint-live").hidden = !live;
    if (!live) return;
    const text = clockText(sprint.endsAt - Date.now());
    if ($("sprint-clock").textContent !== text) $("sprint-clock").textContent = text;
}
function lockDuck() {
    for (const button of document.querySelectorAll("#desktop button")) button.disabled = duckBusy || Boolean(duckState.controlError);
}
function renderDuck(status, message = "") {
    duckState = status;
    if (message) duckNote = { text:message, until:Date.now() + 8000 };
    $("desktop").hidden = !status.supported;
    $("duck-load-error").hidden = !status.controlError;
    $("duck-load-message").textContent = status.controlError || "";
    $("duck-wake").textContent = status.running ? "Say hello" : "Wake the duck";
    $("duck-home").hidden = !status.running;
    lockDuck();
    $("duck-status").textContent = Date.now() < duckNote.until ? duckNote.text
        : status.controlError ? "The duck could not be connected."
        : status.stopping ? "The duck is stopping."
        : status.running ? "The duck is on your desktop." : "The duck is at home.";
    paintSprint();
}
async function duckRequest(method, action, extra) {
    const response = await fetch("duck", method === "GET" ? undefined : { method, headers:{"Content-Type":"application/json"}, body:JSON.stringify({ action, ...extra }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    return data;
}
// A status that was asked for before an action began, or while it ran, is older than the action's own answer.
let duckTicket = 0;
async function loadDuck() {
    if (duckBusy) return;
    const ticket = ++duckTicket;
    try {
        const status = await duckRequest("GET");
        if (ticket === duckTicket) renderDuck(status);
    } catch (error) {
        if (ticket !== duckTicket) return;
        $("duck-load-error").hidden = false;
        $("duck-load-message").textContent = `Could not check desktop duck availability. ${error.message || "Try again."}`;
    }
}
function duckMessage(action, result) {
    if (action === "home") return "The duck is at home.";
    if (action === "sprint") {
        return result.accepted
            ? `Focus sprint started: ${minutesText(result.requested)}. The duck will keep quiet.`
            : "The duck is busy. The sprint starts when it is free.";
    }
    if (action === "sprint_stop") {
        if (result.stopped) return "The focus sprint is cancelled.";
        return result.wasRunning ? "The duck did not stop the sprint. Try again." : "No focus sprint is running.";
    }
    return result.started ? "The duck has arrived. Look near the bottom of your screen."
        : result.greeted ? "The duck says hello." : "The duck is already on duty.";
}
async function duckAction(action, working, extra) {
    if (duckBusy) return;
    duckBusy = true;
    duckTicket += 1;
    lockDuck();
    $("duck-status").textContent = working;
    try {
        const result = await duckRequest("POST", action, extra);
        duckBusy = false;
        duckTicket += 1;
        renderDuck(result, duckMessage(action, result));
    } catch (error) {
        duckBusy = false;
        duckTicket += 1;
        renderDuck(duckState, error.message);
        loadDuck();
    }
}
$("duck-wake").addEventListener("click", () => duckAction("wake", "Waking the duck. The first time can take a few seconds."));
$("duck-retry").addEventListener("click", () => loadDuck());
$("duck-home").addEventListener("click", () => duckAction("home", "Sending the duck home."));
$("sprint-cancel").addEventListener("click", () => duckAction("sprint_stop", "Cancelling the sprint."));
for (const button of document.querySelectorAll(".preset")) {
    const minutes = Number(button.dataset.minutes);
    button.addEventListener("click", () => duckAction("sprint", `Starting a ${minutes}-minute focus sprint.`, { minutes }));
}
setInterval(paintSprint, 250);
// While the duck runs, look again every few seconds so a sprint begun or cancelled from the duck's menu or a terminal shows up here.
setInterval(() => { if (!document.hidden && !duckBusy && duckState.running) loadDuck(); }, 5000);
loadDuck();
