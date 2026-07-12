/**
 * fingering.ts — Jay's Sight Reading
 *
 * Assigns finger numbers (1–5) to individual notes based on standard
 * piano scale fingering tables.
 *
 * Phase 1: C major only, both hands.
 *
 * Standard C major fingering:
 *   RH ascending: C(1) D(2) E(3) F(1) G(2) A(3) B(4) C(5)
 *   LH ascending: C(5) D(4) E(3) F(2) G(1) A(3) B(2) C(1)
 *
 * The finger for any pitch is looked up by pitch class (0=C, 2=D, …)
 * with a fallback to finger 3 (middle finger) for accidentals and
 * out-of-range notes.
 *
 * In Phase 2 this module will load fingering tables for all 48 scales
 * from the JSP scale library.
 */

/** Maps pitch class → finger number for C major, right hand. */
const C_MAJOR_RH: Record<number, number> = {
  0:  1, // C
  2:  2, // D
  4:  3, // E
  5:  1, // F  (thumb crosses after E)
  7:  2, // G
  9:  3, // A
  11: 4, // B
};

/** Maps pitch class → finger number for C major, left hand. */
const C_MAJOR_LH: Record<number, number> = {
  0:  5, // C
  2:  4, // D
  4:  3, // E
  5:  2, // F
  7:  1, // G  (thumb here; then cross under after G going up)
  9:  3, // A  (after the thumb cross)
  11: 2, // B
};

/**
 * Look up the recommended finger for a note in C major.
 *
 * @param pitch   MIDI note number
 * @param hand    "right" | "left"
 * @param rootPitch  Root of the current chord (used for context in Phase 2;
 *                   ignored in Phase 1 but kept for API stability)
 * @returns Finger 1–5.
 */
export function assignFingering(
  pitch: number,
  hand: "right" | "left",
  _rootPitch: number
): number {
  const pc = ((pitch % 12) + 12) % 12; // pitch class 0–11
  const table = hand === "right" ? C_MAJOR_RH : C_MAJOR_LH;
  return table[pc] ?? 3; // default to middle finger for unlisted pitch classes
}

/**
 * Returns a human-readable finger label, e.g. "3" or "1" (thumb).
 * Exposed for test purposes.
 */
export function fingerLabel(finger: number): string {
  return String(finger);
}
