import { it, expect } from 'vitest';
import { generateWorld } from '../src/engine/gen/worldgen';
import { MockPlacesProvider } from '../src/engine/places/mock';
import { buildRegion, REGION_PRESETS } from '../src/engine/gen/region';
import { CONTENT } from '../src/engine/content';
it('generates a playable world for many seeds, cities, residences and household shapes', async () => {
  const fails: string[] = [];
  const cities = Object.keys(REGION_PRESETS);
  for (let i = 1; i <= 24; i++) {
    const key = cities[i % cities.length];
    const p = REGION_PRESETS[key] as any; const region = buildRegion({ name: p.name, stateCode: p.stateCode, center: p.center ?? { lat: p.lat, lng: p.lng } });
    const gender = (['female', 'male', 'nonbinary'] as const)[i % 3];
    try {
      await generateWorld({
        seed: `s${i}`, epoch: '2026-09-10', name: 'x', region,
        places: new MockPlacesProvider(),
        household: { name: 'H', residence: (['apartment', 'house', 'room', 'family_home'] as const)[i % 4], startingCash: 2500, members: [{ firstName: 'A', lastName: 'B', gender, age: 18 + (i * 7) % 60, traits: ['ambitious', 'outgoing'], careerId: i % 5 === 0 ? 'unemployed' : i % 5 === 1 ? 'student' : undefined }], pets: i % 6 === 0 ? [{ species: 'dog', name: 'Rex' } as any] : undefined },
        content: CONTENT,
      } as any);
    } catch (e: any) {
      fails.push(`seed ${i} ${key} ${i % 4}: ${e?.message}\n${(e?.stack ?? '').split('\n').slice(1, 6).join('\n')}`);
    }
  }
  if (fails.length) process.stdout.write(fails.join('\n---\n') + '\n');
  expect(fails).toEqual([]);
}, 600000);
