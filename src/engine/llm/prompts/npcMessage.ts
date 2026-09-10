/**
 * NPC-initiated outreach: a text message or call opener from an NPC to the player.
 */
import type { ContentCatalog } from '../../content/types';
import { ageAt, formatClock, formatDate } from '../../core/clock';
import type { Sim, WorldState } from '../../core/types';
import { bigFiveWords, relationshipLabel, titleWords } from '../context';
import { relevantMemories } from '../memory';

export function system(): string {
  return `You write what an NPC in The Simisium (a realistic present-day American life simulation) says when THEY reach out to the player by phone. You are that person, in their own voice, with their own reasons.
Rules: one message, 1–3 sentences, the way real people text or open a call: casual, specific, sometimes abrupt or oddly timed. Reflect the relationship exactly (a coworker is not a best friend; an ex is loaded; a boss is a boss). Use only what they actually know about the player. Reference a shared memory when natural. No emojis unless the person is the type. No stage directions, no quotes, no explanation.
Return ONE JSON object: { "text": string, "emotion": string }. No prose outside the JSON.`;
}

export function user(state: WorldState, from: Sim, to: Sim, reason: string, content: ContentCatalog, channel: 'text' | 'phone' = 'text'): string {
  const now = state.time.minute;
  const rel = from.relationships[to.id];
  const mems = relevantMemories(from, to.id, 5).map((m) => m.text);
  const thread = (to.phone.threads[from.id] ?? []).slice(-4).map((t) => `${t.from === from.id ? from.identity.firstName : to.identity.firstName}: ${t.text}`);
  const job = from.career.job;
  const lines = [
    `Channel: ${channel === 'phone' ? 'phone call (what they say when the player picks up)' : 'text message'}`,
    `When: ${formatDate(state.epoch, now, { short: true })}, ${formatClock(now)}`,
    `From: ${from.identity.firstName} ${from.identity.lastName}, ${ageAt(from.identity.birthDate, state.epoch, now)}, ${from.identity.pronouns}; ${job ? `${job.title} at ${job.employerName}` : from.role ? `${from.role.title ?? titleWords(from.role.role)}` : 'no job'}`,
    `Personality: ${bigFiveWords(from)}; traits: ${from.personality.traits.map((t) => content.traits[t]?.name ?? titleWords(t)).join(', ') || 'none notable'}; speech: ${from.personality.speechStyle}`,
    `Mood: ${from.mind.dominantEmotion}, stress ${Math.round(from.mind.stress)}`,
    from.bio.summary ? `Bio: ${from.bio.summary}` : undefined,
    `To: ${to.identity.firstName} ${to.identity.lastName} (the player)`,
    `Relationship from ${from.identity.firstName}'s side: ${relationshipLabel(rel, to)}${rel ? `; friendship ${Math.round(rel.friendship)}, romance ${Math.round(rel.romance)}, trust ${Math.round(rel.trust)}, familiarity ${Math.round(rel.familiarity)}` : ''}${rel?.grudges.length ? `; grudge: ${rel.grudges[0].text}` : ''}${rel?.promises.some((p) => p.kept === undefined) ? `; open promise: ${rel.promises.find((p) => p.kept === undefined)!.text}` : ''}${rel?.moneyOwed ? `; money owed: ${rel.moneyOwed > 0 ? `${to.identity.firstName} owes ${from.identity.firstName}` : `${from.identity.firstName} owes ${to.identity.firstName}`} $${Math.abs(rel.moneyOwed).toFixed(0)}` : ''}`,
    mems.length ? `Memories of ${to.identity.firstName}:\n- ${mems.join('\n- ')}` : undefined,
    thread.length ? `Recent thread:\n${thread.join('\n')}` : undefined,
    `Reason for reaching out: ${reason}`,
  ].filter(Boolean);
  return `${lines.join('\n')}\n\nWrite the message. JSON only.`;
}
