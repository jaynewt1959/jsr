//
//  HTTPServer.swift
//  jsp-engine
//
//  Builds the Hummingbird `Application` that the engine runs.
//  Exposes:
//    GET  /healthz   — liveness probe, returns "ok\n"
//    GET  /          — static index.html (when --static-dir is set)
//    GET  /*         — static asset (when --static-dir is set)
//    WS   /ws        — routed through the caller-supplied WS router.
//
//  We let the caller (main.swift) build and configure the WS router
//  so that closures attached to it can capture caller-side state
//  (e.g. the WebSocketHub) without having to thread it through here.
//
//  Concurrency note: Hummingbird 2's `Application` is a `Service` that
//  runs to completion via `runService()`. We don't manage threads
//  ourselves.
//
import Foundation
import Hummingbird
import HummingbirdWebSocket

/// Configuration for the engine's HTTP/WS server.
struct ServerConfig {
    var port: Int
    var staticDir: String?
    var devMode: Bool
}

/// Build (but don't yet run) the Hummingbird application.
func makeApplication(
    config: ServerConfig,
    webSocketRouter: Router<BasicWebSocketRequestContext>
) throws -> some ApplicationProtocol {
    let router = Router()

    router.get("/healthz") { _, _ -> Response in
        Response(
            status: .ok,
            headers: [.contentType: "text/plain; charset=utf-8"],
            body: ResponseBody(byteBuffer: ByteBuffer(string: "ok\n"))
        )
    }

    if let staticDir = config.staticDir {
        try mountStaticFiles(on: router, rootDirectory: staticDir)
    }

    let app = Application(
        router: router,
        server: .http1WebSocketUpgrade(webSocketRouter: webSocketRouter),
        configuration: .init(
            address: .hostname("127.0.0.1", port: config.port),
            serverName: "jsp-engine"
        )
    )

    return app
}
