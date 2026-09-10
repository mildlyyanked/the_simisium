/**
 * Headless balance run. Not a unit test — an opt-in simulation report.
 *   SIM_DAYS=14 npm run sim
 * Generates a world with the mock Places provider and the offline LLM fallback,
 * lets NPC autonomy and the player household run for N days, and prints a report.
 */
import { describe, it } from 'vitest';
import { Engine } from '../src/engine/core/engine';
import { CONTENT } from '../src/engine/content';
import { SYSTEMS } from '../src/engine/systems';
import { holidayResolver } from '../src/engine/systems/calendar';
import { generateWorld } from '../src/engine/gen/worldgen';
import { buildRegion } from '../src/engine/gen/region';
import { createPlacesProvider } from '../src/engine/places';
import { createLLMService } from '../src/engine/llm';
import { formatMoney } from '../src/engine/core/util';
import { formatDateTime } from '../src/engine/core/clock';

const DAYS = Number(process.env.SIM_DAYS ?? 0);

describe.skipIf(!DAYS)('headless simulation', () => {
  it(`runs ${DAYS} days`, async () => {
    const places = createPlacesProvider({});
    const llm = createLLMService({ content: CONTENT });
    const region = buildRegion({ name: 'Austin', state: 'Texas', stateCode: 'TX', center: { lat: 30.2672, lng: -97.7431 } });
    const state = await generateWorld({
      seed: process.env.SIM_SEED ?? 'headless',
      epoch: '2026-09-10',
      name: 'Headless',
      region,
      places,
      household: {
        name: 'Rivera',
        residence: 'apartment',
        startingCash: 2500,
        members: [
          { firstName: 'Ana', lastName: 'Rivera', gender: 'female', age: 29, traits: ['ambitious', 'foodie'], careerId: 'barista', hobbies: ['running'] },
          { firstName: 'Leo', lastName: 'Rivera', gender: 'male', age: 31, traits: ['lazy', 'cheerful'], careerId: 'software_engineer', relationship: 'spouse' },
        ],
        pets: [{ species: 'dog', name: 'Biscuit' }],
        vehicle: 'used_car',
      },
      onProgress: (m) => process.stdout.write(`  · ${m}\n`),
    });
    const engine = new Engine(state, { content: CONTENT, systems: SYSTEMS, llm, holidayResolver });
    engine.init(true);
    for (const id of state.player.controlledSimIds) state.sims[id].flags.autonomy = true;

    const t0 = Date.now();
    const events: Record<string, number> = {};
    engine.bus.on((e) => {
      events[e.type] = (events[e.type] ?? 0) + 1;
    });
    for (let d = 0; d < DAYS; d++) {
      engine.advance(1440, { allowInterrupt: false });
      state.pendingInterrupts = [];
    }
    const ms = Date.now() - t0;

    const lines: string[] = [];
    lines.push(`\n=== HEADLESS REPORT: ${DAYS} days in ${ms} ms (${(ms / DAYS).toFixed(0)} ms/day) ===`);
    lines.push(`Now: ${formatDateTime(state.epoch, state.time.minute)} | venues ${Object.keys(state.venues).length} | sims ${Object.keys(state.sims).length} | objects ${Object.keys(state.objects).length}`);
    for (const id of state.player.controlledSimIds) {
      const s = state.sims[id];
      const cash = s.finance.accounts.filter((a) => a.kind !== 'credit_card').reduce((x, a) => x + a.balance, 0);
      const debt = s.finance.accounts.filter((a) => a.kind === 'credit_card').reduce((x, a) => x + a.balance, 0) + s.finance.loans.reduce((x, l) => x + l.balance, 0);
      lines.push(`- ${s.identity.firstName}: alive=${s.body.alive} mood=${s.mind.mood.toFixed(0)} stress=${s.mind.stress.toFixed(0)} health=${s.body.health.toFixed(0)} needs=${Object.entries(s.needs).map(([k, v]) => `${k[0]}${v.toFixed(0)}`).join(' ')} cash=${formatMoney(cash)} debt=${formatMoney(debt)} job=${s.career.job?.title ?? '—'} perf=${s.career.job?.performance.toFixed(0) ?? '—'} skills=${Object.entries(s.skills).filter(([, v]) => v.level > 0).map(([k, v]) => `${k}:${v.level}`).join(',') || '—'} rels=${Object.keys(s.relationships).length}`);
    }
    const top = Object.entries(events).sort((a, b) => b[1] - a[1]).slice(0, 25);
    lines.push('Events: ' + top.map(([k, v]) => `${k}=${v}`).join(' '));
    const important = state.log.filter((l) => l.importance >= 2).slice(-15);
    lines.push('Notable log:');
    for (const l of important) lines.push(`  [${formatDateTime(state.epoch, l.at)}] ${l.text}`);
    const nan = JSON.stringify(state).includes('null') ? '' : '';
    lines.push(nan);
    console.log(lines.join('\n'));
    // sanity
    const json = JSON.stringify(state);
    if (json.includes('NaN')) throw new Error('NaN found in state');
  }, 600_000);
});
