import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { initialState, transition, validState } from "./model.mjs";
import { duckStatus, wakeDuck, sendHome, startSprint, stopSprint } from "./duck-control.mjs";

const httpError = (status, message) => Object.assign(new Error(message), { status });
async function readJson(req) {
    if (req.headers["content-type"] !== "application/json") throw httpError(415, "JSON is required.");
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 8192) throw httpError(413, "That request is too large.");
        chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw httpError(400, "The request was not valid JSON."); }
}

const queues = new Map();
export async function readState(path) {
    let text;
    try { text = await readFile(path, "utf8"); }
    catch (error) {
        if (error.code === "ENOENT") return initialState();
        throw error;
    }
    const state = JSON.parse(text);
    if (!validState(state)) throw new Error("Saved playground data is invalid. It has not been overwritten.");
    return state;
}
function update(path, command) {
    const prior = queues.get(path) ?? Promise.resolve();
    const next = prior.then(async () => {
        const state = transition(await readState(path), command);
        await mkdir(dirname(path), { recursive: true });
        const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
        await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
        await rename(temporary, path);
        return state;
    });
    // Keep later requests usable after an error; the caller still receives the rejected operation.
    queues.set(path, next.then(() => undefined, () => undefined));
    return next;
}
export async function startServer(path) {
    await readState(path);
    const token = randomBytes(24).toString("hex");
    const prefix = `/${token}/`;
    const assets = new Map([
        ["", ["index.html", "text/html; charset=utf-8"]],
        ["style.css", ["style.css", "text/css; charset=utf-8"]],
        ["app.mjs", ["app.mjs", "text/javascript; charset=utf-8"]],
        ["model.mjs", ["model.mjs", "text/javascript; charset=utf-8"]],
    ]);
    let origin;
    const server = createServer(async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'");
        const json = (code, value) => {
            res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify(value));
        };
        try {
            if (`http://${req.headers.host}` !== origin || (req.headers.origin && req.headers.origin !== origin)) {
                return json(403, { error: "This playground accepts local, same-origin requests only." });
            }
            const pathname = new URL(req.url, origin).pathname;
            if (!pathname.startsWith(prefix)) return json(404, { error: "Not found." });
            const route = pathname.slice(prefix.length);
            if (req.method === "GET" && assets.has(route)) {
                const [file, type] = assets.get(route);
                const content = await readFile(new URL(file, import.meta.url));
                res.writeHead(200, { "Content-Type": type });
                return res.end(content);
            }
            if (req.method === "GET" && route === "state") return json(200, await readState(path));
            if (req.method === "GET" && route === "duck") return json(200, await duckStatus());
            if (req.method === "POST" && route === "duck") {
                const command = await readJson(req);
                const actions = { wake: wakeDuck, home: sendHome, sprint: ({ minutes }) => startSprint(minutes), sprint_stop: stopSprint };
                if (!Object.hasOwn(actions, command?.action)) return json(400, { error: "That duck action is not available." });
                try { return json(200, await actions[command.action](command)); }
                catch (error) {
                    console.error("Duck control failed:", error);
                    return json(400, { error: error.message });
                }
            }
            if (req.method === "POST" && route === "command") {
                const command = await readJson(req);
                try { return json(200, await update(path, command)); }
                catch (error) {
                    console.error("Playground update failed:", error);
                    return json(400, { error: error.message });
                }
            }
            json(404, { error: "Not found." });
        } catch (error) {
            if (error.status) return json(error.status, { error: error.message });
            console.error("Playground request failed:", error);
            json(500, { error: "Could not load or save your playground. Your existing data has not been reset." });
        }
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;
    return { server, url: origin + prefix };
}
