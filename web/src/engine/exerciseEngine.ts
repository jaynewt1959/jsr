/**
 * exerciseEngine.ts — Jay's Sight Reading
 *
 * Manages the state machine for a sight-reading session:
 *   - Current exercise (sequence of ExerciseNotes)
 *   - Current note index (which note the player must play next)
 *   - Per-note feedback (correct / wrong)
 *   - Pass count (# of consecutive error-free runs through the exercise)
 *   - Session exercise index (which exercise in the session we're on)
 *
 * The engine is a pure reducer: ExerciseState + action → ExerciseState.
 * No side effects. React state holds the latest ExerciseState.
 */

import type { Exercise, ExerciseNote, AppMode } from "./voiceLeading";
import { getExercise, getChordRecognitionExercise } from "./voiceLeading";

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

export type NoteStatus = "pending" | "current" | "correct" | "wrong";

export interface ExerciseState {
  /** The full exercise object (notes, key, etc.) */
  exercise: Exercise;
  /** Index of the note the player must play next (0 = first note). */
  currentNoteIndex: number;
  /** Per-note status array, parallel to exercise.notes. */
  noteStatuses: NoteStatus[];
  /** Number of consecutive error-free runs since the exercise started. */
  passCount: number;
  /** True when the player just played the wrong note (cleared on correct). */
  wrongNoteActive: boolean;
  /** True if any mistake has been made in the current run (cleared on run reset). */
  mistakeThisRun: boolean;
  /** MIDI note number most recently played incorrectly, or null. */
  wrongNotePlayed: number | null;
  /** Index of the exercise in the session (0–4). */
  exerciseIndex: number;
  /** True when 3 passes are complete and we should advance. */
  exerciseComplete: boolean;
  /** Currently selected key id, e.g. "G", "Bb". */
  selectedKey: string;
  /** Currently selected progression id, e.g. "pop", "50s". */
  selectedProgression: string;
  /** Current training mode. */
  appMode: AppMode;
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Chord-group helpers
// ---------------------------------------------------------------------------

/**
 * Returns the indices of all notes that share the same (measure, beat)
 * as notes[idx] — i.e. the full chord group the note belongs to.
 */
export function chordGroupOf(notes: ExerciseNote[], idx: number): number[] {
  const ref = notes[idx];
  if (!ref) return [];
  return notes
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => n.measure === ref.measure && n.beat === ref.beat)
    .map(({ i }) => i);
}

/** Pitches of the chord group containing notes[idx]. */
export function chordGroupPitches(notes: ExerciseNote[], idx: number): number[] {
  return chordGroupOf(notes, idx).map(i => notes[i].pitch);
}

function buildInitialStatuses(notes: ExerciseNote[], mode: AppMode = 'sightReading'): NoteStatus[] {
  if (mode === 'chordRecognition') {
    // First chord group → 'current', rest → 'pending'.
    const firstGroup = new Set(chordGroupOf(notes, 0));
    return notes.map((_, i) => (firstGroup.has(i) ? 'current' : 'pending'));
  }
  return notes.map((_, i) => (i === 0 ? "current" : "pending"));
}

export function initialState(
  exerciseIndex: number = 0,
  key: string = "C",
  progression: string = "50s",
  mode: AppMode = 'sightReading',
): ExerciseState {
  const exercise =
    mode === 'chordRecognition'
      ? getChordRecognitionExercise(key, progression)
      : getExercise(exerciseIndex, key, progression);
  return {
    exercise,
    currentNoteIndex: 0,
    noteStatuses: buildInitialStatuses(exercise.notes, mode),
    passCount: 0,
    wrongNoteActive: false,
    mistakeThisRun: false,
    wrongNotePlayed: null,
    exerciseIndex,
    exerciseComplete: false,
    selectedKey: key,
    selectedProgression: progression,
    appMode: mode,
  };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export type Action =
  | { type: "NOTE_PLAYED"; midiNote: number }
  | { type: "CHORD_ACCEPTED" }
  | { type: "ADVANCE_EXERCISE" }
  | { type: "RESTART_EXERCISE" }
  | { type: "SET_CONFIG_KEY"; key: string }
  | { type: "SET_CONFIG_PROGRESSION"; progression: string }
  | { type: "SET_MODE"; mode: AppMode };

export function reduce(state: ExerciseState, action: Action): ExerciseState {
  switch (action.type) {
    case "NOTE_PLAYED":
      return state.appMode === 'chordRecognition'
        ? handleNotePlayedChordMode(state, action.midiNote)
        : handleNotePlayed(state, action.midiNote);
    case "CHORD_ACCEPTED":
      return handleChordAccepted(state);
    case "ADVANCE_EXERCISE": {
      const next = state.exerciseIndex + 1;
      return initialState(next, state.selectedKey, state.selectedProgression, state.appMode);
    }
    case "RESTART_EXERCISE":
      return initialState(state.exerciseIndex, state.selectedKey, state.selectedProgression, state.appMode);
    case "SET_CONFIG_KEY":
      return initialState(0, action.key, state.selectedProgression, state.appMode);
    case "SET_CONFIG_PROGRESSION":
      return initialState(0, state.selectedKey, action.progression, state.appMode);
    case "SET_MODE":
      return initialState(0, state.selectedKey, state.selectedProgression, action.mode);
    default:
      return state;
  }
}

function handleNotePlayed(state: ExerciseState, midiNote: number): ExerciseState {
  if (state.exerciseComplete) return state;

  const expected = state.exercise.notes[state.currentNoteIndex];
  if (!expected) return state;

  const isCorrect = midiNote === expected.pitch;

  if (!isCorrect) {
    // Stay on the same note. Keep its status "current" (blue) so the
    // header banner "play the blue note" is accurate — the target note
    // must remain visually identifiable. wrongNoteActive drives the banner.
    return {
      ...state,
      wrongNoteActive: true,
      mistakeThisRun: true,
      wrongNotePlayed: midiNote,
    };
  }

  // Correct note played.
  const newStatuses = [...state.noteStatuses];
  newStatuses[state.currentNoteIndex] = "correct";

  const nextIndex = state.currentNoteIndex + 1;
  const isRunComplete = nextIndex >= state.exercise.notes.length;

  if (isRunComplete) {
    // Check whether this run was error-free (all statuses "correct" —
    // which they must be since we just set the last one to "correct").
    // A "wrong" in this run means wrongNoteActive was set at some point.
    // We track it via a flag: if wrongNoteActive was ever true during this
    // run, the run is not clean. We use a simple approach: if wrong was
    // active at any point, it would have been left set. The user replays
    // the correct note and clears it each time via isCorrect path above,
    // but the wrongNoteActive flag itself isn't cleared here. So we need
    // to track run-level errors differently.
    //
    // Simple approach: count a pass only if all statuses are "correct"
    // (none ever stayed "wrong" — which they can't since wrong->correct
    // is the only path). Actually every wrong note forces a re-play of the
    // same note until correct, so by the time we reach the end of a run,
    // every note in noteStatuses is "correct". The question is: did the
    // user make any mistake during this run?
    //
    // We track mistakes with wrongNoteActive on the current run.
    // If wrongNoteActive is false right now (the last note came in clean),
    // AND no "wrong" was ever permanently lodged, this could be a clean run.
    // But we need to track "was wrong ever triggered this run?".
    //
    // Add a `mistakeThisRun` field to track this properly:
    const runWasClean = !state.mistakeThisRun;
    const newPassCount = runWasClean ? state.passCount + 1 : 0;
    const exerciseComplete = newPassCount >= 3;

    if (exerciseComplete) {
      return {
        ...state,
        noteStatuses: newStatuses,
        currentNoteIndex: nextIndex,
        passCount: newPassCount,
        wrongNoteActive: false,
        mistakeThisRun: false,
        wrongNotePlayed: null,
        exerciseComplete: true,
      };
    }

    // Start the next run: reset statuses to pending/current.
    const resetStatuses = buildInitialStatuses(state.exercise.notes);
    return {
      ...state,
      noteStatuses: resetStatuses,
      currentNoteIndex: 0,
      passCount: newPassCount,
      wrongNoteActive: false,
      mistakeThisRun: false,
      wrongNotePlayed: null,
    };
  }

  // Not end of run — advance to next note.
  newStatuses[nextIndex] = "current";
  return {
    ...state,
    noteStatuses: newStatuses,
    currentNoteIndex: nextIndex,
    wrongNoteActive: false,
    // mistakeThisRun stays true if it was set earlier in this run
    wrongNotePlayed: null,
  };
}

// ---------------------------------------------------------------------------
// Chord mode handlers
// ---------------------------------------------------------------------------

/**
 * Called when App.tsx detects that all pitches of the current chord group
 * are simultaneously held. Marks the group correct and advances.
 */
function handleChordAccepted(state: ExerciseState): ExerciseState {
  if (state.exerciseComplete) return state;

  const notes = state.exercise.notes;
  const groupIndices = chordGroupOf(notes, state.currentNoteIndex);
  if (groupIndices.length === 0) return state;

  // Mark all notes in the current chord group as correct.
  const newStatuses = [...state.noteStatuses];
  for (const i of groupIndices) newStatuses[i] = 'correct';

  // Find the first note of the next chord group.
  const lastInGroup = Math.max(...groupIndices);
  const nextIndex   = lastInGroup + 1;
  const isRunComplete = nextIndex >= notes.length;

  if (isRunComplete) {
    const runWasClean  = !state.mistakeThisRun;
    const newPassCount = runWasClean ? state.passCount + 1 : 0;
    const exerciseComplete = newPassCount >= 3;

    if (exerciseComplete) {
      return {
        ...state,
        noteStatuses: newStatuses,
        currentNoteIndex: nextIndex,
        passCount: newPassCount,
        wrongNoteActive: false,
        mistakeThisRun: false,
        wrongNotePlayed: null,
        exerciseComplete: true,
      };
    }

    // Next run: reset all statuses, move back to first chord group.
    const resetStatuses = buildInitialStatuses(notes, 'chordRecognition');
    return {
      ...state,
      noteStatuses: resetStatuses,
      currentNoteIndex: 0,
      passCount: newPassCount,
      wrongNoteActive: false,
      mistakeThisRun: false,
      wrongNotePlayed: null,
    };
  }

  // Advance: mark next chord group as current.
  const nextGroupIndices = chordGroupOf(notes, nextIndex);
  for (const i of nextGroupIndices) newStatuses[i] = 'current';

  return {
    ...state,
    noteStatuses: newStatuses,
    currentNoteIndex: nextIndex,
    wrongNoteActive: false,
    wrongNotePlayed: null,
  };
}

/**
 * In chord recognition mode a NOTE_PLAYED means a wrong (non-target) note
 * was pressed. We flag the error but do not advance.
 */
function handleNotePlayedChordMode(state: ExerciseState, midiNote: number): ExerciseState {
  if (state.exerciseComplete) return state;
  const target = chordGroupPitches(state.exercise.notes, state.currentNoteIndex);
  if (target.includes(midiNote)) {
    // A correct target note was pressed (partial chord — App.tsx will dispatch
    // CHORD_ACCEPTED when the group is complete). No state change needed here.
    return state;
  }
  // Wrong note.
  return {
    ...state,
    wrongNoteActive: true,
    mistakeThisRun: true,
    wrongNotePlayed: midiNote,
  };
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/** The note the player must play right now. */
export function currentNote(state: ExerciseState): ExerciseNote | null {
  return state.exercise.notes[state.currentNoteIndex] ?? null;
}

/** Human-readable pass progress, e.g. "2 / 3". */
export function passLabel(state: ExerciseState): string {
  return `${state.passCount} / 3`;
}
