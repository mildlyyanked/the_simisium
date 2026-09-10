/**
 * Object catalog — every piece of furniture, appliance, fixture and public amenity a sim
 * can interact with, at home and in the world. Think a present-day US Sims catalog.
 *
 * Interactions produce `EffectBundle`s (core/effects.ts). Long actions use `perMinute`.
 * Cooking interactions are generated from `content/recipes.ts` (`cook:<recipeId>`), and
 * "Eat …" interactions from the prepared-food items in `content/items.ts`.
 *
 * Balance anchors (see docs/BUILDER_GUIDE.md):
 *   sleep 480 min → energy 0→100 (≈+0.28/min net of decay) · meal +45..70 hunger by quality
 *   shower +50 hygiene / 15 min · 45-min workout: fitness +1.5 fun +10 energy −20 hygiene −25
 *   weight −0.15 fitness xp 25 · TV fun +0.35/min
 *
 * ---------------------------------------------------------------------------------------
 * CUSTOM EVENT KINDS EMITTED (ctx.emit({type:'custom', kind, simId, payload})) — the owning
 * system listens for these. Prefix = owning system.
 *
 *  chore:clean        { amount, target:'object'|'room'|'venue', task? }  property: lowers dirtiness / raises venue cleanliness
 *  chore:laundry      { loads }                                        property: household laundry done (hygiene of clothes)
 *  chore:trash        {}                                               property: trash taken out
 *  chore:recycle      {}                                               property: recycling taken out
 *  chore:dishes       { amount }                                       property: dishes done
 *  chore:yard         { task:'mow'|'weed'|'rake'|'water' }             property: yard upkeep
 *  property:thermostat { mode:'heat'|'cool'|'eco'|'off', target? }     property: sets HVAC mode (bill impact)
 *  property:security   { action:'lock'|'unlock'|'review_footage'|'test_alarm'|'replace_battery' }
 *  property:repair     { skill:'handiness', tool? }                    property: repair a broken object in the venue
 *  property:upgrade    { what }                                        property: DIY improvement (condition+)
 *  property:storage    { action:'store'|'retrieve' }                   property: storage unit access
 *  health:sleep        { minutes, quality }                            health: sleep debt / recovery
 *  health:checkup      { kind:'physical'|'urgent'|'dental'|'xray'|'lab' } health: exam, diagnosis, billing via insurance
 *  health:medicate     { itemId }                                      health: drug effect (from items)
 *  health:nicotine / health:cannabis                                    health: addiction tracking (from items)
 *  health:hospital_rest { minutes }                                    health: inpatient recovery
 *  health:massage / health:sauna / health:tan / health:therapy         health: wellness treatments
 *  health:hygiene_full { }                                             health: full wash (resets body odor flags)
 *  health:vaccine      { }                                             health: flu shot etc.
 *  health:pharmacy     { action:'pickup'|'consult' }                   health: fill prescriptions
 *  health:tattoo       { }                                             health/identity: adds a distinguishing feature
 *  health:workout      { minutes, kind }                               health/fitness tracking
 *  finance:withdraw / finance:deposit { amount }                       finance: ATM / teller cash movement
 *  finance:check_balance {}                                            finance: shows balances
 *  finance:pay_bills   { via:'computer'|'phone'|'teller' }             finance: pay due bills
 *  finance:open_account { kind:'checking'|'savings' }                  finance
 *  finance:apply_loan  { kind:'personal'|'auto'|'mortgage'|'student' } finance
 *  finance:apply_card  {}                                              finance
 *  finance:consult     { pro:'accountant'|'financial_advisor'|'insurance_agent'|'realtor' }
 *  finance:file_taxes  { assisted }                                    finance
 *  finance:insurance   { action:'quote'|'buy'|'claim', kind }          finance
 *  finance:cash_check  {}                                              finance
 *  finance:lottery     { itemId, price }                               finance (from items + slot/lottery objects)
 *  finance:sell_item   { itemId }                                      finance/shop: sell used goods (thrift/pawn)
 *  finance:safe        { action:'deposit'|'withdraw' }                 finance: home safe cash
 *  transport:refuel    { gallons?, full? }                             transport: fuel household vehicle
 *  transport:charge_ev { minutes, level }                              transport
 *  transport:bus / transport:train { }                                 transport: board next service (fare handled there)
 *  transport:buy_ticket { kind:'transit'|'rail'|'flight' }             transport
 *  transport:flight    { }                                             transport: board flight
 *  transport:security_screening {}                                     transport/law: TSA screening
 *  transport:car_wash  { level }                                       transport: vehicle condition/appearance
 *  transport:service   { job:'oil_change'|'inspection'|'repair'|'tires'|'diagnose' } transport: mechanic work
 *  transport:parts     {}                                              transport: buy parts (handiness DIY)
 *  transport:browse_vehicles {} / transport:buy_vehicle {} / transport:test_drive {}
 *  transport:rent_vehicle { days }                                     transport
 *  transport:park      { action:'park'|'pay_meter' }                   transport/law
 *  transport:bike      { action:'maintain'|'lock' }                    transport
 *  legal:renew_license / legal:license_test / legal:register_vehicle / legal:real_id   law/dmv
 *  legal:consult       { pro:'lawyer'|'paralegal' }                    law
 *  legal:file          { form:'permit'|'marriage_license'|'name_change'|'complaint'|'small_claims'|'voter_registration' }
 *  legal:pay_fine      {}                                              law
 *  legal:report        { kind:'crime'|'lost_property'|'noise' }        law: police desk
 *  legal:court         { action:'wait'|'hearing'|'jury' }              law
 *  legal:custody       { action:'wait'|'sleep'|'call' }                law: holding cell / jail
 *  legal:bail          {}                                              law
 *  amenity:check_mail / amenity:send_mail / amenity:ship_package        amenities: mailbox & post office
 *  amenity:restroom    {}                                              amenities: public restroom used
 *  amenity:borrow_book / amenity:return_book                           amenities/library
 *  amenity:food_bank / amenity:shelter_bed                             amenities: social services
 *  amenity:hotel       { action:'checkin'|'checkout'|'room_service' }  amenities/hospitality
 *  amenity:laundromat  { loads }                                       amenities
 *  amenity:vending     { itemId }                                      amenities
 *  amenity:water       {}                                              amenities: free water
 *  career:work_remote  { minutes }                                     career: remote shift progress
 *  career:work_task    { minutes, kind:'desk'|'line'|'warehouse'|'register'|'kitchen'|'lab'|'classroom' }
 *  career:job_search   { via }                                         career: browse listings
 *  career:meeting      {}                                              career: performance/social at work
 *  career:print        { pages }                                       career/office
 *  career:gig          { kind }                                        career: gig work session
 *  career:perform      { skill, venue }                                career/entertainment: stage performance & tips
 *  career:stream       { minutes }                                     career: streaming session
 *  education:study     { minutes, subject? }                           education
 *  education:lecture / education:homework / education:lab / education:research / education:tutor
 *  education:daycare   { action:'dropoff'|'pickup' }                   education/family
 *  shop:browse         { section }                                     shopping: opens the store's catalog for that section
 *  shop:checkout       {}                                              shopping: pay for cart
 *  shop:ask_staff / shop:return_item / shop:try_on { }                 shopping
 *  shop:order          { what:'coffee'|'pastry'|'food'|'drink'|'cocktail'|'beer'|'concession'|'street_food'|'produce'|'flowers'|'meat'|'deli'|'bakery'|'liquor'|'cannabis' }
 *  pet:vet_exam / pet:adopt / pet:board / pet:feed / pet:play / pet:litter / pet:walk / pet:groom / pet:train / pet:aquarium_care / pet:cage_care
 *  family:put_infant_down / family:feed_infant / family:change_diaper / family:play_with_child / family:read_to_child / family:tuck_in
 *  entertainment:watch  { channel }                                    entertainment: TV/cinema (news awareness, sports fandom)
 *  entertainment:game   { kind, minutes }                              entertainment: gaming sessions / achievements
 *  entertainment:ticket { kind }                                       entertainment: admission (from items)
 *  entertainment:ride   { ride }                                       entertainment: theme-park ride
 *  entertainment:exhibit { kind }                                      entertainment: museum/zoo/aquarium learning
 *  entertainment:karaoke / entertainment:dance / entertainment:dj      entertainment: performances at venues
 *  entertainment:gamble { game, bet, net }                             entertainment/finance: problem-gambling tracking
 *  entertainment:social_media { action:'post'|'scroll' }               communication
 *  civic:pray / civic:service / civic:volunteer / civic:vote / civic:meeting   civic
 *  civic:donate        { amount }                                      civic/finance
 *  phone:charge        { amount }                                      communication
 *  social:video_call {} / social:online_date {}                        communication/relationships
 * ---------------------------------------------------------------------------------------
 */
import type { ActionCategory, EffectBundle, EmotionId, ItemId, LifeStage, MoodletSpec, NeedId, ObjectCategory, OutcomeTable, Requirement, SkillId } from '../core/types';
import type { InteractionDef, ObjectDef, RecipeDef } from './types';
import { recipesForObject } from './recipes';
import { ITEMS, MEAL_ITEM_IDS } from './items';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mood = (emotion: EmotionId, label: string, intensity: number, durationMinutes: number): MoodletSpec => ({ emotion, label, intensity, durationMinutes });
const cx = (kind: string, payload?: Record<string, unknown>) => ({ kind, payload });
const skillReq = (skillId: SkillId, level: number): Requirement => ({ kind: 'skill', reason: `Needs ${skillId} ${level}`, params: { skillId, level } });
const timeReq = (start: number, end: number, reason: string): Requirement => ({ kind: 'time_window', reason, params: { start, end } });
const flagReq = (flag: string, reason: string, not = false): Requirement => ({ kind: 'flag', reason, params: { flag, not } });
const itemReq = (itemId: ItemId, qty = 1): Requirement => ({ kind: 'item', reason: `Need ${itemId.replace(/_/g, ' ')}`, params: { itemId, qty, pantry: true } });
const round2 = (n: number) => Math.round(n * 100) / 100;

type IOpts = Omit<InteractionDef, 'effects'> & { effects?: EffectBundle };
const act = (o: IOpts): InteractionDef => ({ effects: {}, ...o });

interface ODef {
  id: string;
  name: string;
  category: ObjectCategory;
  icon: string;
  basePrice: number;
  description: string;
  interactions: InteractionDef[];
  portable?: boolean;
  durabilityUses?: number;
  repairCost?: number;
  runningCostMonthly?: number;
  requiresUtility?: ObjectDef['requiresUtility'];
  rooms?: string[];
  tags?: string[];
  ambient?: ObjectDef['ambient'];
  tiers?: number[];
}
const def = (o: ODef): ObjectDef => ({
  portable: false,
  durabilityUses: 2000,
  repairCost: round2(Math.max(15, o.basePrice * 0.15)),
  tiers: [1, 1.5, 2.2, 3.5, 6],
  tags: [],
  ...o,
});

const YA: LifeStage = 'young_adult';
const TEEN: LifeStage = 'teen';
const CHILD: LifeStage = 'child';

// ---- shared interaction factories -----------------------------------------------------

/** Sleeping surface. `rate` = energy per minute. */
const sleepSet = (rate: number, comfort: number, quality: number, opts: { sleepLabel?: string; nap?: boolean; scroll?: boolean; make?: boolean } = {}): InteractionDef[] => {
  const out: InteractionDef[] = [
    act({
      id: 'sleep', label: opts.sleepLabel ?? 'Sleep', description: 'Sleep for the night.', category: 'needs', icon: '😴', durationMinutes: 480,
      effects: { perMinute: { energy: rate, comfort }, needs: { hunger: -10, bladder: -20 }, stress: -8, custom: [cx('health:sleep', { minutes: 480, quality })] },
      satisfies: ['energy'], autonomyWeight: 3, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true }, dirtiesBy: 2, wearBy: 0.4, group: 'Rest',
    }),
  ];
  if (opts.nap !== false)
    out.push(act({
      id: 'nap', label: 'Take a nap', description: 'A 60-minute power nap.', category: 'needs', icon: '💤', durationMinutes: 60,
      effects: { perMinute: { energy: rate * 0.8, comfort: comfort * 0.5 }, needs: { fun: -2 }, custom: [cx('health:sleep', { minutes: 60, quality })] },
      satisfies: ['energy'], autonomyWeight: 1.2, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true }, dirtiesBy: 1, wearBy: 0.2, group: 'Rest',
    }));
  if (opts.scroll !== false)
    out.push(act({
      id: 'scroll_phone', label: 'Lie down and scroll', description: 'Doomscroll in bed.', category: 'entertainment', icon: '📱', durationMinutes: 30,
      effects: { perMinute: { fun: 0.3, comfort: 0.2, energy: 0.02 }, needs: { social: 4 }, stress: 1, custom: [cx('entertainment:social_media', { action: 'scroll' })] },
      satisfies: ['fun', 'comfort'], autonomyWeight: 0.8, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Rest',
    }));
  if (opts.make !== false)
    out.push(act({
      id: 'make_bed', label: 'Make the bed', category: 'chores', icon: '🛏️', durationMinutes: 4,
      effects: { needs: { comfort: 2 }, custom: [cx('chore:clean', { amount: 8, target: 'object', task: 'make_bed' })], moodlets: [mood('proud', 'Made the bed', 2, 240)] },
      autonomyWeight: 0.3, group: 'Chores',
    }));
  return out;
};

/** Generic chore: clean this object. */
const clean = (what: string, minutes = 15, amount = 20, extra: Partial<IOpts> = {}): InteractionDef =>
  act({
    id: 'clean', label: `Clean the ${what}`, category: 'chores', icon: '🧽', durationMinutes: minutes,
    effects: { needs: { fun: -3, hygiene: -3 }, custom: [cx('chore:clean', { amount, target: 'object' })], moodlets: [mood('proud', 'Clean space', 2, 180)] },
    autonomyWeight: 0.35, group: 'Chores', ...extra,
  });

/** Sit and relax on a seat. */
const sit = (label: string, comfort: number, fun = 0.05, minutes = 30): InteractionDef =>
  act({
    id: 'sit', label, category: 'needs', icon: '🪑', durationMinutes: minutes,
    effects: { perMinute: { comfort, fun, energy: 0.03 }, stress: -3 },
    satisfies: ['comfort'], autonomyWeight: 0.6, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true }, wearBy: 0.2, group: 'Relax',
  });

/** Read a book somewhere comfy. */
const read = (comfort = 0.1, minutes = 45, extraSkill: SkillId = 'research'): InteractionDef =>
  act({
    id: 'read', label: 'Read a book', category: 'hobby', icon: '📖', durationMinutes: minutes,
    effects: { perMinute: { fun: 0.25, comfort }, skills: { [extraSkill]: 8, writing: 4 }, stress: -6, moodlets: [mood('relaxed', 'Good book', 3, 120)] },
    satisfies: ['fun'], autonomyWeight: 0.7, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Relax',
  });

/** Watch TV interactions for any screen. `rate` = fun per minute. */
const tvSet = (rate: number, big = false): InteractionDef[] => {
  const comfort = big ? 0.1 : 0.06;
  const w = (id: string, label: string, minutes: number, channel: string, extra: Partial<EffectBundle> = {}, opts: Partial<IOpts> = {}) =>
    act({
      id, label, category: 'entertainment', icon: '📺', durationMinutes: minutes,
      effects: { perMinute: { fun: rate, comfort }, custom: [cx('entertainment:watch', { channel, minutes })], ...extra },
      satisfies: ['fun'], autonomyWeight: 1, requiresState: { notBroken: true }, setsState: { on: true }, wearBy: 0.3, group: 'Watch', ...opts,
    });
  return [
    w('watch_news', 'Watch the news', 30, 'news', { stress: 3, skills: { research: 3 }, moodlets: [mood('anxious', 'The news…', -2, 120)] }, { autonomyWeight: 0.6 }),
    w('watch_sitcom', 'Watch a sitcom', 30, 'sitcom', { stress: -4, moodlets: [mood('happy', 'Good laugh', 3, 90)] }),
    w('watch_sports', 'Watch the game', 150, 'sports', { needs: { social: 5 }, moodlets: [mood('energized', 'Game day', 4, 180)] }, { autonomyWeight: 0.7 }),
    w('watch_movie', 'Watch a movie', 120, 'movie', { stress: -6, moodlets: [mood('relaxed', 'Movie night', 4, 180)] }),
    w('binge', 'Binge a series', 240, 'streaming', { stress: -5, needs: { energy: -6 }, moodlets: [mood('bored', 'Couch-locked', -2, 60)] }, { autonomyWeight: 0.5 }),
    w('watch_cartoons', 'Watch cartoons', 60, 'kids', { moodlets: [mood('playful', 'Cartoons!', 4, 90)] }, { autonomyWeight: 0.5 }),
  ];
};

/** Fitness session scaled from the 45-minute anchor. */
const workout = (
  id: string,
  label: string,
  minutes: number,
  o: { icon?: string; intensity?: number; skill?: SkillId; fun?: number; stress?: number; kind?: string; description?: string; minStage?: LifeStage; group?: string; wearBy?: number; requirements?: Requirement[] } = {},
): InteractionDef => {
  const f = (minutes / 45) * (o.intensity ?? 1);
  const skill = o.skill ?? 'fitness';
  return act({
    id, label, description: o.description, category: 'fitness', icon: o.icon ?? '💪', durationMinutes: minutes,
    effects: {
      fitness: round2(1.5 * f), weight: round2(-0.15 * f), needs: { fun: o.fun ?? Math.round(10 * f), energy: Math.round(-20 * f), hygiene: Math.round(-25 * f), thirst: Math.round(-15 * f) },
      skills: { [skill]: Math.round(25 * f) }, stress: o.stress ?? Math.round(-6 * f), health: round2(0.3 * f),
      moodlets: [mood('energized', 'Post-workout glow', 4, 180)], custom: [cx('health:workout', { minutes, kind: o.kind ?? id })],
    },
    satisfies: ['fun'], autonomyWeight: 0.6, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true }, wearBy: o.wearBy ?? 1.2, dirtiesBy: 4, minStage: o.minStage ?? TEEN, group: o.group ?? 'Workout',
    requirements: o.requirements,
  });
};

/** Practice a creative skill. */
const practice = (id: string, label: string, skill: SkillId, minutes: number, o: { icon?: string; fun?: number; xp?: number; stress?: number; energy?: number; noise?: boolean; group?: string; description?: string; wearBy?: number; consumes?: { itemId: ItemId; qty: number }[]; minLevel?: number } = {}): InteractionDef =>
  act({
    id, label, description: o.description, category: 'hobby', icon: o.icon ?? '🎨', durationMinutes: minutes,
    effects: { skills: { [skill]: o.xp ?? Math.round(minutes * 0.55) }, needs: { fun: o.fun ?? Math.round(minutes * 0.25), energy: o.energy ?? Math.round(-minutes * 0.08) }, stress: o.stress ?? -4, moodlets: [mood('inspired', 'Creative flow', 3, 120)] },
    satisfies: ['fun'], autonomyWeight: 0.6, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true }, wearBy: o.wearBy ?? 0.5, group: o.group ?? 'Hobby', consumes: o.consumes,
    requirements: o.minLevel ? [skillReq(skill, o.minLevel)] : undefined,
  });

/** Cooking interactions generated from the recipe table. */
const cookSet = (objectDefId: string, verb = 'Cook'): InteractionDef[] =>
  recipesForObject(objectDefId).map((r: RecipeDef) => {
    const v = r.skillId === 'baking' ? 'Bake' : r.tags.includes('no_cook') || r.tags.includes('drink') ? 'Make' : verb;
    const xp = Math.round(6 + r.durationMinutes * 0.5 + r.minLevel * 3);
    const outcomes: OutcomeTable = {
      outcomes: [
        { weight: 12 + r.minLevel * 2, label: 'Turned out great', effects: { moodlets: [mood('proud', `Nailed the ${r.name.toLowerCase()}`, 3, 120)] }, skillId: r.skillId, skillBias: 2 },
        { weight: 20, label: 'Came out fine', effects: {} },
        { weight: 4 + r.minLevel * 2, label: 'Slightly burnt', effects: { needs: { fun: -4 }, moodlets: [mood('embarrassed', 'Burnt it a little', -2, 60)] } },
      ],
    };
    return act({
      id: `cook:${r.id}`, label: `${v} ${r.name.toLowerCase()}`, description: `${r.servings} serving${r.servings > 1 ? 's' : ''} · ${r.calories} kcal each`, category: 'needs', icon: r.skillId === 'baking' ? '🧁' : '🍳', durationMinutes: r.durationMinutes,
      consumes: r.ingredients, produces: [{ itemId: r.producesItemId, qty: r.servings }],
      effects: { skills: { [r.skillId]: xp }, needs: { fun: Math.round(2 + (r.fun ?? 0) * 0.3), hygiene: -3, thirst: -2 }, stress: -1 },
      outcomes,
      requirements: r.minLevel > 0 ? [skillReq(r.skillId, r.minLevel)] : undefined,
      satisfies: ['hunger'], autonomyWeight: 1.1, requiresState: { notBroken: true, maxDirty: 85 }, dirtiesBy: r.durationMinutes > 30 ? 10 : 6, wearBy: 0.8, group: v === 'Bake' ? 'Bake' : 'Cook',
    });
  });

/** "Eat <meal>" interactions for prepared-food items. */
const eatSet = (ids: ItemId[], comfort: number, minutes = 20, group = 'Eat'): InteractionDef[] =>
  ids.map((id) => {
    const it = ITEMS[id];
    const eff: EffectBundle = { ...(it?.effects ?? {}) };
    eff.needs = { ...(eff.needs ?? {}), comfort: (eff.needs?.comfort ?? 0) + comfort, thirst: (eff.needs?.thirst ?? 0) + 5 };
    return act({
      id: `eat:${id}`, label: `Eat ${it?.name.toLowerCase() ?? id}`, category: 'needs', icon: '🍽️', durationMinutes: minutes,
      consumes: [{ itemId: id, qty: 1 }], effects: eff, satisfies: ['hunger'], autonomyWeight: 2, dirtiesBy: 4, group,
    });
  });

/** Drinks straight from the fridge / pantry. */
const drinkSet = (ids: ItemId[], group = 'Drink'): InteractionDef[] =>
  ids.map((id) => {
    const it = ITEMS[id];
    return act({
      id: `drink:${id}`, label: `Drink ${it?.name.toLowerCase() ?? id}`, category: 'needs', icon: '🥤', durationMinutes: 3,
      consumes: [{ itemId: id, qty: 1 }], effects: it?.effects ?? { needs: { thirst: 20 } }, satisfies: ['thirst'], autonomyWeight: 1.6, group,
      minStage: it?.category === 'alcohol' ? YA : undefined,
    });
  });

const snackSet = (ids: ItemId[], group = 'Snack'): InteractionDef[] =>
  ids.map((id) => {
    const it = ITEMS[id];
    return act({
      id: `snack:${id}`, label: `Snack on ${it?.name.toLowerCase() ?? id}`, category: 'needs', icon: '🍪', durationMinutes: 5,
      consumes: [{ itemId: id, qty: 1 }], effects: it?.effects ?? { needs: { hunger: 12 } }, satisfies: ['hunger'], autonomyWeight: 0.9, group,
    });
  });

/** Order something from a counter (money out, need in). */
const order = (id: string, label: string, cost: number, minutes: number, effects: EffectBundle, o: Partial<IOpts> = {}): InteractionDef =>
  act({ id, label, category: 'needs', icon: '🧾', durationMinutes: minutes, cost, effects, autonomyWeight: 1, group: 'Order', ...o });

/** Casino-style gamble with a fixed stake. */
const gamble = (id: string, label: string, game: string, bet: number, minutes: number, table: { weight: number; label: string; net: number; skillId?: SkillId; skillBias?: number }[], o: Partial<IOpts> = {}): InteractionDef =>
  act({
    id, label, description: `Stake $${bet}.`, category: 'entertainment', icon: '🎰', durationMinutes: minutes, cost: bet,
    effects: { needs: { fun: 6 }, custom: [cx('entertainment:gamble', { game, bet })] },
    outcomes: {
      outcomes: table.map((t) => ({
        weight: t.weight, label: t.label, skillId: t.skillId, skillBias: t.skillBias,
        effects: t.net > 0
          ? { money: { amount: round2(t.net), memo: `${label} — won`, category: 'gambling' }, needs: { fun: 10 }, moodlets: [mood('energized', 'Winner!', 6, 120)], custom: [cx('entertainment:gamble', { game, bet, net: t.net })] }
          : { needs: { fun: -4 }, stress: 3, moodlets: [mood('sad', 'Lost the bet', -3, 90)], custom: [cx('entertainment:gamble', { game, bet, net: -bet })] },
      })),
    },
    minStage: YA, autonomyWeight: 0.2, group: 'Gamble', requirements: [{ kind: 'age', reason: 'Must be 21+', params: { minAge: 21 } }], ...o,
  });

/** Public seating. */
const seat = (label = 'Sit down', comfort = 0.12): InteractionDef[] => [
  sit(label, comfort, 0.04, 20),
  act({ id: 'people_watch', label: 'People-watch', category: 'entertainment', icon: '👀', durationMinutes: 20, effects: { perMinute: { fun: 0.15, comfort: comfort * 0.6 }, needs: { social: 3 }, stress: -3 }, satisfies: ['fun'], autonomyWeight: 0.5, llm: 'narrate', group: 'Relax' }),
  act({ id: 'scroll', label: 'Scroll your phone', category: 'phone', icon: '📱', durationMinutes: 15, effects: { perMinute: { fun: 0.25 }, needs: { social: 3 }, custom: [cx('entertainment:social_media', { action: 'scroll' })] }, satisfies: ['fun'], autonomyWeight: 0.6, group: 'Relax' }),
];

/** Work-at-a-station interaction for staff. */
const workTask = (id: string, label: string, kind: string, minutes: number, o: { icon?: string; skills?: Partial<Record<SkillId, number>>; energy?: number; stress?: number; hygiene?: number; fun?: number; description?: string } = {}): InteractionDef =>
  act({
    id, label, description: o.description ?? 'On the clock.', category: 'work', icon: o.icon ?? '🧑‍💼', durationMinutes: minutes,
    effects: { needs: { energy: o.energy ?? -Math.round(minutes * 0.08), fun: o.fun ?? -Math.round(minutes * 0.04), hygiene: o.hygiene ?? -Math.round(minutes * 0.03), social: 2 }, stress: o.stress ?? Math.round(minutes * 0.05), skills: o.skills ?? {}, custom: [cx('career:work_task', { minutes, kind })] },
    autonomyWeight: 0.4, group: 'Work',
  });

const MEALS_HOME: ItemId[] = MEAL_ITEM_IDS;
const MEALS_QUICK: ItemId[] = ['leftovers', 'takeout_meal', 'fast_food_meal', 'sandwich', 'meal_basic'];
const DESSERTS: ItemId[] = ['ice_cream', 'cookies', 'brownies', 'cake', 'pie', 'muffins', 'chocolate'];
const SNACKS: ItemId[] = ['snacks', 'chips', 'fruit', 'yogurt', 'protein_bar', 'cereal'];
const COLD_DRINKS: ItemId[] = ['water_bottle', 'soda', 'juice', 'milk', 'energy_drink', 'beer', 'wine'];

const ALL: ObjectDef[] = [];
const add = (...defs: ObjectDef[]) => ALL.push(...defs);

// =====================================================================================
// HOME — beds & seating
// =====================================================================================
add(
  def({
    id: 'bed_single', name: 'Twin bed', category: 'furniture', icon: '🛏️', basePrice: 320, description: 'A twin mattress on a basic frame. Fine for one.',
    rooms: ['bedroom'], tags: ['bed', 'sleep', 'essential'], durabilityUses: 4000, ambient: { comfort: 1 },
    interactions: [...sleepSet(0.26, 0.12, 0.8)],
  }),
  def({
    id: 'bed_double', name: 'Queen bed', category: 'furniture', icon: '🛏️', basePrice: 850, description: 'A queen bed with a decent mattress. Room for two.',
    rooms: ['bedroom'], tags: ['bed', 'sleep', 'essential', 'couple'], durabilityUses: 5000, ambient: { comfort: 2 },
    interactions: [...sleepSet(0.28, 0.16, 1), act({ id: 'cuddle_pillow', label: 'Relax in bed', category: 'needs', icon: '🛌', durationMinutes: 30, effects: { perMinute: { comfort: 0.25, energy: 0.05 }, stress: -5 }, satisfies: ['comfort'], autonomyWeight: 0.5, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Rest' })],
  }),
  def({
    id: 'bed_king', name: 'King bed', category: 'furniture', icon: '🛏️', basePrice: 1900, description: 'A king-size bed with a plush mattress. Sleep like royalty.',
    rooms: ['bedroom'], tags: ['bed', 'sleep', 'luxury', 'couple'], durabilityUses: 6000, ambient: { comfort: 4 },
    interactions: [...sleepSet(0.3, 0.22, 1.2), act({ id: 'lounge', label: 'Lounge in bed', category: 'needs', icon: '🛌', durationMinutes: 45, effects: { perMinute: { comfort: 0.3, fun: 0.08, energy: 0.06 }, stress: -7, moodlets: [mood('relaxed', 'Lazy morning', 4, 120)] }, satisfies: ['comfort'], autonomyWeight: 0.5, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Rest' })],
  }),
  def({
    id: 'crib', name: 'Crib', category: 'furniture', icon: '👶', basePrice: 260, description: 'A safe sleeping crib for an infant.',
    rooms: ['bedroom', 'nursery'], tags: ['baby', 'sleep', 'family'], durabilityUses: 3000,
    interactions: [
      act({ id: 'put_baby_down', label: 'Put the baby down', category: 'family', icon: '👶', durationMinutes: 15, effects: { needs: { social: 4 }, stress: -2, custom: [cx('family:put_infant_down', {})] }, minStage: TEEN, autonomyWeight: 0.8, group: 'Baby' }),
      act({ id: 'soothe', label: 'Soothe the baby', category: 'family', icon: '🍼', durationMinutes: 20, effects: { needs: { social: 6, energy: -4 }, skills: { parenting: 6 }, stress: 2, moodlets: [mood('grateful', 'Little one settled', 3, 120)] }, minStage: TEEN, autonomyWeight: 0.8, llm: 'narrate', group: 'Baby' }),
      act({ id: 'check_baby', label: 'Check on the baby', category: 'family', icon: '👀', durationMinutes: 3, effects: { needs: { social: 2 }, stress: -1 }, minStage: TEEN, autonomyWeight: 0.4, group: 'Baby' }),
      act({ id: 'change_sheets', label: 'Change crib sheets', category: 'chores', icon: '🧺', durationMinutes: 8, effects: { custom: [cx('chore:clean', { amount: 25, target: 'object' })] }, minStage: TEEN, autonomyWeight: 0.3, group: 'Chores' }),
    ],
  }),
  def({
    id: 'toddler_bed', name: 'Toddler bed', category: 'furniture', icon: '🛏️', basePrice: 180, description: 'A low bed with rails for a toddler.',
    rooms: ['bedroom'], tags: ['bed', 'sleep', 'toddler', 'family'], durabilityUses: 3000,
    interactions: [
      ...sleepSet(0.3, 0.14, 1, { scroll: false, make: false }),
      act({ id: 'tuck_in', label: 'Tuck in the toddler', category: 'family', icon: '🌙', durationMinutes: 15, effects: { needs: { social: 5 }, skills: { parenting: 5 }, stress: -3, custom: [cx('family:tuck_in', {})], moodlets: [mood('grateful', 'Bedtime story', 3, 180)] }, minStage: TEEN, autonomyWeight: 0.7, llm: 'narrate', group: 'Family' }),
    ],
  }),
  def({
    id: 'sofa', name: 'Sofa', category: 'furniture', icon: '🛋️', basePrice: 750, description: 'A three-seat sofa. Naps happen here whether planned or not.',
    rooms: ['living'], tags: ['seating', 'essential', 'living'], durabilityUses: 5000, ambient: { comfort: 2 },
    interactions: [
      sit('Sit on the sofa', 0.2, 0.06, 30),
      act({ id: 'nap', label: 'Nap on the couch', category: 'needs', icon: '💤', durationMinutes: 60, effects: { perMinute: { energy: 0.2, comfort: 0.08 }, custom: [cx('health:sleep', { minutes: 60, quality: 0.6 })] }, satisfies: ['energy'], autonomyWeight: 0.9, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true }, group: 'Rest' }),
      act({ id: 'sleep', label: 'Sleep on the couch', category: 'needs', icon: '😴', durationMinutes: 420, effects: { perMinute: { energy: 0.2, comfort: -0.02 }, needs: { bladder: -15 }, moodlets: [mood('uncomfortable', 'Slept on the couch', -3, 240)], custom: [cx('health:sleep', { minutes: 420, quality: 0.5 })] }, satisfies: ['energy'], autonomyWeight: 0.6, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true }, group: 'Rest' }),
      read(0.12),
      ...eatSet(MEALS_QUICK, 2, 20, 'Eat on the couch'),
      act({ id: 'scroll_phone', label: 'Scroll your phone', category: 'phone', icon: '📱', durationMinutes: 20, effects: { perMinute: { fun: 0.3, comfort: 0.1 }, needs: { social: 3 }, custom: [cx('entertainment:social_media', { action: 'scroll' })] }, satisfies: ['fun'], autonomyWeight: 0.7, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Relax' }),
      act({ id: 'find_change', label: 'Dig for loose change', category: 'object', icon: '🪙', durationMinutes: 5, effects: { needs: { fun: 2 } }, outcomes: { outcomes: [{ weight: 5, label: 'Found a few coins', effects: { money: { amount: 0.85, memo: 'Couch change' } } }, { weight: 1, label: 'Found a crumpled bill!', effects: { money: { amount: 5, memo: 'Couch change' }, moodlets: [mood('happy', 'Found $5', 2, 60)] } }, { weight: 6, label: 'Just crumbs', effects: { needs: { hygiene: -2 } } }] }, autonomyWeight: 0.05, group: 'Relax' }),
      clean('sofa', 15, 15),
    ],
  }),
  def({
    id: 'armchair', name: 'Armchair', category: 'furniture', icon: '🪑', basePrice: 380, description: 'A cushioned armchair by the lamp.',
    rooms: ['living', 'bedroom'], tags: ['seating', 'living'], durabilityUses: 5000, ambient: { comfort: 1 },
    interactions: [sit('Sit in the armchair', 0.22, 0.05, 30), read(0.15), act({ id: 'doze', label: 'Doze off', category: 'needs', icon: '💤', durationMinutes: 40, effects: { perMinute: { energy: 0.16, comfort: 0.05 }, custom: [cx('health:sleep', { minutes: 40, quality: 0.5 })] }, satisfies: ['energy'], autonomyWeight: 0.5, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Rest' }), act({ id: 'think', label: 'Sit and think', category: 'needs', icon: '💭', durationMinutes: 20, effects: { perMinute: { comfort: 0.15 }, stress: -6, skills: { logic: 3 }, moodlets: [mood('focused', 'Cleared your head', 3, 120)] }, autonomyWeight: 0.3, requiresState: { unoccupied: true }, setsState: { occupied: true }, llm: 'narrate', group: 'Relax' })],
  }),
  def({
    id: 'beanbag', name: 'Beanbag chair', category: 'furniture', icon: '🟣', basePrice: 90, description: 'A giant beanbag. Getting out is the hard part.',
    rooms: ['living', 'bedroom', 'kids'], tags: ['seating', 'casual', 'kids'], durabilityUses: 1500, portable: true,
    interactions: [sit('Flop onto the beanbag', 0.18, 0.08, 20), act({ id: 'game_scroll', label: 'Scroll and chill', category: 'entertainment', icon: '📱', durationMinutes: 30, effects: { perMinute: { fun: 0.3, comfort: 0.1 }, custom: [cx('entertainment:social_media', { action: 'scroll' })] }, satisfies: ['fun'], autonomyWeight: 0.6, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Relax' }), act({ id: 'nap', label: 'Nap on the beanbag', category: 'needs', icon: '💤', durationMinutes: 45, effects: { perMinute: { energy: 0.15 }, custom: [cx('health:sleep', { minutes: 45, quality: 0.4 })] }, satisfies: ['energy'], autonomyWeight: 0.4, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Rest' })],
  }),
);

// =====================================================================================
// HOME — tables, desks, storage
// =====================================================================================
add(
  def({
    id: 'dining_table', name: 'Dining table', category: 'furniture', icon: '🍽️', basePrice: 520, description: 'A table with four chairs. Where meals and bills both get dealt with.',
    rooms: ['dining', 'kitchen'], tags: ['table', 'eating', 'essential', 'family'], durabilityUses: 8000, ambient: { comfort: 1 },
    interactions: [
      ...eatSet(MEALS_HOME, 4, 25),
      ...cookSet('dining_table', 'Make'),
      act({ id: 'family_dinner', label: 'Host a family dinner', description: 'Everyone at the table. Phones away.', category: 'family', icon: '🍲', durationMinutes: 60, consumes: [{ itemId: 'meal_good', qty: 2 }], effects: { needs: { hunger: 60, social: 25, fun: 10, comfort: 6 }, stress: -6, moodlets: [mood('grateful', 'Family dinner', 6, 300)] }, satisfies: ['hunger', 'social'], autonomyWeight: 1, llm: 'narrate', dirtiesBy: 10, group: 'Family' }),
      act({ id: 'homework', label: 'Do homework at the table', category: 'school', icon: '📚', durationMinutes: 60, effects: { needs: { fun: -8 }, skills: { logic: 10, research: 6 }, stress: 3, custom: [cx('education:homework', { minutes: 60 })] }, minStage: CHILD, autonomyWeight: 0.6, group: 'Study' }),
      act({ id: 'sort_mail', label: 'Sort the mail & bills', category: 'finance', icon: '✉️', durationMinutes: 15, effects: { stress: 2, custom: [cx('amenity:check_mail', {})] }, minStage: TEEN, autonomyWeight: 0.3, group: 'Admin' }),
      act({ id: 'board_game', label: 'Play a board game', category: 'social', icon: '🎲', durationMinutes: 75, effects: { needs: { fun: 22, social: 18 }, skills: { logic: 5 }, stress: -5, moodlets: [mood('playful', 'Game night', 4, 180)] }, satisfies: ['fun', 'social'], autonomyWeight: 0.5, llm: 'narrate', group: 'Fun' }),
      clean('table', 5, 15),
    ],
  }),
  def({
    id: 'coffee_table', name: 'Coffee table', category: 'furniture', icon: '🪵', basePrice: 180, description: 'A low table for remotes, mugs, and mail you keep meaning to open.',
    rooms: ['living'], tags: ['table', 'living'], durabilityUses: 6000, ambient: { comfort: 1 },
    interactions: [
      ...eatSet(MEALS_QUICK, 1, 20, 'Eat at the coffee table'),
      act({ id: 'flip_magazine', label: 'Flip through a magazine', category: 'entertainment', icon: '📰', durationMinutes: 15, effects: { perMinute: { fun: 0.2 }, stress: -2 }, satisfies: ['fun'], autonomyWeight: 0.3, group: 'Relax' }),
      act({ id: 'put_feet_up', label: 'Put your feet up', category: 'needs', icon: '🦶', durationMinutes: 15, effects: { perMinute: { comfort: 0.2 }, stress: -3 }, satisfies: ['comfort'], autonomyWeight: 0.3, group: 'Relax' }),
      clean('coffee table', 5, 12),
    ],
  }),
  def({
    id: 'desk', name: 'Desk', category: 'office', icon: '🪑', basePrice: 260, description: 'A plain desk. Add a chair, a lamp, and ambition.',
    rooms: ['office', 'bedroom'], tags: ['office', 'work', 'study'], durabilityUses: 8000,
    interactions: [
      act({ id: 'study', label: 'Study', category: 'school', icon: '📚', durationMinutes: 90, effects: { needs: { fun: -8, energy: -6 }, skills: { logic: 12, research: 12 }, stress: 4, custom: [cx('education:study', { minutes: 90 })], moodlets: [mood('focused', 'Studied hard', 3, 120)] }, minStage: CHILD, autonomyWeight: 0.5, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Study' }),
      act({ id: 'write_journal', label: 'Write in a journal', category: 'hobby', icon: '📓', durationMinutes: 30, effects: { skills: { writing: 12 }, needs: { fun: 6 }, stress: -8, moodlets: [mood('relaxed', 'Journaled', 3, 180)] }, autonomyWeight: 0.4, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Hobby' }),
      act({ id: 'paperwork', label: 'Deal with paperwork', category: 'finance', icon: '🗂️', durationMinutes: 40, effects: { needs: { fun: -6 }, stress: -3, skills: { finance: 4 }, custom: [cx('finance:pay_bills', { via: 'paper' })], moodlets: [mood('proud', 'Adulting', 2, 240)] }, minStage: TEEN, autonomyWeight: 0.3, group: 'Admin' }),
      act({ id: 'draw', label: 'Sketch', category: 'hobby', icon: '✏️', durationMinutes: 45, effects: { skills: { creativity: 10, painting: 6 }, needs: { fun: 12 }, stress: -4 }, satisfies: ['fun'], autonomyWeight: 0.4, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Hobby' }),
      act({ id: 'organize', label: 'Organize the desk', category: 'chores', icon: '🗃️', durationMinutes: 15, effects: { custom: [cx('chore:clean', { amount: 15, target: 'object' })], moodlets: [mood('focused', 'Tidy desk, tidy mind', 2, 240)] }, autonomyWeight: 0.2, group: 'Chores' }),
    ],
  }),
  def({
    id: 'office_chair', name: 'Office chair', category: 'office', icon: '💺', basePrice: 220, description: 'An adjustable office chair. Your lower back will thank you.',
    rooms: ['office'], tags: ['seating', 'office', 'ergonomic'], durabilityUses: 6000, ambient: { comfort: 1 },
    interactions: [sit('Sit in the office chair', 0.12, 0.02, 15), act({ id: 'spin', label: 'Spin around in the chair', category: 'entertainment', icon: '🌀', durationMinutes: 2, effects: { needs: { fun: 4 }, moodlets: [mood('playful', 'Wheee', 1, 30)] }, autonomyWeight: 0.1, wearBy: 0.3, group: 'Fun' }), act({ id: 'stretch', label: 'Stretch at your desk', category: 'fitness', icon: '🧘', durationMinutes: 5, effects: { needs: { comfort: 6 }, stress: -2, fitness: 0.05 }, autonomyWeight: 0.2, group: 'Relax' })],
  }),
  def({
    id: 'chair', name: 'Chair', category: 'furniture', icon: '🪑', basePrice: 60, description: 'A simple chair.',
    rooms: ['dining', 'kitchen', 'bedroom'], tags: ['seating', 'basic'], durabilityUses: 6000, portable: true,
    interactions: [sit('Sit down', 0.1, 0.02, 15), act({ id: 'stand_on', label: 'Stand on the chair to reach', category: 'object', icon: '🪜', durationMinutes: 2, effects: {}, outcomes: { outcomes: [{ weight: 12, label: 'Got it', effects: { needs: { fun: 1 } } }, { weight: 1, label: 'Slipped', effects: { health: -1, needs: { comfort: -8 }, moodlets: [mood('embarrassed', 'Fell off a chair', -2, 60)] } }] }, autonomyWeight: 0.05, wearBy: 1, group: 'Misc' })],
  }),
  def({
    id: 'bookshelf', name: 'Bookshelf', category: 'furniture', icon: '📚', basePrice: 240, description: 'Shelves of novels, textbooks and that one cookbook.',
    rooms: ['living', 'office', 'bedroom'], tags: ['storage', 'books', 'reading', 'decor'], durabilityUses: 9000, ambient: { environment: 2 },
    interactions: [
      act({ id: 'read_novel', label: 'Read a novel', category: 'hobby', icon: '📖', durationMinutes: 60, effects: { perMinute: { fun: 0.25 }, skills: { writing: 6, research: 4 }, stress: -8, moodlets: [mood('relaxed', 'Lost in a story', 4, 180)] }, satisfies: ['fun'], autonomyWeight: 0.7, group: 'Read' }),
      act({ id: 'read_nonfiction', label: 'Read non-fiction', category: 'hobby', icon: '🧠', durationMinutes: 60, effects: { perMinute: { fun: 0.12 }, skills: { research: 12, logic: 8 }, stress: -3, moodlets: [mood('inspired', 'Learned something', 3, 180)] }, satisfies: ['fun'], autonomyWeight: 0.5, group: 'Read' }),
      act({ id: 'read_cookbook', label: 'Read a cookbook', category: 'hobby', icon: '🍳', durationMinutes: 40, effects: { perMinute: { fun: 0.1 }, skills: { cooking: 8, baking: 4 }, needs: { hunger: -3 } }, autonomyWeight: 0.3, group: 'Read' }),
      act({ id: 'read_manual', label: 'Read a how-to manual', category: 'hobby', icon: '🔧', durationMinutes: 40, effects: { perMinute: { fun: 0.05 }, skills: { handiness: 8, mechanics: 4 } }, autonomyWeight: 0.2, group: 'Read' }),
      act({ id: 'read_to_child', label: 'Read to a child', category: 'family', icon: '🧸', durationMinutes: 25, effects: { needs: { social: 10, fun: 6 }, skills: { parenting: 6 }, stress: -4, custom: [cx('family:read_to_child', {})], moodlets: [mood('grateful', 'Story time', 3, 180)] }, minStage: TEEN, autonomyWeight: 0.4, llm: 'narrate', group: 'Family' }),
      act({ id: 'learn_spanish', label: 'Study Spanish', category: 'hobby', icon: '🇪🇸', durationMinutes: 45, effects: { skills: { spanish: 14 }, needs: { fun: 2 }, stress: 1 }, autonomyWeight: 0.2, group: 'Read' }),
      act({ id: 'dust_shelves', label: 'Dust the shelves', category: 'chores', icon: '🧹', durationMinutes: 10, effects: { custom: [cx('chore:clean', { amount: 10, target: 'object' })] }, autonomyWeight: 0.2, group: 'Chores' }),
    ],
  }),
  def({
    id: 'dresser', name: 'Dresser', category: 'furniture', icon: '🗄️', basePrice: 300, description: 'Six drawers of clothes, more or less folded.',
    rooms: ['bedroom'], tags: ['storage', 'clothing', 'essential'], durabilityUses: 9000,
    interactions: [
      act({ id: 'change_casual', label: 'Change into casual clothes', category: 'needs', icon: '👕', durationMinutes: 5, effects: { flags: { outfit: 'casual' }, needs: { comfort: 4 } }, autonomyWeight: 0.3, group: 'Outfit' }),
      act({ id: 'change_athletic', label: 'Change into workout clothes', category: 'needs', icon: '🩳', durationMinutes: 5, effects: { flags: { outfit: 'athletic' } }, autonomyWeight: 0.2, group: 'Outfit' }),
      act({ id: 'change_pajamas', label: 'Change into pajamas', category: 'needs', icon: '🩱', durationMinutes: 4, effects: { flags: { outfit: 'sleep' }, needs: { comfort: 6 } }, autonomyWeight: 0.3, group: 'Outfit' }),
      act({ id: 'fold_laundry', label: 'Fold and put away laundry', category: 'chores', icon: '🧺', durationMinutes: 20, effects: { needs: { fun: -3 }, custom: [cx('chore:laundry', { loads: 0 }), cx('chore:clean', { amount: 10, target: 'room' })], moodlets: [mood('proud', 'Laundry done', 2, 180)] }, autonomyWeight: 0.3, group: 'Chores' }),
      act({ id: 'declutter', label: 'Declutter the drawers', category: 'chores', icon: '🗑️', durationMinutes: 30, effects: { needs: { fun: -4 }, stress: -4, custom: [cx('chore:clean', { amount: 15, target: 'room' })] }, autonomyWeight: 0.1, group: 'Chores' }),
    ],
  }),
  def({
    id: 'closet', name: 'Closet', category: 'furniture', icon: '🚪', basePrice: 0, description: 'A closet with hanging space and a shelf of things you forgot you owned.',
    rooms: ['bedroom', 'hallway'], tags: ['storage', 'clothing', 'built_in'], durabilityUses: 50000, repairCost: 60,
    interactions: [
      act({ id: 'change_business', label: 'Change into work clothes', category: 'needs', icon: '👔', durationMinutes: 6, effects: { flags: { outfit: 'business' }, moodlets: [mood('confident', 'Dressed for work', 2, 480)] }, requirements: [itemReq('outfit_business')], autonomyWeight: 0.3, group: 'Outfit' }),
      act({ id: 'change_formal', label: 'Dress up formal', category: 'needs', icon: '🤵', durationMinutes: 10, effects: { flags: { outfit: 'formal' }, moodlets: [mood('confident', 'Looking sharp', 5, 480)] }, requirements: [itemReq('outfit_formal')], autonomyWeight: 0.1, group: 'Outfit' }),
      act({ id: 'change_casual', label: 'Change into casual clothes', category: 'needs', icon: '👕', durationMinutes: 5, effects: { flags: { outfit: 'casual' }, needs: { comfort: 3 } }, autonomyWeight: 0.3, group: 'Outfit' }),
      act({ id: 'grab_coat', label: 'Grab your winter coat', category: 'needs', icon: '🧥', durationMinutes: 2, effects: { flags: { wearing_coat: true }, needs: { comfort: 3 } }, requirements: [itemReq('outfit_winter_coat')], autonomyWeight: 0.2, group: 'Outfit' }),
      act({ id: 'rummage', label: 'Rummage through the closet', category: 'object', icon: '📦', durationMinutes: 15, effects: { needs: { fun: 3 } }, outcomes: { outcomes: [{ weight: 6, label: 'Nothing useful', effects: {} }, { weight: 2, label: 'Found an old gift card', effects: { items: [{ op: 'gain', itemId: 'gift_card', qty: 1 }] } }, { weight: 2, label: 'Found an umbrella', effects: { items: [{ op: 'gain', itemId: 'umbrella', qty: 1 }] } }, { weight: 1, label: 'Found $20 in a jacket', effects: { money: { amount: 20, memo: 'Found in a coat pocket' }, moodlets: [mood('happy', 'Free money', 3, 90)] } }] }, autonomyWeight: 0.05, group: 'Misc' }),
      act({ id: 'organize', label: 'Organize the closet', category: 'chores', icon: '🧹', durationMinutes: 45, effects: { needs: { fun: -5 }, stress: -5, custom: [cx('chore:clean', { amount: 20, target: 'room' })], moodlets: [mood('proud', 'Closet sorted', 3, 300)] }, autonomyWeight: 0.1, group: 'Chores' }),
    ],
  }),
  def({
    id: 'nightstand', name: 'Nightstand', category: 'furniture', icon: '🛋️', basePrice: 120, description: 'A bedside table with a drawer of chargers and old receipts.',
    rooms: ['bedroom'], tags: ['storage', 'bedroom'], durabilityUses: 9000, portable: true,
    interactions: [
      act({ id: 'set_alarm', label: 'Set an alarm', category: 'system', icon: '⏰', durationMinutes: 1, effects: { flags: { alarm_set: true } }, autonomyWeight: 0.3, group: 'Misc' }),
      act({ id: 'charge_phone', label: 'Charge your phone overnight', category: 'phone', icon: '🔌', durationMinutes: 2, effects: { custom: [cx('phone:charge', { amount: 100 })] }, autonomyWeight: 0.5, group: 'Misc' }),
      act({ id: 'take_meds', label: 'Take your medication', category: 'health', icon: '💊', durationMinutes: 2, consumes: [{ itemId: 'prescription_meds', qty: 1 }], effects: { custom: [cx('health:medicate', { itemId: 'prescription_meds' })], health: 0.4 }, autonomyWeight: 0.6, group: 'Health' }),
      act({ id: 'read_before_bed', label: 'Read before bed', category: 'hobby', icon: '📖', durationMinutes: 25, effects: { perMinute: { fun: 0.2 }, stress: -6, skills: { writing: 3 }, moodlets: [mood('relaxed', 'Wind-down', 3, 90)] }, satisfies: ['fun'], autonomyWeight: 0.4, group: 'Relax' }),
    ],
  }),
  def({
    id: 'lamp', name: 'Lamp', category: 'decor', icon: '💡', basePrice: 55, description: 'A warm floor lamp.', requiresUtility: 'electric', runningCostMonthly: 1,
    rooms: ['living', 'bedroom', 'office'], tags: ['lighting', 'decor'], durabilityUses: 3000, portable: true, ambient: { comfort: 1, environment: 1 },
    interactions: [
      act({ id: 'toggle', label: 'Switch the lamp on/off', category: 'object', icon: '💡', durationMinutes: 1, effects: {}, setsState: { on: true }, autonomyWeight: 0.1, group: 'Misc' }),
      act({ id: 'replace_bulb', label: 'Replace the bulb', category: 'chores', icon: '🔧', durationMinutes: 5, consumes: [{ itemId: 'lightbulb', qty: 1 }], effects: { skills: { handiness: 2 }, custom: [cx('property:repair', { skill: 'handiness' })] }, autonomyWeight: 0.2, group: 'Chores' }),
    ],
  }),
  def({
    id: 'mirror', name: 'Mirror', category: 'decor', icon: '🪞', basePrice: 85, description: 'A full-length mirror. Honest, mostly.',
    rooms: ['bedroom', 'bathroom', 'hallway'], tags: ['decor', 'grooming'], durabilityUses: 20000, portable: true, ambient: { environment: 1 },
    interactions: [
      act({ id: 'check_outfit', label: 'Check yourself out', category: 'needs', icon: '👀', durationMinutes: 3, effects: { needs: { fun: 3 }, moodlets: [mood('confident', 'Looking good', 3, 120)] }, autonomyWeight: 0.3, group: 'Grooming' }),
      act({ id: 'practice_speech', label: 'Practice a speech', category: 'hobby', icon: '🗣️', durationMinutes: 20, effects: { skills: { charisma: 12 }, needs: { fun: 4 }, stress: -2 }, autonomyWeight: 0.3, group: 'Practice' }),
      act({ id: 'practice_jokes', label: 'Practice jokes', category: 'hobby', icon: '🎤', durationMinutes: 20, effects: { skills: { comedy: 12 }, needs: { fun: 8 } }, autonomyWeight: 0.3, group: 'Practice' }),
      act({ id: 'practice_dance', label: 'Practice dance moves', category: 'hobby', icon: '💃', durationMinutes: 30, effects: { skills: { dancing: 14 }, needs: { fun: 12, energy: -8, hygiene: -6 }, fitness: 0.2 }, autonomyWeight: 0.3, group: 'Practice' }),
      act({ id: 'pep_talk', label: 'Give yourself a pep talk', category: 'needs', icon: '💪', durationMinutes: 5, effects: { stress: -6, moodlets: [mood('confident', 'You got this', 4, 180)] }, autonomyWeight: 0.2, llm: 'narrate', group: 'Grooming' }),
      act({ id: 'wipe', label: 'Wipe the mirror', category: 'chores', icon: '🧽', durationMinutes: 3, effects: { custom: [cx('chore:clean', { amount: 10, target: 'object' })] }, autonomyWeight: 0.1, group: 'Chores' }),
    ],
  }),
  def({
    id: 'rug', name: 'Area rug', category: 'decor', icon: '🟫', basePrice: 160, description: 'A soft rug that ties the room together.',
    rooms: ['living', 'bedroom'], tags: ['decor', 'comfort', 'soft'], durabilityUses: 10000, ambient: { comfort: 2, environment: 1 },
    interactions: [act({ id: 'lie_on_floor', label: 'Lie on the rug', category: 'needs', icon: '🧘', durationMinutes: 15, effects: { perMinute: { comfort: 0.12 }, stress: -5 }, satisfies: ['comfort'], autonomyWeight: 0.15, group: 'Relax' }), act({ id: 'floor_play', label: 'Play on the floor with kids', category: 'family', icon: '🧸', durationMinutes: 30, effects: { needs: { fun: 14, social: 12 }, skills: { parenting: 6 }, custom: [cx('family:play_with_child', {})] }, autonomyWeight: 0.3, llm: 'narrate', group: 'Family' }), act({ id: 'vacuum_rug', label: 'Shake out the rug', category: 'chores', icon: '🧹', durationMinutes: 8, effects: { needs: { hygiene: -3 }, custom: [cx('chore:clean', { amount: 10, target: 'room' })] }, autonomyWeight: 0.2, group: 'Chores' })],
  }),
  def({
    id: 'houseplant', name: 'Houseplant', category: 'decor', icon: '🪴', basePrice: 35, description: 'A pothos that survives neglect, mostly.',
    rooms: ['living', 'bedroom', 'kitchen', 'office'], tags: ['decor', 'plant', 'green'], durabilityUses: 800, portable: true, ambient: { environment: 2, comfort: 1 },
    interactions: [act({ id: 'water', label: 'Water the plant', category: 'chores', icon: '💧', durationMinutes: 3, effects: { skills: { gardening: 2 }, stress: -2, needs: { fun: 1 } }, autonomyWeight: 0.3, group: 'Care' }), act({ id: 'talk_to_plant', label: 'Talk to the plant', category: 'social', icon: '🗣️', durationMinutes: 5, effects: { needs: { social: 3, fun: 2 }, stress: -3, moodlets: [mood('playful', 'Plant chat', 1, 60)] }, autonomyWeight: 0.05, llm: 'narrate', group: 'Care' }), act({ id: 'repot', label: 'Repot the plant', category: 'hobby', icon: '🪴', durationMinutes: 20, effects: { skills: { gardening: 8 }, needs: { fun: 5, hygiene: -6 } }, autonomyWeight: 0.1, group: 'Care' })],
  }),
  def({
    id: 'wall_art', name: 'Wall art', category: 'decor', icon: '🖼️', basePrice: 120, description: 'A framed print. Conversation starter or at least a wall filler.',
    rooms: ['living', 'bedroom', 'hallway', 'office'], tags: ['decor', 'art'], durabilityUses: 50000, portable: true, ambient: { environment: 3, fun: 1 },
    interactions: [act({ id: 'admire', label: 'Admire the art', category: 'entertainment', icon: '🖼️', durationMinutes: 5, effects: { needs: { fun: 4 }, skills: { painting: 2, creativity: 2 }, stress: -2, moodlets: [mood('inspired', 'Nice piece', 2, 90)] }, autonomyWeight: 0.15, group: 'Relax' }), act({ id: 'straighten', label: 'Straighten the frame', category: 'chores', icon: '📐', durationMinutes: 1, effects: { needs: { comfort: 1 } }, autonomyWeight: 0.05, group: 'Chores' })],
  }),
);

// =====================================================================================
// HOME — electronics
// =====================================================================================
const computerSet = (laptop: boolean): InteractionDef[] => [
  act({ id: 'browse', label: 'Browse the web', category: 'entertainment', icon: '🌐', durationMinutes: 30, effects: { perMinute: { fun: 0.3 }, skills: { research: 3 }, needs: { social: 2 } }, satisfies: ['fun'], autonomyWeight: 0.8, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true, on: true }, wearBy: 0.3, group: 'Computer' }),
  act({ id: 'work_remote', label: 'Work from home', description: 'Log in and get through the queue.', category: 'work', icon: '💼', durationMinutes: 240, effects: { perMinute: { fun: -0.05, comfort: -0.03 }, needs: { energy: -15, social: -5 }, stress: 8, custom: [cx('career:work_remote', { minutes: 240 })] }, requirements: [flagReq('remote_eligible', 'Your job is not remote')], minStage: YA, autonomyWeight: 0.5, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true, on: true }, wearBy: 1, group: 'Work' }),
  act({ id: 'play_games', label: 'Play PC games', category: 'entertainment', icon: '🎮', durationMinutes: 90, effects: { perMinute: { fun: 0.4 }, skills: { gaming: 15 }, needs: { energy: -4, social: 3 }, stress: -5, custom: [cx('entertainment:game', { kind: 'pc', minutes: 90 })] }, satisfies: ['fun'], autonomyWeight: 0.9, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true, on: true }, wearBy: 0.5, minStage: CHILD, group: 'Computer' }),
  act({ id: 'write', label: 'Write', description: 'Work on a story, essay or blog.', category: 'hobby', icon: '✍️', durationMinutes: 60, effects: { skills: { writing: 30 }, needs: { fun: 8 }, stress: -2, moodlets: [mood('inspired', 'Words flowed', 3, 120)] }, satisfies: ['fun'], autonomyWeight: 0.4, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true, on: true }, group: 'Computer' }),
  act({ id: 'code', label: 'Code a side project', category: 'hobby', icon: '💻', durationMinutes: 90, effects: { skills: { programming: 40, logic: 8 }, needs: { fun: 6, energy: -6 }, stress: 2, moodlets: [mood('focused', 'In the zone', 3, 120)] }, autonomyWeight: 0.3, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true, on: true }, minStage: TEEN, group: 'Computer' }),
  act({ id: 'pay_bills', label: 'Pay bills online', category: 'finance', icon: '💳', durationMinutes: 15, effects: { stress: -4, skills: { finance: 4 }, custom: [cx('finance:pay_bills', { via: 'computer' })], flags: { bills_checked: true } }, minStage: TEEN, autonomyWeight: 0.4, requiresState: { notBroken: true }, group: 'Admin' }),
  act({ id: 'shop_online', label: 'Shop online', category: 'shop', icon: '🛒', durationMinutes: 25, effects: { needs: { fun: 8 }, custom: [cx('shop:browse', { section: 'online' })], flags: { shopped_online: true } }, minStage: TEEN, autonomyWeight: 0.2, requiresState: { notBroken: true }, group: 'Admin' }),
  act({ id: 'video_call', label: 'Video call someone', category: 'social', icon: '📹', durationMinutes: 30, effects: { needs: { social: 22, fun: 8 }, stress: -4, custom: [cx('social:video_call', {})] }, satisfies: ['social'], autonomyWeight: 0.6, requiresState: { notBroken: true }, llm: 'adjudicate', group: 'Social' }),
  act({ id: 'job_search', label: 'Search for jobs', category: 'work', icon: '🔎', durationMinutes: 45, effects: { needs: { fun: -4 }, stress: 4, skills: { research: 4 }, custom: [cx('career:job_search', { via: 'computer' })] }, minStage: TEEN, autonomyWeight: 0.3, requiresState: { notBroken: true }, group: 'Work' }),
  act({ id: 'watch_videos', label: 'Watch videos', category: 'entertainment', icon: '▶️', durationMinutes: 45, effects: { perMinute: { fun: 0.35, comfort: laptop ? 0.05 : 0.02 }, custom: [cx('entertainment:watch', { channel: 'online', minutes: 45 })] }, satisfies: ['fun'], autonomyWeight: 0.8, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true, on: true }, group: 'Computer' }),
  act({ id: 'online_course', label: 'Take an online course', category: 'school', icon: '🎓', durationMinutes: 60, effects: { skills: { research: 10, logic: 8, programming: 6 }, needs: { fun: -3 }, custom: [cx('education:study', { minutes: 60, subject: 'online' })] }, minStage: TEEN, autonomyWeight: 0.2, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true, on: true }, group: 'Computer' }),
  act({ id: 'social_media_post', label: 'Post on social media', category: 'phone', icon: '📣', durationMinutes: 10, effects: { needs: { social: 6, fun: 4 }, custom: [cx('entertainment:social_media', { action: 'post' })] }, minStage: TEEN, autonomyWeight: 0.3, requiresState: { notBroken: true }, group: 'Social' }),
  act({ id: 'stream', label: 'Stream yourself', category: 'hobby', icon: '🔴', durationMinutes: 120, effects: { skills: { gaming: 10, charisma: 10 }, needs: { fun: 14, social: 10, energy: -8 }, custom: [cx('career:stream', { minutes: 120 })] }, minStage: TEEN, autonomyWeight: 0.15, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true, on: true }, llm: 'narrate', group: 'Computer' }),
  act({ id: 'online_dating', label: 'Swipe on a dating app', category: 'romance', icon: '💘', durationMinutes: 20, effects: { needs: { fun: 6, social: 4 }, custom: [cx('social:online_date', {})] }, minStage: YA, autonomyWeight: 0.2, requiresState: { notBroken: true }, llm: 'adjudicate', group: 'Social' }),
];

add(
  def({
    id: 'tv', name: 'TV', category: 'electronics', icon: '📺', basePrice: 380, description: 'A 43-inch smart TV with too many streaming apps.', requiresUtility: 'electric', runningCostMonthly: 3,
    rooms: ['living', 'bedroom'], tags: ['tv', 'entertainment', 'screen'], durabilityUses: 6000, ambient: { fun: 1 },
    interactions: [...tvSet(0.35), act({ id: 'turn_off', label: 'Turn off the TV', category: 'object', icon: '⏻', durationMinutes: 1, effects: {}, setsState: { on: false }, autonomyWeight: 0.1, group: 'Misc' })],
  }),
  def({
    id: 'tv_big', name: '75" TV', category: 'electronics', icon: '📺', basePrice: 1400, description: 'A wall-sized 4K OLED. Movie night gravity well.', requiresUtility: 'electric', runningCostMonthly: 6,
    rooms: ['living'], tags: ['tv', 'entertainment', 'screen', 'luxury'], durabilityUses: 6000, ambient: { fun: 3, environment: 1 },
    interactions: [...tvSet(0.45, true), act({ id: 'host_watch_party', label: 'Host a watch party', category: 'social', icon: '🍿', durationMinutes: 180, effects: { perMinute: { fun: 0.4, comfort: 0.08 }, needs: { social: 25 }, stress: -6, moodlets: [mood('happy', 'Watch party', 5, 240)] }, satisfies: ['fun', 'social'], autonomyWeight: 0.3, llm: 'narrate', requiresState: { notBroken: true }, setsState: { on: true }, group: 'Watch' })],
  }),
  def({
    id: 'gaming_console', name: 'Game console', category: 'electronics', icon: '🎮', basePrice: 499, description: 'A current-gen console. Requires a TV and a lot of free evenings.', requiresUtility: 'electric', runningCostMonthly: 2,
    rooms: ['living', 'bedroom'], tags: ['gaming', 'entertainment', 'electronics'], durabilityUses: 5000, ambient: { fun: 2 },
    interactions: [
      act({ id: 'play_solo', label: 'Play a game', category: 'entertainment', icon: '🎮', durationMinutes: 90, effects: { perMinute: { fun: 0.45 }, skills: { gaming: 18 }, needs: { energy: -4 }, stress: -5, custom: [cx('entertainment:game', { kind: 'console', minutes: 90 })] }, satisfies: ['fun'], autonomyWeight: 1, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true, on: true }, wearBy: 0.5, minStage: CHILD, group: 'Play' }),
      act({ id: 'play_online', label: 'Play online with friends', category: 'social', icon: '🎧', durationMinutes: 120, effects: { perMinute: { fun: 0.45 }, skills: { gaming: 20 }, needs: { social: 18, energy: -6 }, custom: [cx('entertainment:game', { kind: 'online', minutes: 120 })] }, satisfies: ['fun', 'social'], autonomyWeight: 0.8, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true, on: true }, wearBy: 0.6, minStage: CHILD, group: 'Play' }),
      act({ id: 'play_couch_coop', label: 'Play couch co-op', category: 'social', icon: '🕹️', durationMinutes: 60, effects: { perMinute: { fun: 0.45 }, needs: { social: 16 }, skills: { gaming: 10 }, moodlets: [mood('playful', 'Couch co-op', 4, 120)] }, satisfies: ['fun', 'social'], autonomyWeight: 0.6, llm: 'narrate', requiresState: { notBroken: true }, setsState: { on: true }, minStage: CHILD, group: 'Play' }),
      act({ id: 'rage_quit', label: 'Ranked grind', description: 'Push for the next rank. Mood may vary.', category: 'entertainment', icon: '🏆', durationMinutes: 120, effects: { skills: { gaming: 30 }, needs: { energy: -8 } }, outcomes: { outcomes: [{ weight: 5, label: 'Ranked up', effects: { needs: { fun: 25 }, moodlets: [mood('proud', 'Ranked up', 6, 180)] }, skillId: 'gaming', skillBias: 2 }, { weight: 4, label: 'Held steady', effects: { needs: { fun: 10 } } }, { weight: 3, label: 'Tilted', effects: { needs: { fun: -5 }, stress: 8, moodlets: [mood('angry', 'Tilted', -5, 90)] } }] }, autonomyWeight: 0.3, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true, on: true }, minStage: TEEN, group: 'Play' }),
      act({ id: 'stream_movie', label: 'Stream a movie on the console', category: 'entertainment', icon: '🎬', durationMinutes: 110, effects: { perMinute: { fun: 0.35, comfort: 0.06 }, stress: -5 }, satisfies: ['fun'], autonomyWeight: 0.5, requiresState: { notBroken: true }, setsState: { on: true }, group: 'Watch' }),
    ],
  }),
  def({
    id: 'computer', name: 'Desktop computer', category: 'electronics', icon: '🖥️', basePrice: 1100, description: 'A desktop PC with a real keyboard. Work, play, and 47 open tabs.', requiresUtility: 'internet', runningCostMonthly: 5,
    rooms: ['office', 'bedroom'], tags: ['computer', 'work', 'electronics', 'gaming'], durabilityUses: 6000, ambient: { fun: 1 },
    interactions: computerSet(false),
  }),
  def({
    id: 'laptop', name: 'Laptop', category: 'electronics', icon: '💻', basePrice: 900, description: 'A laptop. Goes wherever the wifi does.', requiresUtility: 'internet', runningCostMonthly: 2,
    rooms: ['office', 'bedroom', 'living', 'kitchen'], tags: ['computer', 'work', 'electronics', 'portable'], durabilityUses: 4000, portable: true,
    interactions: computerSet(true),
  }),
  def({
    id: 'stereo', name: 'Stereo', category: 'electronics', icon: '🔊', basePrice: 320, description: 'A bookshelf stereo system with real bass.', requiresUtility: 'electric', runningCostMonthly: 1,
    rooms: ['living', 'bedroom'], tags: ['music', 'audio', 'entertainment'], durabilityUses: 8000, ambient: { fun: 2, noise: 2 },
    interactions: [
      act({ id: 'listen', label: 'Listen to music', category: 'entertainment', icon: '🎵', durationMinutes: 30, effects: { perMinute: { fun: 0.3 }, stress: -6, skills: { music: 2 }, moodlets: [mood('happy', 'Good playlist', 3, 120)] }, satisfies: ['fun'], autonomyWeight: 0.7, requiresState: { notBroken: true }, setsState: { on: true }, group: 'Music' }),
      act({ id: 'dance', label: 'Dance around the room', category: 'fitness', icon: '💃', durationMinutes: 20, effects: { needs: { fun: 16, energy: -6, hygiene: -6 }, skills: { dancing: 10 }, fitness: 0.2, stress: -6 }, satisfies: ['fun'], autonomyWeight: 0.4, requiresState: { notBroken: true }, setsState: { on: true }, group: 'Music' }),
      act({ id: 'party_music', label: 'Crank it up for a party', category: 'social', icon: '🎉', durationMinutes: 120, effects: { needs: { fun: 25, social: 20 }, custom: [cx('chore:clean', { amount: -20, target: 'venue' })], moodlets: [mood('playful', 'House party', 6, 240)] }, satisfies: ['fun', 'social'], autonomyWeight: 0.15, requiresState: { notBroken: true }, setsState: { on: true }, minStage: TEEN, llm: 'narrate', group: 'Music' }),
      act({ id: 'radio', label: 'Listen to the radio', category: 'entertainment', icon: '📻', durationMinutes: 30, effects: { perMinute: { fun: 0.15 }, skills: { research: 2 }, stress: -3, custom: [cx('entertainment:watch', { channel: 'radio', minutes: 30 })] }, satisfies: ['fun'], autonomyWeight: 0.3, requiresState: { notBroken: true }, setsState: { on: true }, group: 'Music' }),
      act({ id: 'turn_off', label: 'Turn the stereo off', category: 'object', icon: '⏻', durationMinutes: 1, effects: {}, setsState: { on: false }, autonomyWeight: 0.1, group: 'Misc' }),
    ],
  }),
  def({
    id: 'record_player', name: 'Record player', category: 'electronics', icon: '🎶', basePrice: 260, description: 'A turntable and a crate of vinyl.', requiresUtility: 'electric',
    rooms: ['living'], tags: ['music', 'audio', 'vintage', 'hobby'], durabilityUses: 5000, ambient: { fun: 2, environment: 2 },
    interactions: [
      act({ id: 'spin_record', label: 'Put on a record', category: 'entertainment', icon: '🎶', durationMinutes: 45, effects: { perMinute: { fun: 0.28, comfort: 0.05 }, stress: -8, skills: { music: 3 }, moodlets: [mood('nostalgic', 'Warm vinyl crackle', 4, 150)] }, satisfies: ['fun'], autonomyWeight: 0.6, requiresState: { notBroken: true }, setsState: { on: true }, wearBy: 0.5, group: 'Music' }),
      act({ id: 'browse_crate', label: 'Dig through the record crate', category: 'hobby', icon: '📦', durationMinutes: 15, effects: { needs: { fun: 6 }, skills: { music: 2 } }, autonomyWeight: 0.2, group: 'Music' }),
      act({ id: 'clean_stylus', label: 'Clean the stylus and records', category: 'chores', icon: '🧹', durationMinutes: 10, effects: { skills: { handiness: 2 }, custom: [cx('chore:clean', { amount: 15, target: 'object' })] }, autonomyWeight: 0.1, group: 'Chores' }),
    ],
  }),
  def({
    id: 'bluetooth_speaker', name: 'Bluetooth speaker', category: 'electronics', icon: '🔈', basePrice: 80, description: 'A rugged little speaker for the kitchen, the yard, or the shower.',
    rooms: ['kitchen', 'bathroom', 'yard', 'bedroom'], tags: ['music', 'audio', 'portable'], durabilityUses: 3000, portable: true, ambient: { fun: 1 },
    interactions: [
      act({ id: 'play_music', label: 'Play music', category: 'entertainment', icon: '🎵', durationMinutes: 30, effects: { perMinute: { fun: 0.22 }, stress: -4 }, satisfies: ['fun'], autonomyWeight: 0.5, requiresState: { notBroken: true, minCharge: 5 }, setsState: { on: true }, group: 'Music' }),
      act({ id: 'podcast', label: 'Listen to a podcast', category: 'entertainment', icon: '🎙️', durationMinutes: 45, effects: { perMinute: { fun: 0.15 }, skills: { research: 6, logic: 3 }, stress: -3 }, satisfies: ['fun'], autonomyWeight: 0.4, requiresState: { notBroken: true, minCharge: 5 }, group: 'Music' }),
      act({ id: 'charge', label: 'Charge the speaker', category: 'object', icon: '🔌', durationMinutes: 2, effects: {}, autonomyWeight: 0.1, group: 'Misc' }),
    ],
  }),
);

// =====================================================================================
// HOME — kitchen
// =====================================================================================
add(
  def({
    id: 'fridge', name: 'Refrigerator', category: 'appliance', icon: '🧊', basePrice: 1300, description: 'A fridge-freezer. The light works. Mostly holds condiments.', requiresUtility: 'electric', runningCostMonthly: 12,
    rooms: ['kitchen'], tags: ['kitchen', 'food', 'essential', 'appliance'], durabilityUses: 15000, repairCost: 220,
    interactions: [
      act({ id: 'check_inside', label: 'See what\'s inside', category: 'needs', icon: '👀', durationMinutes: 1, effects: { needs: { fun: 1 } }, autonomyWeight: 0.2, llm: 'narrate', group: 'Fridge' }),
      ...snackSet(SNACKS),
      ...eatSet(['leftovers'], 0, 12, 'Fridge'),
      ...drinkSet(COLD_DRINKS),
      ...snackSet(['ice_cream', 'cookies', 'brownies', 'cake', 'pie', 'chocolate'], 'Dessert'),
      act({ id: 'stand_and_graze', label: 'Stand in front of the open fridge', category: 'needs', icon: '🧊', durationMinutes: 4, effects: { needs: { hunger: 6, fun: 2 }, moodlets: [mood('bored', 'Nothing looks good', -1, 30)] }, autonomyWeight: 0.15, group: 'Fridge' }),
      act({ id: 'clean_out', label: 'Clean out the fridge', category: 'chores', icon: '🧽', durationMinutes: 30, effects: { needs: { fun: -5, hygiene: -4 }, custom: [cx('chore:clean', { amount: 30, target: 'object' })], moodlets: [mood('proud', 'Fridge is spotless', 3, 240)] }, autonomyWeight: 0.2, group: 'Chores' }),
      act({ id: 'grocery_list', label: 'Write a grocery list', category: 'shop', icon: '📝', durationMinutes: 5, effects: { skills: { finance: 2 }, flags: { has_grocery_list: true }, stress: -2 }, autonomyWeight: 0.2, group: 'Fridge' }),
    ],
  }),
  def({
    id: 'stove', name: 'Stove', category: 'appliance', icon: '🔥', basePrice: 750, description: 'A four-burner range. Gas if you\'re lucky, coils if you\'re not.', requiresUtility: 'gas', runningCostMonthly: 8,
    rooms: ['kitchen'], tags: ['kitchen', 'cooking', 'essential', 'appliance'], durabilityUses: 10000, repairCost: 180,
    interactions: [
      ...cookSet('stove'),
      act({ id: 'boil_water', label: 'Boil water', category: 'needs', icon: '♨️', durationMinutes: 6, effects: { needs: { thirst: 12 } }, autonomyWeight: 0.2, group: 'Cook' }),
      act({ id: 'practice_cooking', label: 'Practice knife skills', category: 'hobby', icon: '🔪', durationMinutes: 30, effects: { skills: { cooking: 18 }, needs: { fun: 4 } }, outcomes: { outcomes: [{ weight: 12, label: 'Smooth', effects: {} }, { weight: 1, label: 'Nicked a finger', effects: { health: -0.5, needs: { comfort: -6 } } }] }, autonomyWeight: 0.2, dirtiesBy: 3, group: 'Cook' }),
      clean('stovetop', 15, 30),
    ],
  }),
  def({
    id: 'oven', name: 'Oven', category: 'appliance', icon: '🍞', basePrice: 650, description: 'A wall oven. Preheat, forget, remember.', requiresUtility: 'electric', runningCostMonthly: 6,
    rooms: ['kitchen'], tags: ['kitchen', 'cooking', 'baking', 'appliance'], durabilityUses: 10000, repairCost: 200,
    interactions: [
      ...cookSet('oven', 'Roast'),
      act({ id: 'preheat', label: 'Preheat the oven', category: 'needs', icon: '🌡️', durationMinutes: 10, effects: {}, setsState: { on: true }, autonomyWeight: 0.1, group: 'Cook' }),
      act({ id: 'self_clean', label: 'Run the self-clean cycle', category: 'chores', icon: '🧽', durationMinutes: 180, effects: { custom: [cx('chore:clean', { amount: 50, target: 'object' })] }, autonomyWeight: 0.1, group: 'Chores' }),
    ],
  }),
  def({
    id: 'microwave', name: 'Microwave', category: 'appliance', icon: '📟', basePrice: 130, description: 'A countertop microwave. Beeps until you acknowledge it.', requiresUtility: 'electric', runningCostMonthly: 1,
    rooms: ['kitchen', 'office'], tags: ['kitchen', 'cooking', 'quick', 'appliance'], durabilityUses: 6000, portable: true,
    interactions: [
      ...cookSet('microwave', 'Microwave'),
      act({ id: 'reheat_leftovers', label: 'Reheat leftovers', category: 'needs', icon: '♨️', durationMinutes: 8, consumes: [{ itemId: 'leftovers', qty: 1 }], effects: { needs: { hunger: 42, comfort: 2 } }, satisfies: ['hunger'], autonomyWeight: 1.8, dirtiesBy: 3, group: 'Cook' }),
      act({ id: 'reheat_takeout', label: 'Reheat takeout', category: 'needs', icon: '🥡', durationMinutes: 6, consumes: [{ itemId: 'takeout_meal', qty: 1 }], effects: { needs: { hunger: 56, fun: 4 } }, satisfies: ['hunger'], autonomyWeight: 1.6, dirtiesBy: 3, group: 'Cook' }),
      act({ id: 'popcorn', label: 'Make popcorn', category: 'needs', icon: '🍿', durationMinutes: 4, consumes: [{ itemId: 'snacks', qty: 1 }], effects: { needs: { hunger: 14, fun: 4 } }, autonomyWeight: 0.4, group: 'Cook' }),
      act({ id: 'heat_water', label: 'Heat a mug of water', category: 'needs', icon: '☕', durationMinutes: 3, effects: { needs: { thirst: 10 } }, autonomyWeight: 0.1, group: 'Cook' }),
      clean('microwave', 6, 30),
    ],
  }),
  def({
    id: 'toaster', name: 'Toaster', category: 'appliance', icon: '🍞', basePrice: 35, description: 'A two-slot toaster with one setting that works.', requiresUtility: 'electric',
    rooms: ['kitchen'], tags: ['kitchen', 'breakfast', 'quick', 'appliance'], durabilityUses: 3000, portable: true,
    interactions: [...cookSet('toaster', 'Toast'), act({ id: 'toast_bagel', label: 'Toast bread', category: 'needs', icon: '🍞', durationMinutes: 4, consumes: [{ itemId: 'bread', qty: 1 }], effects: { needs: { hunger: 18 } }, satisfies: ['hunger'], autonomyWeight: 0.8, dirtiesBy: 2, group: 'Cook' }), act({ id: 'empty_crumbs', label: 'Empty the crumb tray', category: 'chores', icon: '🧹', durationMinutes: 2, effects: { custom: [cx('chore:clean', { amount: 20, target: 'object' })] }, autonomyWeight: 0.1, group: 'Chores' })],
  }),
  def({
    id: 'coffee_maker', name: 'Coffee maker', category: 'appliance', icon: '☕', basePrice: 60, description: 'A drip coffee maker. The most important appliance before 9 a.m.', requiresUtility: 'electric', runningCostMonthly: 1,
    rooms: ['kitchen', 'office'], tags: ['kitchen', 'coffee', 'caffeine', 'breakfast', 'appliance'], durabilityUses: 4000, portable: true,
    interactions: [
      ...cookSet('coffee_maker', 'Brew'),
      act({ id: 'quick_cup', label: 'Pour a cup of coffee', category: 'needs', icon: '☕', durationMinutes: 8, consumes: [{ itemId: 'coffee_beans', qty: 1 }], effects: { needs: { energy: 15, thirst: 8, bladder: -8, comfort: 3 }, caffeine: 95, moodlets: [mood('energized', 'Caffeinated', 4, 150)] }, satisfies: ['energy'], autonomyWeight: 1.2, dirtiesBy: 3, minStage: TEEN, group: 'Brew' }),
      act({ id: 'descale', label: 'Descale the machine', category: 'chores', icon: '🧽', durationMinutes: 20, effects: { skills: { handiness: 2 }, custom: [cx('chore:clean', { amount: 40, target: 'object' })] }, autonomyWeight: 0.1, group: 'Chores' }),
    ],
  }),
  def({
    id: 'espresso_machine', name: 'Espresso machine', category: 'appliance', icon: '☕', basePrice: 650, description: 'A semi-automatic espresso machine. Hobby and habit in one.', requiresUtility: 'electric', runningCostMonthly: 2,
    rooms: ['kitchen'], tags: ['kitchen', 'coffee', 'caffeine', 'luxury', 'hobby', 'appliance'], durabilityUses: 6000, repairCost: 140, ambient: { environment: 1 },
    interactions: [
      ...cookSet('espresso_machine', 'Pull'),
      act({ id: 'pull_shot', label: 'Pull an espresso shot', category: 'needs', icon: '☕', durationMinutes: 5, consumes: [{ itemId: 'coffee_beans', qty: 1 }], effects: { needs: { energy: 14, thirst: 3, comfort: 4 }, caffeine: 80, skills: { mixology: 2 }, moodlets: [mood('energized', 'Proper espresso', 5, 150)] }, satisfies: ['energy'], autonomyWeight: 1, dirtiesBy: 3, minStage: TEEN, group: 'Brew' }),
      act({ id: 'latte', label: 'Make a latte', category: 'needs', icon: '🥛', durationMinutes: 8, consumes: [{ itemId: 'coffee_beans', qty: 1 }, { itemId: 'milk', qty: 1 }], effects: { needs: { energy: 14, thirst: 10, hunger: 5, comfort: 6 }, caffeine: 80, skills: { mixology: 4 }, moodlets: [mood('happy', 'Latte art attempt', 4, 120)] }, satisfies: ['energy'], autonomyWeight: 0.8, dirtiesBy: 4, minStage: TEEN, group: 'Brew' }),
      act({ id: 'backflush', label: 'Backflush and clean', category: 'chores', icon: '🧽', durationMinutes: 15, effects: { skills: { handiness: 3 }, custom: [cx('chore:clean', { amount: 40, target: 'object' })] }, autonomyWeight: 0.1, group: 'Chores' }),
    ],
  }),
  def({
    id: 'kettle', name: 'Electric kettle', category: 'appliance', icon: '🫖', basePrice: 30, description: 'Boils water in ninety seconds. Tea, ramen, hot water bottles.', requiresUtility: 'electric',
    rooms: ['kitchen', 'office', 'bedroom'], tags: ['kitchen', 'tea', 'quick', 'appliance'], durabilityUses: 4000, portable: true,
    interactions: [...cookSet('kettle', 'Make'), act({ id: 'hot_water', label: 'Boil water', category: 'needs', icon: '♨️', durationMinutes: 3, effects: { needs: { thirst: 10 } }, autonomyWeight: 0.15, group: 'Make' })],
  }),
  def({
    id: 'blender', name: 'Blender', category: 'appliance', icon: '🥤', basePrice: 90, description: 'A countertop blender loud enough to wake the house.', requiresUtility: 'electric',
    rooms: ['kitchen'], tags: ['kitchen', 'smoothie', 'healthy', 'appliance'], durabilityUses: 3000, portable: true,
    interactions: [...cookSet('blender', 'Blend'), act({ id: 'frozen_margaritas', label: 'Blend frozen margaritas', category: 'needs', icon: '🍹', durationMinutes: 8, consumes: [{ itemId: 'liquor', qty: 1 }, { itemId: 'fruit', qty: 1 }], effects: { needs: { fun: 12, thirst: 12 }, bloodAlcohol: 0.03, skills: { mixology: 8 }, moodlets: [mood('playful', 'Margarita time', 4, 90)] }, minStage: YA, autonomyWeight: 0.2, dirtiesBy: 5, group: 'Blend' }), clean('blender', 5, 30)],
  }),
  def({
    id: 'air_fryer', name: 'Air fryer', category: 'appliance', icon: '🍟', basePrice: 110, description: 'The appliance everyone said would change your life. It kind of did.', requiresUtility: 'electric', runningCostMonthly: 1,
    rooms: ['kitchen'], tags: ['kitchen', 'cooking', 'quick', 'appliance'], durabilityUses: 4000, portable: true,
    interactions: [...cookSet('air_fryer', 'Air-fry'), act({ id: 'reheat_pizza', label: 'Crisp up leftover pizza', category: 'needs', icon: '🍕', durationMinutes: 6, consumes: [{ itemId: 'leftovers', qty: 1 }], effects: { needs: { hunger: 42, fun: 3 } }, satisfies: ['hunger'], autonomyWeight: 1.2, dirtiesBy: 3, group: 'Cook' }), clean('air fryer basket', 6, 30)],
  }),
  def({
    id: 'dishwasher', name: 'Dishwasher', category: 'appliance', icon: '🫧', basePrice: 700, description: 'A built-in dishwasher. Loading it correctly is a marital skill.', requiresUtility: 'water', runningCostMonthly: 5,
    rooms: ['kitchen'], tags: ['kitchen', 'cleaning', 'appliance'], durabilityUses: 8000, repairCost: 160,
    interactions: [
      act({ id: 'load_run', label: 'Load and run the dishwasher', category: 'chores', icon: '🫧', durationMinutes: 12, consumes: [{ itemId: 'dish_soap', qty: 1 }], effects: { needs: { fun: -2 }, custom: [cx('chore:dishes', { amount: 40 })], moodlets: [mood('proud', 'Dishes handled', 2, 180)] }, requiresState: { notBroken: true }, setsState: { on: true }, wearBy: 1, autonomyWeight: 0.5, group: 'Chores' }),
      act({ id: 'unload', label: 'Unload the dishwasher', category: 'chores', icon: '🍽️', durationMinutes: 8, effects: { needs: { fun: -2 }, custom: [cx('chore:dishes', { amount: 10 })] }, autonomyWeight: 0.3, group: 'Chores' }),
      act({ id: 'clean_filter', label: 'Clean the filter', category: 'chores', icon: '🔧', durationMinutes: 10, effects: { skills: { handiness: 3 }, needs: { hygiene: -4 }, custom: [cx('chore:clean', { amount: 30, target: 'object' })] }, autonomyWeight: 0.1, group: 'Chores' }),
    ],
  }),
  def({
    id: 'kitchen_sink', name: 'Kitchen sink', category: 'plumbing', icon: '🚰', basePrice: 350, description: 'A double-basin sink. Dishes accumulate here by natural law.', requiresUtility: 'water',
    rooms: ['kitchen'], tags: ['kitchen', 'plumbing', 'water', 'essential'], durabilityUses: 30000, repairCost: 120,
    interactions: [
      act({ id: 'drink_water', label: 'Drink a glass of water', category: 'needs', icon: '💧', durationMinutes: 2, effects: { needs: { thirst: 30, bladder: -6 }, health: 0.02 }, satisfies: ['thirst'], autonomyWeight: 2.2, group: 'Sink' }),
      act({ id: 'wash_dishes', label: 'Wash the dishes', category: 'chores', icon: '🧼', durationMinutes: 20, effects: { needs: { fun: -4, hygiene: 2 }, stress: -2, custom: [cx('chore:dishes', { amount: 40 })], moodlets: [mood('proud', 'Sink is empty', 2, 180)] }, autonomyWeight: 0.6, wearBy: 0.2, group: 'Chores' }),
      act({ id: 'wash_hands', label: 'Wash your hands', category: 'needs', icon: '🧼', durationMinutes: 1, effects: { needs: { hygiene: 4 }, health: 0.02 }, autonomyWeight: 0.3, group: 'Sink' }),
      act({ id: 'fill_bottle', label: 'Fill a water bottle', category: 'needs', icon: '🍶', durationMinutes: 1, effects: { items: [{ op: 'gain', itemId: 'water_bottle', qty: 1 }] }, autonomyWeight: 0.2, group: 'Sink' }),
      ...cookSet('kitchen_sink', 'Make'),
      act({ id: 'unclog', label: 'Unclog the drain', category: 'chores', icon: '🔧', durationMinutes: 25, effects: { skills: { handiness: 8 }, needs: { hygiene: -8, fun: -4 }, custom: [cx('property:repair', { skill: 'handiness' })] }, outcomes: { outcomes: [{ weight: 6, label: 'Cleared it', effects: { moodlets: [mood('proud', 'Fixed the drain', 3, 240)] }, skillId: 'handiness', skillBias: 2 }, { weight: 3, label: 'Still slow', effects: { stress: 4 } }] }, autonomyWeight: 0.1, group: 'Chores' }),
      clean('sink', 8, 25),
    ],
  }),
  def({
    id: 'counter', name: 'Kitchen counter', category: 'kitchen', icon: '🧑‍🍳', basePrice: 400, description: 'Counter space with a cutting board. Prep station and mail dump.',
    rooms: ['kitchen'], tags: ['kitchen', 'prep', 'surface', 'essential'], durabilityUses: 50000, repairCost: 90,
    interactions: [
      ...cookSet('counter', 'Make'),
      ...eatSet(['sandwich', 'meal_basic', 'leftovers', 'fast_food_meal', 'takeout_meal'], 0, 15, 'Eat standing up'),
      act({ id: 'meal_prep', label: 'Meal-prep for the week', description: 'Cook a big batch and box it.', category: 'needs', icon: '🥡', durationMinutes: 120, consumes: [{ itemId: 'chicken', qty: 2 }, { itemId: 'rice', qty: 1 }, { itemId: 'vegetables', qty: 2 }], produces: [{ itemId: 'meal_basic', qty: 5 }], effects: { skills: { cooking: 30 }, needs: { fun: -4, energy: -10, hygiene: -6 }, stress: -4, moodlets: [mood('proud', 'Meal-prepped', 4, 1440)] }, requirements: [skillReq('cooking', 2)], autonomyWeight: 0.2, dirtiesBy: 15, group: 'Cook' }),
      act({ id: 'pack_lunch', label: 'Pack a lunch', category: 'needs', icon: '🥪', durationMinutes: 8, consumes: [{ itemId: 'bread', qty: 1 }, { itemId: 'cheese', qty: 1 }], produces: [{ itemId: 'sandwich', qty: 1 }], effects: { skills: { finance: 2 } }, autonomyWeight: 0.3, dirtiesBy: 2, group: 'Cook' }),
      act({ id: 'wipe_counters', label: 'Wipe down the counters', category: 'chores', icon: '🧽', durationMinutes: 6, effects: { custom: [cx('chore:clean', { amount: 20, target: 'room' })] }, autonomyWeight: 0.4, group: 'Chores' }),
    ],
  }),
  def({
    id: 'pantry_shelf', name: 'Pantry', category: 'kitchen', icon: '🥫', basePrice: 150, description: 'Shelves of dry goods, cans, and a suspicious number of ramen packs.',
    rooms: ['kitchen'], tags: ['kitchen', 'storage', 'food'], durabilityUses: 30000,
    interactions: [
      act({ id: 'check_stock', label: 'Check the pantry', category: 'needs', icon: '👀', durationMinutes: 2, effects: {}, autonomyWeight: 0.15, llm: 'narrate', group: 'Pantry' }),
      ...snackSet(['snacks', 'chips', 'protein_bar', 'cereal', 'cookies', 'chocolate'], 'Pantry'),
      act({ id: 'organize', label: 'Organize the pantry', category: 'chores', icon: '🗂️', durationMinutes: 25, effects: { needs: { fun: -3 }, stress: -3, custom: [cx('chore:clean', { amount: 15, target: 'object' })] }, autonomyWeight: 0.1, group: 'Chores' }),
      act({ id: 'toss_expired', label: 'Toss expired food', category: 'chores', icon: '🗑️', durationMinutes: 10, effects: { custom: [cx('chore:clean', { amount: 10, target: 'object' })] }, autonomyWeight: 0.1, group: 'Chores' }),
    ],
  }),
);

// =====================================================================================
// HOME — bathroom
// =====================================================================================
add(
  def({
    id: 'bathroom_sink', name: 'Bathroom sink', category: 'plumbing', icon: '🚰', basePrice: 260, description: 'A vanity sink with a mirror and a drawer of half-used products.', requiresUtility: 'water',
    rooms: ['bathroom'], tags: ['bathroom', 'plumbing', 'hygiene', 'essential'], durabilityUses: 30000, repairCost: 110,
    interactions: [
      act({ id: 'brush_teeth', label: 'Brush your teeth', category: 'needs', icon: '🪥', durationMinutes: 3, effects: { needs: { hygiene: 8 }, health: 0.05, moodlets: [mood('confident', 'Minty fresh', 2, 180)] }, satisfies: ['hygiene'], autonomyWeight: 0.9, dirtiesBy: 1, group: 'Grooming' }),
      act({ id: 'wash_face', label: 'Wash your face', category: 'needs', icon: '🧼', durationMinutes: 3, effects: { needs: { hygiene: 6, energy: 3 } }, satisfies: ['hygiene'], autonomyWeight: 0.6, dirtiesBy: 1, group: 'Grooming' }),
      act({ id: 'wash_hands', label: 'Wash your hands', category: 'needs', icon: '🧼', durationMinutes: 1, effects: { needs: { hygiene: 4 }, health: 0.02 }, autonomyWeight: 0.4, group: 'Grooming' }),
      act({ id: 'shave', label: 'Shave', category: 'needs', icon: '🪒', durationMinutes: 8, effects: { needs: { hygiene: 6 }, moodlets: [mood('confident', 'Clean shave', 3, 480)] }, requirements: [itemReq('razor')], minStage: TEEN, autonomyWeight: 0.3, dirtiesBy: 3, group: 'Grooming' }),
      act({ id: 'skincare', label: 'Do a skincare routine', category: 'needs', icon: '🧴', durationMinutes: 10, effects: { needs: { hygiene: 5, comfort: 4 }, stress: -3, moodlets: [mood('confident', 'Glowing', 3, 360)] }, autonomyWeight: 0.3, group: 'Grooming' }),
      act({ id: 'take_meds', label: 'Take medicine', category: 'health', icon: '💊', durationMinutes: 2, consumes: [{ itemId: 'painkillers', qty: 1 }], effects: { custom: [cx('health:medicate', { itemId: 'painkillers' })], needs: { comfort: 8 }, health: 0.2 }, autonomyWeight: 0.3, group: 'Health' }),
      act({ id: 'drink_water', label: 'Drink from the tap', category: 'needs', icon: '💧', durationMinutes: 1, effects: { needs: { thirst: 22, bladder: -5 } }, satisfies: ['thirst'], autonomyWeight: 1.4, group: 'Grooming' }),
      clean('sink', 8, 25),
    ],
  }),
  def({
    id: 'toilet', name: 'Toilet', category: 'plumbing', icon: '🚽', basePrice: 280, description: 'A standard toilet. Handle jiggles.', requiresUtility: 'water',
    rooms: ['bathroom'], tags: ['bathroom', 'plumbing', 'essential'], durabilityUses: 40000, repairCost: 130,
    interactions: [
      act({ id: 'use', label: 'Use the toilet', category: 'needs', icon: '🚽', durationMinutes: 4, effects: { needs: { bladder: 100, hygiene: -2 } }, satisfies: ['bladder'], autonomyWeight: 4, requiresState: { unoccupied: true, notBroken: true, maxDirty: 95 }, setsState: { occupied: true }, dirtiesBy: 4, wearBy: 0.1, group: 'Bathroom' }),
      act({ id: 'use_and_scroll', label: 'Use the toilet (and scroll)', category: 'needs', icon: '📱', durationMinutes: 15, effects: { needs: { bladder: 100, fun: 6, hygiene: -3 }, moodlets: [mood('relaxed', 'Bathroom break', 1, 30)] }, satisfies: ['bladder', 'fun'], autonomyWeight: 1, requiresState: { unoccupied: true, notBroken: true, maxDirty: 95 }, setsState: { occupied: true }, dirtiesBy: 4, wearBy: 0.1, group: 'Bathroom' }),
      act({ id: 'throw_up', label: 'Throw up', category: 'health', icon: '🤢', durationMinutes: 5, effects: { needs: { hunger: -20, comfort: -10, hygiene: -6 }, bloodAlcohol: -0.03, moodlets: [mood('sick', 'Nauseous', -6, 90)] }, requiresState: { unoccupied: true }, autonomyWeight: 0, dirtiesBy: 10, group: 'Bathroom' }),
      act({ id: 'clean', label: 'Clean the toilet', category: 'chores', icon: '🧽', durationMinutes: 12, effects: { needs: { fun: -6, hygiene: -5 }, custom: [cx('chore:clean', { amount: 40, target: 'object' })], moodlets: [mood('proud', 'Toilet sparkles', 2, 180)] }, autonomyWeight: 0.4, group: 'Chores' }),
      act({ id: 'unclog', label: 'Unclog the toilet', category: 'chores', icon: '🪠', durationMinutes: 15, effects: { skills: { handiness: 8 }, needs: { hygiene: -10, fun: -6 }, custom: [cx('property:repair', { skill: 'handiness', tool: 'plunger' })] }, outcomes: { outcomes: [{ weight: 7, label: 'Flushed clean', effects: { moodlets: [mood('proud', 'Plumbing hero', 3, 180)] }, skillId: 'handiness', skillBias: 2 }, { weight: 2, label: 'Overflowed', effects: { needs: { hygiene: -12 }, stress: 8, custom: [cx('chore:clean', { amount: -30, target: 'room' })] } }] }, autonomyWeight: 0.1, group: 'Chores' }),
      act({ id: 'restock_tp', label: 'Restock toilet paper', category: 'chores', icon: '🧻', durationMinutes: 2, consumes: [{ itemId: 'toilet_paper', qty: 1 }], effects: { needs: { comfort: 2 }, flags: { tp_stocked: true } }, autonomyWeight: 0.2, group: 'Chores' }),
    ],
  }),
  def({
    id: 'shower', name: 'Shower', category: 'plumbing', icon: '🚿', basePrice: 900, description: 'A walk-in shower. Hot water takes a minute.', requiresUtility: 'water', runningCostMonthly: 10,
    rooms: ['bathroom'], tags: ['bathroom', 'plumbing', 'hygiene', 'essential'], durabilityUses: 20000, repairCost: 200,
    interactions: [
      act({ id: 'quick_shower', label: 'Take a quick shower', category: 'needs', icon: '🚿', durationMinutes: 10, effects: { needs: { hygiene: 40, energy: 4, comfort: 4 }, stress: -3, custom: [cx('health:hygiene_full', {})] }, satisfies: ['hygiene'], autonomyWeight: 2.2, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true }, dirtiesBy: 3, wearBy: 0.2, group: 'Bathroom' }),
      act({ id: 'shower', label: 'Take a shower', category: 'needs', icon: '🚿', durationMinutes: 15, effects: { needs: { hygiene: 50, energy: 5, comfort: 6 }, stress: -6, custom: [cx('health:hygiene_full', {})], moodlets: [mood('relaxed', 'Fresh out of the shower', 3, 120)] }, satisfies: ['hygiene'], autonomyWeight: 2.5, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true }, dirtiesBy: 4, wearBy: 0.3, group: 'Bathroom' }),
      act({ id: 'long_shower', label: 'Take a long hot shower', category: 'needs', icon: '♨️', durationMinutes: 30, effects: { needs: { hygiene: 60, comfort: 14, energy: 4 }, stress: -12, custom: [cx('health:hygiene_full', {})], moodlets: [mood('relaxed', 'Long hot shower', 5, 180)] }, satisfies: ['hygiene', 'comfort'], autonomyWeight: 1, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true }, dirtiesBy: 5, wearBy: 0.4, group: 'Bathroom' }),
      act({ id: 'cold_shower', label: 'Take a cold shower', category: 'needs', icon: '🧊', durationMinutes: 6, effects: { needs: { hygiene: 35, energy: 12, comfort: -6 }, stress: -4, health: 0.1, moodlets: [mood('energized', 'Cold plunge', 5, 120)] }, satisfies: ['hygiene', 'energy'], autonomyWeight: 0.3, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true }, dirtiesBy: 2, group: 'Bathroom' }),
      act({ id: 'sing', label: 'Sing in the shower', category: 'hobby', icon: '🎤', durationMinutes: 18, effects: { needs: { hygiene: 50, fun: 14, comfort: 6 }, skills: { singing: 14 }, stress: -8, custom: [cx('health:hygiene_full', {})], moodlets: [mood('happy', 'Shower concert', 4, 120)] }, satisfies: ['hygiene', 'fun'], autonomyWeight: 0.8, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true }, dirtiesBy: 4, wearBy: 0.3, group: 'Bathroom' }),
      act({ id: 'clean', label: 'Scrub the shower', category: 'chores', icon: '🧽', durationMinutes: 20, effects: { needs: { fun: -5, hygiene: -4 }, custom: [cx('chore:clean', { amount: 40, target: 'object' })] }, autonomyWeight: 0.3, group: 'Chores' }),
    ],
  }),
  def({
    id: 'bathtub', name: 'Bathtub', category: 'plumbing', icon: '🛁', basePrice: 1200, description: 'A soaking tub with a shower head. Bubbles optional but recommended.', requiresUtility: 'water', runningCostMonthly: 12,
    rooms: ['bathroom'], tags: ['bathroom', 'plumbing', 'hygiene', 'relax'], durabilityUses: 20000, repairCost: 260, ambient: { comfort: 1 },
    interactions: [
      act({ id: 'shower', label: 'Take a shower', category: 'needs', icon: '🚿', durationMinutes: 15, effects: { needs: { hygiene: 50, energy: 5, comfort: 5 }, stress: -5, custom: [cx('health:hygiene_full', {})] }, satisfies: ['hygiene'], autonomyWeight: 2.4, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true }, dirtiesBy: 4, wearBy: 0.3, group: 'Bathroom' }),
      act({ id: 'bath', label: 'Take a bath', category: 'needs', icon: '🛁', durationMinutes: 40, effects: { needs: { hygiene: 55, comfort: 24, energy: 3 }, stress: -18, custom: [cx('health:hygiene_full', {})], moodlets: [mood('relaxed', 'Long soak', 7, 240)] }, satisfies: ['hygiene', 'comfort'], autonomyWeight: 1, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true }, dirtiesBy: 5, wearBy: 0.4, group: 'Bathroom' }),
      act({ id: 'bubble_bath', label: 'Bubble bath with a book', category: 'needs', icon: '🫧', durationMinutes: 60, effects: { needs: { hygiene: 55, comfort: 30, fun: 16 }, stress: -22, skills: { writing: 3 }, custom: [cx('health:hygiene_full', {})], moodlets: [mood('relaxed', 'Spa night at home', 8, 300)] }, satisfies: ['hygiene', 'comfort', 'fun'], autonomyWeight: 0.6, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true }, dirtiesBy: 6, wearBy: 0.4, group: 'Bathroom' }),
      act({ id: 'bathe_child', label: 'Give a kid a bath', category: 'family', icon: '🧒', durationMinutes: 25, effects: { needs: { social: 8, hygiene: -4, fun: 4 }, skills: { parenting: 8 }, moodlets: [mood('grateful', 'Bath time', 2, 120)] }, minStage: TEEN, autonomyWeight: 0.3, llm: 'narrate', dirtiesBy: 6, group: 'Family' }),
      act({ id: 'wash_dog', label: 'Wash the dog in the tub', category: 'pet', icon: '🐕', durationMinutes: 30, effects: { needs: { hygiene: -10, fun: 6 }, custom: [cx('pet:groom', {})] }, autonomyWeight: 0.15, dirtiesBy: 15, group: 'Pet' }),
      act({ id: 'clean', label: 'Scrub the tub', category: 'chores', icon: '🧽', durationMinutes: 25, effects: { needs: { fun: -6, hygiene: -5 }, custom: [cx('chore:clean', { amount: 40, target: 'object' })] }, autonomyWeight: 0.3, group: 'Chores' }),
    ],
  }),
);

// =====================================================================================
// HOME — laundry, cleaning, climate, safety
// =====================================================================================
add(
  def({
    id: 'washer', name: 'Washing machine', category: 'appliance', icon: '🫧', basePrice: 800, description: 'A front-loading washer. The lint trap is on the dryer, you keep forgetting.', requiresUtility: 'water', runningCostMonthly: 8,
    rooms: ['laundry', 'bathroom', 'garage'], tags: ['laundry', 'cleaning', 'appliance'], durabilityUses: 6000, repairCost: 220,
    interactions: [
      act({ id: 'wash_load', label: 'Run a load of laundry', category: 'chores', icon: '🧺', durationMinutes: 10, consumes: [{ itemId: 'laundry_detergent', qty: 1 }], effects: { needs: { fun: -2 }, custom: [cx('chore:laundry', { loads: 1 })], moodlets: [mood('proud', 'Laundry going', 1, 120)] }, requiresState: { notBroken: true, unoccupied: true }, setsState: { on: true }, wearBy: 1, autonomyWeight: 0.6, group: 'Laundry' }),
      act({ id: 'wash_bedding', label: 'Wash the bedding', category: 'chores', icon: '🛏️', durationMinutes: 12, consumes: [{ itemId: 'laundry_detergent', qty: 1 }], effects: { needs: { fun: -2, comfort: 4 }, custom: [cx('chore:laundry', { loads: 1 }), cx('chore:clean', { amount: 15, target: 'room' })] }, requiresState: { notBroken: true, unoccupied: true }, setsState: { on: true }, wearBy: 1.2, autonomyWeight: 0.2, group: 'Laundry' }),
      act({ id: 'clean_drum', label: 'Run a cleaning cycle', category: 'chores', icon: '🧽', durationMinutes: 5, effects: { custom: [cx('chore:clean', { amount: 30, target: 'object' })] }, requiresState: { notBroken: true }, autonomyWeight: 0.05, group: 'Chores' }),
    ],
  }),
  def({
    id: 'dryer', name: 'Dryer', category: 'appliance', icon: '🌀', basePrice: 750, description: 'An electric dryer. Clean the lint trap; house fires are real.', requiresUtility: 'electric', runningCostMonthly: 9,
    rooms: ['laundry', 'bathroom', 'garage'], tags: ['laundry', 'appliance'], durabilityUses: 6000, repairCost: 200,
    interactions: [
      act({ id: 'dry_load', label: 'Dry a load', category: 'chores', icon: '🌀', durationMinutes: 6, effects: { custom: [cx('chore:laundry', { loads: 0 })] }, requiresState: { notBroken: true }, setsState: { on: true }, wearBy: 1, autonomyWeight: 0.5, group: 'Laundry' }),
      act({ id: 'fold_warm', label: 'Fold warm laundry', category: 'chores', icon: '🧺', durationMinutes: 20, effects: { needs: { fun: -2, comfort: 4 }, stress: -3, custom: [cx('chore:laundry', { loads: 0 })], moodlets: [mood('relaxed', 'Warm laundry', 2, 120)] }, autonomyWeight: 0.3, group: 'Laundry' }),
      act({ id: 'lint_trap', label: 'Clean the lint trap', category: 'chores', icon: '🧹', durationMinutes: 2, effects: { skills: { handiness: 1 }, custom: [cx('chore:clean', { amount: 20, target: 'object' })], health: 0.01 }, autonomyWeight: 0.2, group: 'Chores' }),
    ],
  }),
  def({
    id: 'laundry_basket', name: 'Laundry basket', category: 'misc', icon: '🧺', basePrice: 20, description: 'A laundry hamper. Currently overflowing.',
    rooms: ['bedroom', 'bathroom', 'laundry'], tags: ['laundry', 'storage'], durabilityUses: 4000, portable: true,
    interactions: [
      act({ id: 'gather', label: 'Gather dirty laundry', category: 'chores', icon: '👕', durationMinutes: 8, effects: { needs: { fun: -1 }, custom: [cx('chore:clean', { amount: 10, target: 'room' })] }, autonomyWeight: 0.3, group: 'Laundry' }),
      act({ id: 'sniff_test', label: 'Sniff-test a shirt', category: 'needs', icon: '👃', durationMinutes: 1, effects: { needs: { fun: 1 } }, outcomes: { outcomes: [{ weight: 3, label: 'It\'s fine', effects: { flags: { outfit: 'casual' } } }, { weight: 2, label: 'Nope', effects: { needs: { hygiene: -2 }, moodlets: [mood('embarrassed', 'Need to do laundry', -2, 120)] } }] }, autonomyWeight: 0.05, group: 'Laundry' }),
      act({ id: 'carry_to_washer', label: 'Haul the basket to the washer', category: 'chores', icon: '🧺', durationMinutes: 3, effects: { needs: { energy: -1 } }, autonomyWeight: 0.2, group: 'Laundry' }),
    ],
  }),
  def({
    id: 'vacuum', name: 'Vacuum cleaner', category: 'tool', icon: '🧹', basePrice: 220, description: 'An upright vacuum. Loud, effective, hated by the cat.', requiresUtility: 'electric',
    rooms: ['hallway', 'living', 'closet'], tags: ['cleaning', 'tool'], durabilityUses: 2500, portable: true, repairCost: 60,
    interactions: [
      act({ id: 'vacuum_room', label: 'Vacuum the room', category: 'chores', icon: '🧹', durationMinutes: 15, effects: { needs: { fun: -3, energy: -3 }, fitness: 0.05, custom: [cx('chore:clean', { amount: 25, target: 'room' })], moodlets: [mood('proud', 'Fresh vacuum lines', 2, 180)] }, requiresState: { notBroken: true }, wearBy: 1, autonomyWeight: 0.5, group: 'Chores' }),
      act({ id: 'vacuum_house', label: 'Vacuum the whole place', category: 'chores', icon: '🏠', durationMinutes: 45, effects: { needs: { fun: -6, energy: -8, hygiene: -4 }, fitness: 0.15, custom: [cx('chore:clean', { amount: 45, target: 'venue' })], moodlets: [mood('proud', 'Whole house vacuumed', 4, 300)] }, requiresState: { notBroken: true }, wearBy: 2.5, autonomyWeight: 0.35, group: 'Chores' }),
      act({ id: 'empty_canister', label: 'Empty the canister', category: 'chores', icon: '🗑️', durationMinutes: 3, effects: { needs: { hygiene: -2 } }, autonomyWeight: 0.15, group: 'Chores' }),
      act({ id: 'fix_vacuum', label: 'Fix the vacuum', category: 'chores', icon: '🔧', durationMinutes: 30, effects: { skills: { handiness: 12 }, custom: [cx('property:repair', { skill: 'handiness' })] }, autonomyWeight: 0.1, group: 'Chores' }),
    ],
  }),
  def({
    id: 'trash_can', name: 'Trash can', category: 'misc', icon: '🗑️', basePrice: 40, description: 'A kitchen trash can with a foot pedal that sometimes works.',
    rooms: ['kitchen', 'bathroom', 'office'], tags: ['cleaning', 'essential'], durabilityUses: 10000, portable: true,
    interactions: [
      act({ id: 'take_out', label: 'Take out the trash', category: 'chores', icon: '🗑️', durationMinutes: 6, consumes: [{ itemId: 'trash_bags', qty: 1 }], effects: { needs: { fun: -2, hygiene: -3 }, custom: [cx('chore:trash', {}), cx('chore:clean', { amount: 20, target: 'venue' })], moodlets: [mood('proud', 'Trash is out', 1, 120)] }, autonomyWeight: 0.6, group: 'Chores' }),
      act({ id: 'take_out_nobag', label: 'Take out the trash (no bag)', category: 'chores', icon: '🗑️', durationMinutes: 8, effects: { needs: { fun: -3, hygiene: -5 }, custom: [cx('chore:trash', {}), cx('chore:clean', { amount: 15, target: 'venue' })] }, autonomyWeight: 0.2, group: 'Chores' }),
      act({ id: 'throw_away', label: 'Throw something away', category: 'object', icon: '♻️', durationMinutes: 1, effects: {}, autonomyWeight: 0.05, group: 'Chores' }),
      act({ id: 'rinse_can', label: 'Rinse out the can', category: 'chores', icon: '🧽', durationMinutes: 6, effects: { needs: { hygiene: -4 }, custom: [cx('chore:clean', { amount: 15, target: 'object' })] }, autonomyWeight: 0.05, group: 'Chores' }),
    ],
  }),
  def({
    id: 'recycling_bin', name: 'Recycling bin', category: 'misc', icon: '♻️', basePrice: 25, description: 'A blue bin. Rinse the cans, flatten the boxes.',
    rooms: ['kitchen', 'garage'], tags: ['cleaning', 'green'], durabilityUses: 10000, portable: true,
    interactions: [
      act({ id: 'take_out', label: 'Take out the recycling', category: 'chores', icon: '♻️', durationMinutes: 5, effects: { needs: { fun: -1 }, custom: [cx('chore:recycle', {}), cx('chore:clean', { amount: 10, target: 'venue' })], moodlets: [mood('proud', 'Did your bit', 1, 120)] }, autonomyWeight: 0.4, group: 'Chores' }),
      act({ id: 'break_down_boxes', label: 'Break down cardboard boxes', category: 'chores', icon: '📦', durationMinutes: 10, effects: { needs: { fun: 2, energy: -2 }, custom: [cx('chore:clean', { amount: 10, target: 'venue' })] }, autonomyWeight: 0.15, group: 'Chores' }),
      act({ id: 'return_cans', label: 'Bag cans for deposit', category: 'finance', icon: '🥫', durationMinutes: 10, effects: { needs: { hygiene: -3 }, money: { amount: 1.2, memo: 'Can deposit' } }, autonomyWeight: 0.05, group: 'Chores' }),
    ],
  }),
  def({
    id: 'thermostat', name: 'Thermostat', category: 'appliance', icon: '🌡️', basePrice: 180, description: 'A smart thermostat. The household argues through it.', requiresUtility: 'electric',
    rooms: ['hallway'], tags: ['hvac', 'climate', 'smart_home', 'utility'], durabilityUses: 50000,
    interactions: [
      act({ id: 'set_heat', label: 'Turn the heat up', category: 'object', icon: '🔥', durationMinutes: 1, effects: { needs: { comfort: 6 }, custom: [cx('property:thermostat', { mode: 'heat', target: 72 })] }, autonomyWeight: 0.3, group: 'Climate' }),
      act({ id: 'set_cool', label: 'Turn on the AC', category: 'object', icon: '❄️', durationMinutes: 1, effects: { needs: { comfort: 6 }, custom: [cx('property:thermostat', { mode: 'cool', target: 74 })] }, autonomyWeight: 0.3, group: 'Climate' }),
      act({ id: 'set_eco', label: 'Set eco mode', category: 'finance', icon: '🍃', durationMinutes: 1, effects: { needs: { comfort: -3 }, skills: { finance: 1 }, custom: [cx('property:thermostat', { mode: 'eco' })] }, autonomyWeight: 0.15, group: 'Climate' }),
      act({ id: 'set_off', label: 'Turn the system off', category: 'object', icon: '⏻', durationMinutes: 1, effects: { custom: [cx('property:thermostat', { mode: 'off' })] }, autonomyWeight: 0.05, group: 'Climate' }),
    ],
  }),
  def({
    id: 'ac_window', name: 'Window AC unit', category: 'appliance', icon: '❄️', basePrice: 330, description: 'A window air conditioner. Rattles, drips, saves lives in August.', requiresUtility: 'electric', runningCostMonthly: 45,
    rooms: ['bedroom', 'living'], tags: ['hvac', 'climate', 'summer', 'appliance'], durabilityUses: 5000, repairCost: 90, ambient: { comfort: 2, noise: 3 },
    interactions: [
      act({ id: 'turn_on', label: 'Turn on the AC', category: 'object', icon: '❄️', durationMinutes: 1, effects: { needs: { comfort: 8 }, custom: [cx('property:thermostat', { mode: 'cool', target: 72 })], moodlets: [mood('relaxed', 'Cool air', 3, 180)] }, requiresState: { notBroken: true }, setsState: { on: true }, wearBy: 0.5, autonomyWeight: 0.4, group: 'Climate' }),
      act({ id: 'turn_off', label: 'Turn off the AC', category: 'object', icon: '⏻', durationMinutes: 1, effects: { custom: [cx('property:thermostat', { mode: 'off' })] }, setsState: { on: false }, autonomyWeight: 0.1, group: 'Climate' }),
      act({ id: 'clean_filter', label: 'Clean the filter', category: 'chores', icon: '🧽', durationMinutes: 10, effects: { skills: { handiness: 3 }, custom: [cx('chore:clean', { amount: 30, target: 'object' })] }, autonomyWeight: 0.1, group: 'Chores' }),
      act({ id: 'stand_in_front', label: 'Stand in front of the AC', category: 'needs', icon: '🥵', durationMinutes: 5, effects: { needs: { comfort: 8 }, stress: -2 }, requiresState: { on: true, notBroken: true }, satisfies: ['comfort'], autonomyWeight: 0.2, group: 'Climate' }),
    ],
  }),
  def({
    id: 'space_heater', name: 'Space heater', category: 'appliance', icon: '🔥', basePrice: 60, description: 'A small ceramic heater. Do not leave running overnight. You will.', requiresUtility: 'electric', runningCostMonthly: 30,
    rooms: ['bedroom', 'office', 'living'], tags: ['hvac', 'climate', 'winter', 'appliance'], durabilityUses: 2500, portable: true, ambient: { comfort: 2 },
    interactions: [
      act({ id: 'turn_on', label: 'Turn on the heater', category: 'object', icon: '🔥', durationMinutes: 1, effects: { needs: { comfort: 8 }, custom: [cx('property:thermostat', { mode: 'heat', target: 70 })] }, requiresState: { notBroken: true }, setsState: { on: true }, wearBy: 0.5, autonomyWeight: 0.4, group: 'Climate' }),
      act({ id: 'warm_up', label: 'Warm your hands', category: 'needs', icon: '🧤', durationMinutes: 5, effects: { needs: { comfort: 10 }, stress: -3, moodlets: [mood('relaxed', 'Toasty', 3, 120)] }, requiresState: { on: true }, satisfies: ['comfort'], autonomyWeight: 0.3, group: 'Climate' }),
      act({ id: 'turn_off', label: 'Turn off the heater', category: 'object', icon: '⏻', durationMinutes: 1, effects: { custom: [cx('property:thermostat', { mode: 'off' })] }, setsState: { on: false }, autonomyWeight: 0.2, group: 'Climate' }),
    ],
  }),
  def({
    id: 'smoke_detector', name: 'Smoke detector', category: 'misc', icon: '🚨', basePrice: 25, description: 'A ceiling smoke and CO detector. Chirps at 3 a.m. when the battery dies.',
    rooms: ['hallway', 'kitchen', 'bedroom'], tags: ['safety', 'essential'], durabilityUses: 100000,
    interactions: [
      act({ id: 'test', label: 'Test the alarm', category: 'chores', icon: '🔊', durationMinutes: 2, effects: { needs: { comfort: -2 }, custom: [cx('property:security', { action: 'test_alarm' })], moodlets: [mood('relaxed', 'Safety checked', 1, 300)] }, autonomyWeight: 0.05, group: 'Safety' }),
      act({ id: 'replace_battery', label: 'Replace the battery', category: 'chores', icon: '🔋', durationMinutes: 5, consumes: [{ itemId: 'batteries', qty: 1 }], effects: { skills: { handiness: 2 }, custom: [cx('property:security', { action: 'replace_battery' })], stress: -2 }, autonomyWeight: 0.2, group: 'Safety' }),
      act({ id: 'silence', label: 'Wave a towel at it', category: 'object', icon: '🫡', durationMinutes: 2, effects: { needs: { fun: 1 }, stress: -1 }, autonomyWeight: 0.05, llm: 'narrate', group: 'Safety' }),
    ],
  }),
  def({
    id: 'security_camera', name: 'Security camera', category: 'electronics', icon: '📷', basePrice: 120, description: 'A doorbell camera. Mostly records delivery drivers and raccoons.', requiresUtility: 'internet', runningCostMonthly: 6,
    rooms: ['entry', 'yard'], tags: ['security', 'smart_home', 'safety'], durabilityUses: 20000,
    interactions: [
      act({ id: 'review_footage', label: 'Review the camera footage', category: 'object', icon: '🎞️', durationMinutes: 8, effects: { needs: { fun: 3 }, custom: [cx('property:security', { action: 'review_footage' })] }, autonomyWeight: 0.1, llm: 'narrate', group: 'Safety' }),
      act({ id: 'check_live', label: 'Check the live feed', category: 'object', icon: '👁️', durationMinutes: 2, effects: { stress: -2 }, autonomyWeight: 0.1, group: 'Safety' }),
      act({ id: 'adjust', label: 'Adjust the camera angle', category: 'chores', icon: '🔧', durationMinutes: 6, effects: { skills: { handiness: 2 } }, autonomyWeight: 0.05, group: 'Safety' }),
    ],
  }),
  def({
    id: 'door_lock', name: 'Front door lock', category: 'misc', icon: '🔒', basePrice: 90, description: 'A deadbolt on the front door. Smart version optional.',
    rooms: ['entry'], tags: ['security', 'safety', 'essential'], durabilityUses: 50000,
    interactions: [
      act({ id: 'lock', label: 'Lock the doors', category: 'object', icon: '🔒', durationMinutes: 1, effects: { stress: -2, custom: [cx('property:security', { action: 'lock' })], flags: { doors_locked: true } }, autonomyWeight: 0.3, group: 'Safety' }),
      act({ id: 'unlock', label: 'Unlock the door', category: 'object', icon: '🔓', durationMinutes: 1, effects: { custom: [cx('property:security', { action: 'unlock' })], flags: { doors_locked: false } }, autonomyWeight: 0.1, group: 'Safety' }),
      act({ id: 'check_locks', label: 'Double-check the locks', category: 'object', icon: '👀', durationMinutes: 2, effects: { stress: -3, moodlets: [mood('relaxed', 'Locked up tight', 1, 240)] }, autonomyWeight: 0.1, group: 'Safety' }),
      act({ id: 'rekey', label: 'Change the lock', category: 'chores', icon: '🔧', durationMinutes: 40, cost: 35, effects: { skills: { handiness: 12 }, custom: [cx('property:upgrade', { what: 'lock' })], stress: -4 }, autonomyWeight: 0.02, group: 'Chores' }),
    ],
  }),
);

// =====================================================================================
// HOME — fitness
// =====================================================================================
add(
  def({
    id: 'treadmill', name: 'Treadmill', category: 'fitness', icon: '🏃', basePrice: 900, description: 'A folding treadmill. Doubles as a clothes rack between resolutions.', requiresUtility: 'electric', runningCostMonthly: 3,
    rooms: ['garage', 'basement', 'bedroom'], tags: ['fitness', 'cardio', 'equipment'], durabilityUses: 3000, repairCost: 150,
    interactions: [
      workout('walk', 'Walk on the treadmill', 30, { icon: '🚶', intensity: 0.5, kind: 'walk', description: 'An easy walk while you watch something.' }),
      workout('jog', 'Jog', 30, { icon: '🏃', intensity: 0.9, kind: 'run' }),
      workout('run', 'Run hard', 45, { icon: '🏃', intensity: 1.2, kind: 'run', skill: 'athletics' }),
      workout('intervals', 'Do sprint intervals', 25, { icon: '⚡', intensity: 1.3, kind: 'hiit', skill: 'athletics', stress: -4 }),
      act({ id: 'wipe_down', label: 'Wipe down the treadmill', category: 'chores', icon: '🧽', durationMinutes: 3, effects: { custom: [cx('chore:clean', { amount: 20, target: 'object' })] }, autonomyWeight: 0.1, group: 'Chores' }),
    ],
  }),
  def({
    id: 'weight_bench', name: 'Weight bench', category: 'fitness', icon: '🏋️', basePrice: 350, description: 'A bench with a barbell and plates. Spotter not included.',
    rooms: ['garage', 'basement'], tags: ['fitness', 'strength', 'equipment'], durabilityUses: 8000, repairCost: 60,
    interactions: [
      workout('bench_press', 'Bench press', 40, { icon: '🏋️', intensity: 1, kind: 'strength', fun: 8 }),
      workout('full_lift', 'Full lifting session', 60, { icon: '🏋️', intensity: 1.2, kind: 'strength', fun: 10 }),
      workout('light_weights', 'Light weights', 20, { icon: '🏋️', intensity: 0.5, kind: 'strength', minStage: TEEN }),
      act({ id: 'rerack', label: 'Re-rack the plates', category: 'chores', icon: '🧹', durationMinutes: 4, effects: { needs: { energy: -1 }, custom: [cx('chore:clean', { amount: 10, target: 'object' })] }, autonomyWeight: 0.1, group: 'Chores' }),
    ],
  }),
  def({
    id: 'dumbbells', name: 'Dumbbell set', category: 'fitness', icon: '🏋️', basePrice: 150, description: 'Adjustable dumbbells. Small footprint, big regret the next morning.',
    rooms: ['bedroom', 'living', 'garage'], tags: ['fitness', 'strength', 'portable'], durabilityUses: 20000, portable: true,
    interactions: [
      workout('curls', 'Do a dumbbell circuit', 30, { icon: '💪', intensity: 0.8, kind: 'strength' }),
      workout('quick_set', 'Bang out a quick set', 10, { icon: '💪', intensity: 0.5, kind: 'strength', fun: 3 }),
      workout('arm_day', 'Arm day', 45, { icon: '💪', intensity: 1, kind: 'strength' }),
    ],
  }),
  def({
    id: 'yoga_mat', name: 'Yoga mat', category: 'fitness', icon: '🧘', basePrice: 30, description: 'A rolled-up yoga mat. Also used for stretching, sit-ups and lying dramatically.',
    rooms: ['bedroom', 'living'], tags: ['fitness', 'yoga', 'wellness', 'portable'], durabilityUses: 3000, portable: true,
    interactions: [
      act({ id: 'yoga', label: 'Do yoga', category: 'fitness', icon: '🧘', durationMinutes: 40, effects: { fitness: 0.8, needs: { fun: 8, energy: -8, hygiene: -10, comfort: 8 }, skills: { fitness: 15 }, stress: -14, health: 0.2, custom: [cx('health:workout', { minutes: 40, kind: 'yoga' })], moodlets: [mood('relaxed', 'Centered', 5, 240)] }, satisfies: ['comfort', 'fun'], autonomyWeight: 0.5, wearBy: 0.3, group: 'Workout' }),
      act({ id: 'stretch', label: 'Stretch', category: 'fitness', icon: '🤸', durationMinutes: 12, effects: { fitness: 0.15, needs: { comfort: 10, hygiene: -3 }, stress: -5, custom: [cx('health:workout', { minutes: 12, kind: 'stretch' })] }, satisfies: ['comfort'], autonomyWeight: 0.4, group: 'Workout' }),
      act({ id: 'meditate', label: 'Meditate', category: 'needs', icon: '🕉️', durationMinutes: 20, effects: { stress: -16, needs: { comfort: 6, fun: 2 }, skills: { logic: 2 }, moodlets: [mood('relaxed', 'Mindful', 6, 300)] }, autonomyWeight: 0.35, group: 'Wellness' }),
      workout('core', 'Core workout', 25, { icon: '🔥', intensity: 0.9, kind: 'core' }),
      act({ id: 'follow_video', label: 'Follow a workout video', category: 'fitness', icon: '📱', durationMinutes: 30, effects: { fitness: 1, weight: -0.1, needs: { fun: 10, energy: -14, hygiene: -18, thirst: -10 }, skills: { fitness: 18, dancing: 4 }, stress: -4, custom: [cx('health:workout', { minutes: 30, kind: 'hiit' })] }, satisfies: ['fun'], autonomyWeight: 0.4, minStage: CHILD, group: 'Workout' }),
    ],
  }),
  def({
    id: 'exercise_bike', name: 'Exercise bike', category: 'fitness', icon: '🚴', basePrice: 700, description: 'A stationary bike with a tablet mount. Streaming classes cost extra.', requiresUtility: 'electric', runningCostMonthly: 2,
    rooms: ['bedroom', 'garage', 'living'], tags: ['fitness', 'cardio', 'equipment'], durabilityUses: 5000, repairCost: 110,
    interactions: [
      workout('easy_ride', 'Easy ride', 30, { icon: '🚴', intensity: 0.6, kind: 'cycle' }),
      workout('spin_class', 'Stream a spin class', 45, { icon: '🚴', intensity: 1.1, kind: 'cycle', fun: 14 }),
      workout('ride_and_watch', 'Pedal while watching TV', 60, { icon: '📺', intensity: 0.6, kind: 'cycle', fun: 16 }),
      act({ id: 'wipe_down', label: 'Wipe down the bike', category: 'chores', icon: '🧽', durationMinutes: 3, effects: { custom: [cx('chore:clean', { amount: 20, target: 'object' })] }, autonomyWeight: 0.1, group: 'Chores' }),
    ],
  }),
  def({
    id: 'punching_bag', name: 'Punching bag', category: 'fitness', icon: '🥊', basePrice: 180, description: 'A heavy bag on a chain. Therapy, but louder.',
    rooms: ['garage', 'basement'], tags: ['fitness', 'boxing', 'stress'], durabilityUses: 6000, ambient: { noise: 2 },
    interactions: [
      workout('bag_work', 'Hit the bag', 30, { icon: '🥊', intensity: 1, kind: 'boxing', skill: 'athletics', stress: -14, fun: 12 }),
      act({ id: 'blow_off_steam', label: 'Blow off steam', category: 'fitness', icon: '😤', durationMinutes: 12, effects: { needs: { energy: -8, hygiene: -8, fun: 8 }, stress: -18, fitness: 0.3, moodlets: [mood('relaxed', 'Let it out', 5, 180)] }, autonomyWeight: 0.3, minStage: TEEN, wearBy: 1, group: 'Workout' }),
      workout('shadow_box', 'Shadowbox and bag rounds', 45, { icon: '🥊', intensity: 1.2, kind: 'boxing', skill: 'athletics' }),
    ],
  }),
);

// =====================================================================================
// HOME — music, art & making
// =====================================================================================
const perform = (skill: SkillId, label: string, icon: string, minutes = 30): InteractionDef =>
  act({
    id: 'perform', label, category: 'social', icon, durationMinutes: minutes,
    effects: { needs: { fun: 14, social: 12 }, skills: { [skill]: 10, charisma: 4 } },
    outcomes: { outcomes: [{ weight: 6, label: 'They loved it', effects: { moodlets: [mood('proud', 'Nailed the performance', 6, 240)], needs: { social: 6 } }, skillId: skill, skillBias: 3 }, { weight: 4, label: 'Polite applause', effects: { needs: { fun: 2 } } }, { weight: 2, label: 'Flubbed a bit', effects: { moodlets: [mood('embarrassed', 'Botched a note', -3, 120)] } }] },
    requirements: [skillReq(skill, 2)], satisfies: ['fun', 'social'], autonomyWeight: 0.3, llm: 'narrate', requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true }, group: 'Perform',
  });

add(
  def({
    id: 'piano', name: 'Upright piano', category: 'hobby', icon: '🎹', basePrice: 3500, description: 'An upright piano that needs tuning twice a year and gets it once.',
    rooms: ['living'], tags: ['music', 'instrument', 'piano', 'hobby', 'luxury'], durabilityUses: 50000, repairCost: 180, ambient: { environment: 3, fun: 1, noise: 3 },
    interactions: [
      practice('practice', 'Practice piano', 'piano', 45, { icon: '🎹', fun: 12, description: 'Scales, then the piece you keep flubbing.' }),
      practice('play_for_fun', 'Noodle around on the piano', 'piano', 20, { icon: '🎹', fun: 10, xp: 8, stress: -8 }),
      practice('compose', 'Compose a song', 'music', 60, { icon: '🎼', fun: 12, xp: 30, minLevel: 3 }),
      perform('piano', 'Play for the room', '🎹'),
      act({ id: 'tune', label: 'Have the piano tuned', category: 'chores', icon: '🔧', durationMinutes: 90, cost: 150, effects: { needs: { fun: 2 }, custom: [cx('property:repair', { skill: 'music' })] }, autonomyWeight: 0.02, group: 'Chores' }),
    ],
  }),
  def({
    id: 'keyboard', name: 'Digital keyboard', category: 'hobby', icon: '🎹', basePrice: 450, description: 'An 88-key digital piano with headphones for the neighbors\' sake.', requiresUtility: 'electric',
    rooms: ['bedroom', 'living', 'office'], tags: ['music', 'instrument', 'piano', 'hobby'], durabilityUses: 10000, repairCost: 80, ambient: { fun: 1 },
    interactions: [
      practice('practice', 'Practice keyboard', 'piano', 45, { icon: '🎹', fun: 10 }),
      practice('headphones', 'Practice quietly with headphones', 'piano', 45, { icon: '🎧', fun: 8, description: 'Late night practice, no complaints.' }),
      practice('produce', 'Produce a beat', 'music', 60, { icon: '🎛️', fun: 14, xp: 28, minLevel: 2 }),
      perform('piano', 'Play something for people', '🎹'),
    ],
  }),
  def({
    id: 'guitar', name: 'Guitar', category: 'hobby', icon: '🎸', basePrice: 280, description: 'An acoustic guitar with one string slightly out of tune, always.',
    rooms: ['bedroom', 'living'], tags: ['music', 'instrument', 'guitar', 'hobby', 'portable'], durabilityUses: 8000, portable: true, repairCost: 40, ambient: { fun: 1 },
    interactions: [
      practice('practice', 'Practice guitar', 'guitar', 45, { icon: '🎸', fun: 12 }),
      practice('strum', 'Strum a few songs', 'guitar', 20, { icon: '🎸', fun: 10, xp: 8, stress: -8 }),
      practice('write_song', 'Write a song', 'music', 60, { icon: '🎼', fun: 12, xp: 30, minLevel: 2 }),
      perform('guitar', 'Play for people', '🎸'),
      act({ id: 'restring', label: 'Restring the guitar', category: 'chores', icon: '🔧', durationMinutes: 25, consumes: [{ itemId: 'guitar_strings', qty: 1 }], effects: { skills: { guitar: 4, handiness: 3 }, custom: [cx('property:repair', { skill: 'handiness' })] }, autonomyWeight: 0.05, group: 'Chores' }),
      act({ id: 'busk_practice', label: 'Practice busking set', category: 'hobby', icon: '🎩', durationMinutes: 60, effects: { skills: { guitar: 25, singing: 10, charisma: 5 }, needs: { fun: 12, energy: -6 } }, requirements: [skillReq('guitar', 3)], autonomyWeight: 0.1, group: 'Hobby' }),
    ],
  }),
  def({
    id: 'drum_kit', name: 'Drum kit', category: 'hobby', icon: '🥁', basePrice: 800, description: 'A five-piece drum kit. Your neighbors know your name.',
    rooms: ['garage', 'basement'], tags: ['music', 'instrument', 'drums', 'hobby', 'loud'], durabilityUses: 10000, repairCost: 90, ambient: { fun: 2, noise: 8 },
    interactions: [
      practice('practice', 'Practice drums', 'music', 45, { icon: '🥁', fun: 16, energy: -10, description: 'Rudiments and fills. Loudly.' }),
      practice('jam', 'Jam out', 'music', 30, { icon: '🥁', fun: 18, xp: 12, energy: -8, stress: -12 }),
      act({ id: 'stress_drum', label: 'Drum out your frustration', category: 'hobby', icon: '😤', durationMinutes: 15, effects: { needs: { fun: 12, energy: -6, hygiene: -4 }, stress: -16, skills: { music: 4 }, fitness: 0.1, moodlets: [mood('relaxed', 'Drummed it out', 4, 120)] }, autonomyWeight: 0.2, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Hobby' }),
      perform('music', 'Play a set for friends', '🥁'),
    ],
  }),
  def({
    id: 'easel', name: 'Easel', category: 'hobby', icon: '🎨', basePrice: 120, description: 'A wooden easel with a canvas and a jar of brushes.',
    rooms: ['office', 'bedroom', 'garage'], tags: ['art', 'painting', 'hobby', 'creative'], durabilityUses: 10000, portable: true, ambient: { environment: 1 },
    interactions: [
      practice('paint', 'Paint', 'painting', 90, { icon: '🎨', fun: 18, xp: 40, consumes: [{ itemId: 'paint_supplies', qty: 1 }], description: 'Uses paint supplies.' }),
      practice('sketch', 'Sketch a study', 'painting', 30, { icon: '✏️', fun: 8, xp: 14 }),
      act({ id: 'paint_to_sell', label: 'Paint a piece to sell', category: 'hobby', icon: '🖼️', durationMinutes: 150, consumes: [{ itemId: 'paint_supplies', qty: 1 }], effects: { skills: { painting: 45, creativity: 10 }, needs: { fun: 14, energy: -10 } }, outcomes: { outcomes: [{ weight: 3, label: 'A masterpiece', effects: { money: { amount: 180, memo: 'Sold a painting' }, moodlets: [mood('proud', 'Sold a painting', 8, 480)] }, skillId: 'painting', skillBias: 3 }, { weight: 5, label: 'Decent, sold cheap', effects: { money: { amount: 45, memo: 'Sold a painting' } }, skillId: 'painting', skillBias: 1 }, { weight: 4, label: 'No buyers', effects: { moodlets: [mood('sad', 'Nobody bit', -2, 120)] } }] }, requirements: [skillReq('painting', 3)], autonomyWeight: 0.15, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Hobby' }),
      act({ id: 'clean_brushes', label: 'Clean the brushes', category: 'chores', icon: '🧽', durationMinutes: 8, effects: { needs: { hygiene: -3 }, custom: [cx('chore:clean', { amount: 15, target: 'object' })] }, autonomyWeight: 0.1, group: 'Chores' }),
    ],
  }),
  def({
    id: 'pottery_wheel', name: 'Pottery wheel', category: 'hobby', icon: '🏺', basePrice: 650, description: 'An electric pottery wheel and a bin of clay. Messy, meditative.', requiresUtility: 'electric', runningCostMonthly: 2,
    rooms: ['garage', 'basement'], tags: ['art', 'craft', 'pottery', 'hobby', 'creative'], durabilityUses: 6000, repairCost: 100,
    interactions: [
      practice('throw', 'Throw a pot', 'crafting', 60, { icon: '🏺', fun: 16, xp: 30, stress: -10 }),
      practice('wedge', 'Wedge clay & practice centering', 'crafting', 30, { icon: '🫙', fun: 6, xp: 14 }),
      act({ id: 'make_gift', label: 'Make a mug as a gift', category: 'hobby', icon: '🎁', durationMinutes: 90, produces: [{ itemId: 'gift_generic', qty: 1 }], effects: { skills: { crafting: 30, creativity: 8 }, needs: { fun: 14, hygiene: -10 } }, requirements: [skillReq('crafting', 2)], autonomyWeight: 0.1, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true }, dirtiesBy: 12, group: 'Hobby' }),
      clean('wheel and splash pan', 15, 30),
    ],
  }),
  def({
    id: 'sewing_machine', name: 'Sewing machine', category: 'hobby', icon: '🧵', basePrice: 220, description: 'A sewing machine. Hems, patches, and one ambitious Halloween costume.', requiresUtility: 'electric',
    rooms: ['office', 'bedroom'], tags: ['craft', 'sewing', 'hobby', 'practical'], durabilityUses: 8000, portable: true, repairCost: 60,
    interactions: [
      practice('sew', 'Sew a project', 'crafting', 60, { icon: '🧵', fun: 10, xp: 28 }),
      act({ id: 'mend', label: 'Mend clothes', category: 'chores', icon: '🪡', durationMinutes: 25, effects: { skills: { crafting: 10 }, needs: { fun: 2 }, money: { amount: 0, memo: 'Mended clothes' }, moodlets: [mood('proud', 'Fixed it instead of buying', 2, 240)] }, autonomyWeight: 0.15, group: 'Chores' }),
      act({ id: 'make_outfit', label: 'Sew an outfit', category: 'hobby', icon: '👗', durationMinutes: 180, produces: [{ itemId: 'outfit_casual', qty: 1 }], effects: { skills: { crafting: 50, creativity: 10 }, needs: { fun: 14, energy: -10 } }, requirements: [skillReq('crafting', 4)], autonomyWeight: 0.05, group: 'Hobby' }),
      act({ id: 'costume', label: 'Make a costume', category: 'hobby', icon: '🎭', durationMinutes: 120, effects: { skills: { crafting: 35, creativity: 10 }, needs: { fun: 16 }, flags: { has_costume: true } }, requirements: [skillReq('crafting', 2)], autonomyWeight: 0.05, group: 'Hobby' }),
    ],
  }),
  def({
    id: 'workbench', name: 'Workbench', category: 'tool', icon: '🔨', basePrice: 300, description: 'A sturdy garage workbench with a vise and a pegboard of tools.',
    rooms: ['garage', 'basement', 'shed'], tags: ['tools', 'diy', 'handiness', 'hobby'], durabilityUses: 30000, repairCost: 40,
    interactions: [
      act({ id: 'fix_something', label: 'Fix something around the house', category: 'chores', icon: '🔧', durationMinutes: 60, effects: { skills: { handiness: 25 }, needs: { fun: 6, hygiene: -8, energy: -6 }, custom: [cx('property:repair', { skill: 'handiness', tool: 'workbench' })] }, outcomes: { outcomes: [{ weight: 6, label: 'Fixed', effects: { moodlets: [mood('proud', 'Fixed it yourself', 4, 300)] }, skillId: 'handiness', skillBias: 2 }, { weight: 3, label: 'Made it worse', effects: { stress: 6, moodlets: [mood('embarrassed', 'Made it worse', -3, 120)] } }, { weight: 1, label: 'Hurt yourself', effects: { health: -1.5, needs: { comfort: -10 } } }] }, autonomyWeight: 0.2, group: 'DIY' }),
      practice('woodworking', 'Do some woodworking', 'crafting', 90, { icon: '🪚', fun: 14, xp: 35, energy: -10 }),
      act({ id: 'build_furniture', label: 'Build a piece of furniture', category: 'hobby', icon: '🪑', durationMinutes: 240, cost: 60, effects: { skills: { handiness: 40, crafting: 30 }, needs: { fun: 16, energy: -18, hygiene: -12 }, custom: [cx('property:upgrade', { what: 'furniture' })], moodlets: [mood('proud', 'Built it yourself', 6, 480)] }, requirements: [skillReq('handiness', 3)], autonomyWeight: 0.05, group: 'DIY' }),
      act({ id: 'tinker', label: 'Tinker with electronics', category: 'hobby', icon: '🔌', durationMinutes: 45, effects: { skills: { handiness: 12, mechanics: 8, logic: 4 }, needs: { fun: 8 } }, autonomyWeight: 0.15, group: 'DIY' }),
      act({ id: 'sharpen', label: 'Sharpen the kitchen knives', category: 'chores', icon: '🔪', durationMinutes: 15, effects: { skills: { handiness: 5, cooking: 2 } }, autonomyWeight: 0.05, group: 'DIY' }),
      clean('workbench', 15, 25),
    ],
  }),
  def({
    id: 'tool_chest', name: 'Tool chest', category: 'tool', icon: '🧰', basePrice: 260, description: 'A rolling tool chest. Sockets, wrenches, and a drawer of mystery screws.',
    rooms: ['garage', 'shed'], tags: ['tools', 'diy', 'handiness', 'mechanics'], durabilityUses: 50000,
    interactions: [
      act({ id: 'grab_tools', label: 'Grab a tool kit', category: 'object', icon: '🧰', durationMinutes: 2, effects: { items: [{ op: 'gain', itemId: 'tool_kit', qty: 1 }] }, autonomyWeight: 0.05, group: 'DIY' }),
      act({ id: 'car_maintenance', label: 'Do basic car maintenance', category: 'chores', icon: '🚗', durationMinutes: 75, cost: 40, effects: { skills: { mechanics: 25, handiness: 8 }, needs: { hygiene: -14, fun: 6, energy: -8 }, custom: [cx('transport:service', { job: 'diy_maintenance' })] }, outcomes: { outcomes: [{ weight: 6, label: 'Runs smoother', effects: { moodlets: [mood('proud', 'Saved on the mechanic', 4, 300)] }, skillId: 'mechanics', skillBias: 2 }, { weight: 2, label: 'Couldn\'t figure it out', effects: { stress: 5 } }] }, requirements: [{ kind: 'vehicle', reason: 'Need a vehicle parked here' }], autonomyWeight: 0.05, group: 'DIY' }),
      act({ id: 'organize_tools', label: 'Organize the tools', category: 'chores', icon: '🗂️', durationMinutes: 20, effects: { needs: { fun: 3 }, stress: -3, skills: { handiness: 3 } }, autonomyWeight: 0.05, group: 'Chores' }),
      act({ id: 'lend_tools', label: 'Put tools away', category: 'chores', icon: '🔧', durationMinutes: 3, effects: { items: [{ op: 'lose', itemId: 'tool_kit', qty: 1 }] }, requirements: [itemReq('tool_kit')], autonomyWeight: 0.05, group: 'DIY' }),
    ],
  }),
);

// =====================================================================================
// HOME — outdoor
// =====================================================================================
add(
  def({
    id: 'garden_bed', name: 'Raised garden bed', category: 'outdoor', icon: '🌱', basePrice: 220, description: 'A raised bed of soil. Tomatoes, herbs, and a war with squirrels.',
    rooms: ['yard'], tags: ['garden', 'outdoor', 'food', 'hobby'], durabilityUses: 20000, repairCost: 40, ambient: { environment: 2 },
    interactions: [
      act({ id: 'plant', label: 'Plant seeds', category: 'hobby', icon: '🌱', durationMinutes: 40, consumes: [{ itemId: 'seeds', qty: 1 }], effects: { skills: { gardening: 18 }, needs: { fun: 8, hygiene: -10, energy: -6 }, stress: -6, flags: { garden_planted: true }, moodlets: [mood('hopeful', 'Seeds in the ground', 3, 480)] }, autonomyWeight: 0.2, group: 'Garden' }),
      act({ id: 'water', label: 'Water the garden', category: 'chores', icon: '💧', durationMinutes: 10, effects: { skills: { gardening: 5 }, needs: { fun: 3 }, stress: -3, custom: [cx('chore:yard', { task: 'water' })] }, autonomyWeight: 0.35, group: 'Garden' }),
      act({ id: 'weed', label: 'Pull weeds', category: 'chores', icon: '🌿', durationMinutes: 30, effects: { skills: { gardening: 12 }, needs: { fun: -2, hygiene: -10, energy: -6 }, fitness: 0.1, stress: -4, custom: [cx('chore:yard', { task: 'weed' })] }, autonomyWeight: 0.2, group: 'Garden' }),
      act({ id: 'harvest', label: 'Harvest vegetables', category: 'hobby', icon: '🥕', durationMinutes: 25, effects: { skills: { gardening: 15 }, needs: { fun: 10, hygiene: -6 }, moodlets: [mood('proud', 'Homegrown', 4, 300)] }, outcomes: { outcomes: [{ weight: 5, label: 'Good haul', effects: { items: [{ op: 'gain', itemId: 'vegetables', qty: 3 }, { op: 'gain', itemId: 'tomatoes', qty: 2 }] }, skillId: 'gardening', skillBias: 2 }, { weight: 4, label: 'A few ripe ones', effects: { items: [{ op: 'gain', itemId: 'vegetables', qty: 1 }, { op: 'gain', itemId: 'tomatoes', qty: 1 }] } }, { weight: 2, label: 'Squirrels got there first', effects: { moodlets: [mood('angry', 'Squirrels!', -2, 120)] } }] }, requirements: [flagReq('garden_planted', 'Nothing planted yet')], autonomyWeight: 0.3, group: 'Garden' }),
      act({ id: 'compost', label: 'Turn the compost', category: 'chores', icon: '♻️', durationMinutes: 15, effects: { skills: { gardening: 6 }, needs: { hygiene: -8 }, custom: [cx('chore:yard', { task: 'compost' })] }, autonomyWeight: 0.1, group: 'Garden' }),
    ],
  }),
  def({
    id: 'planter', name: 'Planter box', category: 'outdoor', icon: '🪴', basePrice: 45, description: 'A balcony planter with herbs and a very determined basil.',
    rooms: ['balcony', 'yard', 'kitchen'], tags: ['garden', 'outdoor', 'herbs', 'small_space'], durabilityUses: 10000, portable: true, ambient: { environment: 1 },
    interactions: [
      act({ id: 'plant_herbs', label: 'Plant herbs', category: 'hobby', icon: '🌿', durationMinutes: 20, consumes: [{ itemId: 'seeds', qty: 1 }], effects: { skills: { gardening: 10 }, needs: { fun: 6, hygiene: -4 }, flags: { herbs_planted: true } }, autonomyWeight: 0.15, group: 'Garden' }),
      act({ id: 'water', label: 'Water the planter', category: 'chores', icon: '💧', durationMinutes: 3, effects: { skills: { gardening: 2 }, stress: -2 }, autonomyWeight: 0.3, group: 'Garden' }),
      act({ id: 'snip_herbs', label: 'Snip fresh herbs', category: 'hobby', icon: '✂️', durationMinutes: 5, effects: { skills: { gardening: 3, cooking: 2 }, items: [{ op: 'gain', itemId: 'vegetables', qty: 1 }], needs: { fun: 3 } }, requirements: [flagReq('herbs_planted', 'Nothing growing yet')], autonomyWeight: 0.15, group: 'Garden' }),
    ],
  }),
  def({
    id: 'lawn_mower', name: 'Lawn mower', category: 'tool', icon: '🚜', basePrice: 380, description: 'A gas push mower that starts on the third pull.', runningCostMonthly: 4,
    rooms: ['garage', 'shed'], tags: ['yard', 'tool', 'outdoor', 'chore'], durabilityUses: 1500, repairCost: 90,
    interactions: [
      act({ id: 'mow', label: 'Mow the lawn', category: 'chores', icon: '🚜', durationMinutes: 45, effects: { needs: { fun: -4, energy: -14, hygiene: -20, thirst: -12 }, fitness: 0.3, stress: -3, custom: [cx('chore:yard', { task: 'mow' })], moodlets: [mood('proud', 'Fresh-cut lawn', 3, 480)] }, requiresState: { notBroken: true }, wearBy: 3, minStage: TEEN, autonomyWeight: 0.3, group: 'Yard' }),
      act({ id: 'edge', label: 'Edge and trim', category: 'chores', icon: '✂️', durationMinutes: 25, effects: { needs: { energy: -8, hygiene: -10 }, custom: [cx('chore:yard', { task: 'trim' })] }, minStage: TEEN, autonomyWeight: 0.1, group: 'Yard' }),
      act({ id: 'service', label: 'Service the mower', category: 'chores', icon: '🔧', durationMinutes: 40, cost: 15, effects: { skills: { mechanics: 12, handiness: 6 }, needs: { hygiene: -10 }, custom: [cx('property:repair', { skill: 'mechanics' })] }, autonomyWeight: 0.05, group: 'Yard' }),
      act({ id: 'mow_for_cash', label: 'Mow a neighbor\'s lawn for cash', category: 'work', icon: '💵', durationMinutes: 60, effects: { needs: { energy: -16, hygiene: -22, fun: -4 }, money: { amount: 45, memo: 'Mowed a neighbor\'s lawn' }, fitness: 0.3, custom: [cx('career:gig', { kind: 'lawn' })] }, requiresState: { notBroken: true }, wearBy: 4, minStage: TEEN, autonomyWeight: 0.1, llm: 'narrate', group: 'Yard' }),
    ],
  }),
  def({
    id: 'grill', name: 'Gas grill', category: 'outdoor', icon: '🍖', basePrice: 450, description: 'A propane grill on the patio. Summer lives here.', requiresUtility: 'gas', runningCostMonthly: 5,
    rooms: ['yard', 'patio', 'balcony'], tags: ['outdoor', 'cooking', 'grill', 'summer', 'social'], durabilityUses: 5000, repairCost: 80, ambient: { fun: 1 },
    interactions: [
      ...cookSet('grill', 'Grill'),
      act({ id: 'cookout', label: 'Host a cookout', description: 'Burgers, dogs, neighbors.', category: 'social', icon: '🎉', durationMinutes: 180, consumes: [{ itemId: 'ground_beef', qty: 2 }, { itemId: 'bread', qty: 1 }, { itemId: 'beer', qty: 4 }], effects: { needs: { hunger: 60, social: 35, fun: 25, hygiene: -10 }, skills: { cooking: 15, charisma: 8 }, stress: -8, bloodAlcohol: 0.02, moodlets: [mood('happy', 'Backyard cookout', 7, 480)] }, satisfies: ['social', 'fun', 'hunger'], minStage: YA, autonomyWeight: 0.15, llm: 'narrate', dirtiesBy: 20, group: 'Social' }),
      act({ id: 'scrape_grates', label: 'Scrape the grates', category: 'chores', icon: '🧽', durationMinutes: 10, effects: { needs: { hygiene: -5 }, custom: [cx('chore:clean', { amount: 30, target: 'object' })] }, autonomyWeight: 0.1, group: 'Chores' }),
      act({ id: 'swap_propane', label: 'Swap the propane tank', category: 'chores', icon: '🛢️', durationMinutes: 20, cost: 22, effects: { needs: { energy: -3 } }, autonomyWeight: 0.05, group: 'Chores' }),
    ],
  }),
  def({
    id: 'fire_pit', name: 'Fire pit', category: 'outdoor', icon: '🔥', basePrice: 200, description: 'A steel fire pit and a stack of wood. S\'mores capable.',
    rooms: ['yard', 'patio'], tags: ['outdoor', 'fire', 'social', 'cozy', 'fall'], durabilityUses: 5000, ambient: { comfort: 2, fun: 2 },
    interactions: [
      act({ id: 'light_fire', label: 'Light a fire', category: 'needs', icon: '🔥', durationMinutes: 10, effects: { skills: { handiness: 3 }, needs: { comfort: 6, fun: 4 } }, setsState: { on: true }, autonomyWeight: 0.2, group: 'Fire' }),
      act({ id: 'sit_by_fire', label: 'Sit by the fire', category: 'needs', icon: '🪵', durationMinutes: 45, effects: { perMinute: { comfort: 0.2, fun: 0.15 }, stress: -10, moodlets: [mood('relaxed', 'Firelight', 5, 240)] }, requiresState: { on: true }, satisfies: ['comfort', 'fun'], autonomyWeight: 0.5, group: 'Fire' }),
      act({ id: 'smores', label: 'Make s\'mores', category: 'social', icon: '🍫', durationMinutes: 20, consumes: [{ itemId: 'chocolate', qty: 1 }, { itemId: 'cookies', qty: 1 }], effects: { needs: { hunger: 16, fun: 14, social: 8 }, moodlets: [mood('nostalgic', 'S\'mores', 4, 180)] }, requiresState: { on: true }, autonomyWeight: 0.2, group: 'Fire' }),
      ...cookSet('fire_pit', 'Roast'),
      act({ id: 'tell_stories', label: 'Tell stories around the fire', category: 'social', icon: '👻', durationMinutes: 40, effects: { needs: { social: 20, fun: 16 }, skills: { charisma: 8, comedy: 4 } }, requiresState: { on: true }, satisfies: ['social'], autonomyWeight: 0.3, llm: 'narrate', group: 'Fire' }),
      act({ id: 'put_out', label: 'Put out the fire', category: 'chores', icon: '💧', durationMinutes: 5, effects: { stress: -1 }, setsState: { on: false }, autonomyWeight: 0.2, group: 'Fire' }),
    ],
  }),
  def({
    id: 'patio_set', name: 'Patio set', category: 'outdoor', icon: '⛱️', basePrice: 400, description: 'A table and chairs under an umbrella. Coffee in the morning, drinks at night.',
    rooms: ['patio', 'yard', 'balcony'], tags: ['outdoor', 'seating', 'social'], durabilityUses: 6000, ambient: { comfort: 2, environment: 1 },
    interactions: [
      sit('Sit on the patio', 0.16, 0.1, 30),
      ...eatSet(['meal_basic', 'meal_good', 'meal_gourmet', 'takeout_meal', 'sandwich'], 5, 25, 'Eat outside'),
      act({ id: 'morning_coffee', label: 'Have coffee outside', category: 'needs', icon: '☕', durationMinutes: 20, consumes: [{ itemId: 'coffee_cup', qty: 1 }], effects: { needs: { energy: 15, comfort: 12, fun: 6 }, caffeine: 95, stress: -8, moodlets: [mood('relaxed', 'Quiet morning', 4, 180)] }, autonomyWeight: 0.4, group: 'Relax' }),
      act({ id: 'sunbathe', label: 'Sunbathe', category: 'needs', icon: '☀️', durationMinutes: 45, effects: { perMinute: { comfort: 0.15, fun: 0.1 }, stress: -6, health: 0.1, moodlets: [mood('relaxed', 'Sun-kissed', 3, 240)] }, satisfies: ['comfort'], autonomyWeight: 0.2, group: 'Relax' }),
      act({ id: 'drinks_with_friends', label: 'Have drinks with friends outside', category: 'social', icon: '🍻', durationMinutes: 90, consumes: [{ itemId: 'beer', qty: 3 }], effects: { needs: { social: 28, fun: 22 }, bloodAlcohol: 0.04, stress: -8, moodlets: [mood('happy', 'Patio drinks', 5, 240)] }, satisfies: ['social', 'fun'], minStage: YA, autonomyWeight: 0.2, llm: 'narrate', group: 'Social' }),
      clean('patio furniture', 10, 20),
    ],
  }),
  def({
    id: 'hot_tub', name: 'Hot tub', category: 'outdoor', icon: '♨️', basePrice: 6500, description: 'A six-person hot tub. Chemicals and electricity bills included.', requiresUtility: 'electric', runningCostMonthly: 40,
    rooms: ['yard', 'patio'], tags: ['outdoor', 'luxury', 'relax', 'social', 'romantic'], durabilityUses: 8000, repairCost: 400, ambient: { comfort: 4, fun: 3 },
    interactions: [
      act({ id: 'soak', label: 'Soak in the hot tub', category: 'needs', icon: '♨️', durationMinutes: 40, effects: { perMinute: { comfort: 0.5, fun: 0.2 }, needs: { hygiene: 10, energy: 5 }, stress: -18, moodlets: [mood('relaxed', 'Hot tub', 7, 300)] }, satisfies: ['comfort', 'fun'], autonomyWeight: 0.6, requiresState: { notBroken: true }, minStage: CHILD, dirtiesBy: 3, wearBy: 0.5, group: 'Relax' }),
      act({ id: 'soak_together', label: 'Soak with someone', category: 'social', icon: '🥂', durationMinutes: 45, effects: { perMinute: { comfort: 0.5, fun: 0.25 }, needs: { social: 25 }, stress: -16, moodlets: [mood('flirty', 'Hot tub company', 5, 240)] }, satisfies: ['social', 'comfort'], minStage: YA, autonomyWeight: 0.2, llm: 'narrate', requiresState: { notBroken: true }, dirtiesBy: 4, group: 'Social' }),
      act({ id: 'balance_chemicals', label: 'Test and balance the water', category: 'chores', icon: '🧪', durationMinutes: 15, cost: 12, effects: { skills: { handiness: 4 }, custom: [cx('chore:clean', { amount: 40, target: 'object' })] }, autonomyWeight: 0.1, group: 'Chores' }),
      act({ id: 'cover', label: 'Put the cover on', category: 'chores', icon: '🛡️', durationMinutes: 3, effects: { skills: { finance: 1 } }, setsState: { on: false }, autonomyWeight: 0.1, group: 'Chores' }),
    ],
  }),
  def({
    id: 'pool_home', name: 'Backyard pool', category: 'outdoor', icon: '🏊', basePrice: 35000, description: 'An in-ground pool. The neighborhood kids know about it.', requiresUtility: 'water', runningCostMonthly: 120,
    rooms: ['yard'], tags: ['outdoor', 'luxury', 'swim', 'summer', 'fitness', 'social'], durabilityUses: 100000, repairCost: 800, ambient: { fun: 5, environment: 3 },
    interactions: [
      workout('swim_laps', 'Swim laps', 40, { icon: '🏊', intensity: 1, kind: 'swim', skill: 'athletics', fun: 14, minStage: CHILD, wearBy: 0.1 }),
      act({ id: 'splash', label: 'Splash around', category: 'entertainment', icon: '💦', durationMinutes: 45, effects: { perMinute: { fun: 0.4 }, needs: { hygiene: 6, energy: -8, social: 8 }, fitness: 0.3, stress: -8, moodlets: [mood('playful', 'Pool day', 5, 240)] }, satisfies: ['fun'], minStage: CHILD, autonomyWeight: 0.6, group: 'Swim' }),
      act({ id: 'float', label: 'Float on a pool noodle', category: 'needs', icon: '🛟', durationMinutes: 30, effects: { perMinute: { comfort: 0.3, fun: 0.15 }, stress: -10, moodlets: [mood('relaxed', 'Floating', 4, 180)] }, satisfies: ['comfort'], minStage: CHILD, autonomyWeight: 0.3, group: 'Swim' }),
      act({ id: 'pool_party', label: 'Throw a pool party', category: 'social', icon: '🎉', durationMinutes: 240, cost: 80, effects: { needs: { social: 40, fun: 40, energy: -20, hygiene: -6 }, stress: -6, custom: [cx('chore:clean', { amount: -25, target: 'venue' })], moodlets: [mood('happy', 'Pool party', 8, 480)] }, satisfies: ['social', 'fun'], minStage: TEEN, autonomyWeight: 0.1, llm: 'narrate', group: 'Social' }),
      act({ id: 'skim', label: 'Skim and vacuum the pool', category: 'chores', icon: '🧹', durationMinutes: 30, effects: { needs: { fun: -3, energy: -5 }, custom: [cx('chore:clean', { amount: 30, target: 'object' })] }, autonomyWeight: 0.15, group: 'Chores' }),
      act({ id: 'chemicals', label: 'Add pool chemicals', category: 'chores', icon: '🧪', durationMinutes: 15, cost: 25, effects: { skills: { handiness: 3 }, custom: [cx('chore:clean', { amount: 30, target: 'object' })] }, autonomyWeight: 0.1, group: 'Chores' }),
    ],
  }),
  def({
    id: 'hammock', name: 'Hammock', category: 'outdoor', icon: '🪢', basePrice: 70, description: 'A hammock strung between two trees. Getting in is a skill.',
    rooms: ['yard', 'balcony'], tags: ['outdoor', 'relax', 'summer'], durabilityUses: 3000, portable: true, ambient: { comfort: 1 },
    interactions: [
      act({ id: 'lie', label: 'Lie in the hammock', category: 'needs', icon: '🪢', durationMinutes: 30, effects: { perMinute: { comfort: 0.3, fun: 0.1, energy: 0.08 }, stress: -10, moodlets: [mood('relaxed', 'Swaying in the breeze', 4, 180)] }, satisfies: ['comfort'], autonomyWeight: 0.5, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Relax' }),
      act({ id: 'nap', label: 'Nap in the hammock', category: 'needs', icon: '💤', durationMinutes: 60, effects: { perMinute: { energy: 0.22, comfort: 0.15 }, custom: [cx('health:sleep', { minutes: 60, quality: 0.7 })] }, satisfies: ['energy'], autonomyWeight: 0.5, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Rest' }),
      read(0.25, 45),
    ],
  }),
  def({
    id: 'bike_rack', name: 'Bike rack', category: 'outdoor', icon: '🚲', basePrice: 60, description: 'A wall-mounted bike rack in the garage.',
    rooms: ['garage', 'entry'], tags: ['bike', 'storage', 'transport'], durabilityUses: 20000,
    interactions: [
      act({ id: 'tune_bike', label: 'Tune up the bike', category: 'chores', icon: '🔧', durationMinutes: 30, effects: { skills: { mechanics: 10, handiness: 5 }, needs: { hygiene: -6, fun: 4 }, custom: [cx('transport:bike', { action: 'maintain' })] }, autonomyWeight: 0.1, group: 'Bike' }),
      act({ id: 'pump_tires', label: 'Pump the tires', category: 'chores', icon: '🎈', durationMinutes: 5, effects: { needs: { energy: -1 }, custom: [cx('transport:bike', { action: 'maintain' })] }, autonomyWeight: 0.1, group: 'Bike' }),
      act({ id: 'hang_bike', label: 'Hang up the bike', category: 'object', icon: '🚲', durationMinutes: 2, effects: { custom: [cx('transport:bike', { action: 'lock' })] }, autonomyWeight: 0.1, group: 'Bike' }),
    ],
  }),
  def({
    id: 'car_charger_home', name: 'Home EV charger', category: 'appliance', icon: '🔌', basePrice: 1200, description: 'A Level 2 wall charger in the garage. Wakes up to a full battery.', requiresUtility: 'electric', runningCostMonthly: 55,
    rooms: ['garage', 'driveway'], tags: ['ev', 'car', 'transport', 'smart_home'], durabilityUses: 20000, repairCost: 250,
    interactions: [
      act({ id: 'plug_in', label: 'Plug in the car', category: 'object', icon: '🔌', durationMinutes: 2, effects: { custom: [cx('transport:charge_ev', { minutes: 480, level: 2 })], stress: -1 }, requirements: [{ kind: 'vehicle', reason: 'No EV parked here' }], autonomyWeight: 0.4, group: 'Car' }),
      act({ id: 'schedule_charge', label: 'Schedule off-peak charging', category: 'finance', icon: '🕒', durationMinutes: 3, effects: { skills: { finance: 2 }, custom: [cx('transport:charge_ev', { minutes: 480, level: 2, offPeak: true })] }, autonomyWeight: 0.1, group: 'Car' }),
    ],
  }),
);

// =====================================================================================
// HOME — pets
// =====================================================================================
add(
  def({
    id: 'dog_bed', name: 'Dog bed', category: 'pet', icon: '🐕', basePrice: 55, description: 'A plush dog bed the dog ignores in favor of the couch.',
    rooms: ['living', 'bedroom'], tags: ['pet', 'dog'], durabilityUses: 3000, portable: true,
    interactions: [
      act({ id: 'pet_dog', label: 'Pet the dog', category: 'pet', icon: '🐶', durationMinutes: 8, effects: { needs: { social: 8, fun: 6 }, stress: -8, custom: [cx('pet:play', { kind: 'pet' })], moodlets: [mood('happy', 'Good dog', 3, 120)] }, satisfies: ['social'], autonomyWeight: 0.5, group: 'Pet' }),
      act({ id: 'play_fetch', label: 'Play fetch', category: 'pet', icon: '🎾', durationMinutes: 20, effects: { needs: { social: 10, fun: 14, energy: -6 }, fitness: 0.1, custom: [cx('pet:play', { kind: 'fetch' })] }, satisfies: ['fun'], autonomyWeight: 0.4, group: 'Pet' }),
      act({ id: 'walk_dog', label: 'Walk the dog', category: 'pet', icon: '🦮', durationMinutes: 30, effects: { needs: { fun: 10, social: 6, energy: -6, hygiene: -4 }, fitness: 0.3, stress: -6, custom: [cx('pet:walk', { minutes: 30 })] }, requirements: [itemReq('leash')], satisfies: ['fun'], autonomyWeight: 0.6, group: 'Pet' }),
      act({ id: 'feed_dog', label: 'Feed the dog', category: 'pet', icon: '🥣', durationMinutes: 4, consumes: [{ itemId: 'dog_food', qty: 1 }], effects: { custom: [cx('pet:feed', { itemId: 'dog_food', species: 'dog' })], needs: { social: 2 } }, autonomyWeight: 0.7, group: 'Pet' }),
      act({ id: 'train_dog', label: 'Train the dog', category: 'pet', icon: '🎓', durationMinutes: 25, consumes: [{ itemId: 'pet_treats', qty: 1 }], effects: { needs: { fun: 8, social: 6 }, custom: [cx('pet:train', {})], skills: { parenting: 3 } }, autonomyWeight: 0.2, group: 'Pet' }),
      act({ id: 'wash_bed', label: 'Wash the dog bed', category: 'chores', icon: '🧺', durationMinutes: 10, effects: { custom: [cx('chore:clean', { amount: 30, target: 'object' })] }, autonomyWeight: 0.1, group: 'Chores' }),
    ],
  }),
  def({
    id: 'cat_tree', name: 'Cat tree', category: 'pet', icon: '🐈', basePrice: 90, description: 'A carpeted cat tower. The cat prefers the box it came in.',
    rooms: ['living', 'bedroom'], tags: ['pet', 'cat'], durabilityUses: 4000,
    interactions: [
      act({ id: 'pet_cat', label: 'Pet the cat', category: 'pet', icon: '🐱', durationMinutes: 6, effects: { needs: { social: 6, fun: 5 }, stress: -7, custom: [cx('pet:play', { kind: 'pet' })] }, outcomes: { outcomes: [{ weight: 5, label: 'Purring', effects: { moodlets: [mood('relaxed', 'Purring cat', 3, 120)] } }, { weight: 1, label: 'Scratched', effects: { health: -0.2, needs: { comfort: -4 } } }] }, satisfies: ['social'], autonomyWeight: 0.5, group: 'Pet' }),
      act({ id: 'play_wand', label: 'Play with the feather wand', category: 'pet', icon: '🪶', durationMinutes: 15, effects: { needs: { fun: 12, social: 6 }, custom: [cx('pet:play', { kind: 'toy' })] }, satisfies: ['fun'], autonomyWeight: 0.4, group: 'Pet' }),
      act({ id: 'feed_cat', label: 'Feed the cat', category: 'pet', icon: '🥣', durationMinutes: 3, consumes: [{ itemId: 'cat_food', qty: 1 }], effects: { custom: [cx('pet:feed', { itemId: 'cat_food', species: 'cat' })] }, autonomyWeight: 0.7, group: 'Pet' }),
      act({ id: 'brush_cat', label: 'Brush the cat', category: 'pet', icon: '🪮', durationMinutes: 10, effects: { needs: { social: 4 }, custom: [cx('pet:groom', {})], stress: -3 }, autonomyWeight: 0.2, group: 'Pet' }),
      act({ id: 'vacuum_fur', label: 'Vacuum the cat fur', category: 'chores', icon: '🧹', durationMinutes: 8, effects: { custom: [cx('chore:clean', { amount: 15, target: 'object' })] }, autonomyWeight: 0.1, group: 'Chores' }),
    ],
  }),
  def({
    id: 'litter_box', name: 'Litter box', category: 'pet', icon: '🐈', basePrice: 35, description: 'A covered litter box. Scoop daily or regret it.',
    rooms: ['bathroom', 'laundry', 'hallway'], tags: ['pet', 'cat', 'chore'], durabilityUses: 10000, portable: true, ambient: { environment: -1 },
    interactions: [
      act({ id: 'scoop', label: 'Scoop the litter box', category: 'chores', icon: '🧹', durationMinutes: 5, effects: { needs: { fun: -3, hygiene: -3 }, custom: [cx('pet:litter', { action: 'scoop' }), cx('chore:clean', { amount: 20, target: 'object' })] }, autonomyWeight: 0.5, group: 'Pet' }),
      act({ id: 'change_litter', label: 'Change the litter', category: 'chores', icon: '🧺', durationMinutes: 12, consumes: [{ itemId: 'cat_litter', qty: 1 }], effects: { needs: { fun: -4, hygiene: -5 }, custom: [cx('pet:litter', { action: 'change' }), cx('chore:clean', { amount: 40, target: 'object' })] }, autonomyWeight: 0.3, group: 'Pet' }),
    ],
  }),
  def({
    id: 'aquarium', name: 'Aquarium', category: 'pet', icon: '🐠', basePrice: 260, description: 'A 20-gallon tank with a bubbling filter. Fish names change weekly.', requiresUtility: 'electric', runningCostMonthly: 8,
    rooms: ['living', 'bedroom', 'office'], tags: ['pet', 'fish', 'decor', 'calm'], durabilityUses: 20000, repairCost: 60, ambient: { comfort: 2, environment: 2 },
    interactions: [
      act({ id: 'watch_fish', label: 'Watch the fish', category: 'entertainment', icon: '🐠', durationMinutes: 10, effects: { needs: { fun: 5, comfort: 4 }, stress: -7, moodlets: [mood('relaxed', 'Fish-watching', 3, 120)] }, satisfies: ['fun'], autonomyWeight: 0.3, group: 'Pet' }),
      act({ id: 'feed_fish', label: 'Feed the fish', category: 'pet', icon: '🥣', durationMinutes: 2, effects: { custom: [cx('pet:feed', { itemId: 'fish_food', species: 'fish' })], needs: { fun: 2 } }, autonomyWeight: 0.6, group: 'Pet' }),
      act({ id: 'clean_tank', label: 'Clean the tank', category: 'chores', icon: '🧽', durationMinutes: 40, effects: { needs: { fun: -4, hygiene: -6 }, custom: [cx('pet:aquarium_care', { action: 'water_change' }), cx('chore:clean', { amount: 40, target: 'object' })] }, autonomyWeight: 0.15, group: 'Chores' }),
    ],
  }),
  def({
    id: 'bird_cage', name: 'Bird cage', category: 'pet', icon: '🦜', basePrice: 120, description: 'A tall cage with a parakeet who has opinions.',
    rooms: ['living', 'bedroom'], tags: ['pet', 'bird'], durabilityUses: 20000, ambient: { fun: 1, noise: 2 },
    interactions: [
      act({ id: 'talk_to_bird', label: 'Talk to the bird', category: 'pet', icon: '🗣️', durationMinutes: 8, effects: { needs: { social: 6, fun: 6 }, stress: -3, custom: [cx('pet:play', { kind: 'talk' })] }, satisfies: ['social'], autonomyWeight: 0.3, llm: 'narrate', group: 'Pet' }),
      act({ id: 'feed_bird', label: 'Feed the bird', category: 'pet', icon: '🌾', durationMinutes: 3, effects: { custom: [cx('pet:feed', { itemId: 'bird_seed', species: 'bird' })] }, autonomyWeight: 0.6, group: 'Pet' }),
      act({ id: 'let_out', label: 'Let the bird out to fly', category: 'pet', icon: '🕊️', durationMinutes: 20, effects: { needs: { fun: 10 }, custom: [cx('pet:play', { kind: 'free_flight' })] }, autonomyWeight: 0.2, group: 'Pet' }),
      act({ id: 'clean_cage', label: 'Clean the cage', category: 'chores', icon: '🧽', durationMinutes: 15, effects: { needs: { fun: -3, hygiene: -4 }, custom: [cx('pet:cage_care', {}), cx('chore:clean', { amount: 30, target: 'object' })] }, autonomyWeight: 0.2, group: 'Chores' }),
    ],
  }),
  def({
    id: 'hamster_cage', name: 'Hamster cage', category: 'pet', icon: '🐹', basePrice: 60, description: 'A cage with a wheel that squeaks all night.',
    rooms: ['bedroom', 'kids'], tags: ['pet', 'small_pet', 'kids'], durabilityUses: 20000, portable: true, ambient: { noise: 1 },
    interactions: [
      act({ id: 'hold_hamster', label: 'Hold the hamster', category: 'pet', icon: '🐹', durationMinutes: 8, effects: { needs: { social: 5, fun: 6 }, stress: -4, custom: [cx('pet:play', { kind: 'hold' })] }, satisfies: ['fun'], autonomyWeight: 0.3, group: 'Pet' }),
      act({ id: 'feed_hamster', label: 'Feed the hamster', category: 'pet', icon: '🥕', durationMinutes: 2, effects: { custom: [cx('pet:feed', { itemId: 'hamster_food', species: 'hamster' })] }, autonomyWeight: 0.6, group: 'Pet' }),
      act({ id: 'clean_cage', label: 'Clean the cage', category: 'chores', icon: '🧽', durationMinutes: 15, effects: { needs: { fun: -3, hygiene: -4 }, custom: [cx('pet:cage_care', {}), cx('chore:clean', { amount: 30, target: 'object' })] }, autonomyWeight: 0.2, group: 'Chores' }),
      act({ id: 'watch_wheel', label: 'Watch it run on the wheel', category: 'entertainment', icon: '🎡', durationMinutes: 5, effects: { needs: { fun: 4 } }, autonomyWeight: 0.1, group: 'Pet' }),
    ],
  }),
);

// =====================================================================================
// HOME — toys, games & misc
// =====================================================================================
add(
  def({
    id: 'toy_box', name: 'Toy box', category: 'toy', icon: '🧸', basePrice: 80, description: 'A wooden chest of blocks, dolls, and cars with three wheels.',
    rooms: ['kids', 'living'], tags: ['toy', 'kids', 'family'], durabilityUses: 10000,
    interactions: [
      act({ id: 'play_toys', label: 'Play with toys', category: 'entertainment', icon: '🧸', durationMinutes: 40, effects: { perMinute: { fun: 0.45 }, skills: { creativity: 8 }, needs: { social: 2 } }, satisfies: ['fun'], autonomyWeight: 1.2, group: 'Play' }),
      act({ id: 'play_pretend', label: 'Play pretend', category: 'entertainment', icon: '🦸', durationMinutes: 30, effects: { perMinute: { fun: 0.4 }, skills: { creativity: 10, charisma: 4 } }, satisfies: ['fun'], autonomyWeight: 0.8, llm: 'narrate', group: 'Play' }),
      act({ id: 'play_with_kid', label: 'Play with the kids', category: 'family', icon: '👨‍👧', durationMinutes: 30, effects: { needs: { fun: 12, social: 14 }, skills: { parenting: 8 }, stress: -5, custom: [cx('family:play_with_child', {})], moodlets: [mood('grateful', 'Playtime', 4, 180)] }, minStage: TEEN, satisfies: ['social'], autonomyWeight: 0.4, llm: 'narrate', group: 'Family' }),
      act({ id: 'clean_up_toys', label: 'Clean up the toys', category: 'chores', icon: '🧹', durationMinutes: 10, effects: { needs: { fun: -2 }, custom: [cx('chore:clean', { amount: 20, target: 'room' })] }, autonomyWeight: 0.3, group: 'Chores' }),
    ],
  }),
  def({
    id: 'board_games', name: 'Board game shelf', category: 'toy', icon: '🎲', basePrice: 150, description: 'A shelf of board games. Monopoly has ended friendships.',
    rooms: ['living', 'closet'], tags: ['games', 'social', 'family', 'fun'], durabilityUses: 10000, ambient: { fun: 1 },
    interactions: [
      act({ id: 'game_night', label: 'Host game night', category: 'social', icon: '🎲', durationMinutes: 120, effects: { needs: { fun: 30, social: 30 }, skills: { logic: 8, charisma: 4 }, stress: -8, moodlets: [mood('playful', 'Game night', 6, 300)] }, satisfies: ['fun', 'social'], autonomyWeight: 0.3, llm: 'narrate', minStage: CHILD, group: 'Play' }),
      act({ id: 'quick_game', label: 'Play a quick card game', category: 'social', icon: '🃏', durationMinutes: 30, effects: { needs: { fun: 14, social: 12 }, skills: { logic: 4 } }, satisfies: ['fun', 'social'], autonomyWeight: 0.4, minStage: CHILD, group: 'Play' }),
      act({ id: 'solitaire', label: 'Play solitaire', category: 'entertainment', icon: '🂡', durationMinutes: 20, effects: { needs: { fun: 8 }, skills: { logic: 4 }, stress: -3 }, satisfies: ['fun'], autonomyWeight: 0.3, minStage: CHILD, group: 'Play' }),
      act({ id: 'strategy_game', label: 'Play a long strategy game', category: 'social', icon: '🏰', durationMinutes: 180, effects: { needs: { fun: 30, social: 20, energy: -8 }, skills: { logic: 20, negotiation: 6 } }, satisfies: ['fun'], autonomyWeight: 0.15, minStage: TEEN, group: 'Play' }),
    ],
  }),
  def({
    id: 'puzzle', name: 'Jigsaw puzzle', category: 'toy', icon: '🧩', basePrice: 20, description: 'A 1000-piece puzzle occupying the dining table indefinitely.',
    rooms: ['dining', 'living'], tags: ['games', 'quiet', 'hobby'], durabilityUses: 500, portable: true,
    interactions: [
      act({ id: 'work_puzzle', label: 'Work on the puzzle', category: 'entertainment', icon: '🧩', durationMinutes: 45, effects: { perMinute: { fun: 0.2 }, skills: { logic: 8 }, stress: -8, moodlets: [mood('focused', 'Puzzle zen', 3, 120)] }, satisfies: ['fun'], autonomyWeight: 0.4, group: 'Play' }),
      act({ id: 'finish_puzzle', label: 'Finish the puzzle', category: 'entertainment', icon: '🏁', durationMinutes: 90, effects: { needs: { fun: 22 }, skills: { logic: 14 }, stress: -6 }, outcomes: { outcomes: [{ weight: 8, label: 'Done!', effects: { moodlets: [mood('proud', 'Finished the puzzle', 5, 300)] } }, { weight: 2, label: 'One piece missing', effects: { stress: 6, moodlets: [mood('angry', 'Missing piece', -3, 120)] } }] }, autonomyWeight: 0.1, group: 'Play' }),
      act({ id: 'puzzle_together', label: 'Puzzle together', category: 'social', icon: '👥', durationMinutes: 60, effects: { needs: { fun: 16, social: 16 }, skills: { logic: 8 }, stress: -6 }, satisfies: ['social'], autonomyWeight: 0.2, llm: 'narrate', group: 'Play' }),
    ],
  }),
  def({
    id: 'chess_set', name: 'Chess set', category: 'toy', icon: '♟️', basePrice: 45, description: 'A wooden chess set. One pawn is a bottle cap.',
    rooms: ['living', 'office'], tags: ['games', 'logic', 'hobby'], durabilityUses: 20000, portable: true,
    interactions: [
      act({ id: 'study_openings', label: 'Study chess openings', category: 'hobby', icon: '📘', durationMinutes: 40, effects: { skills: { logic: 22 }, needs: { fun: 6 } }, autonomyWeight: 0.2, minStage: CHILD, group: 'Play' }),
      act({ id: 'play_match', label: 'Play a match', category: 'social', icon: '♟️', durationMinutes: 45, effects: { needs: { fun: 14, social: 12 }, skills: { logic: 16 } }, outcomes: { outcomes: [{ weight: 5, label: 'Checkmate — you won', effects: { moodlets: [mood('proud', 'Won at chess', 4, 180)] }, skillId: 'logic', skillBias: 2 }, { weight: 5, label: 'Lost', effects: { moodlets: [mood('bored', 'Lost at chess', -2, 60)] } }] }, satisfies: ['fun', 'social'], autonomyWeight: 0.3, minStage: CHILD, llm: 'narrate', group: 'Play' }),
      act({ id: 'solve_puzzles', label: 'Solve chess puzzles', category: 'hobby', icon: '🧠', durationMinutes: 25, effects: { skills: { logic: 14 }, needs: { fun: 8 } }, autonomyWeight: 0.25, minStage: CHILD, group: 'Play' }),
    ],
  }),
  def({
    id: 'telescope', name: 'Telescope', category: 'hobby', icon: '🔭', basePrice: 380, description: 'A reflector telescope on a tripod. Best on cold clear nights.',
    rooms: ['balcony', 'yard', 'office'], tags: ['hobby', 'science', 'night', 'outdoor'], durabilityUses: 10000, portable: true, repairCost: 60,
    interactions: [
      act({ id: 'stargaze', label: 'Stargaze', category: 'hobby', icon: '🌌', durationMinutes: 60, effects: { needs: { fun: 16, comfort: -4 }, skills: { research: 12, logic: 6 }, stress: -12, moodlets: [mood('inspired', 'Stars', 5, 240)] }, requirements: [timeReq(20 * 60, 5 * 60, 'Only at night')], satisfies: ['fun'], autonomyWeight: 0.3, group: 'Hobby' }),
      act({ id: 'moon', label: 'Look at the moon', category: 'hobby', icon: '🌕', durationMinutes: 15, effects: { needs: { fun: 8 }, skills: { research: 3 }, stress: -4 }, requirements: [timeReq(19 * 60, 6 * 60, 'Only at night')], autonomyWeight: 0.2, group: 'Hobby' }),
      act({ id: 'show_kids', label: 'Show the kids the planets', category: 'family', icon: '🪐', durationMinutes: 40, effects: { needs: { fun: 12, social: 14 }, skills: { parenting: 6, research: 4 }, custom: [cx('family:play_with_child', {})], moodlets: [mood('grateful', 'Shared wonder', 4, 240)] }, requirements: [timeReq(19 * 60, 6 * 60, 'Only at night')], minStage: TEEN, autonomyWeight: 0.1, llm: 'narrate', group: 'Family' }),
      act({ id: 'birdwatch', label: 'Birdwatch in daylight', category: 'hobby', icon: '🐦', durationMinutes: 40, effects: { needs: { fun: 10 }, skills: { research: 6 }, stress: -8 }, requirements: [timeReq(6 * 60, 19 * 60, 'Daylight only')], autonomyWeight: 0.15, group: 'Hobby' }),
    ],
  }),
  def({
    id: 'bar_cart', name: 'Bar cart', category: 'furniture', icon: '🍸', basePrice: 200, description: 'A gold bar cart with a shaker, bitters and half a bottle of everything.',
    rooms: ['living', 'dining'], tags: ['alcohol', 'decor', 'social', 'adult'], durabilityUses: 10000, ambient: { environment: 1, fun: 1 },
    interactions: [
      act({ id: 'mix_cocktail', label: 'Mix a cocktail', category: 'needs', icon: '🍸', durationMinutes: 8, consumes: [{ itemId: 'liquor', qty: 1 }], effects: { needs: { fun: 10, thirst: 6, bladder: -4 }, bloodAlcohol: 0.03, skills: { mixology: 10 }, stress: -5, moodlets: [mood('relaxed', 'Nightcap', 3, 90)] }, minStage: YA, autonomyWeight: 0.3, dirtiesBy: 3, group: 'Drinks' }),
      act({ id: 'pour_wine', label: 'Pour a glass of wine', category: 'needs', icon: '🍷', durationMinutes: 3, consumes: [{ itemId: 'wine', qty: 1 }], effects: { needs: { fun: 8, thirst: 4, bladder: -4 }, bloodAlcohol: 0.025, stress: -4 }, minStage: YA, autonomyWeight: 0.3, group: 'Drinks' }),
      act({ id: 'practice_mixology', label: 'Practice mixology', category: 'hobby', icon: '🍹', durationMinutes: 45, consumes: [{ itemId: 'liquor', qty: 1 }, { itemId: 'fruit', qty: 1 }], effects: { skills: { mixology: 30 }, needs: { fun: 12 }, bloodAlcohol: 0.02 }, minStage: YA, autonomyWeight: 0.1, dirtiesBy: 6, group: 'Drinks' }),
      act({ id: 'make_drinks_for_guests', label: 'Make drinks for guests', category: 'social', icon: '🥂', durationMinutes: 30, consumes: [{ itemId: 'liquor', qty: 1 }], effects: { needs: { social: 18, fun: 12 }, skills: { mixology: 12, charisma: 6 }, bloodAlcohol: 0.02 }, minStage: YA, satisfies: ['social'], autonomyWeight: 0.15, llm: 'narrate', dirtiesBy: 6, group: 'Drinks' }),
      act({ id: 'restock', label: 'Restock the cart', category: 'chores', icon: '🧾', durationMinutes: 5, effects: { skills: { finance: 1 } }, autonomyWeight: 0.05, group: 'Chores' }),
    ],
  }),
  def({
    id: 'wine_rack', name: 'Wine rack', category: 'furniture', icon: '🍷', basePrice: 110, description: 'A wine rack. Half the bottles are gifts you\'re saving.',
    rooms: ['kitchen', 'dining'], tags: ['alcohol', 'storage', 'adult'], durabilityUses: 20000, ambient: { environment: 1 },
    interactions: [
      act({ id: 'open_bottle', label: 'Open a bottle of wine', category: 'needs', icon: '🍷', durationMinutes: 5, consumes: [{ itemId: 'wine', qty: 1 }], effects: { needs: { fun: 8, thirst: 4 }, bloodAlcohol: 0.025, stress: -4, moodlets: [mood('relaxed', 'Glass of wine', 3, 90)] }, minStage: YA, autonomyWeight: 0.3, group: 'Drinks' }),
      act({ id: 'wine_tasting', label: 'Do a tasting', category: 'social', icon: '🍇', durationMinutes: 60, consumes: [{ itemId: 'wine', qty: 2 }], effects: { needs: { fun: 16, social: 14 }, bloodAlcohol: 0.04, skills: { mixology: 8, charisma: 4 }, moodlets: [mood('happy', 'Wine night', 4, 180)] }, minStage: YA, satisfies: ['social'], autonomyWeight: 0.1, llm: 'narrate', group: 'Drinks' }),
      act({ id: 'organize', label: 'Organize the bottles', category: 'chores', icon: '🗂️', durationMinutes: 8, effects: { needs: { fun: 2 } }, autonomyWeight: 0.05, group: 'Chores' }),
    ],
  }),
  def({
    id: 'humidor', name: 'Humidor', category: 'furniture', icon: '🚬', basePrice: 150, description: 'A cedar humidor. Cigars for celebrations, or Tuesdays.',
    rooms: ['office', 'living'], tags: ['tobacco', 'luxury', 'adult'], durabilityUses: 50000, portable: true,
    interactions: [
      act({ id: 'smoke_cigar', label: 'Smoke a cigar', category: 'needs', icon: '🚬', durationMinutes: 40, cost: 12, effects: { needs: { fun: 12, hygiene: -8, comfort: 6 }, stress: -12, health: -0.4, custom: [cx('health:nicotine', { itemId: 'cigar', strength: 1.5 })], moodlets: [mood('relaxed', 'Cigar on the porch', 4, 120)] }, minStage: YA, autonomyWeight: 0.1, group: 'Vice' }),
      act({ id: 'celebrate', label: 'Celebrate with a cigar and friends', category: 'social', icon: '🥃', durationMinutes: 60, cost: 30, effects: { needs: { fun: 16, social: 18, hygiene: -8 }, stress: -10, health: -0.4, custom: [cx('health:nicotine', { itemId: 'cigar', strength: 1.5 })], moodlets: [mood('proud', 'Celebrated in style', 5, 240)] }, minStage: YA, satisfies: ['social'], autonomyWeight: 0.05, llm: 'narrate', group: 'Vice' }),
      act({ id: 'check_humidity', label: 'Check the humidity', category: 'chores', icon: '💧', durationMinutes: 3, effects: {}, autonomyWeight: 0.02, group: 'Chores' }),
    ],
  }),
  def({
    id: 'safe', name: 'Safe', category: 'furniture', icon: '🔐', basePrice: 350, description: 'A fireproof safe bolted to the closet floor. Passports, cash, the good jewelry.',
    rooms: ['closet', 'office', 'bedroom'], tags: ['security', 'storage', 'finance'], durabilityUses: 100000,
    interactions: [
      act({ id: 'stash_cash', label: 'Stash cash in the safe', category: 'finance', icon: '💵', durationMinutes: 3, effects: { custom: [cx('finance:safe', { action: 'deposit' })], stress: -2 }, autonomyWeight: 0.05, group: 'Finance' }),
      act({ id: 'take_cash', label: 'Take cash from the safe', category: 'finance', icon: '💸', durationMinutes: 3, effects: { custom: [cx('finance:safe', { action: 'withdraw' })] }, autonomyWeight: 0.05, group: 'Finance' }),
      act({ id: 'check_documents', label: 'Check important documents', category: 'legal', icon: '📄', durationMinutes: 10, effects: { stress: -3, skills: { finance: 2 }, moodlets: [mood('relaxed', 'Papers in order', 2, 240)] }, autonomyWeight: 0.05, group: 'Finance' }),
    ],
  }),
  def({
    id: 'filing_cabinet', name: 'Filing cabinet', category: 'office', icon: '🗄️', basePrice: 140, description: 'A two-drawer cabinet of tax returns, leases and warranties.',
    rooms: ['office'], tags: ['office', 'storage', 'finance', 'admin'], durabilityUses: 50000,
    interactions: [
      act({ id: 'file_papers', label: 'File paperwork', category: 'finance', icon: '📁', durationMinutes: 20, effects: { needs: { fun: -4 }, stress: -4, skills: { finance: 4 }, moodlets: [mood('focused', 'Organized', 2, 240)] }, autonomyWeight: 0.1, group: 'Admin' }),
      act({ id: 'prep_taxes', label: 'Gather tax documents', category: 'finance', icon: '🧾', durationMinutes: 60, effects: { needs: { fun: -8 }, stress: 6, skills: { finance: 12 }, custom: [cx('finance:file_taxes', { assisted: false, stage: 'prep' })], flags: { tax_docs_ready: true } }, minStage: YA, autonomyWeight: 0.05, group: 'Admin' }),
      act({ id: 'find_document', label: 'Dig out a document', category: 'legal', icon: '🔍', durationMinutes: 10, effects: { stress: 2 }, outcomes: { outcomes: [{ weight: 7, label: 'Found it', effects: { stress: -4 } }, { weight: 2, label: 'Where is it?!', effects: { stress: 6, moodlets: [mood('anxious', 'Lost paperwork', -3, 120)] } }] }, autonomyWeight: 0.05, group: 'Admin' }),
    ],
  }),
  def({
    id: 'printer', name: 'Printer', category: 'electronics', icon: '🖨️', basePrice: 130, description: 'An inkjet printer. Out of cyan, refuses to print black.', requiresUtility: 'electric', runningCostMonthly: 6,
    rooms: ['office'], tags: ['office', 'electronics', 'admin'], durabilityUses: 2000, portable: true, repairCost: 50,
    interactions: [
      act({ id: 'print', label: 'Print documents', category: 'work', icon: '🖨️', durationMinutes: 5, effects: { custom: [cx('career:print', { pages: 5 })] }, outcomes: { outcomes: [{ weight: 6, label: 'Printed', effects: {} }, { weight: 2, label: 'Paper jam', effects: { stress: 5, moodlets: [mood('angry', 'Paper jam', -3, 60)] } }, { weight: 1, label: 'Out of ink', effects: { stress: 4 } }] }, requiresState: { notBroken: true }, wearBy: 1, autonomyWeight: 0.1, group: 'Admin' }),
      act({ id: 'scan', label: 'Scan a document', category: 'work', icon: '📠', durationMinutes: 4, effects: { needs: { fun: -1 } }, requiresState: { notBroken: true }, autonomyWeight: 0.05, group: 'Admin' }),
      act({ id: 'print_photos', label: 'Print photos', category: 'hobby', icon: '🖼️', durationMinutes: 10, effects: { needs: { fun: 6 }, skills: { photography: 3 }, moodlets: [mood('nostalgic', 'Printed memories', 3, 120)] }, requiresState: { notBroken: true }, wearBy: 2, autonomyWeight: 0.05, group: 'Hobby' }),
      act({ id: 'replace_ink', label: 'Replace the ink', category: 'chores', icon: '🎨', durationMinutes: 5, cost: 38, effects: { stress: 2, custom: [cx('property:repair', { skill: 'handiness' })] }, autonomyWeight: 0.05, group: 'Chores' }),
    ],
  }),
);

// =====================================================================================
// COMMERCIAL — retail & grocery
// =====================================================================================
const browse = (id: string, label: string, section: string, minutes = 15, fun = 6, extra: Partial<IOpts> = {}): InteractionDef =>
  act({ id, label, category: 'shop', icon: '🛍️', durationMinutes: minutes, effects: { needs: { fun }, custom: [cx('shop:browse', { section })] }, autonomyWeight: 0.3, group: 'Shop', ...extra });
const askStaff = (what = 'Ask staff a question'): InteractionDef =>
  act({ id: 'ask_staff', label: what, category: 'social', icon: '🙋', durationMinutes: 5, effects: { needs: { social: 4 } }, autonomyWeight: 0.1, llm: 'narrate', group: 'Shop' });

add(
  def({
    id: 'cash_register', name: 'Cash register', category: 'commercial', icon: '🧾', basePrice: 1200, description: 'A point-of-sale register with a card reader that asks for a tip.',
    rooms: ['front'], tags: ['retail', 'checkout', 'staff'], durabilityUses: 100000, repairCost: 200,
    interactions: [
      act({ id: 'checkout', label: 'Check out', category: 'shop', icon: '💳', durationMinutes: 6, effects: { needs: { social: 2 }, custom: [cx('shop:checkout', {})] }, autonomyWeight: 0.5, group: 'Shop' }),
      askStaff(),
      act({ id: 'return_item', label: 'Return an item', category: 'shop', icon: '↩️', durationMinutes: 12, effects: { needs: { fun: -3 }, stress: 3, custom: [cx('shop:return_item', {})] }, autonomyWeight: 0.05, llm: 'narrate', group: 'Shop' }),
      act({ id: 'buy_lottery', label: 'Buy a scratch-off', category: 'shop', icon: '🎟️', durationMinutes: 2, cost: 2, effects: { items: [{ op: 'gain', itemId: 'lottery_ticket', qty: 1 }] }, minStage: YA, autonomyWeight: 0.05, group: 'Shop' }),
      act({ id: 'buy_cigarettes', label: 'Buy cigarettes', category: 'shop', icon: '🚬', durationMinutes: 2, cost: 9.5, effects: { items: [{ op: 'gain', itemId: 'cigarettes', qty: 1 }] }, minStage: YA, requirements: [{ kind: 'age', reason: 'Must be 21+', params: { minAge: 21 } }], autonomyWeight: 0.05, group: 'Shop' }),
      workTask('work_register', 'Work the register', 'register', 240, { icon: '🧾', skills: { charisma: 6, finance: 3 } }),
    ],
  }),
  def({
    id: 'self_checkout', name: 'Self-checkout', category: 'commercial', icon: '🤖', basePrice: 9000, description: 'Unexpected item in the bagging area.',
    rooms: ['front'], tags: ['retail', 'checkout', 'automation'], durabilityUses: 100000, repairCost: 400,
    interactions: [
      act({ id: 'checkout', label: 'Self-checkout', category: 'shop', icon: '💳', durationMinutes: 5, effects: { custom: [cx('shop:checkout', {})] }, outcomes: { outcomes: [{ weight: 7, label: 'Smooth', effects: {} }, { weight: 3, label: 'Please wait for assistance', effects: { stress: 4, needs: { fun: -3 } } }] }, autonomyWeight: 0.5, group: 'Shop' }),
      act({ id: 'skip_scan', label: 'Skip scanning an item', description: 'The bagging area doesn\'t notice everything.', category: 'shop', icon: '🫣', durationMinutes: 5, effects: { stress: 6, custom: [cx('shop:checkout', { theft: true })], legal: [{ kind: 'heat', delta: 2 }] }, outcomes: { outcomes: [{ weight: 8, label: 'Nobody noticed', effects: { money: { amount: 12, memo: 'Unscanned item' }, moodlets: [mood('guilty', 'Skipped the scan', -2, 120)] } }, { weight: 2, label: 'Loss prevention stops you', effects: { legal: [{ kind: 'charge', crimeId: 'shoplifting' }], stress: 20 } }] }, minStage: TEEN, autonomyWeight: 0, group: 'Shop' }),
    ],
  }),
  def({
    id: 'shopping_cart', name: 'Shopping cart', category: 'commercial', icon: '🛒', basePrice: 180, description: 'A cart with one wheel that wobbles.',
    rooms: ['front'], tags: ['retail', 'grocery'], durabilityUses: 20000, portable: true,
    interactions: [
      act({ id: 'grab_cart', label: 'Grab a cart', category: 'shop', icon: '🛒', durationMinutes: 1, effects: { flags: { has_cart: true } }, autonomyWeight: 0.3, group: 'Shop' }),
      act({ id: 'return_cart', label: 'Return the cart', category: 'shop', icon: '↩️', durationMinutes: 2, effects: { flags: { has_cart: false }, moodlets: [mood('proud', 'Cart returned', 1, 60)] }, autonomyWeight: 0.2, group: 'Shop' }),
      act({ id: 'cart_ride', label: 'Ride the cart across the lot', category: 'entertainment', icon: '🛞', durationMinutes: 2, effects: { needs: { fun: 6 } }, outcomes: { outcomes: [{ weight: 8, label: 'Wheee', effects: { moodlets: [mood('playful', 'Cart surfing', 2, 60)] } }, { weight: 1, label: 'Wiped out', effects: { health: -1, needs: { comfort: -8 }, moodlets: [mood('embarrassed', 'Cart wipeout', -3, 90)] } }] }, autonomyWeight: 0.02, minStage: CHILD, group: 'Fun' }),
    ],
  }),
  def({
    id: 'grocery_shelf', name: 'Grocery shelf', category: 'commercial', icon: '🥫', basePrice: 600, description: 'Aisles of packaged food, cleaning supplies and end-cap deals.',
    rooms: ['aisles'], tags: ['retail', 'grocery', 'food'], durabilityUses: 100000,
    interactions: [
      browse('shop_groceries', 'Shop for groceries', 'grocery', 30, 4, { autonomyWeight: 1, satisfies: ['hunger'] }),
      browse('shop_household', 'Shop household supplies', 'household', 15, 2),
      browse('shop_snacks', 'Grab snacks', 'snacks', 8, 5),
      act({ id: 'compare_prices', label: 'Compare unit prices', category: 'shop', icon: '🔍', durationMinutes: 8, effects: { skills: { finance: 4 }, needs: { fun: -1 } }, autonomyWeight: 0.1, group: 'Shop' }),
      act({ id: 'free_sample', label: 'Take a free sample', category: 'needs', icon: '🧀', durationMinutes: 2, effects: { needs: { hunger: 4, fun: 2 } }, autonomyWeight: 0.2, group: 'Shop' }),
      workTask('stock_shelves', 'Stock shelves', 'retail', 240, { icon: '📦', skills: { fitness: 4 }, energy: -22, hygiene: -10 }),
    ],
  }),
  def({
    id: 'produce_display', name: 'Produce display', category: 'commercial', icon: '🥦', basePrice: 900, description: 'Misted greens, stacked apples, and avocados at every stage of ripeness but the right one.',
    rooms: ['produce'], tags: ['retail', 'grocery', 'produce', 'fresh'], durabilityUses: 100000, ambient: { environment: 1 },
    interactions: [
      browse('shop_produce', 'Pick out produce', 'produce', 12, 4, { autonomyWeight: 0.6 }),
      act({ id: 'thump_melon', label: 'Thump a melon', category: 'shop', icon: '🍉', durationMinutes: 1, effects: { needs: { fun: 2 }, skills: { cooking: 1 } }, autonomyWeight: 0.05, group: 'Shop' }),
      act({ id: 'buy_fruit', label: 'Buy a piece of fruit', category: 'shop', icon: '🍎', durationMinutes: 2, cost: 1.2, effects: { items: [{ op: 'gain', itemId: 'fruit', qty: 1 }] }, autonomyWeight: 0.3, group: 'Shop' }),
      workTask('restock_produce', 'Restock produce', 'retail', 180, { icon: '🥬', hygiene: -8 }),
    ],
  }),
  def({
    id: 'deli_counter', name: 'Deli counter', category: 'commercial', icon: '🥪', basePrice: 4000, description: 'Take a number. Sliced meats, cheeses and a hot case of rotisserie chicken.',
    rooms: ['deli'], tags: ['retail', 'grocery', 'food', 'counter'], durabilityUses: 100000, repairCost: 300,
    interactions: [
      order('order_sandwich', 'Order a deli sandwich', 9.5, 10, { items: [{ op: 'gain', itemId: 'sandwich', qty: 1 }], custom: [cx('shop:order', { what: 'deli' })] }),
      order('buy_rotisserie', 'Buy a rotisserie chicken', 8.99, 5, { items: [{ op: 'gain', itemId: 'chicken', qty: 2 }], custom: [cx('shop:order', { what: 'deli' })] }),
      order('buy_cold_cuts', 'Buy sliced meat & cheese', 12, 8, { items: [{ op: 'gain', itemId: 'cheese', qty: 1 }, { op: 'gain', itemId: 'chicken', qty: 1 }], custom: [cx('shop:order', { what: 'deli' })] }),
      act({ id: 'take_number', label: 'Take a number and wait', category: 'shop', icon: '🎫', durationMinutes: 8, effects: { needs: { fun: -3 }, stress: 2 }, autonomyWeight: 0.1, group: 'Shop' }),
      workTask('work_deli', 'Work the deli slicer', 'kitchen', 240, { icon: '🔪', skills: { cooking: 6 }, hygiene: -12 }),
    ],
  }),
  def({
    id: 'bakery_case', name: 'Bakery case', category: 'commercial', icon: '🥐', basePrice: 3500, description: 'A glass case of croissants, cakes and day-old bagels at half price.',
    rooms: ['bakery'], tags: ['retail', 'bakery', 'food', 'counter'], durabilityUses: 100000, repairCost: 250, ambient: { environment: 1 },
    interactions: [
      order('buy_pastry', 'Buy a pastry', 4.25, 4, { needs: { hunger: 18, fun: 6 }, weight: 0.03, custom: [cx('shop:order', { what: 'bakery' })] }, { satisfies: ['hunger'] }),
      order('buy_bread', 'Buy a fresh loaf', 6.5, 3, { items: [{ op: 'gain', itemId: 'bread', qty: 1 }], custom: [cx('shop:order', { what: 'bakery' })] }),
      order('buy_cake', 'Order a celebration cake', 38, 8, { items: [{ op: 'gain', itemId: 'cake', qty: 8 }], custom: [cx('shop:order', { what: 'bakery' })] }, { minStage: TEEN }),
      order('buy_dozen_cookies', 'Buy a dozen cookies', 14, 3, { items: [{ op: 'gain', itemId: 'cookies', qty: 12 }], custom: [cx('shop:order', { what: 'bakery' })] }),
      act({ id: 'smell', label: 'Breathe in the bakery smell', category: 'needs', icon: '👃', durationMinutes: 1, effects: { needs: { fun: 3, hunger: -2 }, moodlets: [mood('happy', 'Fresh bread smell', 2, 60)] }, autonomyWeight: 0.1, group: 'Relax' }),
      workTask('work_bakery', 'Work the bakery', 'kitchen', 300, { icon: '🥖', skills: { baking: 10 }, hygiene: -10 }),
    ],
  }),
  def({
    id: 'pharmacy_counter', name: 'Pharmacy counter', category: 'commercial', icon: '💊', basePrice: 15000, description: 'Drop-off and pickup windows. "It\'ll be about twenty minutes."',
    rooms: ['pharmacy'], tags: ['pharmacy', 'health', 'counter'], durabilityUses: 100000, repairCost: 400,
    interactions: [
      act({ id: 'pickup_rx', label: 'Pick up a prescription', category: 'health', icon: '💊', durationMinutes: 12, cost: 25, effects: { items: [{ op: 'gain', itemId: 'prescription_meds', qty: 1 }], custom: [cx('health:pharmacy', { action: 'pickup' })], stress: -2 }, autonomyWeight: 0.4, group: 'Pharmacy' }),
      act({ id: 'consult_pharmacist', label: 'Ask the pharmacist', category: 'health', icon: '🧑‍⚕️', durationMinutes: 8, effects: { needs: { social: 3 }, custom: [cx('health:pharmacy', { action: 'consult' })], skills: { medicine: 3 } }, autonomyWeight: 0.1, llm: 'narrate', group: 'Pharmacy' }),
      act({ id: 'flu_shot', label: 'Get a flu shot', category: 'health', icon: '💉', durationMinutes: 15, cost: 0, effects: { health: 1, needs: { comfort: -4 }, custom: [cx('health:vaccine', { kind: 'flu' })], moodlets: [mood('relaxed', 'Vaccinated', 2, 300)] }, autonomyWeight: 0.1, group: 'Pharmacy' }),
      browse('otc', 'Browse over-the-counter meds', 'pharmacy', 10, 1),
      act({ id: 'blood_pressure', label: 'Use the blood pressure machine', category: 'health', icon: '🩺', durationMinutes: 3, effects: { custom: [cx('health:checkup', { kind: 'bp_kiosk' })], needs: { fun: 1 } }, autonomyWeight: 0.05, group: 'Pharmacy' }),
      workTask('work_pharmacy', 'Fill prescriptions', 'pharmacy', 240, { icon: '💊', skills: { medicine: 8, logic: 4 } }),
    ],
  }),
  def({
    id: 'atm_machine', name: 'ATM', category: 'commercial', icon: '🏧', basePrice: 3500, description: 'A cash machine. $3.50 fee if it isn\'t your bank.',
    rooms: ['lobby', 'exterior'], tags: ['bank', 'finance', 'cash'], durabilityUses: 200000, repairCost: 500,
    interactions: [
      act({ id: 'withdraw_40', label: 'Withdraw $40', category: 'finance', icon: '💵', durationMinutes: 3, effects: { custom: [cx('finance:withdraw', { amount: 40 })] }, minStage: TEEN, autonomyWeight: 0.2, group: 'ATM' }),
      act({ id: 'withdraw_100', label: 'Withdraw $100', category: 'finance', icon: '💵', durationMinutes: 3, effects: { custom: [cx('finance:withdraw', { amount: 100 })] }, minStage: TEEN, autonomyWeight: 0.15, group: 'ATM' }),
      act({ id: 'withdraw_300', label: 'Withdraw $300', category: 'finance', icon: '💵', durationMinutes: 3, effects: { custom: [cx('finance:withdraw', { amount: 300 })] }, minStage: TEEN, autonomyWeight: 0.05, group: 'ATM' }),
      act({ id: 'deposit', label: 'Deposit cash', category: 'finance', icon: '🏦', durationMinutes: 4, effects: { custom: [cx('finance:deposit', {})], stress: -2 }, minStage: TEEN, autonomyWeight: 0.1, group: 'ATM' }),
      act({ id: 'check_balance', label: 'Check your balance', category: 'finance', icon: '🧾', durationMinutes: 2, effects: { custom: [cx('finance:check_balance', {})] }, outcomes: { outcomes: [{ weight: 1, label: 'Looked', effects: {} }] }, minStage: TEEN, autonomyWeight: 0.1, group: 'ATM' }),
    ],
  }),
  def({
    id: 'bank_teller_window', name: 'Teller window', category: 'commercial', icon: '🏦', basePrice: 8000, description: 'A teller behind glass. Lollipops for kids, pens on chains.',
    rooms: ['lobby'], tags: ['bank', 'finance', 'counter'], durabilityUses: 200000,
    interactions: [
      act({ id: 'deposit_check', label: 'Deposit or cash a check', category: 'finance', icon: '🧾', durationMinutes: 10, effects: { custom: [cx('finance:cash_check', {})], needs: { social: 2 } }, minStage: TEEN, autonomyWeight: 0.2, group: 'Bank' }),
      act({ id: 'withdraw_large', label: 'Withdraw cash', category: 'finance', icon: '💵', durationMinutes: 8, effects: { custom: [cx('finance:withdraw', { amount: 500, teller: true })] }, minStage: TEEN, autonomyWeight: 0.1, group: 'Bank' }),
      act({ id: 'open_checking', label: 'Open a checking account', category: 'finance', icon: '🆕', durationMinutes: 30, effects: { custom: [cx('finance:open_account', { kind: 'checking' })], skills: { finance: 6 }, stress: -2 }, minStage: TEEN, autonomyWeight: 0.05, group: 'Bank' }),
      act({ id: 'open_savings', label: 'Open a savings account', category: 'finance', icon: '🐖', durationMinutes: 25, effects: { custom: [cx('finance:open_account', { kind: 'savings' })], skills: { finance: 6 }, moodlets: [mood('hopeful', 'Started saving', 3, 480)] }, minStage: TEEN, autonomyWeight: 0.05, group: 'Bank' }),
      act({ id: 'dispute', label: 'Dispute a charge', category: 'finance', icon: '⚠️', durationMinutes: 20, effects: { stress: 4, custom: [cx('finance:consult', { pro: 'teller', topic: 'dispute' })] }, minStage: TEEN, autonomyWeight: 0.02, llm: 'narrate', group: 'Bank' }),
      act({ id: 'pay_bills_teller', label: 'Pay a bill in person', category: 'finance', icon: '💳', durationMinutes: 10, effects: { custom: [cx('finance:pay_bills', { via: 'teller' })], stress: -3 }, minStage: TEEN, autonomyWeight: 0.1, group: 'Bank' }),
      workTask('work_teller', 'Work the teller window', 'desk', 240, { icon: '🏦', skills: { finance: 8, charisma: 4 } }),
    ],
  }),
  def({
    id: 'loan_desk', name: 'Loan officer\'s desk', category: 'commercial', icon: '📋', basePrice: 2500, description: 'A desk with a nameplate and a bowl of mints. Credit score discussed here.',
    rooms: ['office'], tags: ['bank', 'finance', 'loans', 'desk'], durabilityUses: 200000,
    interactions: [
      act({ id: 'apply_personal', label: 'Apply for a personal loan', category: 'finance', icon: '📝', durationMinutes: 40, effects: { stress: 6, skills: { finance: 8 }, custom: [cx('finance:apply_loan', { kind: 'personal' })] }, minStage: YA, autonomyWeight: 0.05, llm: 'narrate', group: 'Loans' }),
      act({ id: 'apply_auto', label: 'Apply for an auto loan', category: 'finance', icon: '🚗', durationMinutes: 40, effects: { stress: 5, skills: { finance: 8 }, custom: [cx('finance:apply_loan', { kind: 'auto' })] }, minStage: YA, autonomyWeight: 0.05, group: 'Loans' }),
      act({ id: 'apply_mortgage', label: 'Get pre-approved for a mortgage', category: 'finance', icon: '🏠', durationMinutes: 60, effects: { stress: 8, skills: { finance: 12 }, custom: [cx('finance:apply_loan', { kind: 'mortgage' })] }, minStage: YA, autonomyWeight: 0.02, group: 'Loans' }),
      act({ id: 'apply_card', label: 'Apply for a credit card', category: 'finance', icon: '💳', durationMinutes: 20, effects: { stress: 3, custom: [cx('finance:apply_card', {})] }, minStage: YA, autonomyWeight: 0.05, group: 'Loans' }),
      act({ id: 'refinance', label: 'Discuss refinancing', category: 'finance', icon: '🔄', durationMinutes: 30, effects: { skills: { finance: 10, negotiation: 6 }, custom: [cx('finance:consult', { pro: 'loan_officer', topic: 'refinance' })] }, minStage: YA, autonomyWeight: 0.02, llm: 'narrate', group: 'Loans' }),
      workTask('work_loans', 'Process loan applications', 'desk', 480, { icon: '📋', skills: { finance: 10, negotiation: 4 } }),
    ],
  }),
);

// =====================================================================================
// COMMERCIAL — cafe, restaurant, bar & nightlife
// =====================================================================================
add(
  def({
    id: 'cafe_counter', name: 'Cafe counter', category: 'commercial', icon: '☕', basePrice: 6000, description: 'Order here. The menu board has more oat-milk options than the grocery store.',
    rooms: ['front'], tags: ['cafe', 'coffee', 'counter', 'food'], durabilityUses: 200000, repairCost: 300, ambient: { environment: 1 },
    interactions: [
      order('order_coffee', 'Order a coffee', 4.25, 5, { needs: { energy: 15, thirst: 8, bladder: -8, comfort: 3 }, caffeine: 95, custom: [cx('shop:order', { what: 'coffee' })], moodlets: [mood('energized', 'Caffeinated', 4, 150)] }, { satisfies: ['energy'], autonomyWeight: 1.2, minStage: TEEN }),
      order('order_latte', 'Order a latte', 6.25, 6, { needs: { energy: 14, thirst: 10, hunger: 5, comfort: 5 }, caffeine: 80, custom: [cx('shop:order', { what: 'coffee' })], moodlets: [mood('happy', 'Latte', 4, 120)] }, { satisfies: ['energy'], minStage: TEEN }),
      order('order_tea', 'Order a tea', 3.5, 4, { needs: { energy: 6, thirst: 14, comfort: 5 }, caffeine: 40, stress: -3, custom: [cx('shop:order', { what: 'coffee' })] }, { satisfies: ['thirst'] }),
      order('order_pastry', 'Order a pastry', 4.5, 4, { needs: { hunger: 20, fun: 5 }, weight: 0.03, custom: [cx('shop:order', { what: 'pastry' })] }, { satisfies: ['hunger'] }),
      order('order_breakfast_sandwich', 'Order a breakfast sandwich', 8.5, 8, { needs: { hunger: 42, fun: 4 }, custom: [cx('shop:order', { what: 'food' })] }, { satisfies: ['hunger'], autonomyWeight: 1 }),
      order('order_hot_chocolate', 'Order a hot chocolate', 4.75, 4, { needs: { thirst: 12, fun: 8, comfort: 6 }, weight: 0.03, custom: [cx('shop:order', { what: 'coffee' })], moodlets: [mood('happy', 'Hot cocoa', 3, 90)] }, { satisfies: ['fun'] }),
      act({ id: 'tip_jar', label: 'Drop a dollar in the tip jar', category: 'social', icon: '🫙', durationMinutes: 1, cost: 1, effects: { needs: { social: 2 }, moodlets: [mood('grateful', 'Tipped', 1, 60)] }, autonomyWeight: 0.1, group: 'Order' }),
      workTask('work_counter', 'Work the counter', 'register', 240, { icon: '☕', skills: { charisma: 6 }, hygiene: -8 }),
    ],
  }),
  def({
    id: 'cafe_table', name: 'Cafe table', category: 'commercial', icon: '🪑', basePrice: 350, description: 'A small two-top by the window with an outlet under it. Prime real estate.',
    rooms: ['seating'], tags: ['cafe', 'seating', 'work', 'social'], durabilityUses: 30000, ambient: { comfort: 1 },
    interactions: [
      sit('Sit with your drink', 0.15, 0.1, 30),
      act({ id: 'work_laptop', label: 'Work on your laptop', category: 'work', icon: '💻', durationMinutes: 120, effects: { perMinute: { fun: -0.03, comfort: 0.05 }, needs: { energy: -8 }, stress: 3, custom: [cx('career:work_remote', { minutes: 120 })] }, requirements: [flagReq('remote_eligible', 'Your job is not remote')], minStage: YA, autonomyWeight: 0.3, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Work' }),
      act({ id: 'study', label: 'Study at the cafe', category: 'school', icon: '📚', durationMinutes: 90, effects: { perMinute: { comfort: 0.05 }, skills: { research: 12, logic: 8 }, needs: { fun: -4 }, custom: [cx('education:study', { minutes: 90 })] }, minStage: TEEN, autonomyWeight: 0.3, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Study' }),
      read(0.1, 45),
      act({ id: 'coffee_date', label: 'Have a coffee date', category: 'romance', icon: '💕', durationMinutes: 60, effects: { needs: { social: 24, fun: 14 }, skills: { charisma: 6 }, moodlets: [mood('flirty', 'Coffee date', 4, 180)] }, minStage: TEEN, satisfies: ['social'], autonomyWeight: 0.2, llm: 'narrate', requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Social' }),
      act({ id: 'catch_up', label: 'Catch up with a friend', category: 'social', icon: '💬', durationMinutes: 45, effects: { needs: { social: 22, fun: 10 }, stress: -6 }, satisfies: ['social'], autonomyWeight: 0.4, llm: 'narrate', requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Social' }),
      act({ id: 'write_cafe', label: 'Write at the cafe', category: 'hobby', icon: '✍️', durationMinutes: 60, effects: { skills: { writing: 26 }, needs: { fun: 8 }, moodlets: [mood('inspired', 'Cafe writing', 3, 120)] }, autonomyWeight: 0.2, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Hobby' }),
    ],
  }),
  def({
    id: 'barista_station', name: 'Barista station', category: 'commercial', icon: '🧋', basePrice: 14000, description: 'A commercial espresso machine, grinders, syrups and a wall of cups.', requiresUtility: 'electric', runningCostMonthly: 60,
    rooms: ['front'], tags: ['cafe', 'coffee', 'staff', 'equipment'], durabilityUses: 100000, repairCost: 900,
    interactions: [
      workTask('pull_shots', 'Pull shots on the bar', 'kitchen', 240, { icon: '☕', skills: { mixology: 10, charisma: 4 }, hygiene: -10, fun: 2 }),
      act({ id: 'practice_latte_art', label: 'Practice latte art', category: 'hobby', icon: '🎨', durationMinutes: 20, effects: { skills: { mixology: 12, creativity: 4 }, needs: { fun: 6 } }, autonomyWeight: 0.1, requiresState: { notBroken: true }, group: 'Work' }),
      act({ id: 'staff_coffee', label: 'Make yourself a staff coffee', category: 'needs', icon: '☕', durationMinutes: 4, effects: { needs: { energy: 14, thirst: 6 }, caffeine: 90 }, satisfies: ['energy'], autonomyWeight: 0.3, requiresState: { notBroken: true }, group: 'Work' }),
      act({ id: 'clean_station', label: 'Clean the station', category: 'work', icon: '🧽', durationMinutes: 20, effects: { needs: { fun: -3 }, custom: [cx('chore:clean', { amount: 30, target: 'object' }), cx('career:work_task', { minutes: 20, kind: 'kitchen' })] }, autonomyWeight: 0.2, group: 'Work' }),
    ],
  }),
  def({
    id: 'restaurant_table', name: 'Restaurant table', category: 'commercial', icon: '🍽️', basePrice: 600, description: 'A set table with a candle and a QR-code menu.',
    rooms: ['dining'], tags: ['restaurant', 'seating', 'food', 'social', 'date'], durabilityUses: 50000, ambient: { comfort: 2, environment: 1 },
    interactions: [
      order('order_meal', 'Order a meal', 24, 50, { needs: { hunger: 65, fun: 8, comfort: 6, social: 4 }, custom: [cx('shop:order', { what: 'food' })], moodlets: [mood('happy', 'Ate out', 5, 180)] }, { satisfies: ['hunger'], autonomyWeight: 1.2, requiresState: { unoccupied: true }, setsState: { occupied: true }, dirtiesBy: 8 }),
      order('order_cheap', 'Order something cheap', 13, 40, { needs: { hunger: 50, fun: 4, comfort: 4 }, custom: [cx('shop:order', { what: 'food' })] }, { satisfies: ['hunger'], autonomyWeight: 1, requiresState: { unoccupied: true }, setsState: { occupied: true }, dirtiesBy: 6 }),
      order('order_tasting', 'Order the chef\'s tasting menu', 95, 120, { needs: { hunger: 80, fun: 20, comfort: 10, social: 6 }, custom: [cx('shop:order', { what: 'food' })], skills: { cooking: 6 }, moodlets: [mood('happy', 'Incredible meal', 10, 480)] }, { satisfies: ['hunger', 'fun'], autonomyWeight: 0.1, requiresState: { unoccupied: true }, setsState: { occupied: true }, minStage: YA, dirtiesBy: 10 }),
      order('order_dessert', 'Order dessert', 11, 20, { needs: { hunger: 18, fun: 12 }, weight: 0.04, custom: [cx('shop:order', { what: 'food' })], moodlets: [mood('happy', 'Dessert', 4, 120)] }, { satisfies: ['fun'] }),
      order('order_wine', 'Order a glass of wine', 13, 15, { needs: { fun: 8, thirst: 4 }, bloodAlcohol: 0.025, stress: -4, custom: [cx('shop:order', { what: 'drink' })] }, { minStage: YA, requirements: [{ kind: 'age', reason: 'Must be 21+', params: { minAge: 21 } }] }),
      act({ id: 'dinner_date', label: 'Have a dinner date', category: 'romance', icon: '💕', durationMinutes: 90, cost: 70, effects: { needs: { hunger: 65, social: 30, fun: 20, comfort: 8 }, bloodAlcohol: 0.02, skills: { charisma: 8 }, custom: [cx('shop:order', { what: 'food' })], moodlets: [mood('in_love', 'Dinner date', 6, 300)] }, minStage: YA, satisfies: ['social', 'hunger'], autonomyWeight: 0.2, llm: 'narrate', requiresState: { unoccupied: true }, setsState: { occupied: true }, dirtiesBy: 10, group: 'Social' }),
      act({ id: 'group_dinner', label: 'Dinner with friends', category: 'social', icon: '🥂', durationMinutes: 100, cost: 42, effects: { needs: { hunger: 65, social: 32, fun: 22 }, bloodAlcohol: 0.02, custom: [cx('shop:order', { what: 'food' })], moodlets: [mood('happy', 'Dinner with friends', 6, 300)] }, minStage: TEEN, satisfies: ['social', 'hunger'], autonomyWeight: 0.3, llm: 'narrate', requiresState: { unoccupied: true }, setsState: { occupied: true }, dirtiesBy: 12, group: 'Social' }),
      act({ id: 'leave_tip', label: 'Leave a generous tip', category: 'social', icon: '💵', durationMinutes: 1, cost: 8, effects: { moodlets: [mood('grateful', 'Tipped well', 2, 120)] }, autonomyWeight: 0.1, group: 'Order' }),
    ],
  }),
  def({
    id: 'host_stand', name: 'Host stand', category: 'commercial', icon: '📋', basePrice: 900, description: 'A podium with a reservation tablet and a stack of crayon menus.',
    rooms: ['entry'], tags: ['restaurant', 'staff', 'counter'], durabilityUses: 100000,
    interactions: [
      act({ id: 'get_table', label: 'Ask for a table', category: 'needs', icon: '🙋', durationMinutes: 5, effects: { needs: { social: 2 } }, outcomes: { outcomes: [{ weight: 6, label: 'Seated right away', effects: {} }, { weight: 3, label: '20-minute wait', effects: { needs: { fun: -4 }, stress: 3 } }] }, autonomyWeight: 0.3, llm: 'narrate', group: 'Dining' }),
      act({ id: 'reserve', label: 'Make a reservation', category: 'needs', icon: '📅', durationMinutes: 3, effects: { flags: { has_reservation: true } }, autonomyWeight: 0.05, group: 'Dining' }),
      act({ id: 'order_takeout', label: 'Order takeout', category: 'shop', icon: '🥡', durationMinutes: 15, cost: 16.5, effects: { items: [{ op: 'gain', itemId: 'takeout_meal', qty: 1 }], custom: [cx('shop:order', { what: 'food', takeout: true })] }, autonomyWeight: 0.4, group: 'Dining' }),
      workTask('work_host', 'Host and seat guests', 'desk', 300, { icon: '📋', skills: { charisma: 8 }, energy: -20 }),
    ],
  }),
  def({
    id: 'kitchen_line', name: 'Kitchen line', category: 'commercial', icon: '👨‍🍳', basePrice: 45000, description: 'A commercial line: flat-top, fryers, ticket printer screaming.', requiresUtility: 'gas', runningCostMonthly: 900,
    rooms: ['kitchen'], tags: ['restaurant', 'kitchen', 'staff', 'equipment', 'cooking'], durabilityUses: 300000, repairCost: 1500, ambient: { noise: 5 },
    interactions: [
      workTask('work_line', 'Work the line', 'kitchen', 360, { icon: '🔥', skills: { cooking: 16 }, energy: -30, hygiene: -25, stress: 22, description: 'Tickets, heat, and the expo yelling "hands".' }),
      workTask('prep_shift', 'Do prep', 'kitchen', 180, { icon: '🔪', skills: { cooking: 10 }, hygiene: -12, stress: 6 }),
      workTask('dish_pit', 'Work the dish pit', 'kitchen', 300, { icon: '🫧', energy: -26, hygiene: -20, stress: 8, fun: -14 }),
      act({ id: 'staff_meal', label: 'Eat the staff meal', category: 'needs', icon: '🍛', durationMinutes: 15, effects: { needs: { hunger: 50, social: 6 } }, satisfies: ['hunger'], autonomyWeight: 0.8, group: 'Work' }),
      ...cookSet('kitchen_line').filter((i) => ['cook:steak_dinner', 'cook:burgers', 'cook:fried_chicken', 'cook:pan_seared_fish'].includes(i.id)).map((i) => ({ ...i, requirements: [...(i.requirements ?? []), flagReq('on_shift', 'Staff only')] })),
    ],
  }),
  def({
    id: 'bar_counter', name: 'Bar', category: 'commercial', icon: '🍺', basePrice: 18000, description: 'A long bar with taps, a mirror, and a bartender who has heard it all.',
    rooms: ['bar'], tags: ['bar', 'alcohol', 'social', 'nightlife', 'counter', 'adult'], durabilityUses: 300000, repairCost: 600, ambient: { fun: 2, noise: 3 },
    interactions: [
      order('order_beer', 'Order a beer', 7, 15, { needs: { fun: 10, thirst: 10, social: 8, bladder: -10 }, bloodAlcohol: 0.02, stress: -4, custom: [cx('shop:order', { what: 'beer' })] }, { minStage: YA, requirements: [{ kind: 'age', reason: 'Must be 21+', params: { minAge: 21 } }], satisfies: ['fun', 'social'], autonomyWeight: 0.9 }),
      order('order_cocktail', 'Order a cocktail', 14, 15, { needs: { fun: 14, thirst: 6, social: 8, bladder: -6 }, bloodAlcohol: 0.03, stress: -5, custom: [cx('shop:order', { what: 'cocktail' })], moodlets: [mood('playful', 'Cocktail hour', 4, 90)] }, { minStage: YA, requirements: [{ kind: 'age', reason: 'Must be 21+', params: { minAge: 21 } }], satisfies: ['fun'], autonomyWeight: 0.6 }),
      order('order_shot', 'Do a shot', 8, 3, { needs: { fun: 10, social: 6 }, bloodAlcohol: 0.035, custom: [cx('shop:order', { what: 'cocktail' })] }, { minStage: YA, requirements: [{ kind: 'age', reason: 'Must be 21+', params: { minAge: 21 } }], autonomyWeight: 0.3 }),
      order('order_round', 'Buy a round for the table', 34, 10, { needs: { fun: 12, social: 22 }, bloodAlcohol: 0.02, skills: { charisma: 6 }, custom: [cx('shop:order', { what: 'beer' })], moodlets: [mood('proud', 'Bought a round', 4, 120)] }, { minStage: YA, requirements: [{ kind: 'age', reason: 'Must be 21+', params: { minAge: 21 } }], satisfies: ['social'], autonomyWeight: 0.2, llm: 'narrate' }),
      order('order_bar_food', 'Order bar food', 15, 25, { needs: { hunger: 50, fun: 6 }, weight: 0.05, custom: [cx('shop:order', { what: 'food' })] }, { satisfies: ['hunger'], autonomyWeight: 0.8 }),
      order('order_soda', 'Order a soda or mocktail', 4, 5, { needs: { thirst: 22, fun: 4, bladder: -8 }, custom: [cx('shop:order', { what: 'drink' })] }, { satisfies: ['thirst'], autonomyWeight: 0.5 }),
      act({ id: 'chat_bartender', label: 'Chat with the bartender', category: 'social', icon: '💬', durationMinutes: 15, effects: { needs: { social: 12, fun: 6 }, skills: { charisma: 4 }, stress: -4 }, minStage: YA, satisfies: ['social'], autonomyWeight: 0.4, llm: 'narrate', group: 'Social' }),
      workTask('tend_bar', 'Tend bar', 'register', 360, { icon: '🍸', skills: { mixology: 16, charisma: 8 }, energy: -28, hygiene: -12, stress: 10, fun: 4 }),
    ],
  }),
  def({
    id: 'bar_stool', name: 'Bar stool', category: 'commercial', icon: '🪑', basePrice: 120, description: 'A stool at the bar. Regulars have unofficial assigned seats.',
    rooms: ['bar'], tags: ['bar', 'seating', 'social'], durabilityUses: 30000,
    interactions: [
      sit('Sit at the bar', 0.1, 0.1, 30),
      act({ id: 'strike_conversation', label: 'Strike up a conversation', category: 'social', icon: '💬', durationMinutes: 20, effects: { needs: { social: 16, fun: 8 }, skills: { charisma: 6 } }, minStage: YA, satisfies: ['social'], autonomyWeight: 0.4, llm: 'adjudicate', requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Social' }),
      act({ id: 'watch_game', label: 'Watch the game at the bar', category: 'entertainment', icon: '📺', durationMinutes: 120, effects: { perMinute: { fun: 0.3 }, needs: { social: 10 }, custom: [cx('entertainment:watch', { channel: 'sports', minutes: 120 })] }, satisfies: ['fun'], autonomyWeight: 0.4, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Relax' }),
      act({ id: 'drink_alone', label: 'Drink alone', category: 'needs', icon: '🥃', durationMinutes: 45, cost: 16, effects: { needs: { fun: 6 }, bloodAlcohol: 0.05, stress: -8, moodlets: [mood('lonely', 'Drinking alone', -3, 120)] }, minStage: YA, requirements: [{ kind: 'age', reason: 'Must be 21+', params: { minAge: 21 } }], autonomyWeight: 0.1, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Vice' }),
    ],
  }),
  def({
    id: 'dance_floor', name: 'Dance floor', category: 'commercial', icon: '🪩', basePrice: 12000, description: 'A lit-up floor under a disco ball. Sticky by midnight.',
    rooms: ['main'], tags: ['nightclub', 'bar', 'dance', 'social', 'nightlife'], durabilityUses: 500000, ambient: { fun: 4, noise: 8 },
    interactions: [
      act({ id: 'dance', label: 'Dance', category: 'entertainment', icon: '💃', durationMinutes: 45, effects: { perMinute: { fun: 0.5 }, needs: { energy: -14, hygiene: -14, social: 14, thirst: -12 }, skills: { dancing: 16 }, fitness: 0.4, stress: -10, custom: [cx('entertainment:dance', { minutes: 45 })], moodlets: [mood('energized', 'Danced it out', 5, 180)] }, minStage: TEEN, satisfies: ['fun', 'social'], autonomyWeight: 0.8, group: 'Dance' }),
      act({ id: 'dance_with_someone', label: 'Dance with someone', category: 'romance', icon: '💞', durationMinutes: 30, effects: { needs: { fun: 18, social: 20, energy: -8, hygiene: -8 }, skills: { dancing: 12, charisma: 6 }, moodlets: [mood('flirty', 'Danced together', 5, 180)] }, minStage: TEEN, satisfies: ['social'], autonomyWeight: 0.3, llm: 'adjudicate', group: 'Dance' }),
      act({ id: 'dance_all_night', label: 'Dance all night', category: 'entertainment', icon: '🌙', durationMinutes: 180, effects: { perMinute: { fun: 0.45 }, needs: { energy: -40, hygiene: -30, social: 25, thirst: -30 }, skills: { dancing: 35 }, fitness: 0.8, stress: -14, custom: [cx('entertainment:dance', { minutes: 180 })], moodlets: [mood('energized', 'Epic night out', 8, 480)] }, minStage: YA, satisfies: ['fun'], autonomyWeight: 0.2, group: 'Dance' }),
      act({ id: 'watch_dancers', label: 'Hang at the edge and watch', category: 'entertainment', icon: '👀', durationMinutes: 20, effects: { needs: { fun: 6, social: 4 } }, minStage: TEEN, autonomyWeight: 0.2, group: 'Dance' }),
    ],
  }),
  def({
    id: 'dj_booth', name: 'DJ booth', category: 'commercial', icon: '🎧', basePrice: 9000, description: 'Decks, a mixer and a laptop. Requests are ignored on principle.', requiresUtility: 'electric',
    rooms: ['main'], tags: ['nightclub', 'music', 'dj', 'staff', 'equipment'], durabilityUses: 50000, repairCost: 700, ambient: { fun: 2, noise: 6 },
    interactions: [
      act({ id: 'request_song', label: 'Request a song', category: 'social', icon: '🎶', durationMinutes: 3, effects: { needs: { social: 3, fun: 2 } }, outcomes: { outcomes: [{ weight: 3, label: 'They played it!', effects: { needs: { fun: 12 }, moodlets: [mood('happy', 'They played your song', 4, 90)] } }, { weight: 5, label: 'Ignored', effects: { needs: { fun: -2 } } }] }, minStage: TEEN, autonomyWeight: 0.15, llm: 'narrate', group: 'Music' }),
      act({ id: 'dj_set', label: 'Play a DJ set', category: 'work', icon: '🎧', durationMinutes: 180, effects: { needs: { fun: 30, social: 20, energy: -20 }, skills: { music: 30, charisma: 10 }, custom: [cx('career:perform', { skill: 'music', venue: 'nightclub' }), cx('entertainment:dj', { minutes: 180 })] }, outcomes: { outcomes: [{ weight: 5, label: 'Packed floor', effects: { money: { amount: 250, memo: 'DJ set fee + tips' }, moodlets: [mood('proud', 'Killed the set', 8, 480)] }, skillId: 'music', skillBias: 3 }, { weight: 4, label: 'Solid night', effects: { money: { amount: 120, memo: 'DJ set fee' } } }, { weight: 2, label: 'Floor emptied out', effects: { money: { amount: 50, memo: 'DJ set fee' }, moodlets: [mood('embarrassed', 'Cleared the floor', -4, 240)] } }] }, requirements: [skillReq('music', 3)], minStage: YA, autonomyWeight: 0.05, group: 'Music' }),
      act({ id: 'watch_dj', label: 'Watch the DJ work', category: 'entertainment', icon: '👀', durationMinutes: 15, effects: { needs: { fun: 6 }, skills: { music: 3 } }, autonomyWeight: 0.1, group: 'Music' }),
    ],
  }),
  def({
    id: 'stage', name: 'Stage', category: 'commercial', icon: '🎤', basePrice: 15000, description: 'A small stage with a mic stand and a taped-up setlist from last week.',
    rooms: ['main'], tags: ['bar', 'music', 'performance', 'comedy', 'open_mic'], durabilityUses: 500000, ambient: { fun: 2, noise: 4 },
    interactions: [
      act({ id: 'open_mic_music', label: 'Play an open mic set', category: 'hobby', icon: '🎸', durationMinutes: 30, effects: { needs: { fun: 16, social: 14, energy: -6 }, skills: { guitar: 14, singing: 14, charisma: 8 }, stress: 4, custom: [cx('career:perform', { skill: 'music', venue: 'bar' })] }, outcomes: { outcomes: [{ weight: 4, label: 'Crowd loved it', effects: { money: { amount: 35, memo: 'Tips' }, moodlets: [mood('proud', 'Crushed the open mic', 7, 480)] }, skillId: 'guitar', skillBias: 3 }, { weight: 4, label: 'Polite applause', effects: { money: { amount: 8, memo: 'Tips' } } }, { weight: 2, label: 'Bombed', effects: { moodlets: [mood('embarrassed', 'Bombed on stage', -6, 240)], stress: 8 } }] }, requirements: [skillReq('guitar', 2)], minStage: TEEN, autonomyWeight: 0.1, llm: 'narrate', group: 'Perform' }),
      act({ id: 'open_mic_comedy', label: 'Do a stand-up set', category: 'hobby', icon: '🎤', durationMinutes: 15, effects: { needs: { fun: 14, social: 12 }, skills: { comedy: 20, charisma: 8 }, stress: 6, custom: [cx('career:perform', { skill: 'comedy', venue: 'bar' })] }, outcomes: { outcomes: [{ weight: 4, label: 'Killed', effects: { money: { amount: 25, memo: 'Comedy tips' }, moodlets: [mood('proud', 'Killed on stage', 8, 480)] }, skillId: 'comedy', skillBias: 3 }, { weight: 4, label: 'Some laughs', effects: {} }, { weight: 3, label: 'Crickets', effects: { moodlets: [mood('embarrassed', 'Crickets', -6, 240)], stress: 10 } }] }, requirements: [skillReq('comedy', 1)], minStage: TEEN, autonomyWeight: 0.1, llm: 'narrate', group: 'Perform' }),
      act({ id: 'watch_show', label: 'Watch the show', category: 'entertainment', icon: '👏', durationMinutes: 60, effects: { perMinute: { fun: 0.35 }, needs: { social: 8 }, stress: -6 }, satisfies: ['fun'], autonomyWeight: 0.6, group: 'Watch' }),
      act({ id: 'heckle', label: 'Heckle the performer', category: 'social', icon: '😤', durationMinutes: 2, effects: { needs: { fun: 4 }, moodlets: [mood('guilty', 'Heckled', -2, 60)] }, outcomes: { outcomes: [{ weight: 3, label: 'Got a laugh', effects: { needs: { fun: 6 } } }, { weight: 4, label: 'Got roasted', effects: { moodlets: [mood('embarrassed', 'Got roasted', -5, 120)] } }, { weight: 1, label: 'Kicked out', effects: { stress: 10, legal: [{ kind: 'heat', delta: 1 }] } }] }, minStage: YA, autonomyWeight: 0.02, llm: 'narrate', group: 'Watch' }),
    ],
  }),
  def({
    id: 'jukebox', name: 'Jukebox', category: 'commercial', icon: '📻', basePrice: 4500, description: 'A digital jukebox. Someone always queues up twelve minutes of one song.', requiresUtility: 'electric',
    rooms: ['bar'], tags: ['bar', 'music', 'coin_op'], durabilityUses: 100000, repairCost: 350, ambient: { fun: 1, noise: 3 },
    interactions: [
      act({ id: 'play_song', label: 'Play a song', category: 'entertainment', icon: '🎵', durationMinutes: 4, cost: 1, effects: { needs: { fun: 8, social: 3 }, moodlets: [mood('happy', 'Your song\'s on', 3, 60)] }, satisfies: ['fun'], autonomyWeight: 0.3, group: 'Music' }),
      act({ id: 'queue_playlist', label: 'Queue up five songs', category: 'entertainment', icon: '📜', durationMinutes: 6, cost: 4, effects: { needs: { fun: 12, social: 4 }, skills: { music: 2 } }, autonomyWeight: 0.1, group: 'Music' }),
      act({ id: 'sing_along', label: 'Sing along loudly', category: 'social', icon: '🎤', durationMinutes: 5, effects: { needs: { fun: 10, social: 8 }, skills: { singing: 5 } }, minStage: TEEN, autonomyWeight: 0.15, llm: 'narrate', group: 'Music' }),
    ],
  }),
  def({
    id: 'pool_table', name: 'Pool table', category: 'commercial', icon: '🎱', basePrice: 3200, description: 'A coin-op pool table with a warped cue and a chalk cube older than you.',
    rooms: ['bar', 'game_room'], tags: ['bar', 'game', 'social', 'billiards'], durabilityUses: 100000, repairCost: 300, ambient: { fun: 2 },
    interactions: [
      act({ id: 'play_pool', label: 'Play a game of pool', category: 'social', icon: '🎱', durationMinutes: 30, cost: 2, effects: { needs: { fun: 14, social: 12 }, skills: { logic: 4, athletics: 3 } }, outcomes: { outcomes: [{ weight: 5, label: 'Won', effects: { moodlets: [mood('proud', 'Ran the table', 3, 120)] }, skillId: 'logic', skillBias: 1 }, { weight: 5, label: 'Lost', effects: { needs: { fun: -2 } } }] }, minStage: TEEN, satisfies: ['fun', 'social'], autonomyWeight: 0.5, llm: 'narrate', requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Play' }),
      act({ id: 'practice_pool', label: 'Practice shots alone', category: 'hobby', icon: '🎯', durationMinutes: 30, cost: 2, effects: { needs: { fun: 8 }, skills: { logic: 6, athletics: 4 } }, minStage: TEEN, autonomyWeight: 0.2, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Play' }),
      act({ id: 'hustle', label: 'Play for money', category: 'entertainment', icon: '💵', durationMinutes: 40, cost: 20, effects: { needs: { fun: 10, social: 8 }, custom: [cx('entertainment:gamble', { game: 'pool', bet: 20 })] }, outcomes: { outcomes: [{ weight: 4, label: 'Won the bet', effects: { money: { amount: 40, memo: 'Won at pool' }, moodlets: [mood('proud', 'Hustled', 4, 120)] }, skillId: 'logic', skillBias: 2 }, { weight: 5, label: 'Lost the bet', effects: { moodlets: [mood('sad', 'Lost $20 at pool', -3, 90)] } }, { weight: 1, label: 'Accused of hustling', effects: { stress: 10, legal: [{ kind: 'heat', delta: 1 }] } }] }, minStage: YA, autonomyWeight: 0.05, llm: 'narrate', requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Play' }),
    ],
  }),
  def({
    id: 'dartboard', name: 'Dartboard', category: 'commercial', icon: '🎯', basePrice: 250, description: 'A bristle dartboard in a cabinet, surrounded by holes in the wall.',
    rooms: ['bar', 'game_room', 'garage'], tags: ['bar', 'game', 'social'], durabilityUses: 50000, portable: true, ambient: { fun: 1 },
    interactions: [
      act({ id: 'play_darts', label: 'Play darts', category: 'social', icon: '🎯', durationMinutes: 25, effects: { needs: { fun: 12, social: 10 }, skills: { athletics: 3 } }, outcomes: { outcomes: [{ weight: 1, label: 'Bullseye!', effects: { needs: { fun: 8 }, moodlets: [mood('proud', 'Bullseye', 3, 90)] } }, { weight: 6, label: 'Decent round', effects: {} }, { weight: 2, label: 'Hit the wall', effects: { moodlets: [mood('embarrassed', 'Missed the board', -1, 30)] } }] }, minStage: TEEN, satisfies: ['fun', 'social'], autonomyWeight: 0.4, group: 'Play' }),
      act({ id: 'practice_darts', label: 'Throw a few darts', category: 'hobby', icon: '🎯', durationMinutes: 15, effects: { needs: { fun: 7 }, skills: { athletics: 3 }, stress: -3 }, minStage: TEEN, autonomyWeight: 0.2, group: 'Play' }),
    ],
  }),
  def({
    id: 'karaoke_machine', name: 'Karaoke machine', category: 'commercial', icon: '🎤', basePrice: 2800, description: 'Two mics, a screen of lyrics, and a binder of 8,000 songs.', requiresUtility: 'electric',
    rooms: ['bar', 'private_room', 'living'], tags: ['bar', 'music', 'singing', 'social', 'party'], durabilityUses: 50000, repairCost: 250, ambient: { fun: 3, noise: 6 },
    interactions: [
      act({ id: 'sing', label: 'Sing a song', category: 'entertainment', icon: '🎤', durationMinutes: 6, effects: { needs: { fun: 16, social: 12 }, skills: { singing: 10, charisma: 4 }, stress: -6, custom: [cx('entertainment:karaoke', {})] }, outcomes: { outcomes: [{ weight: 4, label: 'Brought the house down', effects: { moodlets: [mood('proud', 'Karaoke star', 6, 240)] }, skillId: 'singing', skillBias: 3 }, { weight: 5, label: 'Fun mess', effects: { moodlets: [mood('playful', 'Karaoke', 3, 120)] } }, { weight: 2, label: 'Cracked on the high note', effects: { moodlets: [mood('embarrassed', 'Cracked on the high note', -2, 90)] } }] }, minStage: CHILD, satisfies: ['fun', 'social'], autonomyWeight: 0.4, llm: 'narrate', group: 'Sing' }),
      act({ id: 'duet', label: 'Sing a duet', category: 'social', icon: '👯', durationMinutes: 6, effects: { needs: { fun: 16, social: 18 }, skills: { singing: 8, charisma: 6 }, moodlets: [mood('playful', 'Duet', 4, 120)] }, minStage: CHILD, satisfies: ['social'], autonomyWeight: 0.3, llm: 'narrate', group: 'Sing' }),
      act({ id: 'karaoke_night', label: 'Do a whole karaoke night', category: 'social', icon: '🌙', durationMinutes: 150, cost: 40, effects: { needs: { fun: 40, social: 35, energy: -15 }, skills: { singing: 30, charisma: 10 }, bloodAlcohol: 0.03, stress: -14, custom: [cx('entertainment:karaoke', { minutes: 150 })], moodlets: [mood('happy', 'Karaoke night', 8, 480)] }, minStage: TEEN, satisfies: ['fun', 'social'], autonomyWeight: 0.15, llm: 'narrate', group: 'Sing' }),
      act({ id: 'cheer', label: 'Cheer on the singers', category: 'social', icon: '👏', durationMinutes: 20, effects: { needs: { fun: 8, social: 8 } }, autonomyWeight: 0.3, group: 'Sing' }),
    ],
  }),
  def({
    id: 'arcade_cabinet', name: 'Arcade cabinet', category: 'commercial', icon: '🕹️', basePrice: 3500, description: 'A classic cabinet with a sticky joystick and a high score from 2009.', requiresUtility: 'electric',
    rooms: ['arcade', 'bar'], tags: ['arcade', 'game', 'coin_op', 'fun'], durabilityUses: 100000, repairCost: 300, ambient: { fun: 2, noise: 2 },
    interactions: [
      act({ id: 'play', label: 'Play a round', category: 'entertainment', icon: '🕹️', durationMinutes: 10, cost: 1, effects: { needs: { fun: 12 }, skills: { gaming: 6 }, custom: [cx('entertainment:game', { kind: 'arcade', minutes: 10 })] }, satisfies: ['fun'], autonomyWeight: 0.6, minStage: CHILD, group: 'Play' }),
      act({ id: 'chase_high_score', label: 'Chase the high score', category: 'entertainment', icon: '🏆', durationMinutes: 40, cost: 5, effects: { needs: { fun: 18, energy: -4 }, skills: { gaming: 18 }, custom: [cx('entertainment:game', { kind: 'arcade', minutes: 40 })] }, outcomes: { outcomes: [{ weight: 2, label: 'NEW HIGH SCORE', effects: { needs: { fun: 15 }, moodlets: [mood('proud', 'High score!', 7, 300)] }, skillId: 'gaming', skillBias: 3 }, { weight: 6, label: 'Close', effects: {} }, { weight: 3, label: 'Game over, fast', effects: { needs: { fun: -4 } } }] }, minStage: CHILD, autonomyWeight: 0.2, group: 'Play' }),
      act({ id: 'two_player', label: 'Play two-player', category: 'social', icon: '👥', durationMinutes: 20, cost: 2, effects: { needs: { fun: 16, social: 14 }, skills: { gaming: 8 } }, minStage: CHILD, satisfies: ['fun', 'social'], autonomyWeight: 0.4, group: 'Play' }),
    ],
  }),
  def({
    id: 'claw_machine', name: 'Claw machine', category: 'commercial', icon: '🧸', basePrice: 4000, description: 'A claw machine full of plush that the claw cannot lift.', requiresUtility: 'electric',
    rooms: ['arcade', 'entry'], tags: ['arcade', 'game', 'coin_op'], durabilityUses: 100000, repairCost: 300,
    interactions: [
      act({ id: 'try_claw', label: 'Try the claw', category: 'entertainment', icon: '🧸', durationMinutes: 2, cost: 1, effects: { needs: { fun: 3 } }, outcomes: { outcomes: [{ weight: 1, label: 'GOT ONE', effects: { items: [{ op: 'gain', itemId: 'gift_generic', qty: 1 }], needs: { fun: 15 }, moodlets: [mood('proud', 'Won a plushie', 5, 240)] } }, { weight: 9, label: 'Dropped it', effects: { needs: { fun: -2 } } }] }, minStage: CHILD, autonomyWeight: 0.2, group: 'Play' }),
      act({ id: 'keep_trying', label: 'Keep feeding it dollars', category: 'entertainment', icon: '💸', durationMinutes: 10, cost: 8, effects: { needs: { fun: 6 }, stress: 3 }, outcomes: { outcomes: [{ weight: 4, label: 'Finally!', effects: { items: [{ op: 'gain', itemId: 'gift_generic', qty: 1 }], moodlets: [mood('proud', 'Persistence paid off', 4, 240)] } }, { weight: 6, label: 'The claw wins', effects: { moodlets: [mood('angry', 'Rigged claw', -3, 90)] } }] }, minStage: CHILD, autonomyWeight: 0.05, group: 'Play' }),
    ],
  }),
  def({
    id: 'bowling_lane', name: 'Bowling lane', category: 'commercial', icon: '🎳', basePrice: 60000, description: 'A polished lane with automatic scoring and bumpers on request.', requiresUtility: 'electric',
    rooms: ['lanes'], tags: ['bowling', 'game', 'social', 'family', 'date'], durabilityUses: 500000, repairCost: 2000, ambient: { fun: 3, noise: 4 },
    interactions: [
      act({ id: 'bowl_game', label: 'Bowl a game', category: 'entertainment', icon: '🎳', durationMinutes: 45, cost: 7.5, effects: { needs: { fun: 18, social: 10, energy: -6 }, skills: { athletics: 6 }, fitness: 0.1 }, outcomes: { outcomes: [{ weight: 1, label: 'Strike streak!', effects: { needs: { fun: 10 }, moodlets: [mood('proud', 'Turkey!', 5, 180)] }, skillId: 'athletics', skillBias: 2 }, { weight: 6, label: 'Respectable score', effects: {} }, { weight: 3, label: 'Gutter balls', effects: { moodlets: [mood('embarrassed', 'Gutter city', -2, 60)] } }] }, minStage: CHILD, satisfies: ['fun', 'social'], autonomyWeight: 0.5, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Bowl' }),
      act({ id: 'bowl_group', label: 'Bowl with a group', category: 'social', icon: '👥', durationMinutes: 90, cost: 14, effects: { needs: { fun: 28, social: 28, energy: -10 }, skills: { athletics: 8 }, moodlets: [mood('happy', 'Bowling night', 5, 300)] }, minStage: CHILD, satisfies: ['social', 'fun'], autonomyWeight: 0.3, llm: 'narrate', requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Bowl' }),
      act({ id: 'rent_shoes', label: 'Rent shoes', category: 'shop', icon: '👟', durationMinutes: 3, cost: 4.5, effects: { needs: { hygiene: -2 }, flags: { bowling_shoes: true } }, autonomyWeight: 0.2, group: 'Bowl' }),
      act({ id: 'cosmic_bowling', label: 'Cosmic bowling', category: 'entertainment', icon: '🌌', durationMinutes: 90, cost: 18, effects: { needs: { fun: 30, social: 20 }, skills: { athletics: 6 }, moodlets: [mood('playful', 'Blacklight bowling', 5, 240)] }, requirements: [timeReq(21 * 60, 2 * 60, 'Cosmic bowling starts at 9pm')], minStage: TEEN, autonomyWeight: 0.15, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Bowl' }),
    ],
  }),
  def({
    id: 'slot_machine', name: 'Slot machine', category: 'commercial', icon: '🎰', basePrice: 12000, description: 'A video slot with a jackpot ticker and no clocks anywhere nearby.', requiresUtility: 'electric',
    rooms: ['casino_floor'], tags: ['casino', 'gambling', 'adult'], durabilityUses: 500000, repairCost: 800, ambient: { fun: 1, noise: 3 },
    interactions: [
      gamble('spin_5', 'Play $5 in slots', 'slots', 5, 5, [{ weight: 62, label: 'Nothing', net: -5 }, { weight: 25, label: 'Small win', net: 4 }, { weight: 10, label: 'Nice hit', net: 20 }, { weight: 3, label: 'Big win', net: 100 }]),
      gamble('spin_20', 'Play $20 in slots', 'slots', 20, 15, [{ weight: 60, label: 'Nothing', net: -20 }, { weight: 25, label: 'Small win', net: 15 }, { weight: 12, label: 'Nice hit', net: 60 }, { weight: 3, label: 'Big win', net: 400 }]),
      gamble('spin_100', 'Feed it $100', 'slots', 100, 40, [{ weight: 58, label: 'Gone', net: -100 }, { weight: 27, label: 'Got some back', net: 60 }, { weight: 12, label: 'Bonus round!', net: 250 }, { weight: 3, label: 'JACKPOT', net: 2000 }]),
      act({ id: 'watch_reels', label: 'Watch someone else play', category: 'entertainment', icon: '👀', durationMinutes: 10, effects: { needs: { fun: 3 } }, minStage: YA, autonomyWeight: 0.05, group: 'Gamble' }),
    ],
  }),
  def({
    id: 'poker_table', name: 'Poker table', category: 'commercial', icon: '🃏', basePrice: 4500, description: 'A felt table with a dealer and six people who all think they\'re the shark.',
    rooms: ['casino_floor', 'card_room'], tags: ['casino', 'gambling', 'poker', 'social', 'adult'], durabilityUses: 200000, repairCost: 300, ambient: { fun: 2 },
    interactions: [
      gamble('buy_in_50', 'Sit in with $50', 'poker', 50, 90, [{ weight: 35, label: 'Busted out', net: -50 }, { weight: 30, label: 'Broke about even', net: 10, skillId: 'logic', skillBias: 1 }, { weight: 25, label: 'Walked away up', net: 80, skillId: 'logic', skillBias: 2 }, { weight: 10, label: 'Cleaned up', net: 220, skillId: 'logic', skillBias: 3 }], { effects: { needs: { fun: 10, social: 12 }, skills: { logic: 8, negotiation: 4 }, custom: [cx('entertainment:gamble', { game: 'poker', bet: 50 })] } }),
      gamble('buy_in_200', 'Sit in with $200', 'poker', 200, 150, [{ weight: 35, label: 'Busted out', net: -200 }, { weight: 30, label: 'Broke even', net: 30, skillId: 'logic', skillBias: 1 }, { weight: 25, label: 'Up nicely', net: 300, skillId: 'logic', skillBias: 2 }, { weight: 10, label: 'Big night', net: 900, skillId: 'logic', skillBias: 3 }], { effects: { needs: { fun: 12, social: 14 }, skills: { logic: 12, negotiation: 6 }, custom: [cx('entertainment:gamble', { game: 'poker', bet: 200 })] } }),
      act({ id: 'watch_table', label: 'Rail the table', category: 'entertainment', icon: '👀', durationMinutes: 20, effects: { needs: { fun: 5, social: 3 }, skills: { logic: 3 } }, minStage: YA, autonomyWeight: 0.05, group: 'Gamble' }),
      workTask('deal_cards', 'Deal cards', 'register', 480, { icon: '🃏', skills: { logic: 6, charisma: 6 }, stress: 12 }),
    ],
  }),
  def({
    id: 'roulette_table', name: 'Roulette table', category: 'commercial', icon: '🎡', basePrice: 9000, description: 'A roulette wheel, a croupier, and a crowd holding its breath.',
    rooms: ['casino_floor'], tags: ['casino', 'gambling', 'adult'], durabilityUses: 200000, repairCost: 500, ambient: { fun: 2, noise: 2 },
    interactions: [
      gamble('bet_red_25', 'Bet $25 on red', 'roulette', 25, 5, [{ weight: 20, label: 'Black. House wins', net: -25 }, { weight: 18, label: 'RED!', net: 50 }]),
      gamble('bet_number_10', 'Bet $10 on a number', 'roulette', 10, 5, [{ weight: 37, label: 'Not your number', net: -10 }, { weight: 1, label: 'YOUR NUMBER HIT — 35:1', net: 360 }]),
      gamble('bet_red_100', 'Bet $100 on black', 'roulette', 100, 5, [{ weight: 20, label: 'Red. Ouch', net: -100 }, { weight: 18, label: 'BLACK!', net: 200 }]),
    ],
  }),
);

// =====================================================================================
// COMMERCIAL — gym & sports
// =====================================================================================
add(
  def({
    id: 'gym_treadmill', name: 'Gym treadmill', category: 'commercial', icon: '🏃', basePrice: 4500, description: 'A commercial treadmill facing a wall of TVs on mute.', requiresUtility: 'electric',
    rooms: ['cardio'], tags: ['gym', 'fitness', 'cardio'], durabilityUses: 50000, repairCost: 400,
    interactions: [workout('walk', 'Walk it out', 30, { icon: '🚶', intensity: 0.5, kind: 'walk' }), workout('run', 'Run', 40, { icon: '🏃', intensity: 1.1, kind: 'run', skill: 'athletics' }), workout('intervals', 'Sprint intervals', 25, { icon: '⚡', intensity: 1.3, kind: 'hiit', skill: 'athletics' }), act({ id: 'wipe', label: 'Wipe down the machine', category: 'chores', icon: '🧽', durationMinutes: 2, effects: { custom: [cx('chore:clean', { amount: 20, target: 'object' })], moodlets: [mood('proud', 'Gym etiquette', 1, 60)] }, autonomyWeight: 0.3, group: 'Chores' })],
  }),
  def({
    id: 'gym_rack', name: 'Dumbbell rack', category: 'commercial', icon: '🏋️', basePrice: 6000, description: 'A rack of dumbbells from 5 to 120 lbs, never in order.',
    rooms: ['weights'], tags: ['gym', 'fitness', 'strength'], durabilityUses: 500000, ambient: { fun: 1 },
    interactions: [workout('dumbbell_circuit', 'Dumbbell circuit', 40, { icon: '💪', intensity: 1, kind: 'strength' }), workout('upper_body', 'Upper body day', 50, { icon: '💪', intensity: 1.1, kind: 'strength' }), workout('light_session', 'Light session', 20, { icon: '💪', intensity: 0.5, kind: 'strength' }), act({ id: 'rerack', label: 'Re-rack your weights', category: 'chores', icon: '🧹', durationMinutes: 2, effects: { moodlets: [mood('proud', 'Re-racked', 1, 60)] }, autonomyWeight: 0.2, group: 'Chores' })],
  }),
  def({
    id: 'squat_rack', name: 'Squat rack', category: 'commercial', icon: '🏋️', basePrice: 3500, description: 'A power rack with a bar and bumper plates. Please don\'t curl in it.',
    rooms: ['weights'], tags: ['gym', 'fitness', 'strength'], durabilityUses: 500000, ambient: { fun: 1 },
    interactions: [workout('squats', 'Squat day', 50, { icon: '🦵', intensity: 1.2, kind: 'strength' }), workout('deadlifts', 'Deadlifts', 45, { icon: '🏋️', intensity: 1.3, kind: 'strength', minStage: YA }), workout('bench', 'Bench press', 40, { icon: '🏋️', intensity: 1, kind: 'strength' }), act({ id: 'ask_spot', label: 'Ask for a spot', category: 'social', icon: '🙋', durationMinutes: 5, effects: { needs: { social: 6 } }, minStage: TEEN, autonomyWeight: 0.1, llm: 'narrate', group: 'Social' }), act({ id: 'pr_attempt', label: 'Attempt a PR', category: 'fitness', icon: '🏆', durationMinutes: 30, effects: { fitness: 1, needs: { energy: -18, hygiene: -16, fun: 8 }, skills: { fitness: 25 }, custom: [cx('health:workout', { minutes: 30, kind: 'max' })] }, outcomes: { outcomes: [{ weight: 5, label: 'New PR!', effects: { fitness: 0.6, moodlets: [mood('proud', 'New personal record', 8, 480)] }, skillId: 'fitness', skillBias: 2 }, { weight: 4, label: 'Missed it', effects: { moodlets: [mood('bored', 'Missed the lift', -2, 120)] } }, { weight: 1, label: 'Tweaked your back', effects: { health: -2, needs: { comfort: -20 }, moodlets: [mood('uncomfortable', 'Tweaked back', -6, 1440)] } }] }, requirements: [skillReq('fitness', 3)], minStage: YA, autonomyWeight: 0.1, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Workout' })],
  }),
  def({
    id: 'rowing_machine', name: 'Rowing machine', category: 'commercial', icon: '🚣', basePrice: 1200, description: 'An air rower. Whooshes with every stroke.',
    rooms: ['cardio'], tags: ['gym', 'fitness', 'cardio'], durabilityUses: 50000, repairCost: 150,
    interactions: [workout('row_2k', 'Row 2,000 m', 12, { icon: '🚣', intensity: 1.2, kind: 'row', skill: 'athletics' }), workout('row_steady', 'Steady-state row', 30, { icon: '🚣', intensity: 0.9, kind: 'row' }), act({ id: 'wipe', label: 'Wipe down the rower', category: 'chores', icon: '🧽', durationMinutes: 2, effects: { custom: [cx('chore:clean', { amount: 20, target: 'object' })] }, autonomyWeight: 0.2, group: 'Chores' })],
  }),
  def({
    id: 'elliptical', name: 'Elliptical', category: 'commercial', icon: '🏃', basePrice: 2800, description: 'An elliptical trainer. Easy on the knees, hard on the patience.', requiresUtility: 'electric',
    rooms: ['cardio'], tags: ['gym', 'fitness', 'cardio', 'low_impact'], durabilityUses: 50000, repairCost: 250,
    interactions: [workout('elliptical_30', 'Elliptical session', 30, { icon: '🏃', intensity: 0.8, kind: 'elliptical' }), workout('elliptical_podcast', 'Elliptical with a podcast', 45, { icon: '🎙️', intensity: 0.7, kind: 'elliptical', fun: 14 }), act({ id: 'wipe', label: 'Wipe down the machine', category: 'chores', icon: '🧽', durationMinutes: 2, effects: { custom: [cx('chore:clean', { amount: 20, target: 'object' })] }, autonomyWeight: 0.2, group: 'Chores' })],
  }),
  def({
    id: 'spin_bike', name: 'Spin bike', category: 'commercial', icon: '🚴', basePrice: 1500, description: 'A studio spin bike. The instructor will yell encouragement.',
    rooms: ['studio', 'cardio'], tags: ['gym', 'fitness', 'cardio', 'class'], durabilityUses: 50000, repairCost: 150,
    interactions: [workout('spin_class', 'Take a spin class', 45, { icon: '🚴', intensity: 1.2, kind: 'cycle', fun: 16, description: 'Loud music, dim lights, burning quads.' }), workout('free_ride', 'Free ride', 30, { icon: '🚴', intensity: 0.8, kind: 'cycle' }), act({ id: 'wipe', label: 'Wipe down the bike', category: 'chores', icon: '🧽', durationMinutes: 2, effects: { custom: [cx('chore:clean', { amount: 20, target: 'object' })] }, autonomyWeight: 0.2, group: 'Chores' })],
  }),
  def({
    id: 'sauna', name: 'Sauna', category: 'commercial', icon: '🧖', basePrice: 9000, description: 'A cedar sauna at 180°F. Ten minutes feels like an hour.', requiresUtility: 'electric', runningCostMonthly: 120,
    rooms: ['locker_room', 'spa'], tags: ['gym', 'spa', 'relax', 'wellness'], durabilityUses: 200000, repairCost: 600, ambient: { comfort: 3 },
    interactions: [
      act({ id: 'sauna_session', label: 'Sit in the sauna', category: 'needs', icon: '🧖', durationMinutes: 15, effects: { needs: { comfort: 18, hygiene: 6, thirst: -14, energy: -3 }, stress: -14, health: 0.2, custom: [cx('health:sauna', { minutes: 15 })], moodlets: [mood('relaxed', 'Sauna glow', 5, 240)] }, minStage: TEEN, satisfies: ['comfort'], autonomyWeight: 0.4, group: 'Spa' }),
      act({ id: 'sauna_long', label: 'Long sauna & cold plunge', category: 'needs', icon: '🧊', durationMinutes: 35, effects: { needs: { comfort: 24, hygiene: 10, thirst: -24, energy: 6 }, stress: -22, health: 0.4, custom: [cx('health:sauna', { minutes: 35, plunge: true })], moodlets: [mood('energized', 'Contrast therapy', 7, 300)] }, minStage: YA, satisfies: ['comfort'], autonomyWeight: 0.2, group: 'Spa' }),
      act({ id: 'sauna_chat', label: 'Chat in the sauna', category: 'social', icon: '💬', durationMinutes: 15, effects: { needs: { comfort: 14, social: 12, thirst: -12 }, stress: -10 }, minStage: TEEN, satisfies: ['social'], autonomyWeight: 0.15, llm: 'narrate', group: 'Spa' }),
    ],
  }),
  def({
    id: 'lap_pool', name: 'Lap pool', category: 'commercial', icon: '🏊', basePrice: 250000, description: 'A 25-yard indoor pool with lane ropes and a lifeguard on a chair.', requiresUtility: 'water', runningCostMonthly: 2500,
    rooms: ['pool'], tags: ['gym', 'fitness', 'swim', 'pool'], durabilityUses: 1000000, repairCost: 5000, ambient: { fun: 2 },
    interactions: [
      workout('laps', 'Swim laps', 40, { icon: '🏊', intensity: 1.1, kind: 'swim', skill: 'athletics', fun: 12, minStage: CHILD, wearBy: 0.05 }),
      act({ id: 'swim_free', label: 'Free swim', category: 'entertainment', icon: '💦', durationMinutes: 45, effects: { perMinute: { fun: 0.35 }, needs: { hygiene: 6, energy: -10, social: 6 }, fitness: 0.4, stress: -8, custom: [cx('health:workout', { minutes: 45, kind: 'swim' })] }, minStage: CHILD, satisfies: ['fun'], autonomyWeight: 0.5, group: 'Swim' }),
      act({ id: 'water_aerobics', label: 'Join water aerobics', category: 'fitness', icon: '🩱', durationMinutes: 45, effects: { fitness: 0.9, needs: { fun: 14, energy: -12, social: 12, hygiene: 4 }, skills: { fitness: 16 }, stress: -8, custom: [cx('health:workout', { minutes: 45, kind: 'aqua' })] }, minStage: TEEN, satisfies: ['fun', 'social'], autonomyWeight: 0.2, group: 'Swim' }),
      act({ id: 'swim_lesson', label: 'Take a swim lesson', category: 'school', icon: '🎓', durationMinutes: 45, cost: 35, effects: { skills: { athletics: 30 }, fitness: 0.5, needs: { fun: 10, energy: -10 } }, minStage: CHILD, autonomyWeight: 0.05, group: 'Swim' }),
      workTask('lifeguard', 'Lifeguard the pool', 'desk', 300, { icon: '🛟', skills: { athletics: 4, medicine: 2 }, fun: -6, stress: 6 }),
    ],
  }),
  def({
    id: 'basketball_court', name: 'Basketball court', category: 'outdoor', icon: '🏀', basePrice: 40000, description: 'A full court with chain nets. Pickup games at dusk.',
    rooms: ['court'], tags: ['park', 'gym', 'sport', 'basketball', 'social', 'outdoor'], durabilityUses: 1000000, ambient: { fun: 2, noise: 3 },
    interactions: [
      act({ id: 'shoot_around', label: 'Shoot around', category: 'fitness', icon: '🏀', durationMinutes: 30, effects: { fitness: 0.6, weight: -0.06, needs: { fun: 14, energy: -10, hygiene: -12 }, skills: { athletics: 14 }, stress: -6, custom: [cx('health:workout', { minutes: 30, kind: 'basketball' })] }, minStage: CHILD, satisfies: ['fun'], autonomyWeight: 0.5, group: 'Play' }),
      act({ id: 'pickup_game', label: 'Join a pickup game', category: 'social', icon: '🏀', durationMinutes: 60, effects: { fitness: 1.4, weight: -0.15, needs: { fun: 24, social: 20, energy: -24, hygiene: -26, thirst: -20 }, skills: { athletics: 26, charisma: 4 }, stress: -8, custom: [cx('health:workout', { minutes: 60, kind: 'basketball' })] }, outcomes: { outcomes: [{ weight: 5, label: 'Your team won', effects: { moodlets: [mood('proud', 'Won the pickup game', 5, 240)] }, skillId: 'athletics', skillBias: 2 }, { weight: 5, label: 'Lost, good run', effects: {} }, { weight: 1, label: 'Rolled an ankle', effects: { health: -2, needs: { comfort: -15 }, moodlets: [mood('uncomfortable', 'Rolled ankle', -5, 1440)] } }] }, minStage: TEEN, satisfies: ['fun', 'social'], autonomyWeight: 0.4, llm: 'narrate', group: 'Play' }),
      act({ id: 'free_throws', label: 'Practice free throws', category: 'hobby', icon: '🎯', durationMinutes: 20, effects: { skills: { athletics: 10 }, needs: { fun: 6, energy: -4 }, fitness: 0.2 }, minStage: CHILD, autonomyWeight: 0.2, group: 'Play' }),
      act({ id: 'watch_game', label: 'Watch the game from the sideline', category: 'entertainment', icon: '👀', durationMinutes: 30, effects: { needs: { fun: 8, social: 6 } }, autonomyWeight: 0.2, group: 'Play' }),
    ],
  }),
  def({
    id: 'tennis_court', name: 'Tennis court', category: 'outdoor', icon: '🎾', basePrice: 60000, description: 'A hard court with a slightly saggy net. Pickleball players circling.',
    rooms: ['court'], tags: ['park', 'sport', 'tennis', 'pickleball', 'outdoor'], durabilityUses: 1000000, ambient: { fun: 1 },
    interactions: [
      act({ id: 'play_tennis', label: 'Play tennis', category: 'social', icon: '🎾', durationMinutes: 60, effects: { fitness: 1.3, weight: -0.14, needs: { fun: 22, social: 16, energy: -22, hygiene: -24, thirst: -20 }, skills: { athletics: 24 }, stress: -8, custom: [cx('health:workout', { minutes: 60, kind: 'tennis' })] }, outcomes: { outcomes: [{ weight: 5, label: 'Won the set', effects: { moodlets: [mood('proud', 'Won at tennis', 4, 240)] }, skillId: 'athletics', skillBias: 2 }, { weight: 5, label: 'Lost the set', effects: {} }] }, minStage: CHILD, satisfies: ['fun', 'social'], autonomyWeight: 0.3, llm: 'narrate', requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Play' }),
      act({ id: 'pickleball', label: 'Play pickleball', category: 'social', icon: '🏓', durationMinutes: 60, effects: { fitness: 0.9, weight: -0.1, needs: { fun: 22, social: 22, energy: -16, hygiene: -18 }, skills: { athletics: 16 }, stress: -8, custom: [cx('health:workout', { minutes: 60, kind: 'pickleball' })], moodlets: [mood('playful', 'Pickleball', 4, 180)] }, minStage: CHILD, satisfies: ['fun', 'social'], autonomyWeight: 0.3, llm: 'narrate', requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Play' }),
      act({ id: 'wall_practice', label: 'Hit against the wall', category: 'hobby', icon: '🧱', durationMinutes: 30, effects: { skills: { athletics: 12 }, needs: { fun: 8, energy: -8, hygiene: -10 }, fitness: 0.4 }, minStage: CHILD, autonomyWeight: 0.15, group: 'Play' }),
      act({ id: 'tennis_lesson', label: 'Take a tennis lesson', category: 'school', icon: '🎓', durationMinutes: 60, cost: 70, effects: { skills: { athletics: 40 }, fitness: 0.8, needs: { fun: 12, energy: -16, hygiene: -16 } }, minStage: CHILD, autonomyWeight: 0.03, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Play' }),
    ],
  }),
  def({
    id: 'soccer_field', name: 'Soccer field', category: 'outdoor', icon: '⚽', basePrice: 80000, description: 'A grass pitch with portable goals and a rec league schedule taped to the fence.',
    rooms: ['field'], tags: ['park', 'sport', 'soccer', 'outdoor', 'kids'], durabilityUses: 1000000, ambient: { fun: 2 },
    interactions: [
      act({ id: 'kick_around', label: 'Kick a ball around', category: 'fitness', icon: '⚽', durationMinutes: 30, effects: { fitness: 0.6, needs: { fun: 14, energy: -10, hygiene: -12 }, skills: { athletics: 12 }, stress: -6, custom: [cx('health:workout', { minutes: 30, kind: 'soccer' })] }, minStage: CHILD, satisfies: ['fun'], autonomyWeight: 0.4, group: 'Play' }),
      act({ id: 'rec_match', label: 'Play a rec league match', category: 'social', icon: '🏆', durationMinutes: 90, effects: { fitness: 1.8, weight: -0.2, needs: { fun: 26, social: 24, energy: -30, hygiene: -30, thirst: -28 }, skills: { athletics: 30 }, stress: -8, custom: [cx('health:workout', { minutes: 90, kind: 'soccer' })] }, outcomes: { outcomes: [{ weight: 5, label: 'Won!', effects: { moodlets: [mood('proud', 'Won the match', 6, 300)] }, skillId: 'athletics', skillBias: 2 }, { weight: 5, label: 'Lost', effects: { moodlets: [mood('sad', 'Lost the match', -2, 120)] } }, { weight: 1, label: 'Pulled a hamstring', effects: { health: -2, needs: { comfort: -15 } } }] }, minStage: TEEN, satisfies: ['fun', 'social'], autonomyWeight: 0.2, llm: 'narrate', group: 'Play' }),
      act({ id: 'coach_kids', label: 'Coach a kids\' practice', category: 'family', icon: '📣', durationMinutes: 75, effects: { needs: { fun: 12, social: 16, energy: -12, hygiene: -10 }, skills: { parenting: 12, charisma: 8, athletics: 6 }, custom: [cx('civic:volunteer', { kind: 'coach' })], moodlets: [mood('proud', 'Coach', 4, 300)] }, minStage: YA, autonomyWeight: 0.05, llm: 'narrate', group: 'Family' }),
      act({ id: 'watch_match', label: 'Watch from the sideline', category: 'entertainment', icon: '🪑', durationMinutes: 60, effects: { needs: { fun: 10, social: 8, comfort: -4 } }, autonomyWeight: 0.2, group: 'Play' }),
    ],
  }),
  def({
    id: 'baseball_diamond', name: 'Baseball diamond', category: 'outdoor', icon: '⚾', basePrice: 90000, description: 'A dirt infield, a backstop and a snack shack that opens on game days.',
    rooms: ['field'], tags: ['park', 'sport', 'baseball', 'softball', 'outdoor'], durabilityUses: 1000000, ambient: { fun: 2 },
    interactions: [
      act({ id: 'play_catch', label: 'Play catch', category: 'social', icon: '🧤', durationMinutes: 30, effects: { fitness: 0.3, needs: { fun: 14, social: 14, energy: -6, hygiene: -8 }, skills: { athletics: 8 }, stress: -6, moodlets: [mood('nostalgic', 'Playing catch', 3, 180)] }, minStage: CHILD, satisfies: ['fun', 'social'], autonomyWeight: 0.3, llm: 'narrate', group: 'Play' }),
      act({ id: 'softball_game', label: 'Play a softball game', category: 'social', icon: '🥎', durationMinutes: 120, effects: { fitness: 1, weight: -0.1, needs: { fun: 26, social: 28, energy: -22, hygiene: -24, thirst: -20 }, skills: { athletics: 22 }, custom: [cx('health:workout', { minutes: 120, kind: 'softball' })], moodlets: [mood('happy', 'Beer-league softball', 5, 300)] }, minStage: TEEN, satisfies: ['fun', 'social'], autonomyWeight: 0.15, llm: 'narrate', group: 'Play' }),
      act({ id: 'batting_practice', label: 'Take batting practice', category: 'fitness', icon: '⚾', durationMinutes: 30, effects: { fitness: 0.5, needs: { fun: 12, energy: -10, hygiene: -12 }, skills: { athletics: 14 } }, minStage: CHILD, autonomyWeight: 0.2, group: 'Play' }),
      act({ id: 'watch_little_league', label: 'Watch a game from the bleachers', category: 'entertainment', icon: '🪑', durationMinutes: 90, effects: { needs: { fun: 12, social: 8, comfort: -6 }, stress: -4 }, autonomyWeight: 0.15, group: 'Play' }),
    ],
  }),
  def({
    id: 'golf_tee', name: 'Golf tee box', category: 'outdoor', icon: '⛳', basePrice: 150000, description: 'The first tee. Eighteen holes, four hours, one lost ball per hole.',
    rooms: ['course'], tags: ['golf', 'sport', 'outdoor', 'business', 'pricey'], durabilityUses: 1000000, ambient: { environment: 3 },
    interactions: [
      act({ id: 'play_18', label: 'Play 18 holes', category: 'entertainment', icon: '⛳', durationMinutes: 240, cost: 65, effects: { fitness: 0.8, needs: { fun: 30, social: 20, energy: -24, hygiene: -20, thirst: -24 }, skills: { athletics: 20, negotiation: 4 }, stress: -12, custom: [cx('health:workout', { minutes: 240, kind: 'golf' })], moodlets: [mood('relaxed', 'Day on the course', 5, 480)] }, outcomes: { outcomes: [{ weight: 3, label: 'Best round yet', effects: { moodlets: [mood('proud', 'Career round', 6, 480)] }, skillId: 'athletics', skillBias: 2 }, { weight: 6, label: 'Typical', effects: {} }, { weight: 3, label: 'Lost six balls', effects: { stress: 6, moodlets: [mood('angry', 'Golf is a cruel game', -3, 120)] } }] }, minStage: TEEN, satisfies: ['fun', 'social'], autonomyWeight: 0.1, llm: 'narrate', group: 'Golf' }),
      act({ id: 'play_9', label: 'Play 9 holes', category: 'entertainment', icon: '⛳', durationMinutes: 120, cost: 38, effects: { fitness: 0.4, needs: { fun: 18, social: 10, energy: -12, hygiene: -12 }, skills: { athletics: 12 }, stress: -8, custom: [cx('health:workout', { minutes: 120, kind: 'golf' })] }, minStage: TEEN, satisfies: ['fun'], autonomyWeight: 0.1, group: 'Golf' }),
      act({ id: 'driving_range', label: 'Hit a bucket at the range', category: 'hobby', icon: '🏌️', durationMinutes: 45, cost: 14, effects: { needs: { fun: 12, energy: -8, hygiene: -8 }, skills: { athletics: 14 }, stress: -6 }, minStage: CHILD, autonomyWeight: 0.15, group: 'Golf' }),
      act({ id: 'business_round', label: 'Play a business round', category: 'work', icon: '🤝', durationMinutes: 240, cost: 90, effects: { needs: { fun: 22, social: 24, energy: -20, hygiene: -18 }, skills: { negotiation: 16, charisma: 10, athletics: 10 }, custom: [cx('career:meeting', { kind: 'golf' })] }, minStage: YA, autonomyWeight: 0.03, llm: 'narrate', group: 'Golf' }),
    ],
  }),
  def({
    id: 'climbing_wall', name: 'Climbing wall', category: 'commercial', icon: '🧗', basePrice: 45000, description: 'A bouldering wall with color-coded routes and crash pads.',
    rooms: ['climbing'], tags: ['gym', 'fitness', 'climbing', 'social'], durabilityUses: 500000, repairCost: 800, ambient: { fun: 3 },
    interactions: [
      workout('boulder', 'Boulder', 60, { icon: '🧗', intensity: 1.2, kind: 'climb', skill: 'athletics', fun: 20, stress: -10, minStage: CHILD }),
      act({ id: 'project_route', label: 'Project a hard route', category: 'fitness', icon: '🎯', durationMinutes: 45, effects: { fitness: 1.2, needs: { fun: 12, energy: -20, hygiene: -20 }, skills: { athletics: 22, logic: 4 }, custom: [cx('health:workout', { minutes: 45, kind: 'climb' })] }, outcomes: { outcomes: [{ weight: 3, label: 'Sent it!', effects: { needs: { fun: 16 }, moodlets: [mood('proud', 'Sent the project', 7, 300)] }, skillId: 'athletics', skillBias: 3 }, { weight: 5, label: 'Progress', effects: {} }, { weight: 2, label: 'Fell awkwardly', effects: { health: -1, needs: { comfort: -10 } } }] }, requirements: [skillReq('athletics', 2)], minStage: TEEN, autonomyWeight: 0.15, group: 'Workout' }),
      act({ id: 'climb_with_friend', label: 'Climb with a friend', category: 'social', icon: '👥', durationMinutes: 75, effects: { fitness: 1.2, needs: { fun: 24, social: 22, energy: -22, hygiene: -22 }, skills: { athletics: 20 }, stress: -10, custom: [cx('health:workout', { minutes: 75, kind: 'climb' })] }, minStage: CHILD, satisfies: ['fun', 'social'], autonomyWeight: 0.3, llm: 'narrate', group: 'Workout' }),
      act({ id: 'rent_shoes', label: 'Rent climbing shoes', category: 'shop', icon: '🥾', durationMinutes: 3, cost: 6, effects: { flags: { climbing_shoes: true } }, autonomyWeight: 0.2, group: 'Shop' }),
    ],
  }),
  def({
    id: 'ice_rink_surface', name: 'Ice rink', category: 'commercial', icon: '⛸️', basePrice: 400000, description: 'A sheet of ice. Public skate on weekends, hockey at 5 a.m.', requiresUtility: 'electric', runningCostMonthly: 6000,
    rooms: ['rink'], tags: ['rink', 'skating', 'hockey', 'winter', 'date', 'family'], durabilityUses: 1000000, ambient: { fun: 3 },
    interactions: [
      act({ id: 'public_skate', label: 'Go skating', category: 'entertainment', icon: '⛸️', durationMinutes: 60, cost: 12, effects: { fitness: 0.7, needs: { fun: 22, social: 10, energy: -14, hygiene: -10, comfort: -6 }, skills: { athletics: 14 }, stress: -8, custom: [cx('health:workout', { minutes: 60, kind: 'skate' })], moodlets: [mood('playful', 'Skating', 4, 180)] }, outcomes: { outcomes: [{ weight: 7, label: 'Stayed upright', effects: {} }, { weight: 3, label: 'Fell a few times', effects: { needs: { comfort: -8 }, moodlets: [mood('embarrassed', 'Fell on the ice', -2, 90)] } }] }, minStage: CHILD, satisfies: ['fun'], autonomyWeight: 0.3, group: 'Skate' }),
      act({ id: 'skate_date', label: 'Skate with someone', category: 'romance', icon: '💕', durationMinutes: 60, cost: 12, effects: { fitness: 0.5, needs: { fun: 22, social: 22, energy: -12 }, skills: { athletics: 10 }, moodlets: [mood('flirty', 'Skating date', 5, 240)] }, minStage: TEEN, satisfies: ['social'], autonomyWeight: 0.15, llm: 'narrate', group: 'Skate' }),
      act({ id: 'pickup_hockey', label: 'Play pickup hockey', category: 'social', icon: '🏒', durationMinutes: 75, cost: 15, effects: { fitness: 1.6, weight: -0.18, needs: { fun: 26, social: 20, energy: -28, hygiene: -28 }, skills: { athletics: 28 }, custom: [cx('health:workout', { minutes: 75, kind: 'hockey' })] }, minStage: TEEN, satisfies: ['fun', 'social'], autonomyWeight: 0.1, llm: 'narrate', group: 'Skate' }),
      act({ id: 'rent_skates', label: 'Rent skates', category: 'shop', icon: '⛸️', durationMinutes: 4, cost: 6, effects: { flags: { has_skates: true } }, autonomyWeight: 0.2, group: 'Shop' }),
    ],
  }),
  def({
    id: 'yoga_studio_floor', name: 'Yoga studio', category: 'commercial', icon: '🧘', basePrice: 8000, description: 'A warm wood floor, dim lights, a shelf of blocks and straps.',
    rooms: ['studio'], tags: ['gym', 'yoga', 'wellness', 'class'], durabilityUses: 1000000, ambient: { comfort: 3 },
    interactions: [
      act({ id: 'yoga_class', label: 'Take a yoga class', category: 'fitness', icon: '🧘', durationMinutes: 60, cost: 22, effects: { fitness: 1, needs: { fun: 12, energy: -10, hygiene: -12, comfort: 10, social: 8 }, skills: { fitness: 20 }, stress: -20, health: 0.3, custom: [cx('health:workout', { minutes: 60, kind: 'yoga' })], moodlets: [mood('relaxed', 'Namaste', 6, 300)] }, minStage: TEEN, satisfies: ['comfort', 'fun'], autonomyWeight: 0.3, group: 'Class' }),
      act({ id: 'hot_yoga', label: 'Take hot yoga', category: 'fitness', icon: '🔥', durationMinutes: 75, cost: 26, effects: { fitness: 1.4, weight: -0.2, needs: { fun: 10, energy: -22, hygiene: -30, thirst: -30, comfort: 6 }, skills: { fitness: 28 }, stress: -18, custom: [cx('health:workout', { minutes: 75, kind: 'hot_yoga' })], moodlets: [mood('energized', 'Sweated it out', 6, 300)] }, minStage: YA, autonomyWeight: 0.15, group: 'Class' }),
      act({ id: 'meditation_class', label: 'Guided meditation', category: 'needs', icon: '🕉️', durationMinutes: 30, cost: 15, effects: { stress: -22, needs: { comfort: 10, fun: 4 }, custom: [cx('health:therapy', { kind: 'meditation' })], moodlets: [mood('relaxed', 'Deep calm', 7, 300)] }, minStage: TEEN, autonomyWeight: 0.15, group: 'Class' }),
      workTask('teach_yoga', 'Teach a class', 'classroom', 75, { icon: '🧘', skills: { fitness: 10, charisma: 8 }, energy: -14, hygiene: -12, stress: -4, fun: 8 }),
    ],
  }),
  def({
    id: 'massage_table', name: 'Massage table', category: 'commercial', icon: '💆', basePrice: 900, description: 'A padded table with a face cradle and a bottle of eucalyptus oil.',
    rooms: ['treatment_room', 'spa'], tags: ['spa', 'wellness', 'relax', 'luxury'], durabilityUses: 50000, ambient: { comfort: 3 },
    interactions: [
      act({ id: 'massage_60', label: 'Get a 60-minute massage', category: 'health', icon: '💆', durationMinutes: 60, cost: 110, effects: { needs: { comfort: 40, energy: 10, hygiene: 4 }, stress: -30, health: 0.5, custom: [cx('health:massage', { minutes: 60 })], moodlets: [mood('relaxed', 'Massage bliss', 10, 480)] }, minStage: TEEN, satisfies: ['comfort'], autonomyWeight: 0.15, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Spa' }),
      act({ id: 'massage_30', label: 'Get a 30-minute massage', category: 'health', icon: '💆', durationMinutes: 30, cost: 65, effects: { needs: { comfort: 24, energy: 6 }, stress: -18, health: 0.3, custom: [cx('health:massage', { minutes: 30 })], moodlets: [mood('relaxed', 'Loosened up', 6, 300)] }, minStage: TEEN, satisfies: ['comfort'], autonomyWeight: 0.15, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Spa' }),
      act({ id: 'couples_massage', label: 'Couples massage', category: 'romance', icon: '💞', durationMinutes: 60, cost: 220, effects: { needs: { comfort: 40, social: 20, energy: 8 }, stress: -28, custom: [cx('health:massage', { minutes: 60 })], moodlets: [mood('in_love', 'Couples massage', 8, 480)] }, minStage: YA, autonomyWeight: 0.03, llm: 'narrate', requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Spa' }),
      workTask('give_massage', 'Work a massage shift', 'desk', 300, { icon: '🙌', skills: { fitness: 4, charisma: 4 }, energy: -22, stress: 6 }),
    ],
  }),
);

// =====================================================================================
// COMMERCIAL — personal care
// =====================================================================================
add(
  def({
    id: 'salon_chair', name: 'Salon chair', category: 'commercial', icon: '💇', basePrice: 1800, description: 'A hydraulic salon chair facing a big lit mirror. Gossip included.',
    rooms: ['salon'], tags: ['salon', 'hair', 'grooming', 'social'], durabilityUses: 100000, repairCost: 200, ambient: { environment: 1 },
    interactions: [
      act({ id: 'haircut', label: 'Get a haircut', category: 'needs', icon: '✂️', durationMinutes: 45, cost: 45, effects: { needs: { hygiene: 12, social: 10, fun: 6 }, stress: -6, moodlets: [mood('confident', 'Fresh haircut', 6, 1440)] }, satisfies: ['hygiene'], autonomyWeight: 0.15, llm: 'narrate', requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Salon' }),
      act({ id: 'cut_and_color', label: 'Cut and color', category: 'needs', icon: '🎨', durationMinutes: 150, cost: 180, effects: { needs: { hygiene: 12, social: 14, fun: 12 }, stress: -8, moodlets: [mood('confident', 'New look', 9, 2880)] }, minStage: TEEN, autonomyWeight: 0.05, llm: 'narrate', requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Salon' }),
      act({ id: 'blowout', label: 'Get a blowout', category: 'needs', icon: '💨', durationMinutes: 40, cost: 55, effects: { needs: { hygiene: 8, fun: 8 }, moodlets: [mood('confident', 'Great hair day', 6, 720)] }, minStage: TEEN, autonomyWeight: 0.05, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Salon' }),
      act({ id: 'kids_cut', label: 'Kids\' haircut', category: 'family', icon: '🧒', durationMinutes: 25, cost: 22, effects: { needs: { hygiene: 8, fun: 2 }, moodlets: [mood('confident', 'Fresh cut', 3, 720)] }, autonomyWeight: 0.1, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Salon' }),
      workTask('style_hair', 'Style clients', 'desk', 360, { icon: '✂️', skills: { creativity: 8, charisma: 10 }, energy: -24, stress: 8, fun: 4 }),
    ],
  }),
  def({
    id: 'barber_chair', name: 'Barber chair', category: 'commercial', icon: '💈', basePrice: 1500, description: 'A vintage barber chair, hot towels, and a TV showing the game.',
    rooms: ['barbershop'], tags: ['barber', 'hair', 'grooming', 'social'], durabilityUses: 100000, repairCost: 200,
    interactions: [
      act({ id: 'haircut', label: 'Get a cut', category: 'needs', icon: '✂️', durationMinutes: 30, cost: 30, effects: { needs: { hygiene: 12, social: 10, fun: 6 }, stress: -6, moodlets: [mood('confident', 'Fresh cut', 6, 1440)] }, satisfies: ['hygiene'], autonomyWeight: 0.15, llm: 'narrate', requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Barber' }),
      act({ id: 'hot_shave', label: 'Hot towel shave', category: 'needs', icon: '🪒', durationMinutes: 30, cost: 35, effects: { needs: { hygiene: 10, comfort: 14, fun: 6 }, stress: -10, moodlets: [mood('relaxed', 'Hot towel shave', 6, 720)] }, minStage: YA, autonomyWeight: 0.05, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Barber' }),
      act({ id: 'beard_trim', label: 'Beard trim', category: 'needs', icon: '🧔', durationMinutes: 20, cost: 20, effects: { needs: { hygiene: 6 }, moodlets: [mood('confident', 'Tidy beard', 4, 1440)] }, minStage: YA, autonomyWeight: 0.05, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Barber' }),
      act({ id: 'shop_talk', label: 'Shoot the breeze', category: 'social', icon: '💬', durationMinutes: 20, effects: { needs: { social: 16, fun: 8 }, skills: { charisma: 4 } }, satisfies: ['social'], autonomyWeight: 0.2, llm: 'narrate', group: 'Social' }),
      workTask('cut_hair', 'Cut hair all day', 'desk', 420, { icon: '💈', skills: { charisma: 10, creativity: 6 }, energy: -26, stress: 6, fun: 6 }),
    ],
  }),
  def({
    id: 'nail_station', name: 'Nail station', category: 'commercial', icon: '💅', basePrice: 1400, description: 'A manicure table with a UV lamp and 300 shades of pink.',
    rooms: ['salon'], tags: ['salon', 'nails', 'grooming', 'social'], durabilityUses: 100000, repairCost: 150,
    interactions: [
      act({ id: 'manicure', label: 'Get a manicure', category: 'needs', icon: '💅', durationMinutes: 40, cost: 35, effects: { needs: { hygiene: 6, fun: 10, social: 8, comfort: 6 }, stress: -8, moodlets: [mood('confident', 'Fresh nails', 5, 2880)] }, minStage: TEEN, autonomyWeight: 0.1, llm: 'narrate', requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Nails' }),
      act({ id: 'pedicure', label: 'Get a pedicure', category: 'needs', icon: '🦶', durationMinutes: 50, cost: 50, effects: { needs: { hygiene: 8, fun: 10, comfort: 16 }, stress: -12, moodlets: [mood('relaxed', 'Pedicure', 6, 2880)] }, minStage: TEEN, autonomyWeight: 0.08, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Nails' }),
      act({ id: 'gel_set', label: 'Full gel set', category: 'needs', icon: '✨', durationMinutes: 75, cost: 70, effects: { needs: { fun: 14, social: 10 }, stress: -6, moodlets: [mood('confident', 'Gel nails', 7, 10080)] }, minStage: TEEN, autonomyWeight: 0.05, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Nails' }),
      workTask('do_nails', 'Do nails', 'desk', 420, { icon: '💅', skills: { creativity: 8, charisma: 8 }, energy: -20, stress: 8 }),
    ],
  }),
  def({
    id: 'tattoo_chair', name: 'Tattoo chair', category: 'commercial', icon: '🪡', basePrice: 2200, description: 'A reclining chair, a tray of inks, and flash on every wall.',
    rooms: ['studio'], tags: ['tattoo', 'body_art', 'adult'], durabilityUses: 100000, repairCost: 250, ambient: { environment: 1 },
    interactions: [
      act({ id: 'small_tattoo', label: 'Get a small tattoo', category: 'needs', icon: '🪡', durationMinutes: 60, cost: 150, effects: { needs: { comfort: -16, fun: 12 }, health: -0.3, custom: [cx('health:tattoo', { size: 'small' })], moodlets: [mood('proud', 'New ink', 6, 2880)] }, minStage: YA, requirements: [{ kind: 'age', reason: 'Must be 18+', params: { minAge: 18 } }], autonomyWeight: 0.02, llm: 'narrate', requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Tattoo' }),
      act({ id: 'sleeve_session', label: 'Sleeve session', category: 'needs', icon: '🐉', durationMinutes: 240, cost: 600, effects: { needs: { comfort: -40, fun: 16, energy: -16 }, health: -0.8, custom: [cx('health:tattoo', { size: 'large' })], moodlets: [mood('proud', 'Sleeve progress', 8, 4320)] }, minStage: YA, requirements: [{ kind: 'age', reason: 'Must be 18+', params: { minAge: 18 } }], autonomyWeight: 0.01, llm: 'narrate', requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Tattoo' }),
      act({ id: 'piercing', label: 'Get a piercing', category: 'needs', icon: '💎', durationMinutes: 20, cost: 55, effects: { needs: { comfort: -10, fun: 8 }, custom: [cx('health:tattoo', { size: 'piercing' })], moodlets: [mood('confident', 'New piercing', 4, 1440)] }, minStage: TEEN, autonomyWeight: 0.02, group: 'Tattoo' }),
      act({ id: 'consult', label: 'Consult on a design', category: 'social', icon: '✏️', durationMinutes: 25, effects: { needs: { social: 8, fun: 6 }, skills: { creativity: 4 } }, minStage: TEEN, autonomyWeight: 0.03, llm: 'narrate', group: 'Tattoo' }),
      workTask('tattoo_clients', 'Tattoo clients', 'desk', 360, { icon: '🪡', skills: { painting: 12, creativity: 10, charisma: 4 }, energy: -20, stress: 10 }),
    ],
  }),
  def({
    id: 'tanning_bed', name: 'Tanning bed', category: 'commercial', icon: '🌞', basePrice: 7000, description: 'A UV tanning bed. Goggles required, judgement optional.', requiresUtility: 'electric', runningCostMonthly: 80,
    rooms: ['salon'], tags: ['salon', 'tanning', 'vanity'], durabilityUses: 50000, repairCost: 500,
    interactions: [
      act({ id: 'tan', label: 'Tan for 12 minutes', category: 'needs', icon: '🌞', durationMinutes: 15, cost: 14, effects: { needs: { comfort: 8, fun: 6 }, health: -0.3, custom: [cx('health:tan', { minutes: 12 })], moodlets: [mood('confident', 'Bronzed', 4, 2880)] }, minStage: YA, autonomyWeight: 0.03, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true }, dirtiesBy: 4, group: 'Tan' }),
      act({ id: 'spray_tan', label: 'Get a spray tan', category: 'needs', icon: '🧴', durationMinutes: 20, cost: 40, effects: { needs: { fun: 6, hygiene: -4 }, moodlets: [mood('confident', 'Spray tan', 4, 4320)] }, minStage: TEEN, autonomyWeight: 0.02, group: 'Tan' }),
      act({ id: 'wipe', label: 'Wipe down the bed', category: 'chores', icon: '🧽', durationMinutes: 4, effects: { custom: [cx('chore:clean', { amount: 30, target: 'object' })] }, autonomyWeight: 0.1, group: 'Chores' }),
    ],
  }),
);

// =====================================================================================
// COMMERCIAL — medical & vet
// =====================================================================================
add(
  def({
    id: 'exam_table', name: 'Exam table', category: 'medical', icon: '🩺', basePrice: 2500, description: 'A paper-covered exam table. The gown opens in the back.',
    rooms: ['exam_room'], tags: ['clinic', 'hospital', 'health', 'medical'], durabilityUses: 100000, repairCost: 200,
    interactions: [
      act({ id: 'checkup', label: 'Get examined', category: 'health', icon: '🩺', durationMinutes: 30, cost: 150, effects: { needs: { comfort: -4 }, stress: -4, custom: [cx('health:checkup', { kind: 'physical' })], skills: { medicine: 2 } }, autonomyWeight: 0.2, llm: 'narrate', requiresState: { unoccupied: true }, setsState: { occupied: true }, dirtiesBy: 5, group: 'Care' }),
      act({ id: 'urgent_visit', label: 'Urgent care visit', category: 'health', icon: '🚑', durationMinutes: 45, cost: 175, effects: { needs: { comfort: -6 }, stress: -8, health: 1, custom: [cx('health:checkup', { kind: 'urgent' })] }, autonomyWeight: 0.2, llm: 'narrate', requiresState: { unoccupied: true }, setsState: { occupied: true }, dirtiesBy: 6, group: 'Care' }),
      act({ id: 'get_prescription', label: 'Ask about a prescription', category: 'health', icon: '📝', durationMinutes: 15, cost: 0, effects: { custom: [cx('health:checkup', { kind: 'prescription' })], needs: { social: 3 } }, autonomyWeight: 0.05, llm: 'narrate', group: 'Care' }),
      act({ id: 'vaccine', label: 'Get a vaccine', category: 'health', icon: '💉', durationMinutes: 15, cost: 25, effects: { health: 1, needs: { comfort: -5 }, custom: [cx('health:vaccine', { kind: 'routine' })] }, autonomyWeight: 0.05, group: 'Care' }),
      act({ id: 'blood_work', label: 'Get blood work done', category: 'health', icon: '🩸', durationMinutes: 20, cost: 90, effects: { needs: { comfort: -8, energy: -3 }, custom: [cx('health:checkup', { kind: 'lab' })] }, autonomyWeight: 0.03, group: 'Care' }),
      act({ id: 'prenatal', label: 'Prenatal checkup', category: 'health', icon: '🤰', durationMinutes: 40, cost: 120, effects: { stress: -6, custom: [cx('health:checkup', { kind: 'prenatal' })], moodlets: [mood('hopeful', 'Heard the heartbeat', 5, 480)] }, minStage: YA, autonomyWeight: 0.03, llm: 'narrate', group: 'Care' }),
      workTask('see_patients', 'See patients', 'desk', 480, { icon: '🩺', skills: { medicine: 14, charisma: 4 }, energy: -26, stress: 16 }),
    ],
  }),
  def({
    id: 'hospital_bed', name: 'Hospital bed', category: 'medical', icon: '🛏️', basePrice: 6000, description: 'An adjustable hospital bed with rails, an IV pole and a call button.', requiresUtility: 'electric',
    rooms: ['ward'], tags: ['hospital', 'health', 'medical', 'recovery'], durabilityUses: 100000, repairCost: 500,
    interactions: [
      act({ id: 'rest', label: 'Rest and recover', category: 'health', icon: '🛏️', durationMinutes: 240, effects: { perMinute: { energy: 0.22, comfort: 0.05 }, health: 3, stress: -4, custom: [cx('health:hospital_rest', { minutes: 240 })] }, satisfies: ['energy'], autonomyWeight: 0.3, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Recover' }),
      act({ id: 'sleep', label: 'Sleep overnight', category: 'needs', icon: '😴', durationMinutes: 480, effects: { perMinute: { energy: 0.24 }, needs: { comfort: -6, bladder: -10 }, health: 5, custom: [cx('health:hospital_rest', { minutes: 480 }), cx('health:sleep', { minutes: 480, quality: 0.6 })], moodlets: [mood('uncomfortable', 'Hospital night', -3, 480)] }, satisfies: ['energy'], autonomyWeight: 0.6, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Recover' }),
      act({ id: 'call_nurse', label: 'Press the call button', category: 'health', icon: '🔔', durationMinutes: 10, effects: { needs: { comfort: 8, social: 4 }, health: 0.3 }, autonomyWeight: 0.1, llm: 'narrate', group: 'Recover' }),
      act({ id: 'hospital_tv', label: 'Watch hospital TV', category: 'entertainment', icon: '📺', durationMinutes: 60, effects: { perMinute: { fun: 0.2 } }, satisfies: ['fun'], autonomyWeight: 0.3, group: 'Recover' }),
      act({ id: 'hospital_meal', label: 'Eat the hospital meal', category: 'needs', icon: '🍽️', durationMinutes: 20, effects: { needs: { hunger: 40, fun: -3 } }, satisfies: ['hunger'], autonomyWeight: 0.8, group: 'Recover' }),
      act({ id: 'visit_patient', label: 'Visit a patient', category: 'social', icon: '💐', durationMinutes: 40, effects: { needs: { social: 16 }, stress: 2, moodlets: [mood('grateful', 'Visited someone', 3, 240)] }, satisfies: ['social'], autonomyWeight: 0.1, llm: 'narrate', group: 'Social' }),
    ],
  }),
  def({
    id: 'waiting_room_chair', name: 'Waiting room chair', category: 'commercial', icon: '🪑', basePrice: 180, description: 'A vinyl chair under a TV playing daytime talk shows. Magazines from 2019.',
    rooms: ['waiting'], tags: ['clinic', 'hospital', 'office', 'seating', 'waiting'], durabilityUses: 100000,
    interactions: [
      act({ id: 'wait', label: 'Wait to be called', category: 'needs', icon: '⏳', durationMinutes: 30, effects: { perMinute: { comfort: 0.03, fun: -0.05 }, stress: 3 }, autonomyWeight: 0.3, group: 'Wait' }),
      act({ id: 'fill_forms', label: 'Fill out intake forms', category: 'health', icon: '📋', durationMinutes: 12, effects: { needs: { fun: -3 }, stress: 2, flags: { intake_done: true } }, autonomyWeight: 0.2, group: 'Wait' }),
      act({ id: 'scroll', label: 'Scroll your phone', category: 'phone', icon: '📱', durationMinutes: 20, effects: { perMinute: { fun: 0.22 }, custom: [cx('entertainment:social_media', { action: 'scroll' })] }, satisfies: ['fun'], autonomyWeight: 0.5, group: 'Wait' }),
      act({ id: 'old_magazine', label: 'Read an old magazine', category: 'entertainment', icon: '📰', durationMinutes: 15, effects: { needs: { fun: 4 }, skills: { research: 1 } }, autonomyWeight: 0.2, group: 'Wait' }),
    ],
  }),
  def({
    id: 'dental_chair', name: 'Dental chair', category: 'medical', icon: '🦷', basePrice: 18000, description: 'A reclining dental chair with a light in your eyes and a suction tube.', requiresUtility: 'electric',
    rooms: ['operatory'], tags: ['dentist', 'health', 'medical'], durabilityUses: 100000, repairCost: 1200,
    interactions: [
      act({ id: 'cleaning', label: 'Get a cleaning', category: 'health', icon: '🦷', durationMinutes: 45, cost: 120, effects: { needs: { comfort: -10, hygiene: 8 }, health: 0.6, custom: [cx('health:checkup', { kind: 'dental' })], moodlets: [mood('confident', 'Clean teeth', 3, 720)] }, autonomyWeight: 0.08, llm: 'narrate', requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Dental' }),
      act({ id: 'filling', label: 'Get a filling', category: 'health', icon: '🪥', durationMinutes: 60, cost: 220, effects: { needs: { comfort: -22, hunger: -5 }, health: 1, stress: 6, custom: [cx('health:checkup', { kind: 'dental_procedure' })], moodlets: [mood('uncomfortable', 'Numb face', -3, 180)] }, autonomyWeight: 0.03, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Dental' }),
      act({ id: 'whitening', label: 'Teeth whitening', category: 'needs', icon: '✨', durationMinutes: 60, cost: 350, effects: { needs: { comfort: -10, fun: 6 }, moodlets: [mood('confident', 'Bright smile', 6, 4320)] }, minStage: YA, autonomyWeight: 0.01, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Dental' }),
      workTask('work_dental', 'Work on patients', 'desk', 480, { icon: '🦷', skills: { medicine: 10 }, energy: -20, stress: 10 }),
    ],
  }),
  def({
    id: 'xray_machine', name: 'X-ray machine', category: 'medical', icon: '🩻', basePrice: 90000, description: 'A radiography suite. Hold still, hold your breath.', requiresUtility: 'electric', runningCostMonthly: 400,
    rooms: ['imaging'], tags: ['hospital', 'clinic', 'health', 'medical', 'imaging'], durabilityUses: 200000, repairCost: 5000,
    interactions: [
      act({ id: 'xray', label: 'Get an X-ray', category: 'health', icon: '🩻', durationMinutes: 20, cost: 260, effects: { needs: { comfort: -4 }, custom: [cx('health:checkup', { kind: 'xray' })] }, autonomyWeight: 0.05, requiresState: { notBroken: true }, group: 'Imaging' }),
      act({ id: 'mri', label: 'Get an MRI', category: 'health', icon: '🧲', durationMinutes: 50, cost: 900, effects: { needs: { comfort: -14, fun: -6 }, stress: 6, custom: [cx('health:checkup', { kind: 'mri' })] }, autonomyWeight: 0.02, requiresState: { notBroken: true }, group: 'Imaging' }),
      workTask('run_imaging', 'Run imaging', 'lab', 480, { icon: '🩻', skills: { medicine: 10, logic: 4 } }),
    ],
  }),
  def({
    id: 'vet_exam_table', name: 'Vet exam table', category: 'medical', icon: '🐾', basePrice: 2200, description: 'A steel table with a scale. Treats in the drawer, fur on the floor.',
    rooms: ['exam_room'], tags: ['vet', 'pet', 'health'], durabilityUses: 100000, repairCost: 200,
    interactions: [
      act({ id: 'pet_checkup', label: 'Pet wellness exam', category: 'pet', icon: '🐾', durationMinutes: 30, cost: 75, effects: { needs: { social: 4 }, stress: -3, custom: [cx('pet:vet_exam', { kind: 'wellness' })] }, autonomyWeight: 0.1, llm: 'narrate', group: 'Vet' }),
      act({ id: 'pet_vaccines', label: 'Pet vaccinations', category: 'pet', icon: '💉', durationMinutes: 20, cost: 60, effects: { custom: [cx('pet:vet_exam', { kind: 'vaccines' })] }, autonomyWeight: 0.05, group: 'Vet' }),
      act({ id: 'pet_sick_visit', label: 'Sick pet visit', category: 'pet', icon: '🤒', durationMinutes: 40, cost: 140, effects: { stress: 4, custom: [cx('pet:vet_exam', { kind: 'sick' })] }, autonomyWeight: 0.1, llm: 'narrate', group: 'Vet' }),
      act({ id: 'spay_neuter', label: 'Schedule spay/neuter', category: 'pet', icon: '🏥', durationMinutes: 15, cost: 250, effects: { custom: [cx('pet:vet_exam', { kind: 'spay_neuter' })] }, autonomyWeight: 0.02, group: 'Vet' }),
      act({ id: 'microchip', label: 'Microchip your pet', category: 'pet', icon: '📡', durationMinutes: 10, cost: 45, effects: { custom: [cx('pet:vet_exam', { kind: 'microchip' })], stress: -2 }, autonomyWeight: 0.02, group: 'Vet' }),
      workTask('vet_shift', 'See animal patients', 'desk', 480, { icon: '🐾', skills: { medicine: 12, charisma: 4 }, energy: -24, hygiene: -14, stress: 12 }),
    ],
  }),
  def({
    id: 'pet_kennel', name: 'Boarding kennel', category: 'commercial', icon: '🏠', basePrice: 1500, description: 'A row of kennels for boarding. Barking in stereo.',
    rooms: ['kennels'], tags: ['vet', 'pet', 'boarding'], durabilityUses: 100000, repairCost: 150, ambient: { noise: 5 },
    interactions: [
      act({ id: 'board_pet', label: 'Board your pet', category: 'pet', icon: '🧳', durationMinutes: 15, cost: 45, effects: { custom: [cx('pet:board', { action: 'dropoff', nightly: 45 })], stress: 3, moodlets: [mood('guilty', 'Left the pet at the kennel', -2, 480)] }, autonomyWeight: 0.02, group: 'Boarding' }),
      act({ id: 'pickup_pet', label: 'Pick up your pet', category: 'pet', icon: '🐕', durationMinutes: 15, effects: { custom: [cx('pet:board', { action: 'pickup' })], needs: { social: 8, fun: 8 }, moodlets: [mood('happy', 'Reunited', 5, 240)] }, autonomyWeight: 0.05, group: 'Boarding' }),
      act({ id: 'daycare_dropoff', label: 'Doggy daycare drop-off', category: 'pet', icon: '🎾', durationMinutes: 10, cost: 32, effects: { custom: [cx('pet:board', { action: 'daycare' })] }, autonomyWeight: 0.02, group: 'Boarding' }),
      workTask('kennel_shift', 'Care for boarded animals', 'warehouse', 300, { icon: '🐾', skills: { parenting: 2 }, hygiene: -20, energy: -18, fun: 4 }),
    ],
  }),
  def({
    id: 'adoption_pen', name: 'Adoption pen', category: 'commercial', icon: '🐶', basePrice: 800, description: 'A pen of adoptable animals with laminated bios. Resistance is futile.',
    rooms: ['adoption'], tags: ['shelter', 'pet_store', 'pet', 'adoption'], durabilityUses: 100000, ambient: { fun: 3 },
    interactions: [
      act({ id: 'meet_animals', label: 'Meet the animals', category: 'pet', icon: '🐾', durationMinutes: 25, effects: { needs: { fun: 14, social: 8 }, stress: -8, moodlets: [mood('happy', 'Puppy time', 4, 180)] }, satisfies: ['fun'], autonomyWeight: 0.2, llm: 'narrate', group: 'Adopt' }),
      act({ id: 'adopt_dog', label: 'Adopt a dog', category: 'pet', icon: '🐕', durationMinutes: 60, cost: 150, effects: { custom: [cx('pet:adopt', { species: 'dog' })], needs: { fun: 20, social: 10 }, moodlets: [mood('in_love', 'New family member', 10, 2880)] }, minStage: YA, autonomyWeight: 0.01, llm: 'narrate', group: 'Adopt' }),
      act({ id: 'adopt_cat', label: 'Adopt a cat', category: 'pet', icon: '🐈', durationMinutes: 45, cost: 90, effects: { custom: [cx('pet:adopt', { species: 'cat' })], needs: { fun: 18, social: 8 }, moodlets: [mood('in_love', 'New family member', 10, 2880)] }, minStage: YA, autonomyWeight: 0.01, llm: 'narrate', group: 'Adopt' }),
      act({ id: 'adopt_small', label: 'Adopt a small pet', category: 'pet', icon: '🐹', durationMinutes: 30, cost: 35, effects: { custom: [cx('pet:adopt', { species: 'hamster' })], needs: { fun: 12 }, moodlets: [mood('happy', 'Tiny new friend', 6, 1440)] }, minStage: TEEN, autonomyWeight: 0.01, group: 'Adopt' }),
      act({ id: 'volunteer', label: 'Volunteer at the shelter', category: 'civic', icon: '🤝', durationMinutes: 180, effects: { needs: { fun: 14, social: 14, hygiene: -16, energy: -14 }, stress: -8, custom: [cx('civic:volunteer', { kind: 'shelter', minutes: 180 })], moodlets: [mood('grateful', 'Helped the animals', 5, 480)] }, minStage: TEEN, autonomyWeight: 0.05, group: 'Adopt' }),
    ],
  }),
);

// =====================================================================================
// COMMERCIAL — education & library
// =====================================================================================
add(
  def({
    id: 'library_shelf', name: 'Library stacks', category: 'commercial', icon: '📚', basePrice: 2000, description: 'Rows of shelves under fluorescent hum. Dewey decimal, nobody remembers how.',
    rooms: ['stacks'], tags: ['library', 'books', 'reading', 'quiet', 'free'], durabilityUses: 1000000, ambient: { environment: 2 },
    interactions: [
      act({ id: 'browse_read', label: 'Browse and read', category: 'hobby', icon: '📖', durationMinutes: 60, effects: { perMinute: { fun: 0.2 }, skills: { research: 12, writing: 4 }, stress: -8, moodlets: [mood('relaxed', 'Library quiet', 3, 180)] }, satisfies: ['fun'], autonomyWeight: 0.5, group: 'Library' }),
      act({ id: 'borrow_book', label: 'Borrow a book', category: 'hobby', icon: '🎫', durationMinutes: 10, effects: { items: [{ op: 'gain', itemId: 'book_novel', qty: 1 }], custom: [cx('amenity:borrow_book', { itemId: 'book_novel' })], needs: { fun: 4 } }, autonomyWeight: 0.3, group: 'Library' }),
      act({ id: 'return_book', label: 'Return a book', category: 'hobby', icon: '↩️', durationMinutes: 5, consumes: [{ itemId: 'book_novel', qty: 1 }], effects: { custom: [cx('amenity:return_book', { itemId: 'book_novel' })], stress: -1 }, autonomyWeight: 0.2, group: 'Library' }),
      act({ id: 'research', label: 'Research a topic', category: 'school', icon: '🔬', durationMinutes: 90, effects: { skills: { research: 30, logic: 10 }, needs: { fun: -2, energy: -5 }, custom: [cx('education:research', { minutes: 90 })], moodlets: [mood('focused', 'Deep research', 3, 120)] }, minStage: CHILD, autonomyWeight: 0.2, group: 'Library' }),
      act({ id: 'learn_skill_book', label: 'Study a how-to book', category: 'hobby', icon: '🛠️', durationMinutes: 60, effects: { skills: { handiness: 10, cooking: 6, gardening: 4, finance: 4 }, needs: { fun: 2 } }, autonomyWeight: 0.15, group: 'Library' }),
      act({ id: 'story_time', label: 'Take a kid to story time', category: 'family', icon: '🧸', durationMinutes: 40, effects: { needs: { fun: 10, social: 12 }, skills: { parenting: 6 }, custom: [cx('family:read_to_child', {})] }, minStage: YA, autonomyWeight: 0.05, group: 'Family' }),
      workTask('shelve_books', 'Shelve returns', 'desk', 240, { icon: '📚', skills: { research: 4 }, stress: -2, fun: -4 }),
    ],
  }),
  def({
    id: 'study_table', name: 'Study table', category: 'commercial', icon: '🪑', basePrice: 700, description: 'A long oak table with green lamps and outlets that mostly work.',
    rooms: ['reading_room'], tags: ['library', 'college', 'study', 'quiet', 'work'], durabilityUses: 1000000, ambient: { comfort: 1 },
    interactions: [
      act({ id: 'study', label: 'Study', category: 'school', icon: '📚', durationMinutes: 120, effects: { needs: { fun: -8, energy: -8 }, skills: { logic: 16, research: 16 }, stress: 4, custom: [cx('education:study', { minutes: 120 })], moodlets: [mood('focused', 'Study session', 3, 120)] }, minStage: CHILD, autonomyWeight: 0.5, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Study' }),
      act({ id: 'group_study', label: 'Study group', category: 'social', icon: '👥', durationMinutes: 120, effects: { needs: { fun: 4, social: 18, energy: -6 }, skills: { logic: 12, research: 12, charisma: 4 }, custom: [cx('education:study', { minutes: 120, group: true })] }, minStage: TEEN, satisfies: ['social'], autonomyWeight: 0.3, llm: 'narrate', group: 'Study' }),
      act({ id: 'homework', label: 'Do homework', category: 'school', icon: '✏️', durationMinutes: 60, effects: { needs: { fun: -6 }, skills: { logic: 10, research: 6 }, custom: [cx('education:homework', { minutes: 60 })] }, minStage: CHILD, autonomyWeight: 0.5, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Study' }),
      act({ id: 'work_remote', label: 'Work remotely', category: 'work', icon: '💼', durationMinutes: 240, effects: { needs: { energy: -14, fun: -6 }, stress: 6, custom: [cx('career:work_remote', { minutes: 240 })] }, requirements: [flagReq('remote_eligible', 'Your job is not remote')], minStage: YA, autonomyWeight: 0.3, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Work' }),
      act({ id: 'tutor', label: 'Tutor someone', category: 'work', icon: '🧑‍🏫', durationMinutes: 60, effects: { needs: { social: 12, energy: -6 }, skills: { charisma: 8, logic: 6 }, money: { amount: 40, memo: 'Tutoring' }, custom: [cx('education:tutor', { minutes: 60 }), cx('career:gig', { kind: 'tutoring' })] }, requirements: [skillReq('logic', 3)], minStage: TEEN, autonomyWeight: 0.05, llm: 'narrate', group: 'Work' }),
      act({ id: 'nap_on_books', label: 'Nap on your textbook', category: 'needs', icon: '💤', durationMinutes: 30, effects: { perMinute: { energy: 0.12 }, needs: { comfort: -4 }, custom: [cx('health:sleep', { minutes: 30, quality: 0.3 })] }, satisfies: ['energy'], autonomyWeight: 0.15, group: 'Study' }),
    ],
  }),
  def({
    id: 'reading_nook', name: 'Reading nook', category: 'commercial', icon: '🛋️', basePrice: 900, description: 'An armchair by a tall window with a view of the parking lot.',
    rooms: ['reading_room'], tags: ['library', 'bookstore', 'reading', 'quiet', 'seating'], durabilityUses: 500000, ambient: { comfort: 3 },
    interactions: [read(0.2, 60), sit('Curl up in the nook', 0.22, 0.1, 30), act({ id: 'doze', label: 'Doze off', category: 'needs', icon: '💤', durationMinutes: 30, effects: { perMinute: { energy: 0.14, comfort: 0.1 }, custom: [cx('health:sleep', { minutes: 30, quality: 0.5 })] }, satisfies: ['energy'], autonomyWeight: 0.2, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Rest' }), act({ id: 'magazines', label: 'Read the magazines', category: 'entertainment', icon: '📰', durationMinutes: 25, effects: { perMinute: { fun: 0.2 }, skills: { research: 3 } }, satisfies: ['fun'], autonomyWeight: 0.3, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Relax' })],
  }),
  def({
    id: 'computer_terminal', name: 'Public computer', category: 'commercial', icon: '🖥️', basePrice: 900, description: 'A public terminal with a 60-minute session limit and a sticky mouse.', requiresUtility: 'internet',
    rooms: ['computer_lab'], tags: ['library', 'computer', 'internet', 'free', 'job_search'], durabilityUses: 50000, repairCost: 150,
    interactions: [
      act({ id: 'browse', label: 'Use the internet', category: 'entertainment', icon: '🌐', durationMinutes: 45, effects: { perMinute: { fun: 0.25 }, skills: { research: 4 } }, satisfies: ['fun'], autonomyWeight: 0.4, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true }, group: 'Computer' }),
      act({ id: 'job_search', label: 'Search for jobs', category: 'work', icon: '🔎', durationMinutes: 45, effects: { needs: { fun: -3 }, stress: 3, custom: [cx('career:job_search', { via: 'library' })] }, minStage: TEEN, autonomyWeight: 0.4, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true }, group: 'Computer' }),
      act({ id: 'apply_benefits', label: 'Apply for benefits online', category: 'finance', icon: '📝', durationMinutes: 60, effects: { needs: { fun: -8 }, stress: 8, skills: { finance: 4 }, custom: [cx('finance:consult', { pro: 'benefits_portal' })] }, minStage: YA, autonomyWeight: 0.1, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true }, group: 'Computer' }),
      act({ id: 'print_resume', label: 'Print your résumé', category: 'work', icon: '🖨️', durationMinutes: 10, cost: 1, effects: { custom: [cx('career:print', { pages: 2, what: 'resume' })], flags: { has_resume: true } }, minStage: TEEN, autonomyWeight: 0.1, group: 'Computer' }),
      act({ id: 'pay_bills', label: 'Pay bills online', category: 'finance', icon: '💳', durationMinutes: 15, effects: { custom: [cx('finance:pay_bills', { via: 'computer' })], stress: -3 }, minStage: TEEN, autonomyWeight: 0.2, requiresState: { notBroken: true }, group: 'Computer' }),
      act({ id: 'online_course', label: 'Take a free online course', category: 'school', icon: '🎓', durationMinutes: 60, effects: { skills: { programming: 8, research: 8, logic: 6 }, custom: [cx('education:study', { minutes: 60, subject: 'online' })] }, minStage: TEEN, autonomyWeight: 0.15, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true }, group: 'Computer' }),
    ],
  }),
  def({
    id: 'lecture_hall_seat', name: 'Lecture hall seat', category: 'commercial', icon: '🎓', basePrice: 250, description: 'A fold-down seat with a tiny desk. The back row is for sleeping.',
    rooms: ['lecture_hall'], tags: ['college', 'school', 'seating', 'lecture'], durabilityUses: 500000,
    interactions: [
      act({ id: 'attend_lecture', label: 'Attend the lecture', category: 'school', icon: '🎓', durationMinutes: 75, effects: { needs: { fun: -6, energy: -6, comfort: -4 }, skills: { logic: 12, research: 12 }, stress: 2, custom: [cx('education:lecture', { minutes: 75 })] }, minStage: TEEN, autonomyWeight: 0.6, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Class' }),
      act({ id: 'take_notes', label: 'Take careful notes', category: 'school', icon: '📝', durationMinutes: 75, effects: { needs: { fun: -8, energy: -8 }, skills: { logic: 16, research: 16, writing: 6 }, stress: 3, custom: [cx('education:lecture', { minutes: 75, engaged: true })], moodlets: [mood('focused', 'Good notes', 3, 180)] }, minStage: TEEN, autonomyWeight: 0.3, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Class' }),
      act({ id: 'sleep_in_back', label: 'Doze in the back row', category: 'needs', icon: '💤', durationMinutes: 75, effects: { perMinute: { energy: 0.12 }, skills: { logic: 2 }, custom: [cx('education:lecture', { minutes: 75, engaged: false }), cx('health:sleep', { minutes: 75, quality: 0.3 })] }, minStage: TEEN, satisfies: ['energy'], autonomyWeight: 0.15, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Class' }),
      act({ id: 'ask_question', label: 'Ask the professor a question', category: 'school', icon: '🙋', durationMinutes: 5, effects: { needs: { social: 4 }, skills: { charisma: 4, logic: 4 }, custom: [cx('education:lecture', { minutes: 5, engaged: true })] }, minStage: TEEN, autonomyWeight: 0.1, llm: 'narrate', group: 'Class' }),
      workTask('give_lecture', 'Give the lecture', 'classroom', 75, { icon: '🧑‍🏫', skills: { charisma: 10, research: 6 }, energy: -10, stress: 8 }),
    ],
  }),
  def({
    id: 'classroom_desk', name: 'Classroom desk', category: 'commercial', icon: '🏫', basePrice: 120, description: 'A desk-chair combo with gum underneath and initials carved on top.',
    rooms: ['classroom'], tags: ['school', 'seating', 'kids', 'teen'], durabilityUses: 500000,
    interactions: [
      act({ id: 'attend_class', label: 'Attend class', category: 'school', icon: '🏫', durationMinutes: 50, effects: { needs: { fun: -5, comfort: -3 }, skills: { logic: 8, research: 6, writing: 4 }, custom: [cx('education:lecture', { minutes: 50, level: 'k12' })] }, minStage: CHILD, autonomyWeight: 0.6, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Class' }),
      act({ id: 'pay_attention', label: 'Really pay attention', category: 'school', icon: '🧠', durationMinutes: 50, effects: { needs: { fun: -8 }, skills: { logic: 12, research: 10, writing: 6 }, custom: [cx('education:lecture', { minutes: 50, level: 'k12', engaged: true })] }, minStage: CHILD, autonomyWeight: 0.3, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Class' }),
      act({ id: 'pass_notes', label: 'Pass notes', category: 'social', icon: '📝', durationMinutes: 10, effects: { needs: { fun: 8, social: 8 } }, outcomes: { outcomes: [{ weight: 7, label: 'Got away with it', effects: {} }, { weight: 3, label: 'Caught', effects: { stress: 6, moodlets: [mood('embarrassed', 'Caught passing notes', -3, 120)] } }] }, minStage: CHILD, autonomyWeight: 0.1, llm: 'narrate', group: 'Class' }),
      act({ id: 'doodle', label: 'Doodle in the margins', category: 'hobby', icon: '✏️', durationMinutes: 20, effects: { needs: { fun: 6 }, skills: { creativity: 6, painting: 3 } }, minStage: CHILD, autonomyWeight: 0.15, group: 'Class' }),
      act({ id: 'take_test', label: 'Take a test', category: 'school', icon: '📄', durationMinutes: 50, effects: { needs: { fun: -10 }, stress: 12, custom: [cx('education:lecture', { minutes: 50, level: 'k12', exam: true })] }, minStage: CHILD, autonomyWeight: 0.05, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Class' }),
      workTask('teach_class', 'Teach the class', 'classroom', 50, { icon: '🧑‍🏫', skills: { charisma: 6, parenting: 2 }, energy: -8, stress: 8 }),
    ],
  }),
  def({
    id: 'whiteboard', name: 'Whiteboard', category: 'office', icon: '🧑‍🏫', basePrice: 220, description: 'A whiteboard with the ghost of a permanent-marker diagram.',
    rooms: ['classroom', 'conference', 'office'], tags: ['school', 'office', 'teaching', 'planning'], durabilityUses: 500000, portable: true,
    interactions: [
      act({ id: 'brainstorm', label: 'Brainstorm on the board', category: 'work', icon: '💡', durationMinutes: 30, effects: { skills: { creativity: 10, logic: 8 }, needs: { fun: 6 }, custom: [cx('career:meeting', { kind: 'brainstorm' })] }, autonomyWeight: 0.1, group: 'Work' }),
      act({ id: 'work_problem', label: 'Work a problem on the board', category: 'school', icon: '🔢', durationMinutes: 25, effects: { skills: { logic: 14 }, needs: { fun: 2 }, stress: 2 }, minStage: CHILD, autonomyWeight: 0.1, group: 'Study' }),
      act({ id: 'teach', label: 'Teach at the board', category: 'work', icon: '🧑‍🏫', durationMinutes: 45, effects: { skills: { charisma: 10, logic: 4 }, needs: { social: 8, energy: -6 }, custom: [cx('career:work_task', { minutes: 45, kind: 'classroom' })] }, minStage: TEEN, autonomyWeight: 0.1, group: 'Work' }),
      act({ id: 'draw_on_board', label: 'Draw something silly', category: 'entertainment', icon: '🎨', durationMinutes: 5, effects: { needs: { fun: 6 }, skills: { creativity: 2 } }, autonomyWeight: 0.05, group: 'Fun' }),
      act({ id: 'erase', label: 'Erase the board', category: 'chores', icon: '🧽', durationMinutes: 3, effects: { custom: [cx('chore:clean', { amount: 20, target: 'object' })] }, autonomyWeight: 0.1, group: 'Chores' }),
    ],
  }),
  def({
    id: 'lab_bench', name: 'Lab bench', category: 'commercial', icon: '🧪', basePrice: 9000, description: 'A resin-topped bench with a fume hood, pipettes and a centrifuge.', requiresUtility: 'electric', runningCostMonthly: 200,
    rooms: ['lab'], tags: ['college', 'science', 'lab', 'work'], durabilityUses: 200000, repairCost: 600,
    interactions: [
      act({ id: 'run_experiment', label: 'Run an experiment', category: 'school', icon: '🧪', durationMinutes: 120, effects: { skills: { research: 24, logic: 16 }, needs: { fun: 4, energy: -8, hygiene: -4 }, custom: [cx('education:lab', { minutes: 120 })] }, outcomes: { outcomes: [{ weight: 5, label: 'Clean results', effects: { moodlets: [mood('proud', 'Good data', 4, 240)] }, skillId: 'research', skillBias: 2 }, { weight: 4, label: 'Inconclusive', effects: {} }, { weight: 1, label: 'Contaminated the sample', effects: { stress: 8, moodlets: [mood('embarrassed', 'Ruined the run', -3, 180)] } }] }, minStage: TEEN, autonomyWeight: 0.2, requiresState: { unoccupied: true, notBroken: true }, setsState: { occupied: true }, dirtiesBy: 6, group: 'Lab' }),
      act({ id: 'lab_class', label: 'Attend lab section', category: 'school', icon: '🥽', durationMinutes: 150, effects: { skills: { research: 20, logic: 12 }, needs: { fun: -4, energy: -10 }, custom: [cx('education:lab', { minutes: 150, class: true })] }, minStage: TEEN, autonomyWeight: 0.4, group: 'Lab' }),
      workTask('lab_shift', 'Work in the lab', 'lab', 480, { icon: '🔬', skills: { research: 14, logic: 8, medicine: 4 }, energy: -20, stress: 10 }),
      act({ id: 'clean_glassware', label: 'Clean the glassware', category: 'chores', icon: '🧽', durationMinutes: 20, effects: { needs: { fun: -3 }, custom: [cx('chore:clean', { amount: 30, target: 'object' })] }, autonomyWeight: 0.1, group: 'Chores' }),
    ],
  }),
  def({
    id: 'locker', name: 'Locker', category: 'commercial', icon: '🔐', basePrice: 150, description: 'A metal locker with a combination you\'ll forget by spring.',
    rooms: ['hallway', 'locker_room'], tags: ['school', 'gym', 'storage'], durabilityUses: 500000,
    interactions: [
      act({ id: 'stash_stuff', label: 'Stash your stuff', category: 'object', icon: '🎒', durationMinutes: 2, effects: { needs: { comfort: 3 } }, autonomyWeight: 0.2, group: 'Locker' }),
      act({ id: 'change_clothes', label: 'Change clothes', category: 'needs', icon: '👕', durationMinutes: 5, effects: { flags: { outfit: 'athletic' }, needs: { hygiene: 2 } }, autonomyWeight: 0.2, group: 'Locker' }),
      act({ id: 'freshen_up', label: 'Freshen up with deodorant', category: 'needs', icon: '🧴', durationMinutes: 3, consumes: [{ itemId: 'deodorant', qty: 1 }], effects: { needs: { hygiene: 8 }, moodlets: [mood('confident', 'Fresh', 2, 240)] }, satisfies: ['hygiene'], autonomyWeight: 0.3, group: 'Locker' }),
      act({ id: 'hallway_chat', label: 'Hang out by the lockers', category: 'social', icon: '💬', durationMinutes: 10, effects: { needs: { social: 10, fun: 6 } }, minStage: CHILD, satisfies: ['social'], autonomyWeight: 0.3, llm: 'narrate', group: 'Social' }),
      act({ id: 'forgot_combo', label: 'Try to remember the combination', category: 'object', icon: '🤔', durationMinutes: 3, effects: {}, outcomes: { outcomes: [{ weight: 8, label: 'Got it', effects: {} }, { weight: 2, label: 'Nope', effects: { stress: 4, moodlets: [mood('embarrassed', 'Locked out of your locker', -2, 60)] } }] }, autonomyWeight: 0.02, group: 'Locker' }),
    ],
  }),
  def({
    id: 'school_cafeteria_table', name: 'Cafeteria table', category: 'commercial', icon: '🍱', basePrice: 500, description: 'A long fold-up table with attached round stools. Social hierarchy visible from space.',
    rooms: ['cafeteria'], tags: ['school', 'food', 'seating', 'social', 'kids', 'teen'], durabilityUses: 500000,
    interactions: [
      act({ id: 'school_lunch', label: 'Eat school lunch', category: 'needs', icon: '🍱', durationMinutes: 25, cost: 3.25, effects: { needs: { hunger: 42, social: 8, fun: 2 } }, satisfies: ['hunger'], autonomyWeight: 1.4, minStage: CHILD, group: 'Eat' }),
      act({ id: 'packed_lunch', label: 'Eat your packed lunch', category: 'needs', icon: '🥪', durationMinutes: 20, consumes: [{ itemId: 'sandwich', qty: 1 }], effects: { needs: { hunger: 36, social: 6 } }, satisfies: ['hunger'], autonomyWeight: 1.3, minStage: CHILD, group: 'Eat' }),
      act({ id: 'sit_with_friends', label: 'Sit with friends', category: 'social', icon: '👥', durationMinutes: 25, effects: { needs: { social: 16, fun: 10 } }, minStage: CHILD, satisfies: ['social'], autonomyWeight: 0.6, llm: 'narrate', group: 'Social' }),
      act({ id: 'trade_snacks', label: 'Trade snacks', category: 'social', icon: '🔄', durationMinutes: 5, effects: { needs: { fun: 5, social: 5, hunger: 5 }, skills: { negotiation: 4 } }, minStage: CHILD, autonomyWeight: 0.2, group: 'Social' }),
      act({ id: 'sit_alone', label: 'Sit alone and eat', category: 'needs', icon: '🍽️', durationMinutes: 20, cost: 3.25, effects: { needs: { hunger: 40 }, moodlets: [mood('lonely', 'Ate alone', -2, 120)] }, satisfies: ['hunger'], minStage: CHILD, autonomyWeight: 0.2, group: 'Eat' }),
      workTask('serve_lunch', 'Serve lunch', 'kitchen', 180, { icon: '🥄', hygiene: -10, fun: -4 }),
    ],
  }),
  def({
    id: 'daycare_playmat', name: 'Daycare play mat', category: 'commercial', icon: '🧩', basePrice: 400, description: 'A foam alphabet mat covered in blocks, board books and one very loud toy.',
    rooms: ['playroom'], tags: ['daycare', 'kids', 'toddler', 'family'], durabilityUses: 100000, ambient: { fun: 2, noise: 4 },
    interactions: [
      act({ id: 'dropoff', label: 'Drop off your child', category: 'family', icon: '👋', durationMinutes: 10, effects: { custom: [cx('education:daycare', { action: 'dropoff' })], stress: -2, moodlets: [mood('guilty', 'Daycare drop-off', -1, 120)] }, minStage: YA, autonomyWeight: 0.3, group: 'Daycare' }),
      act({ id: 'pickup', label: 'Pick up your child', category: 'family', icon: '🤗', durationMinutes: 10, effects: { custom: [cx('education:daycare', { action: 'pickup' })], needs: { social: 8 }, moodlets: [mood('happy', 'Reunited with the kiddo', 4, 180)] }, minStage: YA, autonomyWeight: 0.3, group: 'Daycare' }),
      act({ id: 'play', label: 'Play on the mat', category: 'entertainment', icon: '🧸', durationMinutes: 45, effects: { perMinute: { fun: 0.45 }, needs: { social: 12 }, skills: { creativity: 6 } }, satisfies: ['fun', 'social'], autonomyWeight: 1, group: 'Play' }),
      act({ id: 'circle_time', label: 'Circle time', category: 'school', icon: '🎵', durationMinutes: 30, effects: { needs: { fun: 12, social: 12 }, skills: { singing: 4, logic: 4 } }, autonomyWeight: 0.5, group: 'Play' }),
      act({ id: 'nap_time', label: 'Nap time', category: 'needs', icon: '💤', durationMinutes: 90, effects: { perMinute: { energy: 0.25 }, custom: [cx('health:sleep', { minutes: 90, quality: 0.7 })] }, satisfies: ['energy'], autonomyWeight: 0.8, group: 'Rest' }),
      workTask('watch_kids', 'Watch the kids', 'classroom', 480, { icon: '🧑‍🍼', skills: { parenting: 14, charisma: 4 }, energy: -26, hygiene: -14, stress: 14, fun: 2 }),
    ],
  }),
);

// =====================================================================================
// COMMERCIAL — office & industrial work
// =====================================================================================
add(
  def({
    id: 'office_desk', name: 'Office desk', category: 'office', icon: '🖥️', basePrice: 600, description: 'An adjustable desk with two monitors, a headset and a dying succulent.', requiresUtility: 'internet',
    rooms: ['open_office', 'office'], tags: ['office', 'work', 'desk'], durabilityUses: 200000,
    interactions: [
      workTask('work_shift', 'Work', 'desk', 480, { icon: '💼', skills: { logic: 6, writing: 4 }, energy: -22, stress: 14, description: 'Emails, spreadsheets, meetings, repeat.' }),
      workTask('work_half', 'Work a half day', 'desk', 240, { icon: '💼', skills: { logic: 3, writing: 2 }, energy: -12, stress: 7 }),
      workTask('overtime', 'Stay late', 'desk', 120, { icon: '🌙', skills: { logic: 3 }, energy: -14, stress: 12, fun: -10, description: 'Get ahead. Or just look like it.' }),
      act({ id: 'slack_off', label: 'Slack off at your desk', category: 'entertainment', icon: '🙈', durationMinutes: 30, effects: { perMinute: { fun: 0.3 }, stress: -4, custom: [cx('career:work_task', { minutes: 30, kind: 'slack' })] }, outcomes: { outcomes: [{ weight: 8, label: 'Nobody noticed', effects: {} }, { weight: 2, label: 'Boss walked by', effects: { stress: 8, moodlets: [mood('embarrassed', 'Caught slacking', -3, 180)] } }] }, satisfies: ['fun'], autonomyWeight: 0.15, group: 'Work' }),
      act({ id: 'desk_lunch', label: 'Eat lunch at your desk', category: 'needs', icon: '🥗', durationMinutes: 20, consumes: [{ itemId: 'sandwich', qty: 1 }], effects: { needs: { hunger: 35, fun: -2 } }, satisfies: ['hunger'], autonomyWeight: 1, group: 'Work' }),
      act({ id: 'organize_desk', label: 'Tidy your desk', category: 'chores', icon: '🗂️', durationMinutes: 10, effects: { stress: -3, custom: [cx('chore:clean', { amount: 15, target: 'object' })] }, autonomyWeight: 0.1, group: 'Chores' }),
    ],
  }),
  def({
    id: 'conference_table', name: 'Conference table', category: 'office', icon: '🗣️', basePrice: 2500, description: 'A long glass table, a speakerphone octopus, and a screen that won\'t connect.',
    rooms: ['conference'], tags: ['office', 'work', 'meeting'], durabilityUses: 200000,
    interactions: [
      act({ id: 'meeting', label: 'Sit in a meeting', category: 'work', icon: '🗣️', durationMinutes: 60, effects: { needs: { fun: -8, social: 6, energy: -4 }, stress: 5, skills: { charisma: 3 }, custom: [cx('career:meeting', { kind: 'status' })], moodlets: [mood('bored', 'Could\'ve been an email', -2, 120)] }, minStage: YA, autonomyWeight: 0.3, group: 'Work' }),
      act({ id: 'present', label: 'Give a presentation', category: 'work', icon: '📊', durationMinutes: 45, effects: { needs: { energy: -8, social: 8 }, stress: 12, skills: { charisma: 16, negotiation: 6 }, custom: [cx('career:meeting', { kind: 'presentation' })] }, outcomes: { outcomes: [{ weight: 5, label: 'Nailed it', effects: { moodlets: [mood('proud', 'Great presentation', 6, 480)], custom: [cx('career:meeting', { kind: 'presentation', result: 'great' })] }, skillId: 'charisma', skillBias: 3 }, { weight: 4, label: 'Fine', effects: {} }, { weight: 2, label: 'Slides crashed', effects: { stress: 10, moodlets: [mood('embarrassed', 'Presentation bombed', -5, 240)] } }] }, minStage: YA, autonomyWeight: 0.1, llm: 'narrate', group: 'Work' }),
      act({ id: 'negotiate', label: 'Negotiate a deal', category: 'work', icon: '🤝', durationMinutes: 90, effects: { needs: { energy: -10 }, stress: 14, skills: { negotiation: 24, charisma: 8 }, custom: [cx('career:meeting', { kind: 'negotiation' })] }, minStage: YA, autonomyWeight: 0.05, llm: 'adjudicate', group: 'Work' }),
      act({ id: 'interview', label: 'Job interview', category: 'work', icon: '🎤', durationMinutes: 45, effects: { stress: 16, skills: { charisma: 10 }, custom: [cx('career:meeting', { kind: 'interview' })] }, minStage: TEEN, autonomyWeight: 0.02, llm: 'adjudicate', group: 'Work' }),
      act({ id: 'eat_meeting_leftovers', label: 'Raid the leftover catering', category: 'needs', icon: '🥪', durationMinutes: 8, effects: { needs: { hunger: 25, fun: 4 } }, satisfies: ['hunger'], autonomyWeight: 0.4, group: 'Work' }),
    ],
  }),
  def({
    id: 'cubicle', name: 'Cubicle', category: 'office', icon: '🧱', basePrice: 1400, description: 'Three fabric walls, a pushpin calendar, and a photo of somebody\'s dog.', requiresUtility: 'internet',
    rooms: ['open_office'], tags: ['office', 'work', 'desk'], durabilityUses: 200000, ambient: { comfort: -1 },
    interactions: [
      workTask('work_shift', 'Work the day', 'desk', 480, { icon: '💼', skills: { logic: 5, writing: 3 }, energy: -22, stress: 14, fun: -20 }),
      act({ id: 'cubicle_chat', label: 'Chat over the cubicle wall', category: 'social', icon: '💬', durationMinutes: 10, effects: { needs: { social: 10, fun: 6 }, stress: -3 }, satisfies: ['social'], autonomyWeight: 0.4, llm: 'narrate', group: 'Social' }),
      act({ id: 'personal_call', label: 'Take a personal call', category: 'phone', icon: '📞', durationMinutes: 10, effects: { needs: { social: 8 }, stress: 2 }, autonomyWeight: 0.1, group: 'Social' }),
      act({ id: 'decorate', label: 'Decorate your cubicle', category: 'hobby', icon: '🖼️', durationMinutes: 15, effects: { needs: { fun: 6, comfort: 4 }, moodlets: [mood('happy', 'Homey cubicle', 2, 480)] }, autonomyWeight: 0.05, group: 'Fun' }),
      act({ id: 'micro_nap', label: 'Rest your eyes for a minute', category: 'needs', icon: '💤', durationMinutes: 15, effects: { perMinute: { energy: 0.12 }, custom: [cx('health:sleep', { minutes: 15, quality: 0.2 })] }, outcomes: { outcomes: [{ weight: 8, label: 'Refreshed', effects: {} }, { weight: 2, label: 'Boss noticed', effects: { stress: 8 } }] }, autonomyWeight: 0.1, group: 'Work' }),
    ],
  }),
  def({
    id: 'break_room_fridge', name: 'Break room fridge', category: 'appliance', icon: '🧊', basePrice: 700, description: 'A shared fridge with passive-aggressive labels and a science experiment in the back.', requiresUtility: 'electric', runningCostMonthly: 10,
    rooms: ['break_room'], tags: ['office', 'food', 'break_room'], durabilityUses: 50000, repairCost: 150,
    interactions: [
      act({ id: 'eat_packed_lunch', label: 'Eat your packed lunch', category: 'needs', icon: '🥪', durationMinutes: 25, consumes: [{ itemId: 'sandwich', qty: 1 }], effects: { needs: { hunger: 36, social: 6 } }, satisfies: ['hunger'], autonomyWeight: 1.2, group: 'Break' }),
      act({ id: 'eat_leftovers', label: 'Heat up leftovers', category: 'needs', icon: '♨️', durationMinutes: 20, consumes: [{ itemId: 'leftovers', qty: 1 }], effects: { needs: { hunger: 40, social: 4 } }, satisfies: ['hunger'], autonomyWeight: 1.2, group: 'Break' }),
      act({ id: 'steal_lunch', label: 'Eat someone else\'s lunch', category: 'needs', icon: '🫣', durationMinutes: 10, effects: { needs: { hunger: 35 }, moodlets: [mood('guilty', 'Lunch thief', -3, 240)] }, outcomes: { outcomes: [{ weight: 7, label: 'Nobody knows', effects: {} }, { weight: 3, label: 'Angry note appears', effects: { stress: 6, moodlets: [mood('embarrassed', 'Busted for lunch theft', -5, 480)] } }] }, autonomyWeight: 0.02, group: 'Break' }),
      act({ id: 'grab_water', label: 'Grab a water', category: 'needs', icon: '💧', durationMinutes: 2, effects: { needs: { thirst: 28, bladder: -6 } }, satisfies: ['thirst'], autonomyWeight: 1.5, group: 'Break' }),
      act({ id: 'office_cake', label: 'Have some birthday cake', category: 'social', icon: '🎂', durationMinutes: 15, effects: { needs: { hunger: 18, fun: 10, social: 10 }, weight: 0.04 }, autonomyWeight: 0.3, llm: 'narrate', group: 'Break' }),
      act({ id: 'clean_fridge', label: 'Clean out the shared fridge', category: 'chores', icon: '🧽', durationMinutes: 25, effects: { needs: { fun: -6, hygiene: -6 }, custom: [cx('chore:clean', { amount: 40, target: 'object' })], moodlets: [mood('proud', 'Office hero', 3, 480)] }, autonomyWeight: 0.05, group: 'Chores' }),
    ],
  }),
  def({
    id: 'water_cooler', name: 'Water cooler', category: 'appliance', icon: '🚰', basePrice: 250, description: 'A five-gallon water cooler. The unofficial meeting room.', runningCostMonthly: 40,
    rooms: ['break_room', 'hallway'], tags: ['office', 'water', 'social'], durabilityUses: 100000,
    interactions: [
      act({ id: 'drink', label: 'Get a cup of water', category: 'needs', icon: '💧', durationMinutes: 2, effects: { needs: { thirst: 28, bladder: -6 } }, satisfies: ['thirst'], autonomyWeight: 1.8, group: 'Water' }),
      act({ id: 'gossip', label: 'Water cooler gossip', category: 'social', icon: '🗣️', durationMinutes: 10, effects: { needs: { social: 12, fun: 8 }, stress: -3, skills: { charisma: 3 } }, satisfies: ['social'], autonomyWeight: 0.5, llm: 'narrate', group: 'Social' }),
      act({ id: 'replace_jug', label: 'Replace the jug', category: 'chores', icon: '🛢️', durationMinutes: 4, effects: { needs: { energy: -2 }, fitness: 0.03, moodlets: [mood('proud', 'Swapped the jug', 2, 240)] }, autonomyWeight: 0.05, group: 'Chores' }),
    ],
  }),
  def({
    id: 'copier', name: 'Copier', category: 'office', icon: '🖨️', basePrice: 4500, description: 'A multifunction copier. PC LOAD LETTER.', requiresUtility: 'electric', runningCostMonthly: 90,
    rooms: ['copy_room'], tags: ['office', 'work', 'equipment'], durabilityUses: 200000, repairCost: 350,
    interactions: [
      act({ id: 'make_copies', label: 'Make copies', category: 'work', icon: '📄', durationMinutes: 8, effects: { needs: { fun: -2 }, custom: [cx('career:print', { pages: 40 })] }, outcomes: { outcomes: [{ weight: 6, label: 'Done', effects: {} }, { weight: 3, label: 'Jam', effects: { stress: 5, moodlets: [mood('angry', 'Paper jam', -3, 60)] } }, { weight: 1, label: 'Toner low', effects: { stress: 3 } }] }, requiresState: { notBroken: true }, wearBy: 0.5, autonomyWeight: 0.1, group: 'Work' }),
      act({ id: 'scan_to_email', label: 'Scan documents', category: 'work', icon: '📠', durationMinutes: 5, effects: {}, requiresState: { notBroken: true }, autonomyWeight: 0.05, group: 'Work' }),
      act({ id: 'personal_copies', label: 'Print personal stuff', category: 'work', icon: '🫣', durationMinutes: 5, effects: { needs: { fun: 3 }, custom: [cx('career:print', { pages: 10, personal: true })] }, requiresState: { notBroken: true }, autonomyWeight: 0.03, group: 'Work' }),
      act({ id: 'fix_jam', label: 'Clear the jam', category: 'work', icon: '🔧', durationMinutes: 10, effects: { skills: { handiness: 4 }, custom: [cx('property:repair', { skill: 'handiness' })], moodlets: [mood('proud', 'Fixed the copier', 3, 240)] }, autonomyWeight: 0.05, group: 'Work' }),
    ],
  }),
  def({
    id: 'warehouse_shelf', name: 'Warehouse racking', category: 'commercial', icon: '📦', basePrice: 3000, description: 'Steel racking three stories high, full of pallets and barcodes.',
    rooms: ['floor'], tags: ['warehouse', 'work', 'logistics'], durabilityUses: 1000000,
    interactions: [
      workTask('pick_pack', 'Pick and pack orders', 'warehouse', 480, { icon: '📦', skills: { fitness: 6, logic: 2 }, energy: -34, hygiene: -20, stress: 12, fun: -18, description: 'Scanner beeps, rate targets, sore feet.' }),
      workTask('inventory_count', 'Count inventory', 'warehouse', 240, { icon: '🔢', skills: { logic: 6 }, energy: -14, fun: -12 }),
      workTask('unload_truck', 'Unload a truck', 'warehouse', 120, { icon: '🚚', skills: { fitness: 8 }, energy: -20, hygiene: -16, stress: 6 }),
      act({ id: 'lift_wrong', label: 'Lift a heavy box the wrong way', category: 'work', icon: '⚠️', durationMinutes: 2, effects: { needs: { energy: -3 } }, outcomes: { outcomes: [{ weight: 8, label: 'Fine', effects: {} }, { weight: 2, label: 'Threw out your back', effects: { health: -3, needs: { comfort: -25 }, moodlets: [mood('uncomfortable', 'Back injury', -8, 2880)] } }] }, autonomyWeight: 0, group: 'Work' }),
    ],
  }),
  def({
    id: 'forklift', name: 'Forklift', category: 'vehicle', icon: '🏗️', basePrice: 28000, description: 'A propane forklift. Certification required; confidence not enough.', runningCostMonthly: 300,
    rooms: ['floor', 'dock'], tags: ['warehouse', 'work', 'vehicle', 'certification'], durabilityUses: 100000, repairCost: 2000, ambient: { noise: 4 },
    interactions: [
      workTask('drive_forklift', 'Run the forklift', 'warehouse', 480, { icon: '🏗️', skills: { driving: 8, mechanics: 4 }, energy: -20, stress: 10, fun: 2, description: 'Certified operators only.' }),
      act({ id: 'get_certified', label: 'Forklift certification course', category: 'school', icon: '🎓', durationMinutes: 240, cost: 120, effects: { skills: { driving: 20 }, flags: { forklift_certified: true }, needs: { fun: -8 }, moodlets: [mood('proud', 'Forklift certified', 4, 1440)] }, minStage: YA, autonomyWeight: 0.02, group: 'Work' }),
      act({ id: 'pre_check', label: 'Do the pre-shift inspection', category: 'work', icon: '📋', durationMinutes: 10, effects: { skills: { mechanics: 3 }, stress: -1 }, autonomyWeight: 0.1, group: 'Work' }),
    ],
  }),
  def({
    id: 'loading_dock', name: 'Loading dock', category: 'commercial', icon: '🚛', basePrice: 15000, description: 'Roll-up doors, dock levelers, and trucks backing in with beepers.',
    rooms: ['dock'], tags: ['warehouse', 'work', 'logistics', 'delivery'], durabilityUses: 1000000, ambient: { noise: 5 },
    interactions: [
      workTask('load_truck', 'Load a trailer', 'warehouse', 180, { icon: '🚛', skills: { fitness: 8, logic: 2 }, energy: -26, hygiene: -18, stress: 8 }),
      act({ id: 'sign_delivery', label: 'Sign for a delivery', category: 'work', icon: '✍️', durationMinutes: 5, effects: { needs: { social: 2 }, custom: [cx('career:work_task', { minutes: 5, kind: 'warehouse' })] }, autonomyWeight: 0.1, group: 'Work' }),
      act({ id: 'dock_break', label: 'Take a break on the dock', category: 'needs', icon: '🚬', durationMinutes: 10, effects: { needs: { comfort: 6, social: 6, fun: 4 }, stress: -6 }, autonomyWeight: 0.3, llm: 'narrate', group: 'Break' }),
      act({ id: 'truck_checkin', label: 'Check in your truck', category: 'work', icon: '📋', durationMinutes: 15, effects: { custom: [cx('career:work_task', { minutes: 15, kind: 'delivery' })], stress: 2 }, autonomyWeight: 0.1, group: 'Work' }),
    ],
  }),
  def({
    id: 'assembly_line', name: 'Assembly line', category: 'commercial', icon: '⚙️', basePrice: 250000, description: 'A conveyor line of stations. Same motion, eight hours, safety glasses on.', requiresUtility: 'electric', runningCostMonthly: 4000,
    rooms: ['floor'], tags: ['factory', 'work', 'manufacturing'], durabilityUses: 1000000, repairCost: 8000, ambient: { noise: 7 },
    interactions: [
      workTask('line_shift', 'Work the line', 'line', 480, { icon: '⚙️', skills: { handiness: 6, mechanics: 4 }, energy: -32, hygiene: -18, stress: 16, fun: -22, description: 'Repetitive, loud, and the clock moves slowly.' }),
      workTask('qa_station', 'Quality control station', 'line', 480, { icon: '🔍', skills: { logic: 8 }, energy: -22, stress: 10, fun: -14 }),
      act({ id: 'line_fix', label: 'Fix a jam on the line', category: 'work', icon: '🔧', durationMinutes: 20, effects: { skills: { mechanics: 10, handiness: 6 }, stress: 4, custom: [cx('property:repair', { skill: 'mechanics' })] }, outcomes: { outcomes: [{ weight: 7, label: 'Line running', effects: { moodlets: [mood('proud', 'Kept the line moving', 3, 240)] }, skillId: 'mechanics', skillBias: 2 }, { weight: 2, label: 'Called maintenance', effects: { stress: 4 } }, { weight: 1, label: 'Pinched a finger', effects: { health: -1, needs: { comfort: -10 } } }] }, autonomyWeight: 0.05, group: 'Work' }),
      act({ id: 'safety_meeting', label: 'Attend the safety meeting', category: 'work', icon: '🦺', durationMinutes: 30, effects: { needs: { fun: -5 }, custom: [cx('career:meeting', { kind: 'safety' })] }, autonomyWeight: 0.1, group: 'Work' }),
    ],
  }),
);

// =====================================================================================
// COMMERCIAL — entertainment venues
// =====================================================================================
add(
  def({
    id: 'cinema_seat', name: 'Cinema seat', category: 'commercial', icon: '🎬', basePrice: 450, description: 'A reclining theater seat with a cup holder and someone\'s phone glowing two rows down.',
    rooms: ['auditorium'], tags: ['cinema', 'entertainment', 'seating', 'date'], durabilityUses: 200000, ambient: { comfort: 2, fun: 2 },
    interactions: [
      act({ id: 'watch_movie', label: 'Watch a movie', category: 'entertainment', icon: '🎬', durationMinutes: 130, cost: 16, effects: { perMinute: { fun: 0.4, comfort: 0.08 }, needs: { social: 4 }, stress: -8, custom: [cx('entertainment:watch', { channel: 'cinema', minutes: 130 })], moodlets: [mood('happy', 'Big-screen movie', 5, 240)] }, satisfies: ['fun'], autonomyWeight: 0.5, requiresState: { unoccupied: true }, setsState: { occupied: true }, dirtiesBy: 4, group: 'Movie' }),
      act({ id: 'matinee', label: 'Catch a matinee', category: 'entertainment', icon: '🌤️', durationMinutes: 120, cost: 10, effects: { perMinute: { fun: 0.38, comfort: 0.08 }, stress: -8, custom: [cx('entertainment:watch', { channel: 'cinema', minutes: 120 })] }, requirements: [timeReq(10 * 60, 17 * 60, 'Matinee pricing before 5pm')], satisfies: ['fun'], autonomyWeight: 0.4, requiresState: { unoccupied: true }, setsState: { occupied: true }, dirtiesBy: 3, group: 'Movie' }),
      act({ id: 'movie_date', label: 'Movie date', category: 'romance', icon: '💕', durationMinutes: 130, cost: 32, effects: { perMinute: { fun: 0.4, comfort: 0.08 }, needs: { social: 22 }, stress: -8, custom: [cx('entertainment:watch', { channel: 'cinema', minutes: 130 })], moodlets: [mood('flirty', 'Movie date', 5, 240)] }, minStage: TEEN, satisfies: ['fun', 'social'], autonomyWeight: 0.2, llm: 'narrate', requiresState: { unoccupied: true }, setsState: { occupied: true }, dirtiesBy: 4, group: 'Movie' }),
      act({ id: 'sneak_in', label: 'Sneak into a second movie', category: 'entertainment', icon: '🫣', durationMinutes: 120, effects: { perMinute: { fun: 0.35 }, moodlets: [mood('playful', 'Double feature', 3, 180)] }, outcomes: { outcomes: [{ weight: 8, label: 'Got away with it', effects: {} }, { weight: 2, label: 'Usher caught you', effects: { stress: 10, moodlets: [mood('embarrassed', 'Thrown out', -5, 240)], legal: [{ kind: 'heat', delta: 1 }] } }] }, minStage: TEEN, autonomyWeight: 0.02, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Movie' }),
    ],
  }),
  def({
    id: 'concession_stand', name: 'Concession stand', category: 'commercial', icon: '🍿', basePrice: 12000, description: 'Popcorn that costs more than the ticket, soda in a bucket.',
    rooms: ['lobby'], tags: ['cinema', 'stadium', 'food', 'counter', 'snacks'], durabilityUses: 200000, repairCost: 400,
    interactions: [
      order('popcorn', 'Buy popcorn', 9.5, 4, { needs: { hunger: 18, fun: 6, thirst: -6 }, weight: 0.04, custom: [cx('shop:order', { what: 'concession' })] }, { satisfies: ['hunger'], autonomyWeight: 0.6 }),
      order('soda', 'Buy a large soda', 7, 3, { needs: { thirst: 30, fun: 3, bladder: -12 }, caffeine: 30, weight: 0.04, custom: [cx('shop:order', { what: 'concession' })] }, { satisfies: ['thirst'], autonomyWeight: 0.6 }),
      order('combo', 'Buy the combo', 18, 5, { needs: { hunger: 26, thirst: 30, fun: 8, bladder: -12 }, weight: 0.08, custom: [cx('shop:order', { what: 'concession' })] }, { satisfies: ['hunger', 'thirst'], autonomyWeight: 0.5 }),
      order('candy', 'Buy candy', 5.5, 2, { needs: { hunger: 10, fun: 6 }, weight: 0.03, custom: [cx('shop:order', { what: 'concession' })] }, { satisfies: ['fun'], autonomyWeight: 0.3 }),
      order('hot_dog', 'Buy a hot dog & beer', 21, 6, { needs: { hunger: 34, thirst: 10, fun: 8 }, bloodAlcohol: 0.02, custom: [cx('shop:order', { what: 'concession' })] }, { minStage: YA, requirements: [{ kind: 'age', reason: 'Must be 21+', params: { minAge: 21 } }], satisfies: ['hunger'], autonomyWeight: 0.4 }),
      workTask('work_concessions', 'Work concessions', 'register', 300, { icon: '🍿', skills: { charisma: 4 }, hygiene: -10, energy: -18 }),
    ],
  }),
  def({
    id: 'theater_seat', name: 'Theater seat', category: 'commercial', icon: '🎭', basePrice: 600, description: 'A velvet seat in a house with real curtains and a chandelier.',
    rooms: ['house'], tags: ['theater', 'entertainment', 'seating', 'culture', 'date'], durabilityUses: 200000, ambient: { comfort: 2, environment: 3 },
    interactions: [
      act({ id: 'watch_play', label: 'See a play', category: 'entertainment', icon: '🎭', durationMinutes: 150, cost: 55, effects: { perMinute: { fun: 0.35, comfort: 0.05 }, needs: { social: 6 }, skills: { creativity: 6, writing: 4 }, stress: -10, moodlets: [mood('inspired', 'Live theater', 6, 300)] }, satisfies: ['fun'], autonomyWeight: 0.2, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Show' }),
      act({ id: 'watch_musical', label: 'See a musical', category: 'entertainment', icon: '🎶', durationMinutes: 165, cost: 85, effects: { perMinute: { fun: 0.4, comfort: 0.05 }, needs: { social: 6 }, skills: { singing: 4, music: 4 }, stress: -10, moodlets: [mood('happy', 'Show tunes stuck in your head', 6, 480)] }, satisfies: ['fun'], autonomyWeight: 0.15, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Show' }),
      act({ id: 'symphony', label: 'Hear the symphony', category: 'entertainment', icon: '🎻', durationMinutes: 120, cost: 48, effects: { perMinute: { fun: 0.28, comfort: 0.08 }, skills: { music: 8 }, stress: -14, moodlets: [mood('relaxed', 'Symphony', 5, 300)] }, satisfies: ['fun'], autonomyWeight: 0.1, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Show' }),
      act({ id: 'kids_show', label: 'Take the kids to a show', category: 'family', icon: '🧒', durationMinutes: 90, cost: 60, effects: { needs: { fun: 22, social: 18 }, skills: { parenting: 4 }, moodlets: [mood('grateful', 'Family outing', 5, 300)] }, minStage: YA, autonomyWeight: 0.05, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Family' }),
    ],
  }),
  def({
    id: 'concert_stage', name: 'Concert stage', category: 'commercial', icon: '🎸', basePrice: 200000, description: 'A big stage with a light rig and a wall of amps. Ears ring for a day after.',
    rooms: ['floor'], tags: ['concert', 'music', 'entertainment', 'nightlife'], durabilityUses: 1000000, ambient: { fun: 5, noise: 10 },
    interactions: [
      act({ id: 'see_show', label: 'See the show', category: 'entertainment', icon: '🎸', durationMinutes: 150, consumes: [{ itemId: 'concert_ticket', qty: 1 }], effects: { perMinute: { fun: 0.5 }, needs: { social: 16, energy: -18, hygiene: -14, thirst: -20 }, skills: { music: 6 }, stress: -12, moodlets: [mood('energized', 'Live music', 8, 480)] }, minStage: TEEN, satisfies: ['fun', 'social'], autonomyWeight: 0.3, group: 'Show' }),
      act({ id: 'front_row', label: 'Push to the front', category: 'entertainment', icon: '🤘', durationMinutes: 150, consumes: [{ itemId: 'concert_ticket', qty: 1 }], effects: { perMinute: { fun: 0.55 }, needs: { social: 14, energy: -26, hygiene: -24, comfort: -16, thirst: -26 }, stress: -12, moodlets: [mood('energized', 'Front row', 10, 480)] }, minStage: TEEN, autonomyWeight: 0.1, group: 'Show' }),
      act({ id: 'perform_gig', label: 'Play the gig', category: 'work', icon: '🎤', durationMinutes: 90, effects: { needs: { fun: 30, social: 20, energy: -24, hygiene: -18 }, skills: { guitar: 20, singing: 20, charisma: 14, music: 10 }, stress: 6, custom: [cx('career:perform', { skill: 'music', venue: 'concert' })] }, outcomes: { outcomes: [{ weight: 4, label: 'Crowd went wild', effects: { money: { amount: 400, memo: 'Gig payout' }, moodlets: [mood('proud', 'Killer show', 10, 1440)] }, skillId: 'music', skillBias: 3 }, { weight: 5, label: 'Solid set', effects: { money: { amount: 150, memo: 'Gig payout' } } }, { weight: 2, label: 'Sound issues', effects: { money: { amount: 80, memo: 'Gig payout' }, stress: 8 } }] }, requirements: [skillReq('music', 4)], minStage: TEEN, autonomyWeight: 0.02, llm: 'narrate', group: 'Show' }),
      act({ id: 'merch', label: 'Buy a band shirt', category: 'shop', icon: '👕', durationMinutes: 8, cost: 40, effects: { items: [{ op: 'gain', itemId: 'outfit_casual', qty: 1 }], needs: { fun: 6 } }, autonomyWeight: 0.05, group: 'Shop' }),
    ],
  }),
  def({
    id: 'stadium_seat', name: 'Stadium seat', category: 'commercial', icon: '🏟️', basePrice: 300, description: 'A plastic seat in section 314. Great view of the jumbotron.',
    rooms: ['stands'], tags: ['stadium', 'sports', 'entertainment', 'seating'], durabilityUses: 500000, ambient: { fun: 3, noise: 6 },
    interactions: [
      act({ id: 'watch_game', label: 'Watch the game', category: 'entertainment', icon: '🏟️', durationMinutes: 180, consumes: [{ itemId: 'event_ticket', qty: 1 }], effects: { perMinute: { fun: 0.35 }, needs: { social: 16, comfort: -8, energy: -8 }, stress: -8, custom: [cx('entertainment:watch', { channel: 'live_sports', minutes: 180 })], moodlets: [mood('energized', 'Game day live', 6, 480)] }, outcomes: { outcomes: [{ weight: 5, label: 'Home team won!', effects: { needs: { fun: 15 }, moodlets: [mood('happy', 'We won!', 6, 480)] } }, { weight: 5, label: 'Tough loss', effects: { moodlets: [mood('sad', 'We lost', -3, 240)] } }] }, satisfies: ['fun', 'social'], autonomyWeight: 0.3, requiresState: { unoccupied: true }, setsState: { occupied: true }, group: 'Game' }),
      act({ id: 'wave', label: 'Start the wave', category: 'social', icon: '🙌', durationMinutes: 3, effects: { needs: { fun: 8, social: 8 } }, outcomes: { outcomes: [{ weight: 3, label: 'It went around!', effects: { needs: { fun: 10 }, moodlets: [mood('proud', 'Started the wave', 4, 120)] } }, { weight: 5, label: 'Died two sections over', effects: { moodlets: [mood('embarrassed', 'Wave failed', -1, 30)] } }] }, autonomyWeight: 0.05, group: 'Game' }),
      act({ id: 'tailgate', label: 'Tailgate before the game', category: 'social', icon: '🍔', durationMinutes: 120, cost: 20, effects: { needs: { hunger: 50, social: 30, fun: 24, hygiene: -8 }, bloodAlcohol: 0.03, stress: -8, moodlets: [mood('happy', 'Tailgate', 6, 480)] }, minStage: TEEN, satisfies: ['social', 'hunger'], autonomyWeight: 0.15, llm: 'narrate', group: 'Game' }),
      act({ id: 'heckle_ref', label: 'Yell at the ref', category: 'entertainment', icon: '😤', durationMinutes: 2, effects: { needs: { fun: 6 }, stress: -4 }, autonomyWeight: 0.05, group: 'Game' }),
    ],
  }),
  def({
    id: 'museum_exhibit', name: 'Museum exhibit', category: 'commercial', icon: '🏛️', basePrice: 50000, description: 'A gallery of artifacts with placards nobody reads all the way through.',
    rooms: ['gallery'], tags: ['museum', 'culture', 'education', 'quiet', 'date', 'family'], durabilityUses: 1000000, ambient: { environment: 4, comfort: 1 },
    interactions: [
      act({ id: 'tour_exhibit', label: 'Tour the exhibit', category: 'entertainment', icon: '🏛️', durationMinutes: 90, cost: 22, effects: { perMinute: { fun: 0.2 }, needs: { energy: -6 }, skills: { research: 14, creativity: 8, painting: 4 }, stress: -8, custom: [cx('entertainment:exhibit', { kind: 'museum' })], moodlets: [mood('inspired', 'Museum day', 5, 300)] }, satisfies: ['fun'], autonomyWeight: 0.2, group: 'Museum' }),
      act({ id: 'read_placards', label: 'Actually read the placards', category: 'school', icon: '📜', durationMinutes: 60, effects: { skills: { research: 20, logic: 6 }, needs: { fun: 6 } }, autonomyWeight: 0.1, group: 'Museum' }),
      act({ id: 'sketch_art', label: 'Sketch the art', category: 'hobby', icon: '✏️', durationMinutes: 60, effects: { skills: { painting: 20, creativity: 8 }, needs: { fun: 12 }, moodlets: [mood('inspired', 'Sketching masters', 4, 240)] }, autonomyWeight: 0.1, group: 'Museum' }),
      act({ id: 'guided_tour', label: 'Join a guided tour', category: 'social', icon: '🎧', durationMinutes: 75, cost: 8, effects: { skills: { research: 16 }, needs: { fun: 10, social: 10 } }, autonomyWeight: 0.1, llm: 'narrate', group: 'Museum' }),
      act({ id: 'kids_museum', label: 'Take the kids through', category: 'family', icon: '🧒', durationMinutes: 90, cost: 35, effects: { needs: { fun: 16, social: 16, energy: -10 }, skills: { parenting: 6 }, moodlets: [mood('grateful', 'Family museum trip', 4, 300)] }, minStage: YA, autonomyWeight: 0.05, llm: 'narrate', group: 'Family' }),
      act({ id: 'gift_shop', label: 'Browse the gift shop', category: 'shop', icon: '🛍️', durationMinutes: 15, cost: 18, effects: { items: [{ op: 'gain', itemId: 'gift_generic', qty: 1 }], needs: { fun: 4 } }, autonomyWeight: 0.05, group: 'Shop' }),
    ],
  }),
  def({
    id: 'zoo_enclosure', name: 'Zoo enclosure', category: 'commercial', icon: '🦁', basePrice: 500000, description: 'A habitat behind glass. The animal is asleep in the one spot you can\'t see.',
    rooms: ['grounds'], tags: ['zoo', 'animals', 'family', 'outdoor', 'entertainment'], durabilityUses: 1000000, ambient: { fun: 3, environment: 2 },
    interactions: [
      act({ id: 'watch_animals', label: 'Watch the animals', category: 'entertainment', icon: '🦁', durationMinutes: 30, effects: { needs: { fun: 14 }, stress: -6, skills: { research: 4 }, custom: [cx('entertainment:exhibit', { kind: 'zoo' })] }, satisfies: ['fun'], autonomyWeight: 0.4, group: 'Zoo' }),
      act({ id: 'zoo_day', label: 'Spend the day at the zoo', category: 'entertainment', icon: '🐘', durationMinutes: 240, cost: 28, effects: { needs: { fun: 34, social: 12, energy: -24, hygiene: -10, thirst: -20 }, fitness: 0.3, stress: -10, custom: [cx('entertainment:exhibit', { kind: 'zoo' })], moodlets: [mood('happy', 'Zoo day', 6, 480)] }, satisfies: ['fun'], autonomyWeight: 0.15, group: 'Zoo' }),
      act({ id: 'feeding_show', label: 'Watch the feeding', category: 'entertainment', icon: '🍖', durationMinutes: 20, effects: { needs: { fun: 12, social: 4 }, skills: { research: 3 } }, autonomyWeight: 0.15, group: 'Zoo' }),
      act({ id: 'take_photos', label: 'Photograph the animals', category: 'hobby', icon: '📸', durationMinutes: 40, effects: { skills: { photography: 18 }, needs: { fun: 12 } }, autonomyWeight: 0.1, group: 'Zoo' }),
      act({ id: 'kids_zoo', label: 'Take the kids to the zoo', category: 'family', icon: '🧒', durationMinutes: 240, cost: 60, effects: { needs: { fun: 30, social: 24, energy: -26 }, skills: { parenting: 8 }, moodlets: [mood('grateful', 'Zoo with the kids', 6, 480)] }, minStage: YA, autonomyWeight: 0.05, llm: 'narrate', group: 'Family' }),
    ],
  }),
  def({
    id: 'aquarium_tank', name: 'Aquarium tank', category: 'commercial', icon: '🐠', basePrice: 800000, description: 'A floor-to-ceiling tank with sharks, rays, and a diver waving.',
    rooms: ['gallery'], tags: ['aquarium', 'animals', 'family', 'date', 'entertainment', 'calm'], durabilityUses: 1000000, ambient: { fun: 3, comfort: 2, environment: 3 },
    interactions: [
      act({ id: 'watch_tank', label: 'Watch the big tank', category: 'entertainment', icon: '🐠', durationMinutes: 30, effects: { needs: { fun: 12, comfort: 6 }, stress: -10, custom: [cx('entertainment:exhibit', { kind: 'aquarium' })], moodlets: [mood('relaxed', 'Aquarium calm', 4, 180)] }, satisfies: ['fun'], autonomyWeight: 0.4, group: 'Aquarium' }),
      act({ id: 'aquarium_visit', label: 'Visit the aquarium', category: 'entertainment', icon: '🦈', durationMinutes: 150, cost: 32, effects: { needs: { fun: 28, social: 10, energy: -12 }, skills: { research: 8 }, stress: -12, custom: [cx('entertainment:exhibit', { kind: 'aquarium' })], moodlets: [mood('inspired', 'Ocean wonder', 5, 300)] }, satisfies: ['fun'], autonomyWeight: 0.15, group: 'Aquarium' }),
      act({ id: 'touch_tank', label: 'Touch the stingrays', category: 'entertainment', icon: '🤚', durationMinutes: 15, effects: { needs: { fun: 12, hygiene: -4 }, moodlets: [mood('playful', 'Touched a ray', 3, 120)] }, autonomyWeight: 0.2, group: 'Aquarium' }),
      act({ id: 'aquarium_date', label: 'Aquarium date', category: 'romance', icon: '💕', durationMinutes: 150, cost: 64, effects: { needs: { fun: 26, social: 26 }, stress: -12, moodlets: [mood('flirty', 'Aquarium date', 6, 300)] }, minStage: TEEN, satisfies: ['social'], autonomyWeight: 0.1, llm: 'narrate', group: 'Aquarium' }),
    ],
  }),
  def({
    id: 'roller_coaster', name: 'Roller coaster', category: 'commercial', icon: '🎢', basePrice: 12000000, description: 'A steel coaster with a 200-foot drop and a 90-minute line.', requiresUtility: 'electric', runningCostMonthly: 40000,
    rooms: ['midway'], tags: ['theme_park', 'thrill', 'entertainment', 'summer'], durabilityUses: 1000000, ambient: { fun: 5, noise: 6 },
    interactions: [
      act({ id: 'ride', label: 'Ride the coaster', category: 'entertainment', icon: '🎢', durationMinutes: 45, effects: { needs: { fun: 30, energy: -6, comfort: -6, bladder: -6 }, stress: -10, custom: [cx('entertainment:ride', { ride: 'coaster' })], moodlets: [mood('energized', 'Adrenaline rush', 8, 240)] }, outcomes: { outcomes: [{ weight: 8, label: 'AMAZING', effects: { needs: { fun: 10 } } }, { weight: 2, label: 'Queasy', effects: { needs: { comfort: -14, hunger: -8 }, moodlets: [mood('sick', 'Coaster nausea', -4, 90)] } }] }, minStage: CHILD, satisfies: ['fun'], autonomyWeight: 0.4, group: 'Ride' }),
      act({ id: 'ride_again', label: 'Ride it again, front row', category: 'entertainment', icon: '🔁', durationMinutes: 60, effects: { needs: { fun: 34, energy: -8, comfort: -8 }, stress: -10, custom: [cx('entertainment:ride', { ride: 'coaster', front: true })], moodlets: [mood('energized', 'Front row!', 9, 240)] }, minStage: TEEN, autonomyWeight: 0.15, group: 'Ride' }),
      act({ id: 'chicken_out', label: 'Chicken out in line', category: 'entertainment', icon: '🐔', durationMinutes: 30, effects: { needs: { fun: -4 }, stress: -4, moodlets: [mood('embarrassed', 'Chickened out', -3, 120)] }, autonomyWeight: 0.02, group: 'Ride' }),
      act({ id: 'buy_photo', label: 'Buy the ride photo', category: 'shop', icon: '📸', durationMinutes: 5, cost: 20, effects: { needs: { fun: 6 }, moodlets: [mood('playful', 'Ride photo', 2, 240)] }, autonomyWeight: 0.03, group: 'Shop' }),
    ],
  }),
  def({
    id: 'ferris_wheel', name: 'Ferris wheel', category: 'commercial', icon: '🎡', basePrice: 2500000, description: 'A slow wheel with enclosed gondolas and a view of the whole fair.', requiresUtility: 'electric', runningCostMonthly: 8000,
    rooms: ['midway'], tags: ['theme_park', 'fair', 'romantic', 'family', 'entertainment'], durabilityUses: 1000000, ambient: { fun: 3, environment: 2 },
    interactions: [
      act({ id: 'ride', label: 'Ride the Ferris wheel', category: 'entertainment', icon: '🎡', durationMinutes: 20, cost: 6, effects: { needs: { fun: 14, comfort: 4 }, stress: -8, custom: [cx('entertainment:ride', { ride: 'ferris' })], moodlets: [mood('relaxed', 'View from the top', 4, 180)] }, satisfies: ['fun'], autonomyWeight: 0.3, group: 'Ride' }),
      act({ id: 'ride_together', label: 'Ride with someone special', category: 'romance', icon: '💕', durationMinutes: 20, cost: 12, effects: { needs: { fun: 16, social: 20 }, stress: -8, custom: [cx('entertainment:ride', { ride: 'ferris' })], moodlets: [mood('in_love', 'Top of the Ferris wheel', 7, 300)] }, minStage: TEEN, satisfies: ['social'], autonomyWeight: 0.1, llm: 'narrate', group: 'Ride' }),
      act({ id: 'photos_top', label: 'Take photos from the top', category: 'hobby', icon: '📸', durationMinutes: 20, cost: 6, effects: { skills: { photography: 10 }, needs: { fun: 12 } }, autonomyWeight: 0.05, group: 'Ride' }),
    ],
  }),
  def({
    id: 'carousel', name: 'Carousel', category: 'commercial', icon: '🎠', basePrice: 600000, description: 'A hand-painted carousel with organ music. Every horse has a name.', requiresUtility: 'electric', runningCostMonthly: 3000,
    rooms: ['midway'], tags: ['theme_park', 'fair', 'park', 'kids', 'family', 'entertainment'], durabilityUses: 1000000, ambient: { fun: 3, noise: 3 },
    interactions: [
      act({ id: 'ride', label: 'Ride the carousel', category: 'entertainment', icon: '🎠', durationMinutes: 8, cost: 3, effects: { needs: { fun: 14 }, stress: -4, custom: [cx('entertainment:ride', { ride: 'carousel' })], moodlets: [mood('playful', 'Carousel', 3, 120)] }, satisfies: ['fun'], autonomyWeight: 0.4, group: 'Ride' }),
      act({ id: 'ride_with_kid', label: 'Ride with your kid', category: 'family', icon: '🧒', durationMinutes: 10, cost: 6, effects: { needs: { fun: 12, social: 14 }, skills: { parenting: 4 }, custom: [cx('family:play_with_child', {})], moodlets: [mood('grateful', 'Carousel with the kiddo', 4, 240)] }, minStage: TEEN, autonomyWeight: 0.1, llm: 'narrate', group: 'Family' }),
      act({ id: 'watch_carousel', label: 'Watch from the bench', category: 'entertainment', icon: '🪑', durationMinutes: 10, effects: { needs: { fun: 4, comfort: 4 }, stress: -3, moodlets: [mood('nostalgic', 'Carousel music', 2, 90)] }, autonomyWeight: 0.1, group: 'Ride' }),
    ],
  }),
);
