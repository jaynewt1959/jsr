/**
 * ScoreView.tsx — Jay's Sight Reading
 *
 * Renders a grand staff exercise using VexFlow 5 Factory + EasyScore API.
 * This replaces the broken low-level VexFlow 4 renderer.  The Factory /
 * EasyScore path correctly handles a quarter rest on beat 0 followed by
 * three quarter notes in a 4/4 grand staff — which the old low-level API
 * could not render reliably.
 *
 * Layout (one System per measure, left-to-right):
 *   Treble: quarter rest (beat 0) + three quarter notes (beats 1–3)
 *   Bass:   whole note (chord root, beat 0)
 *
 * Note colouring (applied via VexFlow setStyle before voice formatting):
 *   pending → near-black  (#1a1a2a)
 *   current → blue        (#1060c8)
 *   correct → grey        (#aaaaaa)
 *   wrong   → red         (#cc1f1f)
 */

import { useEffect, useRef } from "react";
import { Factory, Annotation, Barline } from "vexflow";
import type { ExerciseNote, Exercise } from "../engine/voiceLeading";
import type { NoteStatus } from "../engine/exerciseEngine";

// ── colours ──────────────────────────────────────────────────────────────
const STATUS_COLOUR: Record<NoteStatus, string> = {
  pending: "#1a1a2a",
  current: "#1060c8",
  correct: "#aaaaaa",
  wrong:   "#cc1f1f",
};

// ── MIDI → EasyScore ──────────────────────────────────────────────────────
const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

function midiToEasyScore(midi: number, duration: string): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12]}${octave}/${duration}`;
}

// ── layout constants (aligned with vexflow-sandbox/GrandStaff.js) ─────────
//
// NATURAL_NOTE_START_BASE: empirical offset from stave left to VexFlow's
//   natural first-note position for C major (no key signature).
//   Derived from sandbox experiments: 115 (old base overhead) – 25 (old pad) = 90.
const NATURAL_NOTE_START_BASE = 90;
const SMALL_PAD    = 8;   // breathing room between time-sig and first note (px)
const RIGHT_MARGIN = 20;  // right canvas margin (px)
const START_X      = 40;  // left margin for the grand-staff brace

// First-measure header width: clef + time-sig + pad.
// C major has no key signature so no extra accidental width.
const MEASURE1_HEADER = NATURAL_NOTE_START_BASE + SMALL_PAD;  // 98 px

// Fixed canvas size — fits 4 measures on an iPad in landscape.
const CANVAS_WIDTH  = 970;
const CANVAS_HEIGHT = 280;

// ── component ─────────────────────────────────────────────────────────────
interface ScoreViewProps {
  exercise: Exercise;
  noteStatuses: NoteStatus[];
}

export function ScoreView({ exercise, noteStatuses }: ScoreViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Stable element ID — Factory needs document.getElementById.
  const elementId = useRef(`jsrscore-${Math.random().toString(36).slice(2, 9)}`).current;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    el.id        = elementId;
    el.innerHTML = "";

    const allNotes     = exercise.notes;
    const measureCount = Math.max(0, ...allNotes.map((n) => n.measure)) + 1;

    const byMeasure: ExerciseNote[][] = Array.from({ length: measureCount }, () => []);
    allNotes.forEach((n) => byMeasure[n.measure].push(n));

    // Note area per measure derived from fixed canvas width.
    const noteAreaWidth =
      (CANVAS_WIDTH - START_X - MEASURE1_HEADER - RIGHT_MARGIN) / measureCount;

    // ── VexFlow Factory + EasyScore ────────────────────────────────────────
    const factory = new Factory({
      renderer: { elementId, width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
    });
    const score = factory.EasyScore();

    const staveXPos: number[] = [];  // stave left-edge x per measure
    let x = START_X;

    for (let m = 0; m < measureCount; m++) {
      const isFirst = m === 0;
      const isFinal = m === measureCount - 1;
      const width   = isFirst ? MEASURE1_HEADER + noteAreaWidth : noteAreaWidth;
      staveXPos.push(x);

      const sys    = factory.System({ x, y: 40, width });
      const mNotes = byMeasure[m] ?? [];
      const tSrc   = mNotes.filter((n) => n.staff === "treble");
      const bSrc   = mNotes.filter((n) => n.staff === "bass");

      // ── treble: quarter rest + arpeggio ─────────────────────────────────
      // Beat 0 is always a visual rest (the engine sequences from the bass
      // note, so beat 0 treble is not an ExerciseNote).
      const trebleStr = [
        "B4/q/r",
        ...tSrc.map((en) => midiToEasyScore(en.pitch, en.duration)),
      ].join(", ");

      const tVF = score.notes(trebleStr, { stem: "up" });

      // Rest: always ink colour.
      tVF[0].setStyle({ fillStyle: STATUS_COLOUR.pending, strokeStyle: STATUS_COLOUR.pending });

      // Exercise notes: colour + finger annotation.
      tSrc.forEach((en, j) => {
        const colour = STATUS_COLOUR[noteStatuses[allNotes.indexOf(en)] ?? "pending"];
        tVF[j + 1].setStyle({ fillStyle: colour, strokeStyle: colour });
        tVF[j + 1].addModifier(
          new Annotation(String(en.finger))
            .setFont("Arial", 9)
            .setVerticalJustification(Annotation.VerticalJustify.TOP),
          0,
        );
      });

      // ── bass: whole note ─────────────────────────────────────────────────
      const bassStr = bSrc.map((en) => midiToEasyScore(en.pitch, en.duration)).join(", ");
      const bVF     = score.notes(bassStr, { clef: "bass", stem: "down" });

      bSrc.forEach((en, j) => {
        const colour = STATUS_COLOUR[noteStatuses[allNotes.indexOf(en)] ?? "pending"];
        bVF[j].setStyle({ fillStyle: colour, strokeStyle: colour });
        bVF[j].addModifier(
          new Annotation(String(en.finger))
            .setFont("Arial", 9)
            .setVerticalJustification(Annotation.VerticalJustify.BOTTOM),
          0,
        );
      });

      // ── add staves to system ─────────────────────────────────────────────
      const treble = sys.addStave({ voices: [score.voice(tVF, { time: "4/4" })] });
      const bass   = sys.addStave({ voices: [score.voice(bVF, { time: "4/4" })] });

      if (isFirst) {
        treble.addClef("treble").addTimeSignature("4/4");
        bass.addClef("bass").addTimeSignature("4/4");
        treble.setNoteStartX(treble.getNoteStartX() + SMALL_PAD);
        bass.setNoteStartX(bass.getNoteStartX() + SMALL_PAD);
        sys.addConnector("brace");
        sys.addConnector("singleLeft");
      }

      if (isFinal) {
        treble.setEndBarType(Barline.type.END);
        bass.setEndBarType(Barline.type.END);
        sys.addConnector("boldDoubleRight");
      } else {
        sys.addConnector("singleRight");
      }

      x += width;
    }

    factory.draw();

    // ── SVG post-processing ───────────────────────────────────────────────
    const svg = el.querySelector("svg");
    if (!svg) return;

    // White background — WKWebView shows through a transparent SVG.
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("width",  "100%");
    bg.setAttribute("height", "100%");
    bg.setAttribute("fill",   "#ffffff");
    svg.insertBefore(bg, svg.firstChild);

    // Chord symbols above the treble stave (e.g. "C  (I)").
    byMeasure.forEach((mNotes, m) => {
      const cn = mNotes.find((n) => n.staff === "treble" && n.chordSymbol);
      if (!cn?.chordSymbol) return;

      // On measure 0 place symbol after the clef/time-sig; elsewhere at stave left.
      const cx = m === 0 ? staveXPos[0] + MEASURE1_HEADER + 8 : staveXPos[m] + 8;

      const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
      txt.setAttribute("x",           String(cx));
      txt.setAttribute("y",           "30");
      txt.setAttribute("fill",        "#2a4ea8");
      txt.setAttribute("font-size",   "11");
      txt.setAttribute("font-family", "Arial");
      txt.setAttribute("font-weight", "bold");
      txt.textContent = `${cn.chordSymbol}  (${cn.romanNumeral})`;
      svg.appendChild(txt);
    });

  }, [exercise, noteStatuses, elementId]);

  return (
    <div
      ref={containerRef}
      style={{
        background:   "#ffffff",
        borderRadius: 10,
        padding:      "16px 10px 10px",
        overflowX:    "auto",
        width:        "100%",
        border:       "2px solid #d0d8f8",
        boxShadow:    "0 4px 24px rgba(30,40,120,0.22)",
      }}
    />
  );
}
