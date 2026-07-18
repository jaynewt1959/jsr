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
  /** Increment this whenever the exercise resets so the beat grid restarts. */
  restartTrigger: number,
): MetronomeHook {
  const [beatPhase, setBeatPhase] = useState(0);

  // Live refs — updated every render so the interval sees current values
  // without the effect needing to re-run on every prop change.
  const bpmRef          = useRef(bpm);
  const enabledRef      = useRef(enabled);
  const triggerRef      = useRef(restartTrigger);
  const syncedTriggerRef = useRef<number>(-1);

  bpmRef.current     = bpm;
  enabledRef.current = enabled;
  triggerRef.current = restartTrigger;

  const ctxRef        = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const nextBeatRef   = useRef<number>(0);
  const beatInBarRef  = useRef<number>(0);

  // The effect only re-runs when `enabled` changes. Beat-grid restarts and
  // BPM changes are handled inside the interval via refs.
  useEffect(() => {
    if (!enabled) {
      setBeatPhase(0);
      return;
    }

    // Create / resume AudioContext.
    if (!ctxRef.current || ctxRef.current.state === "closed") {
      ctxRef.current = new AudioContext();
    }
    const ctx = ctxRef.current;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(1, ctx.currentTime);
    masterGain.connect(ctx.destination);
    masterGainRef.current = masterGain;

    // Force an immediate beat-grid initialisation on the first tick.
    syncedTriggerRef.current = -1;

    function scheduleClick(at: number, downbeat: boolean): void {
      const c  = ctxRef.current;
      const mg = masterGainRef.current;
      if (!c || !mg) return;
      const scheduled = at - (c.outputLatency ?? 0);
      const osc  = c.createOscillator();
      const gain = c.createGain();
      osc.connect(gain);
      gain.connect(mg);
      // Downbeat: higher pitch + louder; off-beats: softer.
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
      const lookahead     = c.currentTime + LOOK_AHEAD_MS / 1000;

      // Restart the beat grid when restartTrigger changes.
      if (triggerRef.current !== syncedTriggerRef.current) {
        syncedTriggerRef.current = triggerRef.current;
        // Start the first beat slightly ahead so the user hears it immediately.
        nextBeatRef.current  = c.currentTime + 0.05;
        beatInBarRef.current = 0;
      }

      // Schedule any upcoming clicks within the look-ahead window.
      while (nextBeatRef.current < lookahead) {
        scheduleClick(nextBeatRef.current, beatInBarRef.current === 0);
        nextBeatRef.current += beatPeriodSec;
        beatInBarRef.current = (beatInBarRef.current + 1) % 4;
      }

      // Derive beat phase for optional visual pulse.
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
