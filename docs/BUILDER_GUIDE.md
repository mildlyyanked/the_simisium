# Builder Guide (for every module author)

Read first, in this order: `docs/ARCHITECTURE.md`, `docs/IDS.md`, `src/engine/core/types.ts`, `src/engine/core/systems.ts`, `src/engine/core/effects.ts`, `src/engine/core/actions.ts`, `src/engine/core/engine.ts`, `src/engine/core/factories.ts`, `src/engine/content/types.ts`, and `src/engine/core/engine.test.ts` (shows how to build a test world).

## Hard rules
1. `src/engine/**` is pure TypeScript. **No** imports from `react`, `react-native`, `expo-*`, or `src/ui`/`src/store`/`app`.
2. **Never** use `Math.random()` or `Date.now()` inside the engine — use `ctx.rng` and `ctx.state.time.minute`. (`new Date()` is only allowed for `meta.updatedAt`.)
3. Systems never import other systems. Communicate via `ctx.emit(event)` (types in `core/events.ts`) or via shared `WorldState`.
4. Do **not** edit files under `src/engine/core/` or `src/engine/content/types.ts`. If you truly need a change there, keep working around it and describe the exact change in your final report.
5. Do **not** edit `src/engine/systems/index.ts` or `src/engine/content/index.ts` (the integrator wires registration). Export named constants exactly as your assignment says.
6. Do **not** run `git` commands. Other builders work in this tree concurrently; only touch the files you own.
7. Money: dollars rounded to cents (`round2`). Needs 0..100. Relationship axes −100..100. Skills 0..10.
8. Log lines are the player's narrative feed: second person for controlled sims ("You…"), third person for NPCs. Use `ctx.log({ text, kind, simId, importance })`. Importance 0 = debug, 1 = normal, 2 = notable, 3 = major life event.
9. Every world change goes through `ctx.applyEffects(simId, bundle, source)` when it fits the `EffectBundle` vocabulary. Direct state mutation is fine for things the vocabulary doesn't cover (your own sub-records).
10. Content is *data*: big, comprehensive catalogs. Fidelity is the priority. Use realistic present-day US prices, hours, wages, and rules. Scale prices by `venue.priceMultiplier` and `state.region.costOfLiving` where relevant.
11. Actions you contribute via `System.actions(ctx, simId)` must be executable: implement `handles(actionId)` + `execute(ctx, simId, action, params)` for anything the generic pipeline (cost → duration → effects/outcomes) can't do alone. `execute` runs **before** time advances; return `{ ok, text, effects?, durationMinutes? }`. To make something happen at completion, listen for `action:completed` with your action id.
12. Interrupts (`ctx.interrupt`) stop the clock and surface a modal to the player. Use them for things a human would stop for: a phone call, police, a collapse, a fire, a delivery at the door. Give `options` with actionIds your system `handles`.
13. Scheduled events: `ctx.schedule({ inMinutes|atMinute, kind, label, simId, payload })`; react in `onEvent` to `scheduled:fired` where `event.kind` is yours.
14. NPCs share the Sim schema. Respect `sim.lod`: only `full` sims need per-minute fidelity; `near` every 15 min; `far` daily rollups. Never iterate every sim every minute — batch by lod.
15. Tests: `vitest`, colocated as `*.test.ts` next to your files. Build a world with the factories (see `engine.test.ts`), run your system through `Engine`, assert invariants (no NaN, bounds respected, events emitted, money conserved). At least one test must run 7 sim-days.
16. Verify with `npx tsc --noEmit -p .` (whole project must stay clean) and `npx vitest run <your test paths>` before you report done. Fix everything you break.
17. Final report: list files created, exported symbols, event types you emit/consume, action id prefixes you handle, and anything the integrator must wire.

## Helpful patterns
- Creating a test world: see `src/engine/core/engine.test.ts`.
- Reading content: `ctx.content.objects[defId]`, `ctx.content.careers[id]`, etc.
- Money: `transact(sim, amount, memo, now, opts)` from `core/effects.ts` for direct debits/credits; or `ctx.applyEffects(simId, { money: { amount, memo } }, src)`.
- Moodlets: `ctx.applyEffects(simId, { moodlets: [{ emotion, label, intensity, durationMinutes }] }, src)`.
- Relationship: `ensureRelationship(sim, otherId, now)` and `{ relationships: [{ simId, friendship: +3, mutual: true }] }`.
- Where is a sim: `sim.location.venueId` (or `sim.travel` while moving). Present sims: `ctx.query.simsAt(venueId)`.
- Clock: `ctx.clock.minuteOfDay`, `ctx.clock.weekday`, `ctx.clock.day.isSchoolDay`, `ctx.clock.season`, `ctx.clock.partOfDay`.
- Ids: `shortId(ctx.rng, 'prefix')`, `newSimId(ctx.rng)`, etc. from `core/ids.ts`.
