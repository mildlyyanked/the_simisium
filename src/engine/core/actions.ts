/**
 * Action availability & requirement checking.
 * Sources: object interactions, venue archetype actions, systems' contributed actions, travel, phone, freeform.
 */
import type { InteractionDef } from '../content/types';
import type { SystemContext } from './systems';
import type { ActionDef, ObjectInstance, Requirement, Sim, SimId, Venue } from './types';
import { liquidCash } from './effects';
import { ageAt } from './clock';

export interface ActionAvailability {
  action: ActionDef;
  available: boolean;
  reasons: string[];
}

export function interactionToAction(inter: InteractionDef, obj: ObjectInstance, objName: string): ActionDef {
  const reqs: Requirement[] = [...(inter.requirements ?? [])];
  if (inter.requiresState) {
    const rs = inter.requiresState;
    if (rs.notBroken) reqs.push({ kind: 'object_state', reason: `${objName} is broken`, params: { objectId: obj.id, notBroken: true } });
    if (rs.unoccupied) reqs.push({ kind: 'object_state', reason: `${objName} is in use`, params: { objectId: obj.id, unoccupied: true } });
    if (rs.maxDirty !== undefined) reqs.push({ kind: 'object_state', reason: `${objName} is too dirty`, params: { objectId: obj.id, maxDirty: rs.maxDirty } });
    if (rs.minCharge !== undefined) reqs.push({ kind: 'object_state', reason: `${objName} needs charging`, params: { objectId: obj.id, minCharge: rs.minCharge } });
  }
  if (inter.consumes) for (const c of inter.consumes) reqs.push({ kind: 'item', reason: `Need ${c.qty} × ${c.itemId.replace(/_/g, ' ')}`, params: { itemId: c.itemId, qty: c.qty, pantry: true } });
  if (inter.minStage) reqs.push({ kind: 'age', reason: `Too young`, params: { minStage: inter.minStage } });
  if (inter.cost) reqs.push({ kind: 'money', reason: `Costs $${inter.cost}`, params: { amount: inter.cost } });
  return {
    id: `obj:${obj.id}:${inter.id}`,
    label: inter.label,
    description: inter.description,
    category: inter.category,
    icon: inter.icon,
    target: { kind: 'object', id: obj.id, name: objName },
    durationMinutes: inter.durationMinutes,
    cost: inter.cost ? { amount: inter.cost, memo: `${inter.label} (${objName})`, category: 'object' } : undefined,
    requirements: reqs,
    effects: inter.effects,
    outcomes: inter.outcomes,
    llm: inter.llm,
    autonomyWeight: inter.autonomyWeight,
    satisfies: inter.satisfies,
    interruptible: true,
    group: inter.group ?? objName,
    params: { interactionId: inter.id, consumes: inter.consumes, produces: inter.produces, dirtiesBy: inter.dirtiesBy, wearBy: inter.wearBy, setsState: inter.setsState },
  };
}

export function venueActionToAction(inter: InteractionDef, venue: Venue): ActionDef {
  const reqs: Requirement[] = [...(inter.requirements ?? [])];
  const cost = inter.cost ? Math.round(inter.cost * venue.priceMultiplier * 100) / 100 : undefined;
  if (cost) reqs.push({ kind: 'money', reason: `Costs $${cost.toFixed(2)}`, params: { amount: cost } });
  if (inter.minStage) reqs.push({ kind: 'age', reason: `Too young`, params: { minStage: inter.minStage } });
  if (inter.consumes) for (const c of inter.consumes) reqs.push({ kind: 'item', reason: `Need ${c.qty} × ${c.itemId.replace(/_/g, ' ')}`, params: { itemId: c.itemId, qty: c.qty } });
  if (!inter.requirements?.some((r) => r.kind === 'venue_open')) reqs.push({ kind: 'venue_open', reason: `${venue.name} is closed`, params: { venueId: venue.id } });
  return {
    id: `venue:${venue.id}:${inter.id}`,
    label: inter.label,
    description: inter.description,
    category: inter.category,
    icon: inter.icon,
    target: { kind: 'venue', id: venue.id, name: venue.name },
    durationMinutes: inter.durationMinutes,
    cost: cost ? { amount: cost, memo: `${inter.label} at ${venue.name}`, category: 'venue', counterparty: venue.name } : undefined,
    requirements: reqs,
    effects: inter.effects,
    outcomes: inter.outcomes,
    llm: inter.llm,
    autonomyWeight: inter.autonomyWeight,
    satisfies: inter.satisfies,
    interruptible: true,
    group: inter.group ?? venue.name,
    params: { interactionId: inter.id, consumes: inter.consumes, produces: inter.produces },
  };
}

const STAGE_ORDER = ['infant', 'toddler', 'child', 'teen', 'young_adult', 'adult', 'middle_aged', 'senior'];

export function checkRequirement(ctx: SystemContext, sim: Sim, req: Requirement): boolean {
  const p = req.params ?? {};
  switch (req.kind) {
    case 'money': {
      const amt = Number(p.amount ?? 0);
      if (liquidCash(sim) >= amt) return true;
      const cc = sim.finance.accounts.find((a) => a.kind === 'credit_card' && !a.frozen && (a.creditLimit ?? 0) - a.balance >= amt);
      return !!cc && p.noCredit !== true;
    }
    case 'skill': {
      const st = sim.skills[String(p.skillId)];
      return (st?.level ?? 0) >= Number(p.level ?? 0);
    }
    case 'item': {
      const id = String(p.itemId);
      const qty = Number(p.qty ?? 1);
      const own = sim.inventory.consumables[id] ?? 0;
      if (own >= qty) return true;
      if (p.pantry) {
        const hh = ctx.query.householdOf(sim.id);
        const home = hh && ctx.query.venue(hh.homeVenueId);
        if (hh && home && sim.location.venueId === home.id) return (hh.pantry[id] ?? 0) + own >= qty;
      }
      return false;
    }
    case 'object_state': {
      const obj = ctx.state.objects[String(p.objectId) as import('./types').ObjectId];
      if (!obj) return false;
      if (p.notBroken && obj.state.broken) return false;
      if (p.unoccupied && obj.state.occupiedBy && obj.state.occupiedBy !== sim.id) return false;
      if (p.maxDirty !== undefined && (obj.state.dirty ?? 0) > Number(p.maxDirty)) return false;
      if (p.minCharge !== undefined && (obj.state.charge ?? 100) < Number(p.minCharge)) return false;
      if (p.on !== undefined && !!obj.state.on !== !!p.on) return false;
      return true;
    }
    case 'time_window': {
      const mod = ctx.clock.minuteOfDay;
      const start = Number(p.start ?? 0);
      const end = Number(p.end ?? 1440);
      return start <= end ? mod >= start && mod < end : mod >= start || mod < end;
    }
    case 'venue_open':
      return ctx.query.isVenueOpen(String(p.venueId) as Venue['id']);
    case 'age': {
      if (p.minStage) return STAGE_ORDER.indexOf(sim.lifeStage) >= STAGE_ORDER.indexOf(String(p.minStage));
      if (p.minAge !== undefined) return ageAt(sim.identity.birthDate, ctx.state.epoch, ctx.state.time.minute) >= Number(p.minAge);
      return true;
    }
    case 'relationship': {
      const rel = sim.relationships[String(p.simId) as SimId];
      if (!rel) return Number(p.min ?? 0) <= 0 && !p.flag;
      if (p.flag && !rel.flags.includes(p.flag as never)) return false;
      const axis = (p.axis as 'friendship' | 'romance' | 'trust' | 'familiarity') ?? 'friendship';
      return rel[axis] >= Number(p.min ?? -100);
    }
    case 'need': {
      const need = String(p.need) as keyof Sim['needs'];
      const v = sim.needs[need];
      if (p.min !== undefined && v < Number(p.min)) return false;
      if (p.max !== undefined && v > Number(p.max)) return false;
      return true;
    }
    case 'flag': {
      const v = sim.flags[String(p.flag)];
      if (p.equals !== undefined) return v === p.equals;
      return p.not ? !v : !!v;
    }
    case 'license':
      return sim.legal.license.status === 'valid' || (p.allowPermit === true && sim.legal.license.status === 'permit');
    case 'vehicle': {
      const hh = ctx.query.householdOf(sim.id);
      if (!hh) return false;
      return hh.vehicleIds.some((v) => {
        const veh = ctx.state.vehicles[v];
        return veh && veh.location.venueId === sim.location.venueId && (p.kind ? veh.kind === p.kind : true) && (veh.fuelType === 'none' || veh.fuel > 2) && veh.condition > 5;
      });
    }
    case 'not_incarcerated':
      return !(sim.legal.incarceratedUntil && sim.legal.incarceratedUntil > ctx.state.time.minute);
    case 'energy':
      return sim.needs.energy >= Number(p.min ?? 10);
    case 'custom':
      return typeof p.fn === 'function' ? Boolean((p.fn as (s: Sim) => boolean)(sim)) : true;
    default:
      return true;
  }
}

export function evaluateAction(ctx: SystemContext, sim: Sim, action: ActionDef): ActionAvailability {
  const reasons: string[] = [];
  for (const r of action.requirements ?? []) if (!checkRequirement(ctx, sim, r)) reasons.push(r.reason);
  if (sim.legal.incarceratedUntil && sim.legal.incarceratedUntil > ctx.state.time.minute && action.category !== 'system' && !action.id.startsWith('jail:')) reasons.push('You are incarcerated');
  if (!sim.body.alive) reasons.push('Deceased');
  if (sim.travel && action.category !== 'phone' && action.category !== 'system') reasons.push('In transit');
  return { action, available: reasons.length === 0, reasons };
}

/**
 * Collect all actions for a sim: objects at location + inventory, venue actions, systems, travel handled by transport system.
 */
export function availableActions(ctx: SystemContext, simId: SimId, systems: { actions?: (ctx: SystemContext, simId: SimId) => ActionDef[] }[]): ActionAvailability[] {
  const sim = ctx.query.sim(simId);
  const venue = ctx.query.venue(sim.location.venueId);
  const out: ActionDef[] = [];
  const seen = new Set<string>();
  const push = (a: ActionDef) => {
    if (seen.has(a.id)) return;
    seen.add(a.id);
    out.push(a);
  };

  // object interactions (venue objects + carried objects)
  const objects = [...ctx.query.objectsAt(venue.id), ...ctx.query.objectsOf(sim)];
  for (const obj of objects) {
    const def = ctx.content.objects[obj.defId];
    if (!def) continue;
    const name = obj.name ?? def.name;
    for (const inter of def.interactions) push(interactionToAction(inter, obj, name));
  }
  // venue archetype actions
  const arch = ctx.content.archetypes[venue.archetype];
  if (arch) for (const inter of arch.actions) push(venueActionToAction(inter, venue));
  // system-contributed
  for (const s of systems) {
    if (!s.actions) continue;
    try {
      for (const a of s.actions(ctx, simId)) push(a);
    } catch (e) {
      // a broken system must not take the whole menu down
      ctx.log({ text: `Action provider error: ${(e as Error).message}`, kind: 'system', importance: 0 });
    }
  }
  // freeform is always present
  push({
    id: 'freeform',
    label: 'Do something else…',
    description: 'Describe anything you want to try. The world decides what happens.',
    category: 'freeform',
    icon: 'sparkles',
    durationMinutes: 15,
    effects: {},
    llm: 'adjudicate',
    interruptible: true,
    group: 'Freeform',
  });
  return out.filter((a) => !a.hidden).map((a) => evaluateAction(ctx, sim, a));
}
