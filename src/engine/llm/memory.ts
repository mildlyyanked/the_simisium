/**
 * Memory helpers for NPC consistency: pick the memories that matter for a scene, and
 * compact long memory lists into a single summary memory via the summarizer.
 */
import type { Memory, Sim, SimId } from '../core/types';

/** Memories involving `otherId`, most salient first (recency breaks ties). */
export function relevantMemories(sim: Sim, otherId: SimId, limit = 8): Memory[] {
  const involved = sim.memory.filter((m) => m.participants.includes(otherId));
  involved.sort((a, b) => b.salience - a.salience || b.at - a.at);
  return involved.slice(0, Math.max(0, limit));
}

/** Most recent memories overall (any participant). */
export function recentMemories(sim: Sim, limit = 3): Memory[] {
  return [...sim.memory].sort((a, b) => b.at - a.at).slice(0, Math.max(0, limit));
}

export const MEMORY_COMPACT_THRESHOLD = 120;
export const MEMORY_COMPACT_BATCH = 60;

/**
 * When a sim holds more than `threshold` memories, summarize the `batch` least salient
 * (excluding existing summaries) into one first-person `summary` memory. Returns true if compacted.
 */
export async function compactMemoriesIfNeeded(
  sim: Sim,
  summarizer: (sim: Sim, texts: string[]) => Promise<string>,
  opts: { threshold?: number; batch?: number; now?: number; id?: () => string } = {},
): Promise<boolean> {
  const threshold = opts.threshold ?? MEMORY_COMPACT_THRESHOLD;
  const batch = opts.batch ?? MEMORY_COMPACT_BATCH;
  if (sim.memory.length <= threshold) return false;
  const candidates = sim.memory.filter((m) => m.kind !== 'summary').sort((a, b) => a.salience - b.salience || a.at - b.at).slice(0, batch);
  if (candidates.length < 2) return false;
  const texts = [...candidates].sort((a, b) => a.at - b.at).map((m) => m.text);
  let summary: string;
  try {
    summary = (await summarizer(sim, texts)).trim();
  } catch {
    return false;
  }
  if (!summary) return false;
  const ids = new Set(candidates.map((m) => m.id));
  const participants = [...new Set(candidates.flatMap((m) => m.participants))];
  const salience = Math.min(100, Math.max(30, Math.round(Math.max(...candidates.map((m) => m.salience)) + 5)));
  const valence = candidates.reduce((s, m) => s + m.valence, 0) / candidates.length;
  const at = opts.now ?? Math.max(...candidates.map((m) => m.at));
  const id = opts.id ? opts.id() : `mem_sum_${at.toString(36)}_${sim.memory.length.toString(36)}`;
  sim.memory = sim.memory.filter((m) => !ids.has(m.id));
  sim.memory.push({ id, kind: 'summary', at, text: summary.slice(0, 600), participants, salience, valence: Math.round(valence * 100) / 100, tags: ['summary'] });
  return true;
}
