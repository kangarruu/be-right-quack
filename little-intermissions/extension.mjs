import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";
import { join } from "node:path";
import { startServer, readState } from "./server.mjs";
import { duckStatus, wakeDuck, sendHome, startSprint, stopSprint } from "./duck-control.mjs";

const noInput = { type: "object", properties: {}, additionalProperties: false };
const duckError = (error) => { throw new CanvasError("duck_failed", error.message); };

const servers = new Map();
let session;
function statePath() {
    if (!session?.workspacePath) throw new CanvasError("workspace_missing", "A session workspace is needed to save your playground.");
    return join(session.workspacePath, "little-intermissions.json");
}

session = await joinSession({
    canvases: [createCanvas({
        id: "little-intermissions",
        displayName: "Little intermissions",
        description: "Try three animated break companions: a frog expedition, the Brain Bakery, and a substitute duck. The duck can also wake as a small floating desktop pet that runs focus sprints and nudges you to take breaks.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        actions: [{
            name: "get_state",
            description: "Read this conversation's saved companion choice and break state.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
            handler: () => readState(statePath()),
        }, {
            name: "get_duck_status",
            description: "Report whether the floating desktop duck is running, and the focus sprint it is timing, if any.",
            inputSchema: noInput,
            handler: () => duckStatus(),
        }, {
            name: "wake_duck",
            description: "Start the floating desktop duck, or make a running duck say hello.",
            inputSchema: noInput,
            handler: () => wakeDuck().catch(duckError),
        }, {
            name: "send_duck_home",
            description: "Ask the floating desktop duck to walk off screen and quit.",
            inputSchema: noInput,
            handler: () => sendHome().catch(duckError),
        }, {
            name: "start_focus_sprint",
            description: "Start a focus sprint on the floating desktop duck. The duck stays quiet, shows a countdown beside it, and starts its break flow at zero. A running duck is needed or it is woken.",
            inputSchema: {
                type: "object",
                properties: { minutes: { type: "integer", minimum: 1, maximum: 180 } },
                required: ["minutes"],
                additionalProperties: false,
            },
            handler: ({ input }) => startSprint(input.minutes).catch(duckError),
        }, {
            name: "stop_focus_sprint",
            description: "Cancel the focus sprint that the floating desktop duck is timing.",
            inputSchema: noInput,
            handler: () => stopSprint().catch(duckError),
        }],
        open: async (ctx) => {
            let entry = servers.get(ctx.instanceId);
            if (!entry) {
                entry = await startServer(statePath());
                servers.set(ctx.instanceId, entry);
            }
            return { title: "Little intermissions", url: entry.url };
        },
        onClose: async (ctx) => {
            const entry = servers.get(ctx.instanceId);
            if (entry) {
                servers.delete(ctx.instanceId);
                await new Promise((resolve) => entry.server.close(resolve));
            }
        },
    })],
});
