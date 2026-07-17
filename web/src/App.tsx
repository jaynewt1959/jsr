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
import { initialState, reduce, currentNote, chordGroupPitches, chordGroupOf } from "./engine/exerciseEngine";
import { useMidi } from "./hooks/useMidi";
import type { MidiState } from "./hooks/useMidi";
import { ScoreView } from "./components/ScoreView";
import { PianoKeyboard } from "./components/PianoKeyboard";
import type { FlashKey, FlashColor } from "./components/PianoKeyboard";
import { ProgressPanel } from "./components/ProgressPanel";
import { RunFeedback } from "./components/RunFeedback";
import type { RunStats } from "./components/RunFeedback";
import {
  recordSession,
  computeEvenness,
  computeRhythm,
  compositeScore,
  getKeyMetrics,
} from "./engine/progressStore";
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

const FLASH_DURATION_MS = 840;

export default function App() {
  const [exState, dispatch] = useReducer(
    reduce,
    undefined,
    () => initialState(0, "C", "50s"),
  );
  const [midiState, setMidiState] = useState<MidiState>({
    connected: false,
    running: false,
    sources: [],
    activeSource: null,
  });
  const [flashKey,  setFlashKey]  = useState<FlashKey | null>(null);
  const [flashKeys, setFlashKeys] = useState<ReadonlyMap<number, FlashColor>>(new Map());
  const flashTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashKeysTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Wrong notes played since the last correct note or reset.
  // Displayed as persistent red on the keyboard until cleared.
  const [wrongKeys, setWrongKeys] = useState<ReadonlySet<number>>(new Set());

  // Held MIDI notes — used for chord recognition mode.
  const heldNotesRef = useRef<Set<number>>(new Set());

  // Ref so handleNote always reads the latest state without needing it
  // in its dependency array (avoids recreating the callback on every note).
  const exStateRef = useRef(exState);
  exStateRef.current = exState;

  // ── Loop / run-feedback state ───────────────────────────────────────────
  const [lastRunStats,       setLastRunStats]       = useState<RunStats | null>(null);
  const [rollingAvg,         setRollingAvg]         = useState<number | null>(null);
  const [rollingCount,       setRollingCount]       = useState(0);
  const [progressRefreshKey, setProgressRefreshKey] = useState(0);

  // ── Per-run metrics accumulation ────────────────────────────────────────
  // Reset at the start of every new run (config change, nav, or BEGIN_NEXT_RUN).
  const metricsRef = useRef({
    correctNotes:      0,
    totalAttempts:     0,
    correctVelocities: [] as number[],
    hasVelocityData:   false,
    noteTimestamps:    [] as number[], // performance.now() at each correct sight-reading note
  });

  function resetMetrics() {
    metricsRef.current = {
      correctNotes:      0,
      totalAttempts:     0,
      correctVelocities: [],
      hasVelocityData:   false,
      noteTimestamps:    [],
    };
  }

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
  // velocity is available from MIDI but undefined for on-screen taps.
  const handleNote = useCallback((note: number, velocity?: number) => {
    const st = exStateRef.current;
    if (st.runComplete) return; // ignore notes during countdown

    const targetPitches = chordGroupPitches(st.exercise.notes, st.currentNoteIndex);
    const isChordGroup  = targetPitches.length > 1;

    if (isChordGroup) {
      // ─ Chord group (beat 0): simultaneous press of all chord notes ─
      heldNotesRef.current.add(note);
      const isTarget = targetPitches.includes(note);

      metricsRef.current.totalAttempts++;
      if (isTarget) metricsRef.current.correctNotes++;

      if (!isTarget) {
        setWrongKeys(prev => new Set([...prev, note]));
        playErrorTone();
        dispatch({ type: "NOTE_PLAYED", midiNote: note });
        return;
      }

      const allHeld = targetPitches.every(p => heldNotesRef.current.has(p));
      if (allHeld) {
        setWrongKeys(new Set());
        const groupIdxs   = chordGroupOf(st.exercise.notes, st.currentNoteIndex);
        const chordColors = new Map<number, FlashKey["color"]>();
        groupIdxs.forEach(i => {
          const n = st.exercise.notes[i];
          chordColors.set(n.pitch, n.staff === "bass" ? "left" : "right");
        });
        if (flashKeysTimerRef.current !== null) clearTimeout(flashKeysTimerRef.current);
        setFlashKeys(chordColors);
        heldNotesRef.current.clear();
        flashKeysTimerRef.current = setTimeout(() => {
          setFlashKeys(new Map());
          flashKeysTimerRef.current = null;
          dispatch({ type: "CHORD_ACCEPTED" });
        }, FLASH_DURATION_MS);
      }
      return;
    }

    // ─ Sequential note (beats 1–3 arpeggio) ─
    const cn = st.exercise.notes[st.currentNoteIndex];
    const isCorrect = cn != null && note === cn.pitch;

    metricsRef.current.totalAttempts++;
    if (isCorrect) {
      metricsRef.current.correctNotes++;
      metricsRef.current.noteTimestamps.push(performance.now()); // rhythm — sequential only
      if (velocity !== undefined && velocity > 0) {
        metricsRef.current.correctVelocities.push(velocity);
        metricsRef.current.hasVelocityData = true;
      }
    }

    if (isCorrect) {
      setWrongKeys(new Set());
      triggerFlash(note, cn.staff === "bass" ? "left" : "right");
    } else {
      setWrongKeys(prev => new Set([...prev, note]));
      playErrorTone();
    }
    dispatch({ type: "NOTE_PLAYED", midiNote: note });
  }, [triggerFlash]);

  const { sendCommand } = useMidi({
    onNoteOn:  (note, velocity) => handleNote(note, velocity),
    onNoteOff: (note) => { heldNotesRef.current.delete(note); },
    onMidiState: setMidiState,
  });
  // Keep a stable ref so the window.jsr effect doesn't need sendCommand as a dep.
  const sendCommandRef = useRef(sendCommand);
  sendCommandRef.current = sendCommand;

  // Expose Swift → JS entry points.
  useEffect(() => {
    function resetForNewExercise() {
      setLastRunStats(null);
      resetMetrics();
      setWrongKeys(new Set());
      heldNotesRef.current.clear();
    }
    (window as any).jsr = {
      restart:        () => { resetForNewExercise(); dispatch({ type: "RESTART_EXERCISE" }); },
      nextExercise:   () => { resetForNewExercise(); dispatch({ type: "ADVANCE_EXERCISE" }); },
      prevExercise:   () => { resetForNewExercise(); dispatch({ type: "PREV_EXERCISE" }); },
      setKey:         (key: string)  => { resetForNewExercise(); dispatch({ type: "SET_CONFIG_KEY", key }); },
      setProgression: (prog: string) => { resetForNewExercise(); dispatch({ type: "SET_CONFIG_PROGRESSION", progression: prog }); },
      connectMidi:    () => sendCommandRef.current({ type: "startMidi" }),
      disconnectMidi: () => sendCommandRef.current({ type: "stopMidi" }),
    };
  }, [dispatch]);

  // Clean up timers on unmount.
  useEffect(() => () => {
    if (flashTimerRef.current     !== null) clearTimeout(flashTimerRef.current);
    if (flashKeysTimerRef.current !== null) clearTimeout(flashKeysTimerRef.current);
  }, []);

  // ── Clear latched run stats on first successful note of new run ─────────────
  // Watches currentNoteIndex: when the exercise advances past 0 (first note
  // played in a new loop), the scorecard latched from the previous run clears.
  useEffect(() => {
    if (!exState.runComplete && exState.currentNoteIndex > 0) {
      setLastRunStats(null);
    }
  }, [exState.currentNoteIndex, exState.runComplete]);

  // ── Run-complete handler ─────────────────────────────────────────────────
  // Fires when runComplete transitions false → true. Computes per-run stats,
  // saves to localStorage, shows the scorecard, and starts the 3-second
  // countdown before the next loop. Latched stats clear on the first note.
  const prevRunCompleteRef = useRef(false);
  useEffect(() => {
    const justCompleted = exState.runComplete && !prevRunCompleteRef.current;
    prevRunCompleteRef.current = exState.runComplete;
    if (!justCompleted) return;

    // ─ Compute metrics ─
    const m = metricsRef.current;
    const accuracy  = m.totalAttempts > 0
      ? (m.correctNotes / m.totalAttempts) * 100
      : 100;
    const errors    = m.totalAttempts - m.correctNotes;
    const evenness  = m.hasVelocityData
      ? computeEvenness(m.correctVelocities)
      : null;
    const rhythm    = computeRhythm(m.noteTimestamps);
    const comp      = compositeScore(accuracy, evenness, rhythm);

    // ─ Show scorecard ─
    const stats: RunStats = {
      runNumber: exState.runCount,
      errors,
      accuracy,
      evenness,
      rhythm,
      composite: comp,
    };
    setLastRunStats(stats);

    // ─ Persist ─
    recordSession({
      key:           exState.selectedKey,
      progression:   exState.selectedProgression,
      exerciseIndex: exState.exerciseIndex,
      accuracy,
      evenness,
      rhythm,
      errors,
    });

    // Update rolling average for the RunFeedback display.
    const km = getKeyMetrics(exState.selectedKey);
    setRollingAvg(km?.composite ?? null);
    setRollingCount(km?.sessionCount ?? 1);
    setProgressRefreshKey(k => k + 1);

    // Immediately reset for the next loop — stats stay visible until
    // the first note of the new run clears them (see currentNoteIndex effect).
    resetMetrics();
    dispatch({ type: "BEGIN_NEXT_RUN" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exState.runComplete]);

  // Post state to SwiftUI via WKScriptMessageHandler on every change.
  const cn = currentNote(exState);
  useEffect(() => {
    const bridge = (window as any).webkit?.messageHandlers?.jsrBridge;
    if (!bridge) return;
    const currentVariation = exState.exercise.notes[exState.currentNoteIndex]?.measure ?? 0;
    bridge.postMessage(JSON.stringify({
      exerciseIndex:   exState.exerciseIndex,
      wrongNoteActive: exState.wrongNoteActive,
      currentHand:     cn?.staff  ?? null,
      currentFinger:   cn?.finger ?? null,
      exerciseKey:     exState.exercise.key,
      progressionName: exState.exercise.progressionName,
      midiRunning:     midiState.running,
      midiConnected:   midiState.running && midiState.sources.length > 0,
      midiSourceName:  midiState.activeSource ?? "",
      currentVariation,
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
          flashKeys={flashKeys}
          wrongKeys={wrongKeys}
          tappable={tappable}
          onKey={(midi, isOn) => {
            if (isOn) { handleNote(midi); }
            else      { heldNotesRef.current.delete(midi); }
          }}
        />
      </div>
      <RunFeedback
        stats={lastRunStats}
        rollingAvg={rollingAvg}
        sessionCount={rollingCount}
      />
      <ProgressPanel
        currentKey={exState.selectedKey}
        refreshKey={progressRefreshKey}
      />
    </div>
  );
}
