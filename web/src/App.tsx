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
import { useMetronome } from "./hooks/useMetronome";
import { ScoreView } from "./components/ScoreView";
import { PianoKeyboard } from "./components/PianoKeyboard";
import type { FlashKey, FlashColor } from "./components/PianoKeyboard";
import { ProgressPanel } from "./components/ProgressPanel";
import { RunFeedback } from "./components/RunFeedback";
import type { RunStats } from "./components/RunFeedback";
import { DiagPanel } from "./components/DiagPanel";
import type { DiagEvent } from "./components/DiagPanel";
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
  // Metronome — controlled from Swift via window.jsr.setMetronome.
  const [metronomeEnabled,   setMetronomeEnabled]   = useState(
    () => localStorage.getItem('jsr.metronomeEnabled') === 'true',
  );
  const [metronomeBpm,       setMetronomeBpm]       = useState(
    () => parseInt(localStorage.getItem('jsr.metronomeBpm') ?? '80', 10),
  );
  // null = silent (READY / run-complete); number = grid running (increments on each first-note).
  const [metronomePlayTrigger, setMetronomePlayTrigger] = useState<number | null>(null);
  // Ref mirrors for handleNote (avoids stale closure without re-creating the callback).
  const metronomeEnabledRef    = useRef(metronomeEnabled);
  metronomeEnabledRef.current  = metronomeEnabled;
  const isFirstNoteRef         = useRef(true);

  useMetronome(metronomeBpm, metronomeEnabled, metronomePlayTrigger);

  // ── Stale-note tracking (jsp-ipad rule) ────────────────────────────────────────
  // prevNote = N-2 step; currentNote = N-1 step.
  // Stale when prevNote is still physically held when N is pressed.
  // One-step legato (N-1 held) is fine; two-step hold is imprecise technique.
  const staleTrackerRef = useRef<{ prevNote: number | null; currentNote: number | null }>({
    prevNote: null, currentNote: null,
  });
  /** Index that triggered the last heldNotes clear; ensures one clear per chord group. */
  const clearedChordRef = useRef<number>(-1);
  const staleTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [staleActive, setStaleActive] = useState(false);

  // ── Diagnostics ───────────────────────────────────────────────────────
  const [diagMode,   setDiagMode]   = useState(false);
  const [diagEvents, setDiagEvents] = useState<DiagEvent[]>([]);
  const diagRunStartRef = useRef(Date.now());

  /** MIDI pitch → note name, e.g. 60 → "C4(60)". */
  function midiName(n: number): string {
    const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    return `${names[n % 12]}${Math.floor(n / 12) - 1}(${n})`;
  }

  function pushDiag(ev: Omit<DiagEvent, 't'>) {
    const entry: DiagEvent = { ...ev, t: Date.now() - diagRunStartRef.current };
    // Also log to console for Safari Web Inspector.
    console.log(`[JSR] ${entry.note} ${entry.phase} ${entry.result} | want:${entry.want} | idx:${entry.idx} | t:${entry.t}ms`);
    setDiagEvents(prev => (prev.length >= 80 ? [...prev.slice(-79), entry] : [...prev, entry]));
  }

  // ── Per-run metrics accumulation ────────────────────────────────────────
  // Reset at the start of every new run (config change, nav, or BEGIN_NEXT_RUN).
  const metricsRef = useRef({
    correctNotes:      0,
    totalAttempts:     0,
    correctVelocities: [] as number[],
    hasVelocityData:   false,
    /** Timestamps + measure/beat context for within-measure rhythm calculation. */
    noteTimestampCtx:  [] as Array<{ t: number; measure: number; beat: number }>,
    stalesCount:       0,
  });

  function resetMetrics() {
    metricsRef.current = {
      correctNotes:      0,
      totalAttempts:     0,
      correctVelocities: [],
      hasVelocityData:   false,
      noteTimestampCtx:  [],
      stalesCount:       0,
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
    if (st.runComplete) {
      pushDiag({ note: midiName(note), raw: note, phase: 'IGNORE', result: 'IGNORED - run complete', want: '-', idx: st.currentNoteIndex });
      return;
    }

    // Start the metronome grid on the first note of each run.
    if (isFirstNoteRef.current && metronomeEnabledRef.current) {
      isFirstNoteRef.current = false;
      setMetronomePlayTrigger(prev => (prev ?? 0) + 1);
    } else {
      isFirstNoteRef.current = false;
    }

    const targetPitches = chordGroupPitches(st.exercise.notes, st.currentNoteIndex);
    const isChordGroup  = targetPitches.length > 1;

    if (isChordGroup) {
      // ─ Chord group (beat 0): simultaneous press of all chord notes ─
      // On the FIRST press of a new chord group: clear arpeggio holds and
      // reset the stale tracker so each measure starts with a clean slate.
      if (st.currentNoteIndex !== clearedChordRef.current) {
        clearedChordRef.current = st.currentNoteIndex;
        heldNotesRef.current.clear();
        staleTrackerRef.current = { prevNote: null, currentNote: null };
      }
      heldNotesRef.current.add(note);
      const isTarget = targetPitches.includes(note);

      metricsRef.current.totalAttempts++;
      if (isTarget) metricsRef.current.correctNotes++;

      if (!isTarget) {
        pushDiag({ note: midiName(note), raw: note, phase: 'CHORD', result: '✗ wrong note', want: targetPitches.map(midiName).join(' '), idx: st.currentNoteIndex });
        setWrongKeys(prev => new Set([...prev, note]));
        playErrorTone();
        dispatch({ type: "NOTE_PLAYED", midiNote: note });
        return;
      }

      const groupIdxs = chordGroupOf(st.exercise.notes, st.currentNoteIndex);
      const allHeld    = targetPitches.every(p => heldNotesRef.current.has(p));

      if (allHeld) {
        // All chord notes held.
        // IMPORTANT: dispatch CHORD_ACCEPTED IMMEDIATELY so the engine
        // advances to arpeggio mode right away.  Any arpeggio notes the
        // player presses will then be processed correctly in sequential
        // mode instead of being lost as "partial chord" presses.
        // The visual flash continues independently via the timer.
        pushDiag({ note: midiName(note), raw: note, phase: 'CHORD', result: '✓ COMPLETE', want: targetPitches.map(midiName).join(' '), idx: st.currentNoteIndex });
        setWrongKeys(new Set());
        const chordColors = new Map<number, FlashKey["color"]>();
        groupIdxs.forEach(i => {
          const n = st.exercise.notes[i];
          chordColors.set(n.pitch, n.staff === "bass" ? "left" : "right");
        });
        if (flashKeysTimerRef.current !== null) clearTimeout(flashKeysTimerRef.current);
        setFlashKeys(chordColors);
        heldNotesRef.current.clear();
        dispatch({ type: "CHORD_ACCEPTED" }); // advance engine NOW
        flashKeysTimerRef.current = setTimeout(() => {
          setFlashKeys(new Map());             // clear visual flash after delay
          flashKeysTimerRef.current = null;
        }, FLASH_DURATION_MS);
      } else {
        // Correct note pressed but chord not yet complete — colour it immediately.
        pushDiag({ note: midiName(note), raw: note, phase: 'CHORD', result: '✓ partial', want: targetPitches.map(midiName).join(' '), idx: st.currentNoteIndex });
        const noteEntry = groupIdxs.find(i => st.exercise.notes[i].pitch === note);
        const color: FlashKey["color"] =
          noteEntry !== undefined && st.exercise.notes[noteEntry].staff === "bass"
            ? "left" : "right";
        setFlashKeys(prev => new Map([...prev, [note, color]]));
      }
      return;
    }

    // ─ Sequential note (beats 1–3 arpeggio, or bass mode eighth notes) ─
    // Silently ignore the current measure's bass root (whole note from beat 0)
    // when waiting for a treble arpeggio note.  The whole note is physically
    // held through the measure and must not be flagged as an error on re-press.
    // In bass mode every expected note is bass-staff, so this guard is skipped
    // entirely — the root may legitimately recur within the pattern.
    const currentMeasure  = st.exercise.notes[st.currentNoteIndex]?.measure;
    const expectedNote    = st.exercise.notes[st.currentNoteIndex];
    if (expectedNote?.staff !== "bass") {
      const measureBassRoot = currentMeasure !== undefined
        ? st.exercise.notes.find(n => n.measure === currentMeasure && n.staff === "bass")?.pitch ?? null
        : null;
      if (measureBassRoot !== null && note === measureBassRoot) {
        const wantPitch = st.exercise.notes[st.currentNoteIndex]?.pitch;
        pushDiag({ note: midiName(note), raw: note, phase: 'IGNORE', result: 'BASS ROOT', want: wantPitch !== undefined ? midiName(wantPitch) : '?', idx: st.currentNoteIndex });
        return;
      }
    }

    // Track ALL note-ons in heldNotes for staleness detection (mirrors jsp-ipad).
    heldNotesRef.current.add(note);

    const cn = st.exercise.notes[st.currentNoteIndex];
    const isCorrect = cn != null && note === cn.pitch;

    metricsRef.current.totalAttempts++;
    if (isCorrect) {
      metricsRef.current.correctNotes++;

      // ─ Stale-note check ──────────────────────────────────────────────────────
      // prevNote is N-2. Same note can never be stale (must release to re-press).
      // Stale detection is disabled in bass mode: bass players commonly hold
      // notes legato while moving to the next, so N-2 hold is expected.
      const tracker = staleTrackerRef.current;
      const isStale = (
        !st.exercise.bassMode &&
        !st.exercise.combinedMode &&
        tracker.prevNote !== null &&
        tracker.prevNote !== note &&
        heldNotesRef.current.has(tracker.prevNote)
      );
      if (isStale) {
        metricsRef.current.stalesCount++;
        setStaleActive(true);
        if (staleTimerRef.current !== null) clearTimeout(staleTimerRef.current);
        staleTimerRef.current = setTimeout(() => {
          setStaleActive(false);
          staleTimerRef.current = null;
        }, 1500);
      }
      pushDiag({
        note: midiName(note), raw: note, phase: 'SEQ',
        result: isStale ? `✓ STALE(${midiName(tracker.prevNote!)})` : '✓ correct',
        want: cn ? midiName(cn.pitch) : '?',
        idx: st.currentNoteIndex,
      });
      // Advance: N-1 → N-2, N → N-1.
      staleTrackerRef.current = { prevNote: tracker.currentNote, currentNote: note };

      metricsRef.current.noteTimestampCtx.push({ t: performance.now(), measure: cn.measure, beat: cn.beat });
      if (velocity !== undefined && velocity > 0) {
        metricsRef.current.correctVelocities.push(velocity);
        metricsRef.current.hasVelocityData = true;
      }
    }

    if (isCorrect) {
      setWrongKeys(new Set());
      triggerFlash(note, cn.staff === "bass" ? "left" : "right");
    } else {
      pushDiag({ note: midiName(note), raw: note, phase: 'SEQ', result: `✗ WRONG`, want: cn ? midiName(cn.pitch) : '?', idx: st.currentNoteIndex });
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
      setMetronomePlayTrigger(null);
      setStaleActive(false);
      if (staleTimerRef.current !== null) { clearTimeout(staleTimerRef.current); staleTimerRef.current = null; }
      staleTrackerRef.current = { prevNote: null, currentNote: null };
      clearedChordRef.current = -1;
      isFirstNoteRef.current = true;
      resetMetrics();
      setWrongKeys(new Set());
      setFlashKeys(new Map());
      heldNotesRef.current.clear();
    }
    (window as any).jsr = {
      restart:        () => { resetForNewExercise(); dispatch({ type: "RESTART_EXERCISE" }); },
      nextExercise:   () => { resetForNewExercise(); dispatch({ type: "ADVANCE_EXERCISE" }); },
      prevExercise:   () => { resetForNewExercise(); dispatch({ type: "PREV_EXERCISE" }); },
      setKey:         (key: string)  => { resetForNewExercise(); dispatch({ type: "SET_CONFIG_KEY", key }); },
      setProgression: (prog: string) => { resetForNewExercise(); dispatch({ type: "SET_CONFIG_PROGRESSION", progression: prog }); },
      setMetronome: (enabled: boolean, bpm: number) => {
        setMetronomeEnabled(enabled);
        setMetronomeBpm(bpm);
        localStorage.setItem('jsr.metronomeEnabled', String(enabled));
        localStorage.setItem('jsr.metronomeBpm', String(bpm));
      },
      toggleDiag:     () => { setDiagMode(prev => !prev); },
      clearDiag:      () => { setDiagEvents([]); diagRunStartRef.current = Date.now(); },
      setBassMode:    (mode: string) => {
        resetForNewExercise();
        dispatch({ type: "SET_CONFIG_MODE", mode: mode as "sightReading" | "bass" });
      },
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
    // Stales add a precision penalty: denominator increases, accuracy falls.
    const accuracy  = m.totalAttempts + m.stalesCount > 0
      ? (m.correctNotes / (m.totalAttempts + m.stalesCount)) * 100
      : 100;
    const errors    = m.totalAttempts - m.correctNotes;
    const stales    = m.stalesCount;
    const evenness  = m.hasVelocityData
      ? computeEvenness(m.correctVelocities)
      : null;
    // Only measure beat-to-beat intervals within the same measure.
    // Cross-measure gaps include chord-playing time and are far larger
    // than arpeggio intervals, which would inflate CV and falsely lower the score.
    const withinMeasureIntervals: number[] = [];
    const ctx = m.noteTimestampCtx;
    for (let i = 1; i < ctx.length; i++) {
      if (ctx[i].measure === ctx[i - 1].measure && ctx[i].beat === ctx[i - 1].beat + 1) {
        withinMeasureIntervals.push(ctx[i].t - ctx[i - 1].t);
      }
    }
    const rhythm    = computeRhythm(withinMeasureIntervals);
    const comp      = compositeScore(accuracy, evenness, rhythm);

    // ─ Show scorecard ─
    const stats: RunStats = {
      runNumber: exState.runCount,
      errors,
      stales,
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

    // Immediately reset for the next loop.
    resetMetrics();
    setMetronomePlayTrigger(null);
    setStaleActive(false);
    staleTrackerRef.current = { prevNote: null, currentNote: null };
    clearedChordRef.current = -1;
    isFirstNoteRef.current = true;
    diagRunStartRef.current = Date.now();
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
      staleNoteActive: staleActive,
      currentHand:     cn?.staff  ?? null,
      currentFinger:   cn?.finger ?? null,
      exerciseKey:     exState.exercise.key,
      progressionName: exState.exercise.progressionName,
      midiRunning:     midiState.running,
      midiConnected:   midiState.running && midiState.sources.length > 0,
      midiSourceName:  midiState.activeSource ?? "",
      currentVariation,
    }));
  }, [exState, midiState, cn, staleActive]);

  const tappable = !midiState.running;

  return (
    <div className="score-root">
      {diagMode && (
        <DiagPanel
          events={diagEvents}
          onClose={() => setDiagMode(false)}
          onClear={() => { setDiagEvents([]); diagRunStartRef.current = Date.now(); }}
        />
      )}
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
        onReset={() => {
          setLastRunStats(null);
          setRollingAvg(null);
          setRollingCount(0);
        }}
      />
    </div>
  );
}
