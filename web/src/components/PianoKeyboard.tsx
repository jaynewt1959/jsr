/**
 * PianoKeyboard.tsx — Jay's Sight Reading
 *
 * A horizontal piano keyboard strip displayed below the score.
 * It is REACTIVE ONLY — no persistent target-note highlight is shown,
 * so the user must read the score to identify which note to play.
 *
 * Feedback on each key press:
 *   correct LH note → brief blue flash
 *   correct RH note → brief orange flash
 *   wrong note       → brief red flash
 *   (flash duration controlled by the parent via the flashKey prop)
 *
 * When `tappable` is true (no physical MIDI keyboard active), the keys
 * also act as touch/click input, firing onKey(midi, isOn) callbacks.
 *
 * Ported and adapted from jsp-ipad/KeyboardStrip.tsx.
 */

import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { noteName } from "../util/noteName";

export type FlashColor = "left" | "right" | "wrong";

export interface FlashKey {
  midi: number;
  color: FlashColor;
}

interface Props {
  lowestMidi: number;
  highestMidi: number;
  /** Momentary flash feedback set by the parent; null = no flash. */
  flashKey: FlashKey | null;
  /**
   * Wrong notes played since the last correct note or reset.
   * These keys are colored persistently red until cleared by the parent.
   * flashKey takes priority if it targets the same key.
   */
  wrongKeys: ReadonlySet<number>;
  /** True when on-screen keys accept taps as note input. */
  tappable: boolean;
  /** Fired on tap press (isOn=true) and release (isOn=false). */
  onKey: (midi: number, isOn: boolean) => void;
}

const BLACK_OFFSETS = new Set<number>([1, 3, 6, 8, 10]);
const isBlack = (midi: number) => BLACK_OFFSETS.has(((midi % 12) + 12) % 12);

export function PianoKeyboard({
  lowestMidi,
  highestMidi,
  flashKey,
  wrongKeys,
  tappable,
  onKey,
}: Props) {
  const whiteKeys: number[] = [];
  for (let m = lowestMidi; m <= highestMidi; m++) {
    if (!isBlack(m)) whiteKeys.push(m);
  }

  // Tracks which keys are currently held by a pointer tap.
  const [tapPressed, setTapPressed] = useState<ReadonlySet<number>>(new Set());

  const tapPress = (midi: number) => {
    if (!tappable || tapPressed.has(midi)) return;
    setTapPressed(prev => new Set([...prev, midi]));
    onKey(midi, true);
  };

  const tapRelease = (midi: number) => {
    if (!tapPressed.has(midi)) return;
    setTapPressed(prev => {
      const next = new Set(prev);
      next.delete(midi);
      return next;
    });
    onKey(midi, false);
  };

  const tapHandlers = (midi: number) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      e.preventDefault();
      tapPress(midi);
    },
    onPointerUp:     () => tapRelease(midi),
    onPointerLeave:  () => tapRelease(midi),
    onPointerCancel: () => tapRelease(midi),
  });

  const flashMidi  = flashKey?.midi;
  const flashColor = flashKey?.color ?? null;

  // Resolve the color class for a given midi note.
  // flashKey (correct note) takes priority over persistent wrong red.
  const whiteColor = (midi: number): string => {
    if (midi === flashMidi) return ` piano-keyboard__white--flash-${flashColor}`;
    if (wrongKeys.has(midi)) return " piano-keyboard__white--flash-wrong";
    return "";
  };
  const blackColor = (midi: number): string => {
    if (midi === flashMidi) return ` piano-keyboard__black--flash-${flashColor}`;
    if (wrongKeys.has(midi)) return " piano-keyboard__black--flash-wrong";
    return "";
  };

  return (
    <div className={`piano-keyboard${tappable ? " piano-keyboard--tappable" : ""}`}>
      {/* White keys */}
      <div className="piano-keyboard__whites">
        {whiteKeys.map((midi) => {
          const isC       = midi % 12 === 0;
          const isPressed = tapPressed.has(midi);
          const colorCls  = whiteColor(midi);
          const pressCls  = isPressed ? " piano-keyboard__white--pressed" : "";
          return (
            <div
              key={midi}
              className={`piano-keyboard__white${colorCls}${pressCls}`}
              title={noteName(midi)}
              {...tapHandlers(midi)}
            >
              {isC && (
                <span className="piano-keyboard__c-label">{noteName(midi)}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Black keys — absolutely positioned over the white row */}
      <div className="piano-keyboard__blacks">
        {whiteKeys.map((midi, idx) => {
          const blackMidi = midi + 1;
          if (!isBlack(blackMidi) || idx === whiteKeys.length - 1) return null;
          const isPressed = tapPressed.has(blackMidi);
          const colorCls  = blackColor(blackMidi);
          const pressCls  = isPressed ? " piano-keyboard__black--pressed" : "";
          const leftPct   = ((idx + 1) / whiteKeys.length) * 100;
          return (
            <div
              key={blackMidi}
              className={`piano-keyboard__black${colorCls}${pressCls}`}
              style={{ left: `${leftPct}%` }}
              title={noteName(blackMidi)}
              {...tapHandlers(blackMidi)}
            />
          );
        })}
      </div>
    </div>
  );
}
