import { describe, expect, it } from 'vitest';
import { Engine } from '../core/engine';
import type { GameEvent } from '../core/events';
import { makeEmptyWorld, makeHousehold, makeSim, makeVenue } from '../core/factories';
import { RNG } from '../core/rng';
import type { System } from '../core/systems';
import type { WorldState } from '../core/types';
import { NEED_IDS } from '../core/types';
import { DAY } from '../core/util';
import type { ContentCatalog } from '../content/types';
import { HOBBIES } from '../content/hobbies';
import { ILLNESSES } from '../content/illnesses';
import { SKILLS, SKILL_XP_CURVE, xpToLevel } from '../content/skills';
import { TRAITS } from '../content/traits';
import { healthSystem } from './health';
import { needsSystem } from './needs';
import { skillsSystem } from './skills';

const content: ContentCatalog = {
  objects: {},
  items: {},
  recipes: {},
  skills: SKILLS,
  hobbies: HOBBIES,
  traits: TRAITS,
  careers: {},
  programs: {},
  illnesses: ILLNESSES,
  crimes: {},
  holidays: {},
  festivals: {},
  archetypes: {} as ContentCatalog['archetypes'],
  petBreeds: [],
  vehicles: [],
  bioTemplates: [],
  names: { first: { male: [], female: [], nonbinary: [] }, last: [] },
};

const EXPECTED_SKILLS = 'cooking baking mixology fitness athletics charisma comedy negotiation logic research programming creativity writing painting photography music singing dancing guitar piano gardening handiness mechanics driving gaming parenting medicine law finance crafting fishing spanish'.split(' ');
const EXPECTED_TRAITS = 'ambitious lazy cheerful gloomy hot_headed outgoing loner romantic family_oriented bookworm foodie neat slob active couch_potato creative genius materialistic frugal kleptomaniac kind mean jealous loyal insomniac night_owl early_bird adventurous homebody geek music_lover animal_lover vegetarian workaholic perfectionist clumsy brave coward snob childish hopeless_romantic commitment_issues party_animal spiritual skeptic generous gossip vain self_assured anxious empathetic stoic hypochondriac thrill_seeker'.split(' ');

function world(traits: string[] = []) {
  const rng = new RNG('skills-test');
  const state = makeEmptyWorld({ seed: 'skills-test', epoch: '2026-09-10' });
  const c = state.region.center;
  const home = makeVenue({ name: 'Home', archetype: 'home', location: c, rng });
  const park = makeVenue({ name: 'Zilker Park', archetype: 'park', location: { lat: c.lat + 0.02, lng: c.lng }, rng });
  const library = makeVenue({ name: 'Central Library', archetype: 'library', location: { lat: c.lat + 0.01, lng: c.lng }, rng });
  for (const v of [home, park, library]) state.venues[v.id] = v;
  const sim = makeSim({ firstName: 'Ada', lastName: 'Lee', gender: 'female', age: 28, epoch: state.epoch, rng, venueId: home.id, isPlayerControlled: true, startingCash: 500, personality: { traits } });
  state.sims[sim.id] = sim;
  const hh = makeHousehold({ name: 'Lee', simIds: [sim.id], homeVenueId: home.id, rng });
  state.households[hh.id] = hh;
  sim.householdId = hh.id;
  home.ownerHouseholdId = hh.id;
  state.player = { householdId: hh.id, activeSimId: sim.id, controlledSimIds: [sim.id], favorites: [], tutorial: {} };
  return { state, sim, home, park, library, rng };
}

function engine(state: WorldState, systems: System[], events: GameEvent[] = []) {
  const eng = new Engine(state, { content, systems: [...systems, { id: 'story', intervalMinutes: 60, onEvent: (_c, e) => events.push(e) }], holidayResolver: () => [] });
  eng.init(true);
  return eng;
}

describe('content catalogs', () => {
  it('implements every skill, trait and hobby id from docs/IDS.md', () => {
    for (const id of EXPECTED_SKILLS) expect(SKILLS[id], id).toBeDefined();
    for (const id of EXPECTED_TRAITS) expect(TRAITS[id], id).toBeDefined();
    expect(Object.keys(HOBBIES).length).toBeGreaterThanOrEqual(30);
    expect(Object.keys(ILLNESSES).length).toBeGreaterThanOrEqual(30);
    for (const s of Object.values(SKILLS)) {
      expect(s.xpCurve.length).toBe(10);
      expect(s.xpCurve[0]).toBe(100);
      expect(Object.keys(s.unlocks).length).toBeGreaterThanOrEqual(5);
    }
    expect(SKILL_XP_CURVE[1]).toBe(135);
    expect(xpToLevel(2)).toBe(235);
    for (const t of Object.values(TRAITS)) {
      expect(t.llmHint.length).toBeGreaterThan(40);
      for (const c of t.conflicts) expect(TRAITS[c], `${t.id} conflicts with unknown ${c}`).toBeDefined();
      for (const c of t.conflicts) expect(TRAITS[c].conflicts, `${c} should conflict back with ${t.id}`).toContain(t.id);
    }
    for (const h of Object.values(HOBBIES)) if (h.skillId) expect(SKILLS[h.skillId], `${h.id} → ${h.skillId}`).toBeDefined();
    for (const i of Object.values(ILLNESSES)) {
      expect(i.treatments.length).toBeGreaterThan(0);
      expect(i.baseDurationDays).toBeGreaterThan(0);
    }
  });
});

describe('skills system', () => {
  it('xp leads to level-up event, moodlet and notable log line', () => {
    const { state, sim } = world();
    const events: GameEvent[] = [];
    const eng = engine(state, [skillsSystem], events);
    eng.applyEffects(sim.id, { skills: { cooking: 60 } }, 'test');
    expect(sim.skills.cooking.level).toBe(0);
    eng.applyEffects(sim.id, { skills: { cooking: 60 } }, 'test');
    expect(sim.skills.cooking.level).toBe(1);
    expect(sim.skills.cooking.xp).toBeCloseTo(20, 5);
    expect(events.some((e) => e.type === 'sim:skill_up' && e.skillId === 'cooking' && e.level === 1)).toBe(true);
    expect(sim.mind.moodlets.some((m) => m.label === 'Leveled up Cooking')).toBe(true);
    expect(state.log.some((l) => l.importance === 2 && /level 1 in Cooking/.test(l.text))).toBe(true);
    expect(sim.flags['skill:last:cooking']).toBe(state.time.minute);
    // trait multipliers apply
    const { state: s2, sim: foodie } = world(['foodie']);
    const e2 = engine(s2, [skillsSystem]);
    e2.applyEffects(foodie.id, { skills: { cooking: 60 } }, 'test');
    expect(foodie.skills.cooking.xp).toBeCloseTo(78, 5);
  });

  it('offers hobby sessions in context, with item requirements, and executes them', () => {
    const { state, sim, park, library } = world();
    const eng = engine(state, [needsSystem, skillsSystem]);
    sim.hobbies = ['running', 'reading', 'painting', 'guitar'];
    const list = () => eng.actionsFor(sim.id);
    const ids = () => list().map((a) => a.action.id);
    expect(ids()).toContain('hobby:run');
    expect(ids()).toContain('hobby:read');
    expect(ids()).toContain('hobby:sketch');
    expect(ids()).toContain('skills:study_spanish');
    // object-backed hobby: no session action (only the take-up/drop management entries mention it)
    expect(ids().some((id) => /guitar/.test(id) && !id.startsWith('hobby:drop:') && !id.startsWith('hobby:take_up:'))).toBe(false);
    const read = list().find((a) => a.action.id === 'hobby:read')!;
    expect(read.available).toBe(false);
    expect(read.reasons.join()).toMatch(/book novel/);
    sim.inventory.consumables.book_novel = 1;
    eng.advance(1, { allowInterrupt: false }); // the engine caches the action list per minute
    expect(list().find((a) => a.action.id === 'hobby:read')!.available).toBe(true);
    const fun0 = sim.needs.fun;
    expect(eng.perform(sim.id, 'hobby:read').ok).toBe(true);
    expect(sim.skills.research?.xp).toBeGreaterThan(0);
    expect(sim.needs.fun).toBeGreaterThan(fun0);
    expect(sim.inventory.consumables.book_novel).toBe(1); // not consumed

    const hyg = sim.needs.hygiene;
    const res = eng.perform(sim.id, 'hobby:run');
    expect(res.ok).toBe(true);
    expect(res.minutes).toBe(30);
    expect(sim.skills.athletics.xp).toBeGreaterThan(0);
    expect(sim.needs.hygiene).toBeLessThan(hyg);
    expect(sim.flags.fitness_last_at).toBeUndefined(); // health system not registered here — see below

    expect(eng.perform(sim.id, 'skills:study_spanish').ok).toBe(true);
    expect(sim.skills.spanish.xp).toBeCloseTo(18, 5);

    eng.teleport(sim.id, park.id);
    expect(ids()).toContain('hobby:run');
    expect(ids()).toContain('hobby:sketch');
    eng.teleport(sim.id, library.id);
    expect(ids()).not.toContain('hobby:run');
    expect(ids()).toContain('hobby:read_library');
  });

  it('take up / drop hobbies, capped at six', () => {
    const { state, sim } = world(['active', 'creative']);
    const eng = engine(state, [skillsSystem]);
    const suggestions = eng.actionsFor(sim.id).filter((a) => a.action.id.startsWith('hobby:take_up:'));
    expect(suggestions.length).toBe(4);
    const again = eng.actionsFor(sim.id).filter((a) => a.action.id.startsWith('hobby:take_up:')).map((a) => a.action.id);
    expect(again).toEqual(suggestions.map((a) => a.action.id)); // stable within the day
    const first = suggestions[0].action.id;
    const hobbyId = first.slice('hobby:take_up:'.length);
    expect(eng.perform(sim.id, first).ok).toBe(true);
    expect(sim.hobbies).toContain(hobbyId);
    expect(sim.mind.moodlets.some((m) => m.label === 'New hobby')).toBe(true);
    sim.hobbies = ['running', 'reading', 'painting', 'gaming', 'chess', 'yoga'];
    expect(eng.actionsFor(sim.id).some((a) => a.action.id.startsWith('hobby:take_up:'))).toBe(false);
    expect(eng.perform(sim.id, 'hobby:drop:chess').ok).toBe(true);
    expect(sim.hobbies).not.toContain('chess');
    expect(eng.actionsFor(sim.id).some((a) => a.action.id.startsWith('hobby:take_up:'))).toBe(true);
  });

  it('decays unused skills above level 3 very slowly', () => {
    const { state, sim } = world();
    const eng = engine(state, [skillsSystem]);
    sim.skills.cooking = { level: 5, xp: 3 };
    sim.skills.logic = { level: 3, xp: 0 };
    sim.skills.guitar = { level: 6, xp: 200 };
    const now = state.time.minute;
    sim.flags['skill:last:cooking'] = now - 30 * DAY;
    sim.flags['skill:last:logic'] = now - 60 * DAY;
    sim.flags['skill:last:guitar'] = now; // used today
    eng.advance(DAY, { allowInterrupt: false });
    expect(sim.skills.cooking.level).toBe(4);
    expect(sim.skills.cooking.xp).toBeGreaterThan(0);
    expect(sim.skills.logic.level).toBe(3);
    expect(sim.skills.logic.xp).toBe(0);
    expect(sim.skills.guitar.xp).toBe(200);
    for (let d = 0; d < 6; d++) eng.advance(DAY, { allowInterrupt: false });
    expect(sim.skills.cooking.level).toBeGreaterThanOrEqual(3);
    expect(Number.isFinite(sim.skills.cooking.xp)).toBe(true);
  });

  it('7 days with needs + health + skills: a daily run keeps the sim fit and sane', () => {
    const { state, sim } = world(['active']);
    const events: GameEvent[] = [];
    const caretaker: System = { id: 'lifeEvents', intervalMinutes: 60, onTick: (ctx) => { for (const s of ctx.query.controlledSims()) for (const k of NEED_IDS) s.needs[k] = Math.max(s.needs[k], 70); } };
    const eng = engine(state, [needsSystem, healthSystem, skillsSystem, caretaker], events);
    sim.hobbies = ['running'];
    const f0 = sim.body.fitness;
    for (let d = 0; d < 7; d++) {
      const res = eng.perform(sim.id, 'hobby:run');
      expect(res.ok).toBe(true);
      eng.advance(DAY - res.minutes, { allowInterrupt: false });
      for (const k of NEED_IDS) expect(Number.isFinite(sim.needs[k])).toBe(true);
      expect(Number.isFinite(sim.body.fitness)).toBe(true);
      expect(Number.isFinite(sim.mind.mood)).toBe(true);
    }
    expect(sim.body.fitness).toBeGreaterThan(f0);
    expect(sim.flags.fitness_last_at).toBeDefined();
    expect(sim.skills.athletics.level).toBeGreaterThanOrEqual(1); // 7 × 22 xp × 1.4 (active) > 100
    expect(events.some((e) => e.type === 'sim:skill_up' && e.skillId === 'athletics')).toBe(true);
    expect(sim.body.alive).toBe(true);
  });
});
