/**
 * Family system — aging & birthdays, natural death, conception → pregnancy → birth, baby care,
 * childcare (daycare / babysitter / CPS risk), engagement → wedding → marriage, divorce & custody,
 * household management (move in / kick out / move out), adoption, holiday family visits,
 * death handling (inheritance, grief, funeral).
 *
 * Emits: sim:aged_up, sim:died, sim:pregnant, sim:born, family:birth, family:married, family:divorced,
 *        family:moved_in, family:moved_out, family:custody, family:adoption, money via applyEffects,
 *        custom legal:child_neglect
 * Consumes: time:day, time:hour (via tick), custom family:conception, custom health:pregnancy_test,
 *           family:proposal, scheduled:fired (my kinds), calendar:holiday, sim:died
 * Action prefix: `family:`
 *
 * Test knob: `state.flags.fastPregnancy = true` → pregnancy lasts 2 days (known after 12 h),
 * adoption home study 1 day.
 */
import { ageAt, isoDateAt } from '../core/clock';
import { ensureRelationship, liquidCash, transact } from '../core/effects';
import type { GameEvent } from '../core/events';
import { lifeStageForAge, makeHousehold, makeSim } from '../core/factories';
import { simName } from '../core/query';
import type { ActionResult, System, SystemContext } from '../core/systems';
import type { ActionDef, AvatarParams, Household, RelationshipFlag, Requirement, Sim, SimId, VenueId } from '../core/types';
import { clamp, DAY, HOUR, round2 } from '../core/util';
import { blocked, breakUp, hasTrait, isAdult, isKid, isPartnered, partnerOf, pendingInterruptActions, pushMemory, setFlags } from './relationships';

const FALLBACK_FIRST: Record<'male' | 'female' | 'nonbinary', string[]> = {
  male: ['Liam', 'Noah', 'Oliver', 'Elijah', 'Mateo', 'Lucas', 'Levi', 'Ezra', 'Asher', 'Theo', 'Miles', 'Jaxon', 'Kai', 'Andre', 'Diego', 'Owen', 'Caleb', 'Isaiah', 'Nolan', 'Silas'],
  female: ['Olivia', 'Emma', 'Amelia', 'Sophia', 'Isabella', 'Mia', 'Luna', 'Camila', 'Harper', 'Evelyn', 'Nora', 'Zoe', 'Maya', 'Aria', 'Layla', 'Ivy', 'Willow', 'Naomi', 'Elena', 'Ruby'],
  nonbinary: ['Sam', 'River', 'Rowan', 'Sage', 'Quinn', 'Avery', 'Jules', 'Emery', 'Phoenix', 'Remy'],
};
const HOLIDAY_VISITS = new Set(['thanksgiving', 'christmas', 'easter', 'mothers_day', 'fathers_day', 'independence_day', 'new_years_day']);
const FAMILY_REL: RelationshipFlag[] = ['parent', 'child', 'sibling', 'grandparent', 'grandchild'];

const first = (s: Sim) => s.identity.firstName;
const isControlled = (ctx: SystemContext, id: SimId) => ctx.query.isControlled(id);
const fast = (ctx: SystemContext) => ctx.state.flags.fastPregnancy === true;
const col = (ctx: SystemContext) => ctx.state.region.costOfLiving || 1;

function pickName(ctx: SystemContext, gender: Sim['identity']['gender']): string {
  const list = ctx.content.names?.first?.[gender];
  const pool = list && list.length >= 5 ? list : FALLBACK_FIRST[gender];
  return ctx.rng.pick(pool);
}

function childrenOf(ctx: SystemContext, sim: Sim): Sim[] {
  return Object.values(sim.relationships)
    .filter((r) => r.flags.includes('child') || r.flags.includes('step_child'))
    .map((r) => ctx.state.sims[r.simId])
    .filter((s): s is Sim => !!s && s.body.alive);
}
function parentsOf(ctx: SystemContext, sim: Sim): Sim[] {
  return Object.values(sim.relationships)
    .filter((r) => r.flags.includes('parent'))
    .map((r) => ctx.state.sims[r.simId])
    .filter((s): s is Sim => !!s && s.body.alive);
}
function relatedWith(ctx: SystemContext, sim: Sim, flags: RelationshipFlag[]): Sim[] {
  return Object.values(sim.relationships)
    .filter((r) => r.flags.some((f) => flags.includes(f)))
    .map((r) => ctx.state.sims[r.simId])
    .filter((s): s is Sim => !!s && s.body.alive);
}

function link(ctx: SystemContext, a: Sim, b: Sim, flagAB: RelationshipFlag, flagBA: RelationshipFlag, base = 40): void {
  const now = ctx.state.time.minute;
  const ra = ensureRelationship(a, b.id, now);
  const rb = ensureRelationship(b, a.id, now);
  if (!ra.flags.includes(flagAB)) ra.flags.push(flagAB);
  if (!rb.flags.includes(flagBA)) rb.flags.push(flagBA);
  ra.decayRate = 0.05;
  rb.decayRate = 0.05;
  ra.familiarity = Math.max(ra.familiarity, 60);
  rb.familiarity = Math.max(rb.familiarity, 60);
  ra.friendship = Math.max(ra.friendship, base);
  rb.friendship = Math.max(rb.friendship, base);
  ra.trust = Math.max(ra.trust, base);
  rb.trust = Math.max(rb.trust, base);
  ctx.emit({ type: 'relationship:flag', simId: a.id, otherId: b.id, flag: flagAB, op: 'add' });
  ctx.emit({ type: 'relationship:flag', simId: b.id, otherId: a.id, flag: flagBA, op: 'add' });
}

// ---------------------------------------------------------------------------
// Aging & death
// ---------------------------------------------------------------------------
function birthdays(ctx: SystemContext): void {
  const iso = ctx.clock.isoDate;
  const mmdd = iso.slice(5);
  const year = iso.slice(0, 4);
  for (const sim of ctx.query.aliveSims()) {
    const bd = sim.identity.birthDate.slice(5);
    const leapFix = bd === '02-29' && mmdd === '02-28' && iso.slice(5) !== '02-29';
    if (bd !== mmdd && !leapFix) continue;
    const key = `bday:${year}`;
    if (sim.flags[key]) continue;
    sim.flags[key] = true;
    const age = ageAt(sim.identity.birthDate, ctx.state.epoch, ctx.state.time.minute);
    const stage = lifeStageForAge(age);
    const changed = stage !== sim.lifeStage;
    sim.lifeStage = stage;
    if (age === 16 && sim.legal.license.status === 'none') sim.legal.license.status = 'none';
    if (age === 15 && sim.body.fertility === 0) sim.body.fertility = 0.7;
    if (age === 51) sim.body.fertility = 0;
    ctx.emit({ type: 'calendar:birthday', simId: sim.id, age });
    const known = isControlled(ctx, sim.id) || ctx.query.controlledSims().some((c) => (c.relationships[sim.id]?.familiarity ?? 0) >= 20 || c.householdId === sim.householdId);
    if (changed) {
      ctx.emit({ type: 'sim:aged_up', simId: sim.id, stage });
      if (known) ctx.log({ text: isControlled(ctx, sim.id) ? `You turn ${age} today — you're ${stage.replace('_', ' ')} now.` : `${simName(sim)} turns ${age} today.`, kind: 'event', simId: sim.id, importance: 3 });
    } else if (known) ctx.log({ text: isControlled(ctx, sim.id) ? `Happy birthday — you're ${age}.` : `It's ${simName(sim)}'s birthday (${age}).`, kind: 'event', simId: sim.id, importance: 2 });
    if (sim.lod !== 'far') ctx.applyEffects(sim.id, { moodlets: [{ emotion: 'happy', label: `Birthday (${age})`, intensity: hasTrait(sim, 'gloomy') ? 2 : 8, durationMinutes: DAY }] }, 'birthday');
    if (isControlled(ctx, sim.id)) sim.flags.birthday_today = ctx.state.time.minute;
    pushMemory(sim, { kind: 'milestone', text: `I turned ${age}.`, salience: 50, valence: 0.4, tags: ['birthday'] }, ctx.state.time.minute, ctx.rng);
  }
}

function naturalDeath(ctx: SystemContext): void {
  for (const sim of ctx.query.aliveSims()) {
    const age = ctx.query.ageOf(sim);
    if (age < 65) continue;
    const annual = age >= 75 ? 0.03 + (age - 75) * 0.012 : 0.01;
    const healthMult = sim.body.health < 40 ? 2 : sim.body.health > 80 ? 0.7 : 1;
    if (!ctx.rng.chance((annual * healthMult) / 365)) continue;
    sim.body.alive = false;
    sim.body.deathCause = 'natural causes';
    sim.body.diedAt = ctx.state.time.minute;
    sim.currentAction = undefined;
    ctx.emit({ type: 'sim:died', simId: sim.id, cause: 'natural causes' });
  }
}

function onDied(ctx: SystemContext, dead: Sim, cause: string): void {
  const now = ctx.state.time.minute;
  if (dead.flags.death_handled) return;
  dead.flags.death_handled = true;
  dead.body.alive = false;
  dead.body.diedAt ??= now;
  dead.body.deathCause ??= cause;
  ctx.state.stats.deaths += 1;
  const hh = ctx.query.householdOf(dead.id);
  // inheritance: liquid assets to spouse, else children equally
  const estate = liquidCash(dead);
  const spouseId = Object.values(dead.relationships).find((r) => r.flags.includes('married'))?.simId;
  const spouse = spouseId ? ctx.state.sims[spouseId] : undefined;
  const heirs = spouse && spouse.body.alive ? [spouse] : childrenOf(ctx, dead).filter((c) => c.body.alive);
  if (estate > 0 && heirs.length) {
    const share = round2(estate / heirs.length);
    for (const acc of dead.finance.accounts) if (acc.kind === 'cash' || acc.kind === 'checking' || acc.kind === 'savings') acc.balance = 0;
    for (const h of heirs) {
      transact(h, share, `Inheritance from ${simName(dead)}`, now, { category: 'inheritance', counterparty: simName(dead), rng: ctx.rng });
      if (isControlled(ctx, h.id)) ctx.log({ text: `You inherit $${share.toFixed(2)} from ${simName(dead)}.`, kind: 'money', simId: h.id, importance: 2 });
    }
  }
  // grief
  for (const other of ctx.query.aliveSims()) {
    const rel = other.relationships[dead.id];
    if (!rel) continue;
    const family = rel.flags.some((f) => FAMILY_REL.includes(f) || f === 'married' || f === 'partner' || f === 'engaged' || f === 'dating');
    const close = rel.friendship >= 30;
    if (!family && !close) continue;
    other.flags[`grieving:${dead.id}`] = now;
    ctx.applyEffects(other.id, { moodlets: [{ emotion: 'grieving', label: `${first(dead)} passed away`, intensity: family ? -20 : -8, durationMinutes: family ? DAY * 14 : DAY * 7, id: `grief:${dead.id}` }], stress: family ? 15 : 5 }, 'death');
    pushMemory(other, { kind: 'event', text: `${simName(dead)} died (${dead.body.deathCause}).`, participants: [dead.id], salience: family ? 90 : 60, valence: -1, tags: ['death'] }, now, ctx.rng);
    if (isControlled(ctx, other.id)) ctx.log({ text: `${simName(dead)} has died (${dead.body.deathCause}).`, kind: 'event', simId: other.id, importance: 3 });
  }
  if (hh) {
    hh.simIds = hh.simIds.filter((id) => id !== dead.id);
    // orphaned children → custody to surviving parent
    for (const kid of childrenOf(ctx, dead)) {
      if (!isAdult(kid) && kid.householdId === hh.id) {
        const otherParent = parentsOf(ctx, kid).find((p) => p.id !== dead.id);
        if (otherParent && otherParent.householdId && otherParent.householdId !== hh.id) moveToHousehold(ctx, kid, otherParent.householdId, 'custody');
        if (otherParent) ctx.emit({ type: 'family:custody', childId: kid.id, guardianId: otherParent.id });
      }
    }
  }
  if (isControlled(ctx, dead.id)) {
    ctx.state.player.controlledSimIds = ctx.state.player.controlledSimIds.filter((id) => id !== dead.id);
    const others = ctx.state.player.controlledSimIds;
    ctx.log({ text: `${simName(dead)} has died. Cause: ${dead.body.deathCause}.`, kind: 'event', simId: dead.id, importance: 3 });
    if (others.length) {
      ctx.interrupt({ kind: 'death', title: `${simName(dead)} has died`, body: `Cause: ${dead.body.deathCause}. Your story continues with the rest of the household.`, simId: dead.id, options: others.map((id) => ({ label: `Continue as ${simName(ctx.state.sims[id])}`, actionId: `family:switch_sim:${id}` })) });
    } else {
      ctx.interrupt({ kind: 'death', title: `${simName(dead)} has died`, body: `Cause: ${dead.body.deathCause}. This is the end of the story.`, simId: dead.id, options: [{ label: 'Accept', actionId: 'family:game_over' }] });
    }
  } else {
    const mourners = ctx.query.controlledSims().filter((c) => c.flags[`grieving:${dead.id}`]);
    if (mourners.length) ctx.interrupt({ kind: 'death', title: `${simName(dead)} has died`, body: `You get the call: ${simName(dead)} passed away (${dead.body.deathCause}). A funeral can be arranged at a funeral home.`, simId: mourners[0].id, fromSimId: dead.id, options: [{ label: 'Take a moment', actionId: `family:acknowledge_death:${dead.id}` }] });
  }
}

// ---------------------------------------------------------------------------
// Pregnancy & birth
// ---------------------------------------------------------------------------
function conceive(ctx: SystemContext, aId: SimId, bId: SimId): void {
  const a = ctx.state.sims[aId];
  const b = ctx.state.sims[bId];
  if (!a || !b) return;
  const mother = [a, b].find((s) => s.identity.gender === 'female');
  const father = [a, b].find((s) => s.id !== mother?.id);
  if (!mother || !father || mother.body.pregnancy || !mother.body.alive) return;
  const age = ctx.query.ageOf(mother);
  if (age < 15 || age > 50) return;
  const fert = mother.body.fertility * (age > 40 ? 0.5 : age > 35 ? 0.8 : 1);
  if (!ctx.rng.chance(clamp(fert, 0, 1))) return;
  const now = ctx.state.time.minute;
  const dueIn = fast(ctx) ? 2 * DAY : 280 * DAY;
  mother.body.pregnancy = { conceivedAt: now, dueAt: now + dueIn, otherParentId: father.id, known: false, complications: 0 };
  ctx.emit({ type: 'sim:pregnant', simId: mother.id, otherParentId: father.id });
  ctx.schedule({ atMinute: now + (fast(ctx) ? 12 * HOUR : 28 * DAY), kind: '_pregnancy_known', label: 'pregnancy becomes noticeable', simId: mother.id });
  ctx.schedule({ atMinute: now + dueIn, kind: '_pregnancy_due', label: 'due date', simId: mother.id });
}

function revealPregnancy(ctx: SystemContext, mother: Sim, via: string): void {
  const p = mother.body.pregnancy;
  if (!p || p.known) return;
  p.known = true;
  const father = p.otherParentId ? ctx.state.sims[p.otherParentId] : undefined;
  ctx.schedule({ atMinute: p.dueAt, kind: 'pregnancy_due', label: `${first(mother)}'s due date`, simId: mother.id });
  const wanted = mother.personality.values.family > 0.4 || isPartnered(father ? mother.relationships[father.id] : undefined);
  ctx.applyEffects(mother.id, { moodlets: [{ emotion: wanted ? 'hopeful' : 'anxious', label: 'Expecting a baby', intensity: wanted ? 10 : -8, durationMinutes: DAY * 7 }] }, 'pregnancy');
  pushMemory(mother, { kind: 'milestone', text: `I found out I'm pregnant${father ? ` (${simName(father)} is the father)` : ''}.`, participants: father ? [father.id] : [], salience: 90, valence: wanted ? 0.8 : -0.2, tags: ['pregnancy'] }, ctx.state.time.minute, ctx.rng);
  if (isControlled(ctx, mother.id)) ctx.log({ text: via === 'test' ? `The test is positive. You're pregnant.` : `You've been feeling off for weeks — you're pregnant.`, kind: 'event', simId: mother.id, importance: 3 });
  else if (father && isControlled(ctx, father.id)) ctx.log({ text: `${simName(mother)} tells you she's pregnant.`, kind: 'event', simId: father.id, importance: 3 });
  else if (ctx.query.controlledSims().some((c) => (c.relationships[mother.id]?.familiarity ?? 0) >= 20)) ctx.log({ text: `You hear ${simName(mother)} is expecting.`, kind: 'event', importance: 1 });
  if (father && father.lod !== 'far') ctx.applyEffects(father.id, { moodlets: [{ emotion: wanted ? 'hopeful' : 'anxious', label: 'Going to be a parent', intensity: wanted ? 8 : -6, durationMinutes: DAY * 7 }] }, 'pregnancy');
}

function labor(ctx: SystemContext, mother: Sim): void {
  const p = mother.body.pregnancy;
  if (!p || p.dueAt > ctx.state.time.minute) return;
  const venue = ctx.query.venueMaybe(mother.location.venueId);
  if (venue?.archetype === 'hospital') {
    deliver(ctx, mother, true);
    return;
  }
  if (!isControlled(ctx, mother.id) || mother.flags.labor_started) {
    deliver(ctx, mother, false);
    return;
  }
  mother.flags.labor_started = ctx.state.time.minute;
  mother.currentAction = undefined;
  const hospital = ctx.query.nearestVenue(mother.location.venueId, 'hospital');
  ctx.log({ text: `Your water breaks. The baby is coming.`, kind: 'alert', simId: mother.id, importance: 3 });
  ctx.interrupt({ kind: 'birth', title: 'The baby is coming', body: hospital ? `Contractions are minutes apart. ${hospital.name} is ${ctx.query.distanceKm(mother.location.venueId, hospital.id).toFixed(1)} km away.` : 'Contractions are minutes apart. There is no hospital nearby.', simId: mother.id, options: [...(hospital ? [{ label: 'Rush to the hospital', actionId: 'family:rush_hospital', params: { venueId: hospital.id } }] : []), { label: 'Deliver at home', actionId: 'family:home_birth' }] });
  ctx.schedule({ inMinutes: 4 * HOUR, kind: '_labor_timeout', label: 'labor', simId: mother.id });
}

function blendAvatar(rng: SystemContext['rng'], m: AvatarParams, f: AvatarParams, gender: Sim['identity']['gender']): AvatarParams {
  const pick = <T,>(a: T, b: T): T => (rng.chance(0.5) ? a : b);
  return { skin: pick(m.skin, f.skin), hair: pick(m.hair, f.hair), hairStyle: rng.int(0, 7), eye: pick(m.eye, f.eye), faceShape: pick(m.faceShape, f.faceShape), accessory: 0, clothing: pick(m.clothing, f.clothing), facialHair: 0, glasses: rng.chance(m.glasses && f.glasses ? 0.5 : 0.1) && gender !== 'nonbinary' };
}

function deliver(ctx: SystemContext, mother: Sim, atHospital: boolean): Sim | undefined {
  const p = mother.body.pregnancy;
  if (!p) return undefined;
  const now = ctx.state.time.minute;
  mother.body.pregnancy = undefined;
  delete mother.flags.labor_started;
  ctx.state.scheduled = ctx.state.scheduled.filter((e) => !(e.simId === mother.id && (e.kind === '_pregnancy_due' || e.kind === 'pregnancy_due' || e.kind === '_labor_timeout' || e.kind === '_pregnancy_known')));
  const father = p.otherParentId ? ctx.state.sims[p.otherParentId] : undefined;
  const gender: Sim['identity']['gender'] = ctx.rng.chance(0.512) ? 'male' : 'female';
  const married = father ? !!mother.relationships[father.id]?.flags.includes('married') : false;
  const lastName = married && father ? mother.identity.lastName : mother.identity.lastName;
  const heritage = father && father.identity.heritage !== mother.identity.heritage ? `${mother.identity.heritage} and ${father.identity.heritage}` : mother.identity.heritage;
  const baby = makeSim({ firstName: pickName(ctx, gender), lastName, gender, age: 0, epoch: ctx.state.epoch, rng: ctx.rng, venueId: mother.location.venueId, householdId: mother.householdId, startingCash: 0, lod: 'full', createdAt: now });
  baby.identity.birthDate = isoDateAt(ctx.state.epoch, now);
  baby.identity.heritage = heritage;
  baby.identity.hometown = ctx.state.region.name;
  baby.identity.appearance = { hair: ctx.rng.pick([mother.identity.appearance.hair, father?.identity.appearance.hair ?? mother.identity.appearance.hair]), eyes: ctx.rng.pick([mother.identity.appearance.eyes, father?.identity.appearance.eyes ?? mother.identity.appearance.eyes]), build: 'tiny', style: 'onesie', distinguishing: [], avatar: blendAvatar(ctx.rng, mother.identity.appearance.avatar, father?.identity.appearance.avatar ?? mother.identity.appearance.avatar, gender) };
  baby.lifeStage = 'infant';
  baby.body.fertility = 0;
  baby.body.health = atHospital ? 95 : ctx.rng.chance(0.15) ? 70 : 90;
  baby.body.insurance = { ...mother.body.insurance, kind: mother.body.insurance.kind === 'none' ? 'medicaid' : 'parent' };
  baby.legal.license.status = 'none';
  baby.schedule = [];
  baby.needs = { hunger: 70, thirst: 70, energy: 60, bladder: 60, hygiene: 70, social: 80, fun: 60, comfort: 70 };
  ctx.state.sims[baby.id] = baby;
  const hh = ctx.query.householdOf(mother.id);
  if (hh && !hh.simIds.includes(baby.id)) hh.simIds.push(baby.id);
  // relationships
  link(ctx, mother, baby, 'child', 'parent', 60);
  if (father) link(ctx, father, baby, 'child', 'parent', 55);
  const parents = [mother, ...(father ? [father] : [])];
  const siblings = new Set<SimId>();
  for (const par of parents) for (const c of childrenOf(ctx, par)) if (c.id !== baby.id) siblings.add(c.id);
  for (const sid of siblings) link(ctx, ctx.state.sims[sid], baby, 'sibling', 'sibling', 30);
  for (const par of parents) {
    for (const gp of parentsOf(ctx, par)) link(ctx, gp, baby, 'grandchild', 'grandparent', 40);
    for (const au of relatedWith(ctx, par, ['sibling'])) link(ctx, au, baby, 'niece_nephew', 'aunt_uncle', 25);
  }
  ctx.state.stats.births += 1;
  ctx.emit({ type: 'sim:born', simId: baby.id, parentIds: parents.map((s) => s.id) });
  ctx.emit({ type: 'family:birth', parentIds: parents.map((s) => s.id), childId: baby.id });
  // bill
  const gross = round2(ctx.rng.range(4000, 12000) * col(ctx) * (atHospital ? 1 : 0.25));
  const ins = mother.body.insurance;
  let patient = gross;
  if (ins.kind !== 'none') {
    const ded = Math.max(0, ins.deductible - ins.deductibleMet);
    const afterDed = Math.max(0, gross - ded);
    patient = Math.min(ded, gross) + afterDed * ins.coinsurance;
    if (ins.kind === 'medicaid') patient = 0;
    ins.deductibleMet = Math.min(ins.deductible, ins.deductibleMet + Math.min(ded, gross));
    patient = Math.min(patient, 9100);
  }
  patient = round2(patient);
  if (patient > 0) ctx.applyEffects(mother.id, { money: { amount: -patient, memo: atHospital ? 'Hospital delivery' : 'Midwife / postnatal care', category: 'medical', counterparty: atHospital ? ctx.query.venueMaybe(mother.location.venueId)?.name ?? 'Hospital' : 'Midwife' } }, 'birth');
  // parents' state
  mother.flags.maternity_leave_until = now + 6 * 7 * DAY;
  if (father) father.flags.paternity_leave_until = now + 2 * 7 * DAY;
  const homeBirthTrouble = !atHospital && ctx.rng.chance(0.08);
  ctx.applyEffects(mother.id, { needs: { energy: -50, hygiene: -30, hunger: -20 }, health: homeBirthTrouble ? -15 : -5, moodlets: [{ emotion: 'happy', label: `${baby.identity.firstName} was born`, intensity: 15, durationMinutes: DAY * 7 }] }, 'birth');
  if (father && father.lod !== 'far') ctx.applyEffects(father.id, { moodlets: [{ emotion: 'proud', label: `${baby.identity.firstName} was born`, intensity: 12, durationMinutes: DAY * 7 }] }, 'birth');
  for (const par of parents) pushMemory(par, { kind: 'milestone', text: `${baby.identity.firstName} was born${atHospital ? ' at the hospital' : ' at home'}.`, participants: [baby.id, ...parents.filter((x) => x.id !== par.id).map((x) => x.id)], salience: 100, valence: 1, tags: ['birth'] }, now, ctx.rng);
  const anyControlled = parents.some((s) => isControlled(ctx, s.id));
  if (anyControlled) {
    ctx.log({ text: `It's a ${gender === 'male' ? 'boy' : 'girl'}! ${baby.identity.firstName} ${lastName} is born${atHospital ? '' : ' at home'}${patient > 0 ? ` (bill: $${patient.toFixed(2)})` : ''}.`, kind: 'event', simId: mother.id, importance: 3 });
    if (homeBirthTrouble) ctx.log({ text: 'The home birth had complications. You need rest.', kind: 'alert', simId: mother.id, importance: 2 });
    ctx.interrupt({ kind: 'birth', title: `It's a ${gender === 'male' ? 'boy' : 'girl'}!`, body: `${baby.identity.firstName} ${lastName}, ${(2.5 + ctx.rng.next() * 1.5).toFixed(1)} kg.`, simId: isControlled(ctx, mother.id) ? mother.id : father!.id, options: [{ label: 'Hold the baby', actionId: `family:${baby.id}:soothe` }] });
  } else if (ctx.query.controlledSims().some((c) => (c.relationships[mother.id]?.familiarity ?? 0) >= 20)) ctx.log({ text: `${simName(mother)} had a baby: ${baby.identity.firstName}.`, kind: 'event', importance: 1 });
  return baby;
}

// ---------------------------------------------------------------------------
// Children: crying, childcare, CPS
// ---------------------------------------------------------------------------
function babyChecks(ctx: SystemContext): void {
  const now = ctx.state.time.minute;
  for (const c of ctx.query.controlledSims()) {
    const hh = ctx.query.householdOf(c.id);
    if (!hh) continue;
    for (const id of hh.simIds) {
      const kid = ctx.state.sims[id];
      if (!kid || !kid.body.alive || !isKid(kid) || kid.location.venueId !== c.location.venueId) continue;
      const low = (['hunger', 'bladder', 'energy', 'comfort', 'social'] as const).filter((n) => kid.needs[n] < 25);
      if (!low.length) continue;
      const last = Number(kid.flags.last_cry ?? -1e9);
      if (now - last < 2 * HOUR) continue;
      kid.flags.last_cry = now;
      const night = ctx.clock.minuteOfDay >= 22 * HOUR || ctx.clock.minuteOfDay < 6 * HOUR;
      ctx.applyEffects(c.id, { moodlets: [{ emotion: 'stressed', label: `${first(kid)} is crying`, intensity: night ? -6 : -3, durationMinutes: 90 }] }, 'baby:crying');
      ctx.interrupt({ kind: 'need_critical', title: `${first(kid)} is crying`, body: `${night ? 'It is the middle of the night. ' : ''}${first(kid)} needs ${low.map((n) => (n === 'hunger' ? 'feeding' : n === 'bladder' ? 'a diaper change' : n === 'energy' ? 'a nap' : n === 'social' ? 'attention' : 'soothing')).join(', ')}.`, simId: c.id, fromSimId: kid.id, options: [{ label: 'Feed', actionId: `family:${kid.id}:feed` }, { label: 'Change diaper', actionId: `family:${kid.id}:diaper` }, { label: 'Soothe', actionId: `family:${kid.id}:soothe` }, { label: 'Put down for a nap', actionId: `family:${kid.id}:nap` }] });
      break;
    }
  }
}

function cpsCheck(ctx: SystemContext): void {
  const now = ctx.state.time.minute;
  const seen = new Set<string>();
  for (const c of ctx.query.controlledSims()) {
    const hh = ctx.query.householdOf(c.id);
    if (!hh || seen.has(hh.id)) continue;
    seen.add(hh.id);
    const members = hh.simIds.map((id) => ctx.state.sims[id]).filter((s): s is Sim => !!s && s.body.alive);
    const home = hh.homeVenueId;
    const youngAtHome = members.filter((s) => ctx.query.ageOf(s) < 12 && s.location.venueId === home && !s.flags.daycare_active);
    if (!youngAtHome.length) {
      delete ctx.state.flags[`unattended_since:${hh.id}`];
      continue;
    }
    const supervised = members.some((s) => ctx.query.ageOf(s) >= 13 && s.location.venueId === home && !s.travel) || Number(ctx.state.flags[`babysitter:${hh.id}`] ?? 0) > now;
    if (supervised) {
      delete ctx.state.flags[`unattended_since:${hh.id}`];
      continue;
    }
    const since = Number(ctx.state.flags[`unattended_since:${hh.id}`] ?? now);
    ctx.state.flags[`unattended_since:${hh.id}`] ??= now;
    if (now - since < 45) continue;
    const parent = members.find((s) => isControlled(ctx, s.id) && isAdult(s)) ?? c;
    const dayKey = `cps_warned:${hh.id}:${Math.floor(now / DAY)}`;
    if (!ctx.state.flags[dayKey]) {
      ctx.state.flags[dayKey] = true;
      ctx.log({ text: `${youngAtHome.map(first).join(' and ')} ${youngAtHome.length > 1 ? 'are' : 'is'} home alone.`, kind: 'alert', simId: parent.id, importance: 2 });
    }
    for (const kid of youngAtHome) ctx.applyEffects(kid.id, { moodlets: [{ emotion: 'scared', label: 'Home alone', intensity: -6, durationMinutes: 180, id: 'home_alone' }] }, 'home_alone');
    if (ctx.rng.chance(0.02 * (ctx.query.ageOf(youngAtHome[0]) < 6 ? 2 : 1))) {
      ctx.emit({ type: 'custom', kind: 'legal:child_neglect', simId: parent.id, payload: { childIds: youngAtHome.map((k) => k.id), venueId: home } });
      ctx.log({ text: `A neighbor noticed the kids were alone and called it in.`, kind: 'alert', simId: parent.id, importance: 2 });
    }
  }
}

// ---------------------------------------------------------------------------
// Households
// ---------------------------------------------------------------------------
function moveToHousehold(ctx: SystemContext, sim: Sim, targetHhId: string, reason: string): void {
  const now = ctx.state.time.minute;
  const target = ctx.state.households[targetHhId as Household['id']];
  if (!target) return;
  const old = ctx.query.householdOf(sim.id);
  if (old && old.id === target.id) return;
  if (old) {
    old.simIds = old.simIds.filter((id) => id !== sim.id);
    ctx.emit({ type: 'family:moved_out', simId: sim.id, householdId: old.id });
    if (old.simIds.length === 0) delete ctx.state.households[old.id];
  }
  if (!target.simIds.includes(sim.id)) target.simIds.push(sim.id);
  sim.householdId = target.id;
  sim.finance.bills = sim.finance.bills.filter((b) => b.linkedId !== 'family:room_rent');
  sim.travel = undefined;
  sim.location = { venueId: target.homeVenueId, arrivedAt: now };
  for (const id of target.simIds) {
    if (id === sim.id) continue;
    const o = ctx.state.sims[id];
    if (!o) continue;
    const r = ensureRelationship(sim, o.id, now);
    const r2 = ensureRelationship(o, sim.id, now);
    const related = r.flags.some((f) => FAMILY_REL.includes(f) || f === 'married' || f === 'partner' || f === 'engaged' || f === 'dating');
    if (!related && !r.flags.includes('roommate')) r.flags.push('roommate');
    if (!related && !r2.flags.includes('roommate')) r2.flags.push('roommate');
  }
  ctx.emit({ type: 'family:moved_in', simId: sim.id, householdId: target.id });
  ctx.emit({ type: 'sim:arrived', simId: sim.id, venueId: target.homeVenueId });
  if (ctx.query.controlledSims().some((c) => c.householdId === target.id || (old && c.householdId === old.id) || c.id === sim.id)) ctx.log({ text: isControlled(ctx, sim.id) ? `You move in with ${target.name}${reason ? ` (${reason})` : ''}.` : `${simName(sim)} moves in${reason ? ` (${reason})` : ''}.`, kind: 'event', simId: sim.id, importance: 2 });
}

function moveOut(ctx: SystemContext, sim: Sim, reason: string): boolean {
  const now = ctx.state.time.minute;
  const old = ctx.query.householdOf(sim.id);
  const apt = ctx.query.nearestVenue(sim.location.venueId, 'apartment_building');
  if (!apt) return false;
  if (old) {
    old.simIds = old.simIds.filter((id) => id !== sim.id);
    ctx.emit({ type: 'family:moved_out', simId: sim.id, householdId: old.id });
    for (const id of old.simIds) {
      const o = ctx.state.sims[id];
      if (o?.relationships[sim.id]) o.relationships[sim.id].flags = o.relationships[sim.id].flags.filter((f) => f !== 'roommate');
      if (sim.relationships[id]) sim.relationships[id].flags = sim.relationships[id].flags.filter((f) => f !== 'roommate');
    }
    if (old.simIds.length === 0) delete ctx.state.households[old.id];
  }
  const hh = makeHousehold({ name: `${sim.identity.lastName} household`, simIds: [sim.id], homeVenueId: apt.id, rng: ctx.rng, now });
  ctx.state.households[hh.id] = hh;
  sim.householdId = hh.id;
  sim.travel = undefined;
  sim.location = { venueId: apt.id, arrivedAt: now };
  const rent = round2((ctx.state.region.medianRent1br || 1200) * 0.7 * (ctx.state.economy.rentIndex || 1));
  if (!sim.finance.bills.some((b) => b.category === 'rent')) sim.finance.bills.push({ id: `bill_${sim.id.slice(4, 12)}_room`, name: `Rent (room at ${apt.name})`, amount: rent, dueDayOfMonth: 1, category: 'rent', autopay: false, missed: 0, linkedId: 'family:room_rent' });
  ctx.emit({ type: 'family:moved_in', simId: sim.id, householdId: hh.id });
  ctx.emit({ type: 'sim:arrived', simId: sim.id, venueId: apt.id });
  ctx.log({ text: isControlled(ctx, sim.id) ? `You move out to a room at ${apt.name} ($${rent.toFixed(0)}/mo).` : `${simName(sim)} moves out${reason ? ` (${reason})` : ''}.`, kind: 'event', simId: sim.id, importance: 2 });
  return true;
}

// ---------------------------------------------------------------------------
// Marriage & divorce
// ---------------------------------------------------------------------------
function marry(ctx: SystemContext, a: Sim, b: Sim, takeName: 'a' | 'b' | 'none'): void {
  const now = ctx.state.time.minute;
  setFlags(ctx, a, b, [{ flag: 'married', op: 'add' }, { flag: 'partner', op: 'add' }, { flag: 'engaged', op: 'remove' }, { flag: 'dating', op: 'remove' }], 'wedding');
  delete a.flags[`wedding_at:${b.id}`];
  delete b.flags[`wedding_at:${a.id}`];
  a.flags[`married_since:${b.id}`] = now;
  b.flags[`married_since:${a.id}`] = now;
  ensureRelationship(a, b.id, now).decayRate = 0.05;
  ensureRelationship(b, a.id, now).decayRate = 0.05;
  if (takeName === 'a') a.identity.lastName = b.identity.lastName;
  if (takeName === 'b') b.identity.lastName = a.identity.lastName;
  // in-laws
  for (const [x, y] of [[a, b], [b, a]] as [Sim, Sim][]) {
    for (const fam of relatedWith(ctx, x, ['parent', 'sibling', 'grandparent'])) {
      const r = ensureRelationship(fam, y.id, now);
      const r2 = ensureRelationship(y, fam.id, now);
      if (!r.flags.includes('in_law')) r.flags.push('in_law');
      if (!r2.flags.includes('in_law')) r2.flags.push('in_law');
      r.familiarity = Math.max(r.familiarity, 20);
      r2.familiarity = Math.max(r2.familiarity, 20);
    }
    for (const kid of childrenOf(ctx, x)) {
      if (kid.relationships[y.id]?.flags.includes('child') || y.relationships[kid.id]?.flags.includes('child')) continue;
      link(ctx, y, kid, 'step_child', 'step_parent', 15);
    }
  }
  for (const s of [a, b]) {
    ctx.applyEffects(s.id, { moodlets: [{ emotion: 'in_love', label: 'Just married', intensity: 20, durationMinutes: DAY * 7 }], needs: { social: 30, fun: 30 } }, 'wedding');
    pushMemory(s, { kind: 'milestone', text: `I married ${simName(s.id === a.id ? b : a)}.`, participants: [s.id === a.id ? b.id : a.id], salience: 100, valence: 1, tags: ['wedding'] }, now, ctx.rng);
  }
  ctx.emit({ type: 'family:married', simId: a.id, otherId: b.id });
  ctx.log({ text: isControlled(ctx, a.id) ? `You and ${simName(b)} are married!` : isControlled(ctx, b.id) ? `You and ${simName(a)} are married!` : `${simName(a)} and ${simName(b)} got married.`, kind: 'event', simId: a.id, importance: 3 });
  if (a.householdId !== b.householdId && (isControlled(ctx, a.id) || isControlled(ctx, b.id))) ctx.log({ text: `You can now move in together (Family → Move in together).`, kind: 'system', simId: isControlled(ctx, a.id) ? a.id : b.id, importance: 1 });
  else if (a.householdId !== b.householdId) {
    const npc = isControlled(ctx, a.id) ? b : a;
    const host = npc === a ? b : a;
    if (host.householdId) moveToHousehold(ctx, npc, host.householdId, 'married');
  }
}

function divorce(ctx: SystemContext, a: Sim, b: Sim, initiator: Sim, custodyTo?: Sim): void {
  const now = ctx.state.time.minute;
  const la = liquidCash(a);
  const lb = liquidCash(b);
  const target = round2((la + lb) / 2);
  const richer = la > lb ? a : b;
  const poorer = richer === a ? b : a;
  const diff = round2(Math.abs(la - lb) / 2);
  if (diff > 0.01) {
    transact(richer, -diff, `Divorce settlement to ${simName(poorer)}`, now, { category: 'legal', counterparty: simName(poorer), rng: ctx.rng, allowCredit: false });
    transact(poorer, diff, `Divorce settlement from ${simName(richer)}`, now, { category: 'legal', counterparty: simName(richer), rng: ctx.rng });
  }
  void target;
  breakUp(ctx, a, b, initiator.id, 'divorce');
  delete a.flags[`married_since:${b.id}`];
  delete b.flags[`married_since:${a.id}`];
  // custody
  const kids = childrenOf(ctx, a).filter((k) => !isAdult(k) && childrenOf(ctx, b).some((x) => x.id === k.id));
  const guardian = custodyTo ?? (a.identity.gender === 'female' ? a : b.identity.gender === 'female' ? b : ctx.rng.pick([a, b]));
  const leaver = a.householdId === b.householdId ? (initiator === guardian ? (guardian === a ? b : a) : initiator) : undefined;
  for (const k of kids) {
    ctx.emit({ type: 'family:custody', childId: k.id, guardianId: guardian.id });
    ctx.applyEffects(k.id, { moodlets: [{ emotion: 'sad', label: 'Parents divorced', intensity: -15, durationMinutes: DAY * 21 }] }, 'divorce');
  }
  for (const s of [a, b]) ctx.applyEffects(s.id, { moodlets: [{ emotion: 'sad', label: 'Divorced', intensity: s === initiator ? -10 : -18, durationMinutes: DAY * 14 }], stress: 15 }, 'divorce');
  ctx.emit({ type: 'family:divorced', simId: a.id, otherId: b.id });
  if (leaver) {
    if (!moveOut(ctx, leaver, 'divorce')) {
      const hh = ctx.query.householdOf(leaver.id);
      if (hh && hh.simIds.length > 1) {
        hh.simIds = hh.simIds.filter((id) => id !== leaver.id);
        const nh = makeHousehold({ name: `${leaver.identity.lastName} household`, simIds: [leaver.id], homeVenueId: hh.homeVenueId, rng: ctx.rng, now });
        ctx.state.households[nh.id] = nh;
        leaver.householdId = nh.id;
      }
    }
    if (leaver !== guardian) for (const k of kids) if (k.householdId !== guardian.householdId && guardian.householdId) moveToHousehold(ctx, k, guardian.householdId, 'custody');
  }
}

function npcDivorceCheck(ctx: SystemContext): void {
  const now = ctx.state.time.minute;
  for (const sim of ctx.query.simulatedSims()) {
    if (isControlled(ctx, sim.id)) continue;
    for (const rel of Object.values(sim.relationships)) {
      if (!rel.flags.includes('married')) continue;
      const key = `lowrom_since:${rel.simId}`;
      if (rel.romance < -20) {
        sim.flags[key] ??= now;
        if (now - Number(sim.flags[key]) >= 30 * DAY && ctx.rng.chance(0.2)) {
          const other = ctx.state.sims[rel.simId];
          if (other?.body.alive) {
            delete sim.flags[key];
            divorce(ctx, other, sim, sim);
          }
        }
      } else delete sim.flags[key];
    }
  }
}

function weddingDay(ctx: SystemContext, payload: Record<string, unknown>): void {
  const a = ctx.state.sims[payload.a as SimId];
  const b = ctx.state.sims[payload.b as SimId];
  const venueId = payload.venueId as VenueId | undefined;
  if (!a || !b || !a.body.alive || !b.body.alive) return;
  if (!a.relationships[b.id]?.flags.includes('engaged')) return;
  const now = ctx.state.time.minute;
  const venue = venueId ? ctx.query.venueMaybe(venueId) : undefined;
  const guests = ((payload.guests as SimId[] | undefined) ?? []).map((id) => ctx.state.sims[id]).filter((s): s is Sim => !!s && s.body.alive);
  if (venue) {
    for (const s of [a, b, ...guests]) {
      if (isControlled(ctx, s.id) && s.id !== a.id && s.id !== b.id) continue;
      s.travel = undefined;
      s.currentAction = undefined;
      s.location = { venueId: venue.id, arrivedAt: now };
    }
  }
  for (const g of guests) {
    ctx.applyEffects(g.id, { needs: { fun: 20, social: 25 }, relationships: [{ simId: a.id, friendship: 3 }, { simId: b.id, friendship: 3 }], moodlets: [{ emotion: 'happy', label: `${first(a)} & ${first(b)}'s wedding`, intensity: 6, durationMinutes: DAY }] }, 'wedding');
  }
  if (isControlled(ctx, a.id) || isControlled(ctx, b.id)) {
    const me = isControlled(ctx, a.id) ? a : b;
    const other = me === a ? b : a;
    ctx.log({ text: `Today is your wedding day${venue ? ` at ${venue.name}` : ''}. ${guests.length} guest${guests.length === 1 ? '' : 's'} came.`, kind: 'event', simId: me.id, importance: 3 });
    ctx.interrupt({ kind: 'event', title: 'Your wedding day', body: `${simName(other)} is waiting at the altar.`, simId: me.id, fromSimId: other.id, options: [{ label: 'Say "I do"', actionId: `family:marry:${other.id}` }, { label: `Say "I do" and take the name ${other.identity.lastName}`, actionId: `family:marry:${other.id}`, params: { takeName: 'me' } }, { label: 'Call it off', actionId: `family:cancel_wedding:${other.id}` }] });
  } else {
    marry(ctx, a, b, b.identity.gender === 'female' && a.identity.gender === 'male' && ctx.rng.chance(0.7) ? 'b' : 'none');
  }
}

// ---------------------------------------------------------------------------
// Adoption & visits & funerals
// ---------------------------------------------------------------------------
function completeAdoption(ctx: SystemContext, parentId: SimId): void {
  const parent = ctx.state.sims[parentId];
  if (!parent || !parent.body.alive) return;
  delete parent.flags.adoption_pending;
  const now = ctx.state.time.minute;
  const gender: Sim['identity']['gender'] = ctx.rng.chance(0.5) ? 'male' : 'female';
  const age = ctx.rng.int(1, 8);
  const hh = ctx.query.householdOf(parent.id);
  const child = makeSim({ firstName: pickName(ctx, gender), lastName: parent.identity.lastName, gender, age, epoch: ctx.state.epoch, rng: ctx.rng, venueId: hh?.homeVenueId ?? parent.location.venueId, householdId: parent.householdId, startingCash: 0, lod: 'full', createdAt: now });
  child.identity.hometown = ctx.state.region.name;
  child.body.insurance = { ...parent.body.insurance, kind: 'parent' };
  ctx.state.sims[child.id] = child;
  if (hh) hh.simIds.push(child.id);
  const parents = [parent];
  const spouseId = partnerOf(parent);
  const spouse = spouseId ? ctx.state.sims[spouseId] : undefined;
  if (spouse && spouse.householdId === parent.householdId) parents.push(spouse);
  for (const p of parents) {
    link(ctx, p, child, 'child', 'parent', 40);
    for (const sib of childrenOf(ctx, p)) if (sib.id !== child.id) link(ctx, sib, child, 'sibling', 'sibling', 20);
    ctx.applyEffects(p.id, { moodlets: [{ emotion: 'happy', label: `Adopted ${child.identity.firstName}`, intensity: 15, durationMinutes: DAY * 7 }] }, 'adoption');
    pushMemory(p, { kind: 'milestone', text: `We adopted ${child.identity.firstName} (age ${age}).`, participants: [child.id], salience: 100, valence: 1, tags: ['adoption'] }, now, ctx.rng);
  }
  ctx.emit({ type: 'family:adoption', parentIds: parents.map((p) => p.id), childId: child.id });
  ctx.log({ text: `The adoption is final: ${child.identity.firstName} (${age}) is part of your family.`, kind: 'event', simId: parent.id, importance: 3 });
}

function holidayVisits(ctx: SystemContext, holidayId: string, label: string): void {
  if (!HOLIDAY_VISITS.has(holidayId)) return;
  const now = ctx.state.time.minute;
  const done = new Set<string>();
  for (const c of ctx.query.controlledSims()) {
    if (!c.householdId || done.has(c.householdId)) continue;
    done.add(c.householdId);
    const relatives = relatedWith(ctx, c, ['parent', 'sibling', 'grandparent', 'child']).filter((r) => r.householdId !== c.householdId && isAdult(r));
    if (!relatives.length) continue;
    const guests = relatives.filter(() => ctx.rng.chance(0.7)).slice(0, 4);
    if (!guests.length) continue;
    const at = now - ctx.clock.minuteOfDay + 14 * HOUR;
    if (at <= now) continue;
    ctx.schedule({ atMinute: at, kind: 'visitor', label: `Family visit (${label})`, simId: c.id, venueId: ctx.query.homeOf(c.id)?.id, payload: { source: 'family', kind: 'holiday_visit', hostId: c.id, guestIds: guests.map((g) => g.id), label } });
    ctx.log({ text: `${guests.map(first).join(' and ')} ${guests.length > 1 ? 'are' : 'is'} coming over this afternoon for ${label}.`, kind: 'phone', simId: c.id, importance: 1 });
  }
}

function familyVisit(ctx: SystemContext, payload: Record<string, unknown>): void {
  const host = ctx.state.sims[payload.hostId as SimId];
  const guests = ((payload.guestIds as SimId[] | undefined) ?? []).map((id) => ctx.state.sims[id]).filter((s): s is Sim => !!s && s.body.alive);
  const home = host && ctx.query.homeOf(host.id);
  if (!host || !home || !guests.length) return;
  const now = ctx.state.time.minute;
  if (host.location.venueId !== home.id) {
    ctx.log({ text: `Your family stopped by for ${payload.label ?? 'the holiday'} while you were out.`, kind: 'relationship', simId: host.id, importance: 2 });
    for (const g of guests) ctx.applyEffects(g.id, { relationships: [{ simId: host.id, friendship: -3 }] }, 'visit:missed');
    return;
  }
  for (const g of guests) {
    g.travel = undefined;
    g.location = { venueId: home.id, arrivedAt: now };
    ctx.emit({ type: 'sim:arrived', simId: g.id, venueId: home.id });
  }
  host.flags.visitors = guests.map((g) => g.id).join(',');
  ctx.interrupt({ kind: 'visitor', title: 'Family at the door', body: `${guests.map(simName).join(', ')} arrived for ${payload.label ?? 'a visit'}.`, simId: host.id, fromSimId: guests[0].id, options: [{ label: 'Welcome them in', actionId: 'family:welcome_visitors' }, { label: "Pretend you're not home", actionId: 'family:ignore_visitors' }] });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function actions(ctx: SystemContext, simId: SimId): ActionDef[] {
  const sim = ctx.state.sims[simId];
  if (!sim || !sim.body.alive) return [];
  const out: ActionDef[] = [];
  const venue = ctx.query.venueMaybe(sim.location.venueId);
  const hh = ctx.query.householdOf(simId);
  const now = ctx.state.time.minute;
  const def = (id: string, label: string, minutes: number, extra: Partial<ActionDef> = {}): ActionDef => ({ id, label, category: 'family', durationMinutes: minutes, effects: {}, group: 'Family', interruptible: true, ...extra });
  const adult = isAdult(sim);

  if (adult && hh) {
    // babies / toddlers here
    for (const id of hh.simIds) {
      const kid = ctx.state.sims[id];
      if (!kid || kid.id === simId || !kid.body.alive || !isKid(kid) || kid.location.venueId !== sim.location.venueId) continue;
      const g = { group: first(kid), target: { kind: 'sim' as const, id: kid.id, name: simName(kid) } };
      const infant = kid.lifeStage === 'infant';
      out.push(def(`family:${kid.id}:feed`, infant ? `Feed ${first(kid)} (formula)` : `Feed ${first(kid)}`, 15, { ...g, requirements: infant ? [{ kind: 'item', reason: 'Need baby formula', params: { itemId: 'baby_formula', qty: 1, pantry: true } }] : [], satisfies: ['hunger'], icon: 'bottle' }));
      if (kid.lifeStage !== 'child') out.push(def(`family:${kid.id}:diaper`, `Change ${first(kid)}'s diaper`, 5, { ...g, requirements: [{ kind: 'item', reason: 'Need diapers', params: { itemId: 'diapers', qty: 1, pantry: true } }], icon: 'diaper' }));
      out.push(def(`family:${kid.id}:nap`, `Put ${first(kid)} down for a nap`, 20, { ...g, icon: 'moon' }));
      out.push(def(`family:${kid.id}:play`, `Play with ${first(kid)}`, 20, { ...g, icon: 'toy' }));
      out.push(def(`family:${kid.id}:soothe`, `Soothe ${first(kid)}`, 10, { ...g, icon: 'heart' }));
    }
    // babysitter
    const youngKids = hh.simIds.map((id) => ctx.state.sims[id]).filter((s): s is Sim => !!s && s.body.alive && ctx.query.ageOf(s) < 12);
    if (youngKids.length && venue?.id === hh.homeVenueId) {
      const active = Number(ctx.state.flags[`babysitter:${hh.id}`] ?? 0) > now;
      out.push(def('family:babysitter', active ? 'Babysitter is here' : 'Hire a babysitter ($20/h, 4h)', 5, { requirements: active ? [blocked('A babysitter is already booked')] : [{ kind: 'money', reason: 'Costs $80', params: { amount: 80 } }], params: { hours: 4 }, cost: active ? undefined : { amount: 80, memo: 'Babysitter (4h)', category: 'childcare' }, icon: 'baby' }));
    }
    // daycare enrollment
    if (venue?.archetype === 'daycare') {
      for (const k of youngKids) {
        if (ctx.query.ageOf(k) >= 6 || k.flags.daycare_active) continue;
        const fee = round2(1200 * col(ctx) * (venue.priceMultiplier || 1));
        out.push(def(`family:daycare:${k.id}`, `Enroll ${first(k)} in daycare ($${fee.toFixed(0)}/mo)`, 30, { requirements: [{ kind: 'money', reason: `First month $${fee.toFixed(0)}`, params: { amount: fee } }], cost: { amount: fee, memo: `Daycare enrollment (${venue.name})`, category: 'childcare', counterparty: venue.name }, target: { kind: 'sim', id: k.id, name: simName(k) } }));
      }
    }
    // birthday party
    if (sim.flags.birthday_today && now - Number(sim.flags.birthday_today) < DAY && !sim.flags.birthday_party_planned) {
      out.push(def('family:birthday_party', 'Throw a birthday party tonight ($150)', 10, { requirements: [{ kind: 'money', reason: 'Costs $150', params: { amount: 150 } }], cost: { amount: 150, memo: 'Birthday party supplies', category: 'entertainment' }, icon: 'cake' }));
    }
    // adoption
    if ((venue?.archetype === 'shelter' || venue?.archetype === 'city_hall') && !sim.flags.adoption_pending) {
      const fee = round2(500 * col(ctx));
      out.push(def('family:adopt', `Apply to adopt a child ($${fee.toFixed(0)} application, 30-day home study)`, 60, { requirements: [{ kind: 'money', reason: `Costs $${fee.toFixed(0)}`, params: { amount: fee } }, ...(hh.homeVenueId ? [] : [blocked('You need a stable home')])], cost: { amount: fee, memo: 'Adoption application', category: 'legal' }, icon: 'family' }));
    }
    // move out
    if (hh.simIds.length > 1 && venue?.id === hh.homeVenueId) out.push(def('family:move_out', 'Move out (rent a room nearby)', 120, { requirements: ctx.query.venuesByArchetype('apartment_building').length ? [] : [blocked('No apartments nearby')], icon: 'box' }));
    // funerals
    if (venue?.archetype === 'funeral_home') {
      for (const key of Object.keys(sim.flags)) {
        if (!key.startsWith('grieving:')) continue;
        const deadId = key.slice(9) as SimId;
        const dead = ctx.state.sims[deadId];
        if (!dead || dead.flags.funeral_held) continue;
        const cost = round2(7000 * col(ctx));
        out.push(def(`family:funeral:${deadId}`, `Hold a funeral for ${simName(dead)} ($${cost.toFixed(0)})`, 180, { requirements: [{ kind: 'money', reason: `Costs $${cost.toFixed(0)}`, params: { amount: cost } }], cost: { amount: cost, memo: `Funeral for ${simName(dead)}`, category: 'other', counterparty: venue.name } }));
      }
    }
  }
  // present sims: partner/household stuff
  for (const t of ctx.query.simsAt(sim.location.venueId)) {
    if (t.id === simId || !adult || !isAdult(t)) continue;
    const rel = sim.relationships[t.id];
    if (!rel) continue;
    const g = { group: simName(t), target: { kind: 'sim' as const, id: t.id, name: simName(t) } };
    if (rel.flags.includes('engaged') && !sim.flags[`wedding_at:${t.id}`]) {
      const ch = ctx.query.nearestVenue(sim.location.venueId, 'courthouse');
      out.push(def(`family:plan_wedding:${t.id}:courthouse`, 'Plan a courthouse wedding ($80, next week)', 15, { ...g, requirements: [{ kind: 'money', reason: 'Costs $80', params: { amount: 80 } }, ...(ch ? [] : [blocked('No courthouse nearby')])], cost: { amount: 80, memo: 'Marriage license', category: 'legal' } }));
      const budget = round2(clamp(12000 * col(ctx), 5000, 30000));
      out.push(def(`family:plan_wedding:${t.id}:venue`, `Plan a real wedding ($${budget.toFixed(0)}, in 6 weeks)`, 60, { ...g, requirements: [{ kind: 'money', reason: `Costs $${budget.toFixed(0)}`, params: { amount: budget } }], cost: { amount: budget, memo: 'Wedding deposit & vendors', category: 'entertainment' }, params: { budget } }));
    }
    if ((rel.flags.includes('married') || rel.flags.includes('engaged') || rel.flags.includes('partner')) && t.householdId !== sim.householdId) out.push(def(`family:move_in:${t.id}`, `Move in together (${first(t)} joins your household)`, 120, g));
    if (!isPartnered(rel) && t.householdId !== sim.householdId && rel.friendship >= 40 && !ctx.query.isControlled(t.id)) out.push(def(`family:ask_move_in:${t.id}`, `Ask ${first(t)} to move in`, 10, g));
    if (t.householdId === sim.householdId && !ctx.query.isControlled(t.id) && hh && hh.simIds.length > 1) out.push(def(`family:kick_out:${t.id}`, `Ask ${first(t)} to move out`, 15, { ...g, requirements: ctx.query.venuesByArchetype('apartment_building').length ? [] : [blocked('They have nowhere to go')] }));
  }
  // divorce at courthouse
  if (adult && venue?.archetype === 'courthouse') {
    for (const rel of Object.values(sim.relationships)) {
      if (!rel.flags.includes('married')) continue;
      const t = ctx.state.sims[rel.simId];
      if (!t) continue;
      const cost = round2(clamp(300 + liquidCash(sim) * 0.02, 300, 5000));
      out.push(def(`family:divorce:${t.id}`, `File for divorce from ${simName(t)} ($${cost.toFixed(0)})`, 90, { requirements: [{ kind: 'money', reason: `Filing fees $${cost.toFixed(0)}`, params: { amount: cost } }], cost: { amount: cost, memo: 'Divorce filing', category: 'legal', counterparty: venue.name }, target: { kind: 'sim', id: t.id, name: simName(t) }, group: simName(t), params: { custody: 'me' } }));
    }
  }
  out.push(...pendingInterruptActions(ctx, 'family:'));
  return out;
}

function execute(ctx: SystemContext, simId: SimId, action: ActionDef, params: Record<string, unknown>): ActionResult {
  const sim = ctx.state.sims[simId];
  if (!sim) return { ok: false, text: 'Unknown sim' };
  const now = ctx.state.time.minute;
  const parts = action.id.split(':');
  const a1 = parts[1];
  const a2 = parts[2];
  const hh = ctx.query.householdOf(simId);

  // baby care: family:<babyId>:<care>
  if (a1?.startsWith('sim_')) {
    const kid = ctx.state.sims[a1 as SimId];
    if (!kid) return { ok: false, text: 'Not here.' };
    const bond = { relationships: [{ simId: kid.id, friendship: 2, familiarity: 1, mutual: true }] };
    const care: Record<string, { kidNeeds: Partial<Record<keyof Sim['needs'], number>>; text: string; actor: Partial<Sim['needs']> ; consume?: string }> = {
      feed: { kidNeeds: { hunger: 40, thirst: 30, social: 5 }, text: `You feed ${first(kid)}.`, actor: { social: 4 }, consume: kid.lifeStage === 'infant' ? 'baby_formula' : undefined },
      diaper: { kidNeeds: { bladder: 70, hygiene: 40, comfort: 20 }, text: `You change ${first(kid)}'s diaper.`, actor: { hygiene: -3 }, consume: 'diapers' },
      nap: { kidNeeds: { energy: 35, comfort: 10 }, text: `You rock ${first(kid)} to sleep.`, actor: { social: 3 } },
      play: { kidNeeds: { fun: 35, social: 25 }, text: `You play with ${first(kid)}.`, actor: { fun: 10, social: 10 } },
      soothe: { kidNeeds: { comfort: 30, social: 20, fun: 5 }, text: `You hold ${first(kid)} until the crying stops.`, actor: { social: 8 } },
    };
    const c = care[a2];
    if (!c) return { ok: false, text: 'Unknown care action.' };
    ctx.applyEffects(kid.id, { needs: c.kidNeeds, moodlets: [{ emotion: 'happy', label: 'Cared for', intensity: 4, durationMinutes: 120 }] }, action.id);
    if (c.consume) {
      const own = sim.inventory.consumables[c.consume] ?? 0;
      if (own > 0) sim.inventory.consumables[c.consume] = own - 1;
      else if (hh && (hh.pantry[c.consume] ?? 0) > 0) hh.pantry[c.consume] -= 1;
      if (sim.inventory.consumables[c.consume] === 0) delete sim.inventory.consumables[c.consume];
    }
    return { ok: true, text: c.text, effects: { ...bond, needs: c.actor, skills: { parenting: 4 }, memories: [{ kind: 'interaction', text: c.text.replace('You ', 'I '), participants: [kid.id], valence: 0.3, salience: 15 }] } };
  }
  switch (a1) {
    case 'babysitter': {
      if (!hh) return { ok: false };
      const hours = Number(params.hours ?? 4);
      ctx.state.flags[`babysitter:${hh.id}`] = now + hours * HOUR;
      return { ok: true, text: `A babysitter arrives for the next ${hours} hours.` };
    }
    case 'daycare': {
      const kid = ctx.state.sims[a2 as SimId];
      const venue = ctx.query.venueMaybe(sim.location.venueId);
      if (!kid || !venue) return { ok: false };
      const fee = action.cost?.amount ?? round2(1200 * col(ctx));
      kid.flags.daycare = venue.id;
      sim.finance.bills.push({ id: `bill_daycare_${kid.id.slice(4, 12)}`, name: `Daycare (${first(kid)} at ${venue.name})`, amount: fee, dueDayOfMonth: 1, category: 'childcare', autopay: true, missed: 0, linkedId: kid.id });
      kid.schedule = kid.schedule.filter((b) => b.kind !== 'childcare');
      kid.schedule.push({ day: 'weekday', start: 8 * HOUR, end: 17 * HOUR, kind: 'childcare', venueId: venue.id, label: 'Daycare' });
      return { ok: true, text: `${first(kid)} is enrolled at ${venue.name}. Weekdays 8–5, $${fee.toFixed(0)}/month.` };
    }
    case 'birthday_party': {
      sim.flags.birthday_party_planned = true;
      const home = ctx.query.homeOf(simId);
      const guests = Object.values(sim.relationships).filter((r) => r.friendship >= 25 || r.flags.some((f) => FAMILY_REL.includes(f) || f === 'partner' || f === 'married')).map((r) => r.simId).slice(0, 8);
      const at = Math.max(now + 30, now - ctx.clock.minuteOfDay + 18 * HOUR);
      ctx.schedule({ atMinute: at, kind: 'party', label: 'Birthday party', simId, venueId: home?.id, payload: { source: 'family', kind: 'birthday', hostId: simId, guests } });
      return { ok: true, text: `Party at your place at 6 PM. ${guests.length} people are invited.` };
    }
    case 'adopt': {
      sim.flags.adoption_pending = now;
      ctx.schedule({ inMinutes: fast(ctx) ? DAY : 30 * DAY, kind: '_adoption_home_study', label: 'adoption home study', simId });
      return { ok: true, text: 'Application filed. A caseworker will do a home study over the next month.' };
    }
    case 'move_out':
      return moveOut(ctx, sim, 'moved out') ? { ok: true, text: 'You pack up and move out.' } : { ok: false, text: 'No place available.' };
    case 'funeral': {
      const dead = ctx.state.sims[a2 as SimId];
      if (!dead) return { ok: false };
      dead.flags.funeral_held = now;
      for (const s of ctx.query.aliveSims()) {
        if (!s.flags[`grieving:${dead.id}`]) continue;
        s.mind.moodlets = s.mind.moodlets.filter((m) => m.id !== `grief:${dead.id}`);
        ctx.applyEffects(s.id, { moodlets: [{ emotion: 'nostalgic', label: `Said goodbye to ${first(dead)}`, intensity: -4, durationMinutes: DAY * 5, id: `grief:${dead.id}` }] }, 'funeral');
        delete s.flags[`grieving:${dead.id}`];
      }
      return { ok: true, text: `You hold a service for ${simName(dead)}. Closure, of a kind.`, effects: { memories: [{ kind: 'milestone', text: `We held ${simName(dead)}'s funeral.`, participants: [dead.id], salience: 70, valence: -0.3 }] } };
    }
    case 'plan_wedding': {
      const partner = ctx.state.sims[a2 as SimId];
      if (!partner) return { ok: false };
      const style = parts[3];
      const mod = ctx.clock.minuteOfDay;
      let at: number;
      let venueId: VenueId | undefined;
      if (style === 'courthouse') {
        venueId = ctx.query.nearestVenue(sim.location.venueId, 'courthouse')?.id;
        at = now - mod + 7 * DAY + 10 * HOUR;
        let wd = ctx.clock.weekday + 7;
        while (wd % 7 === 0 || wd % 7 === 6) {
          at += DAY;
          wd += 1;
        }
      } else {
        venueId = (ctx.query.nearestVenue(sim.location.venueId, 'church') ?? ctx.query.nearestVenue(sim.location.venueId, 'hotel') ?? ctx.query.nearestVenue(sim.location.venueId, 'park') ?? ctx.query.homeOf(simId))?.id;
        at = now - mod + 42 * DAY + 15 * HOUR;
        const wd = (ctx.clock.weekday + 42) % 7;
        at += ((6 - wd + 7) % 7) * DAY; // next Saturday
      }
      const guestSet = new Set<SimId>();
      for (const s of [sim, partner]) for (const r of Object.values(s.relationships)) if (r.friendship >= 30 || r.flags.some((f) => FAMILY_REL.includes(f))) guestSet.add(r.simId);
      guestSet.delete(sim.id);
      guestSet.delete(partner.id);
      const guests = [...guestSet].slice(0, style === 'courthouse' ? 4 : 40);
      ctx.schedule({ atMinute: at, kind: 'party', label: `Wedding: ${first(sim)} & ${first(partner)}`, simId, venueId, payload: { source: 'family', kind: 'wedding', a: sim.id, b: partner.id, venueId, guests, style } });
      sim.flags[`wedding_at:${partner.id}`] = at;
      partner.flags[`wedding_at:${sim.id}`] = at;
      return { ok: true, text: style === 'courthouse' ? `Courthouse appointment booked for next week.` : `Wedding booked${venueId ? ` at ${ctx.query.venueMaybe(venueId)?.name}` : ''} in six weeks. ${guests.length} invitations sent.`, effects: { moodlets: [{ emotion: 'hopeful', label: 'Wedding planned', intensity: 6, durationMinutes: DAY * 3 }] } };
    }
    case 'marry': {
      const partner = ctx.state.sims[a2 as SimId];
      if (!partner) return { ok: false };
      const take = params.takeName === 'me' ? 'a' : params.takeName === 'them' ? 'b' : 'none';
      marry(ctx, sim, partner, take);
      return { ok: true, text: `You're married.` };
    }
    case 'cancel_wedding': {
      const partner = ctx.state.sims[a2 as SimId];
      if (!partner) return { ok: false };
      delete sim.flags[`wedding_at:${partner.id}`];
      delete partner.flags[`wedding_at:${sim.id}`];
      breakUp(ctx, sim, partner, sim.id, 'wedding:cancelled');
      ctx.applyEffects(partner.id, { moodlets: [{ emotion: 'sad', label: 'Left at the altar', intensity: -25, durationMinutes: DAY * 14 }] }, 'wedding:cancelled');
      ensureRelationship(partner, sim.id, now).grudges.push({ text: `${first(sim)} left me at the altar`, at: now, weight: 6 });
      return { ok: true, text: `You call off the wedding. ${first(partner)} is devastated.`, effects: { moodlets: [{ emotion: 'guilty', label: 'Called off the wedding', intensity: -12, durationMinutes: DAY * 7 }] } };
    }
    case 'move_in': {
      const partner = ctx.state.sims[a2 as SimId];
      if (!partner || !sim.householdId) return { ok: false };
      moveToHousehold(ctx, partner, sim.householdId, 'moving in together');
      return { ok: true, text: `${first(partner)} moves in.`, effects: { moodlets: [{ emotion: 'happy', label: 'Living together', intensity: 8, durationMinutes: DAY * 5 }] } };
    }
    case 'ask_move_in': {
      const t = ctx.state.sims[a2 as SimId];
      if (!t || !sim.householdId) return { ok: false };
      const rel = t.relationships[simId];
      const p = 0.2 + (rel?.friendship ?? 0) / 150 + (rel?.trust ?? 0) / 200 + (isPartnered(rel) ? 0.3 : 0) + (hasTrait(t, 'homebody') ? -0.1 : 0);
      if (!ctx.rng.chance(clamp(p, 0.05, 0.95))) return { ok: true, text: `${first(t)} likes their place. Maybe later.` };
      moveToHousehold(ctx, t, sim.householdId, 'roommate');
      return { ok: true, text: `${first(t)} says yes and starts packing.` };
    }
    case 'kick_out': {
      const t = ctx.state.sims[a2 as SimId];
      if (!t) return { ok: false };
      const ok = moveOut(ctx, t, 'asked to leave');
      if (!ok) return { ok: false, text: 'They have nowhere to go.' };
      ctx.applyEffects(t.id, { relationships: [{ simId, friendship: -15, trust: -10 }], moodlets: [{ emotion: 'angry', label: 'Kicked out', intensity: -10, durationMinutes: DAY * 7 }] }, 'kick_out');
      ensureRelationship(t, simId, now).grudges.push({ text: `${first(sim)} kicked me out`, at: now, weight: 3 });
      return { ok: true, text: `${first(t)} moves out.` };
    }
    case 'divorce': {
      const t = ctx.state.sims[a2 as SimId];
      if (!t) return { ok: false };
      divorce(ctx, sim, t, sim, params.custody === 'them' ? t : sim);
      return { ok: true, text: `The papers are filed. It's over.` };
    }
    case 'rush_hospital': {
      const venueId = params.venueId as VenueId | undefined;
      const hospital = (venueId && ctx.query.venueMaybe(venueId)) ?? ctx.query.nearestVenue(sim.location.venueId, 'hospital');
      if (!hospital) return { ok: false, text: 'No hospital.' };
      const km = ctx.query.distanceKm(sim.location.venueId, hospital.id);
      const mins = clamp(Math.round((km / 40) * 60) + 10, 10, 90);
      sim.location = { venueId: hospital.id, arrivedAt: now };
      sim.travel = undefined;
      ctx.emit({ type: 'sim:arrived', simId, venueId: hospital.id });
      deliver(ctx, sim, true);
      return { ok: true, text: `You make it to ${hospital.name}.`, durationMinutes: mins };
    }
    case 'home_birth':
      deliver(ctx, sim, false);
      return { ok: true, text: 'You deliver at home.', durationMinutes: 120 };
    case 'welcome_visitors': {
      const ids = String(sim.flags.visitors ?? '').split(',').filter(Boolean) as SimId[];
      delete sim.flags.visitors;
      const rels = ids.map((id) => ({ simId: id, friendship: 4, trust: 2, familiarity: 2, mutual: true }));
      for (const id of ids) {
        const g = ctx.state.sims[id];
        if (g) ctx.applyEffects(id, { needs: { social: 30, fun: 15 }, moodlets: [{ emotion: 'happy', label: 'Family time', intensity: 6, durationMinutes: DAY }] }, 'visit');
        if (g) pushMemory(g, { text: `Spent the holiday at ${first(sim)}'s place.`, participants: [simId], valence: 0.5, salience: 40, tags: ['holiday', 'family'] }, now, ctx.rng);
      }
      return { ok: true, text: 'You spend the afternoon with family.', durationMinutes: 180, effects: { needs: { social: 35, fun: 15, hunger: 25 }, relationships: rels, moodlets: [{ emotion: 'happy', label: 'Family time', intensity: 8, durationMinutes: DAY }], memories: [{ kind: 'event', text: `Family came over for the holiday.`, participants: ids, valence: 0.5, salience: 45 }] } };
    }
    case 'ignore_visitors': {
      const ids = String(sim.flags.visitors ?? '').split(',').filter(Boolean) as SimId[];
      delete sim.flags.visitors;
      for (const id of ids) {
        const g = ctx.state.sims[id];
        if (!g) continue;
        ctx.applyEffects(id, { relationships: [{ simId, friendship: -6, trust: -4 }], moodlets: [{ emotion: 'sad', label: 'Turned away', intensity: -6, durationMinutes: DAY }] }, 'visit:ignored');
        ensureRelationship(g, simId, now).grudges.push({ text: `${first(sim)} pretended not to be home when I visited`, at: now, weight: 2 });
        const home = ctx.query.homeOf(simId);
        if (home) g.location = { venueId: g.householdId ? ctx.state.households[g.householdId]?.homeVenueId ?? home.id : home.id, arrivedAt: now };
      }
      return { ok: true, text: 'You keep the lights off until they leave.', effects: { moodlets: [{ emotion: 'guilty', label: 'Avoided family', intensity: -4, durationMinutes: 480 }] } };
    }
    case 'acknowledge_death':
      return { ok: true, text: 'You take a moment.' };
    case 'switch_sim': {
      const id = a2 as SimId;
      if (ctx.state.player.controlledSimIds.includes(id)) ctx.state.player.activeSimId = id;
      return { ok: true, text: `Continuing as ${simName(ctx.state.sims[id])}.` };
    }
    case 'game_over':
      ctx.state.flags.gameOver = true;
      return { ok: true, text: 'The end.' };
    default:
      return { ok: false, text: 'Unknown family action.' };
  }
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------
function onScheduled(ctx: SystemContext, ev: Extract<GameEvent, { type: 'scheduled:fired' }>['event']): void {
  const sim = ev.simId ? ctx.state.sims[ev.simId] : undefined;
  switch (ev.kind) {
    case '_pregnancy_known':
      if (sim) revealPregnancy(ctx, sim, 'time');
      break;
    case '_pregnancy_due':
    case 'pregnancy_due':
      if (sim) labor(ctx, sim);
      break;
    case '_labor_timeout':
      if (sim?.body.pregnancy) deliver(ctx, sim, ctx.query.venueMaybe(sim.location.venueId)?.archetype === 'hospital');
      break;
    case '_adoption_home_study':
      if (ev.simId) completeAdoption(ctx, ev.simId);
      break;
    case 'party': {
      const p = ev.payload ?? {};
      if (p.source !== 'family') break;
      if (p.kind === 'wedding') weddingDay(ctx, p);
      else if (p.kind === 'birthday' && sim) {
        const guests = ((p.guests as SimId[] | undefined) ?? []).map((id) => ctx.state.sims[id]).filter((s): s is Sim => !!s && s.body.alive);
        const home = ctx.query.homeOf(sim.id);
        if (!home || sim.location.venueId !== home.id) {
          ctx.log({ text: 'You missed your own birthday party.', kind: 'event', simId: sim.id, importance: 2 });
          break;
        }
        const came = guests.filter(() => ctx.rng.chance(0.75));
        for (const g of came) {
          g.travel = undefined;
          g.location = { venueId: home.id, arrivedAt: ctx.state.time.minute };
          ctx.applyEffects(g.id, { needs: { fun: 20, social: 25 }, relationships: [{ simId: sim.id, friendship: 3, mutual: true }] }, 'birthday_party');
        }
        ctx.applyEffects(sim.id, { needs: { fun: 30, social: 40 }, moodlets: [{ emotion: 'happy', label: 'Birthday party', intensity: came.length ? 10 : -5, durationMinutes: DAY }], venue: [{ venueId: home.id, noise: 30, cleanliness: -15 }] }, 'birthday_party');
        ctx.log({ text: came.length ? `${came.map(first).join(', ')} show up for your birthday party.` : 'Nobody came to your party.', kind: 'event', simId: sim.id, importance: 2 });
      }
      break;
    }
    case 'visitor':
      if (ev.payload?.source === 'family' && ev.payload.kind === 'holiday_visit') familyVisit(ctx, ev.payload);
      break;
    default:
      break;
  }
}

export const familySystem: System = {
  id: 'family',
  intervalMinutes: 60,
  onTick(ctx) {
    const day = Math.floor(ctx.state.time.minute / DAY);
    if (Number(ctx.state.flags['family:lastDay'] ?? -1) !== day) {
      ctx.state.flags['family:lastDay'] = day;
      birthdays(ctx);
      naturalDeath(ctx);
      npcDivorceCheck(ctx);
      for (const s of ctx.query.aliveSims()) {
        if (s.flags.maternity_leave_until && Number(s.flags.maternity_leave_until) < ctx.state.time.minute) delete s.flags.maternity_leave_until;
        if (s.flags.paternity_leave_until && Number(s.flags.paternity_leave_until) < ctx.state.time.minute) delete s.flags.paternity_leave_until;
        if (s.flags.daycare) s.flags.daycare_active = ctx.clock.day.isSchoolDay || !ctx.clock.day.isWeekend;
      }
    }
    // hourly: pregnancy symptoms, crying babies, unsupervised kids
    for (const s of ctx.query.simulatedSims()) {
      const p = s.body.pregnancy;
      if (!p) continue;
      const progress = (ctx.state.time.minute - p.conceivedAt) / (p.dueAt - p.conceivedAt);
      if (p.known && progress > 0.6 && ctx.rng.chance(0.15)) ctx.applyEffects(s.id, { needs: { energy: -4, comfort: -4, bladder: -6 } }, 'pregnancy');
      if (!p.known && progress > 0.2 && ctx.rng.chance(0.05) && isControlled(ctx, s.id)) ctx.log({ text: 'You feel queasy this morning.', kind: 'need', simId: s.id, importance: 0 });
    }
    babyChecks(ctx);
    cpsCheck(ctx);
  },
  onEvent(ctx, e) {
    switch (e.type) {
      case 'custom':
        if (e.kind === 'family:conception' && e.payload) conceive(ctx, e.payload.a as SimId, e.payload.b as SimId);
        else if (e.kind === 'health:pregnancy_test' && e.simId) {
          const s = ctx.state.sims[e.simId];
          if (s?.body.pregnancy) revealPregnancy(ctx, s, 'test');
          else if (s && isControlled(ctx, s.id)) ctx.log({ text: 'The test is negative.', kind: 'narrative', simId: s.id, importance: 1 });
        }
        break;
      case 'family:proposal': {
        const a = ctx.state.sims[e.simId];
        const b = ctx.state.sims[e.otherId];
        if (a && b && e.accepted) {
          setFlags(ctx, a, b, [{ flag: 'engaged', op: 'add' }, { flag: 'partner', op: 'add' }], 'proposal');
          a.flags[`engaged_since:${b.id}`] = ctx.state.time.minute;
          b.flags[`engaged_since:${a.id}`] = ctx.state.time.minute;
          ctx.emit({ type: 'relationship:milestone', simId: a.id, otherId: b.id, milestone: 'engaged' });
        }
        break;
      }
      case 'sim:died': {
        const s = ctx.state.sims[e.simId];
        if (s) onDied(ctx, s, e.cause);
        break;
      }
      case 'scheduled:fired':
        onScheduled(ctx, e.event);
        break;
      case 'calendar:holiday':
        holidayVisits(ctx, e.holidayId, e.label);
        break;
      case 'world:new_game':
        for (const s of ctx.query.aliveSims()) {
          for (const r of Object.values(s.relationships)) if (r.flags.some((f) => FAMILY_REL.includes(f) || f === 'married' || f === 'partner' || f === 'engaged')) r.decayRate = 0.05;
        }
        break;
      default:
        break;
    }
  },
  actions,
  handles: (id) => id.startsWith('family:'),
  execute,
};

