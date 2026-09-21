/**
 * Dilemma prompt: the model writes one hard choice with a clock, grounded in this sim's actual
 * life, with consequences encoded as bounded effects the engine will validate and store.
 */
import type { ContentCatalog } from '../../content/types';
import type { Sim, WorldState } from '../../core/types';
import { formatMoney } from '../../core/util';
import { activeNews } from '../../systems/story';
import { CORE_PRINCIPLES } from './common';

export function system(): string {
  return `${CORE_PRINCIPLES}

## This task: write one hard choice with a clock
You are the story editor. From the life below, write ONE dilemma this person faces now: a real trade-off with no clean answer, where each option costs something and buys something, and where the world will remember the choice. It must grow out of THIS life: the people listed (by id), their open promises, grudges and history, the money situation, the job, the home, this week's news, and choices already made (the flags). Ordinary American present-day realism. Never fantasy or melodrama; the best dilemmas are small and specific (a friend, a boss, a landlord, a parent, a coworker, a neighbor, a bill, a car, a dog, a lease, a favor, a secret).

Rules:
- 2 or 3 options. Each must be tempting to someone. No "obviously right" option. No option that is free.
- "narration": 1–3 sentences in second person, present tense, of what happens the moment they choose.
- "effects": the PLAYER's costs and gains, as deltas. Money only when the choice really moves money, and within a fraction of what they have. Needs, stress, moodlets and skills are small. Use "memories" for a durable player-side memory.
- "otherEffects": how the people involved change toward the player: relationships[{ simId: <playerId>, friendship, trust, romance, familiarity }] and a first-person "memories" entry from THEIR point of view. Use ONLY sim ids from the life below.
- "flags": 0–2 short snake_case tags for what this decision makes true (e.g. "lied_for_coworker", "lent_money_to_<firstname>"), for later stories to build on.
- "followUps": 1–2 per option: things that happen days or weeks later because of the choice ("inDays" 2–45, "chance" 0.3–1.0, "text" in second person, optional effects/otherEffects). At least one option must have a follow-up with real teeth.
- "deadlineHours": 6–96, realistic for the situation.
- "defaultOptionId": what happens if they never decide (usually the passive or worst option; may be a fourth, unlisted consequence — if so add it as an option with id "default").
- Do not repeat any dilemma in "Already faced". Vary theme, tone and stakes.

Return ONE JSON object:
{
  "title": string (≤ 60 chars),
  "body": string (2–4 sentences, the situation, second person),
  "deadlineHours": number,
  "defaultOptionId": string,
  "options": [{ "id": string, "label": string (≤ 40 chars), "hint": string (≤ 60 chars, the honest cost), "narration": string, "effects": EffectBundle, "otherEffects": { "<simId>": EffectBundle }, "flags": [string], "followUps": [{ "inDays": number, "chance": number, "text": string, "effects": EffectBundle, "otherEffects": { "<simId>": EffectBundle } }] }]
}
EffectBundle: { "needs": {...}, "money": { "amount": number, "memo": string, "counterparty": string }, "skills": {...}, "moodlets": [{ "emotion": string, "label": string, "intensity": -30..30, "durationMinutes": number }], "stress": number, "health": number, "relationships": [{ "simId": string, "friendship": n, "trust": n, "romance": n, "familiarity": n, "mutual": false }], "memories": [{ "kind": "event"|"promise"|"conflict"|"milestone", "text": string }], "legal": [{ "kind": "heat", "delta": number }], "schedule": [] }
Emotions: happy, sad, angry, anxious, stressed, bored, energized, tired, inspired, flirty, embarrassed, confident, lonely, grateful, guilty, proud, jealous, grieving, scared, focused, playful, sick, uncomfortable, tense, relaxed, nostalgic, hopeful, in_love.`;
}

function ageOf(state: WorldState, sim: Sim): number {
  const birth = new Date(sim.identity.birthDate).getTime();
  const nowMs = new Date(state.epoch).getTime() + state.time.minute * 60_000;
  return Math.max(0, Math.floor((nowMs - birth) / (365.25 * 24 * 3600 * 1000)));
}

export function user(state: WorldState, sim: Sim, content: ContentCatalog, opts: { theme?: string; liquidCash: number } ): string {
  const L: string[] = [];
  const push = (s: string) => L.push(s);
  const now = state.time.minute;
  const days = (m: number) => Math.max(0, Math.floor((now - m) / 1440));
  const hh = sim.householdId ? state.households[sim.householdId] : undefined;
  const home = hh ? state.venues[hh.homeVenueId] : undefined;
  const job = sim.career.job;
  push(`## The person (playerId ${sim.id})`);
  push(`- ${sim.identity.firstName} ${sim.identity.lastName}, ${ageOf(state, sim)}, ${sim.identity.gender} (${sim.identity.pronouns}), ${sim.lifeStage.replace('_', ' ')}. Traits: ${sim.personality.traits.map((t) => content.traits[t]?.name ?? t).join(', ') || 'none'}.`);
  push(`- Lives: ${home ? `${home.name} (${home.residence?.tenure === 'rent' ? `renting, ${formatMoney(home.residence.monthlyRent ?? 0)}/mo` : home.residence?.tenure ?? 'unknown'})` : 'unknown'}${hh && hh.simIds.length > 1 ? `, with ${hh.simIds.filter((m) => m !== sim.id).map((m) => state.sims[m]?.identity.firstName).filter(Boolean).join(', ')}` : ', alone'}. City: ${state.region.name}, ${state.region.stateCode}.`);
  push(`- Money: ${formatMoney(opts.liquidCash)} liquid; credit ${sim.finance.creditScore}; loans ${sim.finance.loans.length ? sim.finance.loans.map((l) => `${l.kind} ${formatMoney(l.balance)}`).join(', ') : 'none'}.`);
  push(`- Work: ${job ? `${job.title} at ${job.employerName}, performance ${Math.round(job.performance)}/100, ${job.hourlyRate ? `${formatMoney(job.hourlyRate)}/h` : job.annualSalary ? `${formatMoney(job.annualSalary)}/yr` : ''}${job.bossSimId ? `, boss ${state.sims[job.bossSimId]?.identity.firstName ?? ''} (${job.bossSimId})` : ''}` : sim.career.unemployment ? 'unemployed, on benefits' : 'no job'}.`);
  const car = (hh?.vehicleIds ?? []).map((id) => state.vehicles[id]).filter(Boolean);
  if (car.length) push(`- Vehicles: ${car.map((v) => `${v.year} ${v.make} ${v.model} (condition ${Math.round(v.condition)}/100${v.loan ? `, loan ${formatMoney(v.loan.balance)}` : ''})`).join('; ')}.`);
  if (sim.aspirations.length) push(`- Wants: ${sim.aspirations.filter((a) => !a.completed).map((a) => a.text).slice(0, 3).join('; ')}.`);
  push(`- Mood ${Math.round(sim.mind.mood)}, stress ${Math.round(sim.mind.stress)}; needs low: ${(Object.entries(sim.needs) as [string, number][]).filter(([, v]) => v < 40).map(([k]) => k).join(', ') || 'none'}.`);

  const rels = Object.values(sim.relationships)
    .map((r) => ({ r, s: state.sims[r.simId] }))
    .filter((x) => x.s && x.s.body.alive && (x.r.familiarity >= 8 || x.r.flags.length))
    .sort((a, b) => b.r.familiarity + Math.abs(b.r.friendship) - (a.r.familiarity + Math.abs(a.r.friendship)))
    .slice(0, 10);
  push('');
  push('## People in this life (use these ids)');
  for (const { r, s } of rels) {
    const role = s.career.job ? `${s.career.job.title} at ${s.career.job.employerName}` : s.lifeStage.replace('_', ' ');
    const bits = [`${s.identity.firstName} ${s.identity.lastName} (id ${s.id}), ${ageOf(state, s)}, ${role}; ${r.flags.join('/') || 'acquaintance'}; friendship ${Math.round(r.friendship)}, trust ${Math.round(r.trust)}, romance ${Math.round(r.romance)}, familiarity ${Math.round(r.familiarity)}`];
    if (r.moneyOwed) bits.push(`money: ${r.moneyOwed > 0 ? `they owe ${formatMoney(r.moneyOwed)}` : `owes them ${formatMoney(-r.moneyOwed)}`}`);
    const promises = r.promises.filter((p) => p.kept === undefined).map((p) => p.text).slice(0, 2);
    if (promises.length) bits.push(`open promises: ${promises.join('; ')}`);
    if (r.grudges.length) bits.push(`grudges: ${r.grudges.slice(-2).map((g) => g.text).join('; ')}`);
    if (r.milestones?.length) bits.push(`history: ${r.milestones.map((m) => `${m.id.replace(/_/g, ' ')} ${days(m.at)}d ago`).join(', ')}`);
    const theirs = s.relationships[sim.id];
    const mem = s.memory.filter((m) => m.participants.includes(sim.id)).sort((a, b) => b.salience - a.salience).slice(0, 2).map((m) => m.text);
    if (mem.length) bits.push(`what they remember: ${mem.join(' | ')}`);
    if (theirs && Math.abs(theirs.friendship - r.friendship) > 15) bits.push(`from their side friendship ${Math.round(theirs.friendship)}`);
    push(`- ${bits.join('; ')}`);
  }

  const past = (state.dilemmas ?? []).filter((d) => d.simId === sim.id && d.resolved).slice(-8);
  const flags = Object.keys(sim.flags).filter((k) => k.startsWith('dilemma:')).map((k) => k.replace(/^dilemma:/, '').replace(new RegExp(`:${sim.id}$`), ''));
  push('');
  push('## Already faced');
  if (past.length) for (const d of past) push(`- ${d.title} → ${d.options.find((o) => o.id === d.resolved!.optionId)?.label ?? d.resolved!.optionId}${d.resolved!.byDeadline ? ' (by not deciding)' : ''}, ${days(d.resolved!.at)}d ago`);
  else push('- nothing yet');
  if (flags.length) push(`- Flags: ${flags.join(', ')}`);

  const mem = sim.memory.slice(-6).map((m) => `${days(m.at)}d ago: ${m.text}`);
  if (mem.length) {
    push('');
    push('## Recent memories');
    for (const m of mem) push(`- ${m}`);
  }
  const recent = state.log.filter((l) => (l.simId === sim.id || !l.simId) && l.importance >= 2).slice(-8).map((l) => l.text.slice(0, 160));
  if (recent.length) {
    push('');
    push('## Recent journal');
    for (const r of recent) push(`- ${r}`);
  }
  const news = activeNews(state);
  if (news.length) {
    push('');
    push(`## In the news this week`);
    for (const n of news) push(`- ${n.headline}. ${n.body}`);
  }
  push('');
  push(`## Now: ${state.region.name}, day ${Math.floor(now / 1440) + 1}, ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(new Date(state.epoch).getTime() + now * 60_000).getUTCDay()]}. Weather: ${state.weather.current.condition.replace(/_/g, ' ')}, ${Math.round(state.weather.current.tempF)}°F.`);
  if (opts.theme) push(`Suggested theme (optional, only if it fits): ${opts.theme}`);
  push('');
  push('Write the dilemma. JSON only.');
  return L.join('\n');
}
