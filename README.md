# The Simisium

A hardcore, text-based life simulation of present-day life in the United States, for iOS and Android.

Two things make it different from every other life sim:

1. **Every character interaction is LLM-driven.** Conversations, arguments, negotiations, flirting, asking for a job, talking your way out of a ticket — you type what you say or do, and the world (a language model acting as narrator and as every NPC) decides what happens. Outcomes are validated against the simulation so they stay consistent: a barista can refuse you, a friend remembers what you promised last week, and a bad idea at a store with cameras ends with a police report.
2. **The world is built from Google Maps.** Pick any US city. The game pulls real nearby places — grocery stores, gyms, schools, hospitals, bars, banks, the DMV — with their real hours, price levels, ratings and review themes, and turns them into venues with objects, staff, prices and ambience. NPCs work at those places; your commute is the real distance.

Underneath is a full simulation: needs, health and illness, money (accounts, credit, bills, loans, taxes), careers and job hunting, K-12 and college, family (romance, marriage, pregnancy, kids, aging, death, inheritance), pets, hobbies and skills, transport (walking, transit, driving, rideshare, car ownership), property (renting, buying, repairs, utilities, evictions), law (crimes, police, court, jail, licenses), civic life (jury duty, voting, benefits), entertainment, weather and seasons, holidays and festivals, and a life-events engine that keeps the days from repeating.

You can play a single character or a whole household, switching between members while the others run on autonomy.

## Stack

- **Expo SDK 57 / React Native 0.86 / TypeScript**, Expo Router, Reanimated 4, react-native-svg, Zustand.
- **Engine**: pure TypeScript under `src/engine` (no React imports), so it runs headless in Node for tests and balance runs.
- **LLM**: [OpenRouter](https://openrouter.ai) via its chat-completions API with JSON-schema structured output. Works offline with a deterministic fallback.
- **Places**: Google Places API (New), Geocoding, and Routes APIs. Works offline with a bundled mock city (Austin, TX).

See `docs/ARCHITECTURE.md` for the design contract, `docs/IDS.md` for canonical ids, and `docs/BUILDER_GUIDE.md` for module rules.

## Getting started

```bash
npm install --legacy-peer-deps
npm run typecheck      # tsc
npm test               # vitest: engine, content, world generation (24 seeds × cities × household shapes)
npm run sim            # headless 7-day balance run (SIM_DAYS=30 npm run sim for longer)
npm start              # Expo dev server (press i / a / w)
npx expo export --platform web --output-dir dist && npm run shots   # web build + Playwright screenshots (scratch/shots)
```

Open **Settings** in the app to enter:

- an **OpenRouter API key** (`sk-or-…`) — without it the game uses the offline fallback dialogue/adjudication, which is playable but flat;
- a **Google Maps Platform API key** with Places API (New), Geocoding API and Routes API enabled — without it the game uses the bundled Austin fixtures for any city you pick (the names are re-skinned to the chosen city).

Keys are stored with `expo-secure-store` on device (AsyncStorage on web) and are only ever sent to OpenRouter / Google.

## Model recommendations (OpenRouter)

| Task | Default | Why |
|---|---|---|
| NPC dialogue | `anthropic/claude-haiku-4.5` | fast, in-character, cheap enough for dozens of turns an hour |
| Freeform action adjudication | `anthropic/claude-sonnet-5` | needs judgment and strict JSON; runs ~10×/hour |
| NPC biography generation | `anthropic/claude-sonnet-5` | long, internally consistent facts; generated once per NPC on first real contact |
| Scene / venue narration | `google/gemini-2.5-flash-lite` | high volume, flavor only, no effects |
| Memory summarization | `anthropic/claude-haiku-4.5` | rare, cheap |
| Weekly story director | `anthropic/claude-opus-5` | rare, high leverage |

Presets in Settings: **Balanced** (above), **Quality** (Sonnet 5 dialogue, Opus 5 adjudication/bios), **Budget** (Gemini 2.5 Flash for dialogue/adjudication, DeepSeek V3.2 for bios). Model ids are OpenRouter slugs and can be overridden per task; Settings → "Test connection" validates them against OpenRouter's model list. A per-save budget cap stops calls once reached.

Every LLM output is a typed JSON document (zod-validated) whose effects pass through the same `validateEffects` envelope as scripted actions: a conversation can move a relationship by a bounded amount, hand over an item the NPC actually has, or start a fight — it cannot print money or teleport. The narrator sees a compact scene snapshot (venue, Google data, who is present with the facts you have discovered about them, your needs/mood, recent memories), and every NPC's revealed bio facts are frozen once discovered so characters stay consistent across sessions.

## How the world is built

1. You pick a city (search or presets). `buildRegion` derives cost of living, rent, taxes, minimum wage, climate and transit from a preset table or from coordinates.
2. `SEARCH_PLAN` runs ~40 Places API text/nearby searches around the center (grocery, cafe, gym, hospital, DMV, school, bar, church, park…). Each result is mapped by its Google `types` to one of 102 venue archetypes, which decides the objects inside, staff roles, opening hours, price multiplier and venue-level actions.
3. Staff are generated as NPCs with careers, schedules and homes in nearby apartment buildings; 28 residents, a few couples, your family, friends, neighbors, boss and coworkers are generated with consistent relationships.
4. Your home is furnished by residence type, pantry stocked, pets and vehicle added, and the first journal entry is written.

Every NPC has a full `Sim` record (needs, money, job, schedule, traits, memories) simulated at three levels of detail so a city of ~170 sims ticks at minute resolution on a phone.

## Project layout

```
app/                 Expo Router screens (title, 6-step new-game wizard, live / map / phone / sims / journal tabs, settings)
src/store/           Zustand stores (engine bridge, persistence, settings, new-game draft)
src/ui/              Theme, icons, components (procedural SVG avatars, need bars, action sheet, phone shell…)
src/engine/core/     Types, clock, RNG, event bus, effects, actions, engine loop, save/load
src/engine/systems/  One subsystem per file (21 systems)
src/engine/content/  Data catalogs (262 objects / 1,187 interactions, 122 items, 82 careers, 36 crimes, 38 holidays, 102 archetypes…)
src/engine/llm/      OpenRouter client, routing, prompts, schemas, fallback
src/engine/places/   Google provider, mock provider + fixtures, type→archetype mapping, travel
src/engine/gen/      Region presets, sim generation, world generation
scripts/             Headless runner, screenshot tool
tests/               Engine, content and world-generation tests
```

## Status

v0.1 — all subsystems present and exercised headless (14-day runs keep a two-person household alive, employed and solvent on autonomy); the web build runs the full loop from title screen to living in the world. Native builds have not been run yet (`npx expo run:ios` / `run:android` need a machine with the toolchains). See the roadmap at the end of `docs/ARCHITECTURE.md`.
