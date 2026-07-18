/**
 * useMetronome — Web Audio API lookahead click-track scheduler for JSR.
 *
 * Adapted from the jsp-ipad implementation (Paul Batchelor / Chris Wilson
 * pattern) but simplified: no server-clock synchronisation needed.
 *
 * A setInterval fires every LOOK_INTERVAL_MS (~25 ms) and schedules any
 * clicks that fall within the next LOOK_AHEAD_MS using AudioContext.currentTime,
 * decoupling the imprecise JS timer from the sample-accurate audio clock.
 *
 * The beat grid restarts (silently) whenever `restartTrigger` changes —
 * this is done inside the interval via a ref so there is no JS/audio-thread
 * race. The new grid always begins on a downbeat.
 */

import { useEffect, useRef, useState } from "react";

const LOOK_AHEAD_MS    = 100;  // schedule clicks this far ahead
const LOOK_INTERVAL_MS = 25;   // polling interval

interface MetronomeHook {
  /** Current beat phase 0–1 (0 = beat just fired, 1 = about to fire).
   *  Useful for driving a visual pulse. 0 when stopped. */
  beatPhase: number;
}

export function useMetronome(
  bpm: number,
  enabled: boolean,
  /**
   * `null`   — silent (READY state or run just completed).
   * `number` — counter that changes when the user plays their first note;
   *             triggers a beat-grid start anchored to that moment.
   *             The user's note is beat 0 (downbeat); the first CLICK fires
   *             one beat later on beat 1, guiding the arpeggio.
   */
  playTrigger: number | null,
): MetronomeHook {
  const [beatPhase, setBeatPhase] = useState(0);

  const bpmRef          = useRef(bpm);
  const enabledRef      = useRef(enabled);
  const triggerRef      = useRef(playTrigger);
  /** Last trigger value the interval acted on; use NaN as uninitialised sentinel. */
  const syncedTrigger   = useRef<number | null>(NaN as any);

  bpmRef.current     = bpm;
  enabledRef.current = enabled;
  triggerRef.current = playTrigger;

  const ctxRef        = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const nextBeatRef   = useRef<number>(0);
  const beatInBarRef  = useRef<number>(0);

  useEffect(() => {
    if (!enabled) { setBeatPhase(0); return; }

    if (!ctxRef.current || ctxRef.current.state === "closed") {
      ctxRef.current = new AudioContext();
    }
    const ctx = ctxRef.current;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(1, ctx.currentTime);
    masterGain.connect(ctx.destination);
    masterGainRef.current = masterGain;
    // Force the interval to evaluate the current trigger on its first tick.
    syncedTrigger.current = NaN as any;

    function scheduleClick(at: number, downbeat: boolean): void {
      const c  = ctxRef.current;
      const mg = masterGainRef.current;
      if (!c || !mg) return;
      const scheduled = at - (c.outputLatency ?? 0);
      const osc  = c.createOscillator();
      const gain = c.createGain();
      osc.connect(gain);
      gain.connect(mg);
      osc.frequency.value = downbeat ? 1200 : 880;
      const peak = downbeat ? 0.55 : 0.30;
      gain.gain.setValueAtTime(0, scheduled);
      gain.gain.linearRampToValueAtTime(peak, scheduled + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, scheduled + 0.040);
      osc.start(scheduled);
      osc.stop(scheduled + 0.050);
    }

    const intervalId = setInterval(() => {
      if (!enabledRef.current) return;
      const c  = ctxRef.current;
      const mg = masterGainRef.current;
      if (!c || !mg) return;

      const beatPeriodSec = 60 / bpmRef.current;

      // ─ Handle trigger transitions ─────────────────────────────
      // eslint-disable-next-line no-self-compare
      const triggerChanged = triggerRef.current !== syncedTrigger.current &&
                             !(Number.isNaN(syncedTrigger.current as any) && triggerRef.current === null);
      if (triggerChanged || Number.isNaN(syncedTrigger.current as any)) {
        syncedTrigger.current = triggerRef.current;

        if (triggerRef.current === null) {
          // Run completed or exercise reset — stay silent.
          setBeatPhase(0);
          return;
        }

        // User played their first note — anchor beat 0 to NOW.
        // Schedule the first CLICK one beat later (beat 1 / arpeggio note 1).
        nextBeatRef.current  = c.currentTime + beatPeriodSec;
        beatInBarRef.current = 1; // beat 0 (downbeat) just happened via user's note
      }

      // ─ Silent state ────────────────────────────────────────
      if (triggerRef.current === null) { setBeatPhase(0); return; }

      // ─ Lookahead scheduling ───────────────────────────────
      const lookahead = c.currentTime + LOOK_AHEAD_MS / 1000;
      while (nextBeatRef.current < lookahead) {
        scheduleClick(nextBeatRef.current, beatInBarRef.current === 0);
        nextBeatRef.current += beatPeriodSec;
        beatInBarRef.current = (beatInBarRef.current + 1) % 4;
      }
      const elapsed = c.currentTime - (nextBeatRef.current - beatPeriodSec);
      setBeatPhase(Math.min(1, Math.max(0, elapsed / beatPeriodSec)));
    }, LOOK_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
      masterGain.gain.cancelScheduledValues(0);
      masterGain.gain.setValueAtTime(0, 0);
      masterGain.disconnect();
      masterGainRef.current = null;
      setBeatPhase(0);
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return { beatPhase };
}
