import AppKit
import Foundation
import HelperCore

/// Owns either a live observation session or a fixture replay. All start and
/// stop work runs on the main thread because the AX observer and event tap
/// attach to the main run loop.
final class ObservationManager {
    private let writer: OutputWriter
    private var live: LiveObservation?
    private var fixture: FixturePlayer?

    init(writer: OutputWriter) {
        self.writer = writer
    }

    func start(params: [String: JSONValue]) -> Result<JSONValue, HelperError> {
        if let path = params["fixturePath"]?.stringValue {
            return startFixture(path: path)
        }
        let threshold = params["idleThresholdSeconds"]?.doubleValue ?? ProtocolConstants.defaultIdleThresholdSeconds
        guard threshold > 0, threshold.isFinite else {
            return .failure(HelperError(.invalidRequest, "idleThresholdSeconds must be a positive number"))
        }
        return .success(onMain { startLive(idleThreshold: threshold) })
    }

    func startFixture(path: String) -> Result<JSONValue, HelperError> {
        switch FixturePlayer.load(path: path) {
        case let .failure(error):
            return .failure(error)
        case let .success(records):
            onMain { stopAll() }
            let player = FixturePlayer(records: records, writer: writer)
            player.onFinished = { [weak self] in
                guard let self else { return }
                self.fixture = nil
                self.writer.emit(.observationState, data: ["observing": .bool(false), "fixture": .bool(true), "completed": .bool(true)])
            }
            fixture = player
            let state: [String: JSONValue] = ["observing": .bool(true), "fixture": .bool(true), "eventCount": .int(records.count)]
            writer.emit(.observationState, data: state)
            Log.info("fixture replay started: \(path) (\(records.count) events)")
            player.start()
            return .success(.object(state))
        }
    }

    /// Emits `observationState` only when something was actually running so
    /// repeated stops and shutdown do not spam idle state events.
    func stop() -> JSONValue {
        let wasActive = onMain { () -> Bool in
            let active = live != nil || fixture != nil
            stopAll()
            return active
        }
        let state: [String: JSONValue] = ["observing": .bool(false), "fixture": .bool(false)]
        if wasActive { writer.emit(.observationState, data: state) }
        return .object(state)
    }

    private func startLive(idleThreshold: Double) -> JSONValue {
        stopAll()
        let session = LiveObservation(writer: writer, idleThreshold: idleThreshold)
        let state = session.start()
        live = session
        writer.emit(.observationState, data: state)
        return .object(state)
    }

    private func stopAll() {
        live?.stop()
        live = nil
        fixture?.stop()
        fixture = nil
    }

    private func onMain<T>(_ work: () -> T) -> T {
        if Thread.isMainThread { return work() }
        return DispatchQueue.main.sync(execute: work)
    }
}

/// Wires the live observers together and translates callbacks into events.
final class LiveObservation {
    private let writer: OutputWriter
    private let workspace = WorkspaceObserver()
    private let titles = WindowTitleObserver()
    private let tap = InputEventTap()
    private let polling: PollingMonitors
    private var currentBundleId = ""

    init(writer: OutputWriter, idleThreshold: Double) {
        self.writer = writer
        self.polling = PollingMonitors(idleThresholdSeconds: idleThreshold)
    }

    func start() -> [String: JSONValue] {
        titles.onTitleChanged = { [weak self] title, windowId in
            guard let self else { return }
            var data: [String: JSONValue] = ["bundleId": .string(currentBundleId), "title": .string(String(title.prefix(512)))]
            if let windowId { data["windowId"] = .int(Int(windowId)) }
            writer.emit(.windowTitleChanged, data: data)
        }
        titles.onSecureFieldFocused = { [weak self] role in
            guard let self else { return }
            writer.emit(.secureFieldFocused, data: ["bundleId": .string(currentBundleId), "role": .string(role)])
        }
        workspace.onActivate = { [weak self] app in self?.handleActivation(app) }
        tap.onMouseDown = { [weak self] location, button in
            guard let self else { return }
            writer.emit(.mouseDown, data: [
                "x": .number(location.x), "y": .number(location.y),
                "button": .string(button.rawValue), "bundleId": .string(currentBundleId)
            ])
        }
        tap.onShortcut = { [weak self] keys in
            guard let self else { return }
            writer.emit(.shortcut, data: ["keys": .array(keys.map(JSONValue.string)), "bundleId": .string(currentBundleId)])
        }
        polling.onClipboardChanged = { [weak self] count in
            self?.writer.emit(.clipboardChanged, data: ["changeCount": .int(count)])
        }
        polling.onIdleChanged = { [weak self] idle, seconds in
            self?.writer.emit(.idleChanged, data: ["idle": .bool(idle), "idleSeconds": .number(seconds)])
        }
        polling.onSecureInputEnabled = { [weak self] in
            guard let self else { return }
            writer.emit(.secureFieldFocused, data: ["bundleId": .string(currentBundleId), "role": .string("secureEventInput")])
        }

        workspace.start()
        let mouseEvents = tap.start()
        var accessibility = false
        if let app = NSWorkspace.shared.frontmostApplication {
            currentBundleId = app.bundleIdentifier ?? ""
            emitFrontmost(app)
            accessibility = titles.attach(pid: app.processIdentifier)
        } else {
            accessibility = AXIsProcessTrusted()
        }
        polling.start()
        if !accessibility { Log.warn("Accessibility not granted; window title and secure-field events disabled") }
        return [
            "observing": .bool(true),
            "fixture": .bool(false),
            "mouseEvents": .bool(mouseEvents),
            "accessibilityEvents": .bool(accessibility),
            "idleThresholdSeconds": .number(polling.idleThresholdSeconds)
        ]
    }

    func stop() {
        polling.stop()
        tap.stop()
        titles.detach()
        workspace.stop()
    }

    private func handleActivation(_ app: NSRunningApplication) {
        currentBundleId = app.bundleIdentifier ?? ""
        emitFrontmost(app)
        titles.attach(pid: app.processIdentifier)
    }

    private func emitFrontmost(_ app: NSRunningApplication) {
        writer.emit(.frontmostAppChanged, data: [
            "bundleId": .string(app.bundleIdentifier ?? ""),
            "name": .string(String((app.localizedName ?? "").prefix(128))),
            "pid": .int(Int(app.processIdentifier))
        ])
    }
}
