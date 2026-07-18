/**
 * DiagPanel.tsx — in-app diagnostic event log
 *
 * Shows every note-on event and the decision made (correct / wrong /
 * ignored / stale / chord-partial / chord-complete).  Displayed as a
 * full-screen overlay so the log can be photographed for analysis.
 */

import "./DiagPanel.css";

// ---------------------------------------------------------------------------
// Event type — exported so App.tsx can push events
// ---------------------------------------------------------------------------

export interface DiagEvent {
  t: number;          // ms since run started
  note: string;       // e.g. "C4(60)"
  raw: number;        // raw MIDI pitch
  phase: string;      // "CHORD" | "SEQ" | "IGNORE"
  result: string;     // human-readable decision
  want: string;       // what the engine expected
  idx: number;        // engine's currentNoteIndex at press time
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resultClass(result: string): string {
  if (result.includes("✓"))    return "ok";
  if (result.includes("✗"))    return "wrong";
  if (result.includes("STALE")) return "stale";
  return "ignore";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  events: DiagEvent[];
  onClose: () => void;
  onClear: () => void;
}

export function DiagPanel({ events, onClose, onClear }: Props) {
  // Newest first so the most recent events are always visible at the top.
  const reversed = [...events].reverse();

  return (
    <div className="diag-overlay" role="dialog" aria-label="Diagnostic log">
      <div className="diag-header">
        <span className="diag-title">DIAGNOSTIC LOG — {events.length} events</span>
        <button className="diag-btn" onClick={onClear}>CLEAR</button>
        <button className="diag-btn diag-btn--close" onClick={onClose}>✕ CLOSE</button>
      </div>

      <div className="diag-col-labels">
        <span className="diag-t">TIME</span>
        <span className="diag-note">NOTE</span>
        <span className="diag-phase">PHASE</span>
        <span className="diag-result-col">RESULT</span>
        <span className="diag-want">EXPECTED</span>
        <span className="diag-idx">IDX</span>
      </div>

      <div className="diag-events">
        {reversed.length === 0 && (
          <div className="diag-empty">No events yet — play some notes</div>
        )}
        {reversed.map((e, i) => (
          <div key={i} className={`diag-event diag-event--${resultClass(e.result)}`}>
            <span className="diag-t">{e.t}ms</span>
            <span className="diag-note">{e.note}</span>
            <span className="diag-phase">{e.phase}</span>
            <span className="diag-result-col">{e.result}</span>
            <span className="diag-want">{e.want}</span>
            <span className="diag-idx">{e.idx}</span>
          </div>
        ))}
      </div>

      <div className="diag-footer">
        Newest events at top · green=correct · red=wrong · amber=stale · grey=ignored
      </div>
    </div>
  );
}
