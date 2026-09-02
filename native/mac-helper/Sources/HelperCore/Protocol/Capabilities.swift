/// Mirror of CapabilitiesResultSchema.
public struct Capabilities: Equatable {
    public struct Features: Equatable {
        public let accessibility: Bool
        public let screenCaptureKit: Bool
        public let cgEvents: Bool
        public let visionOcr: Bool
        public let fixtureStream: Bool

        public init(accessibility: Bool, screenCaptureKit: Bool, cgEvents: Bool,
                    visionOcr: Bool, fixtureStream: Bool) {
            self.accessibility = accessibility
            self.screenCaptureKit = screenCaptureKit
            self.cgEvents = cgEvents
            self.visionOcr = visionOcr
            self.fixtureStream = fixtureStream
        }
    }

    public let helperVersion: String
    public let protocolVersion: String
    public let arch: String
    public let macosVersion: String
    public let features: Features

    public init(arch: String, macosVersion: String, features: Features,
                helperVersion: String = ProtocolConstants.helperVersion,
                protocolVersion: String = ProtocolConstants.protocolVersion) {
        self.helperVersion = helperVersion
        self.protocolVersion = protocolVersion
        self.arch = arch
        self.macosVersion = macosVersion
        self.features = features
    }

    public func toJSON() -> JSONValue {
        .object([
            "helperVersion": .string(helperVersion),
            "protocolVersion": .string(protocolVersion),
            "arch": .string(arch),
            "macosVersion": .string(macosVersion),
            "features": .object([
                "accessibility": .bool(features.accessibility),
                "screenCaptureKit": .bool(features.screenCaptureKit),
                "cgEvents": .bool(features.cgEvents),
                "visionOcr": .bool(features.visionOcr),
                "fixtureStream": .bool(features.fixtureStream)
            ])
        ])
    }
}
