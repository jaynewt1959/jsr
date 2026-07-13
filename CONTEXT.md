# JSR — Jay's Sight Reading: Project Status

## What this app is

iPad piano sight-reading trainer. Displays a chord progression on a grand staff.
Player reads and plays notes with a MIDI keyboard. App tracks pass count.

Architecture: SwiftUI shell (iPad) → WKWebView (React/JS exercise engine) →
Hummingbird WebSocket server → CoreMIDI → Nord Stage 4 (or any MIDI device).

---

## What works

- **MIDI**: CoreMIDI connects on WebSocket open (`startMidi`). Hot-plug via
  `msgObjectAdded`/`msgSetupChanged`. Periodic 2-second fallback scan.
  "Tap to scan" banner in UI. Buffer size fixed (64, was 1 — was dropping notes).
- **Exercise engine** (`web/src/engine/exerciseEngine.ts`): pure reducer, tracks
  note index, pass count, wrong-note state. Sequential note-by-note playback.
- **Voice leading** (`web/src/engine/voiceLeading.ts`): economy-of-movement
  inversion algorithm. For each chord, picks the inversion (root/1st/2nd) that
  minimises total semitone movement from the previous chord.
  - C major I–vi–IV–V: C-E-G → C-E-A → C-F-A → D-G-B ✓
  - RH fingering: 1-3-5 (normal), 1-2-5 (major 3rd + wide top interval)
  - LH fingering: linear map of bass pitch range → fingers 5..1
  - 4 starting voicings (root pos, 1st inv, 2nd inv, root pos high) give 4
    distinct exercise variants cycling on index % 4.
- **Note sequencing per measure**: LH bass root (beat 1, whole note) → RH
  arpeggio beat 2, 3, 4 (three quarter notes). Beat 1 is a visual rest in treble.
- **Wrong note handling**: target note stays blue; banner says "play the blue note".
- **Pass count**: displays 1-based (working on pass N, not N completed).
- **App icon**: forest green (#0D2D18) to distinguish from JSP (navy #0F172A).
- **Build**: `ENABLE_USER_SCRIPT_SANDBOXING: NO` in project.yml fixes sandbox
  errors in the Build Web UI / Copy Web UI to Bundle script phases.
- **Layout**: controls moved below score (full-width score), horizontal control
  strip: Pass counter | Restart/Next buttons | MIDI status.

---

## What is broken / abandoned

### Score rendering — VexFlow scrapped

VexFlow 5.0.0 cannot reliably render a 4/4 measure with a quarter rest on beat 1
followed by three quarter notes. Multiple approaches (unshift, proper grand-staff
joinVoices, clef param on rest) all produce garbled output (rest bleeding into
next measure, notes misaligned). VexFlow is removed from active use.

**Plan**: replace with static grand-staff images (one per key) provided by the
user, with custom SVG overlays for note highlighting — same approach used in JSP.

---

## Next steps

1. User to provide grand staff images for each key (12 keys × inversions as needed).
2. Implement a custom SVG renderer that:
   - Displays the background staff image
   - Overlays note heads at computed pixel positions
   - Colours note heads by status (blue = current, grey = correct, red = wrong)
   - Shows finger numbers as text annotations
3. Wire the renderer to the existing `exerciseEngine` state (noteStatuses array).
4. Wire it to the existing `voiceLeading` output (ExerciseNote array with pitches,
   fingers, staff, beat positions).

The exercise engine, voice-leading algorithm, MIDI stack, and SwiftUI shell are
all solid and do not need to change for this work.

---

## Key file map

| File | Purpose |
|---|---|
| `JSR/ContentView.swift` | SwiftUI layout: header, score WebView, control bar |
| `JSR/AppState.swift` | Published state bridged from JS via WKScriptMessageHandler |
| `JSR/EngineHost.swift` | Hummingbird server + MidiCoordinator lifecycle |
| `Sources/Server/MidiCoordinator.swift` | MIDI start/stop/refresh, WebSocket broadcast |
| `Sources/MIDI/MidiInput.swift` | CoreMIDI client, hot-plug, event stream |
| `Sources/Server/WebSocketHub.swift` | Broadcast to all WS clients |
| `web/src/engine/voiceLeading.ts` | Chord definitions + economy-of-movement voicing |
| `web/src/engine/exerciseEngine.ts` | Note sequencing reducer |
| `web/src/engine/fingering.ts` | (Unused — was JSP scale fingering, does not fit) |
| `web/src/hooks/useMidi.ts` | WS connection, sends startMidi on open |
| `web/src/App.tsx` | React root, bridges engine state to SwiftUI |
| `web/src/components/ScoreView.tsx` | VexFlow renderer — TO BE REPLACED |
| `project.yml` | XcodeGen spec |
