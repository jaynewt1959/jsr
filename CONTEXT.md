# JSR — Jay's Sight Reading: Project Context

## What this app is

iPad piano practice trainer for chord progressions on a grand staff.
The player connects a MIDI keyboard and works through 12 keys × 5 progressions × 4 voicing variants.
Each exercise loops continuously; a per-run scorecard tracks accuracy, rhythm consistency, and evenness.

Three training modes, toggled via the **MODE** selector in the UI (persisted to UserDefaults):

| Mode | Button | What the player does |
|---|---|---|
| Sight Reading | Sight Reading | LH whole-note root + RH block chord then arpeggio |
| Bass Only | ♪ Bass | LH 8-note eighth-note bass line; treble shows grey reference chord |
| Combined | ♪ Both | Both hands simultaneously: LH bass line + RH chord/arpeggio |

Architecture: SwiftUI shell (iPad) → WKWebView (React/JS exercise engine) →
Hummingbird WebSocket server → CoreMIDI → Nord Stage 4 (or any MIDI device).

---

## Exercise structure

### Sight Reading (7 notes/measure, 28 total)

All notes at `(measure, beat=0)` share the same coordinates and are detected as a
chord group by `chordGroupOf()`; beats 1–3 each have a single note and are sequential.

| Beat | Staff  | Content                       | Detection        |
|------|--------|-----|------|--------|-----|------|--------|-----|------|--------|-----|------|--------|-----|------|------ group (×4) |
| 0    | Treble | RH block chord (3 notes, /q)  | chord group (×4) |
| 1    | Treble | RH arpeggio — bottom note     | sequential (×1)  |
| 2    | Treble | RH arpeggio — middle note     | sequential (×1)  |
| 3    | Treble | RH arpeggio — top note        | sequential (×1)  |

### Bass Only (8 notes/measure, 3### Bass Only (8 notes/measure, 3### Bass Only (8 notes/measure, 3### Bass Only (8ure).### Bass Only (8 notes/measure, 3### Bass Only (8 notes/measure, 3### Bass Onnever validated).
`exercise.bassMode = true`.

### Combined / Both Hands (14 notes/measure, 56 total)

Uses **fraUses **fraUses **fraUses **fraUses **fraUsesects simultaneous LH+RH pairs without
any special-case logic. `exercise.combinedMode = true`.

`computeCombinedBassNote()` clamps to ≤ B3 (MIDI 59) — hard register split below
`TREBLE_MIN = C4 = 60`, guaranteeing zero pitch collisions regardless of key or pattern.

| Beat | Staff  | Content                  | Detection        |
|------|--------|--------------------------|------------------|
| 0.0  | Bass   | LH eighth (pattern[0])   | chord group (×4) |
| 0.0  | Treble | RH block chord (3 notes) | chord group (×4)| 0.0  | Treble | RH block chord (3 notes) | chord group (×4)| 0.0  |1.0  | Bass   | LH eighth (pattern[2])   | chord group (×2) |
| 1.0  | Treble | RH arpeggio — bottom     | chord group (×2) |
| 1.5  | Bass   | LH eighth (pattern[3])   | sequential (×1)  |
| 2.0  | Bass   | LH eighth (pattern[4])   | chord group (×2) |
| 2.0  | Treble | RH arpeggio — middle     | chord group (×2) |
| 2.5  | Bass   | LH eighth (pattern[5])   | sequential (×1)  |
| 3.0  | Bass   | LH eighth (pattern[6])   | chord group (×2) |
| 3.0  | Treble | RH arpeggio — top        | chord group (×2) |
| 3.5  | Bass   | LH eighth (pattern[7])   | sequential (×1)  |

No `AppMode` type eNo `AppMode` type eNo `AppMode` type eNo `AppMode` type eNo `AppMode` type eNo `AppMode to decide chord vs. sequential handling — works identically across
all three modes.

**4 measures** per exercise, **4 voicing variants** (index % 4), **5 progressions**, **12 keys**.

---

## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B## B| Pattern [p0..p7]         | Character                     |
|-------------|--------------------------|-------------------------------|
| Blues       | [0,4,7,9,10,9,7,4]       | Boogie ascending/descending   |
| 50s         | [0,7,12,7,0,7,12,7]      | Root-fifth-octave pump        |
| Pop         | [0,5,7,12,7,5,7,0]       | Root-subdominant-fifth arc    |
| Circle      | [0,5,7,5,0,5,7,5]        | Jazz sub-dominant feel        |
| Minor Feel  | [0,7,10,12,1| Minor Feel  | [0,7,10,12,1| Minor Feel  | [0,7,10,12,1| MinoneNote(root, offset)`: clamps to MIDI 36–60 (C2–C4). Bass-only mode.
`computeCombinedBassNote(root, offset)`: clamps to MIDI 36–59 (C2–B3). Combined mode only.

### Bass fi### Bass fi#bined ### Bass fi### Bass fi#bined ### Bass fi### Bass fi#bined ### Bass fi### Bass fi#bined ### Bass  distinct pitches: 5–1 alternation
- n=3: middle → 2 (upper half of span) or 4 (lower half)
- n=4: delegates to existing `lhFingering()` span-aware algorithm
- n≥5: even 5→4→3→2→1 by rank index (Blues → 5,4,3,2,1)

Rendered as VexFlow `Annotation` (BOTTOM justification) below each bass eighth note.

---

## Loop practice

- The exercise **loops continuously** — no pass count, no "exercise complete" gate.
- On run completion: `runComplete = true`, stats computed, `BEGIN_NEXT_RUN` dispatched immediately.
- `RunFeedback` panel (always visible, - `RunFeedback` panel (always visible, - `RunFeedback` panel (always visi> 0` in the new run (first correct note played).
- **← Prev / → Next** cycle the 4 voicing variants. **↺ Restart** resets the current variant.
- Stale-note detection (N-2 held finger penalty) is disabled in bass and combined modes.

---

## Progress metri## Progress metri## Progress metri## Progress metri## Progress metri## Progress metri## Progress metri## Progress metri## Progress metri## Progress metri## Progtring; exerciseIndex?: number;
  accuracy: number;        // 0–100
  evenness: number | null; // velocity CV → 0–100; nul  evenness: number | null; // velocity CV → 0–100; nul  evenning CV → 0–100
  errors:   number;
  timestamp: number;
}
```

**Composite score**: `accura**Composite scom×35% + evenness×25%`.

`ProgressPanel` shows a 12-key heat map. Tapping a key opens per-progression drill-down.

---

## Score rendering

`web/src/components/ScoreView.tsx` — VexFlow 5 Factory + EasyScore API.
Three renderers, each with its own canvas height:

| Function              | Canvas height | Mode     |
|-----------------------|---------------|----------|
| `renderSightReading`  | 280 px        | Sight Reading |
| `renderBassMode`      | 320 px        | Bass Only |
| `renderCombinedMode`  | 380 px        | Combined |

**Sight reading**: beat-0 chord `(C4 E4 G4)/q`; bass whole note `C3/w`; arpeggio quarters.

**Bass only**: grey whole-note reference chord in treble (not validated); 8 beamed eighth
notes in bass; two `factory.Beam()` groups of 4.

**Combined**: treble identical to sight-reading; bass as 8 beamed eighth notes with finger
annotations below. RH treble notes (all beats) use orange (`STATUS_COLOUR_TREBLE_CHORD`)
sinsinsinsinsinsinsin chord-group members alongside LH.

**Colours**: pending = #1a1a2a (near-black) · current treble = #c87020 (orange) ·
current bass/sequential = #1060c8 (blue) · correcu = #aaaaaa · wrong = #cc1f1f.

Chord symbols (`Am  (vi)`) rendered as SVG text above treble stave.

---

## MIDI

- CoreMIDI client started by Swif- CoreMIDI client started by Swif- CoreMIDI client cket relays every note-on/off as `NoteEventMessage`
  (note, velocity, isOn, sourceName). Velocity used for evenness metric.
- Hot-plug via `msgObjectAdded`/`msgSetupC- Hot-plug via `msgObjectAdded`/`msgSetupC- Hot-plng()` discards pre-connect key presses. Buffer size 64.

---

## SwiftUI / JS bridge

**JS → Swift** (`jsrBridge` message handler):
`exerciseIndex`, `wrongNoteActive`, `currentHand`, ``exerciseIndex`, `wrongNoteActive`, `currentHae`, `midiRunning`, `midiConnected`, `midiSourceName`, `currentVariation`.

**Swift → JS** (`w**Swift → JS** (`w**Swift → JS** (`w**Swift → JS** (`w**Swift → JS** (`w**Swif`setBassMode`, `setMetronome`, `connectMidi`, `disconnectMidi`.

`setBassMode(mode)` accepts `"sightReading"` | `"bass"` | `"combined"`.
Persisted to `UserDefaults` key `jsr.bassMode`; restored on launch via `applyPersistedConfPersisted to `UserDefaults` key `jsr.bassMode`; restored on launch in `project.yml`Persisted to `UserDefaults` key `jsr.bassMode`; restored on launch via `applyPersistedConfPersisted to `UserDefaults` key `jsr.bassMo## Persisted to `UserDefaults` key `jsr.bassMode`; restored on launch via  iPersisted to `UserDefaults` key `jsr.bassMode`; restored on launch via `applyPersistedConfPersisted to `UserDefaults` key `jsr.bassMode`; restorenly
Peke launch   # launch already-installed app
```

iPad UDID hardcoded in `DEViPad UDID hardcoded in `DEViPad UDID hardcoded in `DEViPad UDID hardcoded in `DEViPad UDID hardcoded in `DEViPad UDID hardcoded in `DEViPad UDID hardcoded in `DEViPad UDION/iPad UDID hardcoded in `DEViPad UDID hardcoded in `DEViPad UDID hardcoded in `DEViPad UDID hardcoded in `DEViPad UDID hardcoded in `DEViPad UDID hardcoded in `DEViPad UMidiPad UDID hardcoded in `DEViPad UDID hardcoded in `DEViPad UDID hardcoDI start/stop/refresh, WebSocket broadcast |
| `Sources/MIDI/MidiInput.swift` | CoreMIDI client, hot-plug, event stream |
| `Sources/Server/WebSocketHub.swift` | Broadcast to all WS clients |
| `web/src/engine/voiceLeading.ts` | Chord defs, voicing, all three exercise builders, `BASS_LINE_PATTERNS`, `bassLineFingering` |
| `web/src/engine/exerciseEngine.ts` | Pure reducer: validation, chord-group detection, `selectedMode`, `SET_CONFIG_MODE` |
| `web/src/engine/progressStore.ts` | localStorage persistence: session records, aggregation, scoreColor |
| `web/src/hooks/useMidi.ts` | WebSocket connection; delivers note events with velocity |
| `web/src/App.tsx` | React root: `handleNote`, metrics, bridge, `setBassMode` dispatch |
| `web/src/components/ScoreView.tsx` | VexFlow 5: `renderSightReading` / `renderBassMode` / `renderCombinedMode` |
| `web/src/components/PianoKeyboard.tsx` | On-screen keyboard (tap input, flash feedback) |
| `web/src/components/RunFeedback.tsx` | Per-run scorecard panel |
| `web/src/components/ProgressPanel.tsx` | 12-key heat map wi| `web/src/components/ProgressPanel.tsx` | 12-key heat map wi| `web/src/comKnown limitations / future work

- Rhythm metric measures internal consistency only (no metronome target).
- No export / sharing of progress data.
- Bass fingering annotations shown in both bass-only and combined modes.
- Stage 2 combined mode is challenging; a metronome is strongly recommended.
