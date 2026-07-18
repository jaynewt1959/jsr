// ContentView.swift — Jay's Sight Reading
//
// Architecture: WKWebView renders VexFlow score only.
// All interactive chrome (header, sidebar, MIDI overlay, banners)
// is implemented here in SwiftUI for full colour/layout control.
//
// Communication:
//   JS → Swift: window.webkit.messageHandlers.jsrBridge.postMessage(json)
//               received in BridgeHandler, applied to AppState.
//   Swift → JS: appState.callJS("window.jsr.restart()") etc.
//               wired up in ScoreWebView.makeUIView.

import SwiftUI
import WebKit

// MARK: - Top-level content

struct ContentView: View {

    @StateObject private var appState = AppState()

    private let allKeys = ["C","G","D","A","E","B","F#","Db","Ab","Eb","Bb","F"]
    private let allProgressions: [(id: String, name: String, label: String)] = [
        ("blues",      "Blues",       "I – IV – V – I"),
        ("50s",        "50s",         "I – vi – IV – V"),
        ("pop",        "Pop",         "I – V – vi – IV"),
        ("circle",     "Circle",      "I – IV – ii – V"),
        ("minor-feel", "Minor Feel",  "vi – IV – I – V"),
    ]

    private enum Phase: Equatable {
        case waiting
        case ready(port: Int)
        case failed(message: String)
    }

    private static let startupTimeout: TimeInterval = 12

    @State private var phase: Phase = .waiting
    @State private var attempt = 0
    /// Shown on first launch until the user taps to connect. Once
    /// dismissed it does not reappear for the rest of the session.
    @State private var showBeginOverlay = true

    var body: some View {
        switch phase {
        case .ready(let port):
            mainLayout(port: port)
                .overlay {
                    if showBeginOverlay {
                        beginOverlay
                            .transition(.opacity)
                    }
                }
                .animation(.easeInOut(duration: 0.25), value: showBeginOverlay)
        case .waiting:
            splash { ProgressView().tint(.white) }
                .task(id: attempt) { await waitForServer() }
        case .failed(let message):
            splash {
                VStack(spacing: 14) {
                    Text("The engine didn't start.")
                        .foregroundColor(.white.opacity(0.85))
                    Text(message)
                        .font(.footnote)
                        .foregroundColor(.white.opacity(0.5))
                        .multilineTextAlignment(.center)
                    Button("Try Again") {
                        phase = .waiting
                        attempt += 1
                    }
                    .buttonStyle(.borderedProminent)
                }
                .frame(maxWidth: 380)
            }
        }
    }

    // MARK: - Main layout (server ready)

    @ViewBuilder
    private func mainLayout(port: Int) -> some View {
        VStack(spacing: 0) {
            headerBar
            ScoreWebView(port: port, appState: appState)
            selectorBar
            controlBar
                .background(Color(hex: "111430"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color(hex: "0d1035").ignoresSafeArea())
    }

    // MARK: - Begin overlay

    // Begin overlay — absorbs the iOS system first-touch gate so the
    // first real key press on the physical keyboard is never swallowed.
    // Mirrors the jsp-ipad pattern exactly: dismiss only, no MIDI action.
    // The user connects MIDI explicitly via the Connect MIDI button.
    private var beginOverlay: some View {
        Button(action: { showBeginOverlay = false }) {
            ZStack {
                Color(hex: "0d1035").ignoresSafeArea()
                VStack(spacing: 16) {
                    Text("JSR")
                        .font(.system(size: 64, weight: .black))
                        .foregroundColor(.white)
                    Text("Tap anywhere to begin")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(Color(hex: "facc15"))
                }
                .padding(40)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Selector bar

    private var selectorBar: some View {
        HStack(spacing: 10) {
            Text("KEY")
                .font(.system(size: 10, weight: .heavy))
                .tracking(2)
                .foregroundColor(.white.opacity(0.5))

            Picker("Key", selection: Binding(
                get: { appState.selectedKey },
                set: { appState.setKey($0) }
            )) {
                ForEach(allKeys, id: \.self) { key in
                    Text(key).tag(key)
                }
            }
            .pickerStyle(.menu)
            .tint(Color(hex: "60c0ff"))
            .padding(.horizontal, 6)
            .padding(.vertical, 4)
            .background(Color.white.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 8))

            Divider()
                .background(Color.white.opacity(0.3))
                .frame(height: 20)
                .padding(.horizontal, 4)

            Text("PROGRESSION")
                .font(.system(size: 10, weight: .heavy))
                .tracking(2)
                .foregroundColor(.white.opacity(0.5))

            Picker("Progression", selection: Binding(
                get: { appState.selectedProgression },
                set: { appState.setProgression($0) }
            )) {
                ForEach(allProgressions, id: \.id) { prog in
                    Text("\(prog.name)  \(prog.label)").tag(prog.id)
                }
            }
            .pickerStyle(.menu)
            .tint(Color(hex: "60c0ff"))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color.white.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .frame(minWidth: 220, alignment: .leading)

            Divider()
                .background(Color.white.opacity(0.3))
                .frame(height: 20)
                .padding(.horizontal, 4)

            // ─ TEMPO ─────────────────────────────────────────────
            Text("TEMPO")
                .font(.system(size: 10, weight: .heavy))
                .tracking(2)
                .foregroundColor(.white.opacity(0.5))

            HStack(spacing: 4) {
                ForEach([
                    (label: "Free",    enabled: false),
                    (label: "♪ Timed", enabled: true),
                ], id: \.label) { item in
                    let isActive = appState.metronomeEnabled == item.enabled
                    Button(item.label) {
                        appState.setMetronome(item.enabled, appState.metronomeBpm)
                    }
                    .font(.system(size: 13, weight: .heavy))
                    .foregroundColor(isActive ? .black : .white)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(isActive ? Color(hex: "60c0ff") : Color.white.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 7))
                    .buttonStyle(.plain)
                }
            }

            if appState.metronomeEnabled {
                Divider()
                    .background(Color.white.opacity(0.3))
                    .frame(height: 20)
                    .padding(.horizontal, 2)

                HStack(spacing: 4) {
                    ForEach([60, 80, 100, 120], id: \.self) { bpm in
                        let isActive = appState.metronomeBpm == bpm
                        Button("\(bpm)") {
                            appState.setMetronome(true, bpm)
                        }
                        .font(.system(size: 13, weight: .heavy, design: .rounded))
                        .foregroundColor(isActive ? .black : .white.opacity(0.7))
                        .frame(width: 38)
                        .padding(.vertical, 5)
                        .background(isActive ? Color(hex: "60c0ff") : Color.white.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: 7))
                        .buttonStyle(.plain)
                    }
                }
            }

            Spacer()

            // ─ DIAG (debug only) ────────────────────────────────────
            HStack(spacing: 4) {
                Button("● DIAG") { appState.toggleDiag() }
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundColor(Color(hex: "f59e0b"))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color(hex: "f59e0b").opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .buttonStyle(.plain)
                Button("CLR") { appState.clearDiag() }
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundColor(Color.white.opacity(0.4))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 4)
                    .background(Color.white.opacity(0.06))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 8)
        .background(Color(hex: "111430"))
    }

    // MARK: - Header bar

    private var headerBar: some View {
        HStack(spacing: 16) {
            Text(appState.exerciseKey)
                .font(.system(size: 24, weight: .black))
                .foregroundColor(.white)

            if let hand = appState.currentHand, let finger = appState.currentFinger {
                let label = hand == "treble" ? "Right hand" : "Left hand"
                HStack(spacing: 6) {
                    Text("Next:")
                        .foregroundColor(.white.opacity(0.6))
                    Text(label)
                        .foregroundColor(Color(hex: "60c0ff"))
                    Text("— finger")
                        .foregroundColor(.white.opacity(0.6))
                    Text("\(finger)")
                        .font(.system(size: 20, weight: .black, design: .rounded))
                        .foregroundColor(Color(hex: "60c0ff"))
                }
                .font(.system(size: 15, weight: .semibold))
            }

            Spacer()

            if appState.staleNoteActive {
                Label("Lift previous finger sooner", systemImage: "hand.point.up")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(.black)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Color(hex: "f59e0b"))
                    .clipShape(Capsule())
            } else if appState.wrongNoteActive {
                Label("Wrong note — play the blue note", systemImage: "xmark.circle.fill")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Color(hex: "aa1010"))
                    .clipShape(Capsule())
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
        .background(Color(hex: "0d1035"))
    }

    // MARK: - Control bar (below score)

    private var controlBar: some View {
        HStack(spacing: 0) {

            // ─ VARIATION with embedded Prev/Next ───────────────────────────────
            VStack(alignment: .leading, spacing: 4) {
                Text("VARIATION")
                    .font(.system(size: 10, weight: .heavy))
                    .tracking(2)
                    .foregroundColor(.white.opacity(0.6))
                HStack(spacing: 10) {
                    let varNum = (appState.exerciseIndex % 4) + 1
                    Button(action: { appState.prevExercise() }) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 16, weight: .heavy))
                            .foregroundColor(.white.opacity(0.7))
                            .frame(width: 32, height: 32)
                            .background(Color.white.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                    HStack(alignment: .lastTextBaseline, spacing: 4) {
                        Text("\(varNum)")
                            .font(.system(size: 32, weight: .heavy, design: .rounded))
                            .foregroundColor(.white)
                            .monospacedDigit()
                        Text("/ 4")
                            .font(.system(size: 16, weight: .bold, design: .rounded))
                            .foregroundColor(.white.opacity(0.5))
                    }
                    Button(action: { appState.nextExercise() }) {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 16, weight: .heavy))
                            .foregroundColor(.white.opacity(0.7))
                            .frame(width: 32, height: 32)
                            .background(Color.white.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)

            Spacer()

            // ─ RESTART (centred, green) ───────────────────────────────────────
            Button(action: { appState.restart() }) {
                Label("Restart", systemImage: "arrow.counterclockwise")
                    .font(.system(size: 15, weight: .heavy))
                    .foregroundColor(.white)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 10)
                    .background(Color.green)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            }

            Spacer()

            Divider().background(Color.white.opacity(0.2)).frame(height: 48)

            // ─ MIDI ─────────────────────────────────────────────────
            Group {
                if appState.midiConnected {
                    // Keyboard connected — show source name; tap to disconnect.
                    Button(action: { appState.disconnectMidi() }) {
                        HStack(spacing: 6) {
                            Image(systemName: "pianokeys.fill")
                            Text(appState.midiSourceName.isEmpty ? "Connected" : appState.midiSourceName)
                                .lineLimit(1)
                            Image(systemName: "xmark.circle.fill")
                                .foregroundColor(.black.opacity(0.4))
                        }
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.black)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(Color.green)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                } else if appState.midiRunning {
                    // MIDI started but no keyboard detected — tap to rescan.
                    Button(action: { Task { await EngineHost.shared.refreshMidi() } }) {
                        HStack(spacing: 6) {
                            Image(systemName: "exclamationmark.triangle.fill")
                            VStack(alignment: .leading, spacing: 1) {
                                Text("No keyboard")
                                    .font(.system(size: 13, weight: .heavy))
                                Text("Tap to scan")
                                    .font(.system(size: 11))
                            }
                        }
                        .foregroundColor(.black)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(Color.orange)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                } else {
                    // MIDI not started — show Connect button.
                    Button(action: { appState.connectMidi() }) {
                        Label("Connect MIDI", systemImage: "pianokeys.fill")
                            .font(.system(size: 13, weight: .heavy))
                            .foregroundColor(.white)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(Color(hex: "3060c8"))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
    }

    // MARK: - Splash

    private func splash<Footer: View>(@ViewBuilder footer: () -> Footer) -> some View {
        Color(hex: "1e2030").ignoresSafeArea()
            .overlay(
                VStack(spacing: 24) {
                    Image("LaunchIcon")
                        .resizable().scaledToFit()
                        .frame(width: 160, height: 160)
                        .clipShape(RoundedRectangle(cornerRadius: 32, style: .continuous))
                    Text("JSR")
                        .font(.title2).fontWeight(.semibold)
                        .foregroundColor(.white)
                    footer()
                }
                .padding(32)
            )
    }

    // MARK: - Startup

    private func waitForServer() async {
        await EngineHost.shared.ensureStarted()
        let deadline = Date().addingTimeInterval(Self.startupTimeout)
        while Date() < deadline {
            if Task.isCancelled { return }
            switch await EngineHost.shared.state {
            case .running(let port):
                if await isHealthy(port: port) { phase = .ready(port: port); return }
            case .failed(let message):
                phase = .failed(message: message); return
            case .idle, .starting:
                break
            }
            try? await Task.sleep(nanoseconds: 200_000_000)
        }
        phase = .failed(message: "The engine didn't respond in time.")
    }

    private func isHealthy(port: Int) async -> Bool {
        guard let url = URL(string: "http://localhost:\(port)/healthz"),
              let (_, response) = try? await URLSession.shared.data(from: url)
        else { return false }
        return (response as? HTTPURLResponse)?.statusCode == 200
    }
}

// MARK: - Score WebView

struct ScoreWebView: UIViewRepresentable {

    let port: Int
    let appState: AppState

    func makeCoordinator() -> BridgeHandler { BridgeHandler(appState: appState) }

    func makeUIView(context: Context) -> WKWebView {
        let ctrl = WKUserContentController()
        ctrl.add(context.coordinator, name: "jsrBridge")

        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore         = WKWebsiteDataStore.nonPersistent()
        cfg.userContentController    = ctrl
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []

        let wv = WKWebView(frame: .zero, configuration: cfg)
        wv.navigationDelegate = context.coordinator
        // Opaque white — the score renders dark ink on white, like paper.
        // This beats any CSS trickery; the WKWebView IS white.
        wv.isOpaque = true
        wv.backgroundColor = .white
        wv.scrollView.backgroundColor = .white
        wv.allowsLinkPreview = false
        wv.scrollView.isScrollEnabled = false
        wv.scrollView.delaysContentTouches = false

        appState.callJS = { [weak wv] script in
            wv?.evaluateJavaScript(script, completionHandler: nil)
        }

        wv.uiDelegate = context.coordinator

        if let url = URL(string: "http://localhost:\(port)/") {
            wv.load(URLRequest(url: url))
        }
        return wv
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    static func dismantleUIView(_ uiView: WKWebView, coordinator: BridgeHandler) {
        uiView.navigationDelegate = nil
        uiView.configuration.userContentController
            .removeScriptMessageHandler(forName: "jsrBridge")
    }
}

// MARK: - JS → Swift bridge

final class BridgeHandler: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    private weak var appState: AppState?
    init(appState: AppState) { self.appState = appState }

    // After the React app finishes loading, restore the persisted key/progression.
    // A short delay lets the React useEffect run and register window.jsr.
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
            self?.appState?.applyPersistedConfig()
        }
    }

    // Handle window.confirm() — required for the progress-reset button in ProgressPanel.
    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        guard
            let scene  = UIApplication.shared.connectedScenes.first as? UIWindowScene,
            let rootVC = scene.windows.first?.rootViewController
        else { completionHandler(false); return }

        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel)  { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "Reset",  style: .destructive) { _ in completionHandler(true)  })
        rootVC.present(alert, animated: true)
    }

    func userContentController(
        _ ctrl: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == "jsrBridge",
              let body = message.body as? String,
              let data = body.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return }
        DispatchQueue.main.async { [weak self] in
            self?.appState?.applyBridgeUpdate(json)
        }
    }
}

// MARK: - Colour utility

extension Color {
    init(hex: String) {
        var h = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
        var int: UInt64 = 0
        Scanner(string: h).scanHexInt64(&int)
        self.init(
            .sRGB,
            red:     Double((int >> 16) & 0xFF) / 255,
            green:   Double((int >>  8) & 0xFF) / 255,
            blue:    Double( int        & 0xFF) / 255,
            opacity: 1
        )
    }
}