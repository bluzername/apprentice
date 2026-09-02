import AppKit
import Foundation

/// Timer-driven monitors: pasteboard change count (1 s, never contents),
/// secure event input transitions (1 s), and idle state (5 s).
final class PollingMonitors {
    private let queue = DispatchQueue(label: "apprentice.helper.polling")
    private var fastTimer: DispatchSourceTimer?
    private var idleTimer: DispatchSourceTimer?
    private var lastChangeCount: Int
    private var lastSecureInput = false
    private var lastIdle = false
    let idleThresholdSeconds: Double

    var onClipboardChanged: ((_ changeCount: Int) -> Void)?
    var onSecureInputEnabled: (() -> Void)?
    var onIdleChanged: ((_ idle: Bool, _ idleSeconds: Double) -> Void)?

    init(idleThresholdSeconds: Double) {
        self.idleThresholdSeconds = idleThresholdSeconds
        self.lastChangeCount = NSPasteboard.general.changeCount
    }

    func start() {
        stop()
        lastChangeCount = NSPasteboard.general.changeCount
        lastSecureInput = SecureInput.isEnabled
        lastIdle = IdleTime.secondsSinceLastInput() >= idleThresholdSeconds

        let fast = DispatchSource.makeTimerSource(queue: queue)
        fast.schedule(deadline: .now() + 1, repeating: 1)
        fast.setEventHandler { [weak self] in self?.pollFast() }
        fast.resume()
        fastTimer = fast

        let idle = DispatchSource.makeTimerSource(queue: queue)
        idle.schedule(deadline: .now() + 5, repeating: 5)
        idle.setEventHandler { [weak self] in self?.pollIdle() }
        idle.resume()
        idleTimer = idle
    }

    func stop() {
        fastTimer?.cancel()
        idleTimer?.cancel()
        fastTimer = nil
        idleTimer = nil
    }

    private func pollFast() {
        let count = NSPasteboard.general.changeCount
        if count != lastChangeCount {
            lastChangeCount = count
            onClipboardChanged?(count)
        }
        let secure = SecureInput.isEnabled
        if secure && !lastSecureInput {
            onSecureInputEnabled?()
        }
        lastSecureInput = secure
    }

    private func pollIdle() {
        let seconds = IdleTime.secondsSinceLastInput()
        let idle = seconds >= idleThresholdSeconds
        if idle != lastIdle {
            lastIdle = idle
            onIdleChanged?(idle, idle ? seconds : 0)
        }
    }
}
