import Foundation
import HelperCore

/// stdin reader plus dispatch. Commands run on a serial queue in arrival
/// order; emergencyStop bypasses the queue so it responds even while an action
/// sequence is in flight.
final class HelperServer {
    let writer: OutputWriter
    private let stopFlag = StopFlag()
    private let performer: ActionPerformer
    private let observation: ObservationManager
    private let router: CommandRouter
    private let commandQueue = DispatchQueue(label: "apprentice.helper.commands")
    private let fixturePath: String?
    private var shuttingDown = false

    init(fixturePath: String?, approvalSecret: ApprovalSecret?) {
        self.fixturePath = fixturePath
        let writer = OutputWriter(sequencer: EventSequencer())
        self.writer = writer
        self.performer = ActionPerformer(stopFlag: stopFlag)
        self.observation = ObservationManager(writer: writer)
        self.router = CommandRouter(stopFlag: stopFlag, performer: performer, observation: observation, approvalSecret: approvalSecret)
    }

    func start() {
        writer.emit(.helperReady, data: [
            "helperVersion": .string(ProtocolConstants.helperVersion),
            "protocolVersion": .string(ProtocolConstants.protocolVersion),
            "pid": .int(Int(ProcessInfo.processInfo.processIdentifier))
        ])
        if let fixturePath {
            commandQueue.async { [self] in
                if case let .failure(error) = observation.startFixture(path: fixturePath) {
                    Log.error("--fixture failed: \(error.message)")
                }
            }
        }
        let reader = Thread { [self] in readLoop() }
        reader.name = "apprentice.helper.stdin"
        reader.start()
    }

    private func readLoop() {
        while let line = readLine(strippingNewline: true) {
            handle(line: line)
        }
        Log.info("stdin closed; shutting down after queued commands finish")
        commandQueue.async { [self] in shutdown() }
    }

    func handle(line: String) {
        if shuttingDown || line.trimmingCharacters(in: .whitespaces).isEmpty { return }
        switch RequestDecoder.decode(line: line) {
        case let .failure(id, error):
            writer.respond(id: id, error: error)
        case let .request(request):
            switch request.command {
            case .emergencyStop:
                handleEmergencyStop(request)
            case .shutdown:
                commandQueue.async { [self] in
                    writer.respond(id: request.id, result: .object(["shuttingDown": .bool(true)]))
                    shutdown()
                }
            default:
                commandQueue.async { [self] in
                    writer.respond(id: request.id, router.handle(request))
                }
            }
        }
    }

    private func handleEmergencyStop(_ request: HelperRequest) {
        let clear = request.params["clear"]?.boolValue ?? false
        if clear {
            stopFlag.clear()
            Log.info("emergency stop cleared")
        } else {
            stopFlag.set()
            performer.releaseHeldModifiers()
            Log.info("emergency stop engaged")
        }
        writer.respond(id: request.id, result: .object(["stopped": .bool(stopFlag.isSet)]))
    }

    /// Runs on the command queue so every earlier request has been answered.
    private func shutdown() -> Never {
        shuttingDown = true
        _ = observation.stop()
        performer.releaseHeldModifiers()
        writer.flush()
        exit(0)
    }
}
