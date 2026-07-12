//
//  WebSocketHub.swift
//  jsp-engine
//
//  Tracks the set of currently-connected WebSocket clients and lets
//  the rest of the engine (the SessionCoordinator in phase 3, the
//  echo handler in phase 2) push messages to all of them at once.
//
//  The hub is an actor so registration / broadcast / removal are
//  serialized without explicit locking. Each registered connection
//  carries a continuation that the per-connection task pulls from to
//  deliver outbound text frames in order.
//
import Foundation

/// One subscriber. Owned by the per-connection task; the hub only
/// keeps a reference (via the AsyncStream continuation) so it can
/// push outbound messages.
public struct WebSocketSubscription: Sendable {
    public let id: UUID
    public let outbox: AsyncStream<String>.Continuation

    public init(id: UUID, outbox: AsyncStream<String>.Continuation) {
        self.id = id
        self.outbox = outbox
    }
}

/// Async-safe registry of connected WebSocket clients.
public actor WebSocketHub {

    private var subscriptions: [UUID: WebSocketSubscription] = [:]

    /// Most recent broadcast — replayed to every newly registered
    /// subscriber so a freshly connected client immediately gets the
    /// current state instead of having to wait for the next change.
    private var lastBroadcast: String?

    public init() {}

    /// Add a subscriber. If we have a cached snapshot, send it
    /// immediately so the client paints the correct initial state.
    public func register(_ subscription: WebSocketSubscription) {
        subscriptions[subscription.id] = subscription
        if let last = lastBroadcast {
            subscription.outbox.yield(last)
        }
    }

    /// Remove a subscriber by id. Idempotent.
    public func unregister(id: UUID) {
        if let removed = subscriptions.removeValue(forKey: id) {
            removed.outbox.finish()
        }
    }

    /// Push the same text frame to every connected client. Stores the
    /// frame as the "last broadcast" so future joiners are caught up.
    public func broadcast(_ text: String) {
        lastBroadcast = text
        for sub in subscriptions.values {
            sub.outbox.yield(text)
        }
    }

    /// Number of currently connected clients (informational).
    public var subscriberCount: Int { subscriptions.count }
}
