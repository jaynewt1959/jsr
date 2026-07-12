// Wire.swift — Jay's Sight Reading
// JSON types exchanged over the WebSocket between the Swift server
// and the React UI.
//
// Direction:
//   Server → Client: MidiStateMessage (on connect / source change)
//                    NoteEventMessage (on every MIDI note-on/off)
//   Client → Server: InboundCommand  (startMidi / stopMidi / ping)
//
// Exercise logic lives entirely in the TypeScript layer; the server
// is a thin MIDI relay.

import Foundation

// MARK: - Server → Client

/// Sent on connect and whenever the MIDI source list changes.
struct MidiStateMessage: Encodable, Sendable {
    let type: String = "midiState"
    let running: Bool
    let sources: [String]
    let activeSource: String?
}

/// Sent for every note-on and note-off from the active MIDI source.
struct NoteEventMessage: Encodable, Sendable {
    let type: String = "noteEvent"
    let note: Int          // MIDI note number 0–127
    let velocity: Int      // 0–127 (0 for note-off)
    let isOn: Bool         // true = note-on with velocity > 0
    let sourceName: String
}

// MARK: - Client → Server

/// Inbound command envelope. Only `type` is required; the others are
/// optional payloads for specific commands (reserved for future use).
struct InboundCommand: Decodable, Sendable {
    let type: String
}

// MARK: - MIDI domain model

/// A normalised MIDI note event (no CoreMIDI types — safe to test).
public struct NoteEvent: Equatable, Sendable {
    public let note: Int
    public let velocity: Int
    public let isOn: Bool
    /// Host-clock timestamp in nanoseconds (mach_absolute_time units).
    public let timestampNs: UInt64
}
