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

import type { Exercise, ExerciseNote } from "./voiceLeading";
import { getExercise } from "./voiceLeading";

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
  /** True when the player just played the wrong note (cleared on correct). */
  wrongNoteActive: boolean;
  /** True if any mistake has been made in the current run (cleared on run reset). */
  mistakeThisRun: boolean;
  /** MIDI note number most recently played incorrectly, or null. */
  wrongNotePlayed: number | null;
  /** Index of the exercise variant (0–3), cycling via Next / Prev. */
  exerciseIndex: number;
  /** Currently selected key id, e.g. "G", "Bb". */
  selectedKey: string;
  /** Currently selected progression id, e.g. "pop", "50s". */
  selectedProgression: string;
  /** Total complete runs played since the last config change. */
  runCount: number;
  /** True while a run has just finished and the countdown is ticking.
   *  Notes are ignored during this window. */
  runComplete: boolean;
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

function buildInitialStatuses(notes: ExerciseNote[]): NoteStatus[] {
  // Always mark the first chord group (beat-0 simultaneous notes) as 'current'.
  // For single-note starts this is just [0]; for chord groups it covers all members.
  const firstGroup = new Set(chordGroupOf(notes, 0));
  return notes.map((_, i) => (firstGroup.has(i) ? 'current' : 'pending'));
}

export function initialState(
  exerciseIndex: number = 0,
  key: string = "C",
  progression: string = "50s",
): ExerciseState {
  const exercise = getExercise(exerciseIndex, key, progression);
  return {
    exercise,
    currentNoteIndex: 0,
    noteStatuses: buildInitialStatuses(exercise.notes),
    wrongNoteActive: false,
    mistakeThisRun: false,
    wrongNotePlayed: null,
    exerciseIndex,
    selectedKey: key,
    selectedProgression: progression,
    runCount: 0,
    runComplete: false,
  };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export type Action =
  | { type: "NOTE_PLAYED"; midiNote: number }
  | { type: "CHORD_ACCEPTED" }
  | { type: "ADVANCE_EXERCISE" }   // next variant (wraps 3 → 0)
  | { type: "PREV_EXERCISE" }      // previous variant (wraps 0 → 3)
  | { type: "RESTART_EXERCISE" }   // clear errors, restart current variant
  | { type: "BEGIN_NEXT_RUN" }     // start the next loop after a run completes
  | { type: "SET_CONFIG_KEY"; key: string }
  | { type: "SET_CONFIG_PROGRESSION"; progression: string };

export function reduce(state: ExerciseState, action: Action): ExerciseState {
  switch (action.type) {
    case "NOTE_PLAYED": {
      // Auto-detect chord group vs single note from the exercise structure.
      const targetPitches = chordGroupPitches(state.exercise.notes, state.currentNoteIndex);
      return targetPitches.length > 1
        ? handleNotePlayedChordMode(state, action.midiNote)
        : handleNotePlayed(state, action.midiNote);
    }
    case "CHORD_ACCEPTED":
      return handleChordAccepted(state);
    case "BEGIN_NEXT_RUN":
      return handleBeginNextRun(state);
    case "ADVANCE_EXERCISE":
      return initialState((state.exerciseIndex + 1) % 4, state.selectedKey, state.selectedProgression);
    case "PREV_EXERCISE":
      return initialState((state.exerciseIndex + 3) % 4, state.selectedKey, state.selectedProgression);
    case "RESTART_EXERCISE":
      return initialState(state.exerciseIndex, state.selectedKey, state.selectedProgression);
    case "SET_CONFIG_KEY":
      return initialState(0, action.key, state.selectedProgression);
    case "SET_CONFIG_PROGRESSION":
      return initialState(0, state.selectedKey, action.progression);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// BEGIN_NEXT_RUN — called by App.tsx when the countdown expires
// ---------------------------------------------------------------------------

function handleBeginNextRun(state: ExerciseState): ExerciseState {
  const resetStatuses = buildInitialStatuses(state.exercise.notes);
  return {
    ...state,
    noteStatuses: resetStatuses,
    currentNoteIndex: 0,
    wrongNoteActive: false,
    mistakeThisRun: false,
    wrongNotePlayed: null,
    runComplete: false,
  };
}

// ---------------------------------------------------------------------------
// Sight-reading note handler
// ---------------------------------------------------------------------------

function handleNotePlayed(state: ExerciseState, midiNote: number): ExerciseState {
  if (state.runComplete) return state; // ignore notes during countdown

  const expected = state.exercise.notes[state.currentNoteIndex];
  if (!expected) return state;

  const isCorrect = midiNote === expected.pitch;

  if (!isCorrect) {
    return {
      ...state,
      wrongNoteActive: true,
      mistakeThisRun: true,
      wrongNotePlayed: midiNote,
    };
  }

  // Correct note — mark and advance.
  const newStatuses = [...state.noteStatuses];
  newStatuses[state.currentNoteIndex] = "correct";
  const nextIndex = state.currentNoteIndex + 1;
  const isRunComplete = nextIndex >= state.exercise.notes.length;

  if (isRunComplete) {
    // Signal run complete — App.tsx starts the countdown.
    return {
      ...state,
      noteStatuses: newStatuses,
      currentNoteIndex: nextIndex,
      wrongNoteActive: false,
      mistakeThisRun: false,
      wrongNotePlayed: null,
      runCount: state.runCount + 1,
      runComplete: true,
    };
  }

  newStatuses[nextIndex] = "current";
  return {
    ...state,
    noteStatuses: newStatuses,
    currentNoteIndex: nextIndex,
    wrongNoteActive: false,
    wrongNotePlayed: null,
  };
}

// ---------------------------------------------------------------------------
// Chord recognition handlers
// ---------------------------------------------------------------------------

/**
 * Called when App.tsx detects that all pitches of the current chord group
 * are simultaneously held. Marks the group correct and advances.
 */
function handleChordAccepted(state: ExerciseState): ExerciseState {
  if (state.runComplete) return state;

  const notes = state.exercise.notes;
  const groupIndices = chordGroupOf(notes, state.currentNoteIndex);
  if (groupIndices.length === 0) return state;

  const newStatuses = [...state.noteStatuses];
  for (const i of groupIndices) newStatuses[i] = 'correct';

  const lastInGroup = Math.max(...groupIndices);
  const nextIndex   = lastInGroup + 1;
  const isRunComplete = nextIndex >= notes.length;

  if (isRunComplete) {
    // Signal run complete — App.tsx starts the countdown.
    return {
      ...state,
      noteStatuses: newStatuses,
      currentNoteIndex: nextIndex,
      wrongNoteActive: false,
      mistakeThisRun: false,
      wrongNotePlayed: null,
      runCount: state.runCount + 1,
      runComplete: true,
    };
  }

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

/** Wrong non-target note pressed in chord mode — flag error, do not advance. */
function handleNotePlayedChordMode(state: ExerciseState, midiNote: number): ExerciseState {
  if (state.runComplete) return state;
  const target = chordGroupPitches(state.exercise.notes, state.currentNoteIndex);
  if (target.includes(midiNote)) return state; // correct partial chord press
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
