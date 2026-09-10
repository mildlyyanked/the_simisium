/**
 * Hidden-biography prompt: produce a consistent summary + 16–22 specific facts for an NPC.
 */
import type { ContentCatalog } from '../../content/types';
import { ageAt } from '../../core/clock';
import type { Sim, WorldState } from '../../core/types';
import { bigFiveWords, titleWords } from '../context';
import { BIO_CATEGORIES } from '../schemas';

export function system(): string {
  return `You write hidden biographies for characters in The Simisium, a realistic life simulation of present-day America. The biography is ground truth that the character will later carry into every conversation, so it must be specific, internally consistent, and plausible for a real person of this age, job and place.

Rules:
- Third person. The summary is 120–200 words: who they are, where they came from, what their days look like, what they want and what they hide. Plain, observant prose; no clichés, no "hidden depths", no moralizing.
- Produce 16–22 facts. Each fact is one or two sentences, concrete and checkable: names of people and places, years, ages, amounts, brands, street names, specific incidents. "Loves music" is not a fact; "Saw Turnstile at Mohawk in 2023 and still has the wristband on her rear-view mirror" is.
- Spread facts across categories: origin, family, childhood, education, career, romance, health, money, hobby, belief, fear, dream, habit, quirk, relationship, trauma, achievement, daily_life, opinion, secret. No more than three in any one category. Include at least one each of family, career (or school, for students), money, romance, and daily_life.
- About 30% of facts are secrets (secret: true): things they would only tell someone they trust: a debt, a past arrest, an affair, an estrangement, a diagnosis, a quiet shame, a lie they keep telling. Secrets get depth 60–95. Ordinary facts get depth by intimacy: small talk 5–20 (hometown, job, pets, favorite team), personal 25–45 (family details, past relationships, money worries), intimate 45–60 (fears, regrets, health).
- Hard consistency: ages and years must add up (a 24-year-old cannot have a 20-year career or a 15-year-old child). Names of relatives given to you are fixed; do not rename them, and do not contradict any provided facts. Job and role are fixed. Hometown and region are fixed. Present-day is the year given; use real-feeling but non-famous places and non-famous people.
- Make them a person, not a type: contradictions of character are fine (a frugal person with one expensive habit); contradictions of fact are not.
- Vary tone across characters; not everyone is wounded, not everyone is happy. Most people are mostly fine and a little stuck.

Return ONE JSON object:
{ "summary": string, "facts": [{ "category": one of ${BIO_CATEGORIES.map((c) => `"${c}"`).join('|')}, "text": string, "secret": boolean, "depth": number }] }
No prose outside the JSON.`;
}

export function user(state: WorldState, sim: Sim, content: ContentCatalog): string {
  const age = ageAt(sim.identity.birthDate, state.epoch, state.time.minute);
  const year = Number(state.epoch.slice(0, 4));
  const traits = sim.personality.traits.map((t) => content.traits[t]?.name ?? titleWords(t));
  const hobbies = sim.hobbies.map((h) => content.hobbies[h]?.name ?? titleWords(h));
  const job = sim.career.job;
  const roleVenue = sim.role?.venueId ? state.venues[sim.role.venueId] : undefined;
  const employer = job ? `${job.title} at ${job.employerName}${job.hourlyRate ? ` (~$${job.hourlyRate}/hr)` : job.annualSalary ? ` (~$${Math.round(job.annualSalary / 1000)}k/yr)` : ''}` : sim.role ? `${sim.role.title ?? titleWords(sim.role.role)}${roleVenue ? ` at ${roleVenue.name}` : ''}` : sim.career.retired ? 'retired' : age < 18 ? 'student' : 'currently unemployed';
  const family = Object.values(sim.relationships)
    .filter((r) => r.flags.some((f) => ['parent', 'child', 'sibling', 'married', 'partner', 'engaged', 'ex', 'divorced', 'grandparent', 'grandchild', 'roommate'].includes(f)))
    .map((r) => {
      const o = state.sims[r.simId];
      if (!o) return undefined;
      const oAge = ageAt(o.identity.birthDate, state.epoch, state.time.minute);
      return `${r.flags.filter((f) => f !== 'acquaintance').map((f) => f.replace(/_/g, ' ')).join('/')}: ${o.identity.firstName} ${o.identity.lastName}, ${oAge}`;
    })
    .filter(Boolean);
  const hh = sim.householdId ? state.households[sim.householdId] : undefined;
  const home = hh ? state.venues[hh.homeVenueId] : undefined;
  const p = sim.personality;
  const lines = [
    `Name: ${sim.identity.firstName} ${sim.identity.lastName}${sim.identity.nickname ? ` ("${sim.identity.nickname}")` : ''}`,
    `Age: ${age} (born ${sim.identity.birthDate}); present year ${year}`,
    `Gender: ${sim.identity.gender} (${sim.identity.pronouns}); heritage: ${sim.identity.heritage}`,
    `Hometown: ${sim.identity.hometown === 'here' ? `${state.region.name}, ${state.region.state} (local)` : sim.identity.hometown}`,
    `Lives in: ${state.region.name}, ${state.region.state}${home ? `; home: ${home.residence ? `${home.residence.tenure === 'rent' ? 'rents' : home.residence.tenure === 'own' ? 'owns' : 'lives in'} a ${home.residence.bedrooms}-bed ${home.residence.kind}` : home.name}` : ''}`,
    `Local culture: ${state.region.culture}`,
    `Occupation: ${employer}`,
    sim.education.highestLevel !== 'none' ? `Education: ${titleWords(sim.education.highestLevel)}${sim.education.degrees.length ? ` (${sim.education.degrees.map((d) => `${d.field}, ${d.institution}`).join('; ')})` : ''}` : undefined,
    `Personality: ${bigFiveWords(sim)}; humor ${p.humor.toFixed(1)}, honesty ${p.honesty.toFixed(1)}, ambition ${p.ambition.toFixed(1)}, risk tolerance ${p.riskTolerance.toFixed(1)}`,
    traits.length ? `Traits: ${traits.join(', ')}` : undefined,
    `Values most: ${Object.entries(p.values).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k).join(', ')}; politics ${p.politics}; ${p.religion ? `religion ${p.religion}` : 'religion unspecified'}; sexuality ${p.sexuality}`,
    `Speech style: ${p.speechStyle}`,
    hobbies.length ? `Hobbies: ${hobbies.join(', ')}` : undefined,
    `Appearance: ${sim.identity.appearance.hair} hair, ${sim.identity.appearance.eyes} eyes, ${sim.identity.appearance.build} build, ${sim.identity.appearance.style} style${sim.identity.appearance.distinguishing.length ? `; ${sim.identity.appearance.distinguishing.join(', ')}` : ''}`,
    sim.body.illnesses.some((i) => i.chronic) ? `Chronic conditions: ${sim.body.illnesses.filter((i) => i.chronic).map((i) => i.name).join(', ')}` : undefined,
    family.length ? `Known relatives (fixed; use these names): ${family.join('; ')}` : 'Known relatives: none recorded (invent them, consistent with age)',
    sim.bio.facts.length ? `Existing facts (fixed; do not contradict): ${sim.bio.facts.map((f) => f.text).join(' | ')}` : undefined,
    `Seed: ${sim.bio.seed}`,
  ].filter(Boolean);
  return `${lines.join('\n')}

Write the biography. JSON only.`;
}
