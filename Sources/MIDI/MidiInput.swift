//
//  MidiInput.swift
//  jsp-engine
//
//  CoreMIDI listener that translates incoming MIDI 1.0 channel-voice
//  messages into pure-Swift `NoteEvent`s and surfaces them via an
//  `AsyncStream`.
//
//  Design notes
//  ------------
//  * Not an actor and not `@MainActor`. CoreMIDI calls our receive
//    block from a real-time audio thread, so we cannot enter any
//    actor synchronously from there. Internal state is guarded by
//    a single `NSLock`.
//  * `AsyncStream.Continuation.yield(_:)` is documented as safe to
//    call from any thread, so we yield directly from the receive
//    block without an extra hop.
//  * Hot-plug of MIDI sources is handled via the client's
//    notification block. New sources auto-connect on
//    `msgObjectAdded`/`msgSetupChanged`.
//
import Foundation
#if canImport(CoreMIDI)
import CoreMIDI
#endif

/// A `NoteEvent` tagged with the display name of the CoreMIDI source
/// that produced it, so the coordinator can filter to the active
/// keyboard and key per-device range calibration by name.
public struct SourcedNoteEvent: Equatable {
    public let event: NoteEvent
    public let sourceName: String

    public init(event: NoteEvent, sourceName: String) {
        self.event = event
        self.sourceName = sourceName
    }
}

public final class MidiInput: @unchecked Sendable {

    // MARK: - State (lock-protected)

    private let lock = NSLock()

    #if canImport(CoreMIDI)
    private var client: MIDIClientRef = 0
    private var inputPort: MIDIPortRef = 0
    private var connectedSources: Set<MIDIEndpointRef> = []
    /// Display names captured at connect time, used to tag events.
    private var sourceNamesByEndpoint: [MIDIEndpointRef: String] = [:]
    #endif

    private var continuation: AsyncStream<SourcedNoteEvent>.Continuation?
    /// Invoked (off-lock) whenever the set of connected sources changes.
    private var sourcesChangedHandler: (@Sendable () -> Void)?
    private var running: Bool = false
    private var lastError: String?
    /// Host-time (`mach_absolute_time`) boundary set by `flushPending()`.
    /// Events whose receive timestamp is earlier than this are dropped
    /// in `emit(_:from:)`, so a freshly-connected session never replays
    /// keys the user pressed before tapping Connect MIDI.
    private var acceptFromHostTime: UInt64 = 0

    public init() {}

    // MARK: - Public surface

    /// Latest setup error, if any. Useful for the snapshot's debug
    /// log.
    public func currentError() -> String? {
        lock.lock(); defer { lock.unlock() }
        return lastError
    }

    /// Whether `start()` has been called and CoreMIDI setup succeeded.
    public func isRunning() -> Bool {
        lock.lock(); defer { lock.unlock() }
        return running
    }

    /// Snapshot of currently-connected MIDI source display names.
    public func currentSourceNames() -> [String] {
        lock.lock(); defer { lock.unlock() }
        #if canImport(CoreMIDI)
        return connectedSources
            .map { displayName(of: $0) }
            .sorted()
        #else
        return []
        #endif
    }

    /// Register a callback fired whenever sources attach/detach
    /// (hot-plug). Invoked outside the internal lock.
    public func setSourcesChangedHandler(_ handler: @escaping @Sendable () -> Void) {
        lock.lock(); defer { lock.unlock() }
        sourcesChangedHandler = handler
    }

    /// Returns an AsyncStream of note events. Only one active stream
    /// is supported in v0; calling `events()` again replaces the
    /// continuation (the previous stream finishes).
    public func events() -> AsyncStream<SourcedNoteEvent> {
        AsyncStream<SourcedNoteEvent> { newContinuation in
            self.lock.lock()
            self.continuation?.finish()
            self.continuation = newContinuation
            self.lock.unlock()

            newContinuation.onTermination = { [weak self] _ in
                guard let self else { return }
                self.lock.lock()
                self.continuation = nil
                self.lock.unlock()
            }
        }
    }

    /// Spin up the CoreMIDI client and input port, and connect any
    /// sources that already exist. Idempotent.
    public func start() {
        #if canImport(CoreMIDI)
        lock.lock()
        guard !running else { lock.unlock(); return }
        lock.unlock()

        let clientName = "JSP MIDI Client" as CFString
        var newClient: MIDIClientRef = 0
        let clientStatus = MIDIClientCreateWithBlock(clientName, &newClient) { [weak self] notificationPtr in
            guard let self else { return }
            let messageID = notificationPtr.pointee.messageID
            switch messageID {
            case .msgObjectAdded, .msgObjectRemoved, .msgSetupChanged:
                self.refreshSources()
            default:
                break
            }
        }
        guard clientStatus == noErr else {
            recordError("MIDIClientCreateWithBlock failed: \(clientStatus)")
            return
        }

        let portName = "JSP Input Port" as CFString
        var newPort: MIDIPortRef = 0
        let portStatus = MIDIInputPortCreateWithProtocol(
            newClient,
            portName,
            ._1_0,
            &newPort
        ) { [weak self] eventListPtr, srcConnRefCon in
            self?.dispatchEventList(eventListPtr, refCon: srcConnRefCon)
        }
        guard portStatus == noErr else {
            recordError("MIDIInputPortCreateWithProtocol failed: \(portStatus)")
            MIDIClientDispose(newClient)
            return
        }

        lock.lock()
        client = newClient
        inputPort = newPort
        running = true
        lock.unlock()

        // Initial source attach happens after `running = true` so a
        // subsequent refresh can find the port.
        refreshSources()
        #else
        recordError("CoreMIDI not available on this platform")
        #endif
    }

    /// Tear down the client/port. Idempotent.
    public func stop() {
        #if canImport(CoreMIDI)
        lock.lock()
        guard running else { lock.unlock(); return }
        let port = inputPort
        let cli = client
        let toDisconnect = connectedSources
        connectedSources.removeAll()
        sourceNamesByEndpoint.removeAll()
        inputPort = 0
        client = 0
        running = false
        lock.unlock()

        for source in toDisconnect {
            MIDIPortDisconnectSource(port, source)
        }
        if port != 0 { MIDIPortDispose(port) }
        if cli != 0 { MIDIClientDispose(cli) }
        #endif
    }

    /// Trigger a manual source scan — connects any newly-appeared
    /// CoreMIDI sources and disconnects any that have vanished.
    /// Safe to call from any thread at any time (idempotent if already
    /// up-to-date). Does nothing if MIDI has not been started yet.
    public func refresh() {
        #if canImport(CoreMIDI)
        refreshSources()
        #endif
    }

    /// Discard MIDI received before "now" so connecting doesn't replay
    /// keys the user pressed (or held) beforehand. Records a host-time
    /// boundary; `emit(_:from:)` drops events stamped earlier than it.
    /// Must be called before the event stream begins consuming so the
    /// boundary is in force before any event can be buffered. Safe to
    /// call from any thread; idempotent.
    public func flushPending() {
        #if canImport(CoreMIDI)
        let now = mach_absolute_time()
        lock.lock()
        acceptFromHostTime = now
        lock.unlock()
        #endif
    }

    // MARK: - CoreMIDI plumbing

    #if canImport(CoreMIDI)
    private func refreshSources() {
        lock.lock()
        guard running else { lock.unlock(); return }
        let port = inputPort
        let before = connectedSources
        var live: Set<MIDIEndpointRef> = []
        for i in 0..<MIDIGetNumberOfSources() {
            let s = MIDIGetSource(i); if s != 0 { live.insert(s) }
        }
        let toRemove = connectedSources.subtracting(live)
        for s in toRemove {
            MIDIPortDisconnectSource(port, s)
            connectedSources.remove(s)
            sourceNamesByEndpoint.removeValue(forKey: s)
        }
        for s in live where !connectedSources.contains(s) {
            // Pass the endpoint ref as connRefCon so the receive block
            // can attribute incoming events to their source.
            let refCon = UnsafeMutableRawPointer(bitPattern: UInt(s))
            if MIDIPortConnectSource(port, s, refCon) == noErr {
                connectedSources.insert(s)
                sourceNamesByEndpoint[s] = displayName(of: s)
            }
        }
        let changed = connectedSources != before
        let handler = sourcesChangedHandler
        lock.unlock()
        if changed { handler?() }
    }

    private func dispatchEventList(_ listPtr: UnsafePointer<MIDIEventList>, refCon: UnsafeMutableRawPointer?) {
        let sourceName = sourceName(forRefCon: refCon)
        // CoreMIDI hands us an `UnsafePointer<MIDIEventList>` whose
        // `pointee` is read-only, but the underlying storage is in
        // fact a stable buffer we may iterate. Reinterpret as mutable
        // so we can address the inline `packet` member, then walk the
        // buffer with `MIDIEventPacketNext`.
        let count = listPtr.pointee.numPackets
        let mutListPtr = UnsafeMutablePointer(mutating: listPtr)
        withUnsafePointer(to: &mutListPtr.pointee.packet) { firstPacketPtr in
            var packetPtr: UnsafePointer<MIDIEventPacket> = firstPacketPtr
            for _ in 0..<count {
                parsePacket(packetPtr.pointee, sourceName: sourceName)
                packetPtr = UnsafePointer(
                    MIDIEventPacketNext(UnsafeMutablePointer(mutating: packetPtr))
                )
            }
        }
    }

    /// Recover the source endpoint from the connRefCon registered in
    /// `refreshSources()` and look up its display name.
    private func sourceName(forRefCon refCon: UnsafeMutableRawPointer?) -> String {
        let endpoint = MIDIEndpointRef(truncatingIfNeeded: UInt(bitPattern: refCon))
        lock.lock(); defer { lock.unlock() }
        return sourceNamesByEndpoint[endpoint] ?? "unknown"
    }

    private func parsePacket(_ packet: MIDIEventPacket, sourceName: String) {
        // Each MIDI 1.0 channel-voice UMP message is one 32-bit word.
        let words = withUnsafeBytes(of: packet.words) { rawBuffer -> [UInt32] in
            let buffer = rawBuffer.bindMemory(to: UInt32.self)
            let n = Int(min(packet.wordCount, UInt32(buffer.count)))
            return Array(buffer.prefix(n))
        }
        for word in words {
            let byte0 = UInt8((word >> 24) & 0xFF)
            let byte1 = UInt8((word >> 16) & 0xFF)
            let byte2 = UInt8((word >>  8) & 0xFF)
            let byte3 = UInt8( word        & 0xFF)
            guard (byte0 & 0xF0) == 0x20 else { continue }
            let status = byte1 & 0xF0
            let note = Int(byte2)
            let velocity = Int(byte3)
            switch status {
            case 0x90 where velocity > 0:
                emit(NoteEvent(note: note, velocity: velocity, isOn: true,  timestampNs: packet.timeStamp), from: sourceName)
            case 0x90: // note-on with velocity 0 == note-off
                emit(NoteEvent(note: note, velocity: 0, isOn: false, timestampNs: packet.timeStamp), from: sourceName)
            case 0x80:
                emit(NoteEvent(note: note, velocity: velocity, isOn: false, timestampNs: packet.timeStamp), from: sourceName)
            default:
                continue
            }
        }
    }

    private func displayName(of endpoint: MIDIEndpointRef) -> String {
        var unmanaged: Unmanaged<CFString>?
        let status = MIDIObjectGetStringProperty(endpoint, kMIDIPropertyDisplayName, &unmanaged)
        guard status == noErr, let cf = unmanaged?.takeRetainedValue() else { return "unknown" }
        return cf as String
    }
    #endif

    // MARK: - Helpers

    private func emit(_ event: NoteEvent, from sourceName: String) {
        let cont: AsyncStream<SourcedNoteEvent>.Continuation? = {
            lock.lock(); defer { lock.unlock() }
            // Drop events that predate the most recent flush — e.g. keys
            // pressed/held before Connect MIDI. `timestampNs` is the
            // CoreMIDI host-time receive stamp (same clock as
            // `flushPending()`); 0 means "immediate", so it is kept.
            if event.timestampNs != 0 && event.timestampNs < acceptFromHostTime {
                return nil
            }
            return continuation
        }()
        cont?.yield(SourcedNoteEvent(event: event, sourceName: sourceName))
    }

    private func recordError(_ message: String) {
        lock.lock(); defer { lock.unlock() }
        lastError = message
        FileHandle.standardError.write(Data("MidiInput error: \(message)\n".utf8))
    }
}

