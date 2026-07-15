// JSRApp.swift — Jay's Sight Reading
// SwiftUI entry point. Starts the embedded Hummingbird MIDI relay
// server in a background task, then loads the React UI in WKWebView.

import SwiftUI
import AVFoundation

@main
struct JSRApp: App {

    init() {
        // Activate audio session early so WebKit doesn't pay the
        // spin-up cost on the first tap sound.
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, options: [.mixWithOthers])
            try session.setActive(true)
        } catch {
            NSLog("JSRApp: AVAudioSession activation failed — %@",
                  error.localizedDescription)
        }

        Task.detached(priority: .background) {
            await EngineHost.shared.ensureStarted()
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .defersSystemGestures(on: .all)
        }
    }
}
