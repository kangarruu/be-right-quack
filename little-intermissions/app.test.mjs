import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("./app.mjs", import.meta.url), "utf8");
const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
const settle = () => new Promise((resolve) => setImmediate(resolve));
function harness() {
    const elements = new Map();
    const element = (id) => {
        if (!elements.has(id)) elements.set(id, { hidden: true, textContent: "", disabled: false, listeners: {},
            addEventListener(name, callback) { this.listeners[name] = callback; } });
        return elements.get(id);
    };
    const requests = [];
    const context = vm.createContext({
        document: { hidden: false, getElementById: element, querySelectorAll: () => [] },
        fetch: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
        setInterval: () => {}, Date,
    });
    vm.runInContext('const $ = (id) => document.getElementById(id);\n' + source.slice(source.indexOf("let duckBusy")), context);
    return { element, requests, context };
}
const status = (request, value) => request.resolve({ ok: true, json: async () => value });
test("initial duck status failure offers retry without exposing unsupported controls", async () => {
    const h = harness();
    h.requests[0].reject(new Error("Connection lost"));
    await settle();
    assert.equal(h.element("duck-load-error").hidden, false);
    assert.match(h.element("duck-load-message").textContent, /Connection lost/);
    assert.equal(h.element("desktop").hidden, true);
    assert.match(html, /id="duck-retry"/);
    h.element("duck-retry").listeners.click();
    status(h.requests[1], { supported: true, running: false, sprint: null });
    await settle();
    assert.equal(h.element("duck-load-error").hidden, true);
    assert.equal(h.element("desktop").hidden, false);
});
test("unsupported desktop stays hidden after recovery", async () => {
    const h = harness();
    h.requests[0].reject(new Error("Connection lost"));
    await settle();
    const retry = vm.runInContext("loadDuck()", h.context);
    status(h.requests[1], { supported: false, running: false, sprint: null });
    await retry;
    assert.equal(h.element("desktop").hidden, true);
    assert.equal(h.element("duck-load-error").hidden, true);
});
test("an older failed status read cannot overwrite a newer action", async () => {
    const h = harness();
    vm.runInContext('duckAction("wake", "Waking the duck.")', h.context);
    status(h.requests[1], { supported: true, running: true, started: true, sprint: null });
    await settle();
    h.requests[0].reject(new Error("Old error"));
    await settle();
    assert.equal(h.element("duck-load-error").hidden, true);
    assert.match(h.element("duck-status").textContent, /arrived/);
});
