/**
 * voiceLeading.ts — Jay's Sight Reading
 *
 * Generates piano exercises using economy-of-movement voice leading.
 * For each chord in the progression the engine selects the inversion
 * (root / 1st / 2nd) whose three voices travel the fewest semitones
 * in total from the previous chord.  Common tones stay put; others
 * move by the smallest available step.  This mirrors classical four-
 * part writing and produces naturally pleasing melodic movement.
 *
 * Right hand (treble): broken arpeggio — bottom note (q), middle (q),
 *   top note (h).  Every note is a genuine chord tone.
 * Left hand (bass): chord root as a whole note, finger 5 (pinky).
 *
 * Example — I–vi–IV–V in C major, starting in root position:
 *   C  → C E G  (root,     fingers 1-3-5)
 *   Am → C E A  (1st inv,  fingers 1-2-5)   G stays → A, only +2
 *   F  → C F A  (2nd inv,  fingers 1-3-5)   E→F only +1, rest stay
 *   G  → D G B  (2nd inv,  fingers 1-3-5)   each voice moves by 2
 */

export type Staff = "treble" | "bass";
export type Duration = "w" | "h" | "q";

export interface ExerciseNote {
  /** MIDI pitch (0–127). Middle C = 60. */
  pitch: number;
  duration: Duration;
  staff: Staff;
  /** Finger 1–5. */
  finger: number;
  /** 0-based measure index. */
  measure: number;
  /** 0-based beat within the measure. */
  beat: number;
  chordSymbol?: string;
  romanNumeral?: string;
}

export interface Exercise {
  notes: ExerciseNote[];
  key: string;
  beatsPerMeasure: number;
}

// ---------------------------------------------------------------------------
// Chord definitions
// ---------------------------------------------------------------------------

const MAJOR = [0, 4, 7] as const;
const MINOR = [0, 3, 7] as const;

interface ChordDef {
  /** Root pitch class: 0 = C … 11 = B. */
  pitchClass: number;
  intervals: readonly number[];
  /** MIDI note for the LH bass whole note. */
  bassRoot: number;
  symbol: string;
  roman: string;
}

/** I – vi – IV – V in C major. */
const C_MAJOR_PROGRESSION: ChordDef[] = [
  { pitchClass: 0, intervals: MAJOR, bassRoot: 48, symbol: "C",  roman: "I"  }, // C3
  { pitchClass: 9, intervals: MINOR, bassRoot: 45, symbol: "Am", roman: "vi" }, // A2
  { pitchClass: 5, intervals: MAJOR, bassRoot: 53, symbol: "F",  roman: "IV" }, // F3
  { pitchClass: 7, intervals: MAJOR, bassRoot: 55, symbol: "G",  roman: "V"  }, // G3
];

// ---------------------------------------------------------------------------
// Voicing engine
// ---------------------------------------------------------------------------

/** Three MIDI pitches in ascending order. */
type Voicing = [number, number, number];

/** Comfortable right-hand soprano register. */
const TREBLE_MIN = 60; // C4
const TREBLE_MAX = 84; // C6

/**
 * Generate every close-position voicing of `chord` that fits within
 * [TREBLE_MIN, TREBLE_MAX].  All three inversions are tried at every
 * possible octave position within the range.
 */
function getAllVoicings(chord: ChordDef): Voicing[] {
  const result: Voicing[] = [];
  const pcs = chord.intervals.map(i => (chord.pitchClass + i) % 12);

  for (let inv = 0; inv < 3; inv++) {
    const lowestPC = pcs[inv];

    for (let base = TREBLE_MIN; base <= TREBLE_MAX; base++) {
      if (base % 12 !== lowestPC) continue;

      // Walk upward from base, snapping to each successive pitch class.
      let p = base;
      const notes: number[] = [p];
      for (let j = 1; j < 3; j++) {
        const nextPC = pcs[(inv + j) % 3];
        p++;
        while (p % 12 !== nextPC) p++;
        notes.push(p);
      }

      if (notes[2] <= TREBLE_MAX) {
        result.push(notes as unknown as Voicing);
      }
    }
  }

  return result;
}

/** Total semitone movement between two voicings (voice-by-voice). */
function totalMovement(a: Voicing, b: Voicing): number {
  return (
    Math.abs(a[0] - b[0]) +
    Math.abs(a[1] - b[1]) +
    Math.abs(a[2] - b[2])
  );
}

/**
 * Choose the inversion of `chord` that minimises total voice movement
 * from `prev`.  Ties are broken by taking the first candidate (root
 * position preferred, lower octave preferred).
 */
function bestVoicing(chord: ChordDef, prev: Voicing): Voicing {
  const candidates = getAllVoicings(chord);
  if (candidates.length === 0) return prev;
  return candidates.reduce((best, v) =>
    totalMovement(v, prev) < totalMovement(best, prev) ? v : best
  );
}

// ---------------------------------------------------------------------------
// Left-hand fingering — single bass root per measure
// ---------------------------------------------------------------------------

/**
 * Map each bass note to a finger using linear interpolation across the
 * full pitch range of the progression: lowest note → pinky (5),
 * highest note → thumb (1).  Economy of movement: higher notes get
 * lower finger numbers so the hand shifts minimally between chords.
 */
function lhFingering(bassNote: number, allBassNotes: number[]): number {
  const lo = Math.min(...allBassNotes);
  const hi = Math.max(...allBassNotes);
  if (hi === lo) return 3;
  const t = (bassNote - lo) / (hi - lo); // 0 = lowest, 1 = highest
  return Math.max(1, Math.min(5, 5 - Math.round(4 * t)));
}

// ---------------------------------------------------------------------------
// Right-hand fingering for close-position triads
// ---------------------------------------------------------------------------

/**
 * Assign fingers 1, 2-or-3, 5 to a 3-note close-position voicing.
 *
 *   Lower interval ≥ 5 (4th or larger at bottom)     → 1-3-5  e.g. C-F-A, D-G-B
 *   Lower interval = 4 (major 3rd) + upper ≥ 5       → 1-2-5  e.g. C-E-A
 *   Lower interval = 4 (major 3rd) + upper ≤ 4       → 1-3-5  e.g. C-E-G
 */
function rhFingering(voicing: Voicing): [number, number, number] {
  const lower = voicing[1] - voicing[0];
  const upper = voicing[2] - voicing[1];
  if (lower <= 4 && upper >= 5) return [1, 2, 5];
  return [1, 3, 5];
}

// ---------------------------------------------------------------------------
// Exercise builder
// ---------------------------------------------------------------------------

function buildExercise(
  progression: ChordDef[],
  startVoicing: Voicing
): Exercise {
  const notes: ExerciseNote[] = [];
  let prevVoicing = startVoicing;

  const allBassRoots = progression.map(c => c.bassRoot);

  for (let m = 0; m < progression.length; m++) {
    const chord = progression[m];
    const voicing = m === 0 ? startVoicing : bestVoicing(chord, prevVoicing);
    prevVoicing = voicing;

    const [f1, f2, f5] = rhFingering(voicing);
    const lhFinger = lhFingering(chord.bassRoot, allBassRoots);

    // LH: chord root, whole note, plays on beat 1 (during treble rest).
    notes.push({
      pitch:    chord.bassRoot,
      duration: "w",
      staff:    "bass",
      finger:   lhFinger,
      measure:  m,
      beat:     0,
    });

    // RH: beat 1 is a visual rest (rendered by ScoreView).
    //     Beats 2-4: three quarter notes — the arpeggio.
    const treble: Array<{
      pitch: number; duration: Duration; beat: number; finger: number;
    }> = [
      { pitch: voicing[0], duration: "q", beat: 1, finger: f1 },
      { pitch: voicing[1], duration: "q", beat: 2, finger: f2 },
      { pitch: voicing[2], duration: "q", beat: 3, finger: f5 },
    ];

    for (const t of treble) {
      notes.push({
        pitch:        t.pitch,
        duration:     t.duration,
        staff:        "treble",
        finger:       t.finger,
        measure:      m,
        beat:         t.beat,
        // Symbol on the first note of each measure (beat 1, not beat 0).
        chordSymbol:  t.beat === 1 ? chord.symbol : undefined,
        romanNumeral: t.beat === 1 ? chord.roman  : undefined,
      });
    }
  }

  return { notes, key: "C major", beatsPerMeasure: 4 };
}

// ---------------------------------------------------------------------------
// Public API — 5-exercise session
// ---------------------------------------------------------------------------

/**
 * Four starting voicings of C major, one per inversion (with a higher-
 * octave root position for variety).  Each starting voicing produces a
 * distinct sequence of inversions through the rest of the progression.
 *
 *   Ex 0: C4-E4-G4  root    → Am: C-E-A  → F: C-F-A  → G: D-G-B
 *   Ex 1: E4-G4-C5  1st inv → Am: E-A-C  → F: F-A-C  → G: G-B-D
 *   Ex 2: G4-C5-E5  2nd inv → Am: A-C-E  → F: A-C-F  → G: G-B-D
 *   Ex 3: C5-E5-G5  root↑   → Am: C-E-A  → F: C-F-A  → G: B-D-G
 */
const C_MAJOR_STARTS: Voicing[] = [
  [60, 64, 67], // C4-E4-G4  root position
  [64, 67, 72], // E4-G4-C5  first inversion
  [67, 72, 76], // G4-C5-E5  second inversion
  [72, 76, 79], // C5-E5-G5  root position (higher)
];

export function getExercise(index: number): Exercise {
  const start = C_MAJOR_STARTS[index % C_MAJOR_STARTS.length];
  return buildExercise(C_MAJOR_PROGRESSION, start);
}
