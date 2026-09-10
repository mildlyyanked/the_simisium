/**
 * The single vocabulary for changing the world. Hand-authored content, systems and
 * the LLM adjudicator all produce EffectBundles; `applyEffects` is the only writer.
 */
import type { ContentCatalog } from '../content/types';
import { shortId } from './ids';
import type { RNG } from './rng';
import type { AccountKind, BioFact, EffectBundle, Moodlet, NeedId, Relationship, RelationshipFlag, Sim, SimId, WorldState } from './types';
import { clamp, clamp100, isFiniteNumber, round2 } from './util';
import type { GameEvent } from './events';

export const NEEDS: readonly NeedId[] = ['hunger', 'thirst', 'energy', 'bladder', 'hygiene', 'social', 'fun', 'comfort'];

export interface EffectContext {
  state: WorldState;
  rng: RNG;
  content: ContentCatalog;
  emit: (e: GameEvent) => void;
  scheduleSpec: (spec: NonNullable<EffectBundle['schedule']>[number]) => void;
  log: (text: string, kind?: 'narrative' | 'money' | 'relationship' | 'system' | 'need', simId?: SimId, importance?: number) => void;
}

/** Plausibility envelopes for LLM-proposed bundles. */
export interface ValidationEnvelope {
  maxNeedDelta: number;
  maxRelationshipDelta: number;
  maxMoneyGain: number;
  maxMoneySpend: number;
  maxSkillXp: number;
  maxHealthDelta: number;
  maxTimeElapsed: number;
  allowMoveTo: boolean;
  allowLegal: boolean;
  allowedItemIds?: Set<string>;
  presentSimIds: Set<SimId>;
}

export const DEFAULT_ENVELOPE: Omit<ValidationEnvelope, 'presentSimIds'> = {
  maxNeedDelta: 40,
  maxRelationshipDelta: 20,
  maxMoneyGain: 200,
  maxMoneySpend: 500,
  maxSkillXp: 60,
  maxHealthDelta: 15,
  maxTimeElapsed: 240,
  allowMoveTo: true,
  allowLegal: true,
};

export function validateEffects(bundle: EffectBundle, env: ValidationEnvelope, state: WorldState, actor: SimId): { bundle: EffectBundle; rejected: string[] } {
  const rejected: string[] = [];
  const out: EffectBundle = {};
  const num = (v: unknown, max: number, label: string): number | undefined => {
    if (v === undefined || v === null) return undefined;
    if (!isFiniteNumber(v)) {
      rejected.push(`${label}: not a number`);
      return undefined;
    }
    if (Math.abs(v) > max) {
      rejected.push(`${label}: ${v} clamped to ±${max}`);
      return clamp(v, -max, max);
    }
    return v;
  };

  if (bundle.needs) {
    out.needs = {};
    for (const k of Object.keys(bundle.needs) as NeedId[]) {
      if (!NEEDS.includes(k)) {
        rejected.push(`needs.${k}: unknown need`);
        continue;
      }
      const v = num(bundle.needs[k], env.maxNeedDelta, `needs.${k}`);
      if (v !== undefined) out.needs[k] = v;
    }
  }
  if (bundle.money) {
    const amt = bundle.money.amount;
    if (!isFiniteNumber(amt)) rejected.push('money: invalid amount');
    else if (amt > env.maxMoneyGain) rejected.push(`money: gain ${amt} exceeds ${env.maxMoneyGain}, clamped`);
    else if (-amt > env.maxMoneySpend) rejected.push(`money: spend ${-amt} exceeds ${env.maxMoneySpend}, clamped`);
    if (isFiniteNumber(amt)) out.money = { ...bundle.money, amount: round2(clamp(amt, -env.maxMoneySpend, env.maxMoneyGain)) };
  }
  if (bundle.skills) {
    out.skills = {};
    for (const [k, v] of Object.entries(bundle.skills)) {
      const n = num(v, env.maxSkillXp, `skills.${k}`);
      if (n !== undefined && n > 0) out.skills[k] = n;
    }
  }
  if (bundle.moodlets) {
    out.moodlets = bundle.moodlets
      .filter((m) => m && typeof m.emotion === 'string' && typeof m.label === 'string')
      .slice(0, 4)
      .map((m) => ({ ...m, intensity: clamp(isFiniteNumber(m.intensity) ? m.intensity : 5, -30, 30), durationMinutes: clamp(isFiniteNumber(m.durationMinutes) ? m.durationMinutes : 120, 5, 1440 * 3) }));
  }
  const stress = num(bundle.stress, 30, 'stress');
  if (stress !== undefined) out.stress = stress;
  const health = num(bundle.health, env.maxHealthDelta, 'health');
  if (health !== undefined) out.health = health;
  const fitness = num(bundle.fitness, 5, 'fitness');
  if (fitness !== undefined) out.fitness = fitness;
  const weight = num(bundle.weight, 1, 'weight');
  if (weight !== undefined) out.weight = weight;
  const bac = num(bundle.bloodAlcohol, 0.08, 'bloodAlcohol');
  if (bac !== undefined) out.bloodAlcohol = bac;
  const caf = num(bundle.caffeine, 300, 'caffeine');
  if (caf !== undefined) out.caffeine = caf;
  const can = num(bundle.cannabis, 60, 'cannabis');
  if (can !== undefined) out.cannabis = can;

  if (bundle.relationships) {
    out.relationships = [];
    for (const r of bundle.relationships) {
      if (!r || typeof r.simId !== 'string' || !state.sims[r.simId]) {
        rejected.push(`relationships: unknown sim ${String(r?.simId)}`);
        continue;
      }
      if (r.simId === actor) {
        rejected.push('relationships: cannot target self');
        continue;
      }
      if (env.presentSimIds.size && !env.presentSimIds.has(r.simId)) {
        rejected.push(`relationships: ${r.simId} not present`);
        continue;
      }
      const m = env.maxRelationshipDelta;
      out.relationships.push({
        simId: r.simId,
        friendship: num(r.friendship, m, 'friendship'),
        romance: num(r.romance, m, 'romance'),
        trust: num(r.trust, m, 'trust'),
        familiarity: r.familiarity !== undefined ? clamp(r.familiarity, 0, m) : undefined,
        attraction: num(r.attraction, m, 'attraction'),
        flags: Array.isArray(r.flags) ? r.flags.filter((f) => f && (f.op === 'add' || f.op === 'remove') && typeof f.flag === 'string').slice(0, 3) : undefined,
        mutual: r.mutual,
      });
    }
  }
  if (bundle.revealFacts) {
    out.revealFacts = [];
    for (const rf of bundle.revealFacts) {
      const s = rf && state.sims[rf.simId];
      if (!s) {
        rejected.push('revealFacts: unknown sim');
        continue;
      }
      const ids = (rf.factIds ?? []).filter((id) => s.bio.facts.some((f) => f.id === id));
      if (ids.length) out.revealFacts.push({ simId: rf.simId, factIds: ids, to: rf.to ?? actor });
    }
  }
  if (bundle.memories) {
    out.memories = bundle.memories.filter((m) => m && typeof m.text === 'string' && m.text.length > 0).slice(0, 5).map((m) => ({ ...m, text: m.text.slice(0, 400) }));
  }
  if (bundle.items) {
    out.items = [];
    for (const it of bundle.items) {
      if (!it || !isFiniteNumber(it.qty) || it.qty <= 0 || typeof it.itemId !== 'string') continue;
      if (env.allowedItemIds && !env.allowedItemIds.has(it.itemId)) {
        rejected.push(`items: ${it.itemId} not obtainable here`);
        continue;
      }
      out.items.push({ op: it.op === 'lose' ? 'lose' : 'gain', itemId: it.itemId, qty: Math.min(20, Math.round(it.qty)) });
    }
  }
  if (bundle.objects) {
    out.objects = bundle.objects.filter((o) => o && state.objects[o.objectId]).slice(0, 5);
  }
  if (bundle.legal) {
    if (env.allowLegal) out.legal = bundle.legal.filter((l) => l && typeof l.kind === 'string').slice(0, 3);
    else if (bundle.legal.length) rejected.push('legal: not allowed in this scene');
  }
  if (bundle.schedule) {
    out.schedule = bundle.schedule.filter((s) => s && typeof s.kind === 'string' && typeof s.label === 'string').slice(0, 3);
  }
  if (bundle.moveTo) {
    if (env.allowMoveTo && state.venues[bundle.moveTo.venueId]) out.moveTo = bundle.moveTo;
    else rejected.push('moveTo: not allowed / unknown venue');
  }
  const t = bundle.timeElapsedMinutes;
  if (t !== undefined) {
    if (!isFiniteNumber(t) || t < 0) rejected.push('timeElapsed: invalid');
    else out.timeElapsedMinutes = Math.min(env.maxTimeElapsed, Math.round(t));
  }
  if (bundle.flags) out.flags = bundle.flags;
  if (bundle.pet) out.pet = bundle.pet.filter((p) => p && state.pets[p.petId]);
  if (bundle.venue) out.venue = bundle.venue.filter((v) => v && state.venues[v.venueId]);
  if (bundle.interrupt) out.interrupt = bundle.interrupt.filter((s) => state.sims[s]);
  if (bundle.custom) out.custom = bundle.custom.filter((c) => c && typeof c.kind === 'string');
  if (bundle.perMinute) out.perMinute = bundle.perMinute;
  return { bundle: out, rejected };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export function ensureRelationship(sim: Sim, otherId: SimId, now: number): Relationship {
  let r = sim.relationships[otherId];
  if (!r) {
    r = {
      simId: otherId,
      friendship: 0,
      romance: 0,
      trust: 0,
      familiarity: 0,
      attraction: 0,
      flags: [],
      firstMetAt: now,
      interactionsCount: 0,
      promises: [],
      grudges: [],
      moneyOwed: 0,
      decayRate: 0.4,
    };
    sim.relationships[otherId] = r;
  }
  return r;
}

export function addMoodlet(sim: Sim, spec: { emotion: Moodlet['emotion']; label: string; intensity: number; durationMinutes: number; source?: string; id?: string }, now: number, rng?: RNG): Moodlet {
  const id = spec.id ?? shortId(rng, 'md');
  sim.mind.moodlets = sim.mind.moodlets.filter((m) => m.id !== id);
  const m: Moodlet = {
    id,
    emotion: spec.emotion,
    label: spec.label,
    intensity: spec.intensity,
    source: spec.source ?? 'unknown',
    startedAt: now,
    expiresAt: now + spec.durationMinutes,
  };
  sim.mind.moodlets.push(m);
  if (sim.mind.moodlets.length > 24) {
    sim.mind.moodlets.sort((a, b) => Math.abs(b.intensity) - Math.abs(a.intensity));
    sim.mind.moodlets = sim.mind.moodlets.slice(0, 24);
  }
  return m;
}

export function liquidAccounts(sim: Sim): Sim['finance']['accounts'] {
  return sim.finance.accounts.filter((a) => a.kind === 'cash' || a.kind === 'checking' || a.kind === 'savings');
}

export function liquidCash(sim: Sim): number {
  return round2(liquidAccounts(sim).reduce((s, a) => s + a.balance, 0));
}

/**
 * Charge or credit money. Returns false when the sim cannot pay (no overdraft path).
 * Spending order: requested account → checking → cash → savings → credit card (if room).
 */
export function transact(
  sim: Sim,
  amount: number,
  memo: string,
  now: number,
  opts: { account?: AccountKind; category?: string; counterparty?: string; venueId?: import('./types').VenueId; allowCredit?: boolean; rng?: RNG } = {},
): { ok: boolean; accountId?: string; shortfall?: number } {
  const accounts = sim.finance.accounts;
  const pick = (kind: AccountKind) => accounts.find((a) => a.kind === kind && !a.frozen);
  const record = (accountId: string, amt: number) => {
    sim.finance.transactions.push({ id: shortId(opts.rng, 'tx'), at: now, amount: round2(amt), accountId, memo, category: opts.category ?? 'misc', counterparty: opts.counterparty, venueId: opts.venueId });
    if (sim.finance.transactions.length > 400) sim.finance.transactions.splice(0, sim.finance.transactions.length - 400);
  };
  amount = round2(amount);
  if (amount >= 0) {
    const acc = pick(opts.account ?? 'checking') ?? pick('checking') ?? pick('cash') ?? accounts[0];
    if (!acc) return { ok: false };
    acc.balance = round2(acc.balance + amount);
    record(acc.id, amount);
    return { ok: true, accountId: acc.id };
  }
  const need = -amount;
  const order: AccountKind[] = opts.account ? [opts.account, 'checking', 'cash', 'savings'] : ['checking', 'cash', 'savings'];
  for (const kind of order) {
    const acc = pick(kind);
    if (acc && acc.balance >= need) {
      acc.balance = round2(acc.balance - need);
      record(acc.id, amount);
      return { ok: true, accountId: acc.id };
    }
  }
  if (opts.allowCredit !== false) {
    const cc = accounts.find((a) => a.kind === 'credit_card' && !a.frozen && (a.creditLimit ?? 0) - a.balance >= need);
    if (cc) {
      cc.balance = round2(cc.balance + need);
      record(cc.id, amount);
      return { ok: true, accountId: cc.id };
    }
  }
  return { ok: false, shortfall: round2(need - liquidCash(sim)) };
}

export function applyEffects(ctx: EffectContext, simId: SimId, bundle: EffectBundle, source: string): void {
  const { state } = ctx;
  const sim = state.sims[simId];
  if (!sim) return;
  const now = state.time.minute;

  if (bundle.needs) {
    for (const k of Object.keys(bundle.needs) as NeedId[]) {
      const d = bundle.needs[k];
      if (isFiniteNumber(d)) sim.needs[k] = clamp100(sim.needs[k] + d);
    }
  }
  if (bundle.money && bundle.money.amount !== 0) {
    const res = transact(sim, bundle.money.amount, bundle.money.memo, now, { account: bundle.money.account, category: bundle.money.category, counterparty: bundle.money.counterparty, rng: ctx.rng });
    if (res.ok) {
      ctx.emit({ type: 'money:transaction', simId, amount: bundle.money.amount, memo: bundle.money.memo, accountId: res.accountId!, category: bundle.money.category ?? 'misc' });
      if (bundle.money.amount > 0) state.stats.moneyEarned = round2(state.stats.moneyEarned + bundle.money.amount);
      else state.stats.moneySpent = round2(state.stats.moneySpent - bundle.money.amount);
    } else {
      ctx.emit({ type: 'money:insufficient', simId, amount: -bundle.money.amount, memo: bundle.money.memo });
    }
  }
  if (bundle.skills) {
    for (const [skillId, xp] of Object.entries(bundle.skills)) {
      if (!isFiniteNumber(xp) || xp <= 0) continue;
      addSkillXp(ctx, sim, skillId, xp);
    }
  }
  if (bundle.moodlets) for (const m of bundle.moodlets) addMoodlet(sim, { ...m, source: m.source ?? source }, now, ctx.rng);
  if (isFiniteNumber(bundle.stress)) sim.mind.stress = clamp100(sim.mind.stress + bundle.stress);
  if (isFiniteNumber(bundle.health)) sim.body.health = clamp100(sim.body.health + bundle.health);
  if (isFiniteNumber(bundle.fitness)) sim.body.fitness = clamp100(sim.body.fitness + bundle.fitness);
  if (isFiniteNumber(bundle.weight)) sim.body.weight = round2(Math.max(30, sim.body.weight + bundle.weight));
  if (isFiniteNumber(bundle.bloodAlcohol)) sim.body.bloodAlcohol = round2(Math.max(0, sim.body.bloodAlcohol + bundle.bloodAlcohol) * 1000) / 1000;
  if (isFiniteNumber(bundle.caffeine)) sim.body.caffeine = Math.max(0, sim.body.caffeine + bundle.caffeine);
  if (isFiniteNumber(bundle.cannabis)) sim.body.cannabis = clamp100(sim.body.cannabis + bundle.cannabis);

  if (bundle.relationships) {
    for (const r of bundle.relationships) {
      const other = state.sims[r.simId];
      if (!other) continue;
      applyRelationshipDelta(ctx, sim, other, r, now);
      if (r.mutual) applyRelationshipDelta(ctx, other, sim, { ...r, simId: sim.id }, now);
    }
  }
  if (bundle.revealFacts) {
    for (const rf of bundle.revealFacts) {
      const target = state.sims[rf.simId];
      if (!target) continue;
      for (const fid of rf.factIds) {
        const f = target.bio.facts.find((x) => x.id === fid);
        if (f && !f.revealedTo.includes(rf.to)) {
          f.revealedTo.push(rf.to);
          f.revealedAt = { ...(f.revealedAt ?? {}), [rf.to]: now };
          ctx.emit({ type: 'bio:revealed', simId: target.id, factId: fid, to: rf.to });
        }
      }
    }
  }
  if (bundle.memories) {
    for (const m of bundle.memories) {
      sim.memory.push({ id: shortId(ctx.rng, 'mem'), kind: m.kind, at: now, text: m.text, participants: m.participants ?? [], venueId: sim.location.venueId, salience: m.salience ?? 40, valence: m.valence ?? 0, tags: m.tags ?? [] });
    }
    if (sim.memory.length > 200) {
      sim.memory.sort((a, b) => b.salience - a.salience || b.at - a.at);
      sim.memory = sim.memory.slice(0, 200);
    }
  }
  if (bundle.items) {
    for (const it of bundle.items) {
      const cur = sim.inventory.consumables[it.itemId] ?? 0;
      const next = it.op === 'gain' ? cur + it.qty : Math.max(0, cur - it.qty);
      if (next === 0) delete sim.inventory.consumables[it.itemId];
      else sim.inventory.consumables[it.itemId] = next;
    }
  }
  if (bundle.objects) {
    for (const o of bundle.objects) {
      const obj = state.objects[o.objectId];
      if (!obj) continue;
      Object.assign(obj.state, o.patch);
      if (isFiniteNumber(obj.state.condition)) obj.state.condition = clamp100(obj.state.condition);
      if (isFiniteNumber(obj.state.dirty)) obj.state.dirty = clamp100(obj.state.dirty);
      ctx.emit({ type: 'object:state', objectId: o.objectId, patch: o.patch as Record<string, unknown> });
      if (o.patch.broken) ctx.emit({ type: 'property:broken', objectId: o.objectId, venueId: obj.venueId });
    }
  }
  if (bundle.legal) {
    for (const l of bundle.legal) {
      ctx.emit({ type: 'custom', kind: 'legal:effect', simId, payload: l as unknown as Record<string, unknown> });
      if (l.kind === 'heat' && isFiniteNumber(l.delta)) sim.legal.heat = clamp100(sim.legal.heat + l.delta);
    }
  }
  if (bundle.schedule) for (const s of bundle.schedule) ctx.scheduleSpec({ ...s, simId: s.simId ?? simId });
  if (bundle.pet) {
    for (const p of bundle.pet) {
      const pet = state.pets[p.petId];
      if (!pet) continue;
      if (p.needs) for (const [k, v] of Object.entries(p.needs)) if (isFiniteNumber(v)) pet.needs[k as keyof typeof pet.needs] = clamp100((pet.needs[k as keyof typeof pet.needs] ?? 50) + v);
      if (isFiniteNumber(p.bond)) pet.bonds[simId] = clamp100((pet.bonds[simId] ?? 0) + p.bond);
      if (isFiniteNumber(p.training)) pet.training = clamp100(pet.training + p.training);
    }
  }
  if (bundle.venue) {
    for (const v of bundle.venue) {
      const ven = state.venues[v.venueId];
      if (!ven) continue;
      if (isFiniteNumber(v.cleanliness)) ven.cleanliness = clamp100(ven.cleanliness + v.cleanliness);
      if (isFiniteNumber(v.noise)) ven.noise = clamp100(ven.noise + v.noise);
      if (isFiniteNumber(v.safety)) ven.safety = clamp100(ven.safety + v.safety);
    }
  }
  if (bundle.flags) Object.assign(sim.flags, bundle.flags);
  if (bundle.moveTo && state.venues[bundle.moveTo.venueId]) {
    const from = sim.location.venueId;
    sim.location = { venueId: bundle.moveTo.venueId, roomId: bundle.moveTo.roomId, arrivedAt: now };
    sim.travel = undefined;
    ctx.emit({ type: 'sim:moved', simId, from, to: bundle.moveTo.venueId });
    ctx.emit({ type: 'sim:arrived', simId, venueId: bundle.moveTo.venueId });
  }
  if (bundle.interrupt) {
    for (const s of bundle.interrupt) {
      const t = state.sims[s];
      if (t?.currentAction) {
        ctx.emit({ type: 'action:interrupted', simId: s, actionId: t.currentAction.actionId, reason: source });
        t.currentAction = undefined;
      }
    }
  }
  if (bundle.custom) for (const c of bundle.custom) ctx.emit({ type: 'custom', kind: c.kind, simId, payload: c.payload });
  ctx.emit({ type: 'effects:applied', simId, bundle, source });
}

export function applyRelationshipDelta(ctx: EffectContext, sim: Sim, other: Sim, r: NonNullable<EffectBundle['relationships']>[number], now: number): void {
  const rel = ensureRelationship(sim, other.id, now);
  const before = { friendship: rel.friendship, romance: rel.romance, trust: rel.trust, familiarity: rel.familiarity };
  const socialMult = traitSocialMult(ctx.content, sim);
  if (isFiniteNumber(r.friendship)) rel.friendship = clamp(rel.friendship + r.friendship * (r.friendship > 0 ? socialMult : 1), -100, 100);
  if (isFiniteNumber(r.romance)) rel.romance = clamp(rel.romance + r.romance, -100, 100);
  if (isFiniteNumber(r.trust)) rel.trust = clamp(rel.trust + r.trust, -100, 100);
  if (isFiniteNumber(r.familiarity)) rel.familiarity = clamp(rel.familiarity + r.familiarity, 0, 100);
  if (isFiniteNumber(r.attraction)) rel.attraction = clamp(rel.attraction + r.attraction, 0, 100);
  rel.lastInteractedAt = now;
  rel.interactionsCount += 1;
  if (r.flags) {
    for (const f of r.flags) {
      const has = rel.flags.includes(f.flag as RelationshipFlag);
      if (f.op === 'add' && !has) rel.flags.push(f.flag as RelationshipFlag);
      if (f.op === 'remove' && has) rel.flags = rel.flags.filter((x) => x !== f.flag);
      ctx.emit({ type: 'relationship:flag', simId: sim.id, otherId: other.id, flag: f.flag, op: f.op });
    }
  }
  for (const axis of ['friendship', 'romance', 'trust', 'familiarity'] as const) {
    const d = rel[axis] - before[axis];
    if (Math.abs(d) >= 0.5) ctx.emit({ type: 'relationship:changed', simId: sim.id, otherId: other.id, axis, value: rel[axis], delta: d });
  }
  // auto flags for friendship thresholds
  syncRelationshipTierFlags(ctx, sim, other, rel);
}

export function syncRelationshipTierFlags(ctx: EffectContext, sim: Sim, other: Sim, rel: Relationship): void {
  const tiers: [RelationshipFlag, number][] = [
    ['best_friend', 85],
    ['good_friend', 60],
    ['friend', 30],
    ['acquaintance', 5],
  ];
  const familyish = rel.flags.some((f) => ['parent', 'child', 'sibling', 'grandparent', 'grandchild', 'married', 'partner', 'engaged'].includes(f));
  if (familyish) return;
  let target: RelationshipFlag | undefined;
  if (rel.friendship <= -40) target = 'enemy';
  else for (const [flag, min] of tiers) if (rel.friendship >= min && rel.familiarity >= min / 2) { target = flag; break; }
  const tierFlags: RelationshipFlag[] = ['enemy', 'best_friend', 'good_friend', 'friend', 'acquaintance'];
  const current = rel.flags.find((f) => tierFlags.includes(f));
  if (target !== current) {
    rel.flags = rel.flags.filter((f) => !tierFlags.includes(f));
    if (target) {
      rel.flags.push(target);
      if (target !== 'acquaintance') ctx.emit({ type: 'relationship:milestone', simId: sim.id, otherId: other.id, milestone: target });
    }
  }
}

export function traitSocialMult(content: ContentCatalog, sim: Sim): number {
  let m = 1;
  for (const t of sim.personality.traits) {
    const def = content.traits[t];
    if (def?.socialMult) m *= def.socialMult;
  }
  return m;
}

export function addSkillXp(ctx: EffectContext, sim: Sim, skillId: string, xp: number): void {
  const def = ctx.content.skills[skillId];
  if (!def) return;
  let mult = 1;
  for (const t of sim.personality.traits) {
    const td = ctx.content.traits[t];
    if (td?.skillMult?.[skillId]) mult *= td.skillMult[skillId]!;
  }
  const st = (sim.skills[skillId] ||= { level: 0, xp: 0 });
  st.xp += xp * mult;
  while (st.level < 10) {
    const needed = def.xpCurve[st.level] ?? Number.POSITIVE_INFINITY;
    if (st.xp < needed) break;
    st.xp -= needed;
    st.level += 1;
    ctx.emit({ type: 'sim:skill_up', simId: sim.id, skillId, level: st.level });
    ctx.log(`${sim.identity.firstName} reached ${def.name} level ${st.level}.`, 'system', sim.id, 2);
  }
  if (st.level >= 10) st.xp = Math.min(st.xp, def.xpCurve[9] ?? 0);
}

export function revealableFacts(target: Sim, viewer: SimId): BioFact[] {
  return target.bio.facts.filter((f) => f.revealedTo.includes(viewer));
}

/** Merge two bundles (b on top of a), summing numeric fields. */
export function mergeEffects(a: EffectBundle, b: EffectBundle): EffectBundle {
  const out: EffectBundle = { ...a };
  const sumRec = <K extends string>(x?: Partial<Record<K, number>>, y?: Partial<Record<K, number>>) => {
    if (!x && !y) return undefined;
    const r: Partial<Record<K, number>> = { ...(x ?? {}) };
    for (const [k, v] of Object.entries(y ?? {}) as [K, number][]) r[k] = (r[k] ?? 0) + v;
    return r;
  };
  out.needs = sumRec(a.needs, b.needs);
  out.perMinute = sumRec(a.perMinute, b.perMinute);
  out.skills = sumRec(a.skills, b.skills);
  if (a.money && b.money) out.money = { ...b.money, amount: round2(a.money.amount + b.money.amount) };
  else out.money = b.money ?? a.money;
  for (const k of ['stress', 'health', 'fitness', 'weight', 'bloodAlcohol', 'caffeine', 'cannabis', 'timeElapsedMinutes'] as const) {
    const av = a[k];
    const bv = b[k];
    if (av !== undefined || bv !== undefined) out[k] = (av ?? 0) + (bv ?? 0);
  }
  for (const k of ['moodlets', 'relationships', 'revealFacts', 'memories', 'items', 'objects', 'legal', 'schedule', 'pet', 'venue', 'interrupt', 'custom'] as const) {
    const av = a[k] as unknown[] | undefined;
    const bv = b[k] as unknown[] | undefined;
    if (av || bv) (out as Record<string, unknown>)[k] = [...(av ?? []), ...(bv ?? [])];
  }
  out.moveTo = b.moveTo ?? a.moveTo;
  out.flags = a.flags || b.flags ? { ...(a.flags ?? {}), ...(b.flags ?? {}) } : undefined;
  return out;
}
