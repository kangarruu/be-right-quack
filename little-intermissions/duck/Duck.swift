import AppKit
import Foundation
import WebKit

// A small floating duck. It reads only "seconds since the last input event" (no keys, no content,
// no permissions), takes focus only for its menu, and never makes sound.
//
// Everything the duck says and every pose it takes lives in the sprite page (sprite.html, voice.js,
// lines.js). This file decides WHEN: it keeps the timers, the modes, and the mouse.

let windowWidth: CGFloat = 280
let windowHeight: CGFloat = 290
let footInset: CGFloat = 11
let duckRect = NSRect(x: 96, y: 6, width: 96, height: 100)

struct Settings: Codable {
    var nudgeEveryMinutes = 50
    var playfulness = "calm"

    init() {}

    enum CodingKeys: String, CodingKey { case nudgeEveryMinutes, playfulness }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        nudgeEveryMinutes = try c.decodeIfPresent(Int.self, forKey: .nudgeEveryMinutes) ?? 50
        playfulness = try c.decodeIfPresent(String.self, forKey: .playfulness) ?? "calm"
    }
}

struct Bag<T: Equatable> {
    private let items: [T]
    private var pool: [T] = []
    private var last: T?

    init(_ items: [T]) { self.items = items }

    mutating func next() -> T {
        if pool.isEmpty {
            pool = items.shuffled()
            if items.count > 1, pool.last == last { pool.swapAt(0, pool.count - 1) }
        }
        let value = pool.removeLast()
        last = value
        return value
    }
}

enum Cute: CaseIterable { case waddle, preen, look, hop, quip, yawn, wiggle, sneeze, spin, bow }

// A button inside the duck's speech bubble. The page measures it; this file hit-tests it, because the
// native view takes every mouse event and the page never sees a click.
struct Chip {
    let id: String
    let rect: NSRect
}

final class DuckPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

// The web view only draws. It never takes a mouse event, so WebKit's own gesture handling cannot
// interfere with a click, a drag or the menu.
final class DuckWebView: WKWebView {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

// A plain, transparent view on top of the web view. It takes every mouse event for the duck.
final class DuckHitView: NSView {
    weak var owner: DuckController?

    override func hitTest(_ point: NSPoint) -> NSView? { frame.contains(point) ? self : nil }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) {
        if event.modifierFlags.contains(.control) {
            owner?.showMenu(with: event, in: self)
        } else {
            owner?.mouseDown()
        }
    }
    override func mouseDragged(with event: NSEvent) { owner?.mouseDragged() }
    override func mouseUp(with event: NSEvent) { owner?.mouseUp() }
    override func rightMouseDown(with event: NSEvent) { owner?.showMenu(with: event, in: self) }
    override func menu(for event: NSEvent) -> NSMenu? { nil }
}

final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: DuckController?
    init(_ target: DuckController) { self.target = target }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.receive(message.body)
    }
}

final class DuckController: NSObject, WKNavigationDelegate, NSMenuDelegate {
    enum Mode { case nap, nudging, onDuty, reporting, debating, sprinting, leaving }
    enum Move { case rest, walking, dragging, falling }

    let stateDir: URL
    let spriteURL: URL
    let snapshotPath: String?
    let nudgeSecondsOverride: Double?
    let lullSeconds: Double
    let idleFile: String?
    let testHooks: Bool
    var settings = Settings()

    let panel: DuckPanel
    let web: DuckWebView
    let hit: DuckHitView
    var ready = false
    // While the right-click menu is open, the duck holds still: no click-through changes, no
    // brain actions and no movement, so nothing can close the menu under the cursor.
    var menuOpen = false
    var menuOpenedAt = Date()
    weak var openMenu: NSMenu?
    var focusBeforeMenu: NSRunningApplication?

    var mode = Mode.nap
    var move = Move.rest
    var gen = 0
    var busy = false

    var motion: Timer?
    var lastTick = Date()
    var walkTarget: CGFloat?
    var walkSpeed: CGFloat = 46
    var walkDone: (() -> Void)?
    var vy: CGFloat = 0

    var dragStartMouse = NSPoint.zero
    var dragStartOrigin = NSPoint.zero
    var pressing = false
    var dragging = false
    var bubbleRect: NSRect?

    var activeSince: Date?
    var awayStart: Date?
    var sleepStart: Date?
    var snoozeUntil = Date.distantPast
    var ignoredStreak = 0
    var roleDeadline = Date.distantFuture
    var nudgeIsSprintEnd = false
    var dutyStart = Date()
    var leftDuringDuty = false
    var nextGagAt = Date.distantFuture
    var lastWelcome = Date.distantPast
    var nextCuteAt = Date()

    var debateDeadline = Date.distantFuture
    var sprintEndsAt: Date?
    var sprintStartedAt = Date()
    var sprintMinutes = 0.0

    var chips: [Chip] = []
    var hoverChip: String?
    var pressChip: String?

    var cuteBag = Bag(Cute.allCases)
    let controlInstance = UUID().uuidString.lowercased()
    let controlToken = (UUID().uuidString + UUID().uuidString).replacingOccurrences(of: "-", with: "").lowercased()

    var settingsURL: URL { stateDir.appendingPathComponent("duck-settings.json") }
    var pidURL: URL { stateDir.appendingPathComponent("duck.pid") }
    var sprintURL: URL { stateDir.appendingPathComponent("sprint.json") }
    var inboxURL: URL { stateDir.appendingPathComponent("inbox") }
    var controlInboxURL: URL { stateDir.appendingPathComponent("control-inbox") }
    var controlRepliesURL: URL { stateDir.appendingPathComponent("control-replies") }

    init(stateDir: URL, spriteURL: URL, snapshotPath: String?, nudgeSeconds: Double?, lullSeconds: Double, idleFile: String?, testHooks: Bool) {
        self.stateDir = stateDir
        self.spriteURL = spriteURL
        self.snapshotPath = snapshotPath
        self.nudgeSecondsOverride = nudgeSeconds
        self.lullSeconds = lullSeconds
        self.idleFile = idleFile
        self.testHooks = testHooks

        let frame = NSRect(x: 0, y: 0, width: windowWidth, height: windowHeight)
        panel = DuckPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        let config = WKWebViewConfiguration()
        web = DuckWebView(frame: frame, configuration: config)
        hit = DuckHitView(frame: frame)
        super.init()

        config.userContentController.add(WeakHandler(self), name: "duck")
        hit.owner = self
        web.navigationDelegate = self
        if web.responds(to: NSSelectorFromString("_setDrawsBackground:")) {
            web.setValue(false, forKey: "drawsBackground")
        }
        if #available(macOS 12.0, *) { web.underPageBackgroundColor = .clear }

        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        panel.hidesOnDeactivate = false
        panel.isMovable = false
        panel.isReleasedWhenClosed = false
        panel.ignoresMouseEvents = true
        let content = NSView(frame: frame)
        web.autoresizingMask = [.width, .height]
        hit.autoresizingMask = [.width, .height]
        content.addSubview(web)
        content.addSubview(hit)
        panel.contentView = content

        loadSettings()
    }

    func start() {
        do {
            try startControl()
        } catch {
            note("control startup failed: \(error)")
            exit(1)
        }
        web.loadFileURL(spriteURL, allowingReadAccessTo: spriteURL.deletingLastPathComponent())
        try? String(getpid()).write(to: pidURL, atomically: true, encoding: .utf8)
        try? FileManager.default.removeItem(at: sprintURL)
        prepareInbox()

        schedule(1.0) { [weak self] in self?.brain() }
        schedule(0.1) { [weak self] in self?.pollControl() }
        schedule(1.0 / 20.0) { [weak self] in self?.updateClickThrough() }

        let nc = NSWorkspace.shared.notificationCenter
        nc.addObserver(self, selector: #selector(willSleep), name: NSWorkspace.willSleepNotification, object: nil)
        nc.addObserver(self, selector: #selector(didWake), name: NSWorkspace.didWakeNotification, object: nil)
        nc.addObserver(self, selector: #selector(spaceChanged), name: NSWorkspace.activeSpaceDidChangeNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged),
                                               name: NSApplication.didChangeScreenParametersNotification, object: nil)
    }

    func schedule(_ interval: TimeInterval, _ block: @escaping () -> Void) {
        let timer = Timer(timeInterval: interval, repeats: true) { _ in block() }
        RunLoop.main.add(timer, forMode: .common)
    }

    // MARK: Web bridge

    func js(_ script: String) {
        web.evaluateJavaScript(script) { _, error in
            if let error { FileHandle.standardError.write(Data("js: \(error)\n".utf8)) }
        }
    }

    func literal(_ text: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [text]),
              let json = String(data: data, encoding: .utf8) else { return "\"\"" }
        return String(json.dropFirst().dropLast())
    }

    func visibleRange() -> (min: Int, max: Int) {
        let visible = currentScreen().visibleFrame
        return (Int(visible.minX - panel.frame.minX), Int(visible.maxX - panel.frame.minX))
    }

    // Asks the page's voice for a line and shows it. done gets how long the bubble stays, in ms;
    // 0 means the bubble is sticky or the voice had nothing to say. done is dropped if anything
    // interrupted the sequence in the meantime.
    func cue(_ kind: String, _ options: [String: Any] = [:], done: ((Int) -> Void)? = nil) {
        let range = visibleRange()
        var payload = options
        payload["minX"] = range.min
        payload["maxX"] = range.max
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        let g = gen
        web.evaluateJavaScript("duck.cue(\(literal(kind)), \(json))") { [weak self] result, error in
            if let error { FileHandle.standardError.write(Data("js: \(error)\n".utf8)) }
            guard let self, let done, self.gen == g else { return }
            done(((result as? [String: Any])?["ms"] as? NSNumber)?.intValue ?? 0)
        }
    }

    func receive(_ body: Any) {
        guard let message = body as? [String: Any], let kind = message["t"] as? String else { return }
        switch kind {
        case "bubble":
            bubbleRect = appKitRect(message["rect"])
            chips = (message["chips"] as? [[String: Any]] ?? []).compactMap { item in
                guard let id = item["id"] as? String, let rect = appKitRect(item) else { return nil }
                return Chip(id: id, rect: rect)
            }
            hoverChip = nil
        case "debate":
            debateEvent(message)
        default:
            break
        }
    }

    // The page measures from the top left in CSS pixels. AppKit measures from the bottom left.
    func appKitRect(_ value: Any?) -> NSRect? {
        guard let r = value as? [String: Any],
              let x = (r["x"] as? NSNumber)?.doubleValue, let y = (r["y"] as? NSNumber)?.doubleValue,
              let w = (r["w"] as? NSNumber)?.doubleValue, let h = (r["h"] as? NSNumber)?.doubleValue else { return nil }
        return NSRect(x: x, y: Double(windowHeight) - (y + h), width: w, height: h)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !ready else { return }
        ready = true
        if let snapshotPath { return takeSnapshot(to: snapshotPath) }
        enter()
    }

    // MARK: Screen and geometry

    func currentScreen() -> NSScreen {
        let centre = NSPoint(x: panel.frame.midX, y: panel.frame.midY)
        return NSScreen.screens.first { $0.frame.contains(centre) }
            ?? NSScreen.screens.first { $0.frame.intersects(panel.frame) }
            ?? NSScreen.main ?? NSScreen.screens[0]
    }

    func groundY() -> CGFloat { currentScreen().visibleFrame.minY - footInset }

    func clampCentre(_ x: CGFloat) -> CGFloat {
        let v = currentScreen().visibleFrame
        return min(max(x, v.minX + 40), v.maxX - 40)
    }

    @objc func spaceChanged() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in self?.comeForward() }
    }

    // A window that joins all spaces can still miss a full-screen space that opened after the duck arrived.
    func comeForward() {
        guard mode != .leaving, !menuOpen else { return }
        if !panel.isOnActiveSpace {
            panel.orderOut(nil)
            panel.orderFrontRegardless()
            note("rejoined the active space: \(panel.isOnActiveSpace)")
        } else {
            panel.orderFrontRegardless()
        }
    }

    @objc func screensChanged() {
        guard move == .rest else { return }
        var o = panel.frame.origin
        o.y = groundY()
        o.x = clampCentre(o.x + windowWidth / 2) - windowWidth / 2
        panel.setFrameOrigin(o)
    }

    // MARK: Entrance, rest, exit

    func enter() {
        let v = (NSScreen.main ?? NSScreen.screens[0]).visibleFrame
        panel.setFrameOrigin(NSPoint(x: v.maxX - 220 - windowWidth / 2, y: v.minY - footInset))
        panel.alphaValue = 0
        panel.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.8
            panel.animator().alphaValue = 1
        }
        activeSince = Date()
        mode = .nap
        busy = true
        js("duck.face(-1); duck.base('idle')")
        cue("entrance") { [self] ms in
            later(Double(ms) / 1000 + 1) { [self] in
                busy = false
                restPose()
                scheduleCute(first: true)
            }
        }
    }

    func restPose() {
        switch mode {
        case .nap: js("duck.base('nap')")
        case .nudging: js("duck.base('wave')")
        case .onDuty: js("duck.base('sit')")
        case .reporting: js("duck.base('proud')")
        case .debating: js("duck.base('sit')")
        case .sprinting: js("duck.base('focus')")
        case .leaving: js("duck.base('walk')")
        }
    }

    // After a drag the page still remembers what was in the bubble. This puts it back.
    func restorePresentation() {
        restPose()
        let range = visibleRange()
        js("duck.restore(\(range.min), \(range.max))")
    }

    func toNap() {
        enterMode(.nap)
        js("duck.hush()")
        restPose()
        scheduleCute(first: false)
    }

    func goHome(force: Bool) {
        if force { cleanUp(); exit(0) }
        guard mode != .leaving else { return }
        enterMode(.leaving)
        js("duck.hush(); duck.base('walk')")
        let v = currentScreen().visibleFrame
        let toRight = panel.frame.midX > v.midX
        js("duck.face(\(toRight ? 1 : -1))")
        walkSpeed = 90
        walk(toCentreX: toRight ? v.maxX : v.minX) { [self] in finishLeaving() }
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 2.2
            panel.animator().alphaValue = 0
        }
        later(3.5) { [self] in finishLeaving() }
    }

    func finishLeaving() {
        cleanUp()
        NSApp.terminate(nil)
    }

    func cleanUp() {
        try? FileManager.default.removeItem(at: pidURL)
        try? FileManager.default.removeItem(at: sprintURL)
    }

    // MARK: Sequencing

    func later(_ seconds: TimeInterval, _ block: @escaping () -> Void) {
        let g = gen
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak self] in
            guard let self, self.gen == g else { return }
            block()
        }
    }

    func interrupt() {
        gen += 1
        busy = false
        walkDone = nil
        walkTarget = nil
        if move == .walking { move = .rest }
    }

    func enterMode(_ m: Mode) {
        interrupt()
        if m != .sprinting { clearSprint() }
        mode = m
        note("mode \(m)")
    }

    func scheduleCute(first: Bool) {
        let lively = settings.playfulness == "lively"
        let range: ClosedRange<Double> = lively ? (45...120) : (first ? (90...180) : (240...540))
        nextCuteAt = Date().addingTimeInterval(Double.random(in: range))
    }

    // MARK: Movement

    func startMotion() {
        guard motion == nil else { return }
        lastTick = Date()
        let timer = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in self?.step() }
        RunLoop.main.add(timer, forMode: .common)
        motion = timer
    }

    func stopMotion() {
        motion?.invalidate()
        motion = nil
    }

    func step() {
        let now = Date()
        if menuOpen {
            lastTick = now
            return
        }
        let dt = CGFloat(min(0.05, now.timeIntervalSince(lastTick)))
        lastTick = now
        switch move {
        case .walking: stepWalk(dt)
        case .falling: stepFall(dt)
        default: stopMotion()
        }
    }

    func walk(toCentreX x: CGFloat, then done: @escaping () -> Void) {
        move = .walking
        walkTarget = x
        walkDone = done
        let facingRight = x >= panel.frame.midX
        js("duck.face(\(facingRight ? 1 : -1)); duck.base('walk')")
        startMotion()
    }

    func stepWalk(_ dt: CGFloat) {
        guard let target = walkTarget else { move = .rest; stopMotion(); return }
        var origin = panel.frame.origin
        let centre = origin.x + windowWidth / 2
        let stride = walkSpeed * dt
        if abs(target - centre) <= stride {
            origin.x = target - windowWidth / 2
            panel.setFrameOrigin(origin)
            let done = walkDone
            walkTarget = nil
            walkDone = nil
            move = .rest
            stopMotion()
            walkSpeed = 46
            done?()
        } else {
            origin.x += (target >= centre ? 1 : -1) * stride
            panel.setFrameOrigin(origin)
        }
    }

    func stepFall(_ dt: CGFloat) {
        var origin = panel.frame.origin
        let ground = groundY()
        vy -= 2200 * dt
        origin.y += vy * dt
        if origin.y <= ground {
            origin.y = ground
            if vy < -250 {
                vy = -vy * 0.3
            } else {
                panel.setFrameOrigin(origin)
                land()
                return
            }
        }
        panel.setFrameOrigin(origin)
    }

    func land() {
        stopMotion()
        vy = 0
        move = .rest
        restorePresentation()
        js("duck.play('land')")
        if mode == .nap { scheduleCute(first: false) }
    }

    // MARK: Mouse

    func mouseDown() {
        pressing = true
        dragging = false
        dragStartMouse = NSEvent.mouseLocation
        dragStartOrigin = panel.frame.origin
        pressChip = chipAt(localPoint(dragStartMouse))
    }

    func mouseDragged() {
        guard pressing, pressChip == nil else { return }
        let m = NSEvent.mouseLocation
        let dx = m.x - dragStartMouse.x
        let dy = m.y - dragStartMouse.y
        if !dragging {
            guard hypot(dx, dy) > 3 else { return }
            dragging = true
            interrupt()
            stopMotion()
            move = .dragging
            js("duck.hush(true); duck.base('carried')")
        }
        panel.setFrameOrigin(NSPoint(x: dragStartOrigin.x + dx, y: dragStartOrigin.y + dy))
    }

    func mouseUp() {
        guard pressing else { return }
        pressing = false
        if dragging {
            dragging = false
            vy = 0
            move = .falling
            startMotion()
        } else if let id = pressChip {
            pressChip = nil
            if chipAt(localPoint(NSEvent.mouseLocation)) == id { pickChip(id) }
        } else {
            clicked()
        }
    }

    func clicked() {
        switch mode {
        case .nap:
            interrupt()
            busy = true
            js("duck.base('idle'); duck.play('happy')")
            cue("click") { [self] ms in
                later(Double(ms) / 1000 + 1.4) { [self] in
                    busy = false
                    restPose()
                    scheduleCute(first: false)
                }
            }
        case .nudging:
            startTakeover()
        case .onDuty:
            finishDuty(early: true, away: Date().timeIntervalSince(dutyStart))
        case .reporting:
            toNap()
        case .sprinting:
            interrupt()
            busy = true
            js("duck.play('happy')")
            cue("sprintCheck", ["n": minutesLeft()]) { [self] ms in
                later(Double(ms) / 1000 + 0.6) { [self] in
                    busy = false
                    restPose()
                }
            }
        case .debating, .leaving:
            break
        }
    }

    func localPoint(_ screenPoint: NSPoint) -> NSPoint {
        NSPoint(x: screenPoint.x - panel.frame.minX, y: screenPoint.y - panel.frame.minY)
    }

    func chipAt(_ point: NSPoint) -> String? {
        chips.first { $0.rect.contains(point) }?.id
    }

    func pickChip(_ id: String) {
        guard mode == .debating else { return }
        js("duck.pick(\(literal(id)))")
    }

    func updateClickThrough() {
        guard ready, !dragging, !pressing, !menuOpen else { return }
        let local = localPoint(NSEvent.mouseLocation)
        let chip = chipAt(local)
        let inside = chip != nil || duckRect.contains(local) || (bubbleRect?.contains(local) ?? false)
        if panel.ignoresMouseEvents == inside { panel.ignoresMouseEvents = !inside }
        if chip != hoverChip {
            hoverChip = chip
            js("duck.hover(\(chip.map { literal($0) } ?? "null"))")
        }
    }

    // MARK: Brain

    func idleSeconds() -> TimeInterval {
        if let idleFile, let text = try? String(contentsOfFile: idleFile, encoding: .utf8), let value = Double(text.trimmingCharacters(in: .whitespacesAndNewlines)) {
            return value
        }
        return CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: CGEventType(rawValue: ~0)!)
    }

    func nudgeInterval() -> TimeInterval {
        if let nudgeSecondsOverride { return nudgeSecondsOverride }
        return Double(settings.nudgeEveryMinutes) * 60
    }

    func brain() {
        guard ready, mode != .leaving, !menuOpen else { return }
        let now = Date()
        let idle = idleSeconds()

        if activeSince == nil && idle < 5 { activeSince = now }
        if idle >= 60 && awayStart == nil { awayStart = now.addingTimeInterval(-idle) }
        if let away = awayStart, idle < 3 {
            awayStart = nil
            handleReturn(away: now.timeIntervalSince(away), now: now)
        }

        switch mode {
        case .nap:
            if move == .rest, !busy {
                maybeNudge(now: now, idle: idle)
                if mode == .nap, !busy, now >= nextCuteAt, idle < 120 { doCute() }
            }
        case .nudging:
            guard move == .rest else { break }
            if idle >= 45 {
                startTakeover()
            } else if now >= roleDeadline {
                nudgeIgnored(now: now)
            }
        case .onDuty:
            if idle >= 60 { leftDuringDuty = true }
            if !leftDuringDuty && now.timeIntervalSince(dutyStart) > 240 {
                declineDuty(now: now)
            } else {
                maybeGag(now: now)
            }
        case .reporting:
            if move == .rest && now >= roleDeadline { toNap() }
        case .debating:
            guard move == .rest else { break }
            if idle >= 45 {
                startTakeover(win: true)
            } else if now >= debateDeadline {
                abandonDebate(now: now)
            }
        case .sprinting:
            if move == .rest, !busy, let end = sprintEndsAt, now >= end { finishSprint(end: end, now: now) }
        case .leaving:
            break
        }

        pollInbox()
    }

    func handleReturn(away: TimeInterval, now: Date) {
        if away >= 300 {
            activeSince = now
            ignoredStreak = 0
        }
        switch mode {
        case .onDuty where away >= 60:
            finishDuty(early: false, away: away)
        case .nap where now >= snoozeUntil && away >= 300 && away <= 3600 && now.timeIntervalSince(lastWelcome) > 1200 && move == .rest && !busy:
            lastWelcome = now
            busy = true
            js("duck.base('idle'); duck.play('happy')")
            cue("welcome") { [self] ms in
                later(Double(ms) / 1000 + 1) { [self] in
                    busy = false
                    restPose()
                }
            }
        default:
            break
        }
    }

    func maybeNudge(now: Date, idle: TimeInterval) {
        let every = nudgeInterval()
        guard every > 0, now >= snoozeUntil, let since = activeSince, idle < 120 else { return }
        let active = now.timeIntervalSince(since)
        guard active >= every else { return }
        let lull = (active - every) > 1200 ? 3 : lullSeconds
        if idle >= lull { startNudge(now: now) }
    }

    // sprintMinutes is set when the nudge is the end of a focus sprint; that one waits longer for a click.
    func startNudge(now: Date, sprintMinutes: Double? = nil) {
        enterMode(.nudging)
        nudgeIsSprintEnd = sprintMinutes != nil
        roleDeadline = now.addingTimeInterval(sprintMinutes == nil ? 28 : 90)
        js("duck.base('wave')")
        if let sprintMinutes {
            cue("sprintEnd", ["n": sprintMinutes])
        } else {
            cue("nudge")
        }
    }

    func nudgeIgnored(now: Date) {
        if nudgeIsSprintEnd {
            snoozeUntil = max(snoozeUntil, now.addingTimeInterval(10 * 60))
        } else {
            ignoredStreak += 1
            snoozeUntil = max(snoozeUntil, now.addingTimeInterval(ignoredStreak >= 3 ? 45 * 60 : 15 * 60))
        }
        toNap()
    }

    // The duck takes the desk. The shift log, which the return report reads, starts empty.
    func beginDuty() {
        enterMode(.onDuty)
        dutyStart = Date()
        leftDuringDuty = false
        nextGagAt = dutyStart.addingTimeInterval(Double.random(in: 18...28))
        js("duck.base('sit')")
    }

    // win is true when the duck won a debate by default, because you walked away mid-argument.
    func startTakeover(win: Bool = false) {
        beginDuty()
        cue("announce", ["win": win])
    }

    func finishDuty(early: Bool, away: TimeInterval) {
        enterMode(.reporting)
        activeSince = Date()
        ignoredStreak = 0
        roleDeadline = Date().addingTimeInterval(18)
        js("duck.base('proud'); duck.play('happy')")
        cue("report", ["early": early, "awayMin": Int((away / 60).rounded())])
    }

    func declineDuty(now: Date) {
        let quiet = now < snoozeUntil
        snoozeUntil = max(snoozeUntil, now.addingTimeInterval(10 * 60))
        toNap()
        if !quiet { cue("decline") }
    }

    // While the duck has the desk it does small silly things. They go into the report you get back.
    func maybeGag(now: Date) {
        guard move == .rest, !busy, now >= snoozeUntil, now >= nextGagAt else { return }
        busy = true
        js("duck.base('idle')")
        cue("gag") { [self] ms in
            later(Double(ms) / 1000 + 0.6) { [self] in
                busy = false
                restPose()
                nextGagAt = Date().addingTimeInterval(Double.random(in: 25...40))
            }
        }
    }
    func doCute(explicit: Bool = false) {
        guard mode == .nap, move == .rest, !busy, explicit || Date() >= snoozeUntil else { return }
        busy = true
        let finish: () -> Void = { [self] in
            busy = false
            restPose()
            scheduleCute(first: false)
        }
        // Acts that come with a line: the page plays the act and shows the bubble.
        let spoken: (String) -> Void = { [self] kind in
            js("duck.base('idle')")
            cue(kind) { [self] ms in later(Double(ms) / 1000 + 0.8, finish) }
        }
        switch cuteBag.next() {
        case .waddle:
            let v = currentScreen().visibleFrame
            let distance = CGFloat.random(in: 90...260) * (Bool.random() ? 1 : -1)
            var target = clampCentre(panel.frame.midX + distance)
            if abs(target - panel.frame.midX) < 40 { target = clampCentre(panel.frame.midX - distance) }
            if target < v.minX || target > v.maxX { return finish() }
            walk(toCentreX: target, then: finish)
        case .preen:
            js("duck.base('idle'); duck.play('preen')")
            later(3.0, finish)
        case .look:
            js("duck.base('idle'); duck.play('look')")
            later(3.2, finish)
        case .hop:
            js("duck.base('idle'); duck.play('hop')")
            later(1.6, finish)
        case .quip:
            js("duck.base('idle'); duck.play('quack')")
            cue("quip") { [self] ms in later(Double(ms) / 1000 + 0.6, finish) }
        case .yawn:
            js("duck.base('idle'); duck.play('yawn')")
            later(2.9, finish)
        case .wiggle:
            js("duck.base('idle'); duck.play('wiggle')")
            later(2.0, finish)
        case .sneeze: spoken("sneeze")
        case .spin: spoken("spin")
        case .bow: spoken("bow")
        }
    }

    // MARK: Sleep and wake

    @objc func willSleep() { sleepStart = Date() }

    @objc func didWake() {
        guard let start = sleepStart else { return }
        sleepStart = nil
        guard ready, mode != .leaving else { return }
        handleReturn(away: Date().timeIntervalSince(start), now: Date())
        awayStart = nil
    }

    // MARK: Explicit interactions

    func hello() {
        comeForward()
        guard mode == .nap, move == .rest else { return }
        interrupt()
        busy = true
        js("duck.base('idle'); duck.play('happy')")
        cue("hello") { [self] ms in
            later(Double(ms) / 1000 + 0.6) { [self] in
                busy = false
                restPose()
            }
        }
    }

    // True when a command that changes the duck's whole mode can start now.
    func canInterrupt() -> Bool { move == .rest || move == .walking }

    func coverNow() {
        guard mode == .nap || mode == .nudging || mode == .sprinting, canInterrupt() else { return }
        startTakeover()
    }

    // MARK: Convince me

    func startDebate() {
        guard mode == .nap || mode == .nudging || mode == .sprinting, canInterrupt() else { return }
        enterMode(.debating)
        debateDeadline = Date().addingTimeInterval(90)
        let range = visibleRange()
        js("duck.hush(); duck.debateStart(\(range.min), \(range.max))")
    }

    // The page tells us about each turn. Every click is a sign of life, so the deadline moves.
    func debateEvent(_ message: [String: Any]) {
        guard mode == .debating, let event = message["event"] as? String else { return }
        switch event {
        case "turn":
            let final = message["final"] as? Bool ?? false
            debateDeadline = Date().addingTimeInterval(final ? 30 : 90)
        case "end" where message["outcome"] as? String == "won":
            beginDuty()
        case "end":
            // The closing bubble is already on screen and hides itself, so this must not hush it.
            snoozeUntil = max(snoozeUntil, Date().addingTimeInterval(20 * 60))
            enterMode(.nap)
            busy = true
            later(5.6) { [self] in
                busy = false
                restPose()
                scheduleCute(first: false)
            }
        default:
            break
        }
    }

    func abandonDebate(now: Date) {
        let quiet = now < snoozeUntil
        snoozeUntil = max(snoozeUntil, now.addingTimeInterval(20 * 60))
        toNap()
        if !quiet { cue("decline") }
    }

    // MARK: Focus sprint

    func minutesLeft() -> Int {
        guard let end = sprintEndsAt else { return 1 }
        return max(1, Int((end.timeIntervalSinceNow / 60).rounded(.up)))
    }

    func startSprint(minutes: Double) {
        guard mode != .leaving, canInterrupt() else { return }
        enterMode(.sprinting)
        js("duck.hush()")
        sprintMinutes = minutes
        sprintStartedAt = Date()
        sprintEndsAt = sprintStartedAt.addingTimeInterval(minutes * 60)
        writeSprint()
        paintSprint()
        restPose()
        cue("sprintStart", ["n": minutes])
    }

    func extendSprint() {
        guard mode == .sprinting, let end = sprintEndsAt else { return }
        sprintEndsAt = end.addingTimeInterval(300)
        sprintMinutes += 5
        writeSprint()
        paintSprint()
        cue("sprintExtend")
    }

    func cancelSprint() {
        guard mode == .sprinting else { return }
        toNap()
        cue("sprintCancel")
    }

    // The clock reached zero. A sprint that ended long ago, for example while the Mac slept, ends without a word.
    func finishSprint(end: Date, now: Date) {
        if now.timeIntervalSince(end) > 600 {
            toNap()
        } else {
            startNudge(now: now, sprintMinutes: sprintMinutes)
        }
    }

    func clearSprint() {
        guard sprintEndsAt != nil else { return }
        sprintEndsAt = nil
        try? FileManager.default.removeItem(at: sprintURL)
        js("duck.sprintStop()")
    }

    // The control room reads this file to show the time left. The duck owns it and removes it when the sprint ends.
    func writeSprint() {
        guard let end = sprintEndsAt else { return }
        let record: [String: Any] = [
            "endsAt": Int(end.timeIntervalSince1970 * 1000),
            "startedAt": Int(sprintStartedAt.timeIntervalSince1970 * 1000),
            "minutes": sprintMinutes,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: record) else { return }
        try? data.write(to: sprintURL, options: .atomic)
    }

    func paintSprint() {
        guard let end = sprintEndsAt else { return }
        let range = visibleRange()
        js("duck.sprintStart(\(Int(end.timeIntervalSince1970 * 1000)), \(Int(sprintMinutes * 60_000)), \(range.min), \(range.max))")
    }

    // MARK: Authenticated per-instance control

    func writePrivateJSON(_ value: [String: Any], to url: URL) throws {
        let data = try JSONSerialization.data(withJSONObject: value)
        try data.write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    func startControl() throws {
        let fm = FileManager.default
        for dir in [stateDir, controlInboxURL, controlRepliesURL] {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: dir.path)
        }
        try writePrivateJSON([
            "instance": controlInstance, "token": controlToken, "pid": Int(getpid()),
            "fingerprint": argument("--fingerprint") ?? "",
        ], to: stateDir.appendingPathComponent("control.json"))
    }

    // A reply must include both the instance secret and the caller's fresh nonce. The PID is only
    // an exit-wait hint; no controller action sends a process signal.
    func pollControl() {
        let fm = FileManager.default
        do {
            for url in try fm.contentsOfDirectory(at: controlRepliesURL, includingPropertiesForKeys: [.contentModificationDateKey]) {
                let age = -(try url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate?.timeIntervalSinceNow ?? 0)
                if age > 30 { try fm.removeItem(at: url) }
            }
            let files = try fm.contentsOfDirectory(at: controlInboxURL, includingPropertiesForKeys: [.fileSizeKey])
                .filter { $0.pathExtension == "json" && !$0.lastPathComponent.hasPrefix(".") }
                .sorted { $0.lastPathComponent < $1.lastPathComponent }
            for url in files.prefix(20) {
                defer {
                    do { try fm.removeItem(at: url) }
                    catch { note("control request cleanup failed: \(error)") }
                }
                guard (try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? Int.max) <= 8192,
                      let request = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any],
                      request["instance"] as? String == controlInstance, request["token"] as? String == controlToken,
                      let id = request["id"] as? String, id.count == 32,
                      id.allSatisfy({ "0123456789abcdef".contains($0) }),
                      let action = request["action"] as? String else { continue }
                var response: [String: Any] = ["id": id, "instance": controlInstance, "token": controlToken, "pid": Int(getpid())]
                do {
                    switch action {
                    case "status": break
                    case "home": goHome(force: false)
                    case "wake":
                        response["greeted"] = ready && mode == .nap && move == .rest
                        if ready && mode != .leaving { hello() }
                    case "command":
                        guard ready && mode != .leaving else { throw controlError("The duck is not ready or is stopping. Try again.") }
                        guard let command = request["command"] as? [String: Any] else { throw controlError("A duck command is required.") }
                        if try !applyPreference(command) {
                            try writePrivateJSON(["instance": controlInstance, "token": controlToken, "command": command],
                                                 to: inboxURL.appendingPathComponent(url.lastPathComponent))
                        }
                    default: throw controlError("Unknown duck control action.")
                    }
                } catch {
                    response["error"] = error.localizedDescription
                }
                response["ready"] = ready
                response["stopping"] = mode == .leaving
                response["settings"] = ["nudgeEveryMinutes": settings.nudgeEveryMinutes, "playfulness": settings.playfulness]
                response["snoozeUntil"] = max(0, snoozeUntil.timeIntervalSince1970 * 1000)
                try writePrivateJSON(response, to: controlRepliesURL.appendingPathComponent("\(id).json"))
            }
        } catch {
            note("control request failed: \(error)")
        }
    }

    func controlError(_ message: String) -> NSError {
        NSError(domain: "LittleIntermissions", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    func applyPreference(_ command: [String: Any]) throws -> Bool {
        switch command["cmd"] as? String {
        case "nudges":
            guard let minutes = command["minutes"] as? Int, [0, 30, 50, 75, 90].contains(minutes) else {
                throw controlError("Choose nudges off, 30, 50, 75 or 90 minutes.")
            }
            var updated = settings
            updated.nudgeEveryMinutes = minutes
            try saveSettings(updated)
        case "playfulness":
            guard let value = command["value"] as? String, ["calm", "lively"].contains(value) else {
                throw controlError("Choose calm or lively playfulness.")
            }
            var updated = settings
            updated.playfulness = value
            try saveSettings(updated)
            scheduleCute(first: false)
        case "snooze": menuSnooze()
        default: return false
        }
        return true
    }

    // MARK: Pending commands

    // Authenticated control leaves one file per queued command; direct test messages need --test-hooks.
    func prepareInbox() {
        let fm = FileManager.default
        try? fm.createDirectory(at: inboxURL, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        for url in (try? fm.contentsOfDirectory(at: inboxURL, includingPropertiesForKeys: nil)) ?? [] {
            let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
            if -(modified?.timeIntervalSinceNow ?? 0) > 60 { try? fm.removeItem(at: url) }
        }
    }

    // Takes at most one command per tick, oldest first. Stale, oversized and unreadable files are deleted.
    func pollInbox() {
        let fm = FileManager.default
        let keys: [URLResourceKey] = [.contentModificationDateKey, .fileSizeKey]
        guard let urls = try? fm.contentsOfDirectory(at: inboxURL, includingPropertiesForKeys: keys) else { return }
        let files = urls
            .filter { $0.pathExtension == "json" && !$0.lastPathComponent.hasPrefix(".") }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        for url in files {
            let values = try? url.resourceValues(forKeys: Set(keys))
            let age = -(values?.contentModificationDate?.timeIntervalSinceNow ?? 0)
            guard age <= 60, (values?.fileSize ?? Int.max) <= 4096,
                  let data = try? Data(contentsOf: url),
                  let envelope = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                try? fm.removeItem(at: url)
                continue
            }
            let authenticated = envelope["instance"] as? String == controlInstance && envelope["token"] as? String == controlToken
            let command = authenticated ? envelope["command"] as? [String: Any] : testHooks ? envelope : nil
            guard let command else { try? fm.removeItem(at: url); continue }
            if handleCommand(command) { try? fm.removeItem(at: url) }
            return
        }
    }

    // Returns false to keep the file for the next tick, because the duck is busy. Returns true when the
    // command was done or does not apply right now. A command you type is explicit, so it ignores the snooze.
    func handleCommand(_ command: [String: Any]) -> Bool {
        guard let name = command["cmd"] as? String else { return true }
        if testHooks, let consumed = testCommand(name, command) { return consumed }
        let calm = move == .rest && !busy
        switch name {
        case "say":
            guard mode == .nap else { return true }
            guard calm else { return false }
            guard let text = cleanLine(command["text"] as? String) else { return true }
            busy = true
            js("duck.base('idle'); duck.play('quack')")
            cue("say", ["text": text]) { [self] ms in
                later(Double(ms) / 1000 + 0.8) { [self] in
                    busy = false
                    restPose()
                }
            }
        case "nudge":
            guard mode == .nap else { return true }
            guard calm else { return false }
            startNudge(now: Date())
        case "cover":
            guard mode == .nap || mode == .nudging || mode == .sprinting else { return true }
            guard canInterrupt() else { return false }
            startTakeover()
        case "convince":
            guard mode == .nap || mode == .nudging || mode == .sprinting else { return true }
            guard canInterrupt() else { return false }
            startDebate()
        case "sprint":
            guard let minutes = (command["minutes"] as? NSNumber)?.doubleValue,
                  minutes.isFinite, minutes >= 0.1, minutes <= 180, mode != .leaving else { return true }
            guard canInterrupt() else { return false }
            startSprint(minutes: minutes)
        case "sprint-stop":
            cancelSprint()
        case "sprint-extend":
            extendSprint()
        case "cute":
            menuCute()
        default:
            break
        }
        return true
    }

    // One short line of plain text for the bubble. Control characters go, and long text is cut.
    func cleanLine(_ text: String?) -> String? {
        guard let text else { return nil }
        let spaced = text.replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "\r", with: " ")
            .replacingOccurrences(of: "\t", with: " ")
        let kept = spaced.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }
        let line = String(String.UnicodeScalarView(kept)).trimmingCharacters(in: .whitespaces)
        guard !line.isEmpty else { return nil }
        return line.count > 120 ? String(line.prefix(119)) + "…" : line
    }

    // MARK: Test hooks

    // Only with --test-hooks, which the extension never passes. They let a test drive the duck without
    // the real mouse. Returns nil when the command is not a test command.
    func testCommand(_ name: String, _ command: [String: Any]) -> Bool? {
        switch name {
        case "pick":
            if let id = command["id"] as? String { pickChip(id) }
        case "click":
            clicked()
        case "js":
            if let script = command["script"] as? String { js(script) }
        case "snapshot":
            if let path = command["path"] as? String { snapshotNow(to: path) }
        case "state":
            writeState()
        case "menu":
            // Opens the real menu over the duck without a mouse event and closes it after `seconds`.
            // The log then shows whether anything closed it sooner.
            let seconds = (command["seconds"] as? NSNumber)?.doubleValue ?? 3
            DispatchQueue.main.async { [self] in
                let menu = buildMenu()
                afterTracking(seconds) { menu.cancelTracking() }
                menu.popUp(positioning: nil, at: NSPoint(x: duckRect.midX, y: duckRect.maxY), in: hit)
            }
        case "rclick":
            // Posts a right-click on the duck into this app's own event queue, so it takes the same
            // AppKit path as a real click. `up` releases the button; the menu closes after `seconds`.
            let seconds = (command["seconds"] as? NSNumber)?.doubleValue ?? 3
            let up = (command["up"] as? NSNumber)?.doubleValue
            DispatchQueue.main.async { [self] in
                if let up { afterTracking(up) { [self] in postMouse(.rightMouseUp) } }
                afterTracking(seconds) { [self] in openMenu?.cancelTracking() }
                postMouse(.rightMouseDown)
            }
        default:
            return nil
        }
        return true
    }

    // Main-queue blocks wait while a menu tracks the mouse; a common-mode timer still fires.
    func afterTracking(_ seconds: Double, _ block: @escaping () -> Void) {
        RunLoop.main.add(Timer(timeInterval: seconds, repeats: false) { _ in block() }, forMode: .common)
    }

    func postMouse(_ type: NSEvent.EventType) {
        guard let event = NSEvent.mouseEvent(
            with: type, location: NSPoint(x: duckRect.midX, y: duckRect.midY), modifierFlags: [],
            timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: panel.windowNumber, context: nil,
            eventNumber: 0, clickCount: 1, pressure: type == .rightMouseUp ? 0 : 1) else { return }
        NSApp.postEvent(event, atStart: false)
    }

    func writeState() {
        var state: [String: Any] = [
            "mode": "\(mode)",
            "move": "\(move)",
            "busy": busy,
            "bubble": bubbleRect != nil,
            "chips": chips.map { $0.id },
        ]
        if let end = sprintEndsAt { state["sprintEndsAt"] = Int(end.timeIntervalSince1970 * 1000) }
        guard let data = try? JSONSerialization.data(withJSONObject: state) else { return }
        try? data.write(to: stateDir.appendingPathComponent("test-state.json"), options: .atomic)
    }

    // MARK: Menu

    func buildMenu() -> NSMenu {
        let menu = NSMenu()
        menu.delegate = self
        let every = nudgeInterval()
        var status = "Break nudges are off"
        if every > 0 {
            let activeMinutes = Int((activeSince.map { Date().timeIntervalSince($0) } ?? 0) / 60)
            status = "Active \(activeMinutes) min. Nudge at \(Int(every / 60)) min."
        }
        let header = NSMenuItem(title: status, action: nil, keyEquivalent: "")
        header.isEnabled = false
        menu.addItem(header)
        menu.addItem(.separator())

        if mode == .sprinting {
            let sprintHeader = NSMenuItem(title: "Focus sprint: \(minutesLeft()) min left", action: nil, keyEquivalent: "")
            sprintHeader.isEnabled = false
            menu.addItem(sprintHeader)
            menu.addItem(menuItem("Add 5 minutes", #selector(menuExtend)))
            menu.addItem(menuItem("Cancel sprint", #selector(menuCancelSprint)))
        } else {
            let sprints = NSMenu()
            for minutes in [15, 25, 45, 60] {
                sprints.addItem(menuItem("\(minutes) minutes", #selector(menuSprint(_:)), tag: minutes))
            }
            let sprintItem = NSMenuItem(title: "Focus sprint", action: nil, keyEquivalent: "")
            sprintItem.submenu = sprints
            menu.addItem(sprintItem)
        }
        menu.addItem(menuItem("Cover my desk for 5 minutes", #selector(menuCover)))
        menu.addItem(menuItem("Convince me…", #selector(menuConvince)))
        menu.addItem(menuItem("Do something cute", #selector(menuCute)))
        menu.addItem(.separator())

        let nudges = NSMenu()
        for minutes in [30, 50, 75, 90, 0] {
            let title = minutes == 0 ? "Off" : "Every \(minutes) minutes"
            let item = menuItem(title, #selector(menuNudge(_:)), tag: minutes)
            item.state = settings.nudgeEveryMinutes == minutes ? .on : .off
            nudges.addItem(item)
        }
        let nudgeItem = NSMenuItem(title: "Break nudges", action: nil, keyEquivalent: "")
        nudgeItem.submenu = nudges
        menu.addItem(nudgeItem)

        menu.addItem(menuItem("Quiet for 1 hour (keeps focus sprint)", #selector(menuSnooze)))

        let play = NSMenu()
        for (key, title) in [("calm", "Calm"), ("lively", "Lively")] {
            let item = menuItem(title, #selector(menuPlay(_:)))
            item.representedObject = key
            item.state = settings.playfulness == key ? .on : .off
            play.addItem(item)
        }
        let playItem = NSMenuItem(title: "Playfulness", action: nil, keyEquivalent: "")
        playItem.submenu = play
        menu.addItem(playItem)
        menu.addItem(.separator())

        menu.addItem(menuItem("Send duck home", #selector(menuHome)))
        return menu
    }

    func showMenu(with event: NSEvent, in view: NSView) {
        guard !menuOpen else { return }
        // An inactive accessory app cannot own menu focus, so borrow focus until the menu closes.
        if !NSApp.isActive {
            focusBeforeMenu = NSWorkspace.shared.frontmostApplication
            if #available(macOS 14.0, *) { NSApp.activate() }
            else { NSApp.activate(ignoringOtherApps: true) }
        }
        NSMenu.popUpContextMenu(buildMenu(), with: event, for: view)
    }

    func menuWillOpen(_ menu: NSMenu) {
        menuOpen = true
        openMenu = menu
        menuOpenedAt = Date()
        if panel.ignoresMouseEvents { panel.ignoresMouseEvents = false }
        note("menu open active=\(NSApp.isActive)")
    }

    func menuDidClose(_ menu: NSMenu) {
        menuOpen = false
        openMenu = nil
        note(String(format: "menu closed after %.1fs", Date().timeIntervalSince(menuOpenedAt)))
        if let back = focusBeforeMenu {
            focusBeforeMenu = nil
            DispatchQueue.main.async {
                if #available(macOS 14.0, *) {
                    NSApp.yieldActivation(to: back)
                    back.activate(from: .current, options: [])
                } else {
                    back.activate(options: [.activateIgnoringOtherApps])
                }
            }
        }
    }

    func note(_ text: String) {
        FileHandle.standardError.write(Data("\(ISO8601DateFormatter().string(from: Date())) \(text)\n".utf8))
    }

    func menuItem(_ title: String, _ action: Selector, tag: Int = 0) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = self
        item.tag = tag
        return item
    }

    @objc func menuCover() { coverNow() }

    @objc func menuConvince() { startDebate() }

    @objc func menuSprint(_ item: NSMenuItem) { startSprint(minutes: Double(item.tag)) }

    @objc func menuExtend() { extendSprint() }

    @objc func menuCancelSprint() { cancelSprint() }

    @objc func menuCute() {
        guard mode == .nap, move == .rest else { return }
        interrupt()
        doCute(explicit: true)
    }

    @objc func menuNudge(_ item: NSMenuItem) {
        do { _ = try applyPreference(["cmd": "nudges", "minutes": item.tag]) }
        catch { reportSettingsError(error) }
    }

    @objc func menuSnooze() {
        snoozeUntil = Date().addingTimeInterval(3600)
        if mode != .sprinting && mode != .leaving { toNap() }
        if mode == .nap { cue("snooze") }
    }

    @objc func menuPlay(_ item: NSMenuItem) {
        do { _ = try applyPreference(["cmd": "playfulness", "value": item.representedObject as? String ?? "calm"]) }
        catch { reportSettingsError(error) }
    }

    @objc func menuHome() { goHome(force: false) }

    // MARK: Settings

    func loadSettings() {
        guard let data = try? Data(contentsOf: settingsURL),
              let loaded = try? JSONDecoder().decode(Settings.self, from: data) else { return }
        settings = loaded
    }

    func saveSettings(_ updated: Settings) throws {
        let data = try JSONEncoder().encode(updated)
        try data.write(to: settingsURL, options: .atomic)
        settings = updated
    }

    func reportSettingsError(_ error: Error) {
        note("settings save failed: \(error)")
        cue("say", ["text": "Could not save this setting. Check duck.log."])
    }

    // MARK: Snapshot

    // Writes the web view's pixels to a PNG. The completion gets the bitmap, or nil when WebKit failed.
    func snapshotNow(to path: String, then: @escaping (NSBitmapImageRep?) -> Void = { _ in }) {
        web.takeSnapshot(with: WKSnapshotConfiguration()) { image, error in
            guard let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) else {
                FileHandle.standardError.write(Data("snapshot failed: \(String(describing: error))\n".utf8))
                return then(nil)
            }
            if let png = rep.representation(using: .png, properties: [:]) {
                try? png.write(to: URL(fileURLWithPath: path))
            }
            then(rep)
        }
    }

    // The --snapshot self-test: draw one frame, report the transparency, exit.
    func takeSnapshot(to path: String) {
        panel.setFrameOrigin(NSPoint(x: 100, y: 100))
        panel.orderFrontRegardless()
        js("duck.base('idle'); duck.say('Snapshot check', 0, 0, 280)")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [self] in
            snapshotNow(to: path) { rep in
                guard let rep else { exit(2) }
                let corner = rep.colorAt(x: 2, y: 2)
                var opaque = 0
                for y in 0..<rep.pixelsHigh {
                    for x in 0..<rep.pixelsWide where (rep.colorAt(x: x, y: y)?.alphaComponent ?? 0) > 0.5 { opaque += 1 }
                }
                print("corner alpha: \(corner?.alphaComponent ?? -1), opaque pixels: \(opaque) of \(rep.pixelsWide * rep.pixelsHigh)")
                exit(0)
            }
        }
    }
}

// MARK: - Entry point

func argument(_ name: String) -> String? {
    let args = CommandLine.arguments
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    return args[i + 1]
}

func defaultStateDir() -> URL {
    let home = ProcessInfo.processInfo.environment["COPILOT_HOME"].map { URL(fileURLWithPath: $0) }
        ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".copilot")
    return home.appendingPathComponent("state/little-intermissions")
}

let stateDir = argument("--state").map { URL(fileURLWithPath: $0) } ?? defaultStateDir()
try? FileManager.default.createDirectory(at: stateDir, withIntermediateDirectories: true)

guard let spritePath = argument("--sprite") else {
    FileHandle.standardError.write(Data("usage: duck --sprite <sprite.html> [--state <dir>]\n".utf8))
    exit(64)
}

let snapshotPath = argument("--snapshot")
if snapshotPath == nil {
    let lockFD = open(stateDir.appendingPathComponent("duck.lock").path, O_CREAT | O_RDWR, 0o600)
    if lockFD < 0 || flock(lockFD, LOCK_EX | LOCK_NB) != 0 {
        print("The duck is already on duty.")
        exit(0)
    }
}

var keepAlive: [Any] = []

MainActor.assumeIsolated {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let controller = DuckController(
        stateDir: stateDir,
        spriteURL: URL(fileURLWithPath: spritePath),
        snapshotPath: snapshotPath,
        nudgeSeconds: argument("--nudge-seconds").flatMap(Double.init),
        lullSeconds: argument("--lull-seconds").flatMap(Double.init) ?? 8,
        idleFile: argument("--idle-file"),
        testHooks: CommandLine.arguments.contains("--test-hooks")
    )
    keepAlive.append(controller)

    for (sig, action) in [
        (SIGTERM, { (c: DuckController) in c.goHome(force: c.mode == .leaving) }),
        (SIGINT, { (c: DuckController) in c.goHome(force: c.mode == .leaving) }),
        (SIGUSR1, { (c: DuckController) in c.hello() }),
        (SIGUSR2, { (c: DuckController) in c.coverNow() }),
    ] as [(Int32, (DuckController) -> Void)] {
        signal(sig, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
        source.setEventHandler { [weak controller] in
            if let controller { action(controller) }
        }
        source.resume()
        keepAlive.append(source)
    }

    controller.start()
    app.run()
}
