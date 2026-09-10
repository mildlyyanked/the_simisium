import { it, expect } from 'vitest';
import { writeFileSync, readFileSync } from 'node:fs';
import { CONTENT } from './index';
it('counts', () => {
  const c = CONTENT as unknown as Record<string, any>;
  const out: string[] = [];
  for (const k of Object.keys(c)) {
    const v = c[k];
    out.push(`${k}=${Array.isArray(v) ? v.length : typeof v === 'object' && v ? Object.keys(v).length : '?'}`);
  }
  const inter = Object.values(CONTENT.objects).reduce((s, d) => s + d.interactions.length, 0);
  // cross-check IDS.md object ids
  const ids = readFileSync('docs/IDS.md', 'utf8');
  const sec = ids.split('## Object def ids')[1].split('## Careers')[0];
  const wanted = [...sec.matchAll(/`([^`]+)`/g)].flatMap((m) => m[1].split(/\s+/)).filter((s) => /^[a-z][a-z0-9_]+$/.test(s));
  const missing = wanted.filter((w) => !CONTENT.objects[w]);
  writeFileSync('scratch/counts.txt', out.join('\n') + `\nobjectInteractions=${inter}\nwantedObjects=${wanted.length}\nmissingObjects(${missing.length})=${missing.join(',')}\n`);
  expect(true).toBe(true);
});
