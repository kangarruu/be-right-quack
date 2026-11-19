# Be Right Quack 🦆

> Reporting for temporary duty.

A tiny duck with a TEMP badge and very strong opinions about taking a break. Wake it on your Mac to time a focus sprint, get a gentle nudge, or let it cover your desk for five minutes. It might even file a report when you get back. The stapler was fine, by the way.

The **Little intermissions** Copilot canvas has three companions. The duck has a canvas version and is the **only** one that can float on your desktop. **Fern the frog** sends you on tiny expeditions, and **Brain Bakery** bakes your break into a keepsake. Fern and the bakery stay inside the canvas.

## Wake the duck

The canvas needs a GitHub Copilot app build that supports canvas extensions. The floating duck needs **macOS 13 or later** and **Swift 5.9 or later**. Check with `swiftc --version`; if the Apple command line tools are missing, run `xcode-select --install`. The canvas does not need Swift. Terminal commands need **Node.js 18 or later** on your PATH. There is no `npm install` step.

Clone this repo and copy the [extension folder](little-intermissions/) into your personal Copilot extensions directory:

```sh
git clone https://github.com/kangarruu/be-right-quack.git
cd be-right-quack
extensions="${COPILOT_HOME:-$HOME/.copilot}/extensions"
mkdir -p "$extensions"
if [ -e "$extensions/little-intermissions" ] || [ -L "$extensions/little-intermissions" ]; then
  printf '%s\n' 'Little intermissions is already installed. Back it up before replacing it.'
else
  cp -R little-intermissions "$extensions/"
fi
```

Reload extensions in Copilot, then ask **"Open Little intermissions."** Select **Duck takes over** and choose **Wake the duck**. Installing or reloading the extension does not start the desktop duck. The first wake compiles it locally and can take a minute. Right-click the duck for settings or to send it home.

## A duck in your terminal

No global `duck` command is installed. Use the script in the installed folder:

```sh
duck_cli="${COPILOT_HOME:-$HOME/.copilot}/extensions/little-intermissions/duck-cli.mjs"
node "$duck_cli" help
node "$duck_cli" wake
node "$duck_cli" sprint 25
node "$duck_cli" status
node "$duck_cli" home
```

Focus sprints accept 1 to 180 whole minutes and default to 25. Use `sprint stop` to cancel or `sprint extend` to add five minutes. Use `nudges off` (or `30`, `50`, `75`, or `90`) and `playfulness calm` (or `lively`) to change saved settings. `snooze` pauses unsolicited quips, wandering, and welcomes for an hour or until the duck quits, without canceling a sprint or its end prompt.

For less serious work, try `cute`, `cover`, `convince`, `nudge`, or `say "The stapler is secure."` The duck uses text bubbles, not audio. Some requests are queued and can be skipped if they don't fit what the duck is doing. The sprite and debate choices use the mouse; VoiceOver operation has not been verified.

## What stays on your Mac

- **Canvas:** Copilot saves your note, companion preferences, break times, report cursors, and up to 24 keepsakes in `little-intermissions.json` in the current conversation's workspace. The native duck does not read that file. Keep it out of Git if it contains private notes.
- **Desktop:** `${COPILOT_HOME:-$HOME/.copilot}/state/little-intermissions/` contains the local binary, settings, sprint state, process records, per-instance control credentials, and logs. Keep it private. Logs are not rotated automatically; compiler diagnostics can include local paths.
- **Privacy and limits:** The extension makes no external network requests and sends no analytics. The canvas uses a token-protected, same-origin loopback server. Native control uses private local files and per-instance authentication. Neither isolates the extension from other software running as your user. The duck reads the OS's time since the last input event; it does not record keys, window contents, screenshots, or work activity. There is no login item. The menu briefly takes focus and tries to return it to the previous app. The duck may appear in screen sharing or recordings.

## Update or uninstall

1. Use `node "$duck_cli" home` or right-click and choose **Send duck home**. Wait for the duck to quit. Reloading extensions does not replace a running native duck. If an older duck does not respond to the CLI, use its menu; do not kill a process based on a saved PID.
2. Move the installed `little-intermissions` folder out of the extensions directory and reload Copilot's extensions. To update, put the new folder in its place before reloading. If you made a terminal shortcut, remove only the link that points to this extension.
3. If you want to delete its saved settings and logs, remove only the extension's state directory after the duck has quit. Canvas notes and keepsakes remain in each conversation's `little-intermissions.json`; remove those separately only if you want to lose them.

## Local checks

Run `cd little-intermissions && node --test *.test.mjs` from the repo root. Tests use temporary state, and the macOS native test compiles a hidden, disposable harness. To type-check against macOS 13 on Apple silicon, run `swiftc -typecheck -swift-version 5 -target arm64-apple-macosx13.0 duck/Duck.swift` from the extension folder (use `x86_64` for Intel).

No license is specified in this repository.
