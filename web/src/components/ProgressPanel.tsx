/**
 * ProgressPanel.tsx — JSR progress heat-map panel
 *
 * Renders below the virtual keyboard. Shows a 12-key row of coloured pips
 * representing chord-recognition and arpeggio (sight-reading) scores for
 * each key, colour-coded by composite accuracy/evenness score.
 *
 * Tapping a key cell drills down to a per-progression breakdown.
 * Tapping "Reset" clears all stored progress after a confirm dialog.
 */

import { useState, useMemo } from "react";
import {
  getAllMetrics,
  getProgressionMetrics,
  clearProgress,
  scoreColor,
  KEYS_ORDERED,
} from "../engine/progressStore";
import "./ProgressPanel.css";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  /** Currently active key id, e.g. "G". */
  currentKey: string;
  /** Incremented by App.tsx each time a session is saved. */
  refreshKey: number;
  /** Called after progress data is cleared, so the parent can reset any
   *  run-feedback state that references the now-deleted data. */
  onReset?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DetailSection — per-progression breakdown in the drill-down
// ---------------------------------------------------------------------------

function DetailSection({ progressions }: { progressions: ReturnType<typeof getProgressionMetrics> }) {
  return (
    <div className="progress-panel__detail-rows">
      {progressions.map(({ name, metrics }) => (
        <div key={name} className="progress-panel__detail-row">
          <span className="progress-panel__detail-prog">{name}</span>
          {metrics ? (
            <>
              <div className="progress-panel__detail-bar-track">
                <div
                  className="progress-panel__detail-bar-fill"
                  style={{
                    width: `${Math.round(metrics.composite)}%`,
                    backgroundColor: scoreColor(metrics.composite),
                  }}
                />
              </div>
              <span className="progress-panel__detail-score">
                {Math.round(metrics.composite)}
              </span>
              {metrics.rhythm !== null && (
                <span className="progress-panel__detail-evenness">
                  R {Math.round(metrics.rhythm)}%
                </span>
              )}
              {metrics.evenness !== null && (
                <span className="progress-panel__detail-evenness">
                  E {Math.round(metrics.evenness)}%
                </span>
              )}
            </>
          ) : (
            <span className="progress-panel__detail-no-data">no data</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProgressPanel
// ---------------------------------------------------------------------------

export function ProgressPanel({ currentKey, refreshKey, onReset }: Props) {
  const [detailKey,    setDetailKey]    = useState<string | null>(null);
  const [localVersion, setLocalVersion] = useState(0);

  // Reload metrics when a new session is saved (refreshKey) or after a reset (localVersion).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const metrics = useMemo(() => getAllMetrics(), [refreshKey, localVersion]);

  function handleReset() {
    if (window.confirm("Reset all progress data? This cannot be undone.")) {
      clearProgress();
      setDetailKey(null);
      setLocalVersion(v => v + 1);
      onReset?.(); // clear any parent state tied to the now-deleted data
    }
  }

  // --------------------------------------------------------------------------
  // Detail view
  // --------------------------------------------------------------------------

  if (detailKey !== null) {
    const progressions = getProgressionMetrics(detailKey);

    return (
      <div className="progress-panel">
        <div className="progress-panel__detail-header">
          <button
            className="progress-panel__back-btn"
            onClick={() => setDetailKey(null)}
          >
            ← Back
          </button>
          <span className="progress-panel__detail-title">
            {detailKey} major — Progress by progression
          </span>
        </div>
        <DetailSection progressions={progressions} />
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Grid view
  // --------------------------------------------------------------------------

  return (
    <div className="progress-panel">
      {/* ── Header ── */}
      <div className="progress-panel__header">
        <span className="progress-panel__title">Progress</span>
        <span className="progress-panel__hint">tap a key for detail</span>
        <div className="progress-panel__spacer" />
        <button className="progress-panel__reset-btn" onClick={handleReset}>
          ↺ Reset
        </button>
      </div>

      {/* ── Key grid ── */}
      <div className="progress-panel__grid">
        {KEYS_ORDERED.map(key => {
          const isActive = key === currentKey;
          const score    = metrics.get(key)?.composite ?? null;

          return (
            <button
              key={key}
              className={
                `progress-panel__cell${isActive ? ' progress-panel__cell--active' : ''}`
              }
              onClick={() => setDetailKey(key)}
            >
              <span className="progress-panel__cell-name">{key}</span>
              <span
                className="progress-panel__pip"
                style={{ backgroundColor: scoreColor(score) }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
