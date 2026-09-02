import CoreGraphics
import Foundation
import ScreenCaptureKit

/// Single-window screenshot through ScreenCaptureKit (macOS 14+). Bridges the
/// async API into the synchronous command queue with a bounded wait.
enum ScreenCaptureKitCapture {
    private static let timeoutSeconds: Double = 10

    private final class Box {
        private let lock = NSLock()
        private var stored: Result<CGImage, MessageError>?

        func set(_ value: Result<CGImage, MessageError>) {
            lock.lock()
            stored = value
            lock.unlock()
        }

        var value: Result<CGImage, MessageError>? {
            lock.lock()
            defer { lock.unlock() }
            return stored
        }
    }

    static func capture(windowId: CGWindowID, pointSize: CGSize, scale: Double) -> Result<CGImage, MessageError> {
        let box = Box()
        let semaphore = DispatchSemaphore(value: 0)
        Task.detached(priority: .userInitiated) {
            box.set(await captureAsync(windowId: windowId, pointSize: pointSize, scale: scale))
            semaphore.signal()
        }
        if semaphore.wait(timeout: .now() + timeoutSeconds) == .timedOut {
            return .failure(MessageError(message: "ScreenCaptureKit capture timed out after \(Int(timeoutSeconds)) s"))
        }
        return box.value ?? .failure(MessageError(message: "ScreenCaptureKit produced no result"))
    }

    private static func captureAsync(windowId: CGWindowID, pointSize: CGSize, scale: Double) async -> Result<CGImage, MessageError> {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            guard let window = content.windows.first(where: { $0.windowID == windowId }) else {
                return .failure(MessageError(message: "window \(windowId) is not shareable"))
            }
            let filter = SCContentFilter(desktopIndependentWindow: window)
            let configuration = SCStreamConfiguration()
            configuration.width = max(1, Int((pointSize.width * scale).rounded()))
            configuration.height = max(1, Int((pointSize.height * scale).rounded()))
            configuration.showsCursor = false
            configuration.captureResolution = .best
            let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
            return .success(image)
        } catch {
            return .failure(MessageError(message: error.localizedDescription))
        }
    }
}
