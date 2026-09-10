/**
 * Amenities system — utilities (electric/gas/water/internet/trash/phone/streaming), service cuts,
 * mail delivery, package deliveries, household trash, and phone battery/plan.
 *
 * Utility bills are pushed onto the head-of-household's `sim.finance.bills` with id `util:<kind>`;
 * finance pays them. Two missed cycles → `amenity:cut`. A cut service sets the home venue tag
 * `no_<kind>` and marks objects whose def `requiresUtility` matches with `state.on = false` and
 * `state.custom.noPower / noWater / noInternet = true` (the needs/entertainment systems may read those).
 * Paying the past-due bill (finance `money:bill_paid`) restores it (`amenity:restored`, $50 reconnection).
 *
 * Custom effect kinds handled: `amenity:check_mail`, `amenity:mail {from, subject, body, kind, amount?, actionId?}`,
 * `chore:trash`, `amenity:charge_phone`.
 * Scheduled kinds owned: `delivery` (when payload.handler === 'amenities' or payload.packageId is set).
 */
import type { GameEvent } from '../core/events';
import { shortId } from '../core/ids';
import type { System, SystemContext } from '../core/systems';
import type { ActionDef, Household, HouseholdId, ItemId, RecurringBill, Requirement, Residence, Sim, SimId, UtilityAccount, Venue } from '../core/types';
import { DAY, clamp100, formatMoney, round2 } from '../core/util';

type Ctx = SystemContext;
type UtilityKind = UtilityAccount['kind'];

export const RECONNECT_FEE = 50;
export const PHONE_DRAIN_PER_HOUR = 4;
export const PHONE_CHARGE_PER_HOUR = 15;
export const MAIL_HOUR = 14;

const UTILITY_BASE: Record<Exclude<UtilityKind, 'insurance_renters' | 'insurance_home' | 'phone'>, { provider: string; base: number; due: number }> = {
  electric: { provider: 'City Power & Light', base: 95, due: 15 },
  gas: { provider: 'Regional Gas Co.', base: 45, due: 15 },
  water: { provider: 'Municipal Water', base: 40, due: 18 },
  internet: { provider: 'Spectrum', base: 70, due: 10 },
  trash: { provider: 'Waste Management', base: 25, due: 12 },
  streaming: { provider: 'Netflix', base: 15.99, due: 8 },
};

const HOT_CLIMATES = new Set(['humid_subtropical', 'hot_desert', 'tropical', 'semi_arid']);
const COLD_CLIMATES = new Set(['humid_continental', 'subarctic', 'marine_west_coast']);

/** fallback perishables when the items catalog has no perishDays */
const PERISHABLE_FALLBACK = new Set(['eggs', 'milk', 'chicken', 'beef', 'ground_beef', 'fish', 'shrimp', 'tofu', 'vegetables', 'salad_greens', 'fruit', 'cheese', 'butter', 'yogurt', 'ice_cream', 'frozen_pizza', 'leftovers', 'meal_basic', 'meal_good', 'meal_gourmet', 'takeout_meal', 'sandwich', 'smoothie', 'restaurant_meal', 'fast_food_meal']);

const JUNK_MAIL = [
  { from: 'Valpak', subject: 'Local savings inside!', body: 'Coupons for a car wash, two pizza places and a dentist you will never visit.' },
  { from: 'Capital One', subject: "You're pre-approved!", body: 'A shiny credit card offer with a 29.99% APR in six-point type.' },
  { from: 'Spectrum', subject: 'Switch and save', body: 'The same internet you already have, advertised as new.' },
  { from: 'AARP', subject: 'Your membership card is waiting', body: 'Apparently they think you are 50.' },
  { from: 'Local realtor', subject: 'Thinking of selling?', body: 'A glossy postcard with a stranger\'s headshot.' },
  { from: 'Extended vehicle warranty', subject: 'FINAL NOTICE', body: 'Your vehicle\'s warranty is about to expire. It never had one.' },
  { from: 'Neighborhood pizza', subject: '2 large for $19.99', body: 'A menu. You keep it. You always keep it.' },
  { from: 'Solar Solutions', subject: 'Cut your electric bill by 80%', body: 'A door-hanger promising the sun.' },
];

const LETTER_TEMPLATES = [
  'Hey — found this postcard and thought of you. Things are fine here. Call me sometime, {name}.',
  'Just a note to say hi. Work is work. Miss hanging out. — {name}',
  'Sending this the old-fashioned way. Happy belated whatever-it-was. Love, {name}',
  'Enclosed: a photo from that night. You look terrible and happy. — {name}',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function upsertBill(sim: Sim, bill: Omit<RecurringBill, 'missed'> & { missed?: number }): RecurringBill {
  const ex = sim.finance.bills.find((b) => b.id === bill.id);
  if (ex) {
    ex.name = bill.name;
    ex.amount = round2(bill.amount);
    ex.dueDayOfMonth = bill.dueDayOfMonth;
    ex.category = bill.category;
    ex.linkedId = bill.linkedId;
    return ex;
  }
  const b: RecurringBill = { missed: 0, ...bill, amount: round2(bill.amount) };
  sim.finance.bills.push(b);
  return b;
}

function dropBill(sim: Sim, id: string): void {
  sim.finance.bills = sim.finance.bills.filter((b) => b.id !== id);
  delete sim.flags[`bill_due:${id}`];
  delete sim.flags[`bill_arrears:${id}`];
  delete sim.flags[`bill_paid_month:${id}`];
}

function headOfHousehold(ctx: Ctx, hh: Household): Sim | undefined {
  const alive = hh.simIds.filter((id) => ctx.state.sims[id]?.body.alive);
  const controlled = alive.find((id) => ctx.query.isControlled(id));
  return ctx.state.sims[controlled ?? alive[0]];
}

function activeHouseholds(ctx: Ctx): Household[] {
  const out: Household[] = [];
  const seen = new Set<string>();
  const add = (h?: Household) => {
    if (h && !seen.has(h.id)) {
      seen.add(h.id);
      out.push(h);
    }
  };
  add(ctx.state.households[ctx.state.player.householdId]);
  for (const s of ctx.query.simulatedSims()) if (s.lod === 'full') add(ctx.query.householdOf(s.id));
  return out;
}

function notify(ctx: Ctx, sim: Sim, title: string, body: string, actionId?: string, app = 'home'): void {
  sim.phone.notifications.push({ id: shortId(ctx.rng, 'ntf'), at: ctx.state.time.minute, app, title, body, read: false, actionId });
  if (sim.phone.notifications.length > 60) sim.phone.notifications.splice(0, sim.phone.notifications.length - 60);
  ctx.emit({ type: 'phone:notification', simId: sim.id, app, title, body });
}

function you(ctx: Ctx, sim: Sim): string {
  return ctx.query.isControlled(sim.id) ? 'You' : sim.identity.firstName;
}

function seasonalElectric(ctx: Ctx): number {
  const s = ctx.clock.season;
  const climate = ctx.state.region.climate;
  if (s === 'summer' && HOT_CLIMATES.has(climate)) return 1.4;
  if (s === 'summer') return 1.15;
  if (s === 'winter' && COLD_CLIMATES.has(climate)) return 1.3;
  if (s === 'winter') return 1.1;
  return 1;
}

function utilityCost(ctx: Ctx, kind: UtilityKind, res: Residence): number {
  const col = ctx.state.region.costOfLiving;
  const sizeFactor = Math.pow(Math.max(200, res.sqft) / 850, 0.55);
  const isHouse = res.kind === 'house' || res.kind === 'townhouse' || res.kind === 'mobile_home';
  switch (kind) {
    case 'electric':
      return round2(UTILITY_BASE.electric.base * sizeFactor * col * seasonalElectric(ctx));
    case 'gas': {
      const winter = ctx.clock.season === 'winter' ? (COLD_CLIMATES.has(ctx.state.region.climate) ? 1.8 : 1.3) : 1;
      return round2(UTILITY_BASE.gas.base * sizeFactor * col * winter);
    }
    case 'water':
      return round2((isHouse ? UTILITY_BASE.water.base : 25) * col);
    case 'internet':
      return round2(UTILITY_BASE.internet.base * (col > 1.2 ? 1.1 : 1));
    case 'trash':
      return round2(UTILITY_BASE.trash.base * col);
    case 'streaming':
      return UTILITY_BASE.streaming.base;
    default:
      return 0;
  }
}

function utilityKindsFor(res: Residence): UtilityKind[] {
  if (res.tenure === 'shelter' || res.kind === 'dorm') return [];
  const isHouse = res.kind === 'house' || res.kind === 'townhouse' || res.kind === 'mobile_home';
  const kinds: UtilityKind[] = ['electric', 'water', 'internet', 'streaming'];
  if (isHouse) kinds.push('gas', 'trash');
  return kinds;
}

/** Create/refresh utility accounts + bills for a household's home. */
function ensureUtilities(ctx: Ctx, hh: Household): void {
  const home = ctx.state.venues[hh.homeVenueId];
  const res = home?.residence;
  const head = headOfHousehold(ctx, hh);
  if (!home || !res || !head) return;
  const wanted = utilityKindsFor(res);
  // remove utilities that no longer apply
  res.utilities = res.utilities.filter((u) => wanted.includes(u.kind) || u.kind === 'insurance_renters' || u.kind === 'insurance_home' || u.kind === 'phone');
  for (const id of hh.simIds) {
    const s = ctx.state.sims[id];
    if (!s) continue;
    for (const b of [...s.finance.bills]) {
      if (!b.id.startsWith('util:')) continue;
      const kind = b.id.slice(5) as UtilityKind;
      if (s.id !== head.id || !wanted.includes(kind) || b.linkedId !== home.id) dropBill(s, b.id);
    }
  }
  for (const kind of wanted) {
    const base = UTILITY_BASE[kind as keyof typeof UTILITY_BASE];
    if (!base) continue;
    let u = res.utilities.find((x) => x.kind === kind);
    const cost = utilityCost(ctx, kind, res);
    if (!u) {
      u = { kind, provider: base.provider, monthlyCost: cost, active: true, unpaidCycles: 0, dueDayOfMonth: base.due };
      res.utilities.push(u);
    } else u.monthlyCost = cost;
    const existing = head.finance.bills.find((b) => b.id === `util:${kind}`);
    upsertBill(head, { id: `util:${kind}`, name: `${u.provider} (${kind})`, amount: cost, dueDayOfMonth: u.dueDayOfMonth, category: kind === 'streaming' ? 'subscription' : 'utility', autopay: existing?.autopay ?? kind === 'streaming', linkedId: home.id });
  }
  // phone plans are per sim
  for (const id of hh.simIds) {
    const s = ctx.state.sims[id];
    if (!s || s.lifeStage === 'infant' || s.lifeStage === 'toddler' || s.lifeStage === 'child') continue;
    if (s.phone.plan.monthly > 0) {
      const existing = s.finance.bills.find((b) => b.id === 'phone_plan');
      upsertBill(s, { id: 'phone_plan', name: `${s.phone.plan.provider} phone plan`, amount: s.phone.plan.monthly, dueDayOfMonth: 20, category: 'phone', autopay: existing?.autopay ?? true, linkedId: 'phone' });
    }
  }
}

function objectsRequiring(ctx: Ctx, venue: Venue, kind: UtilityKind) {
  return ctx.query.objectsAt(venue.id).filter((o) => ctx.content.objects[o.defId]?.requiresUtility === kind);
}

function customFlagFor(kind: UtilityKind): string {
  return kind === 'electric' ? 'noPower' : kind === 'water' ? 'noWater' : kind === 'internet' ? 'noInternet' : kind === 'gas' ? 'noGas' : `no_${kind}`;
}

function isPerishable(ctx: Ctx, itemId: ItemId): boolean {
  const def = ctx.content.items[itemId];
  if (def) return def.perishDays !== undefined && def.perishDays <= 21;
  return PERISHABLE_FALLBACK.has(itemId);
}

function cutUtility(ctx: Ctx, hh: Household, kind: UtilityKind): void {
  const home = ctx.state.venues[hh.homeVenueId];
  const u = home?.residence?.utilities.find((x) => x.kind === kind);
  if (!home || !u || !u.active) return;
  u.active = false;
  const tag = `no_${kind}`;
  if (!home.tags.includes(tag)) home.tags.push(tag);
  const flag = customFlagFor(kind);
  for (const o of objectsRequiring(ctx, home, kind)) {
    o.state.on = false;
    o.state.custom = { ...(o.state.custom ?? {}), [flag]: true };
  }
  if (kind === 'electric') {
    const spoiled = Object.keys(hh.pantry).filter((id) => isPerishable(ctx, id));
    for (const id of spoiled) delete hh.pantry[id];
    if (spoiled.length) ctx.log({ text: `With the power off, everything in the fridge spoils (${spoiled.map((s) => s.replace(/_/g, ' ')).join(', ')}).`, kind: 'alert', importance: 2, venueId: home.id });
  }
  ctx.emit({ type: 'amenity:cut', householdId: hh.id, kind });
  const head = headOfHousehold(ctx, hh);
  ctx.log({ text: `${u.provider} shut off the ${kind} at ${home.name} for non-payment.`, kind: 'alert', simId: head?.id, importance: 3, venueId: home.id });
  if (head) notify(ctx, head, `${kind[0].toUpperCase()}${kind.slice(1)} disconnected`, `Pay the past-due balance plus a ${formatMoney(RECONNECT_FEE)} reconnection fee to restore service.`, `phone:bank:pay_bill:util:${kind}`);
  for (const s of ctx.query.simsAt(home.id)) ctx.applyEffects(s.id, { moodlets: [{ id: `cut_${kind}`, emotion: 'stressed', label: `No ${kind}`, intensity: -12, durationMinutes: 3 * DAY }], stress: 8 }, 'amenities:cut');
}

function restoreUtility(ctx: Ctx, hh: Household, kind: UtilityKind): void {
  const home = ctx.state.venues[hh.homeVenueId];
  const u = home?.residence?.utilities.find((x) => x.kind === kind);
  if (!home || !u) return;
  u.unpaidCycles = 0;
  if (u.active) return;
  u.active = true;
  home.tags = home.tags.filter((t) => t !== `no_${kind}`);
  const flag = customFlagFor(kind);
  for (const o of objectsRequiring(ctx, home, kind)) if (o.state.custom) delete o.state.custom[flag];
  const head = headOfHousehold(ctx, hh);
  if (head) ctx.applyEffects(head.id, { money: { amount: -RECONNECT_FEE, memo: `${u.provider} reconnection fee`, category: 'utility' } }, 'amenities:reconnect');
  ctx.emit({ type: 'amenity:restored', householdId: hh.id, kind });
  ctx.log({ text: `${u.provider} restored the ${kind} at ${home.name}.`, kind: 'event', simId: head?.id, importance: 2, venueId: home.id });
  for (const s of ctx.query.simsAt(home.id)) s.mind.moodlets = s.mind.moodlets.filter((m) => m.id !== `cut_${kind}`);
}

// ---------------------------------------------------------------------------
// Mail & packages
// ---------------------------------------------------------------------------
function pushMail(ctx: Ctx, hh: Household, m: { from: string; subject: string; body: string; kind: Household['mail'][number]['kind']; amount?: number; actionId?: string }): string {
  const id = shortId(ctx.rng, 'mail');
  hh.mail.push({ id, at: ctx.state.time.minute, read: false, ...m });
  if (hh.mail.length > 60) hh.mail.splice(0, hh.mail.length - 60);
  ctx.emit({ type: 'amenity:mail', householdId: hh.id, mailId: id });
  return id;
}

function billDueInDays(ctx: Ctx, bill: RecurringBill): number {
  const c = ctx.clock.day;
  const today = c.day;
  const lastDay = new Date(Date.UTC(c.year, c.month, 0)).getUTCDate();
  const due = Math.min(bill.dueDayOfMonth, lastDay);
  if (due >= today) return due - today;
  const nextLast = new Date(Date.UTC(c.year, c.month + 1, 0)).getUTCDate();
  return lastDay - today + Math.min(bill.dueDayOfMonth, nextLast);
}

function deliverMail(ctx: Ctx, hh: Household): void {
  const c = ctx.clock.day;
  if (c.weekday === 0) return; // no Sunday mail
  const monthKey = c.year * 12 + c.month;
  let delivered = 0;
  for (const id of hh.simIds) {
    const s = ctx.state.sims[id];
    if (!s) continue;
    for (const b of s.finance.bills) {
      if (b.category === 'subscription' || b.category === 'phone') continue; // paperless
      const days = billDueInDays(ctx, b);
      if (days > 10 || s.flags[`mailed:${b.id}`] === monthKey) continue;
      s.flags[`mailed:${b.id}`] = monthKey;
      const arrears = Number(s.flags[`bill_arrears:${b.id}`] ?? 0);
      pushMail(ctx, hh, { from: b.name.split(' (')[0], subject: `${b.name}: ${formatMoney(b.amount + arrears)} due ${days === 0 ? 'today' : `in ${days} days`}`, body: `${arrears ? `PAST DUE ${formatMoney(arrears)}. ` : ''}Statement for ${b.name}. Amount due ${formatMoney(b.amount + arrears)}.${b.autopay ? ' Autopay is on.' : ''}`, kind: 'bill', amount: round2(b.amount + arrears), actionId: `phone:bank:pay_bill:${b.id}` });
      delivered++;
    }
  }
  if (ctx.rng.chance(0.4)) {
    pushMail(ctx, hh, { ...ctx.rng.pick(JUNK_MAIL), kind: 'junk' });
    delivered++;
  }
  // a rare letter from a friend
  const head = headOfHousehold(ctx, hh);
  if (head && ctx.rng.chance(0.02)) {
    const friends = Object.values(head.relationships).filter((r) => r.friendship > 40 && ctx.state.sims[r.simId]);
    if (friends.length) {
      const f = ctx.state.sims[ctx.rng.pick(friends).simId]!;
      pushMail(ctx, hh, { from: `${f.identity.firstName} ${f.identity.lastName}`, subject: 'A letter', body: ctx.rng.pick(LETTER_TEMPLATES).replace('{name}', f.identity.firstName), kind: 'letter' });
      delivered++;
    }
  }
  if (delivered > 0) {
    for (const id of hh.simIds) {
      const s = ctx.state.sims[id];
      if (s && ctx.query.isControlled(s.id) && s.phone.apps.includes('messages')) notify(ctx, s, 'Mail delivered', `${delivered} item${delivered > 1 ? 's' : ''} in the mailbox.`, 'amenity:check_mail', 'usps');
    }
  }
}

function readMail(ctx: Ctx, sim: Sim, hh: Household): string {
  const unread = hh.mail.filter((m) => !m.read);
  if (!unread.length) return 'Nothing but the mailbox spider.';
  const lines: string[] = [];
  for (const m of unread) {
    m.read = true;
    if (m.kind === 'check' && m.amount && m.amount > 0) {
      ctx.applyEffects(sim.id, { money: { amount: m.amount, memo: `Check from ${m.from}`, category: 'income', account: 'checking' } }, 'amenities:mail');
      lines.push(`• A check from ${m.from} for ${formatMoney(m.amount)} — deposited.`);
    } else if (m.kind === 'junk') lines.push(`• Junk: ${m.subject}`);
    else lines.push(`• ${m.from}: ${m.subject}${m.amount ? ` (${formatMoney(m.amount)})` : ''} — ${m.body}`);
    if (m.kind === 'summons' || m.kind === 'notice') ctx.applyEffects(sim.id, { stress: 3 }, 'amenities:mail');
  }
  hh.mail = hh.mail.filter((m) => !m.read || m.kind !== 'junk');
  ctx.log({ text: `${you(ctx, sim)} check${ctx.query.isControlled(sim.id) ? '' : 's'} the mail: ${unread.length} item${unread.length > 1 ? 's' : ''}.`, kind: 'narrative', simId: sim.id, importance: 0 });
  return lines.join('\n');
}

function deliverPackage(ctx: Ctx, hh: Household, packageId: string, simId?: SimId): void {
  const idx = hh.packages.findIndex((p) => p.id === packageId);
  if (idx < 0) return;
  const pkg = hh.packages[idx];
  hh.packages.splice(idx, 1);
  const home = ctx.state.venues[hh.homeVenueId];
  const present = home ? ctx.query.simsAt(home.id).filter((s) => hh.simIds.includes(s.id)) : [];
  const crime = ctx.state.region.crimeIndex;
  if (!present.length && crime > 0.45 && ctx.rng.chance((crime - 0.4) * 0.5)) {
    ctx.log({ text: `Your package from ${pkg.from} (${pkg.qty} × ${pkg.itemId.replace(/_/g, ' ')}) was delivered to the porch and stolen before you got home.`, kind: 'alert', simId, importance: 2, venueId: home?.id });
    ctx.emit({ type: 'legal:police_called', venueId: hh.homeVenueId, reason: 'package theft', simId });
    return;
  }
  const def = ctx.content.items[pkg.itemId];
  const foodish = def ? def.category === 'food' || def.category === 'ingredient' || def.category === 'drink' : PERISHABLE_FALLBACK.has(pkg.itemId);
  const recipient = (simId && ctx.state.sims[simId]) || headOfHousehold(ctx, hh);
  if (foodish || !recipient) hh.pantry[pkg.itemId] = (hh.pantry[pkg.itemId] ?? 0) + pkg.qty;
  else recipient.inventory.consumables[pkg.itemId] = (recipient.inventory.consumables[pkg.itemId] ?? 0) + pkg.qty;
  ctx.emit({ type: 'amenity:package', householdId: hh.id, itemId: pkg.itemId, qty: pkg.qty });
  const label = `${pkg.qty} × ${def?.name ?? pkg.itemId.replace(/_/g, ' ')}`;
  ctx.log({ text: `Package delivered from ${pkg.from}: ${label}.`, kind: 'event', simId: recipient?.id, importance: 1, venueId: home?.id });
  const controlledHere = present.find((s) => ctx.query.isControlled(s.id));
  if (controlledHere) ctx.interrupt({ kind: 'delivery', title: 'Delivery', body: `A driver drops a package at the door: ${label} from ${pkg.from}.`, simId: controlledHere.id, options: [] });
  else if (recipient && ctx.query.isControlled(recipient.id)) notify(ctx, recipient, 'Package delivered', `${label} from ${pkg.from} is at your door.`, undefined, 'delivery');
}

// ---------------------------------------------------------------------------
// Trash & phone
// ---------------------------------------------------------------------------
function dailyTrash(ctx: Ctx, hh: Household): void {
  const home = ctx.state.venues[hh.homeVenueId];
  if (!home) return;
  let trash = hh.chores.find((c) => c.id === 'trash');
  if (!trash) {
    trash = { id: 'trash', label: 'Take out the trash', dirtiness: 20 };
    hh.chores.push(trash);
  }
  const key = `trash_days:${hh.id}`;
  if (trash.dirtiness > 100) {
    const days = Number(ctx.state.flags[key] ?? 0) + 1;
    ctx.state.flags[key] = days;
    if (days >= 3) {
      home.cleanliness = clamp100(home.cleanliness - 2);
      for (const s of ctx.query.simsAt(home.id)) ctx.applyEffects(s.id, { moodlets: [{ id: 'smelly_trash', emotion: 'uncomfortable', label: 'Overflowing trash', intensity: -6, durationMinutes: DAY }] }, 'amenities:trash');
      if (days === 3) ctx.log({ text: `The trash at ${home.name} is overflowing and starting to smell.`, kind: 'need', importance: 1, venueId: home.id });
    }
  } else delete ctx.state.flags[key];
}

function takeOutTrash(ctx: Ctx, hh: Household): void {
  const trash = hh.chores.find((c) => c.id === 'trash');
  if (trash) trash.dirtiness = 0;
  delete ctx.state.flags[`trash_days:${hh.id}`];
  const home = ctx.state.venues[hh.homeVenueId];
  if (home) {
    home.cleanliness = clamp100(home.cleanliness + 3);
    for (const s of ctx.query.simsAt(home.id)) s.mind.moodlets = s.mind.moodlets.filter((m) => m.id !== 'smelly_trash');
  }
}

function tickPhones(ctx: Ctx, hours: number): void {
  for (const sim of ctx.query.simulatedSims()) {
    if (sim.lod !== 'full') continue;
    const home = ctx.query.homeOf(sim.id);
    const atHome = !!home && sim.location.venueId === home.id && !sim.travel;
    const sleeping = !!sim.currentAction && /sleep|nap/i.test(sim.currentAction.actionId + sim.currentAction.label);
    const hour = ctx.clock.hour;
    const overnight = hour >= 22 || hour < 7;
    const charging = (atHome && (overnight || sleeping)) || sim.flags.phone_charging === true;
    const before = sim.phone.battery;
    if (charging) sim.phone.battery = clamp100(sim.phone.battery + PHONE_CHARGE_PER_HOUR * hours);
    else sim.phone.battery = clamp100(sim.phone.battery - PHONE_DRAIN_PER_HOUR * hours * (sleeping ? 0.25 : 1));
    if (sim.flags.phone_charging && !atHome) delete sim.flags.phone_charging;
    if (sim.phone.battery <= 0 && !sim.flags.phone_dead) {
      sim.flags.phone_dead = true;
      if (ctx.query.isControlled(sim.id)) ctx.log({ text: 'Your phone dies.', kind: 'phone', simId: sim.id, importance: 1 });
    } else if (sim.phone.battery >= 8 && sim.flags.phone_dead) {
      delete sim.flags.phone_dead;
      if (ctx.query.isControlled(sim.id) && before < 8) ctx.log({ text: 'Your phone has enough charge to turn on again.', kind: 'phone', simId: sim.id, importance: 0 });
    } else if (sim.phone.battery <= 10 && before > 10 && ctx.query.isControlled(sim.id)) ctx.log({ text: 'Low battery: 10%.', kind: 'phone', simId: sim.id, importance: 0 });
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function act(id: string, label: string, category: ActionDef['category'], minutes: number, extra: Partial<ActionDef> = {}): ActionDef {
  return { id, label, category, durationMinutes: minutes, effects: {}, interruptible: true, ...extra };
}

function amenityActions(ctx: Ctx, simId: SimId): ActionDef[] {
  const sim = ctx.query.sim(simId);
  const hh = ctx.query.householdOf(simId);
  if (!hh) return [];
  const home = ctx.state.venues[hh.homeVenueId];
  if (!home || sim.location.venueId !== home.id) return [];
  const out: ActionDef[] = [];
  const unread = hh.mail.filter((m) => !m.read).length;
  if (unread > 0) out.push(act('amenity:check_mail', `Check the mail (${unread})`, 'chores', 5, { group: 'Home', icon: 'mail', autonomyWeight: 0.3 }));
  const trash = hh.chores.find((c) => c.id === 'trash');
  if (trash && trash.dirtiness >= 60) out.push(act('amenity:take_out_trash', 'Take out the trash', 'chores', 8, { group: 'Chores', effects: { needs: { comfort: -1 } }, autonomyWeight: trash.dirtiness / 120 }));
  if (sim.phone.battery < 90 && !sim.flags.phone_charging) {
    const charger = ctx.query.findObject(home.id, 'phone_charger') || (sim.inventory.consumables.phone_charger ?? 0) > 0 || home.residence !== undefined;
    if (charger) out.push(act('amenity:charge_phone', 'Plug in your phone', 'chores', 1, { group: 'Home', icon: 'battery' }));
  }
  const cut = home.residence?.utilities.filter((u) => !u.active) ?? [];
  const head = headOfHousehold(ctx, hh);
  for (const u of cut) {
    const bill = head?.finance.bills.find((b) => b.id === `util:${u.kind}`);
    const owed = round2(Number(head?.flags[`bill_arrears:util:${u.kind}`] ?? 0) + (head?.flags[`bill_due:util:${u.kind}`] !== undefined ? bill?.amount ?? 0 : 0));
    if (head && bill && owed > 0) out.push(act(`amenity:reconnect:${u.kind}`, `Pay ${u.provider} to restore ${u.kind} (${formatMoney(owed + RECONNECT_FEE)})`, 'finance', 5, { group: 'Home', requirements: [{ kind: 'money', reason: `Need ${formatMoney(owed + RECONNECT_FEE)}`, params: { amount: owed + RECONNECT_FEE, noCredit: true } } as Requirement], params: { owed } }));
  }
  return out;
}

function executeAmenity(ctx: Ctx, simId: SimId, action: ActionDef): { ok: boolean; text?: string; effects?: ActionDef['effects'] } {
  const sim = ctx.query.sim(simId);
  const hh = ctx.query.householdOf(simId);
  if (!hh) return { ok: false, text: 'No household.' };
  const op = action.id.split(':')[1];
  switch (op) {
    case 'check_mail':
      return { ok: true, text: readMail(ctx, sim, hh) };
    case 'take_out_trash':
      takeOutTrash(ctx, hh);
      return { ok: true, text: 'Bag tied, bin at the curb.' };
    case 'charge_phone':
      sim.flags.phone_charging = true;
      return { ok: true, text: 'Phone plugged in. It charges while you are home.' };
    case 'reconnect': {
      const kind = action.id.split(':')[2] as UtilityKind;
      const head = headOfHousehold(ctx, hh);
      const bill = head?.finance.bills.find((b) => b.id === `util:${kind}`);
      if (!head || !bill) return { ok: false, text: 'No such account.' };
      // delegate to finance: paying the bill (due + arrears) fires money:bill_paid → restoreUtility (which charges the reconnection fee)
      ctx.emit({ type: 'custom', kind: 'finance:charge', simId: head.id, payload: { amount: Number(action.params?.owed ?? 0), memo: `${bill.name} past due`, category: 'utility' } });
      delete head.flags[`bill_arrears:util:${kind}`];
      delete head.flags[`bill_due:util:${kind}`];
      bill.lastPaidAt = ctx.state.time.minute;
      ctx.emit({ type: 'money:bill_paid', simId: head.id, billId: bill.id, amount: Number(action.params?.owed ?? 0) });
      return { ok: true, text: `Paid. ${bill.name} will be back on shortly.` };
    }
    default:
      return { ok: false, text: `Unknown amenity action ${op}` };
  }
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------
export const amenitiesSystem: System = {
  id: 'amenities',
  intervalMinutes: 60,

  onInit(ctx) {
    for (const hh of activeHouseholds(ctx)) ensureUtilities(ctx, hh);
  },

  onTick(ctx, dt) {
    tickPhones(ctx, Math.max(1, dt) / 60);
    const today = Math.floor(ctx.state.time.minute / DAY);
    if (ctx.clock.hour >= MAIL_HOUR && ctx.state.flags.mail_day !== today) {
      ctx.state.flags.mail_day = today;
      for (const hh of activeHouseholds(ctx)) deliverMail(ctx, hh);
    }
  },

  onEvent(ctx, event: GameEvent) {
    switch (event.type) {
      case 'time:day':
        for (const hh of activeHouseholds(ctx)) dailyTrash(ctx, hh);
        break;
      case 'time:month':
        for (const hh of activeHouseholds(ctx)) ensureUtilities(ctx, hh);
        break;
      case 'property:moved': {
        const hh = ctx.state.households[event.householdId as HouseholdId];
        if (!hh) break;
        // strip bills tied to the previous home, then create the new ones
        for (const id of hh.simIds) {
          const s = ctx.state.sims[id];
          if (s) for (const b of [...s.finance.bills]) if (b.id.startsWith('util:') && b.linkedId === event.from) dropBill(s, b.id);
        }
        ensureUtilities(ctx, hh);
        break;
      }
      case 'family:moved_in': {
        const hh = ctx.state.households[event.householdId as HouseholdId];
        if (hh) ensureUtilities(ctx, hh);
        break;
      }
      case 'money:bill_missed': {
        const sim = ctx.state.sims[event.simId];
        const hh = sim && ctx.query.householdOf(sim.id);
        if (!sim || !hh) break;
        if (event.billId.startsWith('util:')) {
          const kind = event.billId.slice(5) as UtilityKind;
          const u = ctx.state.venues[hh.homeVenueId]?.residence?.utilities.find((x) => x.kind === kind);
          if (!u) break;
          u.unpaidCycles += 1;
          if (u.unpaidCycles >= 2) cutUtility(ctx, hh, kind);
          else notify(ctx, sim, `${u.provider}: disconnection warning`, `Your ${kind} bill is past due. Service will be cut after the next missed payment.`, `phone:bank:pay_bill:${event.billId}`);
        } else if (event.billId === 'phone_plan') {
          const missed = sim.finance.bills.find((b) => b.id === 'phone_plan')?.missed ?? 0;
          if (missed >= 2 && sim.phone.plan.active) {
            sim.phone.plan.active = false;
            sim.flags.phone_no_service = true;
            ctx.log({ text: `${sim.phone.plan.provider} suspended ${you(ctx, sim) === 'You' ? 'your' : `${sim.identity.firstName}'s`} phone service for non-payment.`, kind: 'phone', simId: sim.id, importance: 2 });
          }
        }
        break;
      }
      case 'money:bill_paid': {
        const sim = ctx.state.sims[event.simId];
        const hh = sim && ctx.query.householdOf(sim.id);
        if (!sim || !hh) break;
        if (event.billId.startsWith('util:')) {
          const kind = event.billId.slice(5) as UtilityKind;
          if (Number(sim.flags[`bill_arrears:${event.billId}`] ?? 0) <= 0) restoreUtility(ctx, hh, kind);
        } else if (event.billId === 'phone_plan' && !sim.phone.plan.active && Number(sim.flags['bill_arrears:phone_plan'] ?? 0) <= 0) {
          sim.phone.plan.active = true;
          delete sim.flags.phone_no_service;
          const bill = sim.finance.bills.find((b) => b.id === 'phone_plan');
          if (bill) bill.missed = 0;
          ctx.log({ text: 'Phone service restored.', kind: 'phone', simId: sim.id, importance: 1 });
        }
        break;
      }
      case 'scheduled:fired': {
        const ev = event.event;
        const p = ev.payload ?? {};
        if (ev.kind === 'delivery' && (p.handler === 'amenities' || (p.packageId && !p.handler))) {
          const hh = ctx.state.households[String(p.householdId ?? '') as HouseholdId] ?? (ev.simId && ctx.query.householdOf(ev.simId));
          if (hh && p.packageId) deliverPackage(ctx, hh, String(p.packageId), ev.simId);
        }
        break;
      }
      case 'custom': {
        const sim = event.simId ? ctx.state.sims[event.simId] : undefined;
        const hh = sim && ctx.query.householdOf(sim.id);
        const p = event.payload ?? {};
        if (event.kind === 'amenity:check_mail' && sim && hh) {
          const text = readMail(ctx, sim, hh);
          if (ctx.query.isControlled(sim.id)) ctx.log({ text, kind: 'narrative', simId: sim.id, importance: 1 });
        } else if (event.kind === 'amenity:mail') {
          const target = hh ?? (p.householdId ? ctx.state.households[String(p.householdId) as HouseholdId] : undefined) ?? ctx.state.households[ctx.state.player.householdId];
          if (target) {
            pushMail(ctx, target, { from: String(p.from ?? 'Unknown sender'), subject: String(p.subject ?? 'Mail'), body: String(p.body ?? ''), kind: (p.kind as Household['mail'][number]['kind']) ?? 'letter', amount: typeof p.amount === 'number' ? p.amount : undefined, actionId: typeof p.actionId === 'string' ? p.actionId : undefined });
            const head = headOfHousehold(ctx, target);
            if (head && ctx.query.isControlled(head.id)) notify(ctx, head, 'Mail delivered', String(p.subject ?? 'You have mail.'), 'amenity:check_mail', 'usps');
          }
        } else if (event.kind === 'chore:trash' && hh) {
          takeOutTrash(ctx, hh);
        } else if (event.kind === 'amenity:charge_phone' && sim) {
          sim.flags.phone_charging = true;
        }
        break;
      }
      default:
        break;
    }
  },

  actions: amenityActions,
  handles: (id) => id.startsWith('amenity:'),
  execute: (ctx, simId, action) => executeAmenity(ctx, simId, action),
};
