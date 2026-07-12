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

// Notes on a light (cream) background — dark ink + coloured highlights.
const STATUS_COLOUR: Record<NoteStatus, string> = {
  pending: "#1a1a2a",  // near-black ink
  current: "#1060c8",  // clear blue
  correct: "#aaaaaa",  // faded grey (already played)
  wrong:   "#cc1f1f",  // red
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

    // Force a white background on the SVG element directly.
    // CSS background on the containing div is unreliable because VexFlow's
    // SVG is transparent and the WKWebView background shows through.
    const svgEl = el.querySelector("svg");
    if (svgEl) {
      const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      bgRect.setAttribute("width", "100%");
      bgRect.setAttribute("height", "100%");
      bgRect.setAttribute("fill", "#ffffff");
      svgEl.insertBefore(bgRect, svgEl.firstChild);
    }

    const ctx = renderer.getContext();
    ctx.setFont("Arial", 11);
    ctx.setFillStyle("#1a1a2a");
    ctx.setStrokeStyle("#1a1a2a");

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

      // Chord symbol above the treble stave (first note of the measure).
      const chordNote = (byMeasure[m] ?? []).find(
        (n) => n.staff === "treble" && n.beat === 0 && n.chordSymbol
      );
      if (chordNote?.chordSymbol) {
        const svg = el.querySelector("svg");
        if (svg) {
          const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
          txt.setAttribute("x", String(x + 10));
          txt.setAttribute("y", String(trebleY - 4));
          txt.setAttribute("fill", "#2a4ea8");
          txt.setAttribute("font-size", "11");
          txt.setAttribute("font-family", "Arial");
          txt.setAttribute("font-weight", "bold");
          txt.textContent = `${chordNote.chordSymbol}  (${chordNote.romanNumeral})`;
          svg.appendChild(txt);
        }
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

        // Fingering annotation (shown above treble notes, below bass notes).
        // Annotation extends Modifier in VexFlow 4; cast via any for TS.
        const fingerAnn = new Annotation(String(en.finger))
          .setFont("Arial", 10)
          .setVerticalJustification(
            en.staff === "treble"
              ? Annotation.VerticalJustify.TOP
              : Annotation.VerticalJustify.BOTTOM
          );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vn.addModifier(fingerAnn as any, 0);

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
        background: "#ffffff",
        borderRadius: 10,
        padding: "16px 10px 10px",
        overflowX: "auto",
        width: "100%",
        border: "2px solid #d0d8f8",
        boxShadow: "0 4px 24px rgba(30,40,120,0.22)",
      }}
    />
  );
}
