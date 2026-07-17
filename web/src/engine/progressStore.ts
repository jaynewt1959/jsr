/**
 * progressStore.ts — JSR progress metrics persistence.
 *
 * Stores per-session accuracy and evenness in localStorage.
 * Exposes:
 *   recordSession()       — save one completed exercise result
 *   requiredPassCount()   — adaptive pass threshold (1–3) from composite score
 *   getAllMetrics()        — aggregated grid data for all 12 keys × 2 modes
 *   getProgressionMetrics() — drill-down breakdown per progression for a key+mode
 *   clearProgress()       — erase all stored data
 *   computeEvenness()     — velocity CV → 0–100 evenness score
 *   compositeScore()      — weighted accuracy + evenness
 *   scoreColor()          — heat-map colour from a composite score
 */


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionRecord {
  key: string;
  progression: string;
  mode?: string;           // legacy field — no longer used for grouping
  exerciseIndex?: number;  // 0–3 variant; optional
  accuracy: number;        // 0–100
  evenness: number | null; // 0–100; null for fixed-velocity input (on-screen taps)
  rhythm: number | null;   // 0–100 inter-note timing consistency
  errors: number;          // count of wrong note presses this run
  timestamp: number;       // UTC ms
}

export interface KeyModeMetrics {
  composite: number;       // 0–100 weighted score
  accuracy: number;        // 0–100
  evenness: number | null; // 0–100 or null
  rhythm: number | null;   // 0–100 or null
  avgErrors: number;       // average errors per run
  sessionCount: number;
}

export interface ProgressionMetrics {
  id: string;
  name: string;
  metrics: KeyModeMetrics | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'jsr.progress';
const MAX_SESSIONS_PER_BUCKET = 20;

export const PROGRESSION_DEFS: Array<{ id: string; name: string }> = [
  { id: 'blues',      name: 'Blues'      },
  { id: '50s',        name: '50s'        },
  { id: 'pop',        name: 'Pop'        },
  { id: 'circle',     name: 'Circle'     },
  { id: 'minor-feel', name: 'Minor Feel' },
];

export const KEYS_ORDERED = [
  'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F',
] as const;

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

/**
 * Compute evenness (0–100) from a list of MIDI velocities.
 * Returns null when:
 *   - fewer than 4 samples (insufficient data)
 *   - all values are identical (fixed-velocity input — on-screen taps)
 */
export function computeEvenness(velocities: number[]): number | null {
  if (velocities.length < 4) return null;
  const allSame = velocities.every(v => v === velocities[0]);
  if (allSame) return null;
  const mean = velocities.reduce((a, b) => a + b, 0) / velocities.length;
  if (mean === 0) return null;
  const variance =
    velocities.reduce((a, v) => a + (v - mean) ** 2, 0) / velocities.length;
  const cv = (Math.sqrt(variance) / mean) * 100;
  return Math.max(0, 100 - Math.min(cv, 100));
}

/**
 * Weighted composite score (mirrors jsp-ipad weights):
 *   Accuracy 40% + Rhythm 35% + Evenness 25%
 * Weights are redistributed when a metric is unavailable.
 */
export function compositeScore(
  accuracy: number,
  evenness: number | null,
  rhythm: number | null,
): number {
  let weighted = accuracy * 40;
  let weight   = 40;
  if (evenness !== null) { weighted += evenness * 25; weight += 25; }
  if (rhythm   !== null) { weighted += rhythm   * 35; weight += 35; }
  return weighted / weight;
}

/**
 * Compute rhythm consistency (0–100) from a list of note timestamps (ms).
 * Returns null when fewer than 4 samples are available.
 * Measures inter-note interval coefficient of variation:
 * a perfectly steady pace scores 100; an erratic pace scores low.
 */
export function computeRhythm(timestamps: number[]): number | null {
  if (timestamps.length < 4) return null;
  const intervals: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    intervals.push(timestamps[i] - timestamps[i - 1]);
  }
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  if (mean === 0) return null;
  const variance =
    intervals.reduce((a, v) => a + (v - mean) ** 2, 0) / intervals.length;
  const cv = (Math.sqrt(variance) / mean) * 100;
  return Math.max(0, 100 - Math.min(cv, 100));
}

/** Heat-map colour for a composite score (or null = no data). */
export function scoreColor(score: number | null): string {
  if (score === null) return '#374151'; // grey-700 — no data
  if (score < 50)    return '#ef4444'; // red-500
  if (score < 70)    return '#f59e0b'; // amber-500
  if (score < 85)    return '#86efac'; // green-300 — developing
  return '#22c55e';                    // green-500 — strong
}

// ---------------------------------------------------------------------------
// Storage primitives
// ---------------------------------------------------------------------------

function loadSessions(): SessionRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SessionRecord[]) : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: SessionRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

// ---------------------------------------------------------------------------
// Internal aggregation
// ---------------------------------------------------------------------------

function aggregateMetrics(sessions: SessionRecord[]): KeyModeMetrics | null {
  if (sessions.length === 0) return null;
  const avgAcc = sessions.reduce((a, s) => a + s.accuracy, 0) / sessions.length;
  const avgErr = sessions.reduce((a, s) => a + (s.errors ?? 0), 0) / sessions.length;

  const evSess = sessions.filter(s => s.evenness !== null);
  const avgEv  = evSess.length > 0
    ? evSess.reduce((a, s) => a + (s.evenness ?? 0), 0) / evSess.length
    : null;

  const rhSess = sessions.filter(s => s.rhythm !== null && s.rhythm !== undefined);
  const avgRh  = rhSess.length > 0
    ? rhSess.reduce((a, s) => a + (s.rhythm ?? 0), 0) / rhSess.length
    : null;

  return {
    composite:    compositeScore(avgAcc, avgEv, avgRh),
    accuracy:     avgAcc,
    evenness:     avgEv,
    rhythm:       avgRh,
    avgErrors:    avgErr,
    sessionCount: sessions.length,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Save a completed exercise session. */
export function recordSession(
  record: Omit<SessionRecord, 'timestamp'>,
): void {
  const all = loadSessions();
  all.push({ ...record, timestamp: Date.now() });

  // Keep the most recent MAX_SESSIONS_PER_BUCKET entries per key.
  const buckets = new Map<string, SessionRecord[]>();
  for (const s of all) {
    if (!buckets.has(s.key)) buckets.set(s.key, []);
    buckets.get(s.key)!.push(s);
  }

  const trimmed: SessionRecord[] = [];
  for (const recs of buckets.values()) {
    recs.sort((a, b) => b.timestamp - a.timestamp);
    trimmed.push(...recs.slice(0, MAX_SESSIONS_PER_BUCKET));
  }
  saveSessions(trimmed);
}

/** Aggregated metrics for a single key. */
export function getKeyMetrics(key: string): KeyModeMetrics | null {
  return aggregateMetrics(loadSessions().filter(s => s.key === key));
}

/**
 * All-keys aggregated metrics for the heat-map grid.
 * Loads localStorage once for efficiency.
 */
export function getAllMetrics(): Map<string, KeyModeMetrics | null> {
  const sessions = loadSessions();
  const result   = new Map<string, KeyModeMetrics | null>();
  for (const key of KEYS_ORDERED) {
    result.set(key, aggregateMetrics(sessions.filter(s => s.key === key)));
  }
  return result;
}

/** Per-progression breakdown for the drill-down detail view. */
export function getProgressionMetrics(key: string): ProgressionMetrics[] {
  const sessions = loadSessions().filter(s => s.key === key);
  return PROGRESSION_DEFS.map(({ id, name }) => ({
    id,
    name,
    metrics: aggregateMetrics(sessions.filter(s => s.progression === id)),
  }));
}

/** Erase all stored progress data. */
export function clearProgress(): void {
  localStorage.removeItem(STORAGE_KEY);
}
