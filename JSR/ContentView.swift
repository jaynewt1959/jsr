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

    private enum Phase: Equatable {
        case waiting
        case ready(port: Int)
        case failed(message: String)
    }

    private static let startupTimeout: TimeInterval = 12

    @State private var phase: Phase = .waiting
    @State private var attempt = 0

    var body: some View {
        switch phase {
        case .ready(let port):
            mainLayout(port: port)
                .ignoresSafeArea()
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
        ZStack {
            Color(hex: "0d1035").ignoresSafeArea()  // deep ocean navy

            VStack(spacing: 0) {
                headerBar
                HStack(spacing: 0) {
                    ScoreWebView(port: port, appState: appState)
                    sidebar
                        .frame(width: 220)
                        .background(Color(hex: "111430"))  // slightly lighter navy
                }
            }

            if !appState.midiConnected {
                midiOverlay
            }
        }
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

            if appState.wrongNoteActive {
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

    // MARK: - Sidebar

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {

            // ── Passes ──
            sidebarSection(title: "Progress") {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text("Passes")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.white.opacity(0.75))
                    Spacer()
                    Text("\(appState.passCount)")
                        .font(.system(size: 44, weight: .black, design: .rounded))
                        .monospacedDigit()
                        .foregroundColor(Color(hex: "60c0ff"))
                    Text("/ 3")
                        .font(.system(size: 20, weight: .bold, design: .rounded))
                        .foregroundColor(.white.opacity(0.5))
                        .padding(.leading, 2)
                }
                // Pass pip indicators
                HStack(spacing: 8) {
                    ForEach(0..<3, id: \.self) { i in
                        Circle()
                            .fill(i < appState.passCount
                                  ? Color(hex: "60c0ff")
                                  : Color.white.opacity(0.18))
                            .frame(width: 12, height: 12)
                    }
                    Spacer()
                    Text("Ex \((appState.exerciseIndex % 5) + 1) / 5")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.white.opacity(0.6))
                }
            }

            Rectangle()
                .fill(Color.white.opacity(0.10))
                .frame(height: 1)
                .padding(.horizontal, 16)
                .padding(.vertical, 6)

            // ── Actions ──
            sidebarSection(title: "Actions") {
                VStack(spacing: 10) {
                    if appState.exerciseComplete {
                        Button(action: { appState.nextExercise() }) {
                            Label("Next exercise", systemImage: "arrow.right")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundColor(.black)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 13)
                                .background(Color(hex: "3de88a"))
                                .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                    }
                    Button(action: { appState.restart() }) {
                        Label("Restart", systemImage: "arrow.counterclockwise")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 13)
                            .background(Color(hex: "1e2a5e"))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .overlay(
                                RoundedRectangle(cornerRadius: 10)
                                    .stroke(Color(hex: "4060d0"), lineWidth: 1.5)
                            )
                    }
                }
            }

            Rectangle()
                .fill(Color.white.opacity(0.10))
                .frame(height: 1)
                .padding(.horizontal, 16)
                .padding(.vertical, 6)

            // ── MIDI ──
            sidebarSection(title: "MIDI") {
                if appState.midiConnected {
                    Label(
                        appState.midiSourceName.isEmpty ? "Connected" : appState.midiSourceName,
                        systemImage: "pianokeys"
                    )
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Color(hex: "3de88a"))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(hex: "0d3320"))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Color(hex: "3de88a").opacity(0.5), lineWidth: 1)
                    )
                } else {
                    Text("No keyboard")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.white.opacity(0.5))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.white.opacity(0.06))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(Color.white.opacity(0.15), lineWidth: 1)
                        )
                }
            }

            Spacer()
        }
        .padding(.top, 20)
    }

    private func sidebarSection<C: View>(
        title: String,
        @ViewBuilder content: () -> C
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title.uppercased())
                .font(.system(size: 10, weight: .black))
                .tracking(2.0)
                .foregroundColor(Color(hex: "60c0ff").opacity(0.8))
            content()
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 16)
    }

    // MARK: - MIDI overlay

    private var midiOverlay: some View {
        ZStack {
            Color(hex: "050818").opacity(0.88).ignoresSafeArea()
            VStack(spacing: 20) {
                Image(systemName: "pianokeys.fill")
                    .font(.system(size: 56))
                    .foregroundColor(Color(hex: "60c0ff"))
                Text("Connect your MIDI keyboard to begin.")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundColor(.white)
                    .multilineTextAlignment(.center)
                Text("No keyboard detected yet…")
                    .font(.system(size: 16))
                    .foregroundColor(.white.opacity(0.5))
            }
            .padding(48)
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
        // Dark navy behind the score card — matches app background
        wv.backgroundColor = UIColor(red: 0.051, green: 0.063, blue: 0.208, alpha: 1)
        wv.isOpaque = false
        wv.allowsLinkPreview = false
        wv.scrollView.isScrollEnabled = false
        wv.scrollView.delaysContentTouches = false

        appState.callJS = { [weak wv] script in
            wv?.evaluateJavaScript(script, completionHandler: nil)
        }

        if let url = URL(string: "http://localhost:\(port)/") {
            wv.load(URLRequest(url: url))
        }
        return wv
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    static func dismantleUIView(_ uiView: WKWebView, coordinator: BridgeHandler) {
        uiView.configuration.userContentController
            .removeScriptMessageHandler(forName: "jsrBridge")
    }
}

// MARK: - JS → Swift bridge

final class BridgeHandler: NSObject, WKScriptMessageHandler {
    private weak var appState: AppState?
    init(appState: AppState) { self.appState = appState }

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