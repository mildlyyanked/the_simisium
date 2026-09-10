/**
 * Pets system — needs decay, health, bonds, accidents, escapes, illness, aging & death,
 * pet care actions (`pet:<petId>:*`), adoption (`pet:adopt:<breedIndex>` at shelter/pet_store),
 * licensing (`pet:license:<petId>` at city_hall), taking a pet along.
 *
 * Emits: pet:adopted, pet:sick, pet:died, pet:need_critical, pet:escaped, pet:trained,
 *        custom legal:animal_neglect
 * Consumes: time:day (via tick), sim:arrived / sim:departed (pets travelling with owners), scheduled:fired (_pet_*)
 */
import { ageAt, isoDateAt } from '../core/clock';
import type { GameEvent } from '../core/events';
import { newPetId } from '../core/ids';
import type { ActionResult, System, SystemContext } from '../core/systems';
import type { ActionDef, Pet, PetNeedId, PetSpecies, Requirement, Sim, SimId, VenueId } from '../core/types';
import { clamp, clamp100, DAY, HOUR, round2 } from '../core/util';
import type { PetBreedDef } from '../content/types';
import { blocked, hasTrait, pendingInterruptActions, pushMemory } from './relationships';

const PET_NEEDS: PetNeedId[] = ['hunger', 'thirst', 'energy', 'bladder', 'hygiene', 'play', 'affection'];
/** per-hour decay at activity 0.5 */
const DECAY: Record<PetNeedId, number> = { hunger: 2.2, thirst: 3, energy: 1.5, bladder: 3.2, hygiene: 0.5, play: 2, affection: 1.6 };
const SPECIES_NEEDS: Partial<Record<PetSpecies, Partial<Record<PetNeedId, number>>>> = {
  fish: { bladder: 0, hygiene: 0.3, play: 0.3, affection: 0.2, energy: 0.2, thirst: 0 },
  reptile: { bladder: 0.5, hygiene: 0.3, play: 0.4, affection: 0.3, hunger: 0.6, thirst: 1 },
  hamster: { bladder: 1, affection: 0.6, play: 1.2 },
  bird: { bladder: 1.5, affection: 1.2, play: 1.5 },
  rabbit: { bladder: 1.5, affection: 0.9 },
  cat: { bladder: 1.2, affection: 0.9, play: 1.2 },
  dog: { bladder: 1.4, affection: 1.4, play: 1.5 },
};
const FOOD_ITEM: Partial<Record<PetSpecies, string>> = { dog: 'dog_food', cat: 'cat_food' };
const TRICKS = ['sit', 'stay', 'shake', 'roll over', 'come', 'heel', 'fetch', 'play dead', 'high five', 'spin'];
const PET_NAMES = ['Biscuit', 'Luna', 'Milo', 'Bella', 'Pepper', 'Mochi', 'Ziggy', 'Olive', 'Bear', 'Nova', 'Waffles', 'Juniper', 'Rocket', 'Maple', 'Gus', 'Pickles', 'Hazel', 'Tank', 'Cleo', 'Bruno'];

const col = (ctx: SystemContext) => ctx.state.region.costOfLiving || 1;
const isControlled = (ctx: SystemContext, id: SimId) => ctx.query.isControlled(id);

function breedDef(ctx: SystemContext, pet: Pet): PetBreedDef | undefined {
  return ctx.content.petBreeds.find((b) => b.breed === pet.breed && b.species === pet.species) ?? ctx.content.petBreeds.find((b) => b.species === pet.species);
}

function householdControlled(ctx: SystemContext, pet: Pet): boolean {
  return !!pet.householdId && ctx.query.controlledSims().some((c) => c.householdId === pet.householdId);
}

function ownersAt(ctx: SystemContext, pet: Pet, venueId: VenueId): Sim[] {
  const hh = pet.householdId ? ctx.state.households[pet.householdId] : undefined;
  if (!hh) return [];
  return hh.simIds.map((id) => ctx.state.sims[id]).filter((s): s is Sim => !!s && s.body.alive && s.location.venueId === venueId && !s.travel);
}

export function makePet(ctx: SystemContext, def: PetBreedDef, opts: { name?: string; ageYears?: number; householdId?: Pet['householdId']; venueId: VenueId }): Pet {
  const rng = ctx.rng;
  const now = ctx.state.time.minute;
  const age = opts.ageYears ?? rng.range(0.3, Math.max(0.5, def.lifespanYears * 0.4));
  const birth = isoDateAt(ctx.state.epoch, now - Math.round(age * 365 * DAY));
  const sizeKg: Record<PetBreedDef['size'], number> = { tiny: 0.4, small: 6, medium: 18, large: 32 };
  return {
    id: newPetId(rng),
    name: opts.name ?? rng.pick(PET_NAMES),
    species: def.species,
    breed: def.breed,
    birthDate: birth,
    gender: rng.chance(0.5) ? 'male' : 'female',
    needs: { hunger: 70, thirst: 75, energy: 70, bladder: 70, hygiene: 60, play: 55, affection: 50 },
    health: rng.int(80, 98),
    weight: round2(sizeKg[def.size] * rng.range(0.8, 1.2)),
    training: def.species === 'dog' ? rng.int(5, 30) : rng.int(0, 10),
    temperament: rng.pick(def.temperaments),
    bonds: {},
    householdId: opts.householdId,
    location: { venueId: opts.venueId },
    illnesses: [],
    vaccinated: rng.chance(0.6),
    spayedNeutered: rng.chance(0.55),
    microchipped: rng.chance(0.5),
    licensed: false,
    alive: true,
    adoptedAt: now,
    monthlyCost: round2(def.monthlyCost * col(ctx)),
    quirks: rng.pickN(['clingy', 'chews shoes', 'afraid of thunder', 'counter surfer', 'zoomies at 3am', 'talks back', 'loves belly rubs', 'escape artist', 'food thief', 'lap warmer'], 2),
  };
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------
function decayPet(ctx: SystemContext, pet: Pet, dtMinutes: number): void {
  const def = breedDef(ctx, pet);
  const energy = def?.energy ?? 0.5;
  const hours = dtMinutes / 60;
  const night = ctx.clock.minuteOfDay >= 23 * HOUR || ctx.clock.minuteOfDay < 6 * HOUR;
  const sp = SPECIES_NEEDS[pet.species] ?? {};
  for (const n of PET_NEEDS) {
    let rate = DECAY[n] * (sp[n] ?? 1);
    if (n === 'play' || n === 'hunger') rate *= 0.6 + energy * 0.8;
    if (n === 'energy') rate = night ? -6 : rate;
    if (pet.illnesses.length) rate *= n === 'energy' ? 1.5 : 1.2;
    pet.needs[n] = clamp100(pet.needs[n] - rate * hours);
  }
  // consequences
  if (pet.needs.hunger <= 5 || pet.needs.thirst <= 5) pet.health = clamp100(pet.health - 0.8 * hours);
  else if (pet.needs.hunger > 40 && pet.needs.thirst > 40 && pet.health < 100 && !pet.illnesses.length) pet.health = clamp100(pet.health + 0.1 * hours);
  if (pet.needs.hygiene < 15) pet.health = clamp100(pet.health - 0.05 * hours);
  const venue = ctx.query.venueMaybe(pet.location.venueId);
  const hh = pet.householdId ? ctx.state.households[pet.householdId] : undefined;
  const atHome = !!hh && venue?.id === hh.homeVenueId;
  if (pet.needs.bladder <= 0.5 && pet.species !== 'fish') {
    const yard = !!venue?.residence?.yard;
    if (pet.species === 'dog' && yard && atHome && pet.quirks.includes('escape artist') && ctx.rng.chance(0.15)) {
      escape(ctx, pet);
    } else if (pet.species === 'dog' && yard && atHome && ctx.rng.chance(0.03)) {
      escape(ctx, pet);
    } else {
      pet.needs.bladder = 55;
      if (venue) ctx.applyEffects(hh?.simIds[0] ?? ctx.state.player.activeSimId, { venue: [{ venueId: venue.id, cleanliness: pet.species === 'cat' ? -4 : -8 }] }, 'pet:accident');
      if (householdControlled(ctx, pet) && atHome) ctx.log({ text: `${pet.name} had an accident on the floor.`, kind: 'need', importance: 1 });
    }
  }
  if (pet.species === 'cat' && atHome && pet.needs.hygiene < 25 && ctx.rng.chance(0.05 * hours) && venue) ctx.applyEffects(hh?.simIds[0] ?? ctx.state.player.activeSimId, { venue: [{ venueId: venue.id, cleanliness: -2 }] }, 'pet:litter');
  for (const n of ['hunger', 'thirst'] as const) {
    if (pet.needs[n] < 10 && !pet.quirks.includes(`__crit_${n}`)) {
      ctx.emit({ type: 'pet:need_critical', petId: pet.id, need: n });
      if (householdControlled(ctx, pet)) ctx.log({ text: `${pet.name} is ${n === 'hunger' ? 'starving' : 'desperately thirsty'}.`, kind: 'alert', importance: 2 });
    }
  }
  // bonds: proximity to household members
  for (const s of ownersAt(ctx, pet, pet.location.venueId)) {
    pet.bonds[s.id] = clamp100((pet.bonds[s.id] ?? 0) + 0.15 * hours);
  }
}

function escape(ctx: SystemContext, pet: Pet): void {
  const park = ctx.query.nearestVenue(pet.location.venueId, 'park') ?? ctx.query.nearestVenue(pet.location.venueId, 'trail');
  pet.location = { venueId: park?.id ?? pet.location.venueId };
  pet.needs.bladder = 70;
  const hh = pet.householdId ? ctx.state.households[pet.householdId] : undefined;
  if (hh) ctx.state.flags[`pet_lost:${pet.id}`] = ctx.state.time.minute;
  ctx.emit({ type: 'pet:escaped', petId: pet.id });
  if (householdControlled(ctx, pet)) {
    const owner = hh?.simIds.map((id) => ctx.state.sims[id]).find((s) => s && isControlled(ctx, s.id));
    ctx.log({ text: `${pet.name} got out through the yard and ran off.`, kind: 'alert', simId: owner?.id, importance: 2 });
    if (owner) ctx.applyEffects(owner.id, { moodlets: [{ emotion: 'anxious', label: `${pet.name} is missing`, intensity: -10, durationMinutes: DAY * 3, id: `petlost:${pet.id}` }] }, 'pet:escaped');
  }
}

function dailyPet(ctx: SystemContext, pet: Pet): void {
  const now = ctx.state.time.minute;
  const def = breedDef(ctx, pet);
  const age = ageAt(pet.birthDate, ctx.state.epoch, now);
  const lifespan = def?.lifespanYears ?? 12;
  const hh = pet.householdId ? ctx.state.households[pet.householdId] : undefined;
  const owner = hh?.simIds.map((id) => ctx.state.sims[id]).find((s) => s && isControlled(ctx, s.id));
  // illness
  const sickChance = 0.002 + (pet.vaccinated ? 0 : 0.003) + (age > lifespan * 0.8 ? 0.004 : 0) + (pet.needs.hygiene < 20 ? 0.003 : 0);
  if (!pet.illnesses.length && ctx.rng.chance(sickChance)) {
    const names = ['ear infection', 'upset stomach', 'skin allergy', 'kennel cough', 'urinary infection', 'limp', 'dental disease'];
    const name = ctx.rng.pick(names);
    pet.illnesses.push({ id: `ill_${pet.id.slice(4, 10)}_${now}`, name, defId: `pet_${name.replace(/ /g, '_')}`, severity: ctx.rng.int(15, 45), startedAt: now, contagious: false, chronic: false, treated: false, diagnosed: false });
    ctx.emit({ type: 'pet:sick', petId: pet.id, name });
    if (householdControlled(ctx, pet)) ctx.log({ text: `${pet.name} seems unwell (${name}). A vet visit would help.`, kind: 'alert', simId: owner?.id, importance: 2 });
  }
  for (const ill of pet.illnesses) {
    if (ill.treated) ill.severity -= 8;
    else ill.severity += 2;
    pet.health = clamp100(pet.health - (ill.treated ? 0 : ill.severity / 40));
  }
  pet.illnesses = pet.illnesses.filter((i) => i.severity > 0);
  // aging & death
  const over = age - lifespan;
  const deathAnnual = over > 0 ? 0.25 + over * 0.2 : age > lifespan * 0.8 ? 0.05 : 0.005;
  if (pet.health <= 0 || ctx.rng.chance(deathAnnual / 365)) {
    petDied(ctx, pet, pet.health <= 0 ? 'illness' : 'old age');
    return;
  }
  // neglect
  if (pet.needs.hunger < 10 || pet.needs.thirst < 10) {
    pet.quirks = pet.quirks.filter((q) => !q.startsWith('__'));
    const streak = Number(ctx.state.flags[`pet_neglect:${pet.id}`] ?? 0) + 1;
    ctx.state.flags[`pet_neglect:${pet.id}`] = streak;
    if (streak >= 2 && owner && ctx.rng.chance(0.15)) {
      ctx.emit({ type: 'custom', kind: 'legal:animal_neglect', simId: owner.id, payload: { petId: pet.id } });
      ctx.log({ text: `Someone reported ${pet.name}'s condition to animal control.`, kind: 'alert', simId: owner.id, importance: 2 });
    }
  } else delete ctx.state.flags[`pet_neglect:${pet.id}`];
  // animal lovers cheer up
  if (hh) {
    for (const id of hh.simIds) {
      const s = ctx.state.sims[id];
      if (!s || !s.body.alive || s.lod === 'far') continue;
      if (hasTrait(s, 'animal_lover') && s.location.venueId === pet.location.venueId) ctx.applyEffects(s.id, { moodlets: [{ emotion: 'happy', label: `${pet.name} is the best`, intensity: 5, durationMinutes: DAY, id: `pet_joy:${pet.id}` }] }, 'pet:daily');
    }
  }
  // lost pet found on its own
  if (ctx.state.flags[`pet_lost:${pet.id}`] && ctx.rng.chance(0.2) && hh) {
    delete ctx.state.flags[`pet_lost:${pet.id}`];
    pet.location = { venueId: hh.homeVenueId };
    if (owner) {
      ctx.log({ text: `${pet.name} showed up on the porch, filthy and hungry.`, kind: 'event', simId: owner.id, importance: 2 });
      owner.mind.moodlets = owner.mind.moodlets.filter((m) => m.id !== `petlost:${pet.id}`);
    }
  }
}

function petDied(ctx: SystemContext, pet: Pet, cause: string): void {
  pet.alive = false;
  ctx.emit({ type: 'pet:died', petId: pet.id, name: pet.name });
  const hh = pet.householdId ? ctx.state.households[pet.householdId] : undefined;
  if (!hh) return;
  hh.petIds = hh.petIds.filter((id) => id !== pet.id);
  for (const id of hh.simIds) {
    const s = ctx.state.sims[id];
    if (!s || !s.body.alive) continue;
    const bond = pet.bonds[s.id] ?? 20;
    const lover = hasTrait(s, 'animal_lover');
    ctx.applyEffects(s.id, { moodlets: [{ emotion: 'grieving', label: `${pet.name} died`, intensity: -(8 + bond / 8 + (lover ? 6 : 0)), durationMinutes: DAY * (lover ? 14 : 7) }] }, 'pet:died');
    pushMemory(s, { kind: 'event', text: `${pet.name}, our ${pet.breed.toLowerCase()}, died of ${cause}.`, salience: 70, valence: -0.9, tags: ['pet', 'death'] }, ctx.state.time.minute, ctx.rng);
    s.finance.bills = s.finance.bills.filter((b) => b.linkedId !== pet.id);
    if (isControlled(ctx, s.id)) ctx.log({ text: `${pet.name} passed away (${cause}).`, kind: 'event', simId: s.id, importance: 3 });
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function petActions(ctx: SystemContext, sim: Sim, pet: Pet): ActionDef[] {
  const out: ActionDef[] = [];
  const venue = ctx.query.venueMaybe(sim.location.venueId);
  const hh = ctx.query.householdOf(sim.id);
  const atHome = !!hh && venue?.id === hh.homeVenueId;
  const here = pet.location.venueId === sim.location.venueId;
  const def = (id: string, label: string, minutes: number, extra: Partial<ActionDef> = {}): ActionDef => ({ id: `pet:${pet.id}:${id}`, label, category: 'pet', durationMinutes: minutes, effects: {}, group: pet.name, target: { kind: 'pet', id: pet.id, name: pet.name }, interruptible: true, autonomyWeight: 0.6, ...extra });
  const lost = !!ctx.state.flags[`pet_lost:${pet.id}`];
  if (lost) {
    out.push(def('search', `Search for ${pet.name}`, 90, { icon: 'search' }));
    out.push(def('poster', `Put up lost-pet posters ($15)`, 45, { cost: { amount: 15, memo: 'Lost pet posters', category: 'pet' }, requirements: [{ kind: 'money', reason: 'Costs $15', params: { amount: 15 } }] }));
    return out;
  }
  if (!here) return out;
  const food = FOOD_ITEM[pet.species];
  const foodReq: Requirement[] = food ? [{ kind: 'item', reason: `Need ${food.replace('_', ' ')}`, params: { itemId: food, qty: 1, pantry: true } }] : [];
  out.push(def('feed', `Feed ${pet.name}`, 5, { requirements: foodReq, icon: 'bowl' }));
  out.push(def('water', `Refill ${pet.name}'s water`, 2));
  if (pet.species === 'dog') out.push(def('walk', `Walk ${pet.name}`, 30, { requirements: [{ kind: 'energy', reason: 'Too tired', params: { min: 15 } }], icon: 'walk' }));
  if (pet.species !== 'fish') out.push(def('play', `Play with ${pet.name}`, 15, { icon: 'toy' }));
  if (pet.species !== 'fish') out.push(def('cuddle', pet.species === 'reptile' || pet.species === 'bird' ? `Handle ${pet.name}` : `Pet ${pet.name}`, 10, { icon: 'heart' }));
  if (pet.species === 'dog' || pet.species === 'cat' || pet.species === 'bird') out.push(def('train', `Train ${pet.name}`, 20, { requirements: [{ kind: 'energy', reason: 'Too tired', params: { min: 10 } }], icon: 'star' }));
  if (pet.species === 'dog' || pet.species === 'cat' || pet.species === 'rabbit') out.push(def('groom', `Brush/bathe ${pet.name}`, 20, { icon: 'brush' }));
  if (pet.species === 'cat' && atHome) out.push(def('litter', 'Clean the litter box', 10, { requirements: [{ kind: 'item', reason: 'Need cat litter', params: { itemId: 'cat_litter', qty: 1, pantry: true } }] }));
  if (pet.species === 'fish' || pet.species === 'reptile' || pet.species === 'hamster' || pet.species === 'bird') out.push(def('clean_habitat', `Clean ${pet.name}'s ${pet.species === 'fish' ? 'tank' : pet.species === 'bird' ? 'cage' : 'enclosure'}`, 25));
  if (venue?.archetype === 'vet') {
    const m = col(ctx) * (venue.priceMultiplier || 1);
    const checkup = round2(85 * m);
    const vax = round2(60 * m);
    const spay = round2(300 * m);
    out.push(def('vet_checkup', `Checkup ($${checkup.toFixed(0)})`, 40, { cost: { amount: checkup, memo: `Vet checkup: ${pet.name}`, category: 'pet', counterparty: venue.name }, requirements: [{ kind: 'money', reason: `Costs $${checkup}`, params: { amount: checkup } }] }));
    if (!pet.vaccinated) out.push(def('vet_vaccine', `Vaccinations ($${vax.toFixed(0)})`, 20, { cost: { amount: vax, memo: `Vaccines: ${pet.name}`, category: 'pet', counterparty: venue.name }, requirements: [{ kind: 'money', reason: `Costs $${vax}`, params: { amount: vax } }] }));
    if (!pet.spayedNeutered && pet.species !== 'fish' && pet.species !== 'reptile' && pet.species !== 'bird') out.push(def('vet_spay', `${pet.gender === 'female' ? 'Spay' : 'Neuter'} ($${spay.toFixed(0)})`, 120, { cost: { amount: spay, memo: `Spay/neuter: ${pet.name}`, category: 'pet', counterparty: venue.name }, requirements: [{ kind: 'money', reason: `Costs $${spay}`, params: { amount: spay } }] }));
    if (!pet.microchipped) out.push(def('vet_chip', `Microchip ($${round2(50 * m).toFixed(0)})`, 10, { cost: { amount: round2(50 * m), memo: `Microchip: ${pet.name}`, category: 'pet', counterparty: venue.name } }));
    for (const ill of pet.illnesses) {
      if (ill.treated) continue;
      const price = round2(clamp(200 + ill.severity * 30, 200, 2000) * m);
      out.push(def(`vet_treat:${ill.id}`, `Treat ${ill.name} ($${price.toFixed(0)})`, 60, { cost: { amount: price, memo: `Vet treatment (${ill.name}): ${pet.name}`, category: 'pet', counterparty: venue.name }, requirements: [{ kind: 'money', reason: `Costs $${price}`, params: { amount: price } }] }));
    }
  }
  if (venue?.archetype === 'city_hall' && !pet.licensed && (pet.species === 'dog' || pet.species === 'cat')) out.push(def('license', `Pet license for ${pet.name} ($20/yr)`, 15, { cost: { amount: 20, memo: `Pet license: ${pet.name}`, category: 'pet', counterparty: venue.name }, requirements: [{ kind: 'money', reason: 'Costs $20', params: { amount: 20 } }] }));
  if (pet.species === 'dog' && (venue?.archetype === 'park' || atHome)) {
    const park = atHome ? ctx.query.nearestVenue(sim.location.venueId, 'park') : venue;
    if (park && atHome) out.push(def('dog_park', `Take ${pet.name} to ${park.name}`, 90, { requirements: [{ kind: 'energy', reason: 'Too tired', params: { min: 15 } }], params: { venueId: park.id } }));
  }
  if (atHome && (pet.species === 'dog' || pet.species === 'cat')) {
    const along = ctx.state.flags[`pet_along:${pet.id}`] === sim.id;
    out.push(def(along ? 'leave_home' : 'take_along', along ? `Leave ${pet.name} at home from now on` : `Take ${pet.name} along when you go out`, 1, { autonomyWeight: 0 }));
  }
  return out;
}

function adoptionActions(ctx: SystemContext, sim: Sim): ActionDef[] {
  const venue = ctx.query.venueMaybe(sim.location.venueId);
  if (!venue || (venue.archetype !== 'shelter' && venue.archetype !== 'pet_store')) return [];
  const hh = ctx.query.householdOf(sim.id);
  const home = hh && ctx.query.venueMaybe(hh.homeVenueId);
  const out: ActionDef[] = [];
  const shelter = venue.archetype === 'shelter';
  const breeds = ctx.content.petBreeds;
  const day = Math.floor(ctx.state.time.minute / DAY);
  breeds.forEach((b, i) => {
    if (shelter && !(b.species === 'dog' || b.species === 'cat' || b.species === 'rabbit')) return;
    // rotate the available animals daily so the shelter feels alive
    if (shelter && (i + day) % 3 === 0) return;
    const price = round2((shelter ? b.adoptionCost : b.purchaseCost) * (venue.priceMultiplier || 1));
    const reqs: Requirement[] = [{ kind: 'money', reason: `Costs $${price.toFixed(0)}`, params: { amount: price } }];
    if (!hh) reqs.push(blocked('You need a home first'));
    if (home?.residence && !home.residence.petsAllowed && (b.species === 'dog' || b.species === 'cat')) reqs.push(blocked('Your lease does not allow pets'));
    if (hh && hh.petIds.length >= 4) reqs.push(blocked('Four pets is plenty'));
    out.push({ id: `pet:adopt:${i}`, label: `${shelter ? 'Adopt' : 'Buy'} a ${b.breed} (${b.species}) — $${price.toFixed(0)}, ~$${Math.round(b.monthlyCost * col(ctx))}/mo`, category: 'pet', durationMinutes: shelter ? 60 : 30, cost: { amount: price, memo: `${shelter ? 'Adoption fee' : 'Purchase'}: ${b.breed}`, category: 'pet', counterparty: venue.name }, requirements: reqs, effects: {}, group: shelter ? 'Adopt a pet' : 'Buy a pet', params: { breedIndex: i } });
  });
  return out;
}

function execute(ctx: SystemContext, simId: SimId, action: ActionDef, params: Record<string, unknown>): ActionResult {
  const sim = ctx.state.sims[simId];
  if (!sim) return { ok: false };
  const now = ctx.state.time.minute;
  const parts = action.id.split(':');
  if (parts[1] === 'adopt') {
    const idx = Number(parts[2]);
    const def = ctx.content.petBreeds[idx];
    const hh = ctx.query.householdOf(simId);
    if (!def || !hh) return { ok: false, text: 'Not available.' };
    const name = typeof params.name === 'string' && params.name.trim() ? params.name.trim().slice(0, 24) : undefined;
    const pet = makePet(ctx, def, { name, householdId: hh.id, venueId: hh.homeVenueId, ageYears: ctx.query.venueMaybe(sim.location.venueId)?.archetype === 'pet_store' ? ctx.rng.range(0.15, 0.5) : undefined });
    pet.bonds[simId] = 15;
    if (def.species === 'dog') sim.inventory.consumables.leash = (sim.inventory.consumables.leash ?? 0) + 1;
    ctx.state.pets[pet.id] = pet;
    hh.petIds.push(pet.id);
    sim.finance.bills.push({ id: `bill_pet_${pet.id.slice(4, 12)}`, name: `Pet supplies (${pet.name})`, amount: pet.monthlyCost, dueDayOfMonth: 15, category: 'other', autopay: true, missed: 0, linkedId: pet.id });
    ctx.emit({ type: 'pet:adopted', petId: pet.id, householdId: hh.id });
    ctx.log({ text: `You ${parts[2] && ctx.query.venueMaybe(sim.location.venueId)?.archetype === 'shelter' ? 'adopt' : 'bring home'} ${pet.name}, a ${pet.breed.toLowerCase()} (${pet.temperament}).`, kind: 'event', simId, importance: 2 });
    return { ok: true, text: `${pet.name} is coming home with you.`, effects: { moodlets: [{ emotion: 'happy', label: `New pet: ${pet.name}`, intensity: 10, durationMinutes: DAY * 3 }], memories: [{ kind: 'milestone', text: `I ${ctx.query.venueMaybe(sim.location.venueId)?.archetype === 'shelter' ? 'adopted' : 'bought'} ${pet.name}, a ${pet.breed}.`, salience: 60, valence: 0.8 }] }, data: { petId: pet.id } };
  }
  const pet = ctx.state.pets[parts[1] as Pet['id']];
  if (!pet) return { ok: false, text: 'No such pet.' };
  const inter = parts[2];
  const hh = ctx.query.householdOf(simId);
  const bondUp = (n: number) => {
    pet.bonds[simId] = clamp100((pet.bonds[simId] ?? 0) + n);
  };
  const mem = (text: string, valence = 0.3) => ({ memories: [{ kind: 'interaction' as const, text, valence, salience: 12, tags: ['pet'] }] });
  switch (inter) {
    case 'feed': {
      const food = FOOD_ITEM[pet.species];
      if (food) {
        if ((sim.inventory.consumables[food] ?? 0) > 0) sim.inventory.consumables[food] -= 1;
        else if (hh && (hh.pantry[food] ?? 0) > 0) hh.pantry[food] -= 1;
        else return { ok: false, text: `You're out of ${food.replace('_', ' ')}.` };
        if (sim.inventory.consumables[food] === 0) delete sim.inventory.consumables[food];
        if (hh && hh.pantry[food] === 0) delete hh.pantry[food];
      }
      pet.needs.hunger = clamp100(pet.needs.hunger + 45);
      pet.needs.affection = clamp100(pet.needs.affection + 5);
      bondUp(1.5);
      return { ok: true, text: `${pet.name} eats.`, effects: mem(`Fed ${pet.name}.`) };
    }
    case 'water':
      pet.needs.thirst = 100;
      return { ok: true, text: `Fresh water for ${pet.name}.` };
    case 'walk': {
      pet.needs.bladder = 100;
      pet.needs.play = clamp100(pet.needs.play + 35);
      pet.needs.energy = clamp100(pet.needs.energy - 10);
      pet.needs.affection = clamp100(pet.needs.affection + 15);
      bondUp(3);
      const rain = ctx.state.weather.current.condition === 'rain' || ctx.state.weather.current.condition === 'heavy_rain';
      return { ok: true, text: rain ? `A soggy walk with ${pet.name}.` : `A good walk with ${pet.name}.`, effects: { needs: { fun: rain ? 4 : 10, social: 5, energy: -5, hygiene: rain ? -8 : -3 }, fitness: 0.4, skills: { fitness: 3 }, stress: -4, moodlets: [{ emotion: 'relaxed', label: `Walked ${pet.name}`, intensity: rain ? 1 : 4, durationMinutes: 180 }], ...mem(`Walked ${pet.name}.`) } };
    }
    case 'play':
      pet.needs.play = clamp100(pet.needs.play + 35);
      pet.needs.affection = clamp100(pet.needs.affection + 15);
      pet.needs.energy = clamp100(pet.needs.energy - 8);
      bondUp(2.5);
      return { ok: true, text: `${pet.name} ${pet.species === 'dog' ? 'brings the toy back, sort of' : 'goes wild'}.`, effects: { needs: { fun: 14, social: 6 }, stress: -4, ...mem(`Played with ${pet.name}.`) } };
    case 'cuddle':
      pet.needs.affection = clamp100(pet.needs.affection + 30);
      bondUp(2);
      return { ok: true, text: `${pet.name} ${pet.species === 'cat' ? 'purrs' : pet.species === 'dog' ? 'leans in' : 'settles down'}.`, effects: { needs: { social: 8, comfort: 6 }, stress: -6, moodlets: [{ emotion: 'relaxed', label: `Cuddled ${pet.name}`, intensity: 3, durationMinutes: 120 }], ...mem(`Cuddled ${pet.name}.`) } };
    case 'train': {
      const def = breedDef(ctx, pet);
      const skill = (sim.skills.charisma?.level ?? 0) * 0.04 + (sim.skills.parenting?.level ?? 0) * 0.02;
      const p = 0.35 + (def?.trainability ?? 0.4) * 0.4 + skill + (pet.bonds[simId] ?? 0) / 300;
      const ok = ctx.rng.chance(clamp(p, 0.1, 0.95));
      const before = Math.floor(pet.training / 10);
      pet.training = clamp100(pet.training + (ok ? 6 : 2));
      pet.needs.play = clamp100(pet.needs.play + 15);
      pet.needs.energy = clamp100(pet.needs.energy - 6);
      bondUp(1.5);
      const after = Math.floor(pet.training / 10);
      let text = ok ? `${pet.name} is getting it.` : `${pet.name} is distracted today.`;
      if (after > before) {
        const trick = TRICKS[Math.min(TRICKS.length - 1, after - 1)];
        ctx.emit({ type: 'pet:trained', petId: pet.id, level: after });
        text = `${pet.name} learned "${trick}"!`;
        ctx.log({ text, kind: 'event', simId, importance: 1 });
      }
      return { ok: true, text, outcomeLabel: ok ? 'progress' : 'distracted', effects: { needs: { fun: 6, social: 3 }, skills: { charisma: 3 }, ...mem(text) } };
    }
    case 'groom':
      pet.needs.hygiene = 100;
      pet.needs.affection = clamp100(pet.needs.affection + 8);
      bondUp(1);
      return { ok: true, text: `${pet.name} is clean${pet.species === 'cat' ? ' and offended' : ''}.`, effects: { needs: { hygiene: -5 }, ...mem(`Groomed ${pet.name}.`) } };
    case 'litter':
      if ((sim.inventory.consumables.cat_litter ?? 0) > 0) sim.inventory.consumables.cat_litter -= 1;
      else if (hh && (hh.pantry.cat_litter ?? 0) > 0) hh.pantry.cat_litter -= 1;
      pet.needs.hygiene = clamp100(pet.needs.hygiene + 40);
      pet.needs.bladder = clamp100(pet.needs.bladder + 30);
      return { ok: true, text: 'Litter box scooped and refilled.', effects: { needs: { hygiene: -4 }, venue: hh ? [{ venueId: hh.homeVenueId, cleanliness: 4 }] : undefined } };
    case 'clean_habitat':
      pet.needs.hygiene = 100;
      pet.health = clamp100(pet.health + 2);
      return { ok: true, text: `${pet.name}'s home is spotless.`, effects: { needs: { hygiene: -4, fun: 2 } } };
    case 'vet_checkup':
      pet.lastVetAt = now;
      pet.health = clamp100(pet.health + 5);
      for (const ill of pet.illnesses) ill.diagnosed = true;
      return { ok: true, text: pet.illnesses.length ? `The vet diagnoses ${pet.illnesses.map((i) => i.name).join(', ')}.` : `${pet.name} gets a clean bill of health.`, effects: mem(`Took ${pet.name} to the vet.`, 0.1) };
    case 'vet_vaccine':
      pet.vaccinated = true;
      return { ok: true, text: `${pet.name} is up to date on shots.` };
    case 'vet_spay':
      pet.spayedNeutered = true;
      pet.needs.energy = clamp100(pet.needs.energy - 30);
      return { ok: true, text: `${pet.name} is groggy but fine.` };
    case 'vet_chip':
      pet.microchipped = true;
      return { ok: true, text: `${pet.name} is microchipped.` };
    case 'vet_treat': {
      const ill = pet.illnesses.find((i) => i.id === parts[3]);
      if (!ill) return { ok: false, text: 'Nothing to treat.' };
      ill.treated = true;
      ill.diagnosed = true;
      ill.severity = Math.max(1, ill.severity - 15);
      pet.health = clamp100(pet.health + 8);
      return { ok: true, text: `Treatment started for ${pet.name}'s ${ill.name}.`, effects: { moodlets: [{ emotion: 'relaxed', label: `${pet.name} is on the mend`, intensity: 3, durationMinutes: DAY }] } };
    }
    case 'license':
      pet.licensed = true;
      ctx.schedule({ inMinutes: 365 * DAY, kind: '_pet_license_expiry', label: 'Pet license renewal', simId, payload: { petId: pet.id } });
      return { ok: true, text: `${pet.name} is licensed for a year.` };
    case 'dog_park': {
      const parkId = params.venueId as VenueId | undefined;
      const park = parkId ? ctx.query.venueMaybe(parkId) : undefined;
      if (!park) return { ok: false, text: 'No park nearby.' };
      const km = ctx.query.distanceKm(sim.location.venueId, park.id);
      const trip = clamp(Math.round((km / 5) * 60), 5, 40);
      pet.needs.bladder = 100;
      pet.needs.play = 100;
      pet.needs.energy = clamp100(pet.needs.energy - 25);
      pet.needs.affection = clamp100(pet.needs.affection + 20);
      pet.needs.hygiene = clamp100(pet.needs.hygiene - 15);
      bondUp(4);
      return { ok: true, text: `${pet.name} runs with the pack at ${park.name}.`, durationMinutes: 90 + trip * 2, effects: { needs: { fun: 15, social: 12, energy: -8 }, fitness: 0.5, stress: -6, moodlets: [{ emotion: 'happy', label: 'Dog park', intensity: 5, durationMinutes: 240 }], ...mem(`Took ${pet.name} to ${park.name}.`) } };
    }
    case 'take_along':
      ctx.state.flags[`pet_along:${pet.id}`] = simId;
      return { ok: true, text: `${pet.name} will tag along with you.` };
    case 'leave_home':
      delete ctx.state.flags[`pet_along:${pet.id}`];
      if (hh) pet.location = { venueId: hh.homeVenueId };
      return { ok: true, text: `${pet.name} stays home.` };
    case 'search': {
      const found = ctx.rng.chance(0.45 + (pet.microchipped ? 0.15 : 0) + (pet.bonds[simId] ?? 0) / 300);
      if (found && hh) {
        delete ctx.state.flags[`pet_lost:${pet.id}`];
        pet.location = { venueId: hh.homeVenueId };
        sim.mind.moodlets = sim.mind.moodlets.filter((m) => m.id !== `petlost:${pet.id}`);
        bondUp(5);
        return { ok: true, text: `You find ${pet.name} two blocks over, tail going.`, effects: { moodlets: [{ emotion: 'grateful', label: `Found ${pet.name}`, intensity: 10, durationMinutes: DAY }], needs: { energy: -10 }, ...mem(`Found ${pet.name} after they ran off.`, 0.8) } };
      }
      return { ok: true, text: `No sign of ${pet.name} yet.`, effects: { needs: { energy: -10 }, stress: 5 } };
    }
    case 'poster':
      ctx.state.flags[`pet_poster:${pet.id}`] = now;
      ctx.schedule({ inMinutes: ctx.rng.int(6, 48) * HOUR, kind: '_pet_poster_call', label: 'lost pet call', simId, payload: { petId: pet.id } });
      return { ok: true, text: 'Posters are up around the neighborhood.' };
    default:
      return { ok: false, text: 'Unknown pet action.' };
  }
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------
export const petsSystem: System = {
  id: 'pets',
  intervalMinutes: 15,
  onTick(ctx, dt) {
    const day = Math.floor(ctx.state.time.minute / DAY);
    const daily = Number(ctx.state.flags['pets:lastDay'] ?? -1) !== day;
    if (daily) ctx.state.flags['pets:lastDay'] = day;
    for (const pet of Object.values(ctx.state.pets)) {
      if (!pet.alive) continue;
      const controlled = householdControlled(ctx, pet);
      if (controlled) decayPet(ctx, pet, dt);
      else if (daily) {
        // NPC pets: their owners take care of them
        for (const n of PET_NEEDS) pet.needs[n] = clamp100(Math.max(pet.needs[n], 60));
      }
      if (daily) dailyPet(ctx, pet);
    }
  },
  onEvent(ctx, e: GameEvent) {
    if (e.type === 'sim:arrived' || e.type === 'transport:arrived') {
      for (const pet of Object.values(ctx.state.pets)) {
        if (!pet.alive) continue;
        if (ctx.state.flags[`pet_along:${pet.id}`] === e.simId) pet.location = { venueId: e.venueId };
      }
    } else if (e.type === 'sim:departed') {
      for (const pet of Object.values(ctx.state.pets)) if (pet.alive && ctx.state.flags[`pet_along:${pet.id}`] === e.simId) pet.location = { venueId: e.venueId };
    } else if (e.type === 'scheduled:fired') {
      const ev = e.event;
      const pet = ev.payload?.petId ? ctx.state.pets[ev.payload.petId as Pet['id']] : undefined;
      if (ev.kind === '_pet_license_expiry' && pet) {
        pet.licensed = false;
        if (ev.simId && ctx.query.isControlled(ev.simId)) ctx.log({ text: `${pet.name}'s pet license expired. Renew at city hall ($20).`, kind: 'phone', simId: ev.simId, importance: 1 });
      } else if (ev.kind === '_pet_poster_call' && pet && ev.simId && ctx.state.flags[`pet_lost:${pet.id}`]) {
        const hh = pet.householdId ? ctx.state.households[pet.householdId] : undefined;
        if (!hh) return;
        delete ctx.state.flags[`pet_lost:${pet.id}`];
        pet.location = { venueId: hh.homeVenueId };
        const owner = ctx.state.sims[ev.simId];
        if (owner) owner.mind.moodlets = owner.mind.moodlets.filter((m) => m.id !== `petlost:${pet.id}`);
        ctx.interrupt({ kind: 'phone_call', title: 'Someone found your pet', body: `A neighbor saw the poster — they have ${pet.name}. They're bringing ${pet.gender === 'female' ? 'her' : 'him'} over now.`, simId: ev.simId, options: [{ label: 'Thank them', actionId: `pet:${pet.id}:cuddle` }] });
      }
    }
  },
  actions(ctx, simId) {
    const sim = ctx.state.sims[simId];
    if (!sim || !sim.body.alive || sim.lifeStage === 'infant' || sim.lifeStage === 'toddler') return [];
    const out: ActionDef[] = [];
    const hh = ctx.query.householdOf(simId);
    if (hh) for (const pet of ctx.query.petsOf(hh.id)) out.push(...petActions(ctx, sim, pet));
    // strays / pets of other households present (only cuddle)
    for (const pet of Object.values(ctx.state.pets)) {
      if (!pet.alive || pet.location.venueId !== sim.location.venueId || (hh && pet.householdId === hh.id) || pet.species === 'fish') continue;
      out.push({ id: `pet:${pet.id}:cuddle`, label: `Pet ${pet.name}`, category: 'pet', durationMinutes: 5, effects: {}, group: 'Animals here', target: { kind: 'pet', id: pet.id, name: pet.name } });
    }
    if (sim.lifeStage !== 'child' && sim.lifeStage !== 'teen') out.push(...adoptionActions(ctx, sim));
    out.push(...pendingInterruptActions(ctx, 'pet:'));
    return out;
  },
  handles: (id) => id.startsWith('pet:'),
  execute,
};

