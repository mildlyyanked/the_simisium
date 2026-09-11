# The Simisium — Architecture

A hardcore, text-based life simulation of present-day life in the United States, for mobile.
Two X-factors: **every character interaction is LLM-driven**, and **the world is built from Google Maps data**.

This document is the contract between all modules. If you change a type in `src/engine/core/types.ts`, update this doc.

---

## 1. Layering

```
app/                     Expo Router screens (React Native). UI only. Talks to src/store.
src/store/               Zustand stores: wraps the Engine, persistence, settings (API keys, model prefs).
src/ui/                  Theme + reusable components (no game logic).
src/engine/              PURE TypeScript. No React / React Native imports. Runs in Node for tests + headless sims.
  core/                  Types, clock, RNG, event bus, action pipeline, system registry, engine loop, save/load.
  systems/               One file per subsystem. Each exports a `System` (see §5).
  content/               Static data catalogs (objects, careers, recipes, holidays, traits, illnesses, …).
  llm/                   OpenRouter client, model routing, prompt builders, structured outcome parsing, offline fallbacks.
  places/                Google Places provider + mock provider + type→archetype mapping + travel-time estimation.
  gen/                   World generation (seed venues/NPCs from Places), sim generation (traits, bios).
```

Rule: `engine/` must never import from `app/`, `store/`, or `ui/`. Everything the UI needs is exposed through `Engine` methods and the immutable `WorldState` snapshot.

---

## 2. Time

- Unit of simulation: **1 sim-minute**. `WorldState.time` is `SimTime = { minute: number }` — minutes since the game epoch (`WorldState.epoch`, an ISO date, defaults to the real "today").
- `clock.ts` derives: `Date`, weekday, hour/minute, season, daylight (from latitude), and the `CalendarDay` (holidays come from `content/holidays.ts`).
- The engine advances in ticks. `Engine.advance(minutes)` runs `tick(1)` repeatedly; systems declare `intervalMinutes` (1, 5, 15, 60, 1440) so cheap systems run every minute and expensive ones (finance, career, NPC LOD) run less often.
- Actions have durations. When the player performs an action the engine advances time for its duration, applying the action's per-minute effects, and stops early on **interrupts** (critical need, emergency event, incoming call, arrest…).
- Time speed for "wait"/"sleep" is just larger `advance()` calls. No wall-clock ticking is required; the UI may auto-advance when idle.

## 3. World state

`WorldState` (serializable JSON, see `types.ts`) contains:

| Field | Description |
|---|---|
| `meta` | save id, version, seed, created/updated |
| `time`, `epoch`, `timezone` | see §2 |
| `region` | city selected at new-game: center lat/lng, name, state, cost-of-living multiplier, climate profile, sales/income tax rates |
| `venues` | `Record<VenueId, Venue>` — real places from Google (or mock) + home lots. Venues own `ObjectInstance`s and staff NPC ids. |
| `sims` | `Record<SimId, Sim>` — every character, player or NPC, same schema |
| `households` | `Record<HouseholdId, Household>` — sims, home venue, shared finances, pets, vehicles |
| `pets` | `Record<PetId, Pet>` |
| `objects` | `Record<ObjectId, ObjectInstance>` — every object in every venue / inventory |
| `vehicles` | `Record<VehicleId, Vehicle>` |
| `player` | `{ householdId, activeSimId, controlledSimIds[] }` |
| `weather` | current + 7-day forecast |
| `economy` | fuel price, inflation index, interest rates, job market heat, stock index |
| `scheduled` | priority queue of `ScheduledEvent` (bills due, appointments, court dates, deliveries, festivals) |
| `log` | `LogEntry[]` narrative feed (capped, older entries summarized into sim memories) |
| `conversations` | active conversation threads by id |
| `rngState` | seeded RNG state so replays are deterministic |
| `stats` | counters (days survived, money earned, …) |

Every entity has a string id with a prefix: `sim_`, `ven_`, `obj_`, `hh_`, `pet_`, `veh_`, `evt_`, `conv_`.

## 4. Sims

One schema for player sims and NPCs. NPCs are simulated at three levels of detail (`Sim.lod`):

- `full` — household members & sims in the same venue as any controlled sim: needs, actions, schedule every tick.
- `near` — known contacts (relationship exists): schedule + needs every 15 min, no object interaction.
- `far` — background population: schedule only (where they are), daily rollup.

Key sub-records (all in `types.ts`):

- `identity` — name, age (as birth date), gender, pronouns, ethnicity/heritage (free text), appearance descriptors, voice descriptors.
- `personality` — Big Five (0..1) + `traits: TraitId[]` (from `content/traits.ts`) + values + speech style hints for the LLM.
- `needs` — `hunger, thirst, energy, bladder, hygiene, social, fun, comfort` (0..100, 100 = satisfied). `needs.ts` decays them; thresholds create **moodlets** and interrupts.
- `body` — health (0..100), fitness, weight, illnesses, injuries, pregnancy, disabilities, addictions, blood alcohol, caffeine, sleep debt.
- `mind` — stress, mood (derived), `moodlets: Moodlet[]` (timed buffs/debuffs with a source), mental health conditions.
- `skills` — `Record<SkillId, { level 0..10, xp }>`.
- `education` — current enrollment, degrees, GPA, transcript, student loans ref.
- `career` — current job (`careerId`, track level, employer venue, schedule, performance, salary), job history, gig-work state, unemployment benefits.
- `finance` — accounts (checking, savings, credit cards, loans), credit score, recurring bills, tax record.
- `legal` — record (charges, convictions), warrants, license status, tickets, parole/probation.
- `relationships` — `Record<SimId, Relationship>`: `friendship`, `romance` (−100..100), `trust`, `familiarity` (0..100), `type` flags (family relation, partner, ex, coworker, boss, neighbor…), history of notable interactions, `promises`.
- `memory` — `Memory[]` with salience, timestamps, participants; compacted by the LLM summarizer. Used for NPC consistency.
- `bio` — **progressively revealed biography**. `BioFact[]` each `{ id, category, text, secret: boolean, revealedTo: SimId[], revealedAt }`. Generated at NPC creation (LLM or deterministic fallback), *never changed after* (only revealed). The LLM speaking as the NPC receives all facts as ground truth. The player UI only shows facts revealed to a controlled sim.
- `schedule` — weekly routine blocks (`work`, `school`, `sleep`, `gym`, …) used for NPC autonomy and for "where is X right now".
- `inventory` — `ObjectId[]` (portable objects) and `consumables: Record<ItemId, qty>` (groceries, meds).
- `location` — `{ venueId, roomId?, arrivedAt }` and `travel?: { toVenueId, mode, arriveAt }`.
- `currentAction?` — what the sim is doing (used by autonomy and by "what is X doing" queries).

## 5. Systems

```ts
interface System {
  id: SystemId;
  intervalMinutes: number;              // how often onTick fires
  onInit?(ctx: SystemContext): void;    // after load / new game
  onTick?(ctx: SystemContext, dt: number): void;   // dt = minutes elapsed since last tick for this system
  onEvent?(ctx: SystemContext, event: GameEvent): void;   // reacts to anything on the bus
  actions?(ctx: SystemContext, simId: SimId): ActionDef[];  // contributes context-sensitive actions
}
```

`SystemContext` gives: `state` (mutable during the tick — systems mutate in place, the engine snapshots after), `rng`, `emit(event)`, `schedule(event)`, `log(entry)`, `clock` helpers, `content` catalogs, `query` helpers (`simsAt(venue)`, `objectsAt(venue)`, `householdOf(sim)`…).

Registered systems (in tick order): `calendar`, `weather`, `needs`, `health`, `skills`, `relationships`, `family`, `pets`, `finance`, `property`, `amenities`, `transport`, `shopping`, `career`, `education`, `law`, `civic`, `entertainment`, `communication`, `npcAI`, `lifeEvents`.

Cross-system communication happens **only via events** (`GameEvent` union in `events.ts`) or via shared state. A system never imports another system.

## 6. Actions & interactions

An `ActionDef` is a *thing a sim can do now*:

```ts
interface ActionDef {
  id: string;                    // stable, e.g. "obj:fridge:cook_meal" / "sim:sim_12:talk" / "venue:go:ven_9"
  label: string;                 // "Cook dinner"
  category: ActionCategory;      // 'needs' | 'social' | 'work' | 'travel' | 'shop' | 'object' | 'phone' | 'hobby' | 'freeform' …
  icon?: string;
  target?: { kind: 'object' | 'sim' | 'venue' | 'pet' | 'item'; id: string };
  durationMinutes: number;       // planned; may be interrupted
  cost?: MoneyAmount;            // charged up-front (validated by finance)
  requirements?: Requirement[];  // shown greyed out when unmet, with reason
  effects: EffectBundle;         // deterministic effects applied over duration (see §7)
  outcomes?: OutcomeTable;       // weighted random results, skill-modified
  llm?: 'narrate' | 'adjudicate' | 'converse';   // whether the LLM narrates/decides/roleplays
  autonomyWeight?: number;       // how NPC autonomy scores it
}
```

Sources of actions (merged by `actions.ts:availableActions(state, simId)`):
1. **Objects** in the sim's venue/inventory — from `ObjectDef.interactions` in `content/objects.ts`.
2. **Sims/pets present** — social menu from `relationships`/`family`/`pets` systems.
3. **Venue archetype** — e.g. at a `grocery` venue: "Shop for groceries"; at `gym`: "Work out"; at `bank`: "Open account"; at `dmv`: "Renew license". Provided by `places/archetypes.ts` + systems.
4. **Phone** — always available: call/text contacts, banking, job search, order delivery, rideshare, streaming.
5. **Travel** — "Go to …" for any known venue (travel time via `places/travel.ts`).
6. **Freeform** — the player types anything. Routed to the LLM adjudicator (§8).

Execution pipeline (`engine.ts:performAction`): validate requirements → charge cost → set `currentAction` → advance time in 1-min ticks applying `effects.perMinute` → on completion roll `outcomes`, apply `effects.onComplete` → emit `action:completed` → optional LLM narration.

## 7. Effects

`EffectBundle` is the single vocabulary for *changing the world*. Both hand-authored content and LLM outputs produce `EffectBundle`s, so there is one validator and one applier (`core/effects.ts`).

```ts
interface EffectBundle {
  needs?: Partial<Record<NeedId, number>>;           // absolute deltas
  perMinute?: Partial<Record<NeedId, number>>;       // applied each minute of an action
  money?: { amount: number; account?: AccountKind; memo: string; counterparty?: string };
  skills?: Partial<Record<SkillId, number>>;         // xp
  moodlets?: MoodletSpec[];
  stress?: number;
  health?: number; fitness?: number; weight?: number;
  relationships?: { simId: SimId; friendship?: number; romance?: number; trust?: number; familiarity?: number; flags?: RelationshipFlagChange[] }[];
  revealFacts?: { simId: SimId; factIds: string[]; to: SimId }[];
  memories?: MemorySpec[];
  items?: { op: 'gain' | 'lose'; itemId: ItemId; qty: number }[];
  objects?: { objectId: ObjectId; patch: Partial<ObjectInstance['state']> }[];
  legal?: LegalEffect[];
  schedule?: ScheduledEventSpec[];
  moveTo?: { venueId: VenueId };
  timeElapsedMinutes?: number;                       // for LLM-adjudicated outcomes
  flags?: Record<string, string | number | boolean>; // sim-level free flags for quests/story
}
```

`validateEffects(bundle, context)` clamps LLM-proposed effects to plausibility envelopes (e.g. relationship deltas ±20 per interaction, money only for priced transactions the scene supports, no revealing facts that don't exist, no skill jumps > 1 level), and returns `{ bundle, rejected: string[] }` so the UI can show "the world didn't quite allow that".

## 8. LLM layer (OpenRouter)

`llm/client.ts` — one `LLMClient` with `complete(task, messages, schema?)`. Uses OpenRouter's OpenAI-compatible chat completions endpoint (`https://openrouter.ai/api/v1/chat/completions`) via `fetch`. Structured output uses `response_format: { type: 'json_schema' }` where the model supports it, otherwise a JSON-extraction fallback. Retries with backoff, request/response logging, per-save token & cost accounting, and an LRU cache keyed by prompt hash (for deterministic things like venue descriptions).

`llm/router.ts` — task → model. Defaults (overridable in Settings):

| Task | Default model | Why |
|---|---|---|
| `dialogue` (NPC replies in conversation) | `anthropic/claude-haiku-4.5` | fast, characterful, cheap; ~2 s per line |
| `adjudicate` (freeform action outcomes, consequences) | `anthropic/claude-sonnet-5` | needs judgment + strict JSON |
| `bio` (NPC biography generation) | `anthropic/claude-sonnet-5` | coherent, consistent long-form facts |
| `narrate` (flavor text for scenes/venues) | `google/gemini-2.5-flash-lite` | very cheap, high volume |
| `summarize` (memory compaction) | `anthropic/claude-haiku-4.5` | cheap |
| `director` (weekly story beats, world events) | `anthropic/claude-opus-5` | rare call, high stakes |

Every prompt builder in `llm/prompts/` takes a `SceneContext` (built by `llm/context.ts`): time/weather/holiday, venue (from Google data: name, types, rating, price level, hours, review themes), present sims (summaries + relationship to speaker), speaker's full profile + bio facts + relevant memories + needs/moodlets, recent log lines, and the *rules* (what effects are allowed).

Outputs are parsed with zod schemas in `llm/schemas.ts` into `{ narration, dialogue[], effects: EffectBundle, revealedFacts, newMemories, followUps }` then validated (§7).

`llm/fallback.ts` — when there is no API key or the call fails, a deterministic rule-based adjudicator/dialogue generator keeps the game playable (used by tests).

## 9. Places layer (Google Maps)

`places/provider.ts`:

```ts
interface PlacesProvider {
  searchNearby(center, radiusM, includedTypes[]): Promise<PlaceSummary[]>;
  searchText(query, center, radiusM): Promise<PlaceSummary[]>;
  details(placeId): Promise<PlaceDetails>;     // hours, reviews, phone, website, price level, editorial summary
  autocomplete(input, center?): Promise<PlacePrediction[]>;
  geocode(address): Promise<LatLng>;
  travel(from, to, mode): Promise<TravelEstimate>;   // Routes API; falls back to haversine × mode speed
}
```

`GooglePlacesProvider` calls Places API (New) with field masks. `MockPlacesProvider` serves a curated fixture city (`places/fixtures/austin.ts`) so the game runs with no key. Responses are cached (`places/cache.ts`) in the save so a world stays stable.

`places/archetypes.ts` maps Google `types` → game `VenueArchetype` (`home, grocery, restaurant, cafe, bar, gym, park, school, college, hospital, clinic, pharmacy, police, courthouse, dmv, bank, office, retail, mall, cinema, theater, stadium, museum, library, church, salon, vet, pet_store, car_dealer, gas_station, mechanic, transit, airport, hotel, nightclub, laundromat, post_office, daycare, …`). Each archetype defines: default objects (so every gym has treadmills), staff roles (so the LLM knows a barista exists), venue actions, typical prices scaled by Google `priceLevel`, and noise/crowd profile by hour.

`gen/worldgen.ts` seeds a new game: pick region → fetch venues per archetype (nearest N) → create home lot → generate a population of NPCs attached to venues (staff), the neighborhood (neighbors), and institutions (teachers, doctors, police) → generate bios lazily on first meaningful contact.

## 9b. Space layer (`src/engine/space`)

Every venue has a **floor plan** (`VenueLayout`), generated on first use from its rooms and objects and stored in `state.layouts` so it never changes under the player. Generation is seeded by venue id (`layout:<venueId>:<version>`): rooms are packed into rows of a tile grid with shared walls and equal row heights, doors are cut between every pair of neighbours (the plan is always fully connected), and each object gets one tile in its room, along the walls first, never in front of a door and never boxing in a corner. Objects that arrive later (a purchase) are slotted in by `placeNewObjects`.

Positions: `sim.location.pos` is stored when a sim walked or used something; otherwise `positionOf` derives it deterministically (next to the object they are using; the entrance for controlled sims; a stable idle tile per NPC and venue). So NPC placement is consistent without simulating their footsteps.

Movement: `engine.moveTo / walkToObject / walkToSim` BFS over walkable tiles; walks longer than a few tiles cost minutes (`walkMinutes`). `perform` on an object walks the player over first (NPCs are simply stood next to it), and an in-person `startConversation` walks to the other sim. The LLM scene context states which room the actor and each NPC are in.

UI: the **Here** tab renders the plan (`PlaceMap`): tap a tile to walk, an object to open its actions, a person to talk.

## 10. Save/Load

`core/save.ts` serializes `WorldState` to JSON (version-stamped; migrations in `core/migrations.ts`). Store layer writes to AsyncStorage/FileSystem. Auto-save after every action.

## 11. Testing

- `vitest` for engine. Every system has at least one test that runs a headless week and asserts invariants (needs bounded, money conserved, no NaN, events emitted).
- `scripts/headless.ts` runs N sim-days with the fallback LLM and prints a report — the fastest way to sanity-check balance.

## 12. Conventions

- Money in **dollars as numbers rounded to cents** (`round2`).
- Needs 0..100. Relationship axes −100..100. Skills 0..10 with xp curve in `content/skills.ts`.
- All randomness through `ctx.rng` (seeded). Never `Math.random` in the engine.
- Ids via `ids.ts:newId(prefix, rng)`.
- Log lines are the player's narrative feed; write them in second person present tense for controlled sims ("You…") and third person for others.
