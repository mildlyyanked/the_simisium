/**
 * NPC autonomy — schedules, level-of-detail, movement, object/venue autonomy for `full` sims,
 * NPC↔NPC and NPC→player social initiative, and cheap daily "life goes on" progression.
 *
 * Applies to every alive NPC and to controlled sims with `sim.flags.autonomy === true`.
 *
 * Exports: `defaultScheduleFor(ctx, sim)`, `whereIs(ctx, sim, minute)`, `npcAISystem`.
 * Emits: sim:lod_changed, sim:departed, sim:arrived (near/far teleports), action:started (NPC actions),
 *        relationship deltas via applyEffects, interrupts kind 'visitor' (NPC approaches a controlled sim, ≤ 1/h)
 * Consumes: world:new_game, world:loaded, action:completed, career:hired/fired/quit, time:day
 * Action prefix handled: `npcai:` (interrupt options only)
 *
 * NPC object actions are executed by this system (not `engine.perform`): we set `sim.currentAction`,
 * keep the ActionDef in a module-level map, and apply its effects/outcomes on `action:completed`.
 * NPCs are not charged for objects at home but do pay venue costs.
 */
import { availableActions } from '../core/actions';
import { weekdayAt } from '../core/clock';
import { transact } from '../core/effects';
import type { GameEvent } from '../core/events';
import { simName } from '../core/query';
import type { ActionResult, System, SystemContext } from '../core/systems';
import type { ActionDef, NeedId, RoutineBlock, RoutineKind, Sim, SimId, SimLOD, TravelMode, VenueId, Weekday } from '../core/types';
import { clamp, clamp100, DAY, HOUR, haversineKm } from '../core/util';
import { chooseMode, estimateTravel } from './transportUtil';
import { compatibility, hasTrait, isAdult, isKid, isSingle, isTeenOrKid, partnerOf, pendingInterruptActions, pushMemory, romanticallyCompatible, setFlags } from './relationships';

/** ActionDefs of running NPC actions (not persisted: on load an NPC simply finishes with no effects). */
const pending = new Map<SimId, ActionDef>();
const lastDecision = new Map<SimId, number>();

const NEEDS: NeedId[] = ['hunger', 'thirst', 'energy', 'bladder', 'hygiene', 'social', 'fun', 'comfort'];
const H = HOUR;

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------
function blockMatchesDay(b: RoutineBlock, weekday: Weekday): boolean {
  if (b.day === 'daily') return true;
  if (b.day === 'weekday') return weekday >= 1 && weekday <= 5;
  if (b.day === 'weekend') return weekday === 0 || weekday === 6;
  return b.day === weekday;
}

function sleepWindow(sim: Sim): [number, number] {
  if (isKid(sim)) return [19 * H, 7 * H];
  if (sim.lifeStage === 'child') return [20 * H + 30, 7 * H];
  if (sim.lifeStage === 'teen') return [23 * H, 7 * H];
  if (hasTrait(sim, 'night_owl')) return [1 * H + 30, 9 * H + 30];
  if (hasTrait(sim, 'early_bird')) return [21 * H + 30, 5 * H + 30];
  if (sim.lifeStage === 'senior') return [22 * H, 6 * H + 30];
  return [23 * H, 7 * H];
}

function pushSpan(out: RoutineBlock[], day: RoutineBlock['day'], start: number, end: number, kind: RoutineKind, venueId?: VenueId, label?: string): void {
  if (start < end) out.push({ day, start, end, kind, venueId, label });
  else {
    out.push({ day, start, end: DAY, kind, venueId, label });
    out.push({ day, start: 0, end, kind, venueId, label });
  }
}

/** Generate a realistic weekly routine from job shifts, traits, hobbies and nearby venues. */
export function defaultScheduleFor(ctx: SystemContext, sim: Sim): RoutineBlock[] {
  const out: RoutineBlock[] = [];
  const home = ctx.query.homeOf(sim.id);
  const from = home?.id ?? sim.location.venueId;
  const near = (a: Parameters<typeof ctx.query.nearestVenue>[1]) => ctx.query.nearestVenue(from, a)?.id;
  const [s0, s1] = sleepWindow(sim);
  pushSpan(out, 'daily', s0, s1, 'sleep', home?.id, 'Sleep');
  if (isKid(sim)) {
    out.push({ day: 'daily', start: 13 * H, end: 14 * H + 30, kind: 'sleep', venueId: home?.id, label: 'Nap' });
    return out;
  }
  const job = sim.career.job;
  if (job && job.shifts.length && !sim.career.retired) {
    for (const sh of job.shifts) pushSpan(out, sh.day, sh.start, sh.end, 'work', job.remote ? home?.id : job.employerVenueId ?? home?.id, job.title);
  } else if (sim.role?.venueId && isAdult(sim) && !sim.career.retired && sim.lifeStage !== 'senior') {
    const days: Weekday[] = ctx.rng.chance(0.6) ? [1, 2, 3, 4, 5] : [2, 3, 4, 5, 6];
    const start = ctx.rng.pick([7 * H, 8 * H, 9 * H, 10 * H, 14 * H]);
    for (const d of days) pushSpan(out, d, start, start + 8 * H + 30, 'work', sim.role.venueId, sim.role.title ?? sim.role.role);
  }
  if (sim.lifeStage === 'child' || sim.lifeStage === 'teen') {
    const school = near('school');
    out.push({ day: 'weekday', start: 7 * H + 45, end: 15 * H + 15, kind: 'school', venueId: school ?? home?.id, label: 'School' });
    out.push({ day: 'weekday', start: 16 * H, end: 17 * H, kind: 'hobby', venueId: home?.id, label: 'Homework' });
  } else if (isAdult(sim) && sim.education.enrollment && sim.education.enrollment.status === 'enrolled') {
    const college = sim.education.enrollment.institutionVenueId ?? near('college');
    for (const d of [1, 3, 5] as Weekday[]) out.push({ day: d, start: 9 * H, end: 12 * H, kind: 'school', venueId: college ?? home?.id, label: 'Classes' });
  }
  // meals at home when not working
  out.push({ day: 'daily', start: s1, end: s1 + 45, kind: 'meal', venueId: home?.id, label: 'Breakfast' });
  out.push({ day: 'daily', start: 18 * H + 30, end: 19 * H + 15, kind: 'meal', venueId: home?.id, label: 'Dinner' });
  // gym
  const gym = near('gym');
  if (gym && (hasTrait(sim, 'active') || sim.hobbies.some((h) => /gym|run|lift|fitness|yoga|swim/i.test(h)) || sim.personality.values.health > 0.7)) {
    const t = hasTrait(sim, 'early_bird') ? 6 * H : 18 * H;
    for (const d of [1, 3, 5] as Weekday[]) out.push({ day: d, start: t, end: t + H, kind: 'gym', venueId: gym, label: 'Gym' });
  }
  // worship
  const church = near('church');
  if (church && (hasTrait(sim, 'spiritual') || sim.personality.values.faith > 0.6)) out.push({ day: 0, start: 10 * H, end: 11 * H + 30, kind: 'worship', venueId: church, label: 'Service' });
  // errands
  const grocery = near('grocery');
  if (grocery && isAdult(sim)) out.push({ day: 6, start: 11 * H, end: 12 * H + 15, kind: 'errand', venueId: grocery, label: 'Groceries' });
  // social Friday evening
  if (!hasTrait(sim, 'homebody') && !hasTrait(sim, 'loner') && isAdult(sim)) {
    const venue = hasTrait(sim, 'party_animal') || hasTrait(sim, 'outgoing') ? near('bar') ?? near('nightclub') ?? near('cafe') : sim.personality.extraversion > 0.5 ? near('cafe') ?? near('park') ?? near('bar') : near('park') ?? near('cafe');
    if (venue) out.push({ day: 5, start: 19 * H, end: 22 * H, kind: 'social', venueId: venue, label: 'Out with friends' });
  }
  // hobby evenings from content catalog when available
  const hobbyVenueId = sim.hobbies.map((h) => ctx.content.hobbies[h]).filter(Boolean).flatMap((h) => h.venues).map((a) => near(a)).find(Boolean);
  if (hobbyVenueId) out.push({ day: 2, start: 18 * H, end: 20 * H, kind: 'hobby', venueId: hobbyVenueId, label: 'Hobby' });
  if (sim.lifeStage === 'senior') {
    const sc = near('senior_center') ?? near('park') ?? near('library');
    if (sc) for (const d of [2, 4] as Weekday[]) out.push({ day: d, start: 10 * H, end: 12 * H, kind: 'social', venueId: sc, label: 'Out and about' });
  }
  // chores Sunday afternoon
  out.push({ day: 0, start: 14 * H, end: 15 * H + 30, kind: 'chores', venueId: home?.id, label: 'Chores' });
  return out;
}

/** Merge missing kinds of the default schedule into `sim.schedule` (keeps career-set work blocks). */
export function ensureSchedule(ctx: SystemContext, sim: Sim): void {
  const have = new Set(sim.schedule.map((b) => b.kind));
  const def = defaultScheduleFor(ctx, sim);
  for (const b of def) if (!have.has(b.kind)) sim.schedule.push(b);
  if (sim.schedule.length > 80) sim.schedule = sim.schedule.slice(0, 80);
}

function activeBlock(ctx: SystemContext, sim: Sim, minute: number): RoutineBlock | undefined {
  const mod = ((minute % DAY) + DAY) % DAY;
  const wd = ctx.clock.minute === minute ? ctx.clock.weekday : weekdayAt(ctx.state.epoch, minute);
  const school = ctx.clock.day.isSchoolDay;
  const hasJob = !!sim.career.job || !!sim.role?.venueId;
  let best: RoutineBlock | undefined;
  const prio: Record<RoutineKind, number> = { sleep: 5, work: 6, school: 6, childcare: 6, commute: 4, meal: 3, gym: 3, errand: 3, social: 3, hobby: 2, chores: 2, worship: 3, free: 1 };
  for (const b of sim.schedule) {
    if (!blockMatchesDay(b, wd)) continue;
    if (mod < b.start || mod >= b.end) continue;
    if (b.kind === 'school' && !school) continue;
    if (b.kind === 'work' && !hasJob) continue;
    if (b.kind === 'childcare' && !school) continue;
    if (!best || prio[b.kind] > prio[best.kind]) best = b;
  }
  return best;
}

/** Minutes until the next work/school/childcare block begins (today or tomorrow), or Infinity. */
function inConversationWithPlayer(ctx: SystemContext, sim: Sim, now: number): boolean {
  const controlled = ctx.state.player.controlledSimIds;
  for (const c of Object.values(ctx.state.conversations)) {
    if (!c.active || c.channel !== 'in_person' || !c.participantIds.includes(sim.id)) continue;
    if (!c.participantIds.some((p) => controlled.includes(p))) continue;
    if (now - c.lastTurnAt > 45) continue; // the player wandered off mentally; life goes on
    return true;
  }
  return false;
}

export function minutesToNextObligation(ctx: SystemContext, sim: Sim, minute: number): number {
  const mod = ((minute % DAY) + DAY) % DAY;
  let best = Number.POSITIVE_INFINITY;
  for (let dayOffset = 0; dayOffset < 2; dayOffset++) {
    const wd = ((weekdayAt(ctx.state.epoch, minute + dayOffset * DAY)) as Weekday);
    for (const b of sim.schedule) {
      if (b.kind !== 'work' && b.kind !== 'school' && b.kind !== 'childcare') continue;
      if (!blockMatchesDay(b, wd)) continue;
      if (b.kind === 'work' && !sim.career.job && !sim.role?.venueId) continue;
      const startAt = dayOffset * DAY + b.start - mod;
      if (startAt > 0 && startAt < best) best = startAt;
    }
  }
  return best;
}

/** Where a sim should be at `minute` per schedule; home when nothing is scheduled. */
export function whereIs(ctx: SystemContext, sim: Sim, minute: number): VenueId | undefined {
  const home = ctx.query.homeOf(sim.id)?.id;
  const b = activeBlock(ctx, sim, minute);
  if (!b) return home ?? (sim.role?.venueId as VenueId | undefined) ?? sim.location.venueId;
  if (b.venueId && ctx.state.venues[b.venueId]) return b.venueId;
  if (b.kind === 'work') return sim.career.job?.employerVenueId ?? sim.role?.venueId ?? home;
  return home ?? sim.location.venueId;
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------
function fallbackTravel(ctx: SystemContext, from: VenueId, to: VenueId): { minutes: number; cost: number } {
  const a = ctx.state.venues[from];
  const b = ctx.state.venues[to];
  if (!a || !b) return { minutes: 15, cost: 0 };
  const km = haversineKm(a.location, b.location);
  return { minutes: Math.max(2, Math.round((km / 30) * 60) + 3), cost: 0 };
}

function startTravel(ctx: SystemContext, sim: Sim, to: VenueId): void {
  const now = ctx.state.time.minute;
  const from = sim.location.venueId;
  let mode: TravelMode = 'walk';
  let minutes: number;
  let cost: number;
  try {
    mode = chooseMode(ctx.state, sim, from, to);
    const est = estimateTravel(ctx.state, from, to, mode);
    minutes = est.minutes;
    cost = est.cost;
  } catch {
    const f = fallbackTravel(ctx, from, to);
    minutes = f.minutes;
    cost = f.cost;
  }
  if (cost > 0) {
    const r = transact(sim, -cost, `${mode} fare`, now, { category: 'transport', rng: ctx.rng, allowCredit: false });
    if (!r.ok) {
      mode = 'walk';
      const f = fallbackTravel(ctx, from, to);
      minutes = Math.round(f.minutes * 2);
      cost = 0;
    }
  }
  sim.currentAction = undefined;
  sim.travel = { fromVenueId: from, toVenueId: to, mode, departedAt: now, arriveAt: now + Math.max(1, minutes), cost };
  ctx.emit({ type: 'sim:departed', simId: sim.id, venueId: from });
}

// ---------------------------------------------------------------------------
// Autonomy (full sims)
// ---------------------------------------------------------------------------
function synthetic(sim: Sim, id: string, label: string, minutes: number, perMinute?: Partial<Record<NeedId, number>>): void {
  sim.currentAction = { actionId: id, label, startedAt: 0, endsAt: 0, interruptible: true, perMinute };
}

function traitBias(sim: Sim, a: ActionDef): number {
  let b = 0;
  const cat = a.category;
  const label = a.label.toLowerCase();
  if (hasTrait(sim, 'active') && cat === 'fitness') b += 0.5;
  if (hasTrait(sim, 'couch_potato') && cat === 'fitness') b -= 0.6;
  if (hasTrait(sim, 'couch_potato') && /tv|watch|scroll|nap/.test(label)) b += 0.4;
  if (hasTrait(sim, 'bookworm') && /read|book/.test(label)) b += 0.5;
  if (hasTrait(sim, 'foodie') && /cook|meal|eat/.test(label)) b += 0.3;
  if (hasTrait(sim, 'neat') && cat === 'chores') b += 0.5;
  if (hasTrait(sim, 'slob') && cat === 'chores') b -= 0.5;
  if (hasTrait(sim, 'creative') && cat === 'hobby') b += 0.4;
  if (hasTrait(sim, 'geek') && /game|computer|console/.test(label)) b += 0.4;
  if (hasTrait(sim, 'music_lover') && /music|guitar|piano|record|stereo/.test(label)) b += 0.4;
  if (hasTrait(sim, 'workaholic') && cat === 'work') b += 0.4;
  if (hasTrait(sim, 'lazy') && (cat === 'chores' || cat === 'fitness' || cat === 'work')) b -= 0.3;
  if (hasTrait(sim, 'frugal') && a.cost) b -= 0.4;
  if (isTeenOrKid(sim) && /alcohol|beer|wine|drink a|smoke|vape|cannabis|gamble|slot/.test(label)) b -= 100;
  return b;
}

let CURRENT_MOD = 0;
function nightNow(sim: Sim, sleepStart: number): boolean {
  void sim;
  const m = CURRENT_MOD;
  return m >= sleepStart - 60 || m < 5 * 60;
}

let CURRENT_STATE: import('../core/types').WorldState | undefined;
function scoreAction(sim: Sim, a: ActionDef, atHome: boolean): number {
  if (a.category === 'chores' && a.target?.kind === 'object' && CURRENT_STATE) {
    const obj = CURRENT_STATE.objects[a.target.id as import('../core/types').ObjectId];
    const dirty = obj?.state.dirty ?? 0;
    if (dirty > 60) return (a.autonomyWeight ?? 0.3) + (dirty - 60) / 20 + (hasTrait(sim, 'neat') ? 0.8 : 0) - (hasTrait(sim, 'slob') ? 0.6 : 0);
  }
  if (a.category === 'travel' || a.category === 'freeform' || a.category === 'system' || a.category === 'shop' || a.category === 'finance' || a.category === 'legal' || a.category === 'romance' || a.category === 'family' || a.category === 'pet') return -1;
  // phone/social object actions are fine for autonomy (scrolling, calling a friend, chatting at the counter); sim-targeted socials are not
  if ((a.category === 'phone' || a.category === 'social') && !a.id.startsWith('obj:') && !a.id.startsWith('venue:')) return -1;
  if (a.llm === 'adjudicate' || a.llm === 'converse') return -1;
  if (a.id.startsWith('social:') || a.id.startsWith('family:') || a.id.startsWith('pet:') || a.id.startsWith('lifeEvents:')) return -1;
  let s = a.autonomyWeight ?? 0.25;
  if (a.satisfies?.length) {
    // a need-satisfying action is only attractive in proportion to the need
    const worst = Math.min(...a.satisfies.map((n) => sim.needs[n]));
    s *= worst > 75 ? 0.15 : worst > 55 ? 0.5 : 1;
    for (const n of a.satisfies) {
      const deficit = (100 - sim.needs[n]) / 100;
      s += deficit * deficit * 2.2;
      if (sim.needs[n] < 25) s += 1;
    }
  }
  if (!a.satisfies?.length) {
    const eff = a.effects.needs ?? {};
    for (const [k, v] of Object.entries(eff)) if ((v ?? 0) > 0) s += ((100 - sim.needs[k as NeedId]) / 100) * 0.8;
  }
  if (a.durationMinutes >= 300 && a.satisfies?.includes('energy') && sim.needs.energy > 30) {
    const [s0] = sleepWindow(sim);
    return -1 + (nightNow(sim, s0) ? 2 : 0);
  }
  if (a.cost && a.cost.amount > 0) s -= atHome ? 0 : Math.min(0.8, a.cost.amount / 60);
  s += traitBias(sim, a);
  if (a.durationMinutes > 180) s -= 0.3;
  return s;
}

function pickAction(ctx: SystemContext, sim: Sim, atHome: boolean, need?: NeedId): ActionDef | undefined {
  let list: ReturnType<typeof availableActions>;
  try {
    list = availableActions(ctx, sim.id, []);
  } catch {
    return undefined;
  }
  let best: ActionDef | undefined;
  let bestScore = 0.45;
  for (const { action, available } of list) {
    if (!available) continue;
    if (need && !action.satisfies?.includes(need)) continue;
    const s = scoreAction(sim, action, atHome) + ctx.rng.range(0, 0.35);
    if (s > bestScore) {
      bestScore = s;
      best = action;
    }
  }
  return best;
}

function runAction(ctx: SystemContext, sim: Sim, a: ActionDef, atHome: boolean): void {
  const now = ctx.state.time.minute;
  if (a.cost && a.cost.amount > 0 && !atHome) {
    const r = transact(sim, -a.cost.amount, a.cost.memo, now, { category: a.cost.category ?? 'venue', counterparty: a.cost.counterparty, venueId: sim.location.venueId, rng: ctx.rng, allowCredit: false });
    if (!r.ok) return;
  }
  const lead = minutesToNextObligation(ctx, sim, now) - 45;
  const dur = clamp(Math.round(Math.min(a.durationMinutes, Number.isFinite(lead) ? Math.max(5, lead) : a.durationMinutes)), 1, 480);
  const objId = a.target?.kind === 'object' ? (a.target.id as import('../core/types').ObjectId) : undefined;
  const obj = objId ? ctx.state.objects[objId] : undefined;
  const sets = a.params?.setsState as { on?: boolean; occupied?: boolean } | undefined;
  if (obj) {
    if (sets?.on !== undefined) obj.state.on = sets.on;
    if (sets?.occupied) obj.state.occupiedBy = sim.id;
  }
  sim.currentAction = { actionId: a.id, label: a.label, startedAt: now, endsAt: now + dur, targetId: a.target?.id, interruptible: true, perMinute: a.effects.perMinute };
  pending.set(sim.id, a);
  ctx.emit({ type: 'action:started', simId: sim.id, action: a });
}

function completeAction(ctx: SystemContext, simId: SimId, actionId: string): void {
  const a = pending.get(simId);
  if (!a || a.id !== actionId) return;
  pending.delete(simId);
  const sim = ctx.state.sims[simId];
  if (!sim || !sim.body.alive) return;
  const hh = ctx.query.householdOf(simId);
  const atHome = !!hh && hh.homeVenueId === sim.location.venueId;
  const consumes = a.params?.consumes as { itemId: string; qty: number }[] | undefined;
  if (consumes) {
    for (const c of consumes) {
      const own = sim.inventory.consumables[c.itemId] ?? 0;
      if (own >= c.qty) sim.inventory.consumables[c.itemId] = own - c.qty;
      else if (hh && atHome) hh.pantry[c.itemId] = Math.max(0, (hh.pantry[c.itemId] ?? 0) - c.qty);
      if (sim.inventory.consumables[c.itemId] === 0) delete sim.inventory.consumables[c.itemId];
    }
  }
  if (a.outcomes?.outcomes.length) {
    const rolled = ctx.rng.weighted(a.outcomes.outcomes.map((o) => ({ weight: o.weight + (o.skillId ? (sim.skills[o.skillId]?.level ?? 0) * (o.skillBias ?? 0) : 0), value: o })));
    ctx.applyEffects(simId, rolled.effects, `${a.id}:outcome`);
  }
  const effects = { ...a.effects };
  delete effects.perMinute;
  ctx.applyEffects(simId, effects, a.id);
  const produces = a.params?.produces as { itemId: string; qty: number }[] | undefined;
  if (produces) ctx.applyEffects(simId, { items: produces.map((p) => ({ op: 'gain', itemId: p.itemId, qty: p.qty })) }, `${a.id}:produce`);
  const objId = a.target?.kind === 'object' ? (a.target.id as import('../core/types').ObjectId) : undefined;
  const obj = objId ? ctx.state.objects[objId] : undefined;
  if (obj) {
    if (obj.state.occupiedBy === simId) obj.state.occupiedBy = undefined;
    const dirty = Number(a.params?.dirtiesBy ?? 0);
    const wear = Number(a.params?.wearBy ?? 0);
    if (dirty) obj.state.dirty = clamp100((obj.state.dirty ?? 0) + dirty);
    if (wear) obj.state.condition = clamp100(obj.state.condition - wear * 0.5);
  }
}

function socialAutonomy(ctx: SystemContext, sim: Sim, present: Sim[]): void {
  const now = ctx.state.time.minute;
  if (present.length < 2) return;
  const p = 0.05 + sim.personality.extraversion * 0.12 + (hasTrait(sim, 'outgoing') ? 0.08 : 0) - (hasTrait(sim, 'loner') ? 0.08 : 0) + (sim.needs.social < 40 ? 0.25 : 0) + (sim.needs.social < 15 ? 0.3 : 0);
  if (!ctx.rng.chance(clamp(p, 0.02, 0.4))) return;
  const others = present.filter((o) => o.id !== sim.id && !(o.currentAction && /sleep/.test(o.currentAction.actionId)) && !isKid(o));
  if (!others.length) return;
  // prefer people they know
  const weighted = others.map((o) => ({ weight: 1 + (sim.relationships[o.id]?.familiarity ?? 0) / 20 + (sim.relationships[o.id]?.friendship ?? 0) / 40, value: o }));
  const other = ctx.rng.weighted(weighted);
  const rel = sim.relationships[other.id];
  if (rel?.lastInteractedAt && now - rel.lastInteractedAt < HOUR) return;
  if (ctx.query.isControlled(other.id)) {
    const key = `npc:approach:${other.id}`;
    if (now - Number(ctx.state.flags[key] ?? -1e9) < HOUR) return;
    if (other.currentAction && !other.currentAction.interruptible) return;
    ctx.state.flags[key] = now;
    const fam = rel?.familiarity ?? 0;
    const line = fam < 3 ? `${simName(sim)} glances over and gives you a nod.` : (rel?.friendship ?? 0) >= 20 ? `${sim.identity.firstName} waves you over.` : `${sim.identity.firstName} says hi.`;
    ctx.log({ text: line, kind: 'relationship', simId: other.id, speakerId: sim.id, venueId: sim.location.venueId, importance: 1, meta: { npcId: sim.id, actionId: `social:${sim.id}:converse`, approach: true } });
    if ((rel?.friendship ?? 0) >= 20 && ctx.rng.chance(0.3)) {
      ctx.interrupt({ kind: 'visitor', title: `${sim.identity.firstName} wants to talk`, body: line, simId: other.id, fromSimId: sim.id, options: [{ label: 'Talk', actionId: `social:${sim.id}:converse` }, { label: 'Wave and carry on', actionId: `npcai:ignore:${sim.id}` }] });
    }
    return;
  }
  // NPC ↔ NPC quick interaction
  const compat = compatibility(sim, other);
  const grudge = (other.relationships[sim.id]?.grudges.reduce((s, g) => s + g.weight, 0) ?? 0) + (rel?.grudges.reduce((s, g) => s + g.weight, 0) ?? 0);
  const mean = hasTrait(sim, 'mean') || hasTrait(sim, 'hot_headed') || grudge >= 3;
  const hostile = mean && ctx.rng.chance(0.3 + (grudge >= 3 ? 0.3 : 0));
  if (hostile) {
    ctx.applyEffects(sim.id, { relationships: [{ simId: other.id, friendship: -3, trust: -1, familiarity: 1, mutual: true }], needs: { social: 3 } }, 'npc:argue');
    ctx.applyEffects(other.id, { needs: { social: 2 }, moodlets: [{ emotion: 'angry', label: `Argued with ${sim.identity.firstName}`, intensity: -4, durationMinutes: 120 }] }, 'npc:argue');
    pushMemory(other, { kind: 'conflict', text: `${simName(sim)} snapped at me at ${ctx.query.venueMaybe(sim.location.venueId)?.name ?? 'the place'}.`, participants: [sim.id], valence: -0.5, salience: 25, tags: ['npc'] }, now, ctx.rng);
    return;
  }
  const romantic = romanticallyCompatible(sim, other) && (isSingle(sim) && isSingle(other) || partnerOf(sim) === other.id) && compat > 0.45 && ctx.rng.chance(0.25);
  const gain = 1 + Math.round(compat * 3);
  const socialGain = sim.needs.social < 30 ? 22 : 12;
  ctx.applyEffects(sim.id, { relationships: [{ simId: other.id, friendship: gain, familiarity: 1.5, romance: romantic ? 2 : undefined, attraction: romantic ? 1 : undefined, mutual: true }], needs: { social: socialGain, fun: 3 } }, 'npc:chat');
  ctx.applyEffects(other.id, { needs: { social: 10 } }, 'npc:chat');
  if (ctx.rng.chance(0.25)) {
    const where = ctx.query.venueMaybe(sim.location.venueId)?.name ?? 'somewhere';
    pushMemory(sim, { text: `Chatted with ${simName(other)} at ${where}.`, participants: [other.id], valence: 0.3, salience: 12, tags: ['npc'] }, now, ctx.rng);
    pushMemory(other, { text: `Chatted with ${simName(sim)} at ${where}.`, participants: [sim.id], valence: 0.3, salience: 12, tags: ['npc'] }, now, ctx.rng);
  }
}

function tickFull(ctx: SystemContext, sim: Sim, present: Sim[]): void {
  const now = ctx.state.time.minute;
  CURRENT_MOD = ((now % DAY) + DAY) % DAY;
  CURRENT_STATE = ctx.state;
  if (sim.travel) return;
  if (sim.legal.incarceratedUntil && sim.legal.incarceratedUntil > now) return;
  // mid-conversation with the player: stay put unless an obligation is about to start
  if (inConversationWithPlayer(ctx, sim, now) && minutesToNextObligation(ctx, sim, now) > 15) return;
  const target = whereIs(ctx, sim, now);
  const block = activeBlock(ctx, sim, now);
  const busy = !!sim.currentAction && sim.currentAction.endsAt > now;
  if (target && target !== sim.location.venueId) {
    if (busy && sim.currentAction!.actionId !== 'npc:idle' && !pending.has(sim.id)) return; // finish the current engine/other-system action first
    if (busy && pending.has(sim.id) && sim.currentAction!.endsAt - now > 20) return;
    startTravel(ctx, sim, target);
    return;
  }
  if (busy) return;
  const last = lastDecision.get(sim.id) ?? -1e9;
  if (now - last < 4) return;
  lastDecision.set(sim.id, now);
  const hh = ctx.query.householdOf(sim.id);
  const atHome = !!hh && hh.homeVenueId === sim.location.venueId;
  const blockEnd = block ? now - (now % DAY) + block.end : now + 60;
  const until = Math.max(now + 5, Math.min(blockEnd, now + 240));
  if (block?.kind === 'sleep') {
    if (sim.needs.energy >= 98 && ctx.rng.chance(0.3)) {
      synthetic(sim, 'npc:idle', 'Lying awake', 20, { comfort: 0.05 });
      sim.currentAction!.startedAt = now;
      sim.currentAction!.endsAt = now + 20;
      return;
    }
    const wake = Math.max(now + 5, Math.min(until, now + minutesToNextObligation(ctx, sim, now) - 45));
    synthetic(sim, 'npc:sleep', 'Sleeping', wake - now, { energy: 0.25, bladder: -0.02 });
    sim.currentAction!.startedAt = now;
    sim.currentAction!.endsAt = wake;
    sim.body.lastSleptAt = now;
    return;
  }
  if (block?.kind === 'work' || block?.kind === 'school' || block?.kind === 'childcare') {
    // a break to eat, drink or use the restroom when a need is getting serious
    if (sim.needs.hunger < 35 || sim.needs.thirst < 30 || sim.needs.bladder < 25) {
      const a = pickAction(ctx, sim, atHome);
      if (a && a.satisfies?.length && a.durationMinutes <= 45) {
        runAction(ctx, sim, a, atHome);
        return;
      }
      if (sim.needs.hunger < 20) {
        if (!atHome) transact(sim, -9, 'Lunch', now, { category: 'food', rng: ctx.rng, allowCredit: false });
        synthetic(sim, 'npc:lunch', 'Eating lunch', 30, { hunger: 1.6, thirst: 1, social: 0.1 });
        sim.currentAction!.startedAt = now;
        sim.currentAction!.endsAt = now + 30;
        ctx.emit({ type: 'custom', kind: 'needs:ate', simId: sim.id, payload: { calories: 650, healthy: 0, hungerRestored: 48 } });
        return;
      }
    }
    const social = ctx.rng.chance(0.15);
    if (social) socialAutonomy(ctx, sim, present);
    synthetic(sim, block.kind === 'work' ? 'npc:work' : 'npc:school', block.kind === 'work' ? 'Working' : 'At school', Math.min(60, until - now), { fun: -0.02, social: 0.02 });
    sim.currentAction!.startedAt = now;
    sim.currentAction!.endsAt = Math.min(until, now + 60);
    return;
  }
  socialAutonomy(ctx, sim, present);
  if (sim.currentAction) return;
  const critical: NeedId | undefined = sim.needs.hunger < 18 ? 'hunger' : sim.needs.thirst < 15 ? 'thirst' : sim.needs.bladder < 12 ? 'bladder' : sim.needs.energy < 12 ? 'energy' : undefined;
  if (critical) {
    const fix = pickAction(ctx, sim, atHome, critical);
    if (fix) {
      runAction(ctx, sim, fix, atHome);
      return;
    }
  } else {
    // pantry running dry at home → restock (delivery) before it becomes a crisis
    if (atHome && hh && sim.lifeStage !== 'child' && sim.lifeStage !== 'teen' && now - (Number(sim.flags['npc:groceriesAt']) || -1e9) > DAY) {
      const foodUnits = Object.entries(hh.pantry).reduce((n, [id, q]) => n + (ctx.content.items[id]?.category === 'food' || ctx.content.items[id]?.category === 'ingredient' ? q : 0), 0);
      if (foodUnits < 6) {
        sim.flags['npc:groceriesAt'] = now;
        const cost = Math.round(95 * ctx.state.region.costOfLiving);
        const r = transact(sim, -cost, 'Groceries (delivery)', now, { category: 'food', rng: ctx.rng });
        if (r.ok) {
          for (const [id, q] of [['eggs', 1], ['milk', 1], ['bread', 2], ['rice', 1], ['pasta', 2], ['chicken', 2], ['ground_beef', 1], ['vegetables', 3], ['fruit', 3], ['cheese', 1], ['butter', 1], ['cereal', 1], ['snacks', 3], ['coffee_beans', 1], ['yogurt', 2], ['potatoes', 1], ['onions', 1], ['tomatoes', 1]] as [string, number][]) if (ctx.content.items[id]) hh.pantry[id] = (hh.pantry[id] ?? 0) + q;
          synthetic(sim, 'npc:groceries', 'Ordering groceries', 15, { fun: 0.05 });
          sim.currentAction!.startedAt = now;
          sim.currentAction!.endsAt = now + 15;
          if (ctx.query.isControlled(sim.id)) ctx.log({ text: `${sim.identity.firstName} orders groceries — $${cost}.`, kind: 'money', simId: sim.id, importance: 1 });
          ctx.emit({ type: 'shop:purchased', simId: sim.id, items: [], total: cost });
          return;
        }
      }
    }
    const a = pickAction(ctx, sim, atHome);
    if (a) {
      runAction(ctx, sim, a, atHome);
      return;
    }
  }
  // nothing here meets a critical need: improvise like a person would
  if (sim.needs.hunger < 18) {
    if (!atHome) transact(sim, -9, 'A quick bite', now, { category: 'food', rng: ctx.rng, allowCredit: false });
    synthetic(sim, 'npc:eat', 'Grabbing a bite', 25, { hunger: 1.8, thirst: 0.8 });
    sim.currentAction!.startedAt = now;
    sim.currentAction!.endsAt = now + 25;
    ctx.emit({ type: 'custom', kind: 'needs:ate', simId: sim.id, payload: { calories: 600, healthy: -0.2, hungerRestored: 45 } });
    return;
  }
  if (sim.needs.thirst < 15) {
    synthetic(sim, 'npc:drink', 'Getting some water', 3, { thirst: 15 });
    sim.currentAction!.startedAt = now;
    sim.currentAction!.endsAt = now + 3;
    return;
  }
  if (sim.needs.bladder < 12) {
    synthetic(sim, 'npc:restroom', 'Finding a restroom', 6, { bladder: 15 });
    sim.currentAction!.startedAt = now;
    sim.currentAction!.endsAt = now + 6;
    return;
  }
  if (sim.needs.energy < 12) {
    synthetic(sim, 'npc:nap', 'Dozing off', 60, { energy: 0.45, comfort: 0.05 });
    sim.currentAction!.startedAt = now;
    sim.currentAction!.endsAt = now + 60;
    sim.body.lastSleptAt = now;
    return;
  }
  const idleLabel = block?.kind === 'social' ? 'Hanging out' : block?.kind === 'meal' ? 'Eating' : block?.kind === 'errand' ? 'Running errands' : block?.kind === 'gym' ? 'Working out' : block?.kind === 'worship' ? 'At the service' : block?.kind === 'chores' ? 'Doing chores' : 'Relaxing';
  const per: Partial<Record<NeedId, number>> = block?.kind === 'meal' ? { hunger: 0.8, thirst: 0.6 } : block?.kind === 'gym' ? { fun: 0.1, hygiene: -0.2 } : block?.kind === 'social' ? { social: 0.3, fun: 0.2 } : { fun: 0.08, comfort: 0.1 };
  synthetic(sim, 'npc:idle', idleLabel, 15, per);
  sim.currentAction!.startedAt = now;
  sim.currentAction!.endsAt = now + 15;
}

function tickNear(ctx: SystemContext, sim: Sim): void {
  const now = ctx.state.time.minute;
  if (sim.travel || (sim.legal.incarceratedUntil && sim.legal.incarceratedUntil > now)) return;
  const target = whereIs(ctx, sim, now);
  if (target && target !== sim.location.venueId) {
    const from = sim.location.venueId;
    sim.location = { venueId: target, arrivedAt: now };
    sim.currentAction = undefined;
    ctx.emit({ type: 'sim:moved', simId: sim.id, from, to: target });
    ctx.emit({ type: 'sim:arrived', simId: sim.id, venueId: target });
  }
  for (const n of NEEDS) sim.needs[n] = clamp100(Math.max(sim.needs[n], 55) + 2);
  const block = activeBlock(ctx, sim, now);
  if (block?.kind === 'sleep') sim.currentAction = { actionId: 'npc:sleep', label: 'Sleeping', startedAt: now, endsAt: now + 15, interruptible: true };
  else if (sim.currentAction?.actionId === 'npc:sleep') sim.currentAction = undefined;
}

function tickFar(ctx: SystemContext, sim: Sim): void {
  const now = ctx.state.time.minute;
  const target = whereIs(ctx, sim, now);
  if (target && target !== sim.location.venueId && !sim.travel) sim.location = { venueId: target, arrivedAt: now };
  for (const n of NEEDS) sim.needs[n] = Math.max(sim.needs[n], 70);
  sim.currentAction = undefined;
  sim.lastSimulatedAt = now;
}

// ---------------------------------------------------------------------------
// Daily life progression
// ---------------------------------------------------------------------------
function knownBy(ctx: SystemContext, id: SimId): boolean {
  return ctx.query.controlledSims().some((c) => (c.relationships[id]?.familiarity ?? 0) >= 20);
}

function dailyProgression(ctx: SystemContext): void {
  const now = ctx.state.time.minute;
  const npcs = ctx.query.aliveSims().filter((s) => !ctx.query.isControlled(s.id) && isAdult(s));
  for (const s of npcs) {
    const job = s.career.job;
    if (job) {
      job.performance = clamp100(job.performance + ctx.rng.normal(0.1 + (hasTrait(s, 'ambitious') ? 0.2 : 0) - (hasTrait(s, 'lazy') ? 0.2 : 0), 1.2));
      if (job.performance > 80 && ctx.rng.chance(0.004)) {
        job.level += 1;
        job.performance = 60;
        if (job.annualSalary) job.annualSalary = Math.round(job.annualSalary * 1.08);
        if (job.hourlyRate) job.hourlyRate = Math.round(job.hourlyRate * 1.06 * 100) / 100;
        const def = ctx.content.careers[job.careerId];
        const lvl = def?.levels[Math.min(job.level, (def?.levels.length ?? 1) - 1)];
        if (lvl) job.title = lvl.title;
        if (knownBy(ctx, s.id)) ctx.log({ text: `You hear ${simName(s)} got promoted${lvl ? ` to ${lvl.title}` : ''}.`, kind: 'event', importance: 1 });
      } else if (job.performance < 20 && ctx.rng.chance(0.01)) {
        s.career.history.push({ title: job.title, employer: job.employerName, from: job.startedAt, to: now, reason: 'let go' });
        s.career.job = undefined;
        s.schedule = s.schedule.filter((b) => b.kind !== 'work');
        if (knownBy(ctx, s.id)) ctx.log({ text: `You hear ${simName(s)} lost their job at ${job.employerName}.`, kind: 'event', importance: 1 });
      } else if (ctx.rng.chance(0.0008)) {
        s.career.history.push({ title: job.title, employer: job.employerName, from: job.startedAt, to: now, reason: 'new job' });
        job.employerName = ctx.rng.pick(['a startup downtown', 'a competitor', 'a place across town', 'a bigger company']);
        job.startedAt = now;
        job.performance = 55;
        if (knownBy(ctx, s.id)) ctx.log({ text: `${simName(s)} took a new job at ${job.employerName}.`, kind: 'event', importance: 1 });
      }
    } else if (!s.career.retired && s.lifeStage !== 'senior' && ctx.rng.chance(0.01) && s.role?.venueId) {
      // background hire into their staffing role
      s.schedule = s.schedule.filter((b) => b.kind !== 'work');
      ensureSchedule(ctx, s);
    }
  }
  // couples form / break up among NPCs
  const singles = npcs.filter((s) => isSingle(s) && !hasTrait(s, 'commitment_issues'));
  const sample = ctx.rng.pickN(singles, Math.min(singles.length, 30));
  for (const a of sample) {
    for (const rel of Object.values(a.relationships)) {
      if (rel.familiarity < 5 || rel.friendship < 5) continue;
      const b = ctx.state.sims[rel.simId];
      if (!b || !b.body.alive || ctx.query.isControlled(b.id) || !isSingle(b) || !romanticallyCompatible(a, b)) continue;
      const compat = compatibility(a, b);
      if (compat < 0.55) continue;
      if (!ctx.rng.chance(0.015 + (rel.romance > 10 ? 0.05 : 0))) continue;
      setFlags(ctx, a, b, [{ flag: 'dating', op: 'add' }], 'npc:romance');
      ctx.applyEffects(a.id, { relationships: [{ simId: b.id, romance: 15, mutual: true }] }, 'npc:romance');
      a.flags[`dating_since:${b.id}`] = now;
      b.flags[`dating_since:${a.id}`] = now;
      if (knownBy(ctx, a.id) || knownBy(ctx, b.id)) ctx.log({ text: `Word is ${simName(a)} and ${simName(b)} are seeing each other.`, kind: 'relationship', importance: 1 });
      break;
    }
  }
  for (const a of npcs) {
    for (const rel of Object.values(a.relationships)) {
      if (!rel.flags.includes('dating') || rel.flags.includes('married') || rel.flags.includes('engaged')) continue;
      const b = ctx.state.sims[rel.simId];
      if (!b || ctx.query.isControlled(b.id)) continue;
      const compat = compatibility(a, b);
      const days = (now - Number(a.flags[`dating_since:${b.id}`] ?? now)) / DAY;
      if (ctx.rng.chance(0.004 * (1.4 - compat) + (rel.romance < 0 ? 0.03 : 0))) {
        setFlags(ctx, a, b, [{ flag: 'dating', op: 'remove' }, { flag: 'partner', op: 'remove' }, { flag: 'ex', op: 'add' }], 'npc:breakup');
        ctx.applyEffects(a.id, { relationships: [{ simId: b.id, romance: -30, mutual: true }] }, 'npc:breakup');
        delete a.flags[`dating_since:${b.id}`];
        delete b.flags[`dating_since:${a.id}`];
        if (knownBy(ctx, a.id) || knownBy(ctx, b.id)) ctx.log({ text: `${simName(a)} and ${simName(b)} broke up.`, kind: 'relationship', importance: 1 });
      } else if (days > 365 && compat > 0.65 && ctx.rng.chance(0.003)) {
        setFlags(ctx, a, b, [{ flag: 'engaged', op: 'add' }, { flag: 'partner', op: 'add' }], 'npc:engaged');
        if (knownBy(ctx, a.id) || knownBy(ctx, b.id)) ctx.log({ text: `${simName(a)} and ${simName(b)} got engaged.`, kind: 'relationship', importance: 1 });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------
function autonomous(ctx: SystemContext, sim: Sim): boolean {
  return !ctx.query.isControlled(sim.id) || sim.flags.autonomy === true;
}

function updateLod(ctx: SystemContext): { full: Sim[]; near: Sim[]; far: Sim[] } {
  const controlled = ctx.query.controlledSims();
  const venues = new Set(controlled.map((c) => c.location.venueId));
  const households = new Set(controlled.map((c) => c.householdId).filter(Boolean));
  const known = new Set<SimId>();
  for (const c of controlled) for (const r of Object.values(c.relationships)) if (r.familiarity >= 5) known.add(r.simId);
  const full: Sim[] = [];
  const near: Sim[] = [];
  const far: Sim[] = [];
  for (const sim of Object.values(ctx.state.sims)) {
    if (!sim.body.alive) continue;
    if (ctx.query.isControlled(sim.id)) {
      if (sim.lod !== 'full') {
        sim.lod = 'full';
        ctx.emit({ type: 'sim:lod_changed', simId: sim.id, lod: 'full' });
      }
      if (sim.flags.autonomy === true) full.push(sim);
      continue;
    }
    const lod: SimLOD = venues.has(sim.location.venueId) || (sim.travel && venues.has(sim.travel.toVenueId)) || (sim.householdId && households.has(sim.householdId)) ? 'full' : known.has(sim.id) ? 'near' : 'far';
    if (sim.lod !== lod) {
      sim.lod = lod;
      ctx.emit({ type: 'sim:lod_changed', simId: sim.id, lod });
      if (lod !== 'full') pending.delete(sim.id);
    }
    (lod === 'full' ? full : lod === 'near' ? near : far).push(sim);
  }
  return { full, near, far };
}

export const npcAISystem: System = {
  id: 'npcAI',
  intervalMinutes: 5,
  onInit() {
    pending.clear();
    lastDecision.clear();
  },
  onTick(ctx) {
    const now = ctx.state.time.minute;
    const { full, near, far } = updateLod(ctx);
    const byVenue = new Map<VenueId, Sim[]>();
    for (const s of ctx.query.aliveSims()) {
      if (s.travel) continue;
      const list = byVenue.get(s.location.venueId);
      if (list) list.push(s);
      else byVenue.set(s.location.venueId, [s]);
    }
    for (const s of full) if (autonomous(ctx, s)) tickFull(ctx, s, byVenue.get(s.location.venueId) ?? []);
    if (Math.floor(now / 5) % 3 === 0) for (const s of near) tickNear(ctx, s);
    const day = Math.floor(now / DAY);
    if (Number(ctx.state.flags['npc:lastDay'] ?? -1) !== day) {
      ctx.state.flags['npc:lastDay'] = day;
      for (const s of far) tickFar(ctx, s);
      dailyProgression(ctx);
    }
  },
  onEvent(ctx, e: GameEvent) {
    switch (e.type) {
      case 'world:new_game':
      case 'world:loaded':
        for (const s of ctx.query.aliveSims()) if (autonomous(ctx, s)) ensureSchedule(ctx, s);
        break;
      case 'action:completed':
        completeAction(ctx, e.simId, e.actionId);
        break;
      case 'action:interrupted':
        if (pending.get(e.simId)?.id === e.actionId) pending.delete(e.simId);
        break;
      case 'career:hired':
      case 'career:fired':
      case 'career:quit': {
        const s = ctx.state.sims[e.simId];
        if (s && autonomous(ctx, s)) {
          s.schedule = s.schedule.filter((b) => b.kind !== 'work');
          ensureSchedule(ctx, s);
        }
        break;
      }
      case 'sim:born': {
        const s = ctx.state.sims[e.simId];
        if (s) ensureSchedule(ctx, s);
        break;
      }
      default:
        break;
    }
  },
  actions(ctx) {
    return pendingInterruptActions(ctx, 'npcai:');
  },
  handles: (id) => id.startsWith('npcai:'),
  execute(_ctx, _simId, action): ActionResult {
    if (action.id.startsWith('npcai:ignore')) return { ok: true, text: 'You give a small wave and get on with your day.' };
    return { ok: false, text: 'Unknown.' };
  },
};
