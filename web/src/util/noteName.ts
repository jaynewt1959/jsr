// Convert a MIDI note number (0–127) into a human-readable name.
// Octave: scientific convention, MIDI 60 = C4.

const SHARP_NAMES = [
  "C", "C\u266F", "D", "D\u266F", "E", "F",
  "F\u266F", "G", "G\u266F", "A", "A\u266F", "B",
] as const;

export function noteName(midi: number): string {
  const pitch  = SHARP_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${pitch}${octave}`;
}
