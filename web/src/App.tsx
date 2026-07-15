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

import { useReducer, useCallback, useState, useEffect, useRef } from "react";
import { initialState, reduce, currentNote } from "./engine/exerciseEngine";
import { useMidi } from "./hooks/useMidi";
import type { MidiState } from "./hooks/useMidi";
import { ScoreView } from "./components/ScoreView";
import { PianoKeyboard } from "./components/PianoKeyboard";
import type { FlashKey } from "./components/PianoKeyboard";
import "./App.css";

// ---------------------------------------------------------------------------
// Error tone — short descending two-tone buzz via Web Audio
// ---------------------------------------------------------------------------
function playErrorTone() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    [220, 180].forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.18, now + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.08);
      osc.stop(now + i * 0.08 + 0.13);
    });
    // Close context after sounds finish to avoid resource leak.
    setTimeout(() => ctx.close(), 500);
  } catch {
    // AudioContext unavailable — ignore.
  }
}

// ---------------------------------------------------------------------------
// MIDI range helpers
// ---------------------------------------------------------------------------
/** Snap a MIDI note down to the nearest C. */
function snapToOctaveBelow(midi: number): number {
  return midi - (((midi % 12) + 12) % 12);
}
/** Snap a MIDI note up to the nearest B (one semitone below the next C). */
function snapToOctaveAbove(midi: number): number {
  const pc = ((midi % 12) + 12) % 12;
  return pc === 11 ? midi : midi + (11 - pc);
}

const FLASH_DURATION_MS = 420;

export default function App() {
  const [exState, dispatch] = useReducer(reduce, undefined, () => initialState(0));
  const [midiState, setMidiState] = useState<MidiState>({
    connected: false,
    running: false,
    sources: [],
    activeSource: null,
  });
  const [flashKey, setFlashKey] = useState<FlashKey | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Wrong notes played since the last correct note or reset.
  // Displayed as persistent red on the keyboard until cleared.
  const [wrongKeys, setWrongKeys] = useState<ReadonlySet<number>>(new Set());

  // Ref so handleNote always reads the latest state without needing it
  // in its dependency array (avoids recreating the callback on every note).
  const exStateRef = useRef(exState);
  exStateRef.current = exState;

  // Derive keyboard MIDI range from the current exercise.
  const allPitches = exState.exercise.notes.map(n => n.pitch);
  const lowestMidi  = snapToOctaveBelow(Math.min(...allPitches));
  const highestMidi = snapToOctaveAbove(Math.max(...allPitches));

  const triggerFlash = useCallback((midi: number, color: FlashKey["color"]) => {
    if (flashTimerRef.current !== null) clearTimeout(flashTimerRef.current);
    setFlashKey({ midi, color });
    flashTimerRef.current = setTimeout(() => {
      setFlashKey(null);
      flashTimerRef.current = null;
    }, FLASH_DURATION_MS);
  }, []);

  // Shared note-played handler used by both MIDI and tap input.
  const handleNote = useCallback((note: number) => {
    const st = exStateRef.current;
    const cn = st.exercise.notes[st.currentNoteIndex];
    const isCorrect = cn != null && note === cn.pitch;
    if (isCorrect) {
      // Clear all accumulated wrong keys and show a momentary correct flash.
      setWrongKeys(new Set());
      triggerFlash(note, cn.staff === "bass" ? "left" : "right");
    } else {
      // Add to persistent wrong set — stays red until correct note or reset.
      setWrongKeys(prev => new Set([...prev, note]));
      playErrorTone();
    }
    dispatch({ type: "NOTE_PLAYED", midiNote: note });
  }, [triggerFlash]);

  const { sendCommand } = useMidi({ onNoteOn: handleNote, onMidiState: setMidiState });
  // Keep a stable ref so the window.jsr effect doesn't need sendCommand as a dep.
  const sendCommandRef = useRef(sendCommand);
  sendCommandRef.current = sendCommand;

  // Expose Swift → JS entry points.
  // Each action also clears wrongKeys so stale red keys don't persist
  // across exercise boundaries or manual restarts.
  useEffect(() => {
    (window as any).jsr = {
      restart:         () => { setWrongKeys(new Set()); dispatch({ type: "RESTART_EXERCISE" }); },
      nextExercise:    () => { setWrongKeys(new Set()); dispatch({ type: "ADVANCE_EXERCISE" }); },
      setKey:          (key: string) => { setWrongKeys(new Set()); dispatch({ type: "SET_CONFIG_KEY", key }); },
      setProgression:  (prog: string) => { setWrongKeys(new Set()); dispatch({ type: "SET_CONFIG_PROGRESSION", progression: prog }); },
      // MIDI lifecycle — called from the SwiftUI Connect/Disconnect button.
      connectMidi:     () => sendCommandRef.current({ type: "startMidi" }),
      disconnectMidi:  () => sendCommandRef.current({ type: "stopMidi" }),
    };
  }, [dispatch]);

  // Clean up flash timer on unmount.
  useEffect(() => () => {
    if (flashTimerRef.current !== null) clearTimeout(flashTimerRef.current);
  }, []);

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
      progressionName:  exState.exercise.progressionName,
      midiRunning:      midiState.running,
      midiConnected:    midiState.running && midiState.sources.length > 0,
      midiSourceName:   midiState.activeSource ?? "",
    }));
  }, [exState, midiState, cn]);

  const tappable = !midiState.running;

  return (
    <div className="score-root">
      <ScoreView
        exercise={exState.exercise}
        noteStatuses={exState.noteStatuses}
      />
      <div className="keyboard-wrap">
        <PianoKeyboard
          lowestMidi={lowestMidi}
          highestMidi={highestMidi}
          flashKey={flashKey}
          wrongKeys={wrongKeys}
          tappable={tappable}
          onKey={(midi, isOn) => { if (isOn) handleNote(midi); }}
        />
      </div>
    </div>
  );
}
