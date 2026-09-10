import { it, expect } from 'vitest';
import { writeFileSync, readFileSync } from 'node:fs';
import { ARCHETYPES, ARCHETYPE_IDS } from '../src/engine/content/archetypes';
import { OBJECTS } from '../src/engine/content/objects';
import { CAREERS } from '../src/engine/content/careers';
it('archetypes complete', () => {
  const badObj = new Set<string>(); const badCareer = new Set<string>(); const noTypes: string[] = [];
  let objs = 0, acts = 0, staff = 0;
  for (const id of ARCHETYPE_IDS) {
    const a = ARCHETYPES[id];
    for (const o of a.objects) { objs++; if (!OBJECTS[o.defId]) badObj.add(o.defId); }
    for (const s of a.staff) { staff += s.count; if (!CAREERS[s.careerId]) badCareer.add(s.careerId); }
    acts += a.actions.length;
    if (!a.googleTypes.length && id !== 'home' && id !== 'unknown') noTypes.push(id);
  }
  writeFileSync('scratch/arch.txt', `archetypes=${ARCHETYPE_IDS.length} objectSlots=${objs} staffSlots=${staff} venueActions=${acts}\nbadObjects=${[...badObj].join(',')}\nbadCareers=${[...badCareer].join(',')}\nnoGoogleTypes=${noTypes.join(',')}\n`);
  expect(badObj.size).toBe(0);
  expect(badCareer.size).toBe(0);
});
