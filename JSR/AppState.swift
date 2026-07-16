// AppState.swift — Jay's Sight Reading
//
// ObservableObject shared between SwiftUI views. Receives state updates
// from the in-WebView JavaScript exercise engine via the WKScriptMessageHandler
// "jsrBridge", and exposes functions that call back into JS (restart, next).

import Foundation

final class AppState: ObservableObject {

    // MARK: - Exercise progress (populated by JS bridge)

    @Published var passCount: Int = 0
    @Published var exerciseIndex: Int = 0
    @Published var exerciseComplete: Bool = false
    @Published var wrongNoteActive: Bool = false

    /// "treble" or "bass" — which hand should play next.
    @Published var currentHand: String? = nil
    /// Finger 1–5 for the next note.
    @Published var currentFinger: Int? = nil
    /// Key label, e.g. "C major".
    @Published var exerciseKey: String = "C major"
    /// Progression name, e.g. "50s", "Pop".
    @Published var progressionName: String = "50s"
    /// Currently selected key id (mirrors JS state), persisted across launches.
    @Published var selectedKey: String = UserDefaults.standard.string(forKey: "jsr.selectedKey") ?? "C"
    /// Currently selected progression id (mirrors JS state), persisted across launches.
    @Published var selectedProgression: String = UserDefaults.standard.string(forKey: "jsr.selectedProgression") ?? "50s"
    /// Current training mode, persisted across launches.
    @Published var appMode: String = UserDefaults.standard.string(forKey: "jsr.appMode") ?? "sightReading"
    /// In chord mode: 0-based index of the measure (variation) currently being played.
    @Published var currentVariation: Int = 0

    // MARK: - MIDI status (populated by JS bridge)

    /// True once the user has tapped Connect MIDI and CoreMIDI has started.
    @Published var midiRunning: Bool = false
    /// True when MIDI is running AND at least one source is connected.
    @Published var midiConnected: Bool = false
    @Published var midiSourceName: String = ""

    // MARK: - Swift → JS calls

    /// Set by WebViewContainer once the WKWebView is ready.
    var callJS: ((String) -> Void)?

    func restart() {
        callJS?("if(window.jsr){window.jsr.restart()}")
    }

    func nextExercise() {
        callJS?("if(window.jsr){window.jsr.nextExercise()}")
    }

    func setKey(_ key: String) {
        selectedKey = key
        UserDefaults.standard.set(key, forKey: "jsr.selectedKey")
        callJS?("if(window.jsr){window.jsr.setKey('\(key)')}")
    }

    func setProgression(_ prog: String) {
        selectedProgression = prog
        UserDefaults.standard.set(prog, forKey: "jsr.selectedProgression")
        callJS?("if(window.jsr){window.jsr.setProgression('\(prog)')}")
    }

    func setMode(_ mode: String) {
        appMode = mode
        UserDefaults.standard.set(mode, forKey: "jsr.appMode")
        callJS?("if(window.jsr){window.jsr.setMode('\(mode)')}")
    }

    /// Start CoreMIDI via the JS bridge (idempotent).
    func connectMidi() {
        callJS?("if(window.jsr){window.jsr.connectMidi()}")
    }

    /// Stop CoreMIDI via the JS bridge.
    func disconnectMidi() {
        callJS?("if(window.jsr){window.jsr.disconnectMidi()}")
    }

    /// Called after the WebView finishes loading — restores persisted key/progression/mode into JS.
    func applyPersistedConfig() {
        callJS?("if(window.jsr){window.jsr.setKey('\(selectedKey)');window.jsr.setProgression('\(selectedProgression)');window.jsr.setMode('\(appMode)')}")
    }

    // MARK: - Bridge update

    /// Called from the WKScriptMessageHandler on the main thread.
    func applyBridgeUpdate(_ json: [String: Any]) {
        if let v = json["passCount"]        as? Int    { passCount        = v }
        if let v = json["exerciseIndex"]    as? Int    { exerciseIndex    = v }
        if let v = json["exerciseComplete"] as? Bool   { exerciseComplete = v }
        if let v = json["wrongNoteActive"]  as? Bool   { wrongNoteActive  = v }
        if let v = json["currentHand"]      as? String { currentHand      = v }
        else if json["currentHand"] is NSNull          { currentHand      = nil }
        if let v = json["currentFinger"]    as? Int    { currentFinger    = v }
        else if json["currentFinger"] is NSNull        { currentFinger    = nil }
        if let v = json["exerciseKey"]      as? String { exerciseKey      = v }
        if let v = json["progressionName"]   as? String { progressionName  = v }
        if let v = json["midiRunning"]     as? Bool   { midiRunning      = v }
        if let v = json["midiConnected"]    as? Bool   { midiConnected    = v }
        if let v = json["midiSourceName"]   as? String { midiSourceName   = v }
        if let v = json["currentVariation"] as? Int    { currentVariation = v }
    }
}
