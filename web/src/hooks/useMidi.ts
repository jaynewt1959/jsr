/**
 * useMidi.ts — Jay's Sight Reading
 *
 * React hook that connects to the Swift Hummingbird WebSocket server,
 * receives MIDI note events, and exposes a callback API for the app.
 *
 * The WS URL is the same as in JSP-iPad: ws://localhost:8089/ws.
 * In Vite dev mode (:5173) the proxy in vite.config.ts forwards /ws
 * to :8089; in the bundled iPad app the page is served by :8089 itself.
 */

import { useEffect, useRef, useCallback } from "react";

export interface MidiState {
  connected: boolean;
  running: boolean;
  sources: string[];
  activeSource: string | null;
}

interface ServerNoteEvent {
  type: "noteEvent";
  note: number;
  velocity: number;
  isOn: boolean;
  sourceName: string;
}

interface ServerMidiState {
  type: "midiState";
  running: boolean;
  sources: string[];
  activeSource: string | null;
}

type ServerMessage = ServerNoteEvent | ServerMidiState;

interface UseMidiOptions {
  /** Called for every note-on event (isOn=true, velocity>0). */
  onNoteOn: (note: number, velocity: number, sourceName: string) => void;
  /** Called when the MIDI state (connected sources) changes. */
  onMidiState?: (state: MidiState) => void;
}

function resolveWsUrl(): string {
  // In the iPad app the page is served by Hummingbird on :8089,
  // so we connect to the same host:port.
  // In Vite dev (:5173), the proxy in vite.config.ts forwards /ws.
  const loc = window.location;
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${loc.hostname}:${loc.port}/ws`;
}

export function useMidi({ onNoteOn, onMidiState }: UseMidiOptions): void {
  const wsRef = useRef<WebSocket | null>(null);
  const onNoteOnRef = useRef(onNoteOn);
  const onMidiStateRef = useRef(onMidiState);

  // Keep refs current without triggering reconnect.
  onNoteOnRef.current = onNoteOn;
  onMidiStateRef.current = onMidiState;

  const connect = useCallback(() => {
    const url = resolveWsUrl();
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      // Ask the server to start the MIDI listener.
      ws.send(JSON.stringify({ type: "startMidi" }));
    };

    ws.onmessage = (ev: MessageEvent<string>) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === "noteEvent" && msg.isOn && msg.velocity > 0) {
        onNoteOnRef.current(msg.note, msg.velocity, msg.sourceName);
      } else if (msg.type === "midiState") {
        onMidiStateRef.current?.({
          connected: true,
          running: msg.running,
          sources: msg.sources,
          activeSource: msg.activeSource,
        });
      }
    };

    ws.onclose = () => {
      // Reconnect after a short delay.
      setTimeout(connect, 1500);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);
}
