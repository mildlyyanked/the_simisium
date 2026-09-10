/**
 * Zod schemas for every structured LLM output, JSON-schema export for `response_format`,
 * and tolerant JSON extraction for models that wrap or slightly break their JSON.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Effect bundle (loose: the validator in core/effects.ts is the real gate)
// ---------------------------------------------------------------------------
const numRec = z.record(z.string(), z.number());

export const MoodletSpecSchema = z.object({
  emotion: z.string(),
  label: z.string(),
  intensity: z.number(),
  durationMinutes: z.number(),
});

export const RelationshipDeltaSchema = z.object({
  simId: z.string(),
  friendship: z.number().optional(),
  romance: z.number().optional(),
  trust: z.number().optional(),
  familiarity: z.number().optional(),
  attraction: z.number().optional(),
  mutual: z.boolean().optional(),
  flags: z.array(z.object({ flag: z.string(), op: z.enum(['add', 'remove']) })).optional(),
});

export const LegalEffectSchema = z.object({
  kind: z.enum(['charge', 'ticket', 'warrant', 'arrest', 'license', 'heat', 'release']),
  crimeId: z.string().optional(),
  label: z.string().optional(),
  amount: z.number().optional(),
  severity: z.enum(['infraction', 'misdemeanor', 'felony']).optional(),
  delta: z.number().optional(),
});

export const ScheduleSpecSchema = z.object({
  inMinutes: z.number().optional(),
  kind: z.string(),
  label: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const MemorySpecSchema = z.object({
  kind: z.string().optional(),
  text: z.string(),
  salience: z.number().optional(),
  valence: z.number().optional(),
});

export const EffectBundleSchema = z.object({
  needs: numRec.optional(),
  money: z
    .object({
      amount: z.number(),
      memo: z.string(),
      counterparty: z.string().optional(),
      category: z.string().optional(),
    })
    .optional(),
  skills: numRec.optional(),
  moodlets: z.array(MoodletSpecSchema).optional(),
  stress: z.number().optional(),
  health: z.number().optional(),
  fitness: z.number().optional(),
  bloodAlcohol: z.number().optional(),
  caffeine: z.number().optional(),
  cannabis: z.number().optional(),
  relationships: z.array(RelationshipDeltaSchema).optional(),
  memories: z.array(MemorySpecSchema).optional(),
  items: z.array(z.object({ op: z.enum(['gain', 'lose']), itemId: z.string(), qty: z.number() })).optional(),
  legal: z.array(LegalEffectSchema).optional(),
  schedule: z.array(ScheduleSpecSchema).optional(),
  moveTo: z.object({ venueId: z.string() }).optional(),
  timeElapsedMinutes: z.number().optional(),
  flags: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type EffectBundleOut = z.infer<typeof EffectBundleSchema>;

// ---------------------------------------------------------------------------
// Interaction outcome (dialogue + adjudicate)
// ---------------------------------------------------------------------------
export const DialogueLineSchema = z.object({
  speakerId: z.string(),
  text: z.string(),
  emotion: z.string().optional(),
});

export const InteractionOutcomeSchema = z.object({
  narration: z.string().optional(),
  dialogue: z.array(DialogueLineSchema).optional(),
  effects: EffectBundleSchema.optional(),
  otherEffects: z.record(z.string(), EffectBundleSchema).optional(),
  revealedFacts: z.array(z.object({ simId: z.string(), factIds: z.array(z.string()) })).optional(),
  npcMemories: z.array(z.object({ simId: z.string(), text: z.string(), salience: z.number().optional(), valence: z.number().optional() })).optional(),
  followUps: z.array(z.string()).optional(),
  endsConversation: z.boolean().optional(),
  minutes: z.number().optional(),
});
export type InteractionOutcomeOut = z.infer<typeof InteractionOutcomeSchema>;

// ---------------------------------------------------------------------------
// Bio
// ---------------------------------------------------------------------------
export const BIO_CATEGORIES = [
  'origin',
  'family',
  'childhood',
  'education',
  'career',
  'romance',
  'health',
  'money',
  'hobby',
  'belief',
  'secret',
  'fear',
  'dream',
  'habit',
  'quirk',
  'relationship',
  'trauma',
  'achievement',
  'daily_life',
  'opinion',
] as const;

export const BioFactOutSchema = z.object({
  category: z.enum(BIO_CATEGORIES),
  text: z.string(),
  secret: z.boolean(),
  depth: z.number(),
});

export const BioSchema = z.object({
  summary: z.string(),
  facts: z.array(BioFactOutSchema),
});
export type BioOut = z.infer<typeof BioSchema>;

// ---------------------------------------------------------------------------
// Director
// ---------------------------------------------------------------------------
export const DirectorSchema = z.object({
  beats: z.array(
    z.object({
      label: z.string(),
      simId: z.string().optional(),
      inMinutes: z.number(),
      kind: z.string(),
      payload: z.object({ text: z.string(), options: z.array(z.string()).optional() }).optional(),
    }),
  ),
});
export type DirectorOut = z.infer<typeof DirectorSchema>;

// ---------------------------------------------------------------------------
// NPC message / simple text wrappers
// ---------------------------------------------------------------------------
export const NpcMessageSchema = z.object({
  text: z.string(),
  emotion: z.string().optional(),
});
export type NpcMessageOut = z.infer<typeof NpcMessageSchema>;

export const TextSchema = z.object({ text: z.string() });

// ---------------------------------------------------------------------------
// JSON schema export
// ---------------------------------------------------------------------------
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const out = z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

// ---------------------------------------------------------------------------
// Tolerant JSON extraction
// ---------------------------------------------------------------------------
/** Strip ```json fences and surrounding prose; returns the raw candidate text. */
export function stripCodeFences(text: string): string {
  const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/m.exec(text);
  if (fence && fence[1]) return fence[1].trim();
  return text.trim();
}

/** Find the first balanced `{…}` (string-aware). Closes unterminated objects best-effort. */
export function firstBalancedObject(text: string): string | undefined {
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  if (depth > 0) return text.slice(start) + '}'.repeat(depth);
  return undefined;
}

/** Common LLM JSON damage: trailing commas, smart quotes, comments, raw newlines in strings. */
export function repairJson(text: string): string {
  let t = text;
  t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  t = t.replace(/^\s*\/\/.*$/gm, '');
  t = t.replace(/,\s*([}\]])/g, '$1');
  t = t.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  t = t.replace(/"((?:[^"\\]|\\.)*)"/g, (m) => m.replace(/\n/g, '\\n').replace(/\r/g, ''));
  t = t.replace(/:\s*(NaN|-?Infinity|undefined)\b/g, ': null');
  return t;
}

/**
 * Extract the first JSON object from a model reply. Tolerates fences, prose before/after,
 * trailing commas and a few other common slips. Returns undefined when nothing parses.
 */
export function extractJson(text: string): unknown {
  if (!text) return undefined;
  const candidates: string[] = [];
  const stripped = stripCodeFences(text);
  candidates.push(stripped);
  const bal = firstBalancedObject(stripped);
  if (bal) candidates.push(bal);
  const balRaw = firstBalancedObject(text);
  if (balRaw && balRaw !== bal) candidates.push(balRaw);
  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v === 'object') return v;
    } catch {
      /* try repaired */
    }
    try {
      const v = JSON.parse(repairJson(c));
      if (v && typeof v === 'object') return v;
    } catch {
      /* next candidate */
    }
  }
  return undefined;
}
