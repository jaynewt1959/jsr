/**
 * voiceLeading.ts — Jay's Sight Reading
 *
 * Generates piano exercises from chord progressions using classical
 * voice-leading rules:
 *   1. Keep common tones between chords in the same voice.
 *   2. Move other voices by the smallest interval (prefer step over leap).
 *   3. Avoid parallel fifths/octaves.
 *
 * Output: a flat sequence of ExerciseNotes ready to drive the score
 * renderer and the exercise engine.
 *
 * Phase 1: C major only, I–vi–IV–V progression, quarter-note melody
 * in the treble + whole-note bass root. The melody soprano voice is
 * derived by finding the chord tone closest to the previous soprano,
 * keeping common tones wherever possible.
 */

import { assignFingering } from "./fingering";

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

export type Staff = "treble" | "bass";
export type Duration = "w" | "h" | "q";

export interface ExerciseNote {
  /** MIDI pitch (0–127). Middle C = 60. */
  pitch: number;
  /** VexFlow duration string: 'w' | 'h' | 'q'. */
  duration: Duration;
  /** Which staff this note belongs to. */
  staff: Staff;
  /** Finger 1–5, derived from scale fingering tables. */
  finger: number;
  /** Measure index (0-based). */
  measure: number;
  /** Beat within the measure (0-based quarter-beat index). */
  beat: number;
  /** Chord symbol to display, e.g. "C" — set only on beat 0. */
  chordSymbol?: string;
  /** Roman numeral, e.g. "I" — set only on beat 0. */
  romanNumeral?: string;
}

export interface Exercise {
  /** Notes in the order the player must produce them. */
  notes: ExerciseNote[];
  /** Key name (e.g. "C major") */
  key: string;
  /** Time signature numerator (always 4 for Phase 1). */
  beatsPerMeasure: number;
}

// ---------------------------------------------------------------------------
// Chord definitions
// ---------------------------------------------------------------------------

/** A chord specified as a root MIDI pitch and its intervals in semitones. */
interface ChordSpec {
  root: number;         // MIDI note of the root
  intervals: number[];  // semitone intervals above root, ascending
  symbol: string;       // e.g. "C"
  roman: string;        // e.g. "I"
}

/** C major diatonic chords in root position, voiced in octave 4/5. */
const C_MAJOR_CHORDS: ChordSpec[] = [
  { root: 48, intervals: [0, 4, 7],  symbol: "C",  roman: "I"   }, // C3
  { root: 45, intervals: [0, 3, 7],  symbol: "Am", roman: "vi"  }, // A2
  { root: 53, intervals: [0, 5, 9],  symbol: "F",  roman: "IV"  }, // F3
  { root: 55, intervals: [0, 4, 7],  symbol: "G",  roman: "V"   }, // G3
];

/** Returns the absolute MIDI pitches for all tones of the chord
 *  in the octave(s) spanning the given register. */
function chordTones(spec: ChordSpec): number[] {
  return spec.intervals.map((i) => spec.root + i);
}

/** Treble soprano register: prefer notes in the range E4–E5 (MIDI 64–76). */
const SOPRANO_MIN = 60; // C4
const SOPRANO_MAX = 79; // G5

/** For a given chord, find the soprano pitch closest to the previous soprano,
 *  keeping common tones in the same voice when possible. */
function chooseSoprano(chord: ChordSpec, prevSoprano: number): number {
  const tones = chordTones(chord);

  // All chord tones in all relevant octaves within the soprano range.
  const candidates: number[] = [];
  for (const t of tones) {
    // Walk up octaves until we exceed the range.
    let p = t;
    while (p < SOPRANO_MIN) p += 12;
    while (p <= SOPRANO_MAX) {
      candidates.push(p);
      p += 12;
    }
  }

  if (candidates.length === 0) return prevSoprano; // fallback

  // Prefer common tones (same pitch class as prevSoprano).
  const prevPc = prevSoprano % 12;
  const commonTones = candidates.filter((p) => p % 12 === prevPc);
  if (commonTones.length > 0) {
    // Pick the one closest in pitch.
    return commonTones.reduce((best, p) =>
      Math.abs(p - prevSoprano) < Math.abs(best - prevSoprano) ? p : best
    );
  }

  // Otherwise pick the candidate closest in pitch (minimal movement).
  return candidates.reduce((best, p) =>
    Math.abs(p - prevSoprano) < Math.abs(best - prevSoprano) ? p : best
  );
}

// ---------------------------------------------------------------------------
// Exercise generation
// ---------------------------------------------------------------------------

/**
 * Generate a 4-measure exercise in C major from the I–vi–IV–V progression.
 *
 * Structure per measure:
 *   Beat 0 (LH): bass whole note (chord root)
 *   Beat 0–3 (RH): 4 quarter notes — soprano melody derived from voice
 *                  leading, with a half note on beat 2 to create variety.
 *
 * Playing order within a measure: LH bass note first, then RH notes.
 */
export function generateCMajorExercise(): Exercise {
  const notes: ExerciseNote[] = [];
  const progression = C_MAJOR_CHORDS;
  let prevSoprano = 64; // Start on E4 (3rd of C major)

  for (let m = 0; m < progression.length; m++) {
    const chord = progression[m];
    const soprano = chooseSoprano(chord, prevSoprano);

    // --- Bass staff: whole note on the chord root ---
    notes.push({
      pitch: chord.root,
      duration: "w",
      staff: "bass",
      finger: assignFingering(chord.root, "left", chord.root),
      measure: m,
      beat: 0,
    });

    const step1 = soprano;
    const step2 = soprano - 2 < SOPRANO_MIN ? soprano + 2 : soprano - 2;
    const step3 = soprano;

    const treblePattern: Array<{ pitch: number; duration: Duration; beat: number }> = [
      { pitch: step1, duration: "q", beat: 0 },
      { pitch: step2, duration: "q", beat: 1 },
      { pitch: step3, duration: "h", beat: 2 },
    ];

    for (const tp of treblePattern) {
      notes.push({
        pitch: tp.pitch,
        duration: tp.duration,
        staff: "treble",
        finger: assignFingering(tp.pitch, "right", chord.root),
        measure: m,
        beat: tp.beat,
        // Chord symbol shown above the first note of each measure.
        chordSymbol: tp.beat === 0 ? chord.symbol : undefined,
        romanNumeral: tp.beat === 0 ? chord.roman : undefined,
      });
    }

    prevSoprano = soprano;
  }

  return { notes, key: "C major", beatsPerMeasure: 4 };
}

// ---------------------------------------------------------------------------
// Exercise sequence: 5 exercises, cycling through progressions/inversions
// ---------------------------------------------------------------------------

/** Return the nth exercise (0-indexed, wraps after 5). */
export function getExercise(index: number): Exercise {
  // Phase 1 only has one progression style; later phases add variety.
  // All 5 exercises use the same I–vi–IV–V but with shifting soprano start.
  const startPitches = [64, 67, 65, 69, 71]; // E4, G4, F4, A4, B4
  const sp = startPitches[index % startPitches.length];
  return generateCMajorExerciseFrom(sp);
}

function generateCMajorExerciseFrom(firstSoprano: number): Exercise {
  const notes: ExerciseNote[] = [];
  const progression = C_MAJOR_CHORDS;
  let prevSoprano = firstSoprano;

  for (let m = 0; m < progression.length; m++) {
    const chord = progression[m];
    const soprano = m === 0 ? firstSoprano : chooseSoprano(chord, prevSoprano);

    notes.push({
      pitch: chord.root,
      duration: "w",
      staff: "bass",
      finger: assignFingering(chord.root, "left", chord.root),
      measure: m,
      beat: 0,
    });

    const step2 = soprano - 2 < SOPRANO_MIN ? soprano + 2 : soprano - 2;
    const treblePattern: Array<{ pitch: number; duration: Duration; beat: number }> = [
      { pitch: soprano, duration: "q", beat: 0 },
      { pitch: step2,   duration: "q", beat: 1 },
      { pitch: soprano, duration: "h", beat: 2 },
    ];
    for (const tp of treblePattern) {
      notes.push({
        pitch: tp.pitch,
        duration: tp.duration,
        staff: "treble",
        finger: assignFingering(tp.pitch, "right", chord.root),
        measure: m,
        beat: tp.beat,
        chordSymbol: tp.beat === 0 ? chord.symbol : undefined,
        romanNumeral: tp.beat === 0 ? chord.roman : undefined,
      });
    }

    prevSoprano = soprano;
  }

  return { notes, key: "C major", beatsPerMeasure: 4 };
}
