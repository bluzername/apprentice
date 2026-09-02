import CoreGraphics
import Foundation
import HelperCore

/// Executes a `ValidatedAction` with CGEvent. Every loop checks the stop flag
/// so an emergencyStop cancels in-flight sequences between steps.
final class ActionPerformer {
    private let stopFlag: StopFlag
    private let keyboard: KeyboardActions
    private let source = CGEventSource(stateID: .combinedSessionState)

    init(stopFlag: StopFlag) {
        self.stopFlag = stopFlag
        self.keyboard = KeyboardActions(stopFlag: stopFlag)
    }

    func perform(_ validated: ValidatedAction) -> Result<JSONValue, HelperError> {
        guard !stopFlag.isSet else { return .failure(Self.stoppedError) }
        let started = Date()
        let outcome: Result<Void, HelperError>
        switch validated.action {
        case let .click(x, y, button):
            outcome = click(at: CGPoint(x: x, y: y), button: button, count: 1)
        case let .doubleClick(x, y):
            outcome = click(at: CGPoint(x: x, y: y), button: .left, count: 2)
        case let .move(x, y):
            outcome = post(.mouseMoved, at: CGPoint(x: x, y: y), button: .left)
        case let .scroll(x, y, deltaX, deltaY):
            outcome = scroll(at: CGPoint(x: x, y: y), deltaX: deltaX, deltaY: deltaY)
        case let .typeText(text):
            outcome = keyboard.typeText(text)
        case let .pressKey(_, keyCode):
            outcome = keyboard.pressKey(keyCode: keyCode, flags: [])
        case let .hotkey(modifiers, _, keyCode):
            outcome = keyboard.hotkey(modifiers: modifiers, keyCode: keyCode)
        case let .wait(ms):
            outcome = wait(ms: ms)
        }
        let durationMs = Date().timeIntervalSince(started) * 1000
        return outcome.map { .object(["performed": .bool(true), "durationMs": .number(durationMs)]) }
    }

    /// Called by emergencyStop from the reader thread; releases modifier keys
    /// that a hotkey sequence may still be holding.
    func releaseHeldModifiers() {
        keyboard.releaseHeldModifiers()
    }

    static let stoppedError = HelperError(.emergencyStopped, "emergency stop is active")

    // MARK: - Pointer

    private func click(at point: CGPoint, button: MouseButton, count: Int) -> Result<Void, HelperError> {
        let (down, up, cgButton) = Self.buttonEvents(button)
        if case let .failure(error) = post(.mouseMoved, at: point, button: cgButton) { return .failure(error) }
        usleep(15_000)
        for clickState in 1...count {
            guard !stopFlag.isSet else { return .failure(Self.stoppedError) }
            if case let .failure(error) = post(down, at: point, button: cgButton, clickState: clickState) { return .failure(error) }
            usleep(20_000)
            if case let .failure(error) = post(up, at: point, button: cgButton, clickState: clickState) { return .failure(error) }
            if clickState < count { usleep(60_000) }
        }
        return .success(())
    }

    private func scroll(at point: CGPoint, deltaX: Int, deltaY: Int) -> Result<Void, HelperError> {
        if case let .failure(error) = post(.mouseMoved, at: point, button: .left) { return .failure(error) }
        // Protocol convention: positive deltaY scrolls content down (browser wheel
        // semantics). CoreGraphics treats positive wheel1 as scrolling up, so negate.
        guard let event = CGEvent(scrollWheelEvent2Source: source, units: .pixel, wheelCount: 2,
                                  wheel1: Int32(clamping: -deltaY), wheel2: Int32(clamping: -deltaX), wheel3: 0) else {
            return .failure(HelperError(.internalError, "could not create scroll event"))
        }
        event.location = point
        event.post(tap: .cghidEventTap)
        return .success(())
    }

    private func post(_ type: CGEventType, at point: CGPoint, button: CGMouseButton,
                      clickState: Int = 1) -> Result<Void, HelperError> {
        guard let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: button) else {
            return .failure(HelperError(.internalError, "could not create mouse event"))
        }
        event.setIntegerValueField(.mouseEventClickState, value: Int64(clickState))
        event.post(tap: .cghidEventTap)
        return .success(())
    }

    private static func buttonEvents(_ button: MouseButton) -> (CGEventType, CGEventType, CGMouseButton) {
        switch button {
        case .left: return (.leftMouseDown, .leftMouseUp, .left)
        case .right: return (.rightMouseDown, .rightMouseUp, .right)
        case .middle: return (.otherMouseDown, .otherMouseUp, .center)
        }
    }

    // MARK: - Wait

    private func wait(ms: Int) -> Result<Void, HelperError> {
        let deadline = Date().addingTimeInterval(Double(ms) / 1000)
        while Date() < deadline {
            guard !stopFlag.isSet else { return .failure(Self.stoppedError) }
            let remaining = deadline.timeIntervalSinceNow
            usleep(UInt32(max(0, min(0.05, remaining)) * 1_000_000))
        }
        return .success(())
    }
}
