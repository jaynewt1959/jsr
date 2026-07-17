# JSR — Jay's Sight Reading: Project Context

## What this app is

iPad piano practice trainer for chord progressions on a grand staff.
The player connects a MIDI keyboard and works through 12 keys × 5 progressions × 4 voicing variants.
Each exercise loops continuously; a per-run scorecard tracks accuracy, rhythm consistency, and evenness.

Architecture: SwiftUI shell (iPad) → WKWebView (React/JS exercise engine) →
Hummingbird WebSocket server → CoreMIDI → Nord Stage 4 (or any MIDI device).

---

## Exercise structure

Each measure contains **7 notes** in two phases.
All notes at `(measure, beat=0)` share the same coordinates and are detected as a
chord group by `chordGroupOf()`; beats 1–3 each have a single note and are sequential.

| Beat | Staff  | Content                          | Detection         |
|------|--------|----------------------------------|-------------------|
| 0    | Bass   | LH chord root (whole note)       | chord group (×4)  |
| 0    | Treble | RH block chord (3 notes, ”/q)    | chord group (×4)  |
| 1    | Treble | RH arpeggio — bottom note        | sequential (×1)   |
| 2    | Treble | RH arpeggio — middle note        | sequential (×1)   |
| 3    | Treble | RH arpeggio — top note           | sequential (×1)   |

No `AppMode` type exists. The engine calls `chordGroupPitches(notes, idx).length > 1`
at the current index to decide chord vs. sequential handling.

**4 measures** per exercise, **4 voicing variants** (index % 4, different starting
inversion), **5 progressions** (Blues, 50s, Pop, Circle, Minor Feel), **12 keys**.

---

## Loop practice

- The exercise **loops continuously** — no pass count, no “exercise complete” gate.
- On run completion: `runComplete = true`, stats computed, `BEGIN_NEXT_RUN` dispatched immediately.
- `RunFeedback` panel (always visible, fixed height) shows the scorecard.
- Stats latch until `currentNoteIndex > 0` in the new run (first correct note played).
- **← Prev / → Next** (chevrons flanking the variation number) cycle the 4 voicing
  variants with wraparound. **↺ Restart** (green, centre) resets the current variant.

---

## Progress metrics

Persisted in `localStorage` key `jsr.progress` via `web/src/engine/progressStore.ts`.

```typescript
interface SessionRecord {
  key: string; progression: string; exerciseIndex?: number;
  accuracy: number;        // 0–100
  evenness: number | null; // velocity CV → 0–100; null for on-screen taps
  rhythm:   number | null; // inter-note timing CV → 0–100
  errors:   number;        // wrong note presses this run
  timestamp: number;
}
```

**Composite score**: `accuracy×40% + rhythm×35% + evenness×25%`
(weights redistributed when a metric is unavailable).

`ProgressPanel` shows a 12-key heat map (one pip per key, grey→red→amber→green).
Tapping a key opens a per-progression drill-down with R% and E% sub-scores.

---

## Score rendering

`web/src/components/ScoreView.tsx` uses **VexFlow 5 Factory + EasyScore API**.

- Beat 0 treble: parenthesised block chord `(C4 E4 G4)/q`; bass: whole note `C3/w`.
- Beats 1–3: individual quarter notes.
- Colours: pending = near-black, current chord = orange, current arpeggio/bass = blue,
  correct = grey, wrong = red.
- Chord symbols (e.g. `Am  (vi)`) rendered as SVG text above treble stave.
- Finger numbers rendered via VexFlow `Annotation` above/below each note.

---

## MIDI

- CoreMIDI client started by Swift on user tap ("Connect MIDI").
- Hummingbird WebSocket relays every note-on/off as `NoteEventMessage`
  (note, velocity, isOn, sourceName). Velocity is used for the evenness metric.
- Hot-plug via `msgObjectAdded`/`msgSetupChanged` + 1-second polling fallback.
- `flushPending()` discards pre-connect key presses.
- Buffer size fixed at 64 (was 1 — was dropping notes).

---

## SwiftUI / JS bridge

**JS → Swift** (`jsrBridge` message handler):
`exerciseIndex`, `wrongNoteActive`, `currentHand`, `currentFinger`,
`exerciseKey`, `progressionName`, `midiRunning`, `midiConnected`, `midiSourceName`, `currentVariation`.

**Swift → JS** (`window.jsr.*`):
`restart`, `nextExercise`, `prevExercise`, `setKey`, `setProgression`, `connectMidi`, `disconnectMidi`.

---

## Build notes

- `ENABLE_USER_SCRIPT_SANDBOXING: NO` in `project.yml` is required (fixes
  "Build Web UI" and "Copy Web UI to Bundle" script phase sandbox errors).
- App icon: forest green `#0D2D18` (distinguishes from JSP navy `#0F172A`).
- Web layer built with `npm run build` in `web/`; output lands in `web/dist/` and
  is bundled into the app by the Xcode copy phase.

---

## Key file map

| File | Purpose |
|---|---|
| `JSR/ContentView.swift` | SwiftUI layout: header, WebView, control bar (variation, Restart, MIDI) |
| `JSR/AppState.swift` | @Published bridge state; JS call helpers |
| `JSR/EngineHost.swift` | Hummingbird server + MidiCoordinator lifecycle |
| `Sources/Server/MidiCoordinator.swift` | MIDI start/stop/refresh, WebSocket broadcast |
| `Sources/MIDI/MidiInput.swift` | CoreMIDI client, hot-plug, event stream |
| `Sources/Server/WebSocketHub.swift` | Broadcast to all WS clients |
| `web/src/engine/voiceLeading.ts` | Chord definitions, voicing algorithm, exercise builder |
| `web/src/engine/exerciseEngine.ts` | Pure reducer: run count, chord auto-detection, wrong-note state |
| `web/src/engine/progressStore.ts` | localStorage persistence: session records, aggregation, scoreColor |
| `web/src/hooks/useMidi.ts` | WebSocket connection; delivers note events with velocity |
| `web/src/App.tsx` | React root: unified handleNote, metrics accumulation, bridge |
| `web/src/components/ScoreView.tsx` | VexFlow 5 grand-staff renderer (chord group + arpeggio) |
| `web/src/components/PianoKeyboard.tsx` | On-screen keyboard (tap input, flash feedback) |
| `web/src/components/RunFeedback.tsx` | Per-run scorecard panel (always visible, fixed height) |
| `web/src/components/ProgressPanel.tsx` | 12-key heat map with per-progression drill-down |
| `project.yml` | XcodeGen spec |

---

## Known limitations / future work

- Rhythm metric measures internal timing consistency (no metronome target); a click
  track would make it more meaningful for rhythmic accuracy.
- No export / sharing of progress data.
- `web/src/engine/fingering.ts` is unused (was JSP scale fingering, does not fit JSR).`
