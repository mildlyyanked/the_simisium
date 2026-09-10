/**
 * Weekly story direction: 2–4 story beats scheduled as events, never contradicting state.
 */
import type { ContentCatalog } from '../../content/types';
import { ageAt, formatDate } from '../../core/clock';
import { liquidCash } from '../../core/effects';
import type { Sim, WorldState } from '../../core/types';
import { relationshipLabel, titleWords } from '../context';

export function system(): string {
  return `You are the story director for The Simisium, a hardcore, realistic life simulation of present-day America. Once a week you look at a player's situation and plant 2–4 story beats: things that will happen to them in the coming week that arise naturally from their life: their job, money, relationships, aspirations, habits, neighborhood and the calendar.

Rules:
- Beats must grow out of the state you are given. Never contradict it (no dead relatives calling, no bosses if they are unemployed, no car trouble without a car). Use the real names and ids given.
- Realistic scale: an unexpected bill, a coworker asking for a favor, an ex texting, a landlord notice, a friend's birthday party invite, a jury summons, a neighbor's complaint, a small opportunity (a gig, a class, a lead on a better job), a health scare, a lucky break of modest size. Money amounts must be plausible for the person's finances. No lottery wins, no long-lost inheritances, no kidnappings.
- Mix pressure and opportunity. At least one beat should push on the player's current aspiration or its biggest obstacle. At least one should involve a specific existing relationship.
- Spread them over the week: inMinutes between 120 and 10080, mostly at waking hours.
- Each beat: a short label (≤ 8 words), a text (1–3 sentences, second person, present tense, as it lands on the player), and optionally 2–3 options: short things the player might do about it. Options are suggestions, not the only choices.
- kind is always "story_beat". simId is the affected player sim id.

Return ONE JSON object: { "beats": [{ "label": string, "simId": string, "inMinutes": number, "kind": "story_beat", "payload": { "text": string, "options": [string] } }] }. No prose outside the JSON.`;
}

export function user(state: WorldState, content: ContentCatalog): string {
  const now = state.time.minute;
  const sims = state.player.controlledSimIds.map((id) => state.sims[id]).filter((s): s is Sim => !!s);
  const blocks = sims.map((sim) => {
    const age = ageAt(sim.identity.birthDate, state.epoch, now);
    const job = sim.career.job;
    const rels = Object.values(sim.relationships)
      .map((r) => ({ r, o: state.sims[r.simId] }))
      .filter((x) => x.o)
      .sort((a, b) => Math.abs(b.r.friendship) + Math.abs(b.r.romance) - (Math.abs(a.r.friendship) + Math.abs(a.r.romance)))
      .slice(0, 8)
      .map(({ r, o }) => `${o!.identity.firstName} ${o!.identity.lastName} (id ${o!.id}): ${relationshipLabel(r, sim)}; friendship ${Math.round(r.friendship)}, romance ${Math.round(r.romance)}, trust ${Math.round(r.trust)}${r.grudges.length ? `; grudge: ${r.grudges[0].text}` : ''}${r.promises.some((p) => p.kept === undefined) ? `; open promise: ${r.promises.find((p) => p.kept === undefined)!.text}` : ''}`);
    const bills = sim.finance.bills.slice(0, 6).map((b) => `${b.name} $${b.amount} on the ${b.dueDayOfMonth}${b.missed ? ` (missed ${b.missed})` : ''}`);
    const loans = sim.finance.loans.map((l) => `${l.kind} loan $${Math.round(l.balance)} ($${Math.round(l.monthlyPayment)}/mo${l.missedPayments ? `, ${l.missedPayments} missed` : ''})`);
    const hh = sim.householdId ? state.households[sim.householdId] : undefined;
    const home = hh ? state.venues[hh.homeVenueId] : undefined;
    const vehicles = hh ? hh.vehicleIds.map((v) => state.vehicles[v]).filter(Boolean).map((v) => `${v!.year} ${v!.make} ${v!.model} (${v!.condition}/100 condition)`) : [];
    const pets = hh ? hh.petIds.map((p) => state.pets[p]).filter(Boolean).map((p) => `${p!.name} the ${p!.breed}`) : [];
    return [
      `### ${sim.identity.firstName} ${sim.identity.lastName} (id ${sim.id}), ${age}, ${sim.identity.gender}`,
      `- Traits: ${sim.personality.traits.map((t) => content.traits[t]?.name ?? titleWords(t)).join(', ') || 'none notable'}`,
      `- Work: ${job ? `${job.title} at ${job.employerName}, performance ${Math.round(job.performance)}/100, ${job.warnings} warnings` : sim.education.enrollment ? `student, ${sim.education.enrollment.program}` : 'unemployed'}`,
      `- Money: ~$${Math.round(liquidCash(sim))} liquid; credit score ${sim.finance.creditScore}${bills.length ? `; bills: ${bills.join(', ')}` : ''}${loans.length ? `; ${loans.join(', ')}` : ''}`,
      `- Home: ${home ? `${home.name}${home.residence ? ` (${home.residence.tenure}, $${home.residence.monthlyRent ?? 0}/mo)` : ''}` : 'none'}${vehicles.length ? `; vehicles: ${vehicles.join(', ')}` : '; no vehicle'}${pets.length ? `; pets: ${pets.join(', ')}` : ''}`,
      `- Health: ${Math.round(sim.body.health)}/100; stress ${Math.round(sim.mind.stress)}; mood ${Math.round(sim.mind.mood)}${sim.body.illnesses.length ? `; ill: ${sim.body.illnesses.map((i) => i.name).join(', ')}` : ''}`,
      `- Legal: ${sim.legal.charges.filter((c) => c.status === 'pending').length} pending charges; heat ${sim.legal.heat}; license ${sim.legal.license.status}`,
      `- Aspirations: ${sim.aspirations.filter((a) => !a.completed).map((a) => `${a.text} (${a.progress}%)`).join('; ') || 'none set'}`,
      rels.length ? `- Relationships:\n  - ${rels.join('\n  - ')}` : '- Relationships: none yet',
    ].join('\n');
  });
  const upcoming = state.scheduled
    .filter((e) => e.visible && e.atMinute > now && e.atMinute < now + 10080)
    .slice(0, 10)
    .map((e) => `${formatDate(state.epoch, e.atMinute, { short: true })}: ${e.label}`);
  const recent = state.log
    .filter((l) => l.importance >= 2)
    .slice(-15)
    .map((l) => l.text);
  return `Date: ${formatDate(state.epoch, now)}; ${state.region.name}, ${state.region.state}. ${state.region.culture}
Economy: gas $${state.economy.gasPrice.toFixed(2)}, job market ${state.economy.jobMarketHeat >= 0.6 ? 'hot' : state.economy.jobMarketHeat >= 0.4 ? 'normal' : 'cold'}, unemployment ${(state.economy.unemploymentRate * 100).toFixed(1)}%

${blocks.join('\n\n')}

Already scheduled this week:
${upcoming.length ? upcoming.map((u) => `- ${u}`).join('\n') : '- nothing notable'}

Notable recent events:
${recent.length ? recent.map((r) => `- ${r}`).join('\n') : '- a quiet stretch'}

Plant 2–4 story beats for the coming week. JSON only.`;
}
