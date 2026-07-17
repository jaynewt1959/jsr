# JSR — web layer

React + TypeScript + Vite app that runs inside the WKWebView of the JSR iPad app.
It receives MIDI note events over a WebSocket (from the Swift Hummingbird server)
and drives the exercise engine, score view, and progress tracking.

## Quick start

```bash
npm install
npm run dev        # Vite dev server on :5173 (proxies /ws → :8089)
npm run build      # Production build → dist/  (bundled into the Xcode app)
npm run lint       # oxlint
```

## Source layout

```
src/
  App.tsx                     # React root: note handling, metrics, bridge to Swift
  engine/
    voiceLeading.ts           # Chord/voicing generation; builds ExerciseNote arrays
    exerciseEngine.ts         # Pure reducer: run loop, chord auto-detection
    progressStore.ts          # localStorage persistence for per-run stats
  components/
    ScoreView.tsx             # VexFlow 5 grand-staff renderer
    PianoKeyboard.tsx         # On-screen keyboard (tap input + flash feedback)
    RunFeedback.tsx           # Per-run scorecard (always visible panel)
    ProgressPanel.tsx         # 12-key heat map with drill-down
  hooks/
    useMidi.ts                # WebSocket client; delivers note events with velocity
```

## Exercise format

Each 4/4 measure has 7 notes:
- **Beat 0**: LH whole note (chord root) + RH block chord (3 quarter notes) — played simultaneously.
- **Beats 1–3**: RH broken arpeggio (3 sequential quarter notes).

The engine detects chord groups automatically via `chordGroupOf()` which groups notes
by `(measure, beat)` — no explicit mode flag is used.

## WebSocket protocol

The Hummingbird server runs on `:8089`. The dev proxy forwards `/ws` there.

**Server → client**
- `{ type: "midiState", running, sources, activeSource }` — on connect / source change
- `{ type: "noteEvent", note, velocity, isOn, sourceName }` — every MIDI note

**Client → server**
- `{ type: "startMidi" }` — start CoreMIDI
- `{ type: "stopMidi" }` — stop CoreMIDI

## JS ↔ Swift bridge

**JS → Swift**: `window.webkit.messageHandlers.jsrBridge.postMessage(JSON)`

**Swift → JS**: functions on `window.jsr`:
`restart()`, `nextExercise()`, `prevExercise()`,
`setKey(id)`, `setProgression(id)`, `connectMidi()`, `disconnectMidi()`

## Progress data

Stored in `localStorage` key `jsr.progress` as an array of `SessionRecord` objects.
Each record captures: `key`, `progression`, `accuracy`, `evenness`, `rhythm`, `errors`, `timestamp`.
Up to 20 records are kept per key (oldest dropped on write).

Composite score = accuracy×40% + rhythm×35% + evenness×25% (weights redistributed when unavailable).
