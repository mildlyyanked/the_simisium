/**
 * Memory compaction: many small memories → one first-person summary memory.
 */
import type { Sim } from '../../core/types';

export function system(): string {
  return `You compress a character's memories in The Simisium, a realistic life simulation. You are given a list of that character's memories in chronological order, each in their own first-person voice. Write ONE first-person summary (their voice, past tense, ≤ 120 words) that preserves everything that would still matter to them: names, promises made or broken, debts, grudges, kindnesses, romantic moves, embarrassments, and any concrete facts they learned about other people. Merge repetition. Drop mood-of-the-moment noise. Keep their attitude toward each person clear ("I still don't trust Marcus"). No preamble, no bullet points, no JSON. Plain text only.`;
}

export function user(sim: Sim, texts: string[]): string {
  const list = texts.map((t, i) => `${i + 1}. ${t.trim()}`).join('\n');
  return `I am ${sim.identity.firstName} ${sim.identity.lastName}, ${sim.identity.pronouns}. Speech style: ${sim.personality.speechStyle}.

My memories, oldest first:
${list}

Write the summary as me.`;
}
