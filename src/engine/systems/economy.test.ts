import { describe, expect, it } from 'vitest';
import { CONTENT } from '../content';
import type { ContentCatalog, ObjectDef } from '../content/types';
import { Engine } from '../core/engine';
import { makeEmptyWorld, makeHousehold, makeSim, makeVenue } from '../core/factories';
import { RNG } from '../core/rng';
import type { GameEvent } from '../core/events';
import type { ItemDef, Sim, Vehicle, VenueId, WorldState } from '../core/types';
import { DAY, HOUR } from '../core/util';
import { amenitiesSystem } from './amenities';
import { addBill, computeTaxes, federalTax, financeSystem, monthlyPayment, removeBill } from './finance';
import { homeVenueOf, propertySystem } from './property';
import { shoppingSystem } from './shopping';
import { transportSystem } from './transport';
import { chooseMode, estimateTravel } from './transportUtil';

// ---------------------------------------------------------------------------
// Inline content (the real catalogs are being written by other builders)
// ---------------------------------------------------------------------------
const item = (id: string, name: string, category: ItemDef['category'], basePrice: number, perishDays?: number): ItemDef => ({ id, name, category, basePrice, perishDays });
const ITEMS: Record<string, ItemDef> = Object.fromEntries(
  [
    item('milk', 'Milk', 'ingredient', 3.79, 10),
    item('eggs', 'Eggs', 'ingredient', 3.49, 21),
    item('bread', 'Bread', 'ingredient', 2.99, 7),
    item('rice', 'Rice', 'ingredient', 4.29),
    item('pasta', 'Pasta', 'ingredient', 1.79),
    item('chicken', 'Chicken', 'ingredient', 7.99, 4),
    item('ground_beef', 'Ground beef', 'ingredient', 6.49, 3),
    item('vegetables', 'Vegetables', 'ingredient', 3.29, 7),
    item('fruit', 'Fruit', 'ingredient', 3.99, 7),
    item('potatoes', 'Potatoes', 'ingredient', 3.49, 21),
    item('onions', 'Onions', 'ingredient', 1.99, 21),
    item('cheese', 'Cheese', 'ingredient', 4.99, 21),
    item('butter', 'Butter', 'ingredient', 4.49, 30),
    item('yogurt', 'Yogurt', 'food', 1.29, 14),
    item('cereal', 'Cereal', 'food', 4.49),
    item('coffee_beans', 'Coffee beans', 'ingredient', 9.99),
    item('snacks', 'Snacks', 'food', 3.49),
    item('juice', 'Juice', 'drink', 3.99, 14),
    item('toilet_paper', 'Toilet paper', 'toiletry', 8.99),
    item('dish_soap', 'Dish soap', 'toiletry', 3.29),
    item('beer', 'Beer (6-pack)', 'alcohol', 10.99),
    item('lottery_ticket', 'Lottery ticket', 'misc', 2),
    item('restaurant_meal', 'Restaurant meal', 'food', 18),
    item('phone_charger', 'Phone charger', 'electronics', 14.99),
  ].map((d) => [d.id, d]),
);
const OBJECTS: Record<string, ObjectDef> = {
  sofa: { id: 'sofa', name: 'Sofa', category: 'furniture', description: 'A sofa.', icon: 'sofa', basePrice: 600, interactions: [], portable: false, durabilityUses: 2000, repairCost: 90, rooms: ['Living Room'], tags: [] },
  tv: { id: 'tv', name: 'TV', category: 'electronics', description: 'A TV.', icon: 'tv', basePrice: 400, interactions: [], portable: false, durabilityUses: 3000, repairCost: 120, requiresUtility: 'electric', rooms: ['Living Room'], tags: [] },
  fridge: { id: 'fridge', name: 'Fridge', category: 'appliance', description: 'Keeps food cold.', icon: 'fridge', basePrice: 900, interactions: [], portable: false, durabilityUses: 5000, repairCost: 180, requiresUtility: 'electric', rooms: ['Kitchen'], tags: [] },
};
const content: ContentCatalog = { ...CONTENT, items: ITEMS, objects: OBJECTS };
const SYSTEMS = [financeSystem, propertySystem, amenitiesSystem, transportSystem, shoppingSystem];

interface World {
  state: WorldState;
  sim: Sim;
  home: ReturnType<typeof makeVenue>;
  grocery: ReturnType<typeof makeVenue>;
  bank: ReturnType<typeof makeVenue>;
  gas: ReturnType<typeof makeVenue>;
  events: GameEvent[];
  engine: Engine;
}

function world(opts: { cash?: number; seed?: string; epoch?: string } = {}): World {
  const seed = opts.seed ?? 'economy';
  const rng = new RNG(seed);
  const state = makeEmptyWorld({ seed, epoch: opts.epoch ?? '2026-09-10' });
  const c = state.region.center;
  const home = makeVenue({ name: '412 Oak St #3', archetype: 'home', location: c, rng, rooms: ['Kitchen', 'Living Room', 'Bedroom', 'Bathroom'], discovered: true });
  home.residence = { kind: 'apartment', bedrooms: 1, bathrooms: 1, sqft: 700, tenure: 'rent', monthlyRent: 1400, marketValue: 260000, condition: 75, utilities: [], furnishingLevel: 40, securitySystem: false, yard: false, garage: false, petsAllowed: true };
  const grocery = makeVenue({ name: 'H-E-B', archetype: 'grocery', location: { lat: c.lat + 0.012, lng: c.lng + 0.01 }, rng, discovered: true });
  const bank = makeVenue({ name: 'First National Bank', archetype: 'bank', location: { lat: c.lat - 0.008, lng: c.lng + 0.004 }, rng, discovered: true });
  const gas = makeVenue({ name: 'Shell', archetype: 'gas_station', location: { lat: c.lat + 0.03, lng: c.lng - 0.02 }, rng, discovered: true });
  const far = makeVenue({ name: 'Round Rock Outlets', archetype: 'mall', location: { lat: c.lat + 0.25, lng: c.lng + 0.1 }, rng, discovered: true });
  for (const v of [home, grocery, bank, gas, far]) state.venues[v.id] = v;
  const sim = makeSim({ firstName: 'Ada', lastName: 'Lee', gender: 'female', age: 28, epoch: state.epoch, rng, venueId: home.id, isPlayerControlled: true, startingCash: opts.cash ?? 3000 });
  sim.finance.creditScore = 700;
  state.sims[sim.id] = sim;
  const hh = makeHousehold({ name: 'Lee', simIds: [sim.id], homeVenueId: home.id, rng });
  state.households[hh.id] = hh;
  sim.householdId = hh.id;
  state.player = { householdId: hh.id, activeSimId: sim.id, controlledSimIds: [sim.id], favorites: [], tutorial: {} };
  const events: GameEvent[] = [];
  const engine = new Engine(state, { content, systems: SYSTEMS, holidayResolver: () => [] });
  engine.bus.on((e) => events.push(e));
  engine.init(true);
  return { state, sim, home, grocery, bank, gas, events, engine };
}

/** Engine.advance caps a single call at 3 days; advance day by day. */
function advanceDays(engine: Engine, days: number): void {
  for (let i = 0; i < days; i++) engine.advance(DAY, { allowInterrupt: false });
}
function total(sim: Sim): number {
  return sim.finance.accounts.reduce((s, a) => s + (a.kind === 'credit_card' ? -a.balance : a.balance), 0);
}
function assertNoNaN(v: unknown, path = 'root'): void {
  if (typeof v === 'number') expect(Number.isNaN(v), `${path} is NaN`).toBe(false);
  else if (Array.isArray(v)) v.forEach((x, i) => assertNoNaN(x, `${path}[${i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) assertNoNaN(x, `${path}.${k}`);
}
function addCar(w: World, fuel = 60): Vehicle {
  const v: Vehicle = { id: 'veh_test1', kind: 'car', make: 'Toyota', model: 'Corolla', year: 2019, color: 'silver', ownerHouseholdId: w.state.player.householdId, value: 14000, mileage: 62000, fuel, fuelType: 'gas', tankGallons: 13.2, mpg: 33, condition: 80, insurance: { provider: 'GEICO', monthly: 110, active: true, coverage: 'liability' }, location: { venueId: w.home.id }, seats: 5, issues: [], parkedIllegally: false };
  w.state.vehicles[v.id] = v;
  w.state.households[w.state.player.householdId].vehicleIds.push(v.id);
  return v;
}

// ---------------------------------------------------------------------------
describe('finance helpers', () => {
  it('computes 2026 federal tax and reconciliation', () => {
    expect(federalTax(0)).toBe(0);
    expect(federalTax(12400)).toBe(1240);
    expect(federalTax(50000)).toBeCloseTo(1240 + (50000 - 12400) * 0.12, 2);
    const r = computeTaxes(52000, 52000 * 0.2, 0);
    expect(r.fica).toBeCloseTo(3978, 2);
    expect(r.liability).toBeGreaterThan(0);
    expect(r.owed + r.refund).toBeGreaterThan(0);
    expect(r.owed === 0 || r.refund === 0).toBe(true);
    expect(monthlyPayment(10000, 0.06, 60)).toBeCloseTo(193.33, 1);
  });

  it('addBill upserts and removeBill clears flags', () => {
    const { sim } = world();
    addBill(sim, { id: 'gym', name: 'Gym', amount: 40, dueDayOfMonth: 3, category: 'subscription', autopay: true });
    addBill(sim, { id: 'gym', name: 'Gym', amount: 45, dueDayOfMonth: 3, category: 'subscription', autopay: true });
    expect(sim.finance.bills.filter((b) => b.id === 'gym')).toHaveLength(1);
    expect(sim.finance.bills.find((b) => b.id === 'gym')!.amount).toBe(45);
    sim.flags['bill_due:gym'] = 1;
    expect(removeBill(sim, 'gym')).toBe(true);
    expect(sim.flags['bill_due:gym']).toBeUndefined();
  });
});

describe('7-day household economy', () => {
  it('pays rent and utilities via bills, receives a paycheck, keeps invariants', () => {
    const w = world({ cash: 3000 });
    const { sim, state, engine, events } = w;
    // init created rent (due 1st), renters insurance (5th), utilities, phone plan bills
    const rent = sim.finance.bills.find((b) => b.id === 'rent')!;
    expect(rent.amount).toBe(1400);
    expect(sim.finance.bills.some((b) => b.id === 'util:electric')).toBe(true);
    expect(homeVenueOf(engine.ctx(), sim.id)?.id).toBe(w.home.id);
    // pull bills into the 7-day window (Sep 10 → Sep 17)
    rent.dueDayOfMonth = 12;
    for (const b of sim.finance.bills) if (b.id.startsWith('util:')) b.dueDayOfMonth = 14;
    sim.finance.bills.find((b) => b.id === 'insurance_renters')!.dueDayOfMonth = 13;
    const startTotal = total(sim);
    const utilTotal = sim.finance.bills.filter((b) => b.id.startsWith('util:')).reduce((s, b) => s + b.amount, 0);

    // day 1: advance to 09:00, simulate career paying a paycheck
    engine.advance(HOUR);
    const gross = 1800;
    const net = 1380;
    engine.applyEffects(sim.id, { money: { amount: net, memo: 'Paycheck — Barista', category: 'income' } }, 'career');
    engine.bus.emit({ type: 'money:paycheck', simId: sim.id, gross, net });
    expect(sim.finance.taxes.ytdIncome).toBe(gross);
    expect(sim.finance.taxes.ytdWithheld).toBeCloseTo(gross - net, 2);

    advanceDays(engine, 7);

    const paid = events.filter((e): e is Extract<GameEvent, { type: 'money:bill_paid' }> => e.type === 'money:bill_paid');
    expect(paid.some((e) => e.billId === 'rent')).toBe(true);
    expect(paid.some((e) => e.billId === 'util:electric')).toBe(true);
    expect(events.some((e) => e.type === 'money:bill_missed')).toBe(false);
    const insurance = sim.finance.bills.find((b) => b.id === 'insurance_renters')!.amount;
    const expected = startTotal + net - rent.amount - utilTotal - insurance;
    // savings interest is zero (no savings account); checking apy negligible
    expect(total(sim)).toBeCloseTo(expected, 0);
    expect(sim.finance.creditScore).toBeGreaterThanOrEqual(300);
    expect(sim.finance.creditScore).toBeLessThanOrEqual(850);
    expect(sim.finance.netWorthHistory.length).toBeGreaterThanOrEqual(7);
    expect(state.economy.stockIndex).toBeGreaterThan(0);
    expect(state.economy.gasPrice).toBeGreaterThan(2);
    // mail was delivered (bills due within 10 days) and the home was maintained
    const hh = state.households[state.player.householdId];
    expect(hh.mail.length).toBeGreaterThan(0);
    expect(hh.chores.length).toBeGreaterThan(0);
    expect(w.home.residence!.condition).toBeLessThan(75);
    expect(w.home.cleanliness).toBeGreaterThanOrEqual(0);
    assertNoNaN(state.sims);
    assertNoNaN(state.economy);
    assertNoNaN(state.households);
  });

  it('flags bills due, then marks them missed after 5 days when broke', () => {
    const w = world({ cash: 30 });
    const { sim, engine, events } = w;
    const rent = sim.finance.bills.find((b) => b.id === 'rent')!;
    rent.dueDayOfMonth = 11;
    advanceDays(engine, 2);
    expect(events.some((e) => e.type === 'money:bill_due' && e.billId === 'rent')).toBe(true);
    expect(sim.flags['bill_due:rent']).toBeDefined();
    expect(sim.phone.notifications.some((n) => n.title === 'Bill due')).toBe(true);
    const scoreBefore = sim.finance.creditScore;
    advanceDays(engine, 6);
    expect(events.some((e) => e.type === 'money:bill_missed' && e.billId === 'rent')).toBe(true);
    expect(rent.missed).toBe(1);
    expect(sim.flags['bill_arrears:rent']).toBe(1400);
    expect(sim.finance.creditScore).toBeLessThan(scoreBefore);
    // the phone app offers to pay the arrears
    const acts = engine.actionsFor(sim.id).map((a) => a.action.id);
    expect(acts).toContain('phone:bank:pay_bill:rent');
    assertNoNaN(sim.finance);
  });
});

describe('overdraft', () => {
  it('covers a small autopay bill by driving checking negative with a $35 fee, once per day', () => {
    const w = world({ cash: 150 });
    const { sim, engine, events } = w;
    const chk = sim.finance.accounts.find((a) => a.kind === 'checking')!;
    const cash = sim.finance.accounts.find((a) => a.kind === 'cash')!;
    cash.balance = 0;
    chk.balance = 40;
    // remove other bills so only the electric bill (autopay) hits
    sim.finance.bills = sim.finance.bills.filter((b) => b.id === 'util:electric');
    const bill = sim.finance.bills[0];
    bill.amount = 95;
    bill.autopay = true;
    bill.dueDayOfMonth = 11;
    engine.advance(DAY, { allowInterrupt: false });
    expect(events.some((e) => e.type === 'money:bill_paid' && e.billId === 'util:electric')).toBe(true);
    expect(chk.balance).toBeCloseTo(40 - 95 - 35, 2);
    expect(chk.overdraftFeesThisMonth).toBe(1);
    expect(sim.finance.transactions.some((t) => t.memo === 'Overdraft fee')).toBe(true);
  });

  it('reacts to money:insufficient from the effect pipeline', () => {
    const w = world({ cash: 200 });
    const { sim, engine } = w;
    const chk = sim.finance.accounts.find((a) => a.kind === 'checking')!;
    const cash = sim.finance.accounts.find((a) => a.kind === 'cash')!;
    cash.balance = 0;
    chk.balance = 20;
    engine.applyEffects(sim.id, { money: { amount: -60, memo: 'Copay', category: 'health' } }, 'health');
    expect(chk.balance).toBeCloseTo(20 - 60 - 35, 2);
    // second one the same day is not covered
    engine.applyEffects(sim.id, { money: { amount: -30, memo: 'Copay 2', category: 'health' } }, 'health');
    expect(chk.balance).toBeCloseTo(-75, 2);
  });
});

describe('finance actions', () => {
  it('opens accounts, takes a loan, transfers and reports balances at the bank', () => {
    const w = world({ cash: 1000 });
    const { sim, engine, bank } = w;
    engine.teleport(sim.id, bank.id);
    expect(engine.perform(sim.id, 'finance:open_savings').ok).toBe(true);
    expect(sim.finance.accounts.some((a) => a.kind === 'savings')).toBe(true);
    const r = engine.perform(sim.id, 'phone:bank:transfer_to_savings', { amount: 300 });
    expect(r.ok).toBe(true);
    expect(sim.finance.accounts.find((a) => a.kind === 'savings')!.balance).toBe(300);
    const before = total(sim);
    const loan = engine.perform(sim.id, 'finance:apply_loan', { amount: 2000 });
    expect(loan.ok).toBe(true);
    expect(sim.finance.loans).toHaveLength(1);
    expect(total(sim)).toBeCloseTo(before + 2000, 2);
    expect(sim.finance.loans[0].monthlyPayment).toBeGreaterThan(50);
    const cc = engine.perform(sim.id, 'finance:open_credit_card');
    expect(cc.ok).toBe(true);
    expect(sim.finance.accounts.some((a) => a.kind === 'credit_card' && (a.creditLimit ?? 0) >= 4000)).toBe(true);
    const bal = engine.perform(sim.id, 'phone:bank:check_balance');
    expect(bal.ok).toBe(true);
    expect(bal.text).toContain('Credit score');
    // savings accrues interest over a month; loan auto-debits
    advanceDays(engine, 31);
    expect(sim.finance.accounts.find((a) => a.kind === 'savings')!.balance).toBeGreaterThan(300);
    expect(sim.finance.loans[0].balance).toBeLessThan(2000);
    assertNoNaN(sim.finance);
  });

  it('runs the lottery deterministically without NaN', () => {
    const w = world();
    const { sim, engine } = w;
    for (let i = 0; i < 50; i++) engine.applyEffects(sim.id, { custom: [{ kind: 'finance:lottery_ticket' }] }, 'item');
    assertNoNaN(sim.finance);
    expect(total(sim)).toBeGreaterThanOrEqual(3000);
  });
});

describe('transport', () => {
  it('walking sets sim.travel and the engine fires arrival', () => {
    const w = world();
    const { sim, engine, grocery, events } = w;
    const id = `travel:${grocery.id}:walk`;
    const avail = engine.actionsFor(sim.id).find((a) => a.action.id === id);
    expect(avail?.available).toBe(true);
    const res = engine.perform(sim.id, id);
    expect(res.ok).toBe(true);
    expect(res.minutes).toBeGreaterThan(5);
    expect(sim.travel).toBeUndefined(); // engine advanced through the whole trip
    expect(sim.location.venueId).toBe(grocery.id);
    expect(events.some((e) => e.type === 'transport:departed' && e.to === grocery.id)).toBe(true);
    expect(events.some((e) => e.type === 'transport:arrived' && e.venueId === grocery.id)).toBe(true);
    expect(grocery.lastVisited).toBe(sim.location.arrivedAt);
  });

  it('driving drains fuel and moves the car', () => {
    const w = world();
    const { sim, engine, gas } = w;
    const car = addCar(w, 60);
    const est = estimateTravel(w.state, w.home.id, gas.id, 'drive', { vehicle: car });
    expect(est.distanceKm).toBeGreaterThan(1);
    const res = engine.perform(sim.id, `travel:${gas.id}:drive`);
    expect(res.ok).toBe(true);
    expect(car.fuel).toBeLessThan(60);
    expect(car.fuel).toBeGreaterThan(50);
    expect(car.mileage).toBeGreaterThan(62000);
    expect(car.location.venueId).toBe(gas.id);
    expect(sim.location.venueId).toBe(gas.id);
    // refuel at the station
    const refuel = engine.actionsFor(sim.id).find((a) => a.action.id === `transport:refuel:${car.id}`);
    expect(refuel?.available).toBe(true);
    const before = total(sim);
    expect(engine.perform(sim.id, `transport:refuel:${car.id}`).ok).toBe(true);
    expect(car.fuel).toBe(100);
    expect(total(sim)).toBeLessThan(before);
    // insurance bill gets attached to the household head at the daily rollup
    advanceDays(engine, 1);
    expect(sim.finance.bills.some((b) => b.id === `veh_ins:${car.id}`)).toBe(true);
  });

  it('runs out of fuel and converts to a walk', () => {
    const w = world();
    const { sim, engine, gas, events } = w;
    const car = addCar(w, 4);
    car.tankGallons = 0.4;
    const res = engine.perform(sim.id, `travel:${gas.id}:drive`);
    expect(res.ok).toBe(true);
    expect(events.some((e) => e.type === 'transport:out_of_fuel')).toBe(true);
    expect(car.fuel).toBe(0);
    expect(car.location.venueId).toBe(w.home.id);
    expect(sim.location.venueId).toBe(gas.id);
  });

  it('estimates and chooses modes deterministically', () => {
    const w = world();
    const walk = estimateTravel(w.state, w.home.id, w.grocery.id, 'walk');
    const ride = estimateTravel(w.state, w.home.id, w.grocery.id, 'rideshare');
    expect(walk.minutes).toBeGreaterThan(ride.minutes - ride.minutes); // sanity: positive
    expect(ride.cost).toBeGreaterThanOrEqual(8);
    expect(chooseMode(w.state, w.sim, w.home.id, w.grocery.id)).toBe('walk');
    addCar(w);
    const farId = Object.values(w.state.venues).find((v) => v.name === 'Round Rock Outlets')!.id as VenueId;
    expect(chooseMode(w.state, w.sim, w.home.id, farId)).toBe('drive');
  });
});

describe('shopping', () => {
  it('buying an item moves money and grants the item; groceries go to the pantry at home', () => {
    const w = world();
    const { sim, engine, grocery, state } = w;
    engine.teleport(sim.id, grocery.id);
    const id = `shop:${grocery.id}:milk`;
    const avail = engine.actionsFor(sim.id).find((a) => a.action.id === id);
    expect(avail?.available).toBe(true);
    const before = total(sim);
    const res = engine.perform(sim.id, id, { qty: 2 });
    expect(res.ok).toBe(true);
    expect(sim.inventory.consumables.milk).toBe(2);
    const unit = 3.79 * state.region.costOfLiving;
    expect(before - total(sim)).toBeCloseTo(unit * 2, 1);
    // beer is taxed and age-gated (Ada is 28, so allowed)
    const beer = engine.actionsFor(sim.id).find((a) => a.action.id === `shop:${grocery.id}:beer`);
    expect(beer?.available).toBe(true);
    expect(beer!.action.cost!.amount).toBeCloseTo(10.99 * state.region.costOfLiving * (1 + state.region.salesTax), 1);
    // weekly cart, then walk home → pantry
    expect(engine.perform(sim.id, `shop:${grocery.id}:cart`).ok).toBe(true);
    expect(sim.inventory.consumables.chicken).toBe(2);
    expect(engine.perform(sim.id, `travel:${w.home.id}:walk`).ok).toBe(true);
    const hh = state.households[state.player.householdId];
    expect(hh.pantry.milk).toBe(3);
    expect(hh.pantry.chicken).toBe(2);
    expect(sim.inventory.consumables.milk).toBeUndefined();
    expect(sim.inventory.consumables.toilet_paper).toBe(1); // non-food stays with the sim
  });

  it('orders an object online and it arrives at home', () => {
    const w = world();
    const { sim, engine, state, events } = w;
    const res = engine.perform(sim.id, 'phone:shop:obj:sofa', { tier: 3 });
    expect(res.ok).toBe(true);
    expect(state.scheduled.some((e) => e.kind === 'delivery')).toBe(true);
    advanceDays(engine, 6);
    const sofa = Object.values(state.objects).find((o) => o.defId === 'sofa');
    expect(sofa).toBeDefined();
    expect(sofa!.venueId).toBe(w.home.id);
    expect(sofa!.quality).toBe(3);
    expect(events.some((e) => e.type === 'shop:object_purchased')).toBe(true);
  });

  it('food delivery arrives as a scheduled event', () => {
    const w = world();
    const { sim, engine } = w;
    const res = engine.perform(sim.id, 'phone:delivery:food');
    expect(res.ok).toBe(true);
    engine.advance(60, { allowInterrupt: false });
    expect(sim.inventory.consumables.restaurant_meal).toBe(1);
  });
});

describe('amenities', () => {
  it('cuts electricity after two missed cycles and spoils perishables, then restores on payment', () => {
    const w = world({ cash: 10 });
    const { sim, engine, state, events } = w;
    const hh = state.households[state.player.householdId];
    hh.pantry.milk = 2;
    hh.pantry.rice = 1;
    const tv = { ...Object.values(state.objects)[0] };
    void tv;
    const bill = sim.finance.bills.find((b) => b.id === 'util:electric')!;
    sim.finance.bills = [bill];
    sim.finance.accounts.forEach((a) => (a.balance = 0));
    // two missed cycles
    engine.bus.emit({ type: 'money:bill_missed', simId: sim.id, billId: bill.id, amount: bill.amount });
    engine.bus.emit({ type: 'money:bill_missed', simId: sim.id, billId: bill.id, amount: bill.amount });
    expect(events.some((e) => e.type === 'amenity:cut' && e.kind === 'electric')).toBe(true);
    expect(w.home.tags).toContain('no_electric');
    expect(hh.pantry.milk).toBeUndefined();
    expect(hh.pantry.rice).toBe(1);
    const fridge = Object.values(state.objects).find((o) => o.defId === 'fridge')!;
    expect(fridge.state.custom?.noPower).toBe(true);
    // pay → restored (reconnection fee charged through effects)
    sim.finance.accounts.find((a) => a.kind === 'checking')!.balance = 500;
    engine.bus.emit({ type: 'money:bill_paid', simId: sim.id, billId: bill.id, amount: bill.amount });
    expect(events.some((e) => e.type === 'amenity:restored')).toBe(true);
    expect(w.home.tags).not.toContain('no_electric');
    expect(fridge.state.custom?.noPower).toBeUndefined();
  });

  it('delivers mail at 14:00 and drains the phone battery', () => {
    const w = world();
    const { sim, engine, state, events } = w;
    sim.phone.battery = 50;
    engine.advance(8 * HOUR, { allowInterrupt: false }); // 08:00 → 16:00
    const hh = state.households[state.player.householdId];
    expect(events.some((e) => e.type === 'amenity:mail')).toBe(true);
    expect(hh.mail.length).toBeGreaterThan(0);
    expect(sim.phone.battery).toBeLessThan(50);
    const res = engine.perform(sim.id, 'amenity:check_mail');
    expect(res.ok).toBe(true);
    expect(hh.mail.every((m) => m.read)).toBe(true);
  });
});

describe('property', () => {
  it('signs a lease from listings and moves the household', () => {
    const w = world({ cash: 8000 });
    const { sim, engine, state, events } = w;
    const listings = engine.actionsFor(sim.id).filter((a) => a.action.id.startsWith('property:sign_lease:'));
    expect(listings.length).toBeGreaterThan(0);
    const pick = listings.find((l) => l.available) ?? listings[0];
    const oldHome = state.households[state.player.householdId].homeVenueId;
    const res = engine.perform(sim.id, pick.action.id);
    expect(res.ok, res.reason).toBe(true);
    const hh = state.households[state.player.householdId];
    expect(hh.homeVenueId).not.toBe(oldHome);
    expect(sim.location.venueId).toBe(hh.homeVenueId);
    const newHome = state.venues[hh.homeVenueId];
    expect(newHome.residence?.tenure).toBe('rent');
    expect(newHome.objectIds.length).toBeGreaterThanOrEqual(5); // essentials
    expect(sim.finance.bills.find((b) => b.id === 'rent')!.amount).toBe(newHome.residence!.monthlyRent);
    expect(sim.finance.bills.some((b) => b.id === 'util:electric' && b.linkedId === newHome.id)).toBe(true);
    expect(events.some((e) => e.type === 'property:lease_signed')).toBe(true);
    expect(events.some((e) => e.type === 'property:moved')).toBe(true);
  });

  it('evicts after three missed rent payments', () => {
    const w = world({ cash: 0 });
    const { sim, engine, state, events } = w;
    sim.finance.accounts.forEach((a) => (a.balance = 0));
    const rent = sim.finance.bills.find((b) => b.id === 'rent')!;
    rent.missed = 2;
    sim.flags.eviction_stage = 2;
    engine.bus.emit({ type: 'money:bill_missed', simId: sim.id, billId: 'rent', amount: rent.amount });
    rent.missed = 3;
    engine.advance(DAY, { allowInterrupt: false });
    expect(events.some((e) => e.type === 'money:evicted')).toBe(true);
    const hh = state.households[state.player.householdId];
    expect(state.venues[hh.homeVenueId].archetype).toBe('shelter');
    expect(sim.location.venueId).toBe(hh.homeVenueId);
    expect(sim.finance.bills.some((b) => b.id === 'rent')).toBe(false);
  });

  it('repairs a broken object via a service call', () => {
    const w = world();
    const { sim, engine, state, events } = w;
    const fridge = Object.values(state.objects).find((o) => o.defId === 'fridge')!;
    fridge.state.broken = true;
    engine.bus.emit({ type: 'property:broken', objectId: fridge.id, venueId: w.home.id });
    const id = `property:repair_call:${fridge.id}`;
    expect(engine.actionsFor(sim.id).some((a) => a.action.id === id && a.available)).toBe(true);
    expect(engine.perform(sim.id, id).ok).toBe(true);
    advanceDays(engine, 4);
    expect(fridge.state.broken).toBe(false);
    expect(events.some((e) => e.type === 'property:repaired')).toBe(true);
  });
});
