import ApplicationServices
import Foundation
import HelperCore

/// Maps a decoded request to its handler. Runs on the serial command queue;
/// emergencyStop and shutdown are intercepted earlier by `HelperServer`.
final class CommandRouter {
    private let stopFlag: StopFlag
    private let performer: ActionPerformer
    private let observation: ObservationManager

    init(stopFlag: StopFlag, performer: ActionPerformer, observation: ObservationManager) {
        self.stopFlag = stopFlag
        self.performer = performer
        self.observation = observation
    }

    func handle(_ request: HelperRequest) -> Result<JSONValue, HelperError> {
        switch request.command {
        case .ping:
            return .success(.object([
                "pong": .bool(true),
                "ts": .number(Date().timeIntervalSince1970 * 1000),
                "stopped": .bool(stopFlag.isSet)
            ]))
        case .capabilities:
            return .success(CapabilitiesBuilder.current().toJSON())
        case .permissionStatus:
            return .success(Permissions.statusJSON())
        case .requestAccessibilityPermission:
            let granted = Permissions.requestAccessibility()
            Log.info("accessibility prompt requested; trusted=\(granted)")
            return .success(Permissions.statusJSON())
        case .requestScreenRecordingPermission:
            let granted = Permissions.requestScreenRecording()
            Log.info("screen recording prompt requested; granted=\(granted)")
            return .success(Permissions.statusJSON())
        case .startObservation:
            return observation.start(params: request.params)
        case .stopObservation:
            return .success(observation.stop())
        case .frontmostContext:
            return FrontmostContext.current()
        case .captureFrontmostWindow:
            return WindowCapture.captureFrontmostWindow()
        case .ocrImage:
            return VisionOCR.recognize(params: request.params)
        case .focusedElement:
            return AXInspector.focusedElement()
        case .accessibilityContextAtPoint:
            return AXInspector.context(params: request.params)
        case .performAction:
            return performAction(request.params)
        case .emergencyStop:
            return .success(.object(["stopped": .bool(stopFlag.isSet)]))
        case .shutdown:
            return .success(.object(["shuttingDown": .bool(true)]))
        }
    }

    private func performAction(_ params: [String: JSONValue]) -> Result<JSONValue, HelperError> {
        guard !stopFlag.isSet else { return .failure(ActionPerformer.stoppedError) }
        guard AXIsProcessTrusted() else {
            return .failure(HelperError(.permissionDenied, "Accessibility permission is required to perform actions"))
        }
        let displays = DisplayInfo.displayRects()
        guard !displays.isEmpty else {
            return .failure(HelperError(.notAvailable, "no active displays"))
        }
        return ActionValidator.validate(params: params, displays: displays).flatMap { validated in
            Log.info("performing \(validated.action.typeName)")
            return performer.perform(validated)
        }
    }
}
