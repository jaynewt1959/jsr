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

    /// Most recent MIDI-state message — replayed to every newly
    /// registered subscriber so a freshly connected client immediately
    /// gets the current connection state.
    ///
    /// Only `broadcastState(_:)` updates this cache. Transient note
    /// events (via `broadcast(_:)`) are NOT cached: replaying a note
    /// event to a reconnecting client would trigger a spurious
    /// NOTE_PLAYED in the JS exercise engine.
    private var lastMidiState: String?

    public init() {}

    /// Add a subscriber. If we have a cached MIDI state, send it
    /// immediately so the client knows the connection status without
    /// waiting for the next change.
    public func register(_ subscription: WebSocketSubscription) {
        subscriptions[subscription.id] = subscription
        if let state = lastMidiState {
            subscription.outbox.yield(state)
        }
    }

    /// Remove a subscriber by id. Idempotent.
    public func unregister(id: UUID) {
        if let removed = subscriptions.removeValue(forKey: id) {
            removed.outbox.finish()
        }
    }

    /// Push a MIDI state message to every client AND cache it so
    /// future subscribers receive it on connect. Use this for
    /// `midiState` messages whose content is always safe to replay.
    public func broadcastState(_ text: String) {
        lastMidiState = text
        for sub in subscriptions.values {
            sub.outbox.yield(text)
        }
    }

    /// Push a transient message (e.g. a note event) to every client.
    /// Does NOT update the replay cache — transient events must not
    /// be re-delivered to reconnecting clients.
    public func broadcast(_ text: String) {
        for sub in subscriptions.values {
            sub.outbox.yield(text)
        }
    }

    /// Number of currently connected clients (informational).
    public var subscriberCount: Int { subscriptions.count }
}
