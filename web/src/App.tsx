/**
 * App.tsx — Jay's Sight Reading
 *
 * The React layer renders ONLY the VexFlow score.
 * All other UI (header, sidebar, overlays, buttons) is
 * implemented natively in SwiftUI (ContentView.swift).
 *
 * JS → Swift bridge: state updates posted via jsrBridge message handler.
 * Swift → JS bridge: window.jsr.{restart, nextExercise} exposed below.
 */

import { useReducer, useCallback, useState, useEffect } from "react";
import { initialState, reduce, currentNote } from "./engine/exerciseEngine";
import { useMidi } from "./hooks/useMidi";
import type { MidiState } from "./hooks/useMidi";
import { ScoreView } from "./components/ScoreView";
import "./App.css";

export default function App() {
  const [exState, dispatch] = useReducer(reduce, undefined, () => initialState(0));
  const [midiState, setMidiState] = useState<MidiState>({
    connected: false,
    running: false,
    sources: [],
    activeSource: null,
  });

  const handleNoteOn = useCallback((note: number) => {
    dispatch({ type: "NOTE_PLAYED", midiNote: note });
  }, []);

  useMidi({ onNoteOn: handleNoteOn, onMidiState: setMidiState });

  // Expose Swift → JS entry points.
  useEffect(() => {
    (window as any).jsr = {
      restart:     () => dispatch({ type: "RESTART_EXERCISE" }),
      nextExercise:() => dispatch({ type: "ADVANCE_EXERCISE" }),
    };
  }, [dispatch]);

  // Post state to SwiftUI via WKScriptMessageHandler on every change.
  const cn = currentNote(exState);
  useEffect(() => {
    const bridge = (window as any).webkit?.messageHandlers?.jsrBridge;
    if (!bridge) return;
    bridge.postMessage(JSON.stringify({
      passCount:        exState.passCount,
      exerciseIndex:    exState.exerciseIndex,
      exerciseComplete: exState.exerciseComplete,
      wrongNoteActive:  exState.wrongNoteActive,
      currentHand:      cn?.staff   ?? null,
      currentFinger:    cn?.finger  ?? null,
      exerciseKey:      exState.exercise.key,
      midiConnected:    midiState.running && midiState.sources.length > 0,
      midiSourceName:   midiState.activeSource ?? "",
    }));
  }, [exState, midiState, cn]);

  return (
    <div className="score-root">
      <ScoreView
        exercise={exState.exercise}
        noteStatuses={exState.noteStatuses}
      />
    </div>
  );
}
