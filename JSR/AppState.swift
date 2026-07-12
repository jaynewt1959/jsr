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

    // MARK: - MIDI status (populated by JS bridge)

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
        if let v = json["midiConnected"]    as? Bool   { midiConnected    = v }
        if let v = json["midiSourceName"]   as? String { midiSourceName   = v }
    }
}
