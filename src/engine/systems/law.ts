/**
 * Law system: crime → detection → citation or arrest → booking → bail → court → sentence,
 * plus driver licensing at the DMV, tickets and fines, warrants, probation, and civil suits.
 *
 * Events emitted:  legal:police_called, legal:arrested, legal:released, legal:ticket,
 *                  legal:court_date, legal:verdict, legal:license, legal:lawsuit, life:event
 * Events consumed: legal:crime_committed, custom (legal:*), scheduled:fired (court_date,
 *                  release, probation_end, _warrant_check), time:day, transport:pulled_over
 * Action ids:      legal:*  (crimes, DMV, court, bail, lawyer, reports)
 *
 * Sim flags: `legal:bailSet`, `legal:lastCourtAt`, `legal:pdAssigned`, `legal:heatDay`.
 */
import type { ActionDef, Charge, CrimeId, Sim, SimId, Venue, VenueArchetype } from '../core/types';
import type { ActionResult, System, SystemContext } from '../core/systems';
import { shortId } from '../core/ids';
import { clamp, clamp100, DAY, formatMoney, round2 } from '../core/util';
import { transact } from '../core/effects';

export const BOOKING_HOURS = 14;
export const COURT_LEAD_DAYS = 24;
export const PUBLIC_DEFENDER_SKILL = 3;
export const PRIVATE_LAWYER_FEE = 2500;
export const LAWYER_CONSULT_FEE = 285;
/** points on a license before suspension */
export const LICENSE_POINT_LIMIT = 6;

const severityRank = { infraction: 0, misdemeanor: 1, felony: 2 } as const;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function nearest(ctx: SystemContext, sim: Sim, archetype: VenueArchetype): Venue | undefined {
  return ctx.query.nearestVenue(sim.location.venueId, archetype);
}

function crimeDef(ctx: SystemContext, crimeId: CrimeId) {
  return ctx.content.crimes[crimeId];
}

/** Chance a crime is noticed, from the crime's baseline, the venue, witnesses and prior heat. */
export function detectionChance(ctx: SystemContext, sim: Sim, crimeId: CrimeId, witnessed: boolean): number {
  const def = crimeDef(ctx, crimeId);
  if (!def) return 0.3;
  const venue = ctx.query.venueMaybe(sim.location.venueId);
  let p = def.detection;
  if (witnessed) p *= 2.5;
  if (venue) {
    p *= 0.6 + venue.safety / 125;
    const objs = ctx.query.objectsAt(venue.id);
    if (objs.some((o) => o.defId === 'security_camera' || o.defId === 'door_lock')) p *= 1.35;
    const others = ctx.query.simsAt(venue.id).filter((s) => s.id !== sim.id);
    p *= 1 + Math.min(0.8, others.length * 0.06);
    if (venue.staffSimIds.length) p *= 1.2;
  }
  p *= 1 + sim.legal.heat / 140;
  // skilled criminals are harder to catch
  const skill = sim.skills[def.skillId ?? 'logic']?.level ?? 0;
  p *= 1 - Math.min(0.45, skill * 0.05);
  p *= 1 - (sim.personality.riskTolerance - 0.5) * 0.1;
  if (sim.body.bloodAlcohol > 0.05 || sim.body.cannabis > 40) p *= 1.3;
  return clamp(p, 0.01, 0.97);
}

function makeCharge(ctx: SystemContext, sim: Sim, crimeId: CrimeId): Charge {
  const def = crimeDef(ctx, crimeId);
  return {
    id: shortId(ctx.rng, 'chg'),
    crimeId,
    label: def?.label ?? crimeId.replace(/_/g, ' '),
    severity: def?.severity ?? 'misdemeanor',
    at: ctx.state.time.minute,
    status: 'pending',
    arrestingVenueId: sim.location.venueId,
  };
}

function issueTicket(ctx: SystemContext, sim: Sim, crimeId: CrimeId): void {
  const def = crimeDef(ctx, crimeId);
  if (!def) return;
  const amount = round2(ctx.rng.range(def.fineRange[0], def.fineRange[1]));
  const id = shortId(ctx.rng, 'tkt');
  sim.legal.tickets.push({ id, kind: def.label, amount, issuedAt: ctx.state.time.minute, dueAt: ctx.state.time.minute + 30 * DAY, paid: false, contested: false });
  if (def.licensePoints) sim.legal.license.points += def.licensePoints;
  ctx.emit({ type: 'legal:ticket', simId: sim.id, kind: def.label, amount });
  ctx.log({ text: `${ctx.query.isControlled(sim.id) ? 'You were' : `${sim.identity.firstName} was`} cited for ${def.label.toLowerCase()} — ${formatMoney(amount)}, due in 30 days.`, kind: 'alert', simId: sim.id, importance: 2 });
  ctx.applyEffects(sim.id, { stress: 12, moodlets: [{ emotion: 'angry', label: 'Got a ticket', intensity: -8, durationMinutes: 480 }] }, 'law:ticket');
  if (sim.legal.license.points >= LICENSE_POINT_LIMIT && sim.legal.license.status === 'valid') suspendLicense(ctx, sim, 'too many points');
}

function suspendLicense(ctx: SystemContext, sim: Sim, reason: string): void {
  sim.legal.license.status = 'suspended';
  ctx.emit({ type: 'legal:license', simId: sim.id, status: 'suspended' });
  ctx.log({ text: `${ctx.query.isControlled(sim.id) ? 'Your' : `${sim.identity.firstName}'s`} license is suspended — ${reason}.`, kind: 'alert', simId: sim.id, importance: 3 });
  ctx.applyEffects(sim.id, { stress: 20, moodlets: [{ emotion: 'stressed', label: 'License suspended', intensity: -14, durationMinutes: DAY * 3 }] }, 'law:license');
}

function bailFor(severity: Charge['severity'], rng: SystemContext['rng']): number {
  if (severity === 'infraction') return 0;
  if (severity === 'misdemeanor') return round2(rng.range(300, 1500));
  return round2(rng.range(2500, 25000));
}

function bookInto(ctx: SystemContext, sim: Sim, charge: Charge): void {
  const jail = nearest(ctx, sim, 'jail') ?? nearest(ctx, sim, 'police');
  const now = ctx.state.time.minute;
  if (jail) {
    const from = sim.location.venueId;
    sim.location = { venueId: jail.id, arrivedAt: now };
    sim.travel = undefined;
    sim.currentAction = undefined;
    jail.discovered = true;
    ctx.emit({ type: 'sim:moved', simId: sim.id, from, to: jail.id });
  }
  const holdMinutes = Math.round(BOOKING_HOURS * 60 * (charge.severity === 'felony' ? 2 : 1));
  sim.legal.incarceratedUntil = now + holdMinutes;
  sim.flags['legal:bailSet'] = bailFor(charge.severity, ctx.rng);
  ctx.schedule({ inMinutes: holdMinutes, kind: 'release', label: 'Released from custody', simId: sim.id });
  charge.courtDateAt = now + COURT_LEAD_DAYS * DAY;
  ctx.schedule({ atMinute: charge.courtDateAt, kind: 'court_date', label: `Court: ${charge.label}`, simId: sim.id, payload: { chargeId: charge.id } });
  ctx.emit({ type: 'legal:court_date', simId: sim.id, chargeId: charge.id });
  ctx.state.stats.arrests += 1;
}

export function arrest(ctx: SystemContext, sim: Sim, crimeId: CrimeId, opts: { resisted?: boolean } = {}): Charge {
  const charge = makeCharge(ctx, sim, crimeId);
  sim.legal.charges.push(charge);
  sim.legal.heat = clamp100(sim.legal.heat + (charge.severity === 'felony' ? 35 : charge.severity === 'misdemeanor' ? 18 : 6));
  bookInto(ctx, sim, charge);
  ctx.emit({ type: 'legal:arrested', simId: sim.id, charge });
  ctx.applyEffects(sim.id, {
    stress: 35,
    moodlets: [{ emotion: 'scared', label: 'Arrested', intensity: -22, durationMinutes: DAY * 2 }],
    memories: [{ kind: 'event', text: `I was arrested for ${charge.label.toLowerCase()}.`, salience: 95, valence: -0.9, tags: ['arrest', 'legal'] }],
  }, 'law:arrest');
  const who = ctx.query.isControlled(sim.id) ? 'You are' : `${sim.identity.firstName} is`;
  ctx.log({ text: `${who} under arrest for ${charge.label.toLowerCase()}${opts.resisted ? ' after trying to run' : ''}. Booking takes a few hours.`, kind: 'alert', simId: sim.id, importance: 3 });
  ctx.emit({ type: 'life:event', simId: sim.id, kind: 'arrested', label: charge.label });
  if (ctx.query.isControlled(sim.id)) {
    ctx.interrupt({
      kind: 'police',
      title: 'You are being arrested',
      body: `Charge: ${charge.label}. You will be held for booking. Bail is set at ${formatMoney(Number(sim.flags['legal:bailSet'] ?? 0))}.`,
      simId: sim.id,
      options: [
        { label: 'Say nothing', actionId: 'legal:comply' },
        { label: 'Ask for a lawyer', actionId: 'legal:request_counsel' },
      ],
    });
  }
  // employer notice after enough missed shifts
  if (sim.career.job) ctx.emit({ type: 'custom', kind: 'career:incarcerated', simId: sim.id, payload: { minutes: sim.legal.incarceratedUntil! - ctx.state.time.minute } });
  return charge;
}

function releaseFrom(ctx: SystemContext, sim: Sim): void {
  sim.legal.incarceratedUntil = undefined;
  delete sim.flags['legal:bailSet'];
  ctx.emit({ type: 'legal:released', simId: sim.id });
  const home = ctx.query.homeOf(sim.id);
  if (home) {
    const from = sim.location.venueId;
    sim.location = { venueId: home.id, arrivedAt: ctx.state.time.minute };
    ctx.emit({ type: 'sim:moved', simId: sim.id, from, to: home.id });
  }
  ctx.log({ text: `${ctx.query.isControlled(sim.id) ? 'You are' : `${sim.identity.firstName} is`} released.`, kind: 'alert', simId: sim.id, importance: 2 });
  ctx.applyEffects(sim.id, { moodlets: [{ emotion: 'relaxed', label: 'Out of custody', intensity: 6, durationMinutes: 720 }], needs: { hygiene: -25, energy: -20, comfort: -25 } }, 'law:release');
}

/** Resolve a court date. Returns the verdict label. */
export function holdCourt(ctx: SystemContext, sim: Sim, charge: Charge): string {
  const def = crimeDef(ctx, charge.crimeId);
  const hasLawyer = !!sim.legal.lawyerSimId || sim.flags['legal:retained'] === true;
  const lawSkill = sim.skills.law?.level ?? 0;
  const defence = (hasLawyer ? 6 : PUBLIC_DEFENDER_SKILL) + lawSkill * 0.6 + sim.personality.honesty * 2 + (sim.reputation > 20 ? 1 : 0);
  const priors = sim.legal.charges.filter((c) => c.status === 'convicted' || c.status === 'plea').length;
  const strength = severityRank[charge.severity] * 3 + 5 + priors;
  const roll = ctx.rng.range(0, defence + strength);
  const now = ctx.state.time.minute;

  let verdict: string;
  if (roll < defence * 0.55) {
    charge.status = 'dismissed';
    verdict = 'dismissed';
  } else if (roll < defence) {
    charge.status = 'acquitted';
    verdict = 'not guilty';
  } else if (roll < defence + strength * 0.55) {
    charge.status = 'plea';
    verdict = 'plea deal';
  } else {
    charge.status = 'convicted';
    verdict = 'guilty';
  }

  if (charge.status === 'convicted' || charge.status === 'plea') {
    const lenient = charge.status === 'plea' ? 0.5 : 1;
    const fine = round2(ctx.rng.range(def?.fineRange[0] ?? 100, def?.fineRange[1] ?? 800) * lenient);
    charge.fine = fine;
    const jailDays = Math.round(ctx.rng.range(def?.jailDaysRange[0] ?? 0, def?.jailDaysRange[1] ?? 0) * lenient);
    charge.jailDays = jailDays;
    charge.probationDays = Math.round((def?.probationDays ?? 0) * lenient);
    const paid = transact(sim, -fine, `Court fine — ${charge.label}`, now, { category: 'legal', rng: ctx.rng });
    if (!paid.ok) {
      sim.finance.bills.push({ id: shortId(ctx.rng, 'bill'), name: `Court fine — ${charge.label}`, amount: fine, dueDayOfMonth: 15, category: 'other', autopay: false, missed: 0 });
    }
    if (charge.probationDays) {
      sim.legal.probationUntil = now + charge.probationDays * DAY;
      ctx.schedule({ atMinute: sim.legal.probationUntil, kind: 'probation_end', label: 'Probation ends', simId: sim.id });
    }
    if (jailDays > 0) {
      const jail = nearest(ctx, sim, 'jail');
      if (jail) {
        sim.location = { venueId: jail.id, arrivedAt: now };
        jail.discovered = true;
      }
      sim.legal.incarceratedUntil = now + jailDays * DAY;
      ctx.schedule({ inMinutes: jailDays * DAY, kind: 'release', label: 'Released from jail', simId: sim.id });
      if (sim.career.job) ctx.emit({ type: 'custom', kind: 'career:incarcerated', simId: sim.id, payload: { minutes: jailDays * DAY } });
    }
    if (def?.licensePoints) {
      sim.legal.license.points += def.licensePoints;
      if (charge.crimeId === 'dui' || sim.legal.license.points >= LICENSE_POINT_LIMIT) suspendLicense(ctx, sim, charge.crimeId === 'dui' ? 'DUI conviction' : 'too many points');
    }
    sim.reputation = clamp(sim.reputation - (charge.severity === 'felony' ? 25 : 10), -100, 100);
  } else {
    sim.legal.heat = clamp100(sim.legal.heat - 10);
  }

  sim.legal.warrants = sim.legal.warrants.filter((w) => w.chargeId !== charge.id);
  ctx.emit({ type: 'legal:verdict', simId: sim.id, chargeId: charge.id, verdict });
  const good = charge.status === 'dismissed' || charge.status === 'acquitted';
  ctx.log({
    text: `${ctx.query.isControlled(sim.id) ? 'Your' : `${sim.identity.firstName}'s`} case — ${charge.label} — came back ${verdict}${charge.fine ? `. Fine: ${formatMoney(charge.fine)}` : ''}${charge.jailDays ? `, ${charge.jailDays} days in jail` : ''}.`,
    kind: 'alert', simId: sim.id, importance: 3,
  });
  ctx.applyEffects(sim.id, {
    stress: good ? -20 : 25,
    moodlets: [good ? { emotion: 'relaxed', label: 'Case dismissed', intensity: 14, durationMinutes: DAY * 2 } : { emotion: 'sad', label: 'Convicted', intensity: -18, durationMinutes: DAY * 4 }],
    memories: [{ kind: 'milestone', text: `The court found ${verdict} on my ${charge.label.toLowerCase()} charge.`, salience: 90, valence: good ? 0.5 : -0.8, tags: ['legal'] }],
  }, 'law:verdict');
  return verdict;
}

function issueWarrant(ctx: SystemContext, sim: Sim, charge: Charge): void {
  if (sim.legal.warrants.some((w) => w.chargeId === charge.id)) return;
  sim.legal.warrants.push({ chargeId: charge.id, issuedAt: ctx.state.time.minute });
  sim.legal.heat = clamp100(sim.legal.heat + 25);
  ctx.log({ text: `A bench warrant was issued for ${ctx.query.isControlled(sim.id) ? 'you' : sim.identity.firstName} — failure to appear on ${charge.label.toLowerCase()}.`, kind: 'alert', simId: sim.id, importance: 3 });
  if (ctx.query.isControlled(sim.id)) {
    ctx.interrupt({ kind: 'police', title: 'Bench warrant issued', body: `You missed court on ${charge.label}. There is now a warrant out for you. Turning yourself in at the courthouse looks better than being picked up.`, simId: sim.id, options: [{ label: 'Understood', actionId: 'legal:ack' }] });
  }
}

// ---------------------------------------------------------------------------
// crime opportunities offered to the player
// ---------------------------------------------------------------------------
interface CrimeOpportunity {
  crimeId: CrimeId;
  label: string;
  icon: string;
  minutes: number;
  archetypes?: VenueArchetype[];
  needsOthers?: boolean;
  closedOnly?: boolean;
  gain?: [number, number];
  description: string;
}

const OPPORTUNITIES: CrimeOpportunity[] = [
  { crimeId: 'shoplifting', label: 'Slip something into your bag', icon: '🛍️', minutes: 10, archetypes: ['grocery', 'convenience', 'retail', 'clothing', 'electronics', 'pharmacy', 'bookstore', 'thrift_store', 'mall', 'gas_station', 'liquor_store'], gain: [8, 120], description: 'Take something without paying. Cameras and staff make it riskier.' },
  { crimeId: 'pickpocket', label: 'Pick a pocket', icon: '👛', minutes: 6, needsOthers: true, gain: [15, 220], description: 'Lift a wallet in a crowd. Very risky if anyone notices.' },
  { crimeId: 'petty_theft', label: 'Take something that isn\'t yours', icon: '🎒', minutes: 8, gain: [10, 150], description: 'An unattended bag, a phone on a table.' },
  { crimeId: 'vandalism', label: 'Tag the wall', icon: '🎨', minutes: 20, archetypes: ['park', 'trail', 'transit_stop', 'parking', 'warehouse', 'storage'], description: 'Spray paint where you shouldn\'t.' },
  { crimeId: 'trespassing', label: 'Slip in after hours', icon: '🚪', minutes: 25, closedOnly: true, description: 'Go somewhere that is closed to you.' },
  { crimeId: 'fare_evasion', label: 'Skip the fare', icon: '🚇', minutes: 3, archetypes: ['transit_stop', 'bus_station', 'train_station'], gain: [2.5, 2.5], description: 'Ride without paying.' },
  { crimeId: 'drug_dealing', label: 'Move some product', icon: '💊', minutes: 45, gain: [80, 600], description: 'Sell what you\'re carrying. Serious charge if caught.' },
  { crimeId: 'burglary', label: 'Break into somewhere', icon: '🔦', minutes: 60, closedOnly: true, gain: [200, 2500], description: 'Enter and take. A felony.' },
];

function crimeActions(ctx: SystemContext, sim: Sim): ActionDef[] {
  if (sim.lifeStage === 'infant' || sim.lifeStage === 'toddler' || sim.lifeStage === 'child') return [];
  if (sim.legal.incarceratedUntil && sim.legal.incarceratedUntil > ctx.state.time.minute) return [];
  const venue = ctx.query.venueMaybe(sim.location.venueId);
  if (!venue || venue.archetype === 'home' || venue.archetype === 'police' || venue.archetype === 'courthouse' || venue.archetype === 'jail') return [];
  const open = ctx.query.isVenueOpen(venue.id);
  const others = ctx.query.simsAt(venue.id).filter((s) => s.id !== sim.id).length;
  const out: ActionDef[] = [];
  for (const o of OPPORTUNITIES) {
    if (o.archetypes && !o.archetypes.includes(venue.archetype)) continue;
    if (o.needsOthers && others < 2) continue;
    if (o.closedOnly && open) continue;
    if (!o.closedOnly && !open) continue;
    if (o.crimeId === 'drug_dealing' && !(sim.inventory.consumables.cannabis_flower || sim.career.job?.careerId === 'drug_dealer')) continue;
    out.push({
      id: `legal:crime:${o.crimeId}`,
      label: o.label,
      description: o.description,
      category: 'legal',
      icon: o.icon,
      durationMinutes: o.minutes,
      effects: {},
      llm: 'adjudicate',
      interruptible: false,
      group: 'Risky',
      autonomyWeight: sim.personality.traits.includes('kleptomaniac') ? 0.4 : 0.02,
      params: { crimeId: o.crimeId, gain: o.gain },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// the system
// ---------------------------------------------------------------------------
export const lawSystem: System = {
  id: 'law',
  intervalMinutes: 15,

  onTick(ctx, dt) {
    const now = ctx.state.time.minute;
    for (const sim of ctx.query.simulatedSims()) {
      // heat cools about a point a day
      const last = Number(sim.flags['legal:heatDay'] ?? 0);
      if (now - last >= DAY) {
        sim.flags['legal:heatDay'] = now;
        if (sim.legal.heat > 0) sim.legal.heat = clamp100(sim.legal.heat - 1);
        // unpaid tickets become warrants / go to collections
        for (const t of sim.legal.tickets) {
          if (!t.paid && !t.contested && now > t.dueAt) {
            t.amount = round2(t.amount * 1.5);
            t.dueAt = now + 30 * DAY;
            sim.legal.license.points += 1;
            ctx.log({ text: `${ctx.query.isControlled(sim.id) ? 'Your' : `${sim.identity.firstName}'s`} unpaid ${t.kind.toLowerCase()} ticket went to collections — now ${formatMoney(t.amount)}.`, kind: 'alert', simId: sim.id, importance: 2 });
          }
        }
      }
      // a warrant plus police contact means pickup
      if (sim.legal.warrants.length && !sim.legal.incarceratedUntil) {
        const venue = ctx.query.venueMaybe(sim.location.venueId);
        const risky = venue && (venue.archetype === 'police' || venue.archetype === 'courthouse' || venue.archetype === 'dmv');
        if (risky || ctx.rng.chance(0.004 * (dt / 15))) {
          const w = sim.legal.warrants[0];
          const charge = sim.legal.charges.find((c) => c.id === w.chargeId);
          if (charge) {
            sim.legal.warrants.shift();
            bookInto(ctx, sim, charge);
            ctx.emit({ type: 'legal:arrested', simId: sim.id, charge });
            ctx.log({ text: `${ctx.query.isControlled(sim.id) ? 'You were' : `${sim.identity.firstName} was`} picked up on the outstanding warrant.`, kind: 'alert', simId: sim.id, importance: 3 });
          }
        }
      }
    }
  },

  onEvent(ctx, e) {
    if (e.type === 'legal:crime_committed') {
      const sim = ctx.query.simMaybe(e.simId);
      if (!sim) return;
      const def = crimeDef(ctx, e.crimeId);
      if (!def) return;
      sim.legal.heat = clamp100(sim.legal.heat + (def.severity === 'felony' ? 10 : 4));
      if (!ctx.rng.chance(detectionChance(ctx, sim, e.crimeId, e.witnessed))) return;
      if (def.severity === 'infraction') {
        issueTicket(ctx, sim, e.crimeId);
        return;
      }
      ctx.emit({ type: 'legal:police_called', venueId: e.venueId ?? sim.location.venueId, reason: def.label, simId: sim.id });
      arrest(ctx, sim, e.crimeId);
      return;
    }

    if (e.type === 'transport:pulled_over') {
      const sim = ctx.query.simMaybe(e.simId);
      if (!sim) return;
      ctx.log({ text: `${ctx.query.isControlled(sim.id) ? 'You get' : `${sim.identity.firstName} gets`} pulled over — ${e.reason}.`, kind: 'alert', simId: sim.id, importance: 2 });
      if (sim.body.bloodAlcohol >= 0.08) ctx.emit({ type: 'legal:crime_committed', simId: sim.id, crimeId: 'dui', venueId: sim.location.venueId, witnessed: true });
      else if (sim.legal.license.status !== 'valid') ctx.emit({ type: 'legal:crime_committed', simId: sim.id, crimeId: 'driving_without_license', venueId: sim.location.venueId, witnessed: true });
      else issueTicket(ctx, sim, 'speeding');
      return;
    }

    if (e.type === 'scheduled:fired') {
      const ev = e.event;
      const sim = ev.simId ? ctx.query.simMaybe(ev.simId) : undefined;
      if (!sim) return;
      if (ev.kind === 'release') {
        if (sim.legal.incarceratedUntil && sim.legal.incarceratedUntil <= ctx.state.time.minute) releaseFrom(ctx, sim);
        return;
      }
      if (ev.kind === 'probation_end') {
        sim.legal.probationUntil = undefined;
        ctx.log({ text: `${ctx.query.isControlled(sim.id) ? 'Your' : `${sim.identity.firstName}'s`} probation is over.`, kind: 'system', simId: sim.id, importance: 2 });
        return;
      }
      if (ev.kind === 'court_date') {
        const chargeId = String(ev.payload?.chargeId ?? '');
        const charge = sim.legal.charges.find((c) => c.id === chargeId);
        if (!charge || charge.status !== 'pending') return;
        const atCourt = ctx.query.venueMaybe(sim.location.venueId)?.archetype === 'courthouse';
        if (ctx.query.isControlled(sim.id) && !atCourt) {
          ctx.interrupt({
            kind: 'event', title: 'Court is today', simId: sim.id,
            body: `Your hearing for ${charge.label} is being called. If you are not at the courthouse, a warrant will issue.`,
            options: [{ label: 'Head to the courthouse', actionId: 'legal:rush_court' }, { label: 'Skip it', actionId: 'legal:skip_court', params: { chargeId } }],
          });
          // grace: give them two hours to arrive
          ctx.schedule({ inMinutes: 120, kind: '_court_grace', label: 'Court grace period', simId: sim.id, payload: { chargeId } });
          return;
        }
        holdCourt(ctx, sim, charge);
        return;
      }
      if (ev.kind === '_court_grace') {
        const chargeId = String(ev.payload?.chargeId ?? '');
        const charge = sim.legal.charges.find((c) => c.id === chargeId);
        if (!charge || charge.status !== 'pending') return;
        if (ctx.query.venueMaybe(sim.location.venueId)?.archetype === 'courthouse') holdCourt(ctx, sim, charge);
        else issueWarrant(ctx, sim, charge);
      }
      return;
    }

    if (e.type === 'custom' && e.simId) {
      const sim = ctx.query.simMaybe(e.simId);
      if (!sim) return;
      const p = e.payload ?? {};
      switch (e.kind) {
        case 'legal:effect': {
          const kind = String(p.kind ?? '');
          if (kind === 'charge' && p.crimeId) ctx.emit({ type: 'legal:crime_committed', simId: sim.id, crimeId: String(p.crimeId), venueId: sim.location.venueId, witnessed: true });
          if (kind === 'ticket' && p.crimeId) issueTicket(ctx, sim, String(p.crimeId));
          if (kind === 'license' && p.licenseStatus) {
            sim.legal.license.status = p.licenseStatus as Sim['legal']['license']['status'];
            ctx.emit({ type: 'legal:license', simId: sim.id, status: String(p.licenseStatus) });
          }
          if (kind === 'release') releaseFrom(ctx, sim);
          break;
        }
        case 'legal:renew_license': {
          sim.legal.license.status = 'valid';
          sim.legal.license.expiresAt = ctx.state.time.minute + 8 * 365 * DAY;
          sim.legal.license.points = Math.max(0, sim.legal.license.points - 2);
          ctx.emit({ type: 'legal:license', simId: sim.id, status: 'valid' });
          ctx.log({ text: 'License renewed. The photo is worse than the old one.', kind: 'system', simId: sim.id, importance: 1 });
          break;
        }
        case 'legal:license_test': {
          const skill = sim.skills.driving?.level ?? 0;
          const pass = ctx.rng.chance(clamp(0.35 + skill * 0.09 + (sim.mind.mood > 0 ? 0.08 : -0.05), 0.1, 0.95));
          if (pass) {
            sim.legal.license.status = 'valid';
            sim.legal.license.expiresAt = ctx.state.time.minute + 8 * 365 * DAY;
            ctx.emit({ type: 'legal:license', simId: sim.id, status: 'valid' });
            ctx.log({ text: `${ctx.query.isControlled(sim.id) ? 'You passed' : `${sim.identity.firstName} passed`} the road test.`, kind: 'system', simId: sim.id, importance: 3 });
            ctx.applyEffects(sim.id, { moodlets: [{ emotion: 'proud', label: 'Passed the road test', intensity: 14, durationMinutes: DAY * 2 }] }, 'law:license');
          } else {
            if (sim.legal.license.status === 'none') sim.legal.license.status = 'permit';
            ctx.log({ text: 'Failed the road test. Parallel parking, again.', kind: 'system', simId: sim.id, importance: 2 });
            ctx.applyEffects(sim.id, { stress: 12, moodlets: [{ emotion: 'embarrassed', label: 'Failed the road test', intensity: -9, durationMinutes: 720 }], skills: { driving: 25 } }, 'law:license');
          }
          break;
        }
        case 'legal:register_vehicle': {
          const hh = ctx.query.householdOf(sim.id);
          for (const vid of hh?.vehicleIds ?? []) {
            const v = ctx.state.vehicles[vid];
            if (v) v.registrationExpiresAt = ctx.state.time.minute + 365 * DAY;
          }
          ctx.log({ text: 'Registration renewed. New sticker for the plate.', kind: 'system', simId: sim.id, importance: 1 });
          break;
        }
        case 'legal:real_id':
          sim.flags['legal:real_id'] = true;
          break;
        case 'legal:consult': {
          if (p.retain) {
            sim.flags['legal:retained'] = true;
            ctx.log({ text: 'You retained a lawyer. Somebody is finally on your side of the table.', kind: 'system', simId: sim.id, importance: 2 });
          }
          ctx.applyEffects(sim.id, { skills: { law: 20 }, stress: -8 }, 'law:consult');
          break;
        }
        case 'legal:pay_fine': {
          const unpaid = sim.legal.tickets.find((t) => !t.paid);
          if (!unpaid) {
            ctx.log({ text: 'Nothing outstanding to pay.', kind: 'system', simId: sim.id, importance: 0 });
            break;
          }
          const res = transact(sim, -unpaid.amount, `Fine — ${unpaid.kind}`, ctx.state.time.minute, { category: 'legal', rng: ctx.rng });
          if (res.ok) {
            unpaid.paid = true;
            ctx.log({ text: `Paid the ${unpaid.kind.toLowerCase()} fine — ${formatMoney(unpaid.amount)}.`, kind: 'money', simId: sim.id, importance: 1 });
            ctx.applyEffects(sim.id, { stress: -8 }, 'law:fine');
          } else {
            ctx.log({ text: `You can't cover the ${formatMoney(unpaid.amount)} fine right now.`, kind: 'alert', simId: sim.id, importance: 2 });
          }
          break;
        }
        case 'legal:report': {
          const kind = String(p.kind ?? 'crime');
          ctx.log({ text: kind === 'crime' ? 'You filed a report. They took the details and gave you a case number.' : 'Report filed. They will call if it turns up.', kind: 'system', simId: sim.id, importance: 1 });
          sim.flags['legal:reportFiled'] = ctx.state.time.minute;
          ctx.applyEffects(sim.id, { stress: -6 }, 'law:report');
          break;
        }
        case 'legal:court': {
          const action = String(p.action ?? 'wait');
          const pending = sim.legal.charges.find((c) => c.status === 'pending');
          if (action === 'hearing' && pending) holdCourt(ctx, sim, pending);
          else if (action === 'continuance' && pending && pending.courtDateAt) {
            pending.courtDateAt += 21 * DAY;
            ctx.schedule({ atMinute: pending.courtDateAt, kind: 'court_date', label: `Court: ${pending.label}`, simId: sim.id, payload: { chargeId: pending.id } });
            ctx.log({ text: 'Continuance granted. Three more weeks of waiting.', kind: 'system', simId: sim.id, importance: 1 });
          }
          break;
        }
        case 'legal:custody': {
          if (String(p.action) === 'call') ctx.applyEffects(sim.id, { stress: -10, needs: { social: 12 } }, 'law:call');
          break;
        }
        case 'legal:bail': {
          const bail = Number(sim.flags['legal:bailSet'] ?? 0);
          if (!bail) break;
          const res = transact(sim, -bail, 'Bail', ctx.state.time.minute, { category: 'legal', rng: ctx.rng });
          if (res.ok) {
            releaseFrom(ctx, sim);
            ctx.log({ text: `Posted ${formatMoney(bail)} bail. You are out until your court date.`, kind: 'money', simId: sim.id, importance: 2 });
          } else {
            ctx.log({ text: `You can't raise ${formatMoney(bail)}. You wait.`, kind: 'alert', simId: sim.id, importance: 2 });
          }
          break;
        }
        case 'legal:file': {
          const form = String(p.form ?? '');
          if (form === 'small_claims') {
            const amount = round2(ctx.rng.range(300, 6000));
            sim.legal.civil.lawsuits.push({ id: shortId(ctx.rng, 'suit'), vs: String(p.vs ?? 'a former landlord'), amount, status: 'filed' });
            ctx.emit({ type: 'legal:lawsuit', simId: sim.id, vs: String(p.vs ?? 'unknown'), amount });
            ctx.schedule({ inMinutes: 45 * DAY, kind: 'court_date', label: 'Small claims hearing', simId: sim.id, payload: { civil: true } });
          }
          if (form === 'voter_registration') sim.flags['civic:registered'] = true;
          if (form === 'passport') sim.flags['legal:passport'] = ctx.state.time.minute + 30 * DAY;
          break;
        }
        default:
          break;
      }
    }
  },

  actions(ctx, simId) {
    const sim = ctx.query.sim(simId);
    const out: ActionDef[] = [...crimeActions(ctx, sim)];
    const venue = ctx.query.venueMaybe(sim.location.venueId);
    const jailed = !!(sim.legal.incarceratedUntil && sim.legal.incarceratedUntil > ctx.state.time.minute);

    if (jailed) {
      const bail = Number(sim.flags['legal:bailSet'] ?? 0);
      if (bail > 0) out.push({ id: 'legal:post_bail', label: `Post bail (${formatMoney(bail)})`, category: 'legal', icon: '💵', durationMinutes: 30, effects: {}, group: 'Custody', interruptible: false });
      out.push({ id: 'legal:wait_out', label: 'Wait for release', category: 'legal', icon: '⏳', durationMinutes: 120, effects: { perMinute: { comfort: -0.1, fun: -0.08 } }, group: 'Custody' });
      return out;
    }

    const unpaid = sim.legal.tickets.filter((t) => !t.paid);
    if (unpaid.length) {
      out.push({ id: 'legal:pay_ticket', label: `Pay a ticket (${formatMoney(unpaid[0].amount)})`, description: unpaid[0].kind, category: 'legal', icon: '🧾', durationMinutes: 10, effects: {}, group: 'Legal', autonomyWeight: 0.4 });
      if (venue?.archetype === 'courthouse') out.push({ id: 'legal:contest_ticket', label: 'Contest a ticket', category: 'legal', icon: '⚖️', durationMinutes: 90, effects: {}, llm: 'narrate', group: 'Court' });
    }
    const pending = sim.legal.charges.filter((c) => c.status === 'pending');
    if (pending.length && venue?.archetype === 'courthouse') {
      out.push({ id: 'legal:appear', label: `Appear for ${pending[0].label.toLowerCase()}`, category: 'legal', icon: '⚖️', durationMinutes: 90, effects: {}, group: 'Court', interruptible: false });
    }
    if (sim.legal.warrants.length && venue?.archetype === 'police') {
      out.push({ id: 'legal:turn_self_in', label: 'Turn yourself in', category: 'legal', icon: '🚔', durationMinutes: 60, effects: {}, group: 'Legal', interruptible: false });
    }
    if (sim.legal.license.status === 'suspended' && venue?.archetype === 'dmv') {
      out.push({ id: 'legal:reinstate', label: 'Apply to reinstate your license', category: 'legal', icon: '🪪', durationMinutes: 60, cost: { amount: 125, memo: 'License reinstatement', category: 'legal' }, effects: {}, group: 'DMV' });
    }
    out.push({ id: 'legal:call_911', label: 'Call 911', description: 'Only if this is a real emergency.', category: 'phone', icon: '🚨', durationMinutes: 8, effects: {}, llm: 'narrate', group: 'Phone', hidden: false });
    return out;
  },

  handles(actionId) {
    return actionId.startsWith('legal:');
  },

  execute(ctx, simId, action, params): ActionResult {
    const sim = ctx.query.sim(simId);
    const now = ctx.state.time.minute;
    const id = action.id;

    if (id.startsWith('legal:crime:')) {
      const crimeId = String(params.crimeId ?? id.slice('legal:crime:'.length));
      const def = crimeDef(ctx, crimeId);
      const gain = params.gain as [number, number] | undefined;
      const others = ctx.query.simsAt(sim.location.venueId).filter((s) => s.id !== simId);
      const witnessed = others.length > 0 && ctx.rng.chance(clamp(0.25 + others.length * 0.08, 0.2, 0.9));
      const caught = ctx.rng.chance(detectionChance(ctx, sim, crimeId, witnessed));
      if (!caught && gain) {
        const amount = round2(ctx.rng.range(gain[0], gain[1]));
        ctx.applyEffects(simId, {
          money: { amount, memo: `Proceeds — ${def?.label ?? crimeId}`, category: 'crime' },
          stress: 10,
          skills: def?.skillId ? { [def.skillId]: 20 } : undefined,
          moodlets: [{ emotion: 'anxious', label: 'Got away with it', intensity: -4, durationMinutes: 240 }],
          memories: [{ kind: 'event', text: `I ${action.label.toLowerCase()} and nobody stopped me.`, salience: 60, valence: 0.1, tags: ['crime'] }],
        }, 'law:crime');
        sim.legal.heat = clamp100(sim.legal.heat + 5);
        return { ok: true, text: `Nobody looks up. ${formatMoney(amount)} richer, heart going hard.`, outcomeLabel: 'Got away with it' };
      }
      if (!caught) {
        sim.legal.heat = clamp100(sim.legal.heat + 3);
        return { ok: true, text: 'Done. Nobody seems to have noticed.', outcomeLabel: 'Unnoticed' };
      }
      ctx.emit({ type: 'legal:crime_committed', simId, crimeId, venueId: sim.location.venueId, witnessed: true });
      return { ok: true, text: 'A hand closes on your arm before you reach the door.', outcomeLabel: 'Caught' };
    }

    switch (id) {
      case 'legal:pay_ticket': {
        ctx.emit({ type: 'custom', kind: 'legal:pay_fine', simId, payload: {} });
        return { ok: true };
      }
      case 'legal:contest_ticket': {
        const t = sim.legal.tickets.find((x) => !x.paid);
        if (!t) return { ok: false, text: 'Nothing to contest.' };
        t.contested = true;
        const win = ctx.rng.chance(clamp(0.28 + (sim.skills.law?.level ?? 0) * 0.05 + (sim.skills.charisma?.level ?? 0) * 0.03, 0.1, 0.8));
        if (win) {
          t.paid = true;
          t.amount = 0;
          return { ok: true, text: 'The officer did not show. Dismissed.', outcomeLabel: 'Dismissed', effects: { moodlets: [{ emotion: 'proud', label: 'Beat the ticket', intensity: 10, durationMinutes: DAY }] } };
        }
        t.amount = round2(t.amount * 1.1);
        return { ok: true, text: 'Upheld, plus court costs.', outcomeLabel: 'Upheld', effects: { stress: 10 } };
      }
      case 'legal:appear': {
        const charge = sim.legal.charges.find((c) => c.status === 'pending');
        if (!charge) return { ok: false, text: 'Nothing on the docket for you.' };
        const verdict = holdCourt(ctx, sim, charge);
        return { ok: true, text: `The judge reads the file, asks two questions, and rules: ${verdict}.`, outcomeLabel: verdict };
      }
      case 'legal:rush_court': {
        const court = nearest(ctx, sim, 'courthouse');
        if (court) return { ok: true, effects: { moveTo: { venueId: court.id } }, text: 'You make it through the metal detector with minutes to spare.' };
        return { ok: false, text: 'There is no courthouse you can reach in time.' };
      }
      case 'legal:skip_court': {
        const charge = sim.legal.charges.find((c) => c.id === String(params.chargeId ?? '')) ?? sim.legal.charges.find((c) => c.status === 'pending');
        if (charge) issueWarrant(ctx, sim, charge);
        return { ok: true, text: 'You don\'t go. The docket is called without you.' };
      }
      case 'legal:turn_self_in': {
        const w = sim.legal.warrants.shift();
        const charge = w && sim.legal.charges.find((c) => c.id === w.chargeId);
        if (charge) {
          bookInto(ctx, sim, charge);
          return { ok: true, text: 'You walk up to the desk and say why you are there. It goes better than being found.', outcomeLabel: 'Turned yourself in', effects: { stress: 18, moodlets: [{ emotion: 'anxious', label: 'Turned yourself in', intensity: -8, durationMinutes: DAY }] } };
        }
        return { ok: false, text: 'There is no warrant out for you.' };
      }
      case 'legal:post_bail':
        ctx.emit({ type: 'custom', kind: 'legal:bail', simId, payload: {} });
        return { ok: true };
      case 'legal:wait_out':
        return { ok: true, text: 'Time in a holding cell moves differently.' };
      case 'legal:reinstate': {
        sim.legal.license.status = 'valid';
        sim.legal.license.points = 0;
        ctx.emit({ type: 'legal:license', simId, status: 'valid' });
        return { ok: true, text: 'Reinstated. Do not do that again.', effects: { moodlets: [{ emotion: 'relaxed', label: 'Driving legally again', intensity: 8, durationMinutes: DAY }] } };
      }
      case 'legal:call_911': {
        const venue = ctx.query.venueMaybe(sim.location.venueId);
        ctx.emit({ type: 'legal:police_called', venueId: sim.location.venueId, reason: 'emergency call', simId });
        ctx.schedule({ inMinutes: ctx.rng.int(8, 16), kind: 'emergency_response', label: 'Emergency response', simId, venueId: venue?.id });
        return { ok: true, text: 'The dispatcher keeps you on the line and asks the same question three ways. Help is coming.', effects: { stress: 8 } };
      }
      case 'legal:comply':
      case 'legal:ack':
        return { ok: true };
      case 'legal:request_counsel':
        sim.flags['legal:pdAssigned'] = true;
        return { ok: true, text: 'You ask for a lawyer and stop talking. A public defender will be assigned.' };
      default:
        return { ok: true };
    }
  },
};
