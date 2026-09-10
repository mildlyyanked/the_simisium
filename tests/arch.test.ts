import { it, expect } from 'vitest';
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
  expect(badObj.size).toBe(0);
  expect(badCareer.size).toBe(0);
});
