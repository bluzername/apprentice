import ApplicationServices
import Foundation
import HelperCore

/// AX observer attached to the frontmost application. Reports focused-window
/// title changes and secure-field focus. Re-attached on every app switch.
final class WindowTitleObserver {
    private var observer: AXObserver?
    private var appElement: AXUIElement?
    private var pid: pid_t = 0
    private var lastTitle: String?

    var onTitleChanged: ((_ title: String, _ windowId: CGWindowID?) -> Void)?
    var onSecureFieldFocused: ((_ role: String) -> Void)?

    private static let notifications = [
        kAXFocusedWindowChangedNotification,
        kAXTitleChangedNotification,
        kAXFocusedUIElementChangedNotification
    ]

    private static let callback: AXObserverCallback = { _, element, notification, refcon in
        guard let refcon else { return }
        let owner = Unmanaged<WindowTitleObserver>.fromOpaque(refcon).takeUnretainedValue()
        owner.handle(notification: notification as String, element: element)
    }

    /// Returns false when Accessibility is not granted or the app cannot be observed.
    @discardableResult
    func attach(pid newPid: pid_t) -> Bool {
        detach()
        guard AXIsProcessTrusted() else { return false }
        var created: AXObserver?
        guard AXObserverCreate(newPid, Self.callback, &created) == .success, let created else {
            Log.warn("AXObserverCreate failed for pid \(newPid)")
            return false
        }
        let app = AXAttributes.application(pid: newPid)
        let refcon = Unmanaged.passUnretained(self).toOpaque()
        var added = 0
        for name in Self.notifications where AXObserverAddNotification(created, app, name as CFString, refcon) == .success {
            added += 1
        }
        guard added > 0 else {
            Log.warn("no AX notifications could be registered for pid \(newPid)")
            return false
        }
        CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(created), .commonModes)
        observer = created
        appElement = app
        pid = newPid
        lastTitle = nil
        emitCurrentTitle()
        return true
    }

    func detach() {
        if let observer, let appElement {
            for name in Self.notifications {
                AXObserverRemoveNotification(observer, appElement, name as CFString)
            }
            CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes)
        }
        observer = nil
        appElement = nil
        pid = 0
        lastTitle = nil
    }

    private func focusedWindow() -> AXUIElement? {
        guard let appElement else { return nil }
        return AXAttributes.element(appElement, kAXFocusedWindowAttribute)
    }

    private func emitCurrentTitle() {
        guard let window = focusedWindow() else { return }
        emitTitle(of: window)
    }

    private func emitTitle(of window: AXUIElement) {
        let title = AXAttributes.string(window, kAXTitleAttribute) ?? ""
        guard title != lastTitle else { return }
        lastTitle = title
        let windowId = WindowList.frontmostWindow(pid: pid, preferredTitle: title)?.id
        onTitleChanged?(title, windowId)
    }

    fileprivate func handle(notification: String, element: AXUIElement) {
        switch notification {
        case kAXFocusedWindowChangedNotification:
            emitTitle(of: element)
        case kAXTitleChangedNotification:
            let role = AXAttributes.string(element, kAXRoleAttribute) ?? ""
            guard role == kAXWindowRole else { return }
            if let focused = focusedWindow(), !CFEqual(focused, element) { return }
            emitTitle(of: element)
        case kAXFocusedUIElementChangedNotification:
            let role = AXAttributes.string(element, kAXRoleAttribute) ?? ""
            let subrole = AXAttributes.string(element, kAXSubroleAttribute)
            if AXRoleMapping.isSecure(axRole: role, subrole: subrole) {
                onSecureFieldFocused?(subrole == kAXSecureTextFieldSubrole ? kAXSecureTextFieldSubrole : role)
            }
        default:
            break
        }
    }
}
