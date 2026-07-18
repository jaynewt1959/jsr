/**
 * RunFeedback.tsx — JSR per-run scorecard
 *
 * Shown below the virtual keyboard after every complete traversal of the
 * exercise. Displays stats for the last run, then a countdown before the
 * next loop begins. Stays latched (visible) until the first note of the
 * new run clears it from App.tsx.
 */

import { scoreColor } from "../engine/progressStore";
import "./RunFeedback.css";

// ---------------------------------------------------------------------------
// Types (re-exported so App.tsx can import from one place)
// ---------------------------------------------------------------------------

export interface RunStats {
  runNumber: number;
  errors: number;
  stales: number;       // notes held two steps too long (legato overlap demerit)
  accuracy: number;
  evenness: number | null;
  rhythm: number | null;
  composite: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  stats: RunStats | null;
  rollingAvg: number | null;
  sessionCount: number;
}

/** Dot colour based on a 0–100 value (grey = no data). */
function metricColor(value: number | null): string {
  return scoreColor(value);
}

function ScoreBadge({ value }: { value: number }) {
  const color = metricColor(value);
  return (
    <span className="run-feedback__score" style={{ color }}>
      {Math.round(value)}
    </span>
  );
}

function Sep() {
  return <span className="run-feedback__sep" aria-hidden>·</span>;
}

export function RunFeedback({ stats, rollingAvg, sessionCount }: Props) {
  return (
    // Always rendered so it reserves layout space — hidden via CSS when empty.
    <div className="run-feedback" role="status" aria-live="polite">
      {stats && (
        <div className="run-feedback__line">
          <span className="run-feedback__run-label">Run {stats.runNumber}</span>
          <Sep />
          <span className="run-feedback__score-label">Score</span>
          <ScoreBadge value={stats.composite} />
          <Sep />
          {stats.errors === 0 && stats.stales === 0 ? (
            <span className="run-feedback__clean">✓ Clean</span>
          ) : (
            <>
              {stats.errors > 0 && (
                <span className="run-feedback__errors">
                  {stats.errors} error{stats.errors === 1 ? "" : "s"}
                </span>
              )}
              {stats.stales > 0 && (
                <>
                  {stats.errors > 0 && <Sep />}
                  <span className="run-feedback__stales">
                    {stats.stales} stale{stats.stales === 1 ? "" : "s"}
                  </span>
                </>
              )}
            </>
          )}
          {stats.evenness !== null && (
            <>
              <Sep />
              <span className="run-feedback__metric">
                Evenness <strong>{Math.round(stats.evenness)}%</strong>
              </span>
            </>
          )}
          {stats.rhythm !== null && (
            <>
              <Sep />
              <span className="run-feedback__metric">
                Rhythm <strong>{Math.round(stats.rhythm)}%</strong>
              </span>
            </>
          )}
          {rollingAvg !== null && sessionCount >= 2 && (
            <>
              <Sep />
              <span className="run-feedback__avg">
                Avg <strong>{Math.round(rollingAvg)}</strong>
                <span className="run-feedback__avg-count"> ({sessionCount} runs)</span>
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
