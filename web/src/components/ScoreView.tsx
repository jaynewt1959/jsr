/**
 * ScoreView.tsx — Jay's Sight Reading
 *
 * Renders a grand staff (treble + bass) exercise using VexFlow 4.x.
 * Shows fingering numbers above/below notes and chord symbols with
 * Roman numerals above the treble staff.
 *
 * Note colouring:
 *   current  → blue (#3b9dff)
 *   correct  → grey (#777)
 *   wrong    → red (#e03c3c)
 *   pending  → white (#eee)
 */

import { useEffect, useRef } from "react";
import {
  Renderer,
  Stave,
  StaveNote,
  Voice,
  Formatter,
  Annotation,
  Modifier,
  Accidental,
} from "vexflow";
import type { ExerciseNote, Exercise } from "../engine/voiceLeading";
import type { NoteStatus } from "../engine/exerciseEngine";

// ---------------------------------------------------------------------------
// MIDI → VexFlow note name conversion
// ---------------------------------------------------------------------------

const NOTE_NAMES = ["c", "d", "e", "f", "g", "a", "b"];
const SEMITONES  = [0, 2, 4, 5, 7, 9, 11];

/** Convert MIDI pitch to { keys: string[], accidental?: string }.
 *  Only natural notes for C major Phase 1. */
function midiToVex(midi: number): { keys: string[]; accidental?: string } {
  const octave = Math.floor(midi / 12) - 1;
  const pc = midi % 12;
  const idx = SEMITONES.indexOf(pc);

  if (idx >= 0) {
    return { keys: [`${NOTE_NAMES[idx]}/${octave}`] };
  }

  // Sharp: find the note a semitone below and add a #.
  const lowerIdx = SEMITONES.indexOf(pc - 1);
  if (lowerIdx >= 0) {
    return {
      keys: [`${NOTE_NAMES[lowerIdx]}/${octave}`],
      accidental: "#",
    };
  }

  // Fallback: middle C
  return { keys: ["c/4"] };
}

// ---------------------------------------------------------------------------
// Colour map
// ---------------------------------------------------------------------------

const STATUS_COLOUR: Record<NoteStatus, string> = {
  pending:  "#eeeeee",
  current:  "#3b9dff",
  correct:  "#666666",
  wrong:    "#e03c3c",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ScoreViewProps {
  exercise: Exercise;
  noteStatuses: NoteStatus[];
}

export function ScoreView({ exercise, noteStatuses }: ScoreViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.innerHTML = "";

    const notes = exercise.notes;

    // Group notes by measure.
    const measureCount = Math.max(0, ...notes.map((n) => n.measure)) + 1;
    const byMeasure: ExerciseNote[][] = Array.from({ length: measureCount }, () => []);
    notes.forEach((n) => byMeasure[n.measure].push(n));

    // Canvas dimensions.
    const staveWidth  = 220;
    const staveMargin = 60;
    const totalWidth  = staveMargin + measureCount * staveWidth + 30;
    const height      = 260;

    const renderer = new Renderer(el, Renderer.Backends.SVG);
    renderer.resize(totalWidth, height);
    const ctx = renderer.getContext();
    ctx.setFont("Arial", 11);

    const trebleY = 20;
    const bassY   = 140;

    for (let m = 0; m < measureCount; m++) {
      const x = staveMargin + m * staveWidth;
      const w = staveWidth;

      // Treble stave
      const trebleStave = new Stave(x, trebleY, w);
      if (m === 0) {
        trebleStave.addClef("treble").addTimeSignature("4/4");
      }
      trebleStave.setContext(ctx).draw();

      // Bass stave
      const bassStave = new Stave(x, bassY, w);
      if (m === 0) {
        bassStave.addClef("bass").addTimeSignature("4/4");
      }
      bassStave.setContext(ctx).draw();

      // Brace + connecting bar on first measure.
      if (m === 0) {
        ctx.save();
        ctx.setStrokeStyle("#fff");
        ctx.setFillStyle("#fff");
        ctx.beginPath();
        ctx.moveTo(x, trebleY + 1);
        ctx.lineTo(x, bassY + 79);
        ctx.stroke();
        ctx.restore();
      }

      // Build VexFlow notes for this measure.
      const measureNotes = byMeasure[m] ?? [];
      const trebleVexNotes: StaveNote[] = [];
      const bassVexNotes:   StaveNote[] = [];

      for (const en of measureNotes) {
        // Find the global index to look up the status.
        const globalIdx = notes.indexOf(en);
        const status: NoteStatus = noteStatuses[globalIdx] ?? "pending";
        const colour = STATUS_COLOUR[status];

        const { keys, accidental } = midiToVex(en.pitch);
        const vn = new StaveNote({
          keys,
          duration: en.duration,
          clef: en.staff === "treble" ? "treble" : "bass",
        });

        if (accidental) {
          vn.addModifier(new Accidental(accidental), 0);
        }

        // Fingering annotation.
        const fingerAnn = new Annotation(String(en.finger))
          .setFont("Arial", 10)
          .setVerticalJustification(
            en.staff === "treble"
              ? Annotation.VerticalJustify.TOP
              : Annotation.VerticalJustify.BOTTOM
          );
        vn.addModifier(fingerAnn as unknown as Modifier, 0);

        // Chord symbol + Roman numeral (beat 0 only, treble).
        if (en.staff === "treble" && en.beat === 0 && en.chordSymbol) {
          const chordAnn = new Annotation(`${en.chordSymbol} (${en.romanNumeral})`)
            .setFont("Arial", 10, "bold")
            .setVerticalJustification(Annotation.VerticalJustify.TOP);
          // Attach above the stave — positioned via y-offset below.
          vn.addModifier(chordAnn as unknown as Modifier, 0);
        }

        // Apply colour.
        vn.setStyle({ fillStyle: colour, strokeStyle: colour });

        if (en.staff === "treble") {
          trebleVexNotes.push(vn);
        } else {
          bassVexNotes.push(vn);
        }
      }

      // Pad bass voice to 4 beats if it only has a whole-note.
      // VexFlow needs full-measure voices.
      const trebleVoice = new Voice({ numBeats: 4, beatValue: 4 });
      trebleVoice.setMode(Voice.Mode.SOFT);
      if (trebleVexNotes.length) trebleVoice.addTickables(trebleVexNotes);

      const bassVoice = new Voice({ numBeats: 4, beatValue: 4 });
      bassVoice.setMode(Voice.Mode.SOFT);
      if (bassVexNotes.length) bassVoice.addTickables(bassVexNotes);

      const formatter = new Formatter();
      const voices = [];
      if (trebleVexNotes.length) voices.push(trebleVoice);
      if (bassVexNotes.length)   voices.push(bassVoice);

      if (voices.length) {
        formatter.joinVoices(voices).format(voices, w - 20);
        if (trebleVexNotes.length) trebleVoice.draw(ctx, trebleStave);
        if (bassVexNotes.length)   bassVoice.draw(ctx, bassStave);
      }
    }
  }, [exercise, noteStatuses]);

  return (
    <div
      ref={containerRef}
      style={{
        background: "#1a1a2e",
        borderRadius: 12,
        padding: "8px 4px",
        overflowX: "auto",
        width: "100%",
      }}
    />
  );
}
