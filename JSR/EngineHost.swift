// EngineHost.swift — Jay's Sight Reading
// Starts the in-process Hummingbird server and CoreMIDI listener.
// JSR's server is a thin MIDI relay: it forwards note events to
// all connected WebSocket clients as JSON. Exercise logic lives
// entirely in the React/TypeScript web layer.
//
// Ports 8089 → 8090 → 8091 tried in order (same as JSP-iPad).

import Foundation
import Hummingbird
import HummingbirdWebSocket

actor EngineHost {

    static let shared = EngineHost()

    enum State {
        case idle
        case starting
        case running(port: Int)
        case failed(String)
    }

    private(set) var state: State = .idle
    private static let candidatePorts = [8089, 8090, 8091]
    private var serving = false

    func ensureStarted() {
        guard !serving else { return }
        serving = true
        state = .starting
        Task { await self.run() }
    }

    private func run() async {
        let hub  = WebSocketHub()
        let midi = MidiInput()
        let coordinator = MidiCoordinator(hub: hub, midi: midi)

        // Build the WebSocket router.
        let wsRouter = Router(context: BasicWebSocketRequestContext.self)
        wsRouter.ws("/ws") { inbound, outbound, _ in
            let id = UUID()
            var continuation: AsyncStream<String>.Continuation!
            let outbox = AsyncStream<String>(bufferingPolicy: .bufferingNewest(1)) { c in continuation = c }
            await hub.register(WebSocketSubscription(id: id, outbox: continuation))
            defer { Task { await hub.unregister(id: id) } }

            // Send current MIDI state immediately on connect.
            Task { await coordinator.broadcastMidiState() }

            let decoder = JSONDecoder()
            try await withThrowingTaskGroup(of: Void.self) { group in
                group.addTask {
                    for await message in outbox {
                        try await outbound.write(.text(message))
                    }
                }
                group.addTask {
                    for try await message in inbound.messages(maxSize: 1 << 20) {
                        guard case .text(let text) = message else { continue }
                        guard let data = text.data(using: .utf8),
                              let cmd  = try? decoder.decode(InboundCommand.self, from: data)
                        else { continue }
                        switch cmd.type {
                        case "startMidi":
                            await coordinator.startMidi()
                        case "stopMidi":
                            await coordinator.stopMidi()
                        default:
                            break
                        }
                    }
                    continuation.finish()
                }
                try await group.next()
                group.cancelAll()
            }
        }

        // Locate web/dist inside the app bundle.
        let staticDir: String? = {
            if let indexURL = Bundle.main.url(forResource: "index",
                                              withExtension: "html",
                                              subdirectory: "dist") {
                return indexURL.deletingLastPathComponent().path
            }
            if let base = Bundle.main.resourcePath {
                let candidate = base + "/dist"
                if FileManager.default.fileExists(atPath: candidate) {
                    return candidate
                }
            }
            NSLog("EngineHost: web/dist not found — UI will not load")
            return nil
        }()

        var lastError = "The reading engine could not start."
        for port in Self.candidatePorts {
            do {
                let config = ServerConfig(port: port, staticDir: staticDir, devMode: false)
                let app = try makeApplication(config: config, webSocketRouter: wsRouter)
                state = .running(port: port)
                // Start MIDI relay automatically.
                Task { await coordinator.run() }
                try await app.runService()
                lastError = "The reading engine stopped unexpectedly."
            } catch {
                lastError = error.localizedDescription
                NSLog("EngineHost: port %ld failed — %@", port, error.localizedDescription)
            }
        }
        state = .failed(lastError)
        serving = false
    }
}
