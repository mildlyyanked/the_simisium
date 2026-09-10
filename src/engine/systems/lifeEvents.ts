/**
 * Life events: the weighted, seeded random-event engine that keeps days from repeating —
 * car trouble, packages stolen, a friend texting out of the blue, a layoff rumor, a scam call,
 * a wedding invitation, a rent increase — plus holiday-triggered events and aspirations.
 *
 * Events emitted:  life:event, life:milestone, property:burglary, property:fire, transport:breakdown,
 *                  career:fired (layoffs), phone:text_received, phone:notification, story:beat
 * Events consumed: time:hour, time:day, calendar:holiday, world:new_game, career:promoted,
 *                  family:married, education:graduated, sim:skill_up, money:credit_score, sim:born
 * Action ids:      lifeEvents:*  (interrupt option handlers), system:set_goal
 *
 * World flags: `le:last:<eventId>` (minute the event last fired, for cooldowns), `le:rollDay`.
 */
import type { ActionDef, Aspiration, EffectBundle, Sim, SimId } from '../core/types';
import type { ActionResult, System, SystemContext } from '../core/systems';
import { newSimId, shortId } from '../core/ids';
import { makeSim } from '../core/factories';
import { clamp, DAY, formatMoney, round2 } from '../core/util';

interface LifeEvent {
  id: string;
  weight: number;
  cooldownDays: number;
  /** only for controlled sims by default */
  condition?: (ctx: SystemContext, sim: Sim) => boolean;
  run: (ctx: SystemContext, sim: Sim) => void;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const you = (ctx: SystemContext, sim: Sim) => (ctx.query.isControlled(sim.id) ? 'You' : sim.identity.firstName);
const your = (ctx: SystemContext, sim: Sim) => (ctx.query.isControlled(sim.id) ? 'your' : `${sim.identity.firstName}'s`);
const atHome = (ctx: SystemContext, sim: Sim) => ctx.query.homeOf(sim.id)?.id === sim.location.venueId;
const hasJob = (sim: Sim) => !!sim.career.job;
const hasCar = (ctx: SystemContext, sim: Sim) => (ctx.query.householdOf(sim.id)?.vehicleIds ?? []).some((v) => ['car', 'suv', 'truck', 'van'].includes(ctx.state.vehicles[v]?.kind ?? ''));
const isAdult = (sim: Sim) => !['infant', 'toddler', 'child', 'teen'].includes(sim.lifeStage);
const contacts = (ctx: SystemContext, sim: Sim, min = 15) => Object.values(sim.relationships).filter((r) => r.familiarity >= min && ctx.state.sims[r.simId]?.body.alive).map((r) => ctx.state.sims[r.simId]);
const family = (ctx: SystemContext, sim: Sim) => Object.values(sim.relationships).filter((r) => r.flags.some((f) => ['parent', 'child', 'sibling', 'grandparent'].includes(f))).map((r) => ctx.state.sims[r.simId]).filter(Boolean);

function log(ctx: SystemContext, sim: Sim, text: string, importance = 2): void {
  ctx.log({ text, kind: 'event', simId: sim.id, venueId: sim.location.venueId, importance });
}

function notify(ctx: SystemContext, sim: Sim, app: string, title: string, body: string, actionId?: string): void {
  sim.phone.notifications.push({ id: shortId(ctx.rng, 'ntf'), at: ctx.state.time.minute, app, title, body, read: false, actionId });
  if (sim.phone.notifications.length > 60) sim.phone.notifications.splice(0, sim.phone.notifications.length - 60);
  ctx.emit({ type: 'phone:notification', simId: sim.id, app, title, body });
}

function text(ctx: SystemContext, from: Sim, to: Sim, body: string): void {
  const msg = { id: shortId(ctx.rng, 'msg'), from: from.id, to: to.id, at: ctx.state.time.minute, text: body, read: false };
  (to.phone.threads[from.id] ||= []).push(msg);
  if (!to.phone.contacts.includes(from.id)) to.phone.contacts.push(from.id);
  ctx.emit({ type: 'phone:text_received', simId: to.id, fromSimId: from.id, text: body });
  ctx.log({ text: `${from.identity.firstName}: "${body}"`, kind: 'phone', simId: to.id, speakerId: from.id, importance: 1, meta: { needsLlm: true } });
}

function interrupt(ctx: SystemContext, sim: Sim, kind: Parameters<SystemContext['interrupt']>[0]['kind'], title: string, body: string, options: { label: string; actionId: string; params?: Record<string, unknown> }[]): void {
  if (!ctx.query.isControlled(sim.id)) return;
  ctx.interrupt({ kind, title, body, simId: sim.id, options });
}

function fx(ctx: SystemContext, sim: Sim, bundle: EffectBundle, src: string): void {
  ctx.applyEffects(sim.id, bundle, `lifeEvents:${src}`);
}

function mailTo(ctx: SystemContext, sim: Sim, from: string, subject: string, body: string, kind: 'bill' | 'letter' | 'notice' | 'junk' | 'check' | 'summons' | 'tax' | 'invitation', amount?: number): void {
  const hh = ctx.query.householdOf(sim.id);
  if (!hh) return;
  hh.mail.push({ id: shortId(ctx.rng, 'mail'), at: ctx.state.time.minute, from, subject, body, kind, amount, read: false });
  ctx.emit({ type: 'amenity:mail', householdId: hh.id, mailId: hh.mail[hh.mail.length - 1].id });
}

/** Create an NPC on the fly (an old friend, a new neighbor) placed at the sim's home venue or a nearby public venue. */
function spawnNpc(ctx: SystemContext, near: Sim, opts: { lastName?: string; ageRange?: [number, number]; gender?: Sim['identity']['gender']; role?: string; familiarity?: number; friendship?: number; flags?: Sim['relationships'][SimId]['flags'] }): Sim {
  const names = ctx.content.names;
  const gender = opts.gender ?? ctx.rng.pick(['male', 'female'] as const);
  const first = ctx.rng.pick(names.first[gender].length ? names.first[gender] : ['Sam']);
  const last = opts.lastName ?? ctx.rng.pick(names.last.length ? names.last : ['Lee']);
  const age = ctx.rng.int(opts.ageRange?.[0] ?? 22, opts.ageRange?.[1] ?? 55);
  const venue = ctx.query.nearestVenue(near.location.venueId, 'apartment_building') ?? ctx.query.venue(near.location.venueId);
  const npc = makeSim({ id: newSimId(ctx.rng), firstName: first, lastName: last, gender, age, epoch: ctx.state.epoch, rng: ctx.rng, venueId: venue.id, lod: 'near', role: opts.role ? { role: opts.role } : undefined, createdAt: ctx.state.time.minute });
  npc.personality.traits = ctx.rng.pickN(Object.keys(ctx.content.traits), 3);
  ctx.state.sims[npc.id] = npc;
  const now = ctx.state.time.minute;
  const mk = (): Sim['relationships'][SimId] => ({ simId: '' as SimId, friendship: opts.friendship ?? 20, romance: 0, trust: 10, familiarity: opts.familiarity ?? 25, attraction: 20, flags: [...(opts.flags ?? [])], firstMetAt: now - 400 * DAY, interactionsCount: 5, promises: [], grudges: [], moneyOwed: 0, decayRate: 0.3 });
  near.relationships[npc.id] = { ...mk(), simId: npc.id };
  npc.relationships[near.id] = { ...mk(), simId: near.id };
  near.phone.contacts.push(npc.id);
  npc.phone.contacts.push(near.id);
  return npc;
}

// ---------------------------------------------------------------------------
// the events
// ---------------------------------------------------------------------------
const EVENTS: LifeEvent[] = [
  // ---- home & neighborhood ----
  {
    id: 'package_stolen', weight: 4, cooldownDays: 40,
    condition: (ctx, sim) => !!ctx.query.householdOf(sim.id)?.packages.length && ctx.state.region.crimeIndex > 0.3,
    run: (ctx, sim) => {
      const hh = ctx.query.householdOf(sim.id)!;
      const pkg = hh.packages.shift()!;
      log(ctx, sim, `Porch pirates. The doorbell camera caught a hoodie taking ${your(ctx, sim)} package (${pkg.itemId.replace(/_/g, ' ')}).`);
      fx(ctx, sim, { stress: 10, moodlets: [{ emotion: 'angry', label: 'Package stolen', intensity: -8, durationMinutes: 600 }] }, 'package');
      interrupt(ctx, sim, 'event', 'Package stolen', 'Your delivery was taken off the porch. You can file a claim with the seller or report it.', [{ label: 'File a claim (refund in 5 days)', actionId: 'lifeEvents:claim_package', params: { itemId: pkg.itemId, qty: pkg.qty } }, { label: 'Let it go', actionId: 'lifeEvents:ack' }]);
    },
  },
  {
    id: 'burglary', weight: 1.2, cooldownDays: 180,
    condition: (ctx, sim) => !atHome(ctx, sim) && ctx.state.region.crimeIndex > 0.25 && !ctx.query.objectsAt(ctx.query.homeOf(sim.id)?.id ?? sim.location.venueId).some((o) => o.defId === 'security_camera' || o.defId === 'door_lock'),
    run: (ctx, sim) => {
      const home = ctx.query.homeOf(sim.id);
      if (!home) return;
      const loss = round2(ctx.rng.range(400, 3500));
      ctx.emit({ type: 'property:burglary', venueId: home.id, loss });
      log(ctx, sim, `${you(ctx, sim)} come home to a kicked-in back door. Roughly ${formatMoney(loss)} of things are gone.`, 3);
      interrupt(ctx, sim, 'event', 'Your home was broken into', `A back window is smashed and things are missing. Estimated loss: ${formatMoney(loss)}.`, [{ label: 'Call the police', actionId: 'lifeEvents:report_burglary' }, { label: 'Deal with it yourself', actionId: 'lifeEvents:ack' }]);
    },
  },
  {
    id: 'kitchen_fire', weight: 0.8, cooldownDays: 240,
    condition: (ctx, sim) => atHome(ctx, sim) && !!sim.currentAction?.label.toLowerCase().includes('cook'),
    run: (ctx, sim) => {
      const home = ctx.query.homeOf(sim.id)!;
      const handy = sim.skills.handiness?.level ?? 0;
      const contained = ctx.rng.chance(0.6 + handy * 0.04);
      ctx.emit({ type: 'property:fire', venueId: home.id, severity: contained ? 1 : 3 });
      log(ctx, sim, contained ? 'Grease flares in the pan. You smother it with a lid, heart pounding, and open every window.' : 'A pan catches and the curtain goes with it. By the time it is out, the kitchen is black and the smoke alarm will not stop.', 3);
      fx(ctx, sim, { stress: contained ? 12 : 30, moodlets: [{ emotion: 'scared', label: contained ? 'Small kitchen fire' : 'Kitchen fire', intensity: contained ? -6 : -16, durationMinutes: DAY }] }, 'fire');
    },
  },
  {
    id: 'water_leak', weight: 2, cooldownDays: 90,
    condition: (ctx, sim) => atHome(ctx, sim),
    run: (ctx, sim) => {
      const home = ctx.query.homeOf(sim.id)!;
      const sink = ctx.query.objectsAt(home.id).find((o) => o.defId === 'kitchen_sink' || o.defId === 'bathroom_sink' || o.defId === 'toilet');
      if (sink) {
        sink.state.broken = true;
        ctx.emit({ type: 'property:broken', objectId: sink.id, venueId: home.id });
      }
      log(ctx, sim, 'There is water on the floor under the sink and a slow drip that was not there yesterday.');
      fx(ctx, sim, { stress: 6 }, 'leak');
    },
  },
  {
    id: 'noisy_neighbors', weight: 3, cooldownDays: 20,
    condition: (ctx, sim) => atHome(ctx, sim) && ctx.clock.hour >= 22,
    run: (ctx, sim) => {
      log(ctx, sim, 'The neighbors are having a night. Bass through the wall, somebody laughing on the balcony.');
      fx(ctx, sim, { needs: { comfort: -12 }, stress: 6, moodlets: [{ emotion: 'tense', label: 'Noisy neighbors', intensity: -5, durationMinutes: 300 }] }, 'noise');
      interrupt(ctx, sim, 'event', 'Noisy neighbors', 'It is past 10 and the party next door is getting louder.', [{ label: 'Knock and ask them to keep it down', actionId: 'lifeEvents:ask_quiet' }, { label: 'Call it in', actionId: 'lifeEvents:noise_complaint' }, { label: 'Put in earplugs', actionId: 'lifeEvents:ack' }]);
    },
  },
  {
    id: 'neighbor_bbq', weight: 2, cooldownDays: 45,
    condition: (ctx, sim) => atHome(ctx, sim) && ctx.clock.day.isWeekend && ctx.clock.hour >= 12 && ctx.clock.hour < 18 && isAdult(sim),
    run: (ctx, sim) => {
      const n = spawnNpc(ctx, sim, { role: 'neighbor', familiarity: 12, friendship: 10, flags: ['neighbor'] });
      log(ctx, sim, `${n.identity.firstName} from down the hall knocks: they are grilling and there is too much food.`);
      interrupt(ctx, sim, 'visitor', 'Neighbor invitation', `${n.identity.firstName} ${n.identity.lastName} is grilling out back and invited you over.`, [{ label: 'Go over', actionId: 'lifeEvents:join_bbq', params: { npcId: n.id } }, { label: 'Politely decline', actionId: 'lifeEvents:ack' }]);
    },
  },
  {
    id: 'new_neighbor', weight: 1.5, cooldownDays: 120,
    run: (ctx, sim) => {
      const n = spawnNpc(ctx, sim, { role: 'neighbor', familiarity: 5, friendship: 3, flags: ['neighbor'] });
      log(ctx, sim, `A moving truck is blocking the lot. New neighbor: ${n.identity.firstName} ${n.identity.lastName}, waving from behind a box.`, 1);
    },
  },
  {
    id: 'rent_increase', weight: 2, cooldownDays: 300,
    condition: (ctx, sim) => ctx.query.homeOf(sim.id)?.residence?.tenure === 'rent',
    run: (ctx, sim) => {
      const home = ctx.query.homeOf(sim.id)!;
      const pct = ctx.rng.range(0.05, 0.12);
      const old = home.residence!.monthlyRent ?? 0;
      const next = round2(old * (1 + pct));
      home.residence!.monthlyRent = next;
      const bill = sim.finance.bills.find((b) => b.category === 'rent');
      if (bill) bill.amount = next;
      mailTo(ctx, sim, 'Property Management', 'Notice of rent adjustment', `Effective at renewal, your monthly rent will be ${formatMoney(next)} (was ${formatMoney(old)}).`, 'notice', next);
      log(ctx, sim, `A letter from the landlord: rent is going up ${Math.round(pct * 100)}% to ${formatMoney(next)} a month.`, 3);
      fx(ctx, sim, { stress: 14, moodlets: [{ emotion: 'stressed', label: 'Rent went up', intensity: -10, durationMinutes: DAY * 2 }] }, 'rent');
    },
  },
  {
    id: 'internet_down', weight: 3, cooldownDays: 25,
    condition: (ctx, sim) => atHome(ctx, sim),
    run: (ctx, sim) => {
      ctx.state.flags['le:internetDownUntil'] = ctx.state.time.minute + ctx.rng.int(60, 300);
      log(ctx, sim, 'The router blinks orange. The internet is down and the provider app says "we are aware of an outage in your area."', 1);
      fx(ctx, sim, { needs: { fun: -8 }, stress: 5 }, 'internet');
    },
  },

  // ---- money ----
  {
    id: 'found_cash', weight: 2, cooldownDays: 60,
    condition: (ctx, sim) => !atHome(ctx, sim),
    run: (ctx, sim) => {
      const amt = ctx.rng.pick([5, 10, 20, 20, 50]);
      fx(ctx, sim, { money: { amount: amt, memo: 'Found on the ground', category: 'misc' }, moodlets: [{ emotion: 'happy', label: `Found $${amt}`, intensity: 5, durationMinutes: 300 }] }, 'found');
      log(ctx, sim, `A folded ${formatMoney(amt, { cents: false })} bill on the sidewalk, and nobody around to claim it.`, 1);
    },
  },
  {
    id: 'lost_wallet', weight: 1.2, cooldownDays: 200,
    condition: (ctx, sim) => !atHome(ctx, sim) && isAdult(sim),
    run: (ctx, sim) => {
      const cash = sim.finance.accounts.find((a) => a.kind === 'cash');
      const lost = cash ? round2(cash.balance) : 0;
      if (cash) cash.balance = 0;
      log(ctx, sim, `${you(ctx, sim)} reach for ${your(ctx, sim)} wallet and it is not there. ${lost ? `${formatMoney(lost)} in cash, ` : ''}the cards, the license.`, 3);
      fx(ctx, sim, { stress: 22, moodlets: [{ emotion: 'anxious', label: 'Lost wallet', intensity: -12, durationMinutes: DAY }] }, 'wallet');
      interrupt(ctx, sim, 'event', 'Your wallet is gone', 'Cash, cards and your license — all of it. Cancelling the cards now limits the damage.', [{ label: 'Cancel the cards', actionId: 'lifeEvents:cancel_cards' }, { label: 'Retrace your steps first', actionId: 'lifeEvents:retrace_steps' }]);
    },
  },
  {
    id: 'scam_call', weight: 4, cooldownDays: 14,
    condition: (_ctx, sim) => isAdult(sim) && sim.phone.battery > 5,
    run: (ctx, sim) => {
      const script = ctx.rng.pick(['"This is the IRS. There is a warrant for your arrest unless you pay today in gift cards."', '"Your car\'s extended warranty is about to expire."', '"Grandma? It\'s me, I\'m in trouble and I need bail money."', '"We noticed suspicious activity on your account. Confirm your password to secure it."']);
      log(ctx, sim, `Unknown number. ${script}`, 1);
      interrupt(ctx, sim, 'phone_call', 'Unknown caller', script, [{ label: 'Hang up', actionId: 'lifeEvents:ack' }, { label: 'Play along and waste their time', actionId: 'lifeEvents:troll_scammer' }, { label: 'Do what they say', actionId: 'lifeEvents:fall_for_scam' }]);
    },
  },
  {
    id: 'medical_bill_surprise', weight: 1.5, cooldownDays: 120,
    condition: (_ctx, sim) => sim.body.illnesses.length > 0 || sim.body.injuries.length > 0,
    run: (ctx, sim) => {
      const amt = round2(ctx.rng.range(180, 1400));
      mailTo(ctx, sim, 'Regional Medical Billing', 'Statement of account', `Balance due for services not covered by your plan: ${formatMoney(amt)}. Payment plans available.`, 'bill', amt);
      sim.finance.bills.push({ id: shortId(ctx.rng, 'bill'), name: 'Medical bill', amount: amt, dueDayOfMonth: Math.min(28, ctx.clock.day.day), category: 'other', autopay: false, missed: 0 });
      log(ctx, sim, `A medical bill for ${formatMoney(amt)} — "not covered." Of course.`, 2);
      fx(ctx, sim, { stress: 12 }, 'medbill');
    },
  },
  {
    id: 'surprise_bonus', weight: 1, cooldownDays: 200,
    condition: (_ctx, sim) => hasJob(sim) && (sim.career.job?.performance ?? 0) > 70,
    run: (ctx, sim) => {
      const amt = round2((sim.career.job?.annualSalary ?? (sim.career.job?.hourlyRate ?? 15) * 2080) * ctx.rng.range(0.01, 0.04));
      fx(ctx, sim, { money: { amount: amt, memo: 'Spot bonus', category: 'income', counterparty: sim.career.job?.employerName }, moodlets: [{ emotion: 'proud', label: 'Bonus!', intensity: 12, durationMinutes: DAY * 2 }] }, 'bonus');
      log(ctx, sim, `${your(ctx, sim)} manager pulls ${ctx.query.isControlled(sim.id) ? 'you' : 'them'} aside: a ${formatMoney(amt)} spot bonus for last quarter.`, 3);
    },
  },
  {
    id: 'layoff_rumor', weight: 1.2, cooldownDays: 150,
    condition: (ctx, sim) => hasJob(sim) && ctx.state.economy.jobMarketHeat < 0.6,
    run: (ctx, sim) => {
      log(ctx, sim, `Word around the office: the company is "restructuring." ${your(ctx, sim)} team may be affected.`, 2);
      fx(ctx, sim, { stress: 12, moodlets: [{ emotion: 'anxious', label: 'Layoff rumors', intensity: -8, durationMinutes: DAY * 3 }] }, 'rumor');
      ctx.schedule({ inMinutes: ctx.rng.int(5, 12) * DAY, kind: '_le_layoff', label: 'Restructuring decision', simId: sim.id });
    },
  },
  {
    id: 'credit_card_fraud', weight: 1, cooldownDays: 200,
    condition: (_ctx, sim) => sim.finance.accounts.some((a) => a.kind === 'credit_card'),
    run: (ctx, sim) => {
      const cc = sim.finance.accounts.find((a) => a.kind === 'credit_card')!;
      const amt = round2(ctx.rng.range(80, 900));
      cc.balance = round2(cc.balance + amt);
      notify(ctx, sim, 'bank', 'Suspicious charge', `${formatMoney(amt)} at a store you have never heard of, in a state you have never been to.`);
      log(ctx, sim, `A fraud alert: ${formatMoney(amt)} charged to ${your(ctx, sim)} card somewhere far away.`, 2);
      interrupt(ctx, sim, 'event', 'Fraudulent charge', `${formatMoney(amt)} was charged to your credit card. Disputing it takes ten minutes and a new card in the mail.`, [{ label: 'Dispute it', actionId: 'lifeEvents:dispute_charge', params: { amount: amt, accountId: cc.id } }, { label: 'Deal with it later', actionId: 'lifeEvents:ack' }]);
    },
  },
  {
    id: 'inheritance', weight: 0.15, cooldownDays: 2000,
    condition: (_ctx, sim) => isAdult(sim),
    run: (ctx, sim) => {
      const amt = round2(ctx.rng.range(1500, 25000));
      mailTo(ctx, sim, 'Estate of a Relative', 'Distribution from the estate', `Enclosed is a check for ${formatMoney(amt)} from the estate of a great-aunt you met twice.`, 'check', amt);
      fx(ctx, sim, { money: { amount: amt, memo: 'Inheritance', category: 'income' }, moodlets: [{ emotion: 'nostalgic', label: 'An inheritance', intensity: 6, durationMinutes: DAY * 3 }] }, 'inheritance');
      log(ctx, sim, `A lawyer's envelope: a great-aunt ${you(ctx, sim) === 'You' ? 'you' : sim.identity.firstName} barely knew left ${formatMoney(amt)}.`, 3);
      ctx.emit({ type: 'life:milestone', simId: sim.id, label: 'Received an inheritance' });
    },
  },
  {
    id: 'flash_sale', weight: 3, cooldownDays: 10,
    condition: (_ctx, sim) => isAdult(sim),
    run: (ctx, sim) => {
      notify(ctx, sim, 'shop', 'Flash sale — 40% off today only', 'The thing you looked at last week is on sale. Just saying.');
      if (sim.personality.traits.includes('materialistic')) fx(ctx, sim, { moodlets: [{ emotion: 'tense', label: 'Must. Not. Buy.', intensity: -3, durationMinutes: 240 }] }, 'sale');
    },
  },

  // ---- transport ----
  {
    id: 'flat_tire', weight: 2, cooldownDays: 90,
    condition: (ctx, sim) => hasCar(ctx, sim) && !!sim.travel && sim.travel.mode === 'drive',
    run: (ctx, sim) => {
      const vid = sim.travel?.vehicleId ?? ctx.query.householdOf(sim.id)!.vehicleIds[0];
      const v = ctx.state.vehicles[vid];
      if (!v) return;
      v.issues.push('flat tire');
      v.condition = clamp(v.condition - 8, 0, 100);
      ctx.emit({ type: 'transport:breakdown', vehicleId: v.id, simId: sim.id, issue: 'flat tire' });
      if (sim.travel) sim.travel.arriveAt += 45;
      log(ctx, sim, 'A thump, a wobble, and the unmistakable flap of a flat tire. Forty-five minutes on the shoulder.', 2);
      fx(ctx, sim, { stress: 12, needs: { comfort: -15, hygiene: -10 }, skills: { mechanics: 10 } }, 'flat');
    },
  },
  {
    id: 'parking_ticket', weight: 2.5, cooldownDays: 30,
    condition: (ctx, sim) => hasCar(ctx, sim) && !atHome(ctx, sim) && ctx.state.region.density === 'urban',
    run: (ctx, sim) => {
      ctx.emit({ type: 'legal:crime_committed', simId: sim.id, crimeId: 'parking_violation', venueId: sim.location.venueId, witnessed: true });
      log(ctx, sim, 'An orange envelope under the wiper. Street cleaning was today, apparently.', 1);
    },
  },
  {
    id: 'hail_damage', weight: 0.6, cooldownDays: 365,
    condition: (ctx, sim) => hasCar(ctx, sim) && (ctx.state.weather.current.condition === 'thunderstorm'),
    run: (ctx, sim) => {
      const v = ctx.state.vehicles[ctx.query.householdOf(sim.id)!.vehicleIds[0]];
      if (!v) return;
      v.condition = clamp(v.condition - 15, 0, 100);
      v.value = round2(v.value * 0.85);
      v.issues.push('hail dents');
      log(ctx, sim, 'Hail the size of quarters for six minutes. The car looks like a golf ball.', 2);
      fx(ctx, sim, { stress: 10 }, 'hail');
    },
  },

  // ---- phone & social ----
  {
    id: 'old_friend_texts', weight: 3, cooldownDays: 30,
    condition: (_ctx, sim) => isAdult(sim),
    run: (ctx, sim) => {
      const known = contacts(ctx, sim, 20);
      const friend = known.length && ctx.rng.chance(0.6) ? ctx.rng.pick(known) : spawnNpc(ctx, sim, { role: 'old friend', familiarity: 40, friendship: 30, ageRange: [Math.max(18, ctx.query.ageOf(sim) - 4), ctx.query.ageOf(sim) + 4] });
      text(ctx, friend, sim, ctx.rng.pick(['hey stranger. thought of you today. how are things?', 'ok this is random but are you around this weekend?', 'saw something that reminded me of you lol. we should catch up', 'long time!! you still in town?']));
      notify(ctx, sim, 'messages', friend.identity.firstName, 'New message');
    },
  },
  {
    id: 'wrong_number', weight: 2, cooldownDays: 20,
    run: (ctx, sim) => {
      log(ctx, sim, ctx.rng.pick(['A text from an unknown number: "is this still the number for the guy with the boat"', 'Unknown number: "Running 10 late, save me a seat" — not for you.', 'Group text from strangers planning a baby shower. You are added by mistake and now you know all their names.']), 1);
      fx(ctx, sim, { needs: { fun: 3 } }, 'wrong');
    },
  },
  {
    id: 'dating_match', weight: 2.5, cooldownDays: 12,
    condition: (_ctx, sim) => isAdult(sim) && !Object.values(sim.relationships).some((r) => r.flags.some((f) => ['dating', 'partner', 'engaged', 'married'].includes(f))) && !!sim.flags['dating_app'],
    run: (ctx, sim) => {
      const g = sim.personality.sexuality === 'gay' ? sim.identity.gender : sim.personality.sexuality === 'straight' ? (sim.identity.gender === 'male' ? 'female' : 'male') : ctx.rng.pick(['male', 'female'] as const);
      const m = spawnNpc(ctx, sim, { gender: g === 'nonbinary' ? 'female' : g, familiarity: 6, friendship: 4, ageRange: [Math.max(18, ctx.query.ageOf(sim) - 6), ctx.query.ageOf(sim) + 6] });
      sim.relationships[m.id].attraction = ctx.rng.int(40, 85);
      notify(ctx, sim, 'social', 'New match!', `You matched with ${m.identity.firstName}, ${ctx.query.ageOf(m)}.`);
      text(ctx, m, sim, ctx.rng.pick(['hey! your profile made me laugh. what are you up to this week?', 'hi :) so what\'s the story behind that photo?', 'ok I have to know — cats or dogs?']));
      log(ctx, sim, `A match on the app: ${m.identity.firstName}. ${ctx.rng.pick(['Good photos. Suspiciously good.', 'They message first, which is something.', 'Bio says "fluent in sarcasm." Sure.'])}`, 1);
    },
  },
  {
    id: 'ex_reaches_out', weight: 1, cooldownDays: 120,
    condition: (_ctx, sim) => Object.values(sim.relationships).some((r) => r.flags.includes('ex')),
    run: (ctx, sim) => {
      const exId = Object.values(sim.relationships).find((r) => r.flags.includes('ex'))!.simId;
      const ex = ctx.state.sims[exId];
      if (!ex) return;
      text(ctx, ex, sim, ctx.rng.pick(['hey. no reason. just hope you\'re doing ok.', 'I still have your sweater. do you want it back or', 'was thinking about that trip. anyway. hi.']));
      fx(ctx, sim, { moodlets: [{ emotion: 'nostalgic', label: `${ex.identity.firstName} texted`, intensity: -3, durationMinutes: 480 }] }, 'ex');
    },
  },
  {
    id: 'wedding_invite', weight: 1, cooldownDays: 180,
    condition: (ctx, sim) => isAdult(sim) && contacts(ctx, sim, 25).length > 0,
    run: (ctx, sim) => {
      const f = ctx.rng.pick(contacts(ctx, sim, 25));
      const at = ctx.state.time.minute + ctx.rng.int(30, 75) * DAY;
      mailTo(ctx, sim, `${f.identity.firstName} ${f.identity.lastName}`, 'You are invited', `${f.identity.firstName} is getting married. Please join us — RSVP by the end of the month.`, 'invitation');
      ctx.schedule({ atMinute: at, kind: 'party', label: `${f.identity.firstName}'s wedding`, simId: sim.id, payload: { host: f.id, kind: 'wedding' } });
      log(ctx, sim, `A heavy envelope: ${f.identity.firstName} is getting married, and ${you(ctx, sim).toLowerCase()} are invited.`, 2);
    },
  },
  {
    id: 'coworker_collection', weight: 2.5, cooldownDays: 25,
    condition: (_ctx, sim) => hasJob(sim),
    run: (ctx, sim) => {
      interrupt(ctx, sim, 'event', 'Office collection', 'Somebody is passing an envelope around for a coworker\'s birthday. Twenty seems to be the number.', [{ label: 'Chip in $20', actionId: 'lifeEvents:chip_in', params: { amount: 20 } }, { label: 'Chip in $5', actionId: 'lifeEvents:chip_in', params: { amount: 5 } }, { label: 'Pretend not to see it', actionId: 'lifeEvents:dodge_collection' }]);
    },
  },
  {
    id: 'cover_shift', weight: 3, cooldownDays: 12,
    condition: (_ctx, sim) => hasJob(sim) && sim.career.job?.payType === 'hourly',
    run: (ctx, sim) => {
      notify(ctx, sim, 'messages', sim.career.job?.employerName ?? 'Work', 'Can anyone cover tomorrow\'s shift? Time and a half.');
      interrupt(ctx, sim, 'text', 'Cover a shift?', `${sim.career.job?.employerName}: "Can anyone cover tomorrow? Time and a half."`, [{ label: 'Take it', actionId: 'lifeEvents:cover_shift' }, { label: 'Leave it on read', actionId: 'lifeEvents:ack' }]);
    },
  },
  {
    id: 'family_call', weight: 3, cooldownDays: 9,
    condition: (ctx, sim) => family(ctx, sim).length > 0,
    run: (ctx, sim) => {
      const rel = ctx.rng.pick(family(ctx, sim));
      const label = sim.relationships[rel.id].flags.includes('parent') ? (rel.identity.gender === 'female' ? 'Mom' : rel.identity.gender === 'male' ? 'Dad' : rel.identity.firstName) : rel.identity.firstName;
      interrupt(ctx, sim, 'phone_call', `${label} is calling`, ctx.rng.pick(['No emergency, probably. They just want to talk.', 'It is the third time this week.', 'You have been meaning to call them anyway.']), [{ label: 'Answer', actionId: `social:${rel.id}:converse`, params: { channel: 'phone' } }, { label: 'Let it ring', actionId: 'lifeEvents:ignore_family', params: { npcId: rel.id } }]);
    },
  },
  {
    id: 'friend_crash', weight: 1, cooldownDays: 150,
    condition: (ctx, sim) => isAdult(sim) && atHome(ctx, sim) && contacts(ctx, sim, 30).length > 0,
    run: (ctx, sim) => {
      const f = ctx.rng.pick(contacts(ctx, sim, 30));
      text(ctx, f, sim, 'hey. things fell apart with my roommate. could I crash on your couch for a few nights? I\'ll be invisible I promise');
      interrupt(ctx, sim, 'text', `${f.identity.firstName} needs a couch`, `${f.identity.firstName} asks to stay for a few nights.`, [{ label: 'Of course', actionId: 'lifeEvents:host_friend', params: { npcId: f.id } }, { label: 'I can\'t right now', actionId: 'lifeEvents:decline_friend', params: { npcId: f.id } }]);
    },
  },
  {
    id: 'viral_post', weight: 0.6, cooldownDays: 200,
    condition: (_ctx, sim) => sim.phone.socialMedia.length > 0,
    run: (ctx, sim) => {
      const sm = sim.phone.socialMedia[0];
      const gain = ctx.rng.int(400, 9000);
      sm.followers += gain;
      ctx.emit({ type: 'phone:social_post', simId: sim.id, text: 'a post that took off', likes: gain * 3 });
      log(ctx, sim, `Something ${you(ctx, sim).toLowerCase()} posted last week took off overnight. +${gain.toLocaleString()} followers and a lot of strangers with opinions.`, 2);
      fx(ctx, sim, { moodlets: [{ emotion: 'confident', label: 'Went viral', intensity: 10, durationMinutes: DAY * 2 }], stress: 6 }, 'viral');
    },
  },

  // ---- health & body ----
  {
    id: 'phone_cracked', weight: 1.5, cooldownDays: 200,
    condition: (_ctx, sim) => isAdult(sim) || sim.lifeStage === 'teen',
    run: (ctx, sim) => {
      log(ctx, sim, 'The phone slips off the counter face-down. A spiderweb across the top corner. It still works. Mostly.', 2);
      interrupt(ctx, sim, 'event', 'Cracked screen', 'You can live with it, or get it fixed for about $180.', [{ label: 'Get it fixed ($180)', actionId: 'lifeEvents:fix_phone' }, { label: 'Live with it', actionId: 'lifeEvents:live_with_crack' }]);
    },
  },
  {
    id: 'wisdom_tooth', weight: 0.7, cooldownDays: 900,
    condition: (ctx, sim) => ctx.query.ageOf(sim) >= 17 && ctx.query.ageOf(sim) <= 30,
    run: (ctx, sim) => {
      ctx.emit({ type: 'custom', kind: 'health:injury', simId: sim.id, payload: { name: 'Impacted wisdom tooth', bodyPart: 'jaw', severity: 30, days: 10 } });
      log(ctx, sim, 'A dull ache in the back of the jaw that has become a sharp one. Wisdom tooth, probably.', 2);
    },
  },
  {
    id: 'flu_going_around', weight: 1.5, cooldownDays: 60,
    condition: (ctx, sim) => (ctx.clock.season === 'winter' || ctx.clock.season === 'fall') && hasJob(sim),
    run: (ctx, sim) => {
      log(ctx, sim, 'Half the office is out. Someone is coughing in the next cubicle and not covering their mouth.', 1);
      if (ctx.rng.chance(0.35)) ctx.emit({ type: 'custom', kind: 'health:contract', simId: sim.id, payload: { defId: 'flu' } });
    },
  },

  // ---- kids & family ----
  {
    id: 'kid_sick_at_school', weight: 3, cooldownDays: 30,
    condition: (ctx, sim) => ctx.clock.day.isSchoolDay && ctx.clock.hour >= 9 && ctx.clock.hour < 14 && (ctx.query.householdOf(sim.id)?.simIds ?? []).some((id) => ['child', 'teen'].includes(ctx.state.sims[id]?.lifeStage ?? '')),
    run: (ctx, sim) => {
      const kidId = (ctx.query.householdOf(sim.id)?.simIds ?? []).find((id) => ['child', 'teen'].includes(ctx.state.sims[id]?.lifeStage ?? ''))!;
      const kid = ctx.state.sims[kidId];
      ctx.emit({ type: 'custom', kind: 'health:contract', simId: kidId, payload: { defId: 'stomach_bug' } });
      interrupt(ctx, sim, 'phone_call', 'The school nurse is calling', `${kid.identity.firstName} threw up in class. Someone needs to pick them up.`, [{ label: 'Go get them', actionId: 'lifeEvents:pickup_sick_kid', params: { kidId } }, { label: 'Ask your partner / someone else', actionId: 'lifeEvents:delegate_pickup', params: { kidId } }]);
    },
  },
  {
    id: 'field_trip', weight: 2, cooldownDays: 45,
    condition: (ctx, sim) => (ctx.query.householdOf(sim.id)?.simIds ?? []).some((id) => ctx.state.sims[id]?.lifeStage === 'child'),
    run: (ctx, sim) => {
      const kid = ctx.state.sims[(ctx.query.householdOf(sim.id)?.simIds ?? []).find((id) => ctx.state.sims[id]?.lifeStage === 'child')!];
      interrupt(ctx, sim, 'event', 'Permission slip', `${kid.identity.firstName} needs a permission slip signed and $15 for the field trip to the science museum.`, [{ label: 'Sign and pay $15', actionId: 'lifeEvents:field_trip', params: { kidId: kid.id } }, { label: 'Not this time', actionId: 'lifeEvents:no_field_trip', params: { kidId: kid.id } }]);
    },
  },
  {
    id: 'teen_wants_car', weight: 1, cooldownDays: 200,
    condition: (ctx, sim) => (ctx.query.householdOf(sim.id)?.simIds ?? []).some((id) => ctx.state.sims[id]?.lifeStage === 'teen' && ctx.query.ageOf(ctx.state.sims[id]) >= 16),
    run: (ctx, sim) => {
      const teen = ctx.state.sims[(ctx.query.householdOf(sim.id)?.simIds ?? []).find((id) => ctx.state.sims[id]?.lifeStage === 'teen')!];
      log(ctx, sim, `${teen.identity.firstName} has a printout of a used Civic listing and a whole presentation ready.`, 2);
      fx(ctx, sim, { relationships: [{ simId: teen.id, familiarity: 2 }] }, 'teen');
    },
  },
  {
    id: 'grandparent_hospital', weight: 0.5, cooldownDays: 400,
    condition: (ctx, sim) => family(ctx, sim).some((f) => ctx.query.ageOf(f) >= 65),
    run: (ctx, sim) => {
      const g = family(ctx, sim).find((f) => ctx.query.ageOf(f) >= 65)!;
      ctx.emit({ type: 'custom', kind: 'health:contract', simId: g.id, payload: { defId: 'pneumonia', severity: 45 } });
      log(ctx, sim, `${g.identity.firstName} is in the hospital. Pneumonia, they say, and "we are keeping an eye on it."`, 3);
      fx(ctx, sim, { stress: 18, moodlets: [{ emotion: 'anxious', label: `${g.identity.firstName} in the hospital`, intensity: -12, durationMinutes: DAY * 3 }] }, 'grandparent');
    },
  },

  // ---- doorstep ----
  {
    id: 'cookies_at_door', weight: 2, cooldownDays: 60,
    condition: (ctx, sim) => atHome(ctx, sim) && ctx.clock.season === 'winter' || (atHome(ctx, sim) && ctx.clock.season === 'spring'),
    run: (ctx, sim) => {
      interrupt(ctx, sim, 'visitor', 'Girl Scouts at the door', 'A kid in a sash and a parent hovering behind her. Thin Mints are $6 a box.', [{ label: 'Buy two boxes ($12)', actionId: 'lifeEvents:buy_cookies', params: { boxes: 2 } }, { label: 'Buy one box ($6)', actionId: 'lifeEvents:buy_cookies', params: { boxes: 1 } }, { label: 'Not today', actionId: 'lifeEvents:ack' }]);
    },
  },
  {
    id: 'canvasser', weight: 1.5, cooldownDays: 30,
    condition: (ctx, sim) => atHome(ctx, sim) && ctx.clock.hour >= 16 && ctx.clock.hour < 20,
    run: (ctx, sim) => {
      const who = ctx.rng.pick(['a campaign volunteer with a clipboard', 'two very polite missionaries', 'someone selling solar panels', 'a neighbor collecting signatures about the intersection']);
      log(ctx, sim, `The doorbell: ${who}.`, 1);
      fx(ctx, sim, { needs: { social: 4 } }, 'door');
    },
  },
  {
    id: 'stray_animal', weight: 1, cooldownDays: 120,
    condition: (ctx, sim) => atHome(ctx, sim) && !!ctx.query.homeOf(sim.id)?.residence?.petsAllowed,
    run: (ctx, sim) => {
      interrupt(ctx, sim, 'visitor', 'A stray on the porch', 'A skinny orange cat has decided your doormat is its bed. No collar. It looks at you like you owe it something.', [{ label: 'Take it in', actionId: 'lifeEvents:adopt_stray' }, { label: 'Leave out some water and let it be', actionId: 'lifeEvents:ack' }]);
    },
  },

  // ---- civic / town ----
  {
    id: 'street_festival', weight: 1.5, cooldownDays: 40,
    condition: (ctx, sim) => ctx.clock.day.isWeekend && ctx.clock.hour >= 10 && ctx.clock.hour < 17,
    run: (ctx, sim) => {
      const park = ctx.query.nearestVenue(sim.location.venueId, 'park');
      if (!park) return;
      ctx.schedule({ inMinutes: 30, kind: 'festival', label: 'Street festival', venueId: park.id, payload: { pop: true } });
      log(ctx, sim, `Barricades going up two streets over: a street festival at ${park.name}. Food trucks, a stage, a bounce house.`, 1);
    },
  },
  {
    id: 'car_recall', weight: 0.8, cooldownDays: 400,
    condition: (ctx, sim) => hasCar(ctx, sim),
    run: (ctx, sim) => {
      mailTo(ctx, sim, 'Manufacturer', 'IMPORTANT SAFETY RECALL', 'Your vehicle is subject to a recall. Repairs are free at any dealer. Please schedule at your earliest convenience.', 'notice');
      log(ctx, sim, 'A recall notice for the car. Something about a fuel pump. Free fix, if you can find a Saturday.', 1);
    },
  },
  {
    id: 'reunion_invite', weight: 0.5, cooldownDays: 1000,
    condition: (ctx, sim) => ctx.query.ageOf(sim) >= 27,
    run: (ctx, sim) => {
      mailTo(ctx, sim, 'Class Reunion Committee', 'You are invited!', 'Come see who got old. Tickets $65, cash bar.', 'invitation');
      log(ctx, sim, 'A high school reunion invite. Ten years, apparently. That cannot be right.', 1);
      fx(ctx, sim, { moodlets: [{ emotion: 'nostalgic', label: 'Reunion invite', intensity: 2, durationMinutes: DAY }] }, 'reunion');
    },
  },
];

// ---------------------------------------------------------------------------
// aspirations
// ---------------------------------------------------------------------------
const ASPIRATION_POOL: { category: Aspiration['category']; text: string; milestones: string[]; value: keyof Sim['personality']['values'] }[] = [
  { category: 'career', text: 'Get promoted twice', milestones: ['Land a job', 'First promotion', 'Second promotion'], value: 'career' },
  { category: 'wealth', text: 'Save $10,000', milestones: ['$1,000 in savings', '$5,000 in savings', '$10,000 in savings'], value: 'wealth' },
  { category: 'family', text: 'Build a family', milestones: ['Fall in love', 'Move in together', 'Get married', 'Have a child'], value: 'family' },
  { category: 'knowledge', text: 'Master a skill', milestones: ['Reach level 3', 'Reach level 6', 'Reach level 10'], value: 'knowledge' },
  { category: 'social', text: 'Have five close friends', milestones: ['One good friend', 'Three good friends', 'Five good friends'], value: 'community' },
  { category: 'health', text: 'Get genuinely fit', milestones: ['Fitness 50', 'Fitness 70', 'Fitness 85'], value: 'health' },
  { category: 'home', text: 'Own a home', milestones: ['Save a down payment', 'Get pre-qualified', 'Close on a place'], value: 'family' },
  { category: 'creativity', text: 'Make something people love', milestones: ['Practice 20 hours', 'Perform or publish', 'Get paid for it'], value: 'creativity' },
  { category: 'adventure', text: 'See more of the world', milestones: ['Visit 20 places in town', 'Take a trip', 'Get a passport'], value: 'adventure' },
];

function seedAspirations(ctx: SystemContext, sim: Sim): void {
  if (sim.aspirations.length) return;
  const ranked = [...ASPIRATION_POOL].sort((a, b) => sim.personality.values[b.value] - sim.personality.values[a.value]);
  for (const a of ranked.slice(0, 2)) {
    sim.aspirations.push({ id: shortId(ctx.rng, 'asp'), text: a.text, category: a.category, progress: 0, completed: false, milestones: a.milestones.map((m) => ({ text: m, done: false })) });
  }
}

function tickAspirations(ctx: SystemContext, sim: Sim): void {
  for (const a of sim.aspirations) {
    if (a.completed) continue;
    const done = (i: number) => {
      if (a.milestones[i] && !a.milestones[i].done) {
        a.milestones[i].done = true;
        log(ctx, sim, `Milestone: ${a.milestones[i].text} (${a.text}).`, 2);
        fx(ctx, sim, { moodlets: [{ emotion: 'proud', label: a.milestones[i].text, intensity: 8, durationMinutes: DAY }] }, 'aspiration');
      }
    };
    const savings = sim.finance.accounts.filter((x) => x.kind === 'savings' || x.kind === 'checking').reduce((s, x) => s + x.balance, 0);
    const promotions = sim.career.history.length + (sim.career.job ? sim.career.job.level : 0);
    const goodFriends = Object.values(sim.relationships).filter((r) => r.friendship >= 60).length;
    const maxSkill = Math.max(0, ...Object.values(sim.skills).map((s) => s.level));
    const rels = Object.values(sim.relationships);
    switch (a.category) {
      case 'career': if (sim.career.job) done(0); if (promotions >= 2) done(1); if (promotions >= 3) done(2); break;
      case 'wealth': if (savings >= 1000) done(0); if (savings >= 5000) done(1); if (savings >= 10000) done(2); break;
      case 'family': if (rels.some((r) => r.flags.includes('dating') || r.romance > 40)) done(0); if (rels.some((r) => r.flags.includes('partner') || r.flags.includes('roommate') && r.romance > 30)) done(1); if (rels.some((r) => r.flags.includes('married'))) done(2); if (rels.some((r) => r.flags.includes('child'))) done(3); break;
      case 'knowledge': if (maxSkill >= 3) done(0); if (maxSkill >= 6) done(1); if (maxSkill >= 10) done(2); break;
      case 'social': if (goodFriends >= 1) done(0); if (goodFriends >= 3) done(1); if (goodFriends >= 5) done(2); break;
      case 'health': if (sim.body.fitness >= 50) done(0); if (sim.body.fitness >= 70) done(1); if (sim.body.fitness >= 85) done(2); break;
      case 'home': if (savings >= ctx.state.region.medianHomePrice * 0.035) done(0); if (sim.flags['property:prequalified']) done(1); if (ctx.query.homeOf(sim.id)?.residence?.tenure === 'own') done(2); break;
      case 'creativity': { const creative = ['painting', 'music', 'writing', 'guitar', 'piano', 'singing', 'photography', 'dancing'].map((s) => sim.skills[s]?.level ?? 0); if (Math.max(...creative) >= 2) done(0); if (Math.max(...creative) >= 5) done(1); if (sim.flags['creative:paid']) done(2); break; }
      case 'adventure': if (ctx.state.stats.placesVisited >= 20) done(0); if (sim.flags['travel:trip']) done(1); if (sim.flags['legal:passport']) done(2); break;
    }
    const doneCount = a.milestones.filter((m) => m.done).length;
    a.progress = Math.round((doneCount / a.milestones.length) * 100);
    if (doneCount === a.milestones.length) {
      a.completed = true;
      ctx.emit({ type: 'life:milestone', simId: sim.id, label: `Aspiration complete: ${a.text}` });
      log(ctx, sim, `Aspiration complete: ${a.text}.`, 3);
      fx(ctx, sim, { moodlets: [{ emotion: 'proud', label: 'Aspiration fulfilled', intensity: 20, durationMinutes: DAY * 5 }], stress: -20 }, 'aspiration');
      sim.mind.satisfaction = clamp(sim.mind.satisfaction + 15, 0, 100);
    }
  }
}

// ---------------------------------------------------------------------------
// the system
// ---------------------------------------------------------------------------
function rollEvents(ctx: SystemContext, sim: Sim): void {
  const now = ctx.state.time.minute;
  const eligible = EVENTS.filter((e) => {
    const last = Number(ctx.state.flags[`le:last:${e.id}:${sim.id}`] ?? -Infinity);
    if (now - last < e.cooldownDays * DAY) return false;
    try {
      return e.condition ? e.condition(ctx, sim) : true;
    } catch {
      return false;
    }
  });
  if (!eligible.length) return;
  const ev = ctx.rng.weighted(eligible.map((e) => ({ weight: e.weight, value: e })));
  ctx.state.flags[`le:last:${ev.id}:${sim.id}`] = now;
  try {
    ev.run(ctx, sim);
    ctx.emit({ type: 'life:event', simId: sim.id, kind: ev.id, label: ev.id.replace(/_/g, ' ') });
  } catch (err) {
    ctx.log({ text: `[lifeEvents] ${ev.id} failed: ${(err as Error).message}`, kind: 'system', importance: 0 });
  }
}

export const lifeEventsSystem: System = {
  id: 'lifeEvents',
  intervalMinutes: 60,

  onInit(ctx) {
    for (const sim of ctx.query.controlledSims()) seedAspirations(ctx, sim);
  },

  onTick(ctx) {
    // ~1.5 events per household-day, spread over waking hours
    const h = ctx.clock.hour;
    if (h < 7 || h > 22) return;
    const controlled = ctx.query.controlledSims().filter((s) => s.body.alive);
    if (!controlled.length) return;
    const perHourChance = 1.5 / 16 / controlled.length;
    for (const sim of controlled) if (ctx.rng.chance(perHourChance)) rollEvents(ctx, sim);
    if (ctx.state.flags['le:internetDownUntil'] && Number(ctx.state.flags['le:internetDownUntil']) < ctx.state.time.minute) delete ctx.state.flags['le:internetDownUntil'];
  },

  onEvent(ctx, e) {
    if (e.type === 'time:day') {
      for (const sim of ctx.query.controlledSims()) tickAspirations(ctx, sim);
      return;
    }
    if (e.type === 'career:promoted' || e.type === 'family:married' || e.type === 'education:graduated' || e.type === 'sim:skill_up' || e.type === 'money:credit_score') {
      const sim = ctx.query.simMaybe(e.simId);
      if (sim && ctx.query.isControlled(sim.id)) tickAspirations(ctx, sim);
      return;
    }
    if (e.type === 'calendar:holiday') {
      for (const sim of ctx.query.controlledSims()) {
        if (e.holidayId === 'thanksgiving' && family(ctx, sim).length) {
          const f = family(ctx, sim)[0];
          text(ctx, f, sim, 'Dinner is at 3. Bring a side. And a real one, not a bag of rolls.');
        }
        if (e.holidayId === 'halloween' && ctx.query.homeOf(sim.id)) {
          ctx.schedule({ inMinutes: Math.max(0, 18 * 60 - ctx.clock.minuteOfDay), kind: '_le_trick_or_treat', label: 'Trick-or-treaters', simId: sim.id });
        }
        if (e.holidayId === 'new_years_day') {
          fx(ctx, sim, { moodlets: [{ emotion: 'hopeful', label: 'New year, new you', intensity: 6, durationMinutes: DAY * 3 }] }, 'nye');
          if (sim.aspirations.filter((a) => !a.completed).length < 2) seedAspirations(ctx, sim);
        }
        if (e.holidayId === 'independence_day') log(ctx, sim, 'Fireworks from three directions after dark, and the dog is not okay with any of it.', 1);
      }
      return;
    }
    if (e.type === 'scheduled:fired') {
      const ev = e.event;
      const sim = ev.simId ? ctx.query.simMaybe(ev.simId) : undefined;
      if (!sim) return;
      if (ev.kind === '_le_layoff') {
        if (!sim.career.job) return;
        if (ctx.rng.chance(0.45)) {
          const job = sim.career.job;
          sim.career.history.push({ title: job.title, employer: job.employerName, from: job.startedAt, to: ctx.state.time.minute, reason: 'layoff' });
          sim.career.job = undefined;
          sim.career.unemployment = { weeklyBenefit: round2(Math.min(600, (job.annualSalary ?? (job.hourlyRate ?? 15) * 2080) / 52 * 0.5)), weeksLeft: 26, lastPaidAt: ctx.state.time.minute };
          sim.schedule = sim.schedule.filter((b) => b.kind !== 'work');
          ctx.emit({ type: 'career:fired', simId: sim.id, reason: 'layoff' });
          log(ctx, sim, `The meeting is short. ${your(ctx, sim)} position has been eliminated. Two weeks severance and a box for the desk.`, 3);
          fx(ctx, sim, { money: { amount: round2((job.annualSalary ?? (job.hourlyRate ?? 15) * 2080) / 26), memo: 'Severance', category: 'income' }, stress: 30, moodlets: [{ emotion: 'sad', label: 'Laid off', intensity: -18, durationMinutes: DAY * 5 }] }, 'layoff');
        } else {
          log(ctx, sim, `The restructuring lands on another team. ${your(ctx, sim)} job is safe, for now.`, 2);
          fx(ctx, sim, { stress: -8 }, 'layoff');
        }
      }
      if (ev.kind === '_le_trick_or_treat') {
        const hh = ctx.query.householdOf(sim.id);
        const candy = (hh?.pantry.chocolate ?? 0) + (hh?.pantry.snacks ?? 0) + (sim.inventory.consumables.chocolate ?? 0);
        if (atHome(ctx, sim)) {
          log(ctx, sim, candy ? 'Doorbell after doorbell. Ghosts, a dinosaur, three Spider-Men. The bowl is empty by eight.' : 'Trick-or-treaters, and nothing to give them. You turn off the porch light and feel like a villain.', 1);
          fx(ctx, sim, candy ? { needs: { fun: 14, social: 12 }, items: [{ op: 'lose', itemId: 'chocolate', qty: 1 }] } : { moodlets: [{ emotion: 'guilty', label: 'No candy for the kids', intensity: -4, durationMinutes: 480 }] }, 'halloween');
        }
      }
      if (ev.kind === 'party' && ev.payload?.kind === 'wedding') {
        const host = ctx.state.sims[String(ev.payload.host) as SimId];
        if (host) {
          log(ctx, sim, `${host.identity.firstName}'s wedding is today.`, 2);
          interrupt(ctx, sim, 'event', `${host.identity.firstName}'s wedding`, 'Today is the day. A gift is customary; showing up is what matters.', [{ label: 'Go (gift $100)', actionId: 'lifeEvents:attend_wedding', params: { hostId: host.id, gift: 100 } }, { label: 'Go, no gift', actionId: 'lifeEvents:attend_wedding', params: { hostId: host.id, gift: 0 } }, { label: 'Skip it', actionId: 'lifeEvents:skip_wedding', params: { hostId: host.id } }]);
        }
      }
    }
  },

  actions(ctx, simId) {
    const sim = ctx.query.sim(simId);
    const out: ActionDef[] = [];
    if (ctx.query.isControlled(simId) && sim.aspirations.filter((a) => !a.completed).length < 3) {
      out.push({ id: 'system:set_goal', label: 'Set a new goal', description: 'Write down something you want out of this life.', category: 'system', icon: '🎯', durationMinutes: 5, effects: {}, group: 'Life', params: { text: '' } });
    }
    return out;
  },

  handles(actionId) {
    return actionId.startsWith('lifeEvents:') || actionId === 'system:set_goal';
  },

  execute(ctx, simId, action, params): ActionResult {
    const sim = ctx.query.sim(simId);
    const now = ctx.state.time.minute;
    const npc = params.npcId ? ctx.state.sims[String(params.npcId) as SimId] : undefined;
    switch (action.id) {
      case 'system:set_goal': {
        const t = String(params.text ?? '').trim();
        if (!t) return { ok: false, text: 'Say what the goal is.' };
        sim.aspirations.push({ id: shortId(ctx.rng, 'asp'), text: t, category: 'adventure', progress: 0, completed: false, milestones: [{ text: 'Take the first step', done: false }, { text: 'Keep at it', done: false }, { text: 'Get there', done: false }] });
        return { ok: true, text: `New goal: ${t}.` };
      }
      case 'lifeEvents:claim_package': {
        ctx.schedule({ inMinutes: 5 * DAY, kind: 'delivery', label: 'Replacement package', simId, payload: { itemId: params.itemId, qty: params.qty, from: 'Replacement' } });
        return { ok: true, text: 'Claim filed. A replacement ships in a few days.' };
      }
      case 'lifeEvents:report_burglary':
        ctx.emit({ type: 'legal:police_called', venueId: sim.location.venueId, reason: 'burglary', simId });
        sim.flags['legal:reportFiled'] = now;
        return { ok: true, text: 'An officer comes by two hours later, takes photos, and gives you a case number for the insurance.', effects: { stress: -5 } };
      case 'lifeEvents:ask_quiet':
        return ctx.rng.chance(0.65) ? { ok: true, text: 'They apologize and turn it down. Mostly.', effects: { needs: { comfort: 8 }, skills: { charisma: 6 } } } : { ok: true, text: 'They say sure and turn it up ten minutes later.', effects: { stress: 6, moodlets: [{ emotion: 'angry', label: 'Neighbors', intensity: -5, durationMinutes: 300 }] } };
      case 'lifeEvents:noise_complaint':
        return { ok: true, text: 'A patrol car rolls by forty minutes later. The music stops. The neighbors know it was you.', effects: { needs: { comfort: 10 } } };
      case 'lifeEvents:join_bbq':
        return { ok: true, text: 'Two burgers, a beer that is not your usual, and an hour of small talk that turns into real talk.', effects: { needs: { hunger: 45, social: 30, fun: 20 }, relationships: npc ? [{ simId: npc.id, friendship: 12, familiarity: 15, trust: 5, mutual: true }] : undefined, memories: npc ? [{ kind: 'interaction', text: `Went to ${npc.identity.firstName}'s cookout.`, participants: [npc.id], salience: 45, valence: 0.6 }] : undefined }, durationMinutes: 90 };
      case 'lifeEvents:cancel_cards': {
        for (const a of sim.finance.accounts) if (a.kind === 'credit_card') a.frozen = true;
        ctx.schedule({ inMinutes: 5 * DAY, kind: '_le_new_cards', label: 'New cards arrive', simId });
        sim.legal.license.status = sim.legal.license.status === 'valid' ? 'expired' : sim.legal.license.status;
        return { ok: true, text: 'Twenty minutes on hold, three cards cancelled. New ones in five days. You will need a new license too.', effects: { stress: -6 } };
      }
      case 'lifeEvents:retrace_steps':
        return ctx.rng.chance(0.4) ? { ok: true, text: 'It was on the counter at the café. The barista kept it behind the register. Everything is still in it.', effects: { stress: -20, moodlets: [{ emotion: 'grateful', label: 'Wallet found', intensity: 10, durationMinutes: DAY }] }, durationMinutes: 60 } : { ok: true, text: 'Nothing. You cancel the cards from the car.', effects: { stress: 4 }, durationMinutes: 75 };
      case 'lifeEvents:troll_scammer':
        return { ok: true, text: 'You keep them on the line for eleven minutes asking which gift cards. They hang up on you.', effects: { needs: { fun: 12 }, moodlets: [{ emotion: 'playful', label: 'Wasted a scammer\'s time', intensity: 6, durationMinutes: 300 }] }, durationMinutes: 11 };
      case 'lifeEvents:fall_for_scam': {
        const amt = round2(Math.min(ctx.query.liquidCash(sim), ctx.rng.range(200, 900)));
        return { ok: true, text: `You read the numbers off the back of ${formatMoney(amt)} in gift cards. The line goes dead. It sinks in slowly.`, effects: { money: { amount: -amt, memo: 'Scam', category: 'misc' }, stress: 25, moodlets: [{ emotion: 'embarrassed', label: 'Got scammed', intensity: -14, durationMinutes: DAY * 3 }] }, durationMinutes: 40 };
      }
      case 'lifeEvents:dispute_charge': {
        const acc = sim.finance.accounts.find((a) => a.id === String(params.accountId));
        const amt = Number(params.amount ?? 0);
        if (acc) acc.balance = round2(Math.max(0, acc.balance - amt));
        return { ok: true, text: 'Disputed. Provisional credit posts tomorrow and a new card ships.', effects: { stress: -6 }, durationMinutes: 15 };
      }
      case 'lifeEvents:chip_in': {
        const amt = Number(params.amount ?? 20);
        const coworkers = sim.career.job?.coworkerSimIds ?? [];
        return { ok: true, text: amt >= 20 ? 'You put in a twenty and sign the card.' : 'You put in a five and sign the card small.', effects: { money: { amount: -amt, memo: 'Office collection', category: 'social' }, relationships: coworkers.slice(0, 3).map((id) => ({ simId: id, friendship: amt >= 20 ? 3 : 1, mutual: true })) } };
      }
      case 'lifeEvents:dodge_collection':
        return { ok: true, text: 'You suddenly need to be in a meeting.', effects: { relationships: (sim.career.job?.coworkerSimIds ?? []).slice(0, 2).map((id) => ({ simId: id, friendship: -2 })) } };
      case 'lifeEvents:cover_shift': {
        const job = sim.career.job;
        if (!job) return { ok: false };
        const hours = 8;
        const rate = (job.hourlyRate ?? 16) * 1.5;
        ctx.schedule({ inMinutes: DAY, kind: 'shift_start', label: 'Covering a shift', simId, payload: { extra: true, hours, rate } });
        job.performance = clamp(job.performance + 4, 0, 100);
        return { ok: true, text: `You take it. Eight hours tomorrow at ${formatMoney(rate)}/hr.`, effects: { moodlets: [{ emotion: 'proud', label: 'Team player', intensity: 4, durationMinutes: DAY }] } };
      }
      case 'lifeEvents:ignore_family':
        return { ok: true, text: 'You let it ring. A voicemail, then a text: "call me when you can."', effects: { relationships: npc ? [{ simId: npc.id, friendship: -2, trust: -1 }] : undefined, moodlets: [{ emotion: 'guilty', label: 'Didn\'t pick up', intensity: -3, durationMinutes: 300 }] } };
      case 'lifeEvents:host_friend': {
        if (npc) {
          const home = ctx.query.homeOf(simId);
          if (home) npc.location = { venueId: home.id, arrivedAt: now };
          ctx.schedule({ inMinutes: ctx.rng.int(3, 6) * DAY, kind: 'visitor', label: `${npc.identity.firstName} moves on`, simId, payload: { npcId: npc.id, leaving: true } });
        }
        return { ok: true, text: `${npc?.identity.firstName ?? 'They'} show up with a duffel bag and a bottle of wine as thanks. The couch is theirs for a while.`, effects: { relationships: npc ? [{ simId: npc.id, friendship: 10, trust: 12, mutual: true }] : undefined, needs: { social: 15, comfort: -6 } } };
      }
      case 'lifeEvents:decline_friend':
        return { ok: true, text: 'You say it is not a good time. They say they understand, in the way people do when they don\'t.', effects: { relationships: npc ? [{ simId: npc.id, friendship: -6, trust: -4 }] : undefined, moodlets: [{ emotion: 'guilty', label: 'Turned a friend away', intensity: -5, durationMinutes: DAY }] } };
      case 'lifeEvents:fix_phone':
        return { ok: true, text: 'A kiosk in the mall does it in an hour. Good as new, minus $180.', effects: { money: { amount: -180, memo: 'Phone screen repair', category: 'misc' } }, durationMinutes: 60 };
      case 'lifeEvents:live_with_crack':
        sim.flags['phone:cracked'] = true;
        return { ok: true, text: 'It is a texture now. You stop noticing after a week.', effects: { moodlets: [{ emotion: 'uncomfortable', label: 'Cracked screen', intensity: -2, durationMinutes: DAY * 7 }] } };
      case 'lifeEvents:pickup_sick_kid': {
        const kid = ctx.state.sims[String(params.kidId) as SimId];
        const school = ctx.query.nearestVenue(sim.location.venueId, 'school');
        if (kid && school) {
          const home = ctx.query.homeOf(simId);
          if (home) kid.location = { venueId: home.id, arrivedAt: now + 40 };
        }
        if (sim.career.job) ctx.emit({ type: 'career:late', simId, minutes: 90 });
        return { ok: true, text: `${kid?.identity.firstName ?? 'Your kid'} is pale and quiet in the nurse's office. Home, crackers, cartoons.`, effects: { relationships: kid ? [{ simId: kid.id, trust: 4, friendship: 3, mutual: true }] : undefined, skills: { parenting: 12 }, stress: 8 }, durationMinutes: 90 };
      }
      case 'lifeEvents:delegate_pickup':
        return { ok: true, text: 'A few frantic texts and someone else can get there. You owe them.', effects: { stress: 6 } };
      case 'lifeEvents:field_trip':
        return { ok: true, text: 'Signed, and fifteen dollars in an envelope in the backpack.', effects: { money: { amount: -15, memo: 'Field trip', category: 'childcare' }, relationships: params.kidId ? [{ simId: String(params.kidId) as SimId, friendship: 4, mutual: true }] : undefined } };
      case 'lifeEvents:no_field_trip':
        return { ok: true, text: 'Not this time. The sulking lasts through dinner.', effects: { relationships: params.kidId ? [{ simId: String(params.kidId) as SimId, friendship: -5 }] : undefined } };
      case 'lifeEvents:buy_cookies': {
        const boxes = Number(params.boxes ?? 1);
        return { ok: true, text: boxes > 1 ? 'Two boxes. They will be gone by Thursday.' : 'One box, to be reasonable.', effects: { money: { amount: -6 * boxes, memo: 'Girl Scout cookies', category: 'food' }, items: [{ op: 'gain', itemId: 'cookies', qty: boxes }], moodlets: [{ emotion: 'happy', label: 'Thin Mints', intensity: 4, durationMinutes: 480 }] } };
      }
      case 'lifeEvents:adopt_stray': {
        const hh = ctx.query.householdOf(simId);
        if (!hh) return { ok: false };
        ctx.emit({ type: 'custom', kind: 'pet:adopt', simId, payload: { source: 'stray', species: 'cat', breed: 'Orange tabby (stray)', name: ctx.rng.pick(['Cheeto', 'Marmalade', 'Biscuit', 'Tang', 'Nacho']) } });
        return { ok: true, text: 'It walks in like it has always lived here.', effects: { moodlets: [{ emotion: 'happy', label: 'New cat', intensity: 8, durationMinutes: DAY * 2 }] } };
      }
      case 'lifeEvents:attend_wedding': {
        const host = ctx.state.sims[String(params.hostId) as SimId];
        const gift = Number(params.gift ?? 0);
        return { ok: true, text: 'Vows, a long toast, a dance floor that fills up at the third song. You stay later than planned.', effects: { money: gift ? { amount: -gift, memo: 'Wedding gift', category: 'social' } : undefined, needs: { fun: 35, social: 40, energy: -30, hunger: 30 }, bloodAlcohol: 0.04, relationships: host ? [{ simId: host.id, friendship: gift ? 12 : 8, familiarity: 6, mutual: true }] : undefined, moodlets: [{ emotion: 'happy', label: 'A good wedding', intensity: 10, durationMinutes: DAY * 2 }], memories: host ? [{ kind: 'milestone', text: `Went to ${host.identity.firstName}'s wedding.`, participants: [host.id], salience: 70, valence: 0.8 }] : undefined }, durationMinutes: 330 };
      }
      case 'lifeEvents:skip_wedding': {
        const host = ctx.state.sims[String(params.hostId) as SimId];
        return { ok: true, text: 'You send a text with a heart in it and stay home.', effects: { relationships: host ? [{ simId: host.id, friendship: -10, trust: -5 }] : undefined, moodlets: [{ emotion: 'guilty', label: 'Missed the wedding', intensity: -6, durationMinutes: DAY * 2 }] } };
      }
      case 'lifeEvents:ack':
      default:
        return { ok: true };
    }
  },
};

export const LIFE_EVENT_IDS = EVENTS.map((e) => e.id);
