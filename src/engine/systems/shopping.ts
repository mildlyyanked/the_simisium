/**
 * Shopping system — item purchases at stores, weekly grocery baskets, object (furniture/electronics/…)
 * purchases in store and online, food & grocery delivery apps, returns, and moving groceries
 * into the household pantry when a sim gets home.
 *
 * Action ids: `shop:<venueId>:<itemId>` (params.qty), `shop:<venueId>:cart` (weekly groceries),
 * `shop:<venueId>:obj:<defId>` (params.tier 1..5), `shop:<venueId>:return:<objectId>`,
 * `phone:shop:item:<itemId>`, `phone:shop:obj:<defId>` (home only), `phone:delivery:food`, `phone:delivery:groceries`.
 *
 * Custom effect kinds handled: `shop:browse`, `shop:*` (logged), `shop:gift_card {amount}`.
 * Scheduled kinds owned: `delivery` when payload.handler === 'shopping' (objects & food); item packages
 * are scheduled with payload.handler === 'amenities' + `household.packages` entries.
 */
import type { GameEvent } from '../core/events';
import { makeObject, placeObject } from '../core/factories';
import { shortId } from '../core/ids';
import type { System, SystemContext } from '../core/systems';
import type { ActionDef, HouseholdId, ItemDef, ItemId, ObjectId, Requirement, Sim, SimId, Venue, VenueArchetype } from '../core/types';
import type { ObjectDef } from '../content/types';
import { DAY, clamp100, formatMoney, isFiniteNumber, round2 } from '../core/util';

type Ctx = SystemContext;

export const DELIVERY_FEE = 4.99;
export const DELIVERY_TIP_PCT = 0.15;
export const GROCERY_DELIVERY_FEE = 9.99;
export const ONLINE_SHIPPING = 6.99;
export const RETURN_WINDOW_DAYS = 30;
export const DEFAULT_TIER_MULT = [0.6, 1, 1.5, 2.2, 3.2];

export type StoreKind = 'grocery' | 'convenience' | 'pharmacy' | 'clothing' | 'electronics' | 'furniture' | 'hardware' | 'pet' | 'books' | 'liquor';

/** what each store kind stocks (item ids from docs/IDS.md); filtered by what the catalog actually has */
export const STORE_STOCK: Record<StoreKind | 'dispensary' | 'bakery' | 'butcher' | 'farmers_market', ItemId[]> = {
  grocery: [
    'eggs', 'milk', 'bread', 'rice', 'pasta', 'chicken', 'beef', 'ground_beef', 'fish', 'shrimp', 'tofu', 'vegetables', 'salad_greens', 'fruit', 'potatoes', 'onions', 'tomatoes', 'cheese', 'butter', 'yogurt', 'coffee_beans', 'tea', 'sugar', 'flour', 'cereal', 'snacks', 'chips', 'soda', 'juice', 'beer', 'wine', 'water_bottle', 'energy_drink', 'frozen_pizza', 'ramen', 'ice_cream', 'chocolate', 'cookies', 'protein_bar', 'baby_formula', 'diapers',
    'toothpaste', 'soap', 'shampoo', 'toilet_paper', 'laundry_detergent', 'dish_soap', 'trash_bags', 'cleaning_supplies', 'paper_towels', 'deodorant', 'razor', 'lightbulb', 'batteries',
    'painkillers', 'cold_medicine', 'vitamins', 'bandages', 'allergy_meds', 'antacid', 'dog_food', 'cat_food', 'cat_litter', 'pet_treats', 'gift_flowers', 'gift_chocolate', 'gift_card', 'lottery_ticket', 'cigarettes', 'phone_charger',
  ],
  convenience: ['snacks', 'chips', 'soda', 'juice', 'water_bottle', 'energy_drink', 'beer', 'wine', 'cigarettes', 'vape', 'lottery_ticket', 'coffee_cup', 'sandwich', 'ice_cream', 'chocolate', 'cookies', 'ramen', 'frozen_pizza', 'milk', 'bread', 'eggs', 'painkillers', 'cold_medicine', 'antacid', 'condoms', 'phone_charger', 'batteries', 'gas_can', 'bus_pass', 'toilet_paper', 'gift_card'],
  pharmacy: ['painkillers', 'cold_medicine', 'antibiotics', 'vitamins', 'bandages', 'allergy_meds', 'antacid', 'prescription_meds', 'birth_control', 'condoms', 'pregnancy_test', 'first_aid_kit', 'toothpaste', 'soap', 'shampoo', 'deodorant', 'razor', 'sunscreen', 'bug_spray', 'toilet_paper', 'paper_towels', 'baby_formula', 'diapers', 'snacks', 'soda', 'water_bottle', 'chocolate', 'gift_card', 'batteries', 'phone_charger'],
  clothing: ['outfit_casual', 'outfit_business', 'outfit_formal', 'outfit_athletic', 'outfit_winter_coat', 'outfit_swimwear', 'shoes_sneakers', 'shoes_dress', 'umbrella', 'gift_card'],
  electronics: ['phone_charger', 'batteries', 'gift_card'],
  furniture: ['gift_card'],
  hardware: ['tool_kit', 'paint_supplies', 'lightbulb', 'batteries', 'seeds', 'bug_spray', 'gas_can', 'trash_bags', 'cleaning_supplies', 'first_aid_kit', 'umbrella', 'fishing_bait'],
  pet: ['dog_food', 'cat_food', 'cat_litter', 'pet_treats', 'pet_toy', 'leash', 'gift_card'],
  books: ['book_novel', 'textbook', 'notebook', 'gift_card', 'coffee_cup'],
  liquor: ['beer', 'wine', 'liquor', 'chips', 'cigarettes', 'lottery_ticket'],
  dispensary: ['cannabis_flower'],
  bakery: ['bread', 'cookies', 'coffee_cup', 'sandwich'],
  butcher: ['chicken', 'beef', 'ground_beef', 'fish', 'shrimp'],
  farmers_market: ['vegetables', 'salad_greens', 'fruit', 'potatoes', 'onions', 'tomatoes', 'eggs', 'cheese', 'bread', 'gift_flowers', 'seeds'],
};

/** staples for the weekly basket: [itemId, qty] */
export const WEEKLY_BASKET: [ItemId, number][] = [
  ['eggs', 1], ['milk', 1], ['bread', 1], ['rice', 1], ['pasta', 1], ['chicken', 2], ['ground_beef', 1], ['vegetables', 3], ['fruit', 2], ['potatoes', 1], ['onions', 1], ['cheese', 1], ['butter', 1], ['yogurt', 2], ['cereal', 1], ['coffee_beans', 1], ['snacks', 2], ['juice', 1], ['toilet_paper', 1], ['dish_soap', 1],
];

const ARCHETYPE_STORE: Partial<Record<VenueArchetype, keyof typeof STORE_STOCK>> = {
  grocery: 'grocery',
  convenience: 'convenience',
  gas_station: 'convenience',
  pharmacy: 'pharmacy',
  clothing: 'clothing',
  mall: 'clothing',
  thrift_store: 'clothing',
  electronics: 'electronics',
  furniture: 'furniture',
  hardware: 'hardware',
  pet_store: 'pet',
  bookstore: 'books',
  liquor_store: 'liquor',
  dispensary: 'dispensary',
  bakery: 'bakery',
  butcher: 'butcher',
  farmers_market: 'farmers_market',
  retail: 'grocery',
};

const OBJECT_STORES: Partial<Record<VenueArchetype, ObjectDef['category'][]>> = {
  furniture: ['furniture', 'decor', 'kitchen'],
  electronics: ['electronics', 'office'],
  hardware: ['tool', 'outdoor', 'appliance', 'plumbing'],
  mall: ['electronics', 'decor', 'fitness', 'hobby', 'toy', 'kitchen'],
  retail: ['decor', 'toy', 'kitchen', 'fitness', 'misc', 'appliance', 'office'],
  pet_store: ['pet'],
  thrift_store: ['furniture', 'decor', 'hobby', 'toy'],
};
const ONLINE_OBJECT_CATEGORIES: ObjectDef['category'][] = ['furniture', 'decor', 'kitchen', 'electronics', 'office', 'appliance', 'fitness', 'hobby', 'toy', 'pet', 'tool', 'outdoor', 'misc'];

const CANNABIS_LEGAL = new Set(['AK', 'AZ', 'CA', 'CO', 'CT', 'DC', 'DE', 'IL', 'ME', 'MD', 'MA', 'MI', 'MN', 'MO', 'MT', 'NV', 'NJ', 'NM', 'NY', 'OH', 'OR', 'RI', 'VT', 'VA', 'WA']);
const TAX_EXEMPT: ItemDef['category'][] = ['food', 'ingredient', 'drink'];
const FOOD_FALLBACK = new Set([...STORE_STOCK.grocery.slice(0, 40), 'meal_basic', 'meal_good', 'meal_gourmet', 'leftovers', 'takeout_meal', 'sandwich', 'coffee_cup', 'smoothie', 'fast_food_meal', 'restaurant_meal']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function act(id: string, label: string, category: ActionDef['category'], minutes: number, extra: Partial<ActionDef> = {}): ActionDef {
  return { id, label, category, durationMinutes: minutes, effects: {}, interruptible: true, ...extra };
}
function moneyReq(amount: number): Requirement {
  return { kind: 'money', reason: `Costs ${formatMoney(amount)}`, params: { amount } };
}
const PHONE_REQ: Requirement = { kind: 'flag', reason: 'Your phone is dead', params: { flag: 'phone_dead', not: true } };

function you(ctx: Ctx, sim: Sim): string {
  return ctx.query.isControlled(sim.id) ? 'You' : sim.identity.firstName;
}

function isFoodItem(ctx: Ctx, itemId: ItemId): boolean {
  const def = ctx.content.items[itemId];
  if (def) return TAX_EXEMPT.includes(def.category);
  return FOOD_FALLBACK.has(itemId);
}

function ageReq(ctx: Ctx, def: ItemDef): Requirement | undefined {
  const tags = def.tags ?? [];
  if (def.category === 'alcohol' || def.category === 'tobacco' || def.category === 'cannabis' || tags.includes('21+')) return { kind: 'age', reason: 'Must be 21+', params: { minAge: 21 } };
  if (def.id === 'lottery_ticket' || tags.includes('18+')) return { kind: 'age', reason: 'Must be 18+', params: { minAge: 18 } };
  return undefined;
}

export function itemPrice(ctx: Ctx, def: ItemDef, venue: Venue | undefined, opts: { thrift?: boolean } = {}): number {
  const mult = (venue?.priceMultiplier ?? 1) * ctx.state.region.costOfLiving * ctx.state.economy.inflationIndex * (opts.thrift ? 0.35 : 1);
  return round2(def.basePrice * mult);
}

function taxOn(ctx: Ctx, itemId: ItemId, amount: number): number {
  return isFoodItem(ctx, itemId) ? 0 : round2(amount * ctx.state.region.salesTax);
}

export function objectPrice(ctx: Ctx, def: ObjectDef, tier: number, venue?: Venue): number {
  const t = Math.min(5, Math.max(1, Math.round(tier)));
  const tierMult = def.tiers?.[t - 1] ?? DEFAULT_TIER_MULT[t - 1];
  return round2(def.basePrice * tierMult * (venue?.priceMultiplier ?? 1) * ctx.state.region.costOfLiving * ctx.state.economy.inflationIndex * (venue?.archetype === 'thrift_store' ? 0.4 : 1));
}

function storeKindFor(ctx: Ctx, venue: Venue): { kind?: keyof typeof STORE_STOCK; explicit?: ItemId[] } {
  const arch = ctx.content.archetypes[venue.archetype];
  const sells = arch?.sells;
  if (Array.isArray(sells)) return { explicit: sells };
  if (typeof sells === 'string') return { kind: sells };
  return { kind: ARCHETYPE_STORE[venue.archetype] };
}

/** items a venue sells, resolved against the catalog */
export function itemsSoldAt(ctx: Ctx, venue: Venue): ItemDef[] {
  const { kind, explicit } = storeKindFor(ctx, venue);
  const ids = explicit ?? (kind ? STORE_STOCK[kind] : []);
  if (kind === 'dispensary' && !CANNABIS_LEGAL.has(ctx.state.region.stateCode)) return [];
  const out: ItemDef[] = [];
  for (const id of ids) {
    const def = ctx.content.items[id];
    if (def) out.push(def);
  }
  return out;
}

export function objectsSoldAt(ctx: Ctx, venue: Venue): ObjectDef[] {
  const cats = OBJECT_STORES[venue.archetype];
  if (!cats) return [];
  return Object.values(ctx.content.objects).filter((d) => cats.includes(d.category) && d.basePrice > 0);
}

function homeRoomFor(home: Venue, def: ObjectDef | undefined): string | undefined {
  const pref = (def?.rooms?.[0] ?? 'Living Room').toLowerCase().replace(/\s+/g, '_');
  return (home.rooms.find((r) => r.id === pref || r.id.startsWith(`${pref}_`)) ?? home.rooms[0])?.id;
}

function charge(ctx: Ctx, sim: Sim, amount: number, memo: string, venueId?: Venue['id'], counterparty?: string): boolean {
  if (amount <= 0) return true;
  const before = sim.finance.transactions.length;
  ctx.applyEffects(sim.id, { money: { amount: -round2(amount), memo, category: 'shopping', counterparty } }, 'shopping');
  const ok = sim.finance.transactions.length > before;
  if (ok && venueId) sim.finance.transactions[sim.finance.transactions.length - 1].venueId = venueId;
  return ok;
}

function grantItems(ctx: Ctx, sim: Sim, items: { itemId: ItemId; qty: number }[]): void {
  ctx.applyEffects(sim.id, { items: items.map((i) => ({ op: 'gain' as const, itemId: i.itemId, qty: i.qty })) }, 'shopping');
}

/** groceries carried home go into the household pantry */
function stockPantry(ctx: Ctx, sim: Sim): void {
  const hh = ctx.query.householdOf(sim.id);
  if (!hh) return;
  const moved: string[] = [];
  for (const [id, qty] of Object.entries(sim.inventory.consumables)) {
    if (!qty || !isFoodItem(ctx, id)) continue;
    const def = ctx.content.items[id];
    if (def && def.category === 'food' && !def.perishDays) continue; // prepared meals stay with the sim
    hh.pantry[id] = (hh.pantry[id] ?? 0) + qty;
    delete sim.inventory.consumables[id];
    moved.push(id);
  }
  if (moved.length && ctx.query.isControlled(sim.id)) ctx.log({ text: `You put the groceries away (${moved.length} item${moved.length > 1 ? 's' : ''}).`, kind: 'narrative', simId: sim.id, importance: 0 });
}

function createHomeObject(ctx: Ctx, sim: Sim, def: ObjectDef, tier: number, price: number): ObjectId | undefined {
  const hh = ctx.query.householdOf(sim.id);
  const home = hh && ctx.state.venues[hh.homeVenueId];
  if (!hh || !home) return undefined;
  const obj = makeObject(def.id, { rng: ctx.rng, ownerHouseholdId: hh.id, quality: tier, price, now: ctx.state.time.minute });
  placeObject(ctx.state, obj, home.id, homeRoomFor(home, def));
  if (home.residence) home.residence.furnishingLevel = clamp100(home.residence.furnishingLevel + (def.category === 'decor' ? 1 : 2));
  ctx.emit({ type: 'shop:object_purchased', simId: sim.id, objectId: obj.id, defId: def.id, price });
  return obj.id;
}

function schedulePackage(ctx: Ctx, sim: Sim, items: { itemId: ItemId; qty: number }[], from: string, minutes: number): void {
  const hh = ctx.query.householdOf(sim.id);
  if (!hh) {
    grantItems(ctx, sim, items);
    return;
  }
  const arrivesAt = ctx.state.time.minute + minutes;
  for (const it of items) {
    const id = shortId(ctx.rng, 'pkg');
    hh.packages.push({ id, itemId: it.itemId, qty: it.qty, arrivesAt, from });
    ctx.schedule({ atMinute: arrivesAt, kind: 'delivery', label: `Delivery from ${from}`, simId: sim.id, venueId: hh.homeVenueId, payload: { handler: 'amenities', packageId: id, householdId: hh.id } });
  }
  ctx.emit({ type: 'shop:delivery_scheduled', householdId: hh.id, arrivesAt });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function shoppingActions(ctx: Ctx, simId: SimId): ActionDef[] {
  const sim = ctx.query.sim(simId);
  if (sim.lifeStage === 'infant' || sim.lifeStage === 'toddler') return [];
  const venue = ctx.query.venue(sim.location.venueId);
  const out: ActionDef[] = [];
  const openReq: Requirement = { kind: 'venue_open', reason: `${venue.name} is closed`, params: { venueId: venue.id } };
  const thrift = venue.archetype === 'thrift_store';
  const isChild = sim.lifeStage === 'child';
  const hh = ctx.query.householdOf(simId);
  const home = hh && ctx.state.venues[hh.homeVenueId];
  const atHome = !!home && venue.id === home.id;

  // --- items in store ---
  const items = itemsSoldAt(ctx, venue);
  if (items.length) {
    let basketCost = 0;
    let basketCount = 0;
    for (const def of items) {
      const unit = itemPrice(ctx, def, venue, { thrift });
      const total = round2(unit + taxOn(ctx, def.id, unit));
      const reqs: Requirement[] = [openReq, moneyReq(total)];
      const age = ageReq(ctx, def);
      if (age) reqs.push(age);
      if (isChild && age) continue;
      out.push(act(`shop:${venue.id}:${def.id}`, `Buy ${def.name} (${formatMoney(total)})`, 'shop', 2, { group: 'Shop', target: { kind: 'item', id: def.id, name: def.name }, cost: { amount: total, memo: `${def.name} at ${venue.name}`, category: 'shopping', counterparty: venue.name }, requirements: reqs, params: { qty: 1, unit, itemId: def.id }, description: def.perishDays ? `Keeps ${def.perishDays} days.` : undefined }));
      const basket = WEEKLY_BASKET.find(([id]) => id === def.id);
      if (basket) {
        basketCost += unit * basket[1];
        basketCount += 1;
      }
    }
    if (basketCount >= 8 && !isChild) {
      const total = round2(basketCost);
      out.push(act(`shop:${venue.id}:cart`, `Buy a week of groceries (${formatMoney(total)})`, 'shop', 35, { group: 'Shop', icon: 'cart', cost: { amount: total, memo: `Weekly groceries at ${venue.name}`, category: 'groceries', counterparty: venue.name }, requirements: [openReq, moneyReq(total)], effects: { needs: { fun: -2, energy: -3 } }, autonomyWeight: 0.5 }));
    }
  }
  // --- objects in store ---
  if (!isChild) {
    for (const def of objectsSoldAt(ctx, venue)) {
      const price = objectPrice(ctx, def, 2, venue);
      const total = round2(price * (1 + ctx.state.region.salesTax));
      out.push(act(`shop:${venue.id}:obj:${def.id}`, `Buy ${def.name} (${formatMoney(total)} · tier 2)`, 'shop', 20, { group: 'Shop furniture & goods', target: { kind: 'item', id: def.id, name: def.name }, requirements: [openReq, moneyReq(total)], params: { tier: 2, defId: def.id }, description: `${def.description} Choose tier 1–5 for quality.` }));
    }
    // returns: objects bought within 30 days at the same kind of store
    if (hh && OBJECT_STORES[venue.archetype]) {
      for (const oid of home?.objectIds ?? []) {
        const o = ctx.state.objects[oid];
        const def = o && ctx.content.objects[o.defId];
        if (!o || !def || o.ownerHouseholdId !== hh.id || o.purchasedAtMinute === undefined || !o.purchasePrice) continue;
        if (ctx.state.time.minute - o.purchasedAtMinute > RETURN_WINDOW_DAYS * DAY || !OBJECT_STORES[venue.archetype]!.includes(def.category) || o.state.broken) continue;
        out.push(act(`shop:${venue.id}:return:${o.id}`, `Return the ${def.name} (${formatMoney(o.purchasePrice)} refund)`, 'shop', 25, { group: 'Shop furniture & goods', requirements: [openReq], target: { kind: 'object', id: o.id, name: def.name } }));
      }
    }
  }
  // --- phone: online ordering & delivery ---
  if (!isChild && !sim.flags.phone_dead && sim.phone.plan.active) {
    const g = 'Order online';
    const meal = ctx.content.items.restaurant_meal;
    const mealPrice = meal ? itemPrice(ctx, meal, undefined) : 18;
    const foodTotal = round2((mealPrice + DELIVERY_FEE) * (1 + DELIVERY_TIP_PCT) + taxOn(ctx, 'restaurant_meal', mealPrice) * 0);
    out.push(act('phone:delivery:food', `Order food delivery (${formatMoney(foodTotal)}, 35–55 min)`, 'phone', 4, { group: g, icon: 'delivery', requirements: [PHONE_REQ, moneyReq(foodTotal)], params: { total: foodTotal }, satisfies: ['hunger'], autonomyWeight: 0.3 }));
    let basketCost = 0;
    let basketCount = 0;
    for (const [id, qty] of WEEKLY_BASKET) {
      const def = ctx.content.items[id];
      if (def) {
        basketCost += itemPrice(ctx, def, undefined) * qty;
        basketCount++;
      }
    }
    if (basketCount >= 8) {
      const total = round2(basketCost * 1.08 + GROCERY_DELIVERY_FEE + basketCost * 0.1);
      out.push(act('phone:delivery:groceries', `Order groceries for delivery (${formatMoney(total)}, ~2 h)`, 'phone', 8, { group: g, requirements: [PHONE_REQ, moneyReq(total)], params: { total } }));
    }
    for (const id of ['phone_charger', 'batteries', 'toilet_paper', 'laundry_detergent', 'vitamins', 'book_novel', 'umbrella', 'outfit_casual', 'shoes_sneakers', 'tool_kit', 'dog_food', 'cat_food', 'cat_litter', 'diapers', 'baby_formula']) {
      const def = ctx.content.items[id];
      if (!def) continue;
      const unit = itemPrice(ctx, def, undefined);
      const total = round2(unit + taxOn(ctx, id, unit) + ONLINE_SHIPPING);
      out.push(act(`phone:shop:item:${id}`, `Order ${def.name} online (${formatMoney(total)}, 1–5 days)`, 'phone', 3, { group: g, requirements: [PHONE_REQ, moneyReq(total)], params: { qty: 1, unit, itemId: id } }));
    }
    if (atHome) {
      for (const def of Object.values(ctx.content.objects)) {
        if (!ONLINE_OBJECT_CATEGORIES.includes(def.category) || def.basePrice <= 0) continue;
        const price = objectPrice(ctx, def, 2);
        const total = round2(price * (1 + ctx.state.region.salesTax) + (def.portable ? ONLINE_SHIPPING : 49));
        out.push(act(`phone:shop:obj:${def.id}`, `Order ${def.name} online (${formatMoney(total)} · tier 2, 1–5 days)`, 'phone', 5, { group: 'Order furniture & goods online', requirements: [PHONE_REQ, moneyReq(total)], params: { tier: 2, defId: def.id } }));
      }
    }
  }
  return out;
}

function executeShopping(ctx: Ctx, simId: SimId, action: ActionDef, params: Record<string, unknown>): { ok: boolean; text?: string; effects?: ActionDef['effects'] } {
  const sim = ctx.query.sim(simId);
  const venue = ctx.query.venue(sim.location.venueId);
  const parts = action.id.split(':');
  const now = ctx.state.time.minute;

  if (action.id.startsWith('phone:delivery:')) {
    const what = parts[2];
    if (what === 'food') {
      const total = Number(params.total ?? 25);
      if (!charge(ctx, sim, total, 'Food delivery (DoorDash)', undefined, 'DoorDash')) return { ok: false, text: `You can't cover ${formatMoney(total)}.` };
      const minutes = ctx.rng.int(35, 55);
      ctx.schedule({ inMinutes: minutes, kind: 'delivery', label: 'Food delivery', simId, venueId: sim.location.venueId, payload: { handler: 'shopping', food: 'restaurant_meal', qty: 1, venueId: sim.location.venueId } });
      ctx.emit({ type: 'shop:purchased', simId, items: [{ itemId: 'restaurant_meal', qty: 1 }], total });
      return { ok: true, text: `Order placed. The app says ${minutes} minutes.` };
    }
    if (what === 'groceries') {
      const total = Number(params.total ?? 120);
      if (!charge(ctx, sim, total, 'Grocery delivery (Instacart)', undefined, 'Instacart')) return { ok: false, text: `You can't cover ${formatMoney(total)}.` };
      const items = WEEKLY_BASKET.filter(([id]) => ctx.content.items[id]).map(([itemId, qty]) => ({ itemId, qty }));
      schedulePackage(ctx, sim, items, 'Instacart', 120 + ctx.rng.int(-20, 40));
      ctx.emit({ type: 'shop:purchased', simId, items, total });
      return { ok: true, text: 'Groceries ordered. About two hours.' };
    }
    return { ok: false, text: 'Unknown delivery.' };
  }

  if (action.id.startsWith('phone:shop:')) {
    const kind = parts[2];
    if (kind === 'item') {
      const itemId = parts[3];
      const def = ctx.content.items[itemId];
      if (!def) return { ok: false, text: 'Item unavailable.' };
      const qty = Math.max(1, Math.round(Number(params.qty ?? 1)));
      const unit = Number(params.unit ?? itemPrice(ctx, def, undefined));
      const total = round2(unit * qty + taxOn(ctx, itemId, unit * qty) + ONLINE_SHIPPING);
      if (!charge(ctx, sim, total, `${def.name} (online order)`, undefined, 'Amazon')) return { ok: false, text: `You can't cover ${formatMoney(total)}.` };
      const days = ctx.rng.int(1, 5);
      schedulePackage(ctx, sim, [{ itemId, qty }], 'Amazon', days * DAY + ctx.rng.int(9 * 60, 18 * 60) - (now % DAY));
      ctx.emit({ type: 'shop:purchased', simId, items: [{ itemId, qty }], total });
      return { ok: true, text: `Ordered. Arrives in ${days} day${days > 1 ? 's' : ''}.` };
    }
    if (kind === 'obj') {
      const defId = parts[3];
      const def = ctx.content.objects[defId];
      if (!def) return { ok: false, text: 'Unavailable.' };
      const tier = Math.min(5, Math.max(1, Math.round(Number(params.tier ?? 2))));
      const price = objectPrice(ctx, def, tier);
      const total = round2(price * (1 + ctx.state.region.salesTax) + (def.portable ? ONLINE_SHIPPING : 49));
      if (!charge(ctx, sim, total, `${def.name} (online order)`, undefined, 'Wayfair')) return { ok: false, text: `You can't cover ${formatMoney(total)}.` };
      const days = ctx.rng.int(1, 5);
      const hh = ctx.query.householdOf(simId);
      ctx.schedule({ inMinutes: days * DAY + ctx.rng.int(9 * 60, 18 * 60) - (now % DAY), kind: 'delivery', label: `${def.name} delivery`, simId, venueId: hh?.homeVenueId, payload: { handler: 'shopping', objectDefId: def.id, tier, price, householdId: hh?.id } });
      if (hh) ctx.emit({ type: 'shop:delivery_scheduled', householdId: hh.id, arrivesAt: now + days * DAY });
      ctx.emit({ type: 'shop:purchased', simId, items: [{ itemId: `object:${def.id}`, qty: 1 }], total });
      return { ok: true, text: `Ordered a tier-${tier} ${def.name} for ${formatMoney(total)}. Delivery in ${days} day${days > 1 ? 's' : ''}.` };
    }
    return { ok: false, text: 'Unknown order.' };
  }

  // shop:<venueId>:...
  const sub = parts[2];
  if (sub === 'cart') {
    const items = WEEKLY_BASKET.filter(([id]) => ctx.content.items[id]).map(([itemId, qty]) => ({ itemId, qty }));
    grantItems(ctx, sim, items);
    const total = action.cost?.amount ?? 0;
    ctx.emit({ type: 'shop:purchased', simId, venueId: venue.id, items, total });
    const hh = ctx.query.householdOf(simId);
    if (hh && hh.homeVenueId === venue.id) stockPantry(ctx, sim);
    ctx.log({ text: `${you(ctx, sim)} ${ctx.query.isControlled(simId) ? 'do' : 'does'} a full grocery run at ${venue.name}: ${formatMoney(total)}.`, kind: 'money', simId, importance: 1, venueId: venue.id });
    return { ok: true, text: `Cart full: ${items.length} staples for ${formatMoney(total)}.` };
  }
  if (sub === 'obj') {
    const def = ctx.content.objects[parts[3]];
    if (!def) return { ok: false, text: 'Unavailable.' };
    const tier = Math.min(5, Math.max(1, Math.round(Number(params.tier ?? 2))));
    const price = objectPrice(ctx, def, tier, venue);
    const total = round2(price * (1 + ctx.state.region.salesTax));
    if (!charge(ctx, sim, total, `${def.name} at ${venue.name}`, venue.id, venue.name)) return { ok: false, text: `You can't cover ${formatMoney(total)}.` };
    const objectId = createHomeObject(ctx, sim, def, tier, price);
    ctx.emit({ type: 'shop:purchased', simId, venueId: venue.id, items: [{ itemId: `object:${def.id}`, qty: 1 }], total });
    ctx.log({ text: `${you(ctx, sim)} ${ctx.query.isControlled(simId) ? 'buy' : 'buys'} a tier-${tier} ${def.name} for ${formatMoney(total)}${def.portable ? '' : '; it will be at home'}.`, kind: 'money', simId, importance: 1, venueId: venue.id });
    return { ok: true, text: objectId ? `Bought a tier-${tier} ${def.name}. It's ${def.portable ? 'yours' : 'set up at home'}.` : `Bought a ${def.name}, but you have no home to put it in.` };
  }
  if (sub === 'return') {
    const o = ctx.state.objects[parts[3] as ObjectId];
    if (!o || !o.purchasePrice) return { ok: false, text: 'Nothing to return.' };
    const refund = o.purchasePrice;
    const home = o.venueId ? ctx.state.venues[o.venueId] : undefined;
    if (home) {
      home.objectIds = home.objectIds.filter((x) => x !== o.id);
      for (const r of home.rooms) r.objectIds = r.objectIds.filter((x) => x !== o.id);
    }
    delete ctx.state.objects[o.id];
    ctx.applyEffects(simId, { money: { amount: refund, memo: `Refund: ${ctx.content.objects[o.defId]?.name ?? o.defId}`, category: 'refund' } }, 'shopping:return');
    return { ok: true, text: `Refunded ${formatMoney(refund)}.` };
  }
  // single item
  const itemId = sub;
  const def = ctx.content.items[itemId];
  if (!def) return { ok: false, text: 'Not sold here.' };
  const qty = Math.max(1, Math.round(Number(params.qty ?? 1)));
  const unit = Number(params.unit ?? itemPrice(ctx, def, venue));
  const paidByEngine = action.cost?.amount ?? 0; // engine charges the 1-unit cost after execute
  if (qty > 1) {
    const extra = round2(unit * (qty - 1) + taxOn(ctx, itemId, unit * (qty - 1)));
    if (!charge(ctx, sim, extra, `${def.name} ×${qty - 1} at ${venue.name}`, venue.id, venue.name)) return { ok: false, text: `You can't cover ${formatMoney(extra + paidByEngine)}.` };
  }
  const total = round2(paidByEngine + (qty > 1 ? unit * (qty - 1) + taxOn(ctx, itemId, unit * (qty - 1)) : 0));
  ctx.emit({ type: 'shop:purchased', simId, venueId: venue.id, items: [{ itemId, qty }], total });
  const hh = ctx.query.householdOf(simId);
  const effects: ActionDef['effects'] = { items: [{ op: 'gain', itemId, qty }] };
  if (hh && hh.homeVenueId === venue.id && isFoodItem(ctx, itemId)) {
    hh.pantry[itemId] = (hh.pantry[itemId] ?? 0) + qty;
    delete effects.items;
  }
  return { ok: true, text: `${qty > 1 ? `${qty} × ` : ''}${def.name}: ${formatMoney(total)}.`, effects };
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------
export const shoppingSystem: System = {
  id: 'shopping',
  intervalMinutes: 1440,

  onTick() {
    /* daily; purchases are action/event driven */
  },

  onEvent(ctx, event: GameEvent) {
    switch (event.type) {
      case 'sim:arrived': {
        const sim = ctx.state.sims[event.simId];
        const hh = sim && ctx.query.householdOf(sim.id);
        if (sim && hh && hh.homeVenueId === event.venueId) stockPantry(ctx, sim);
        break;
      }
      case 'scheduled:fired': {
        const ev = event.event;
        const p = ev.payload ?? {};
        if (ev.kind !== 'delivery' || p.handler !== 'shopping') break;
        if (p.objectDefId) {
          const sim = ev.simId ? ctx.state.sims[ev.simId] : undefined;
          const def = ctx.content.objects[String(p.objectDefId)];
          if (!sim || !def) break;
          const tier = Number(p.tier ?? 2);
          const objectId = createHomeObject(ctx, sim, def, tier, Number(p.price ?? objectPrice(ctx, def, tier)));
          const hh = ctx.state.households[String(p.householdId ?? '') as HouseholdId] ?? ctx.query.householdOf(sim.id);
          ctx.log({ text: `Delivery: your ${def.name} arrived${objectId ? ' and is set up at home' : ''}.`, kind: 'event', simId: sim.id, importance: 1, venueId: hh?.homeVenueId });
          const home = hh && ctx.state.venues[hh.homeVenueId];
          const here = home && ctx.query.simsAt(home.id).find((s) => ctx.query.isControlled(s.id));
          if (here) ctx.interrupt({ kind: 'delivery', title: 'Delivery', body: `Two guys with a dolly: your ${def.name} is here.`, simId: here.id, options: [] });
        } else if (p.food) {
          const sim = ev.simId ? ctx.state.sims[ev.simId] : undefined;
          if (!sim) break;
          const itemId = String(p.food);
          const qty = Number(p.qty ?? 1);
          const orderedAt = String(p.venueId ?? '') as Venue['id'];
          if (orderedAt && sim.location.venueId !== orderedAt && !sim.travel) {
            ctx.log({ text: `Your food delivery arrived at ${ctx.state.venues[orderedAt]?.name ?? 'the address'} but you'd already left. It's on the doorstep going cold.`, kind: 'alert', simId: sim.id, importance: 1 });
            break;
          }
          grantItems(ctx, sim, [{ itemId, qty }]);
          ctx.log({ text: `Food delivery: the driver hands over your order.`, kind: 'event', simId: sim.id, importance: 1, venueId: sim.location.venueId });
          if (ctx.query.isControlled(sim.id)) ctx.interrupt({ kind: 'delivery', title: 'Food is here', body: 'Your delivery order is at the door.', simId: sim.id, options: [] });
        }
        break;
      }
      case 'custom': {
        const sim = event.simId ? ctx.state.sims[event.simId] : undefined;
        if (!sim || !event.kind.startsWith('shop:')) break;
        const p = event.payload ?? {};
        if (event.kind === 'shop:browse') {
          const venue = ctx.state.venues[sim.location.venueId];
          const n = venue ? itemsSoldAt(ctx, venue).length + objectsSoldAt(ctx, venue).length : 0;
          if (ctx.query.isControlled(sim.id)) ctx.log({ text: n ? `You browse ${venue?.name}: ${n} things for sale.` : `Nothing much for sale here.`, kind: 'narrative', simId: sim.id, importance: 0 });
        } else if (event.kind === 'shop:gift_card') {
          const amount = isFiniteNumber(p.amount) ? Number(p.amount) : 25;
          ctx.applyEffects(sim.id, { money: { amount, memo: 'Gift card', category: 'gift' } }, 'shopping:gift_card');
        } else if (ctx.query.isControlled(sim.id)) {
          ctx.log({ text: `You look around the shop.`, kind: 'narrative', simId: sim.id, importance: 0 });
        }
        break;
      }
      default:
        break;
    }
  },

  actions: shoppingActions,
  handles: (id) => id.startsWith('shop:') || id.startsWith('phone:shop:') || id.startsWith('phone:delivery:'),
  execute: (ctx, simId, action, params) => executeShopping(ctx, simId, action, params),
};
