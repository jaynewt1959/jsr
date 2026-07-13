// MidiCoordinator.swift — Jay's Sight Reading
// Actor that bridges CoreMIDI → WebSocketHub.
// It starts/stops the MidiInput on request and forwards every
// note-on/off event as a JSON NoteEventMessage to all WS clients.
// MIDI state changes also trigger a MidiStateMessage broadcast.

import Foundation

actor MidiCoordinator {

    private let hub:  WebSocketHub
    private let midi: MidiInput
    private let encoder = JSONEncoder()

    init(hub: WebSocketHub, midi: MidiInput) {
        self.hub  = hub
        self.midi = midi
    }

    // MARK: - Lifecycle

    /// Called once by EngineHost after the server is listening.
    /// Waits for MIDI events and relays them forever.
    func run() async {
        // Notify the UI when sources plug/unplug.
        midi.setSourcesChangedHandler { [weak self] in
            Task { await self?.broadcastMidiState() }
        }

        // Periodic fallback: re-scan sources every 2 s while MIDI is
        // running but no keyboard is visible. Hot-plug notifications on
        // iOS are sometimes delayed or missed, so polling fills the gap.
        Task { [weak self] in
            while true {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                guard let self else { return }
                if midi.isRunning() && midi.currentSourceNames().isEmpty {
                    midi.refresh()
                    await broadcastMidiState()
                }
            }
        }

        for await event in midi.events() {
            await broadcastNoteEvent(event)
        }
    }

    // MARK: - Commands from web clients

    func startMidi() {
        midi.flushPending()
        midi.start()
        Task { await broadcastMidiState() }
    }

    /// Force a source re-scan and broadcast the result.
    /// Called by SwiftUI when the user taps the MIDI banner.
    func refreshMidi() {
        midi.refresh()
        Task { await broadcastMidiState() }
    }

    func stopMidi() {
        midi.stop()
        Task { await broadcastMidiState() }
    }

    // MARK: - Broadcasts

    func broadcastMidiState() async {
        let msg = MidiStateMessage(
            running: midi.isRunning(),
            sources: midi.currentSourceNames(),
            activeSource: midi.currentSourceNames().first
        )
        guard let json = try? encoder.encode(msg),
              let text = String(data: json, encoding: .utf8)
        else { return }
        await hub.broadcast(text)
    }

    private func broadcastNoteEvent(_ sourced: SourcedNoteEvent) async {
        let msg = NoteEventMessage(
            note:       sourced.event.note,
            velocity:   sourced.event.velocity,
            isOn:       sourced.event.isOn,
            sourceName: sourced.sourceName
        )
        guard let json = try? encoder.encode(msg),
              let text = String(data: json, encoding: .utf8)
        else { return }
        await hub.broadcast(text)
    }
}
