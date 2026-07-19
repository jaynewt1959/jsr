/**
 * voiceLeading.ts — Jay's Sight Reading
 *
 * Generates piano exercises using economy-of-movement voice leading.
 * Supports any of 12 major keys × 5 common chord progressions.
 *
 * Each measure:
 *   Beat 0 — simultaneous chord group: LH bass root + RH all 3 chord notes.
 *   Beats 1–3 — RH broken arpeggio (bottom → middle → top).
 */

export type Staff = "treble" | "bass";
export type Duration = "w" | "h" | "q" | "8";

export interface ExerciseNote {
  /** MIDI pitch (0–127). Middle C = 60. */
  pitch: number;
  duration: Duration;
  staff: Staff;
  /** Finger 1–5; 0 = no annotation shown. */
  finger: number;
  /** 0-based measure index. */
  measure: number;
  /**
   * 0-based beat within the measure.
   * Quarter-note exercises: 0–3.
   * Bass-line mode: 0–7 (eighth-note positions).
   */
  beat: number;
  chordSymbol?: string;
  romanNumeral?: string;
}

export interface Exercise {
  notes: ExerciseNote[];
  /**
   * Static reference notes displayed but NOT validated (bass mode only).
   * Contains the treble block chord for each measure so the player can see
   * which harmony is implied by the bass line they're playing.
   */
  referenceNotes?: ExerciseNote[];
  /** True when this is a bass-line-only exercise (Stage 1 bass mode). */
  bassMode?: boolean;
  /** True when this is a combined (both-hands) exercise (Stage 2). */
  combinedMode?: boolean;
  key: string;
  beatsPerMeasure: number;
  progressionName: string;
  progressionLabel: string;
}

// ---------------------------------------------------------------------------
// Key definitions
// ---------------------------------------------------------------------------

export interface KeyDef {
  /** Display name, e.g. "F#", "Bb". */
  id: string;
  /** Root pitch class: 0 = C … 11 = B. */
  pitchClass: number;
  /** True → use flat enharmonic spellings for chord symbols. */
  useFlats: boolean;
}

export const KEYS: KeyDef[] = [
  { id: "C",  pitchClass:  0, useFlats: false },
  { id: "G",  pitchClass:  7, useFlats: false },
  { id: "D",  pitchClass:  2, useFlats: false },
  { id: "A",  pitchClass:  9, useFlats: false },
  { id: "E",  pitchClass:  4, useFlats: false },
  { id: "B",  pitchClass: 11, useFlats: false },
  { id: "F#", pitchClass:  6, useFlats: false },
  { id: "Db", pitchClass:  1, useFlats: true  },
  { id: "Ab", pitchClass:  8, useFlats: true  },
  { id: "Eb", pitchClass:  3, useFlats: true  },
  { id: "Bb", pitchClass: 10, useFlats: true  },
  { id: "F",  pitchClass:  5, useFlats: true  },
];

// ---------------------------------------------------------------------------
// Progression templates
// ---------------------------------------------------------------------------

export interface ProgressionDegree {
  /** Semitones above key root (0=I, 2=ii, 4=iii, 5=IV, 7=V, 9=vi). */
  semitones: number;
  quality: "major" | "minor";
}

export interface ProgressionTemplate {
  id: string;
  name: string;
  /** Roman numeral string shown in the UI, e.g. "I – vi – IV – V". */
  label: string;
  degrees: ProgressionDegree[];
}

export const PROGRESSIONS: ProgressionTemplate[] = [
  {
    id: "blues",
    name: "Blues",
    label: "I \u2013 IV \u2013 V \u2013 I",
    degrees: [
      { semitones: 0, quality: "major" },
      { semitones: 5, quality: "major" },
      { semitones: 7, quality: "major" },
      { semitones: 0, quality: "major" },
    ],
  },
  {
    id: "50s",
    name: "50s",
    label: "I \u2013 vi \u2013 IV \u2013 V",
    degrees: [
      { semitones: 0, quality: "major" },
      { semitones: 9, quality: "minor" },
      { semitones: 5, quality: "major" },
      { semitones: 7, quality: "major" },
    ],
  },
  {
    id: "pop",
    name: "Pop",
    label: "I \u2013 V \u2013 vi \u2013 IV",
    degrees: [
      { semitones: 0, quality: "major" },
      { semitones: 7, quality: "major" },
      { semitones: 9, quality: "minor" },
      { semitones: 5, quality: "major" },
    ],
  },
  {
    id: "circle",
    name: "Circle",
    label: "I \u2013 IV \u2013 ii \u2013 V",
    degrees: [
      { semitones: 0, quality: "major" },
      { semitones: 5, quality: "major" },
      { semitones: 2, quality: "minor" },
      { semitones: 7, quality: "major" },
    ],
  },
  {
    id: "minor-feel",
    name: "Minor Feel",
    label: "vi \u2013 IV \u2013 I \u2013 V",
    degrees: [
      { semitones: 9, quality: "minor" },
      { semitones: 5, quality: "major" },
      { semitones: 0, quality: "major" },
      { semitones: 7, quality: "major" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Bass line patterns
// ---------------------------------------------------------------------------

/**
 * Semitone offsets from the chord root for each of the 8 eighth-note
 * positions in a 4/4 measure.  Only quality-independent intervals
 * (unison, perfect 4th, perfect 5th, octave) are used across chords of
 * mixed quality, except Blues where all chords are major.
 */
const BASS_LINE_PATTERNS: Readonly<Record<string, readonly number[]>> = {
  // Root → M3 → P5 → M6 → m7 → M6 → P5 → M3  (classic boogie, always major)
  blues:        [0, 4, 7, 9, 10, 9, 7, 4],
  // Root → P5 → Oct → P5 → Root → P5 → Oct → P5  (doo-wop pump)
  "50s":        [0, 7, 12, 7,  0, 7, 12, 7],
  // Root → P4 → P5 → Oct → P5 → P4 → P5 → Root  (flowing pop arc)
  pop:          [0, 5,  7, 12,  7, 5,  7, 0],
  // Root → P4 → P5 → P4 → Root → P4 → P5 → P4  (jazz sub-dominant feel)
  circle:       [0, 5,  7,  5,  0, 5,  7, 5],
  // Root → P5 → m7 → Oct → m7 → P5 → Root → P5  (dark minor/rock colour)
  "minor-feel": [0, 7, 10, 12, 10, 7,  0, 7],
};

/**
 * Compute the MIDI pitch for a bass line note given the chord root and a
 * semitone offset from that root.  Result is kept within a readable
 * bass-clef range (C2–C4, MIDI 36–60).  When the raw result exceeds C4
 * it is dropped one octave; the rare case below C2 is raised one octave.
 */
function computeBassLineNote(root: number, semitoneOffset: number): number {
  let n = root + semitoneOffset;
  while (n > 60) n -= 12;   // stay at or below C4 (one ledger line above bass staff)
  while (n < 36) n += 12;   // stay at or above C2
  return n;
}

/**
 * Variant for combined (both-hands) mode.
 *
 * The treble voicing engine guarantees all RH notes are ≥ TREBLE_MIN (C4 = 60).
 * This function clamps the LH bass to ≤ B3 (59) so the two registers can
 * NEVER share a pitch, regardless of key or pattern position.
 *
 * The practical effect is that octave-spanning intervals (pattern value 12)
 * wrap down by one octave for roots above B1 (≈47), which keeps everything
 * in a clean C2–B3 range — the conventional LH register in grand-staff writing.
 */
function computeCombinedBassNote(root: number, semitoneOffset: number): number {
  let n = root + semitoneOffset;
  while (n > 59) n -= 12;   // stay strictly below C4 (treble register floor)
  while (n < 36) n += 12;   // stay at or above C2
  return n;
}

// ---------------------------------------------------------------------------
// Chord definitions
// ---------------------------------------------------------------------------

const MAJOR = [0, 4, 7] as const;
const MINOR = [0, 3, 7] as const;

interface ChordDef {
  pitchClass: number;
  intervals: readonly number[];
  /** MIDI note for the LH bass whole note. */
  bassRoot: number;
  symbol: string;
  roman: string;
}

const SHARP_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"] as const;
const FLAT_NAMES  = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"] as const;

/** Roman numeral for each (semitones-above-root, quality) pair. */
const DEGREE_ROMAN: Record<string, string> = {
  "0_major": "I",    "0_minor": "i",
  "2_major": "II",   "2_minor": "ii",
  "4_major": "III",  "4_minor": "iii",
  "5_major": "IV",   "5_minor": "iv",
  "7_major": "V",    "7_minor": "v",
  "9_major": "VI",   "9_minor": "vi",
  "11_major": "VII", "11_minor": "vii",
};

/**
 * Compute the bass MIDI note for a pitch class.
 * Result lands in 44–55 (Ab2–G3) — comfortable LH range.
 */
function computeBassRoot(pc: number): number {
  let n = pc;
  while (n < 43) n += 12;
  while (n > 55) n -= 12;
  return n;
}

function buildProgression(key: KeyDef, template: ProgressionTemplate): ChordDef[] {
  const names = key.useFlats ? FLAT_NAMES : SHARP_NAMES;
  return template.degrees.map(({ semitones, quality }) => {
    const pc       = (key.pitchClass + semitones) % 12;
    const noteName = names[pc];
    const symbol   = quality === "minor" ? `${noteName}m` : noteName;
    const roman    = DEGREE_ROMAN[`${semitones}_${quality}`] ?? "?";
    return {
      pitchClass: pc,
      intervals:  quality === "major" ? MAJOR : MINOR,
      bassRoot:   computeBassRoot(pc),
      symbol,
      roman,
    };
  });
}

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
 * from `prev`.
 */
function bestVoicing(chord: ChordDef, prev: Voicing): Voicing {
  const candidates = getAllVoicings(chord);
  if (candidates.length === 0) return prev;
  return candidates.reduce((best, v) =>
    totalMovement(v, prev) < totalMovement(best, prev) ? v : best
  );
}

// ---------------------------------------------------------------------------
// Fingering
// ---------------------------------------------------------------------------

/**
 * Assign a left-hand finger (1–5) to a bass root note.
 *
 * Design principles (cf. ABRSM/RCM fingering guidelines; Liveabout
 * "Piano Fingering for the Left Hand"):
 *
 *   • The lowest note always gets the pinky (5); the highest always
 *     gets the thumb (1).
 *
 *   • For 4 distinct pitches the standard patterns are 5-3-2-1 and
 *     5-4-2-1.  We prefer 5-4-2-1 (skip middle finger) when:
 *       (a) the total span is a minor 6th or wider (≥ 8 semitones), or
 *       (b) the 2nd-highest note is at least a 4th above the lowest
 *           (fromLow ≥ 5).  This avoids a cramped 3→1 stretch when
 *           the upper pair is far apart.
 *
 *   • When the two inner notes are very close together (≤ 2 semitones)
 *     the closest-available adjacent fingers are used instead so the
 *     hand is not crossed or cramped.
 *
 * Representative results for 50s C (bass roots G2–A2–C3–F3, span 10):
 *   G2 = 5, A2 = 4, C3 = 2, F3 = 1  (was: C3 = 3 with old algorithm)
 */
function lhFingering(bassNote: number, allBassNotes: number[]): number {
  // Build a sorted, deduplicated list of all distinct bass pitches in
  // the exercise so finger assignments are consistent across measures.
  const unique = [...new Set(allBassNotes)].sort((a, b) => a - b);
  const n   = unique.length;
  const idx = unique.indexOf(bassNote);
  const lo  = unique[0];
  const hi  = unique[n - 1];
  const span = hi - lo;

  if (n <= 1) return 3;          // single pitch → middle finger
  if (idx === 0) return 5;       // lowest  → pinky
  if (idx === n - 1) return 1;   // highest → thumb

  // ── Three distinct pitches ──────────────────────────────────────────────
  if (n === 3) {
    const t = (bassNote - lo) / span;
    if (t < 0.35) return 4;               // close to low end  → ring
    if (t > 0.65 && span > 7) return 2;   // close to high end, wide span → index
    return 3;                              // middle of range   → middle
  }

  // ── Four distinct pitches ───────────────────────────────────────────────
  if (n === 4) {
    const loInterval = unique[1] - lo;         // lowest → 2nd-lowest
    const midGap     = unique[2] - unique[1];   // gap between the two inner notes
    const hiInterval = hi - unique[2];          // 2nd-highest → highest
    const fromLow    = unique[2] - lo;          // 2nd-highest relative to lowest

    // Finger for 2nd-lowest: ring (4) when ≤ a major 3rd from pinky,
    // middle (3) when further away.
    let f1 = loInterval <= 4 ? 4 : 3;

    // Finger for 2nd-highest.
    let f2: number;
    if (midGap <= 2) {
      // Inner notes very close: use the adjacent finger below f1 to
      // avoid an unnatural skip over the middle key.
      f2 = f1 === 4 ? 3 : 2;
    } else if (span >= 8 || fromLow >= 5) {
      // Wide span or 2nd-highest well above the low end:
      // index (2) gives the thumb room to reach the top note.
      f2 = 2;
    } else {
      // Compact span: place index or middle based on the gap to the top.
      f2 = hiInterval <= 3 ? 2 : 3;
    }

    // Prevent duplicate finger assignment.
    if (f1 === f2) {
      if (f2 === 3) f2 = 2;
      else f1 = f1 === 4 ? 3 : 4;
    }

    return idx === 1 ? f1 : f2;
  }

  // ── Five or more distinct pitches (unusual) ─────────────────────────────
  const t = (bassNote - lo) / span;
  return Math.max(1, Math.min(5, 5 - Math.round(4 * t)));
}

function rhFingering(voicing: Voicing): [number, number, number] {
  const lower = voicing[1] - voicing[0];
  const upper = voicing[2] - voicing[1];
  if (lower <= 4 && upper >= 5) return [1, 2, 5];
  return [1, 3, 5];
}

// ---------------------------------------------------------------------------
// Starting voicings — 4 inversions of the first chord in the progression
// ---------------------------------------------------------------------------

/**
 * Generate up to 4 starting voicings of `chord`:
 *   root position (low), first inversion, second inversion, root position (high).
 * These produce distinct sequences of inversions through the rest of the progression.
 */
function getStartingVoicings(chord: ChordDef): Voicing[] {
  const all      = getAllVoicings(chord);
  const rootPC   = chord.pitchClass;
  const thirdPC  = (chord.pitchClass + chord.intervals[1]) % 12;
  const fifthPC  = (chord.pitchClass + chord.intervals[2]) % 12;

  const rootPos   = all.filter(v => v[0] % 12 === rootPC)  .sort((a, b) => a[0] - b[0]);
  const firstInv  = all.filter(v => v[0] % 12 === thirdPC) .sort((a, b) => a[0] - b[0]);
  const secondInv = all.filter(v => v[0] % 12 === fifthPC) .sort((a, b) => a[0] - b[0]);

  const starts: Voicing[] = [];
  if (rootPos[0])            starts.push(rootPos[0]);
  if (firstInv[0])           starts.push(firstInv[0]);
  if (secondInv[0])          starts.push(secondInv[0]);
  if (rootPos.length > 1)    starts.push(rootPos[1]);
  else if (starts.length > 0) starts.push(starts[0]);

  return starts.length > 0 ? starts : [all[0]];
}

// ---------------------------------------------------------------------------
// Exercise builder
// ---------------------------------------------------------------------------

/**
 * Build one exercise variant.
 *
 * Each measure has 7 notes:
 *   Beat 0 — simultaneous chord group (4 notes: LH bass root + RH bottom/middle/top)
 *   Beats 1–3 — RH broken arpeggio (sequential single notes)
 *
 * The chord group on beat 0 is detected by the engine via chordGroupOf(), which
 * groups all notes sharing the same (measure, beat). No explicit mode flag needed.
 */
function buildExercise(
  progression: ChordDef[],
  startVoicing: Voicing,
  keyName: string,
  progressionName: string,
  progressionLabel: string,
): Exercise {
  const notes: ExerciseNote[] = [];
  let prevVoicing = startVoicing;
  const allBassRoots = progression.map(c => c.bassRoot);

  for (let m = 0; m < progression.length; m++) {
    const chord   = progression[m];
    const voicing = m === 0 ? startVoicing : bestVoicing(chord, prevVoicing);
    prevVoicing   = voicing;

    const [f1, f2, f5] = rhFingering(voicing);
    const lhFinger      = lhFingering(chord.bassRoot, allBassRoots);

    // ─ Beat 0: simultaneous chord group (LH + RH block chord) ─
    // All 4 notes share the same (measure, beat) so chordGroupOf() groups them.
    // LH root is a whole note (sustained through the measure).
    notes.push({
      pitch: chord.bassRoot, duration: "w", staff: "bass",
      finger: lhFinger, measure: m, beat: 0,
    });
    notes.push({
      pitch: voicing[0], duration: "q", staff: "treble",
      finger: f1, measure: m, beat: 0,
      romanNumeral: chord.roman, chordSymbol: chord.symbol,
    });
    notes.push({
      pitch: voicing[1], duration: "q", staff: "treble",
      finger: f2, measure: m, beat: 0,
    });
    notes.push({
      pitch: voicing[2], duration: "q", staff: "treble",
      finger: f5, measure: m, beat: 0,
    });

    // ─ Beats 1–3: RH broken arpeggio (sequential) ─
    notes.push({ pitch: voicing[0], duration: "q", staff: "treble", finger: f1, measure: m, beat: 1 });
    notes.push({ pitch: voicing[1], duration: "q", staff: "treble", finger: f2, measure: m, beat: 2 });
    notes.push({ pitch: voicing[2], duration: "q", staff: "treble", finger: f5, measure: m, beat: 3 });
  }

  return { notes, key: keyName, beatsPerMeasure: 4, progressionName, progressionLabel };
}

// ---------------------------------------------------------------------------
// Bass line exercise builder
// ---------------------------------------------------------------------------

/**
 * Build a bass-line-only exercise for the given chord progression.
 *
 * Each measure contains 8 sequential bass-staff eighth notes (beats 0–7).
 * The exercise also includes `referenceNotes` — the voice-led treble block
 * chord for each measure — which are displayed in grey but never validated.
 */
function buildBassLineExercise(
  progression: ChordDef[],
  startVoicing: Voicing,
  keyName: string,
  progressionName: string,
  progressionLabel: string,
  progressionId: string,
): Exercise {
  const pattern = BASS_LINE_PATTERNS[progressionId] ?? BASS_LINE_PATTERNS["50s"];
  const notes: ExerciseNote[]          = [];
  const referenceNotes: ExerciseNote[] = [];

  let prevVoicing = startVoicing;

  for (let m = 0; m < progression.length; m++) {
    const chord   = progression[m];
    const voicing = m === 0 ? startVoicing : bestVoicing(chord, prevVoicing);
    prevVoicing   = voicing;

    const [f1, f2, f5] = rhFingering(voicing);

    // Reference treble block chord (display only, never validated).
    // First note carries the chord symbol for the score overlay.
    referenceNotes.push({
      pitch: voicing[0], duration: "q", staff: "treble",
      finger: f1, measure: m, beat: 0,
      romanNumeral: chord.roman, chordSymbol: chord.symbol,
    });
    referenceNotes.push({ pitch: voicing[1], duration: "q", staff: "treble", finger: f2, measure: m, beat: 0 });
    referenceNotes.push({ pitch: voicing[2], duration: "q", staff: "treble", finger: f5, measure: m, beat: 0 });

    // 8 bass eighth notes (beats 0–7 in this measure).
    for (let i = 0; i < 8; i++) {
      notes.push({
        pitch:    computeBassLineNote(chord.bassRoot, pattern[i]),
        duration: "8",
        staff:    "bass",
        finger:   0,   // no finger annotation for moving bass lines
        measure:  m,
        beat:     i,   // 0–7 encodes eighth-note position within the measure
      });
    }
  }

  return {
    notes,
    referenceNotes,
    bassMode: true,
    key: keyName,
    beatsPerMeasure: 4,
    progressionName,
    progressionLabel,
  };
}

// ---------------------------------------------------------------------------
// Combined (both-hands) exercise builder
// ---------------------------------------------------------------------------

/**
 * Build a combined exercise: LH bass line + RH chord/arpeggio played together.
 *
 * Uses fractional beats so the existing chord-group detection (groups by
 * measure+beat) naturally handles the interleaving:
 *
 *   beat 0.0 — 4-note chord group: LH eighth + RH block chord (3 notes)
 *   beat 0.5 — sequential: LH eighth only
 *   beat 1.0 — 2-note chord group: LH eighth + RH arpeggio bottom
 *   beat 1.5 — sequential: LH eighth only
 *   beat 2.0 — 2-note chord group: LH eighth + RH arpeggio middle
 *   beat 2.5 — sequential: LH eighth only
 *   beat 3.0 — 2-note chord group: LH eighth + RH arpeggio top
 *   beat 3.5 — sequential: LH eighth only
 *
 * 14 notes per measure (56 total).  No referenceNotes needed — the treble
 * chord/arpeggio is validated directly.
 */
function buildCombinedExercise(
  progression: ChordDef[],
  startVoicing: Voicing,
  keyName: string,
  progressionName: string,
  progressionLabel: string,
  progressionId: string,
): Exercise {
  const pattern     = BASS_LINE_PATTERNS[progressionId] ?? BASS_LINE_PATTERNS["50s"];
  const notes: ExerciseNote[] = [];
  let prevVoicing   = startVoicing;

  for (let m = 0; m < progression.length; m++) {
    const chord   = progression[m];
    const voicing = m === 0 ? startVoicing : bestVoicing(chord, prevVoicing);
    prevVoicing   = voicing;

    const [f1, f2, f5] = rhFingering(voicing);

    // ─ Beat 0: 4-note chord group (LH + RH block chord) ─────────────────
    notes.push({ pitch: computeCombinedBassNote(chord.bassRoot, pattern[0]), duration: "8", staff: "bass",   finger: 0,       measure: m, beat: 0 });
    notes.push({ pitch: voicing[0], duration: "q", staff: "treble", finger: f1, measure: m, beat: 0, romanNumeral: chord.roman, chordSymbol: chord.symbol });
    notes.push({ pitch: voicing[1], duration: "q", staff: "treble", finger: f2, measure: m, beat: 0 });
    notes.push({ pitch: voicing[2], duration: "q", staff: "treble", finger: f5, measure: m, beat: 0 });

    // ─ Beat 0.5: sequential LH only ──────────────────────────────────────
    notes.push({ pitch: computeCombinedBassNote(chord.bassRoot, pattern[1]), duration: "8", staff: "bass", finger: 0, measure: m, beat: 0.5 });

    // ─ Beat 1: 2-note chord group (LH + RH arpeggio bottom) ──────────────
    notes.push({ pitch: computeCombinedBassNote(chord.bassRoot, pattern[2]), duration: "8", staff: "bass",   finger: 0,  measure: m, beat: 1 });
    notes.push({ pitch: voicing[0], duration: "q", staff: "treble", finger: f1, measure: m, beat: 1 });

    // ─ Beat 1.5: sequential LH only ──────────────────────────────────────
    notes.push({ pitch: computeCombinedBassNote(chord.bassRoot, pattern[3]), duration: "8", staff: "bass", finger: 0, measure: m, beat: 1.5 });

    // ─ Beat 2: 2-note chord group (LH + RH arpeggio middle) ──────────────
    notes.push({ pitch: computeCombinedBassNote(chord.bassRoot, pattern[4]), duration: "8", staff: "bass",   finger: 0,  measure: m, beat: 2 });
    notes.push({ pitch: voicing[1], duration: "q", staff: "treble", finger: f2, measure: m, beat: 2 });

    // ─ Beat 2.5: sequential LH only ──────────────────────────────────────
    notes.push({ pitch: computeCombinedBassNote(chord.bassRoot, pattern[5]), duration: "8", staff: "bass", finger: 0, measure: m, beat: 2.5 });

    // ─ Beat 3: 2-note chord group (LH + RH arpeggio top) ─────────────────
    notes.push({ pitch: computeCombinedBassNote(chord.bassRoot, pattern[6]), duration: "8", staff: "bass",   finger: 0,  measure: m, beat: 3 });
    notes.push({ pitch: voicing[2], duration: "q", staff: "treble", finger: f5, measure: m, beat: 3 });

    // ─ Beat 3.5: sequential LH only ──────────────────────────────────────
    notes.push({ pitch: computeCombinedBassNote(chord.bassRoot, pattern[7]), duration: "8", staff: "bass", finger: 0, measure: m, beat: 3.5 });
  }

  return {
    notes,
    combinedMode: true,
    key: keyName,
    beatsPerMeasure: 4,
    progressionName,
    progressionLabel,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getExercise(
  index: number,
  keyId: string = "C",
  progressionId: string = "50s",
): Exercise {
  const key         = KEYS.find(k => k.id === keyId)                ?? KEYS[0];
  const template    = PROGRESSIONS.find(p => p.id === progressionId) ?? PROGRESSIONS[1];
  const progression = buildProgression(key, template);
  const starts      = getStartingVoicings(progression[0]);
  const start       = starts[index % starts.length];
  return buildExercise(
    progression, start,
    `${key.id} major`,
    template.name,
    template.label,
  );
}

/**
 * Build a bass-line exercise for the given key and progression.
 * Same variant system as getExercise (index 0–3).
 */
export function getBassLineExercise(
  index: number,
  keyId: string = "C",
  progressionId: string = "50s",
): Exercise {
  const key      = KEYS.find(k => k.id === keyId)                ?? KEYS[0];
  const template = PROGRESSIONS.find(p => p.id === progressionId) ?? PROGRESSIONS[1];
  const prog     = buildProgression(key, template);
  const starts   = getStartingVoicings(prog[0]);
  const start    = starts[index % starts.length];
  return buildBassLineExercise(
    prog, start,
    `${key.id} major`,
    template.name,
    template.label,
    template.id,
  );
}

/**
 * Build a combined (both-hands) exercise for the given key and progression.
 * Same variant system as getExercise (index 0–3).
 */
export function getCombinedExercise(
  index: number,
  keyId: string = "C",
  progressionId: string = "50s",
): Exercise {
  const key      = KEYS.find(k => k.id === keyId)                ?? KEYS[0];
  const template = PROGRESSIONS.find(p => p.id === progressionId) ?? PROGRESSIONS[1];
  const prog     = buildProgression(key, template);
  const starts   = getStartingVoicings(prog[0]);
  const start    = starts[index % starts.length];
  return buildCombinedExercise(
    prog, start,
    `${key.id} major`,
    template.name,
    template.label,
    template.id,
  );
}

