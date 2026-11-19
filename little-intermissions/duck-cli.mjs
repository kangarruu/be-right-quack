#!/usr/bin/env node
// Terminal control for the floating duck. See README.md for optional command installation.
import { duckStatus, sayText, sendCommand, sendHome, sprintMinutes, startSprint, stopSprint, wakeDuck } from "./duck-control.mjs";

const usage = `Usage: duck [command]

  wake              Wake the duck, or make it say hello (default)
  home              Send the duck home
  status            Show whether the duck is on duty
  sprint [minutes]  Start a focus sprint (default 25, up to 180)
  sprint stop       Cancel the focus sprint
  sprint extend     Add five minutes to the focus sprint
  nudges <setting>  Break nudges: off, 30, 50, 75 or 90 minutes
  snooze            Quiet for one hour (keeps a focus sprint)
  playfulness <mode>  calm or lively
  cute              Ask for a cute action
  cover             Ask the duck to cover your desk
  convince          Ask the duck to convince you to take a break
  nudge             Ask the duck for a break nudge
  say <text>        Ask the duck to say a short line`;

class UsageError extends Error {}

const none = (args) => {
    if (args.length) throw new UsageError();
};

const argument = (parse, value) => {
    try { return parse(value); } catch (error) { throw new UsageError(error.message); }
};

const onDuty = (started) => (started ? "The duck is on duty. " : "");

// The duck takes a command on its next tick and ignores it when it does not fit what the duck is doing,
// so these report that the duck was asked, not that it has done the thing.
async function ask(command, message, { quietInSprint = false } = {}) {
    if (quietInSprint && (await duckStatus()).sprint) {
        return "The duck stays quiet during a focus sprint. Run `duck sprint stop` first.";
    }
    const { started } = await sendCommand(command);
    return `${onDuty(started)}${message}`;
}

const minutesLeft = ({ endsAt }) => Math.max(1, Math.ceil((endsAt - Date.now()) / 60000));

const commands = {
    async wake(args) {
        none(args);
        const { started, greeted } = await wakeDuck();
        return started ? "The duck is on duty." : greeted ? "The duck says hello." : "The duck is already on duty.";
    },
    async home(args) {
        none(args);
        if (!(await duckStatus()).running) return "The duck is already at home.";
        await sendHome();
        return "The duck is at home.";
    },
    async status(args) {
        none(args);
        const { running, sprint, stopping, settings, snoozeUntil } = await duckStatus();
        if (!running) return "The duck is at home.";
        if (stopping) return "The duck is stopping.";
        const summary = sprint ? `The duck is on duty. Focus sprint: ${minutesLeft(sprint)} min left.` : "The duck is on duty.";
        return `${summary}\nBreak nudges: ${settings.nudgeEveryMinutes || "off"}. Playfulness: ${settings.playfulness}.${snoozeUntil > Date.now() ? "\nQuiet until " + new Date(snoozeUntil).toLocaleTimeString() + "." : ""}`;
    },
    async sprint(args) {
        if (args[0] === "extend") {
            none(args.slice(1));
            if (!(await duckStatus()).sprint) return "No focus sprint is running.";
            return ask({ cmd: "sprint-extend" }, "Asked the duck to add five minutes.");
        }
        if (args[0] === "stop") {
            none(args.slice(1));
            const { wasRunning, stopped } = await stopSprint();
            if (!wasRunning) return "No focus sprint is running.";
            if (!stopped) throw new Error("The duck did not stop the sprint. Try again.");
            return "The focus sprint is cancelled.";
        }
        if (args.length > 1) throw new UsageError();
        const minutes = args.length ? argument(sprintMinutes, args[0]) : 25;
        const { started, accepted } = await startSprint(minutes);
        if (!accepted) return `${onDuty(started)}The duck is busy. The sprint starts when it is free.`;
        return `${onDuty(started)}Focus sprint started: ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
    },
    async cover(args) {
        none(args);
        return ask({ cmd: "cover" }, "Asked the duck to cover your desk.");
    },
    async nudges(args) {
        if (args.length !== 1 || !["off", "30", "50", "75", "90"].includes(args[0])) throw new UsageError("Choose off, 30, 50, 75 or 90.");
        return ask({ cmd: "nudges", minutes: args[0] === "off" ? 0 : Number(args[0]) }, `Break nudges: ${args[0]}.`);
    },
    async snooze(args) {
        none(args);
        return ask({ cmd: "snooze" }, "Quiet for one hour. An active focus sprint still ends normally.");
    },
    async playfulness(args) {
        if (args.length !== 1 || !["calm", "lively"].includes(args[0])) throw new UsageError("Choose calm or lively.");
        return ask({ cmd: "playfulness", value: args[0] }, `Playfulness: ${args[0]}.`);
    },
    async cute(args) {
        none(args);
        return ask({ cmd: "cute" }, "Asked the duck to do something cute.");
    },
    async convince(args) {
        none(args);
        return ask({ cmd: "convince" }, "Asked the duck to convince you.");
    },
    async nudge(args) {
        none(args);
        return ask({ cmd: "nudge" }, "Asked the duck to give a break nudge.", { quietInSprint: true });
    },
    async say(args) {
        const text = argument(sayText, args.join(" "));
        return ask({ cmd: "say", text }, "Asked the duck to say it.", { quietInSprint: true });
    },
};

const [name = "wake", ...rest] = process.argv.slice(2);
if (["-h", "--help", "help"].includes(name)) {
    console.log(usage);
} else if (!Object.hasOwn(commands, name)) {
    console.error(usage);
    process.exitCode = 2;
} else {
    try {
        const status = await duckStatus();
        if (!status.supported) throw new Error("The floating duck needs macOS 13 or later.");
        if (status.controlError) throw new Error(status.controlError);
        console.log(await commands[name](rest));
    } catch (error) {
        if (error instanceof UsageError) {
            console.error(error.message ? `${error.message}\n${usage}` : usage);
            process.exitCode = 2;
        } else {
            console.error(error.message);
            process.exitCode = 1;
        }
    }
}
