/**
 * Skills system: slow decay of unused high-level skills, level-up moodlets, hobby sessions
 * as actions (running, yoga, reading, sketching, studying…), and taking up / dropping hobbies.
 *
 * Object-backed hobby practice (guitar, piano, easel, gaming console…) is provided by the
 * object's own interactions in content/objects.ts, so this system only contributes sessions
 * that need no object (or only a consumable item such as a notebook or a novel).
 *
 * Flag keys owned by this system (on `sim.flags`):
 *   skill:last:<skillId>   minute the skill last gained xp (decay timer)
 *   skills:lastDecayAt     minute of last decay pass for this sim
 * Reads: hobbies content, sim.hobbies.
 * Events consumed: sim:skill_up, effects:applied (skills xp), action:started (fitness category)
 * Action id prefixes handled: `skills:` and `hobby:`
 */
import type { GameEvent } from '../core/events';
import type { ActionResult, System, SystemContext } from '../core/systems';
import type { ActionDef, EffectBundle, Sim, SimId, Venue, VenueArchetype } from '../core/types';
import { DAY, HOUR, round2 } from '../core/util';

const MAX_HOBBIES = 6;
const DECAY_AFTER = 14 * DAY;
const DECAY_MIN_LEVEL = 3;

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const you = (ctx: SystemContext, sim: Sim): boolean => ctx.query.isControlled(sim.id);

const OUTDOOR: ReadonlySet<VenueArchetype> = new Set<VenueArchetype>(['park', 'trail', 'beach', 'sports_field', 'playground', 'golf']);

// ---------------------------------------------------------------------------
// Hobby sessions that need no object
// ---------------------------------------------------------------------------
interface SessionSpec {
  hobbyId: string;
  actionId: string;
  label: string;
  icon: string;
  category: ActionDef['category'];
  minutes: number;
  /** where it can be done: 'home' | 'outdoors' | archetypes | 'anywhere' */
  where: ('home' | 'outdoors' | 'anywhere' | VenueArchetype)[];
  /** consumable item required (not consumed) */
  item?: string;
  effects: EffectBundle;
  description: string;
  /** weather gating */
  outdoorsOnly?: boolean;
  seasonal?: boolean;
}

const SESSIONS: SessionSpec[] = [
  { hobbyId: 'running', actionId: 'hobby:run', label: 'Go for a run', icon: 'run', category: 'fitness', minutes: 30, where: ['home', 'outdoors', 'gym'], effects: { needs: { fun: 10, hygiene: -15, energy: -12, thirst: -10 }, skills: { athletics: 22, fitness: 12 }, fitness: 1.2, stress: -8 }, description: 'Thirty minutes at a steady pace.' },
  { hobbyId: 'cycling', actionId: 'hobby:ride', label: 'Go for a bike ride', icon: 'bike', category: 'fitness', minutes: 45, where: ['home', 'outdoors'], effects: { needs: { fun: 14, hygiene: -12, energy: -12, thirst: -10 }, skills: { athletics: 24, fitness: 10 }, fitness: 1.1, stress: -8 }, description: 'A loop around the neighborhood or the trail.' },
  { hobbyId: 'hiking', actionId: 'hobby:hike', label: 'Go for a hike', icon: 'mountain', category: 'fitness', minutes: 120, where: ['trail', 'park'], effects: { needs: { fun: 22, hygiene: -18, energy: -25, thirst: -18, social: 4 }, skills: { athletics: 30, fitness: 10, photography: 4 }, fitness: 0.9, stress: -14 }, description: 'Two hours on the trail.', outdoorsOnly: true },
  { hobbyId: 'yoga', actionId: 'hobby:yoga', label: 'Do some yoga', icon: 'lotus', category: 'fitness', minutes: 45, where: ['home', 'yoga', 'gym', 'park', 'community_center'], effects: { needs: { fun: 8, comfort: 10, energy: -5, hygiene: -5 }, skills: { fitness: 18 }, fitness: 0.6, stress: -15 }, description: 'Stretch and breathe for forty-five minutes.' },
  { hobbyId: 'gym', actionId: 'hobby:bodyweight', label: 'Bodyweight workout', icon: 'dumbbell', category: 'fitness', minutes: 30, where: ['home', 'outdoors'], effects: { needs: { fun: 6, hygiene: -14, energy: -14, thirst: -8 }, skills: { fitness: 22 }, fitness: 1.2, stress: -6 }, description: 'Push-ups, squats, planks. No equipment needed.' },
  { hobbyId: 'reading', actionId: 'hobby:read', label: 'Read a novel', icon: 'book', category: 'hobby', minutes: 60, where: ['anywhere'], item: 'book_novel', effects: { needs: { fun: 14, comfort: 4 }, skills: { research: 10, writing: 6 }, stress: -10 }, description: 'An hour with your book.' },
  { hobbyId: 'reading', actionId: 'hobby:read_library', label: 'Read at the library', icon: 'book', category: 'hobby', minutes: 60, where: ['library', 'bookstore'], effects: { needs: { fun: 12, comfort: 4 }, skills: { research: 12, writing: 5 }, stress: -10 }, description: 'Pull something off the shelf and settle in.' },
  { hobbyId: 'writing', actionId: 'hobby:write', label: 'Write in a notebook', icon: 'pen', category: 'hobby', minutes: 45, where: ['anywhere'], item: 'notebook', effects: { needs: { fun: 9 }, skills: { writing: 20, creativity: 8 }, stress: -7 }, description: 'Journal, story, or the novel. Pen on paper.' },
  { hobbyId: 'painting', actionId: 'hobby:sketch', label: 'Sketch in a notebook', icon: 'pencil', category: 'hobby', minutes: 40, where: ['anywhere'], item: 'notebook', effects: { needs: { fun: 12 }, skills: { painting: 18, creativity: 8 }, stress: -10 }, description: 'Draw whatever is in front of you.' },
  { hobbyId: 'photography', actionId: 'hobby:photo_walk', label: 'Go on a photo walk', icon: 'camera', category: 'hobby', minutes: 60, where: ['outdoors', 'museum', 'zoo', 'farmers_market', 'beach'], effects: { needs: { fun: 13, energy: -6, hygiene: -3 }, skills: { photography: 22, creativity: 6 }, fitness: 0.2, stress: -8 }, description: 'Chase light with your phone camera for an hour.' },
  { hobbyId: 'singing', actionId: 'hobby:sing', label: 'Sing', icon: 'mic', category: 'hobby', minutes: 20, where: ['home'], effects: { needs: { fun: 12 }, skills: { singing: 16, music: 6 }, stress: -8 }, description: 'Belt something out where nobody can hear you.' },
  { hobbyId: 'dancing', actionId: 'hobby:dance', label: 'Dance around the living room', icon: 'dance', category: 'hobby', minutes: 20, where: ['home'], effects: { needs: { fun: 14, energy: -6, hygiene: -6 }, skills: { dancing: 16 }, fitness: 0.5, stress: -9 }, description: 'Music on, blinds closed.' },
  { hobbyId: 'chess', actionId: 'hobby:chess_puzzles', label: 'Do chess puzzles on your phone', icon: 'crown', category: 'hobby', minutes: 30, where: ['anywhere'], effects: { needs: { fun: 8 }, skills: { logic: 16 }, stress: -3 }, description: 'Tactics training, one puzzle at a time.' },
  { hobbyId: 'birdwatching', actionId: 'hobby:birdwatch', label: 'Go birdwatching', icon: 'bird', category: 'hobby', minutes: 60, where: ['outdoors'], effects: { needs: { fun: 10, energy: -4 }, skills: { research: 12 }, fitness: 0.2, stress: -14 }, description: 'Binoculars up, phone down.', outdoorsOnly: true },
  { hobbyId: 'fishing', actionId: 'hobby:fish', label: 'Go fishing', icon: 'fish', category: 'hobby', minutes: 120, where: ['park', 'beach', 'trail'], effects: { needs: { fun: 14, social: 3, energy: -6, hygiene: -6 }, skills: { fishing: 30 }, stress: -16 }, description: 'A line in the water and nowhere to be.', outdoorsOnly: true },
  { hobbyId: 'basketball', actionId: 'hobby:pickup_basketball', label: 'Play pickup basketball', icon: 'basketball', category: 'fitness', minutes: 60, where: ['park', 'gym', 'sports_field', 'community_center', 'school'], effects: { needs: { fun: 18, social: 14, energy: -20, hygiene: -20, thirst: -15 }, skills: { athletics: 28, fitness: 10, charisma: 4 }, fitness: 1.3, stress: -8 }, description: 'Find a game at the court.' },
  { hobbyId: 'soccer', actionId: 'hobby:pickup_soccer', label: 'Play pickup soccer', icon: 'soccer', category: 'fitness', minutes: 60, where: ['park', 'sports_field', 'school', 'community_center'], effects: { needs: { fun: 18, social: 14, energy: -22, hygiene: -20, thirst: -15 }, skills: { athletics: 30, fitness: 10 }, fitness: 1.4, stress: -8 }, description: 'Jumpers for goalposts.' },
  { hobbyId: 'volunteering', actionId: 'hobby:volunteer', label: 'Volunteer for a couple hours', icon: 'hand-heart', category: 'civic', minutes: 120, where: ['shelter', 'church', 'community_center', 'senior_center', 'library', 'park', 'school'], effects: { needs: { fun: 8, social: 16, energy: -10 }, skills: { charisma: 12, parenting: 4 }, stress: -6, moodlets: [{ emotion: 'proud', label: 'Did some good', intensity: 8, durationMinutes: 8 * HOUR }] }, description: 'Sort donations, serve meals, pick up litter.' },
  { hobbyId: 'knitting', actionId: 'hobby:knit', label: 'Knit for a while', icon: 'yarn', category: 'hobby', minutes: 45, where: ['home', 'cafe', 'library', 'senior_center'], effects: { needs: { fun: 9, comfort: 4 }, skills: { crafting: 18 }, stress: -12 }, description: 'Row after row. Very calming.' },
  { hobbyId: 'podcasting', actionId: 'hobby:podcast', label: 'Record a podcast episode', icon: 'radio', category: 'hobby', minutes: 60, where: ['home', 'coworking'], effects: { needs: { fun: 10, social: 6 }, skills: { charisma: 18, comedy: 6 }, stress: -3 }, description: 'Talk into a mic about your thing.' },
  { hobbyId: 'thrifting', actionId: 'hobby:thrift', label: 'Browse the racks', icon: 'shirt', category: 'shop', minutes: 45, where: ['thrift_store', 'farmers_market', 'mall'], effects: { needs: { fun: 14, energy: -4 }, skills: { negotiation: 8 }, stress: -6 }, description: 'Hunt for the perfect find.' },
  { hobbyId: 'collecting', actionId: 'hobby:collect', label: 'Hunt for the collection', icon: 'package', category: 'shop', minutes: 45, where: ['thrift_store', 'farmers_market', 'bookstore', 'mall'], effects: { needs: { fun: 12 }, skills: { research: 8 }, stress: -6 }, description: 'Records, cards, whatever you collect.' },
];

const STUDY: SessionSpec = { hobbyId: '', actionId: 'skills:study_spanish', label: 'Study Spanish on an app', icon: 'globe', category: 'hobby', minutes: 30, where: ['anywhere'], effects: { needs: { fun: 3 }, skills: { spanish: 18 } }, description: 'Thirty minutes of flashcards and a cartoon owl.' };

function whereOk(ctx: SystemContext, sim: Sim, venue: Venue, spec: SessionSpec): boolean {
  const home = ctx.query.homeOf(sim.id);
  const isHome = (home && home.id === venue.id) || (venue.archetype === 'home' && venue.ownerHouseholdId === sim.householdId);
  const outdoors = OUTDOOR.has(venue.archetype);
  if (spec.outdoorsOnly) {
    const w = ctx.state.weather.current;
    if (w.condition === 'thunderstorm' || w.condition === 'heavy_rain' || w.condition === 'hurricane' || w.condition === 'tornado_watch' || w.tempF < 15) return false;
  }
  for (const w of spec.where) {
    if (w === 'anywhere') return true;
    if (w === 'home' && isHome) return true;
    if (w === 'outdoors' && outdoors) return true;
    if (w === venue.archetype) return true;
  }
  return false;
}

function sessionAction(ctx: SystemContext, sim: Sim, spec: SessionSpec, hobbyName: string): ActionDef {
  const reqs: ActionDef['requirements'] = [];
  if (spec.item) reqs.push({ kind: 'item', reason: `Need a ${spec.item.replace(/_/g, ' ')}`, params: { itemId: spec.item, qty: 1 } });
  if (spec.category === 'fitness') reqs.push({ kind: 'energy', reason: 'Too tired', params: { min: 15 } });
  const hobby = ctx.content.hobbies[spec.hobbyId];
  const cost = hobby && hobby.costPerSession > 0 && !['home', 'anywhere', 'outdoors'].some((w) => spec.where.includes(w as never)) ? round2(hobby.costPerSession * ctx.state.region.costOfLiving) : 0;
  if (cost > 0) reqs.push({ kind: 'money', reason: `Costs $${cost.toFixed(2)}`, params: { amount: cost } });
  return {
    id: spec.actionId,
    label: spec.label,
    description: spec.description,
    category: spec.category,
    icon: spec.icon,
    durationMinutes: spec.minutes,
    cost: cost > 0 ? { amount: cost, memo: `${spec.label} (${hobbyName})`, category: 'hobby' } : undefined,
    requirements: reqs,
    effects: spec.effects,
    satisfies: spec.category === 'fitness' ? ['fun'] : ['fun'],
    autonomyWeight: 0.6,
    interruptible: true,
    group: 'Hobbies',
    params: { hobbyId: spec.hobbyId },
  };
}

// ---------------------------------------------------------------------------
// Hobby suggestions
// ---------------------------------------------------------------------------
function hobbyAffinity(ctx: SystemContext, sim: Sim, hobbyId: string): number {
  const h = ctx.content.hobbies[hobbyId];
  if (!h) return 0;
  const p = sim.personality;
  const t = new Set(p.traits);
  let s = 1;
  if (h.fitness && h.fitness > 0.5) s += (t.has('active') ? 2 : 0) + (t.has('couch_potato') || t.has('lazy') ? -1.5 : 0) + p.values.health;
  if (h.social >= 10) s += (t.has('outgoing') || t.has('party_animal') ? 1.5 : 0) + (t.has('loner') ? -1.5 : 0) + p.extraversion;
  if (['painting', 'writing', 'photography', 'guitar', 'piano', 'singing', 'knitting', 'woodworking', 'podcasting'].includes(hobbyId)) s += (t.has('creative') ? 2 : 0) + p.values.creativity + p.openness * 0.5;
  if (['reading', 'chess', 'board_games', 'birdwatching', 'collecting'].includes(hobbyId)) s += (t.has('bookworm') || t.has('genius') || t.has('geek') ? 1.5 : 0) + p.values.knowledge;
  if (['gaming', 'streaming'].includes(hobbyId)) s += (t.has('geek') ? 2 : 0) + (t.has('couch_potato') ? 1 : 0);
  if (['cooking', 'baking'].includes(hobbyId)) s += (t.has('foodie') ? 2 : 0) + (t.has('homebody') ? 0.5 : 0);
  if (['hiking', 'camping', 'fishing', 'cycling'].includes(hobbyId)) s += (t.has('adventurous') ? 1.5 : 0) + p.values.adventure + (t.has('homebody') ? -1 : 0);
  if (hobbyId === 'volunteering') s += p.values.community * 2 + (t.has('kind') || t.has('generous') ? 1 : 0);
  if (hobbyId === 'gardening') s += (t.has('homebody') ? 1 : 0) + (t.has('spiritual') ? 0.5 : 0);
  if (['karaoke', 'dancing', 'bowling'].includes(hobbyId)) s += (t.has('party_animal') ? 1.5 : 0) + p.values.pleasure;
  if (hobbyId === 'thrifting') s += (t.has('frugal') ? 1.5 : 0) + (t.has('materialistic') ? -0.5 : 0);
  if (h.skillId && (sim.skills[h.skillId]?.level ?? 0) > 0) s += 0.5;
  return Math.max(0.05, s);
}

function suggestedHobbies(ctx: SystemContext, sim: Sim, n: number): string[] {
  const candidates = Object.keys(ctx.content.hobbies).filter((id) => !sim.hobbies.includes(id));
  if (!candidates.length) return [];
  // deterministic per sim per day (so the menu is stable across the day)
  const day = Math.floor(ctx.state.time.minute / DAY);
  const seed = ctx.rng.fork(`hobby:${sim.id}:${day}`);
  const scored = candidates.map((id) => ({ id, w: hobbyAffinity(ctx, sim, id) * (0.5 + seed.next()) }));
  scored.sort((a, b) => b.w - a.w);
  return scored.slice(0, n).map((x) => x.id);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function actionsFor(ctx: SystemContext, simId: SimId): ActionDef[] {
  const sim = ctx.query.simMaybe(simId);
  if (!sim || !sim.body.alive) return [];
  if (sim.lifeStage === 'infant' || sim.lifeStage === 'toddler') return [];
  const venue = ctx.query.venueMaybe(sim.location.venueId);
  if (!venue) return [];
  const out: ActionDef[] = [];
  const seen = new Set<string>();

  for (const hobbyId of sim.hobbies) {
    const h = ctx.content.hobbies[hobbyId];
    if (!h) continue;
    if (h.seasonal && !h.seasonal.includes(ctx.clock.season)) continue;
    for (const spec of SESSIONS) {
      if (spec.hobbyId !== hobbyId || seen.has(spec.actionId)) continue;
      if (!whereOk(ctx, sim, venue, spec)) continue;
      seen.add(spec.actionId);
      out.push(sessionAction(ctx, sim, spec, h.name));
    }
  }

  // studying Spanish is always available for anyone school-age and up (infants/toddlers returned early)
  out.push(sessionAction(ctx, sim, STUDY, 'Spanish'));

  // take up / drop hobbies (home only, keeps menus tidy elsewhere)
  const home = ctx.query.homeOf(sim.id);
  const atHome = home ? home.id === venue.id : venue.archetype === 'home';
  if (atHome) {
    if (sim.hobbies.length < MAX_HOBBIES) {
      for (const id of suggestedHobbies(ctx, sim, 4)) {
        const h = ctx.content.hobbies[id];
        out.push({ id: `hobby:take_up:${id}`, label: `Take up ${h.name.toLowerCase()}`, description: h.description, category: 'hobby', icon: h.icon, durationMinutes: 15, effects: {}, interruptible: true, group: 'New hobbies', params: { hobbyId: id } });
      }
    }
    for (const id of sim.hobbies) {
      const h = ctx.content.hobbies[id];
      if (!h) continue;
      out.push({ id: `hobby:drop:${id}`, label: `Drop ${h.name.toLowerCase()}`, description: `Stop counting ${h.name.toLowerCase()} as one of your hobbies.`, category: 'hobby', icon: 'x', durationMinutes: 0, effects: {}, interruptible: true, group: 'New hobbies', params: { hobbyId: id } });
    }
  }
  return out;
}

function execute(ctx: SystemContext, simId: SimId, action: ActionDef, params: Record<string, unknown>): ActionResult {
  const sim = ctx.query.sim(simId);
  const now = ctx.state.time.minute;
  const id = action.id;
  if (id.startsWith('hobby:take_up:')) {
    const hobbyId = String(params.hobbyId ?? id.slice('hobby:take_up:'.length));
    const h = ctx.content.hobbies[hobbyId];
    if (!h) return { ok: false, text: 'Unknown hobby.' };
    if (sim.hobbies.includes(hobbyId)) return { ok: false, text: `You already do ${h.name.toLowerCase()}.` };
    if (sim.hobbies.length >= MAX_HOBBIES) return { ok: false, text: 'You have enough hobbies already. Drop one first.' };
    sim.hobbies.push(hobbyId);
    const text = you(ctx, sim) ? `You decide to take up ${h.name.toLowerCase()}. ${h.description}` : `${sim.identity.firstName} took up ${h.name.toLowerCase()}.`;
    ctx.log({ text, kind: 'narrative', simId, importance: 1 });
    ctx.emit({ type: 'life:event', simId, kind: 'hobby_started', label: h.name, payload: { hobbyId } });
    return { ok: true, text, effects: { moodlets: [{ emotion: 'inspired', label: 'New hobby', intensity: 8, durationMinutes: 8 * HOUR }] } };
  }
  if (id.startsWith('hobby:drop:')) {
    const hobbyId = String(params.hobbyId ?? id.slice('hobby:drop:'.length));
    if (!sim.hobbies.includes(hobbyId)) return { ok: false, text: 'Not one of your hobbies.' };
    sim.hobbies = sim.hobbies.filter((x) => x !== hobbyId);
    const h = ctx.content.hobbies[hobbyId];
    const text = `${you(ctx, sim) ? 'You' : sim.identity.firstName} stop${you(ctx, sim) ? '' : 's'} counting ${h?.name.toLowerCase() ?? hobbyId} as a hobby.`;
    ctx.log({ text, kind: 'narrative', simId, importance: 0 });
    return { ok: true, text };
  }
  const spec = SESSIONS.find((s) => s.actionId === id) ?? (id === STUDY.actionId ? STUDY : undefined);
  if (spec) {
    // record use so decay does not bite skills exercised through hobbies
    for (const k of Object.keys(spec.effects.skills ?? {})) sim.flags[`skill:last:${k}`] = now;
    const h = spec.hobbyId ? ctx.content.hobbies[spec.hobbyId] : undefined;
    const controlled = you(ctx, sim);
    const text = controlled ? `${spec.description}` : `${sim.identity.firstName} spends some time on ${h?.name.toLowerCase() ?? 'a hobby'}.`;
    return { ok: true, text };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Decay & events
// ---------------------------------------------------------------------------
function decaySkills(ctx: SystemContext, sim: Sim, days: number): void {
  const now = ctx.state.time.minute;
  for (const [skillId, st] of Object.entries(sim.skills)) {
    if (st.level <= DECAY_MIN_LEVEL) continue;
    const def = ctx.content.skills[skillId];
    if (!def) continue;
    const last = num(sim.flags[`skill:last:${skillId}`], sim.createdAt);
    if (now - last < DECAY_AFTER) continue;
    const curve = def.xpCurve[st.level] ?? def.xpCurve[def.xpCurve.length - 1] ?? 100;
    st.xp -= curve * 0.01 * days; // 1% of the current level's bar per idle day (very slow)
    if (st.xp < 0) {
      if (st.level > DECAY_MIN_LEVEL) {
        st.level -= 1;
        st.xp = (def.xpCurve[st.level] ?? curve) * 0.9;
        if (you(ctx, sim)) ctx.log({ text: `You're getting rusty at ${def.name.toLowerCase()} — down to level ${st.level}.`, kind: 'system', simId: sim.id, importance: 1 });
      } else st.xp = 0;
    }
  }
}

function onEvent(ctx: SystemContext, e: GameEvent): void {
  const now = ctx.state.time.minute;
  switch (e.type) {
    case 'sim:skill_up': {
      const sim = ctx.query.simMaybe(e.simId);
      if (!sim) break;
      const def = ctx.content.skills[e.skillId];
      const unlock = def?.unlocks[e.level];
      ctx.applyEffects(sim.id, { moodlets: [{ id: `skills:levelup:${e.skillId}`, emotion: 'proud', label: `Leveled up ${def?.name ?? e.skillId}`, intensity: 12, durationMinutes: 4 * HOUR }] }, 'skills:level_up');
      const who = you(ctx, sim) ? 'You' : sim.identity.firstName;
      ctx.log({ text: `${who} ${you(ctx, sim) ? 'are' : 'is'} now level ${e.level} in ${def?.name ?? e.skillId}.${unlock ? ` Unlocked: ${unlock}` : ''}`, kind: 'narrative', simId: sim.id, importance: 2 });
      sim.flags[`skill:last:${e.skillId}`] = now;
      break;
    }
    case 'effects:applied': {
      if (!e.bundle.skills) break;
      const sim = ctx.query.simMaybe(e.simId);
      if (!sim) break;
      for (const [k, v] of Object.entries(e.bundle.skills)) if (typeof v === 'number' && v > 0) sim.flags[`skill:last:${k}`] = now;
      break;
    }
    default:
      break;
  }
}

export const skillsSystem: System = {
  id: 'skills',
  intervalMinutes: DAY,

  onInit(ctx) {
    const now = ctx.state.time.minute;
    for (const sim of Object.values(ctx.state.sims)) if (sim.flags['skills:lastDecayAt'] === undefined) sim.flags['skills:lastDecayAt'] = now;
  },

  onTick(ctx) {
    const now = ctx.state.time.minute;
    for (const sim of ctx.query.simulatedSims()) {
      const last = num(sim.flags['skills:lastDecayAt'], now - DAY);
      const days = Math.max(1, (now - last) / DAY);
      sim.flags['skills:lastDecayAt'] = now;
      decaySkills(ctx, sim, Math.min(days, 30));
    }
  },

  onEvent,
  actions: actionsFor,
  handles: (id) => id.startsWith('skills:') || id.startsWith('hobby:'),
  execute,
};

export { SESSIONS as HOBBY_SESSIONS };
