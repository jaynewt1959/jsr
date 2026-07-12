// ContentView.swift — Jay's Sight Reading
// Full-screen WKWebView loading the React score-reading UI from the
// embedded Hummingbird server. Same startup/retry pattern as JSP-iPad.

import SwiftUI
import WebKit

struct ContentView: View {

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
            WebViewContainer(port: port)
                .ignoresSafeArea()
        case .waiting:
            splash {
                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
            }
            .task(id: attempt) { await waitForServer() }
        case .failed(let message):
            splash {
                VStack(spacing: 14) {
                    Text("Something went wrong while starting the reading engine.")
                        .font(.callout)
                        .foregroundColor(.white.opacity(0.85))
                        .multilineTextAlignment(.center)
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
                .frame(maxWidth: 420)
            }
        }
    }

    private func splash<Footer: View>(@ViewBuilder footer: () -> Footer) -> some View {
        Color("LaunchBackground")
            .ignoresSafeArea()
            .overlay(
                VStack(spacing: 24) {
                    Image("LaunchIcon")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 180, height: 180)
                        .clipShape(RoundedRectangle(cornerRadius: 36, style: .continuous))
                    Text("JSR")
                        .font(.title2)
                        .fontWeight(.semibold)
                        .foregroundColor(.white)
                    footer()
                }
                .padding(32)
            )
    }

    private func waitForServer() async {
        await EngineHost.shared.ensureStarted()
        let deadline = Date().addingTimeInterval(Self.startupTimeout)
        while Date() < deadline {
            if Task.isCancelled { return }
            switch await EngineHost.shared.state {
            case .running(let port):
                if await isHealthy(port: port) {
                    phase = .ready(port: port)
                    return
                }
            case .failed(let message):
                phase = .failed(message: message)
                return
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

// MARK: -

struct WebViewContainer: UIViewRepresentable {

    let port: Int

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        // Non-persistent store: no disk cache, so every app launch gets
        // the fresh web/dist from the bundle (avoids stale CSS after updates).
        config.websiteDataStore = WKWebsiteDataStore.nonPersistent()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.backgroundColor = .black
        webView.isOpaque = false
        webView.allowsLinkPreview = false
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.delaysContentTouches = false
        if let url = URL(string: "http://localhost:\(port)/") {
            webView.load(URLRequest(url: url))
        }
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
