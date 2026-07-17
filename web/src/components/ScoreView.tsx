/**
 * ScoreView.tsx — Jay's Sight Reading
 *
 * Renders a grand staff exercise using VexFlow 5 Factory + EasyScore API.
 *
 * Layout (one System per measure, left-to-right):
 *   Treble beat 0: block chord (3 notes in parentheses)
 *   Treble beats 1–3: broken arpeggio (individual quarter notes)
 *   Bass beat 0: chord root quarter note; beats 1–3: rests
 *
 * Note colouring:
 *   pending → near-black (#1a1a2a)
 *   current → blue (#1060c8) for bass/arpeggio; orange (#c87020) for treble chord
 *   correct → grey (#aaaaaa)
 *   wrong   → red  (#cc1f1f)
 */

import { useEffect, useRef } from "react";
import { Factory, Annotation, Barline } from "vexflow";
import { KEYS } from "../engine/voiceLeading";
import type { ExerciseNote, Exercise } from "../engine/voiceLeading";
import type { NoteStatus } from "../engine/exerciseEngine";
import { chordGroupOf } from "../engine/exerciseEngine";

// ── colours ──────────────────────────────────────────────────────────────
const STATUS_COLOUR: Record<NoteStatus, string> = {
  pending: "#1a1a2a",
  current: "#1060c8",
  correct: "#aaaaaa",
  wrong:   "#cc1f1f",
};

// Chord recognition mode uses hand-matched colours:
//   treble (RH) current → orange  (matches keyboard flash)
//   bass   (LH) current → blue    (unchanged)
const STATUS_COLOUR_TREBLE_CHORD: Record<NoteStatus, string> = {
  pending: "#1a1a2a",
  current: "#c87020",
  correct: "#aaaaaa",
  wrong:   "#cc1f1f",
};

// ── MIDI → EasyScore ──────────────────────────────────────────────────────
//
// We write only the diatonic letter name (no accidental) for each pitch class.
// The key signature tells VexFlow how to inflect every letter automatically,
// so no explicit sharps or flats ever appear on note heads.
const DIATONIC_LETTERS = ['C','D','E','F','G','A','B'];

// Starting letter index (into DIATONIC_LETTERS) for each key's root.
const ROOT_LETTER_IDX: Record<string, number> = {
  C:0, G:4, D:1, A:5, E:2, B:6, 'F#':3,
  Db:1, Ab:5, Eb:2, Bb:6, F:3,
};

const SCALE_INTERVALS = [0, 2, 4, 5, 7, 9, 11] as const;

/** Build a pitch-class → diatonic letter map for the given key id. */
function buildPcToLetter(keyId: string): Record<number, string> {
  const keyDef = KEYS.find(k => k.id === keyId) ?? KEYS[0];
  const rootIdx = ROOT_LETTER_IDX[keyId] ?? 0;
  const map: Record<number, string> = {};
  for (let k = 0; k < 7; k++) {
    const pc = (keyDef.pitchClass + SCALE_INTERVALS[k]) % 12;
    map[pc] = DIATONIC_LETTERS[(rootIdx + k) % 7];
  }
  return map;
}

function midiToEasyScore(midi: number, duration: string, pcToLetter: Record<number, string>): string {
  const octave = Math.floor(midi / 12) - 1;
  const letter = pcToLetter[midi % 12] ?? 'C';
  return `${letter}${octave}/${duration}`;
}

// ── layout constants (aligned with vexflow-sandbox/GrandStaff.js) ─────────
//
// NATURAL_NOTE_START_BASE: empirical offset from stave left to VexFlow's
//   natural first-note position for C major (no key signature).
//   Derived from sandbox experiments: 115 (old base overhead) – 25 (old pad) = 90.
const NATURAL_NOTE_START_BASE = 90;
const SMALL_PAD    = 8;   // breathing room between time-sig/key-sig and first note (px)
const RIGHT_MARGIN = 20;  // right canvas margin (px)
const START_X      = 40;  // left margin for the grand-staff brace
const ACCIDENTAL_W = 13;  // approx px per accidental in a VexFlow key signature

// Accidental count per key (used to widen the first-measure header).
const KEY_ACCIDENTALS: Record<string, number> = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6,
  F: 1, Bb: 2, Eb: 3, Ab: 4, Db: 5,
};


// Fixed canvas size.
// Sight-reading: 4 measures; chord recognition: 5 measures.
const CANVAS_WIDTH  = 970;
const CANVAS_HEIGHT = 280;

// ── SVG helpers ───────────────────────────────────────────────────────────

function addWhiteBg(svg: SVGElement) {
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width",  "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill",   "#ffffff");
  svg.insertBefore(bg, svg.firstChild);
}

function addSvgText(
  svg: SVGElement,
  x: number,
  y: number,
  text: string,
  opts: { fill?: string; fontSize?: string; fontWeight?: string } = {},
) {
  const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
  txt.setAttribute("x",           String(x));
  txt.setAttribute("y",           String(y));
  txt.setAttribute("fill",        opts.fill       ?? "#2a4ea8");
  txt.setAttribute("font-size",   opts.fontSize   ?? "11");
  txt.setAttribute("font-family", "Arial");
  txt.setAttribute("font-weight", opts.fontWeight ?? "bold");
  txt.textContent = text;
  svg.appendChild(txt);
}

// ── Sight-reading renderer ─────────────────────────────────────────────────

function renderSightReading(
  el: HTMLElement,
  elementId: string,
  exercise: Exercise,
  noteStatuses: NoteStatus[],
) {
  const keyId           = exercise.key.split(" ")[0];
  const pcToLetter      = buildPcToLetter(keyId);
  const MEASURE1_HEADER = NATURAL_NOTE_START_BASE + (KEY_ACCIDENTALS[keyId] ?? 0) * ACCIDENTAL_W + SMALL_PAD;

  const allNotes     = exercise.notes;
  const measureCount = Math.max(0, ...allNotes.map((n) => n.measure)) + 1;

  const byMeasure: ExerciseNote[][] = Array.from({ length: measureCount }, () => []);
  allNotes.forEach((n) => byMeasure[n.measure].push(n));

  const noteAreaWidth =
    (CANVAS_WIDTH - START_X - MEASURE1_HEADER - RIGHT_MARGIN) / measureCount;

  const factory = new Factory({
    renderer: { elementId, width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
  });
  const score = factory.EasyScore();

  const staveXPos: number[] = [];
  let x = START_X;

  for (let m = 0; m < measureCount; m++) {
    const isFirst = m === 0;
    const isFinal = m === measureCount - 1;
    const width   = isFirst ? MEASURE1_HEADER + noteAreaWidth : noteAreaWidth;
    staveXPos.push(x);

    const sys    = factory.System({ x, y: 40, width });
    const mNotes = byMeasure[m] ?? [];
    // Group notes by beat.
    const tByBeat = new Map<number, ExerciseNote[]>();
    const bByBeat = new Map<number, ExerciseNote>();
    for (const n of mNotes) {
      if (n.staff === "treble") {
        if (!tByBeat.has(n.beat)) tByBeat.set(n.beat, []);
        tByBeat.get(n.beat)!.push(n);
      } else {
        bByBeat.set(n.beat, n);
      }
    }

    // Treble voice: beat 0 = block chord, beats 1–3 = individual notes.
    const beat0Treble = tByBeat.get(0) ?? [];
    const trebleTokens: string[] = [];
    if (beat0Treble.length > 1) {
      const pitches = beat0Treble.map(n => {
        const oct = Math.floor(n.pitch / 12) - 1;
        return `${pcToLetter[n.pitch % 12] ?? "C"}${oct}`;
      });
      trebleTokens.push(`(${pitches.join(" ")})/q`);
    } else if (beat0Treble.length === 1) {
      trebleTokens.push(midiToEasyScore(beat0Treble[0].pitch, "q", pcToLetter));
    } else {
      trebleTokens.push("B4/q/r");
    }
    for (let beat = 1; beat <= 3; beat++) {
      const tNotes = tByBeat.get(beat) ?? [];
      trebleTokens.push(
        tNotes.length === 1
          ? midiToEasyScore(tNotes[0].pitch, "q", pcToLetter)
          : "B4/q/r"
      );
    }
    const tVF = score.notes(trebleTokens.join(", "), { stem: "up" });

    // Colour beat-0 chord group (orange for current — matches RH keyboard flash).
    if (beat0Treble.length > 0) {
      const gIdx   = chordGroupOf(allNotes, allNotes.indexOf(beat0Treble[0]));
      const status = noteStatuses[gIdx[0] ?? allNotes.indexOf(beat0Treble[0])] ?? "pending";
      tVF[0].setStyle({ fillStyle: STATUS_COLOUR_TREBLE_CHORD[status], strokeStyle: STATUS_COLOUR_TREBLE_CHORD[status] });
    }
    // Colour & annotate arpeggio notes (beats 1–3).
    for (let beat = 1; beat <= 3; beat++) {
      const tNotes = tByBeat.get(beat) ?? [];
      if (tNotes.length === 1) {
        const en     = tNotes[0];
        const colour = STATUS_COLOUR[noteStatuses[allNotes.indexOf(en)] ?? "pending"];
        tVF[beat].setStyle({ fillStyle: colour, strokeStyle: colour });
        tVF[beat].addModifier(
          new Annotation(String(en.finger))
            .setFont("Arial", 9)
            .setVerticalJustification(Annotation.VerticalJustify.TOP),
          0,
        );
      }
    }

    // Bass voice: whole note at beat 0 (sustained through the measure).
    const beat0Bass = bByBeat.get(0);
    const bassStr   = beat0Bass
      ? midiToEasyScore(beat0Bass.pitch, "w", pcToLetter)
      : "C3/w/r";
    const bVF = score.notes(bassStr, { clef: "bass", stem: "down" });
    if (beat0Bass) {
      const bStatus = noteStatuses[allNotes.indexOf(beat0Bass)] ?? "pending";
      bVF[0].setStyle({ fillStyle: STATUS_COLOUR[bStatus], strokeStyle: STATUS_COLOUR[bStatus] });
      bVF[0].addModifier(
        new Annotation(String(beat0Bass.finger))
          .setFont("Arial", 9)
          .setVerticalJustification(Annotation.VerticalJustify.BOTTOM),
        0,
      );
    }

    const treble = sys.addStave({ voices: [score.voice(tVF, { time: "4/4" })] });
    const bass   = sys.addStave({ voices: [score.voice(bVF, { time: "4/4" })] });

    if (isFirst) {
      treble.addClef("treble").addKeySignature(keyId).addTimeSignature("4/4");
      bass.addClef("bass").addKeySignature(keyId).addTimeSignature("4/4");
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

  const svg = el.querySelector("svg");
  if (!svg) return;
  addWhiteBg(svg as SVGElement);

  // Chord symbols above the treble stave.
  byMeasure.forEach((mNotes, m) => {
    const cn = mNotes.find((n) => n.staff === "treble" && n.chordSymbol);
    if (!cn?.chordSymbol) return;
    const cx = m === 0 ? staveXPos[0] + MEASURE1_HEADER + 8 : staveXPos[m] + 8;
    addSvgText(svg as SVGElement, cx, 30, `${cn.chordSymbol}  (${cn.romanNumeral})`);
  });
}

// ── component ──────────────────────────────────────────────────────────────────────────────────────

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

    renderSightReading(el, elementId, exercise, noteStatuses);

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
