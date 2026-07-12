/**
 * App.tsx — Jay's Sight Reading
 *
 * Top-level composition:
 *   - Exercise engine state (useReducer)
 *   - MIDI input via WebSocket (useMidi)
 *   - Score rendering (ScoreView)
 *   - Session sidebar: pass counter, exercise info, advance button
 */

import { useReducer, useCallback, useState } from "react";
import {
  initialState,
  reduce,
  passLabel,
  currentNote,
} from "./engine/exerciseEngine";
import { useMidi } from "./hooks/useMidi";
import type { MidiState } from "./hooks/useMidi";
import { ScoreView } from "./components/ScoreView";
import "./App.css";

// Declare Vite-injected constants.
declare const __BUILD_TIME__: string;
declare const __DEV_TOOLS__: boolean;

export default function App() {
  const [exState, dispatch] = useReducer(reduce, undefined, () => initialState(0));
  const [midiState, setMidiState] = useState<MidiState>({
    connected: false,
    running: false,
    sources: [],
    activeSource: null,
  });

  const handleNoteOn = useCallback(
    (note: number) => {
      dispatch({ type: "NOTE_PLAYED", midiNote: note });
    },
    []
  );

  useMidi({
    onNoteOn: handleNoteOn,
    onMidiState: setMidiState,
  });

  const cn = currentNote(exState);
  const isComplete = exState.exerciseComplete;

  return (
    <div className="app-root">
      {/* Tap-to-begin overlay (absorbs the iOS system gesture gate) */}
      {!midiState.running && (
        <div className="tap-overlay">
          <p>Connect your MIDI keyboard, then tap anywhere to begin.</p>
          <p className="tap-hint">
            {midiState.sources.length > 0
              ? `Keyboard detected: ${midiState.sources[0]}`
              : "No MIDI keyboard detected yet…"}
          </p>
        </div>
      )}

      <div className="layout">
        {/* Score panel */}
        <div className="score-panel">
          <div className="score-header">
            <span className="key-label">{exState.exercise.key}</span>
            {cn && (
              <span className="next-note-label">
                Next: {cn.staff === "treble" ? "Right hand" : "Left hand"}
                {" "}— finger {cn.finger}
              </span>
            )}
          </div>

          <ScoreView
            exercise={exState.exercise}
            noteStatuses={exState.noteStatuses}
          />

          {exState.wrongNoteActive && (
            <div className="wrong-banner">
              Wrong note — find the highlighted note and try again.
            </div>
          )}

          {isComplete && (
            <div className="complete-banner">
              <span>Exercise complete!</span>
              <button
                className="advance-btn"
                onClick={() => dispatch({ type: "ADVANCE_EXERCISE" })}
              >
                Next exercise →
              </button>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-section">
            <div className="sidebar-title">Progress</div>
            <div className="pass-counter">
              <span className="pass-label">Passes</span>
              <span className="pass-value">{passLabel(exState)}</span>
            </div>
            <div className="exercise-label">
              Exercise {(exState.exerciseIndex % 5) + 1} / 5
            </div>
          </div>

          <div className="sidebar-section">
            <div className="sidebar-title">MIDI</div>
            <div className={`midi-status ${midiState.running ? "ok" : "off"}`}>
              {midiState.running
                ? midiState.activeSource ?? "Connected"
                : "No MIDI"}
            </div>
          </div>

          <div className="sidebar-section">
            <button
              className="restart-btn"
              onClick={() => dispatch({ type: "RESTART_EXERCISE" })}
            >
              ↺ Restart
            </button>
          </div>

          {__DEV_TOOLS__ && (
            <div className="sidebar-section dev-tools">
              <div className="sidebar-title">Dev</div>
              <div style={{ fontSize: 10, opacity: 0.5 }}>{__BUILD_TIME__}</div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
