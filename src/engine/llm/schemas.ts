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
/** Numbers as the model writes them: 5, "5", "+5", "-3.5". */
const num = z.preprocess((v) => {
  if (typeof v === 'string') {
    const n = Number(v.trim().replace(/^\+/, ''));
    return Number.isFinite(n) ? n : v;
  }
  return v;
}, z.number());
const numRecLoose = z.record(z.string(), num.catch(0));
/** Array whose malformed entries drop out instead of failing the parse. */
const looseArray = <T extends z.ZodType>(item: T) =>
  z
    .array(item.nullable().catch(null))
    .transform((a) => a.filter((x): x is z.output<T> => x !== null))
    .optional()
    .catch(undefined);

export const DialogueLineSchema = z.object({
  speakerId: z.string(),
  text: z.string(),
  emotion: z.string().optional().catch(undefined),
});

/**
 * Lenient outcome schema: a malformed corner of the response drops out instead of failing the
 * whole turn (the engine's effect validator is the real gate). Field aliases are normalized by
 * `normalizeOutcomeShape` before parsing.
 */
const LooseEffectBundleSchema = z.object({
  needs: numRecLoose.optional().catch(undefined),
  money: z.object({ amount: num, memo: z.string().catch('Exchange'), counterparty: z.string().optional().catch(undefined), category: z.string().optional().catch(undefined) }).optional().catch(undefined),
  skills: numRecLoose.optional().catch(undefined),
  moodlets: looseArray(z.object({ emotion: z.string(), label: z.string(), intensity: num, durationMinutes: num.catch(60) })),
  stress: num.optional().catch(undefined),
  health: num.optional().catch(undefined),
  fitness: num.optional().catch(undefined),
  bloodAlcohol: num.optional().catch(undefined),
  caffeine: num.optional().catch(undefined),
  cannabis: num.optional().catch(undefined),
  relationships: looseArray(z.object({ simId: z.string(), friendship: num.optional().catch(undefined), romance: num.optional().catch(undefined), trust: num.optional().catch(undefined), familiarity: num.optional().catch(undefined), attraction: num.optional().catch(undefined), mutual: z.boolean().optional().catch(undefined), flags: z.array(z.object({ flag: z.string(), op: z.enum(['add', 'remove']) })).optional().catch(undefined) })),
  memories: looseArray(MemorySpecSchema),
  items: looseArray(z.object({ op: z.enum(['gain', 'lose']), itemId: z.string(), qty: num.catch(1) })),
  legal: looseArray(LegalEffectSchema),
  schedule: looseArray(z.object({ inMinutes: num.optional().catch(undefined), kind: z.string(), label: z.string(), payload: z.record(z.string(), z.unknown()).optional().catch(undefined) })),
  moveTo: z.object({ venueId: z.string() }).optional().catch(undefined),
  timeElapsedMinutes: num.optional().catch(undefined),
  flags: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().catch(undefined),
});

/** Strict shape sent to the API as response_format (models follow a clean schema better). */
export const InteractionOutcomeWireSchema = z.object({
  narration: z.string().optional(),
  dialogue: z.array(z.object({ speakerId: z.string(), text: z.string(), emotion: z.string().optional() })).optional(),
  effects: EffectBundleSchema.optional(),
  otherEffects: z.record(z.string(), EffectBundleSchema).optional(),
  revealedFacts: z.array(z.object({ simId: z.string(), factIds: z.array(z.string()) })).optional(),
  npcMemories: z.array(z.object({ simId: z.string(), text: z.string(), salience: z.number().optional(), valence: z.number().optional() })).optional(),
  followUps: z.array(z.string()).optional(),
  endsConversation: z.boolean().optional(),
  startConversationWith: z.string().optional(),
  minutes: z.number().optional(),
});

export const InteractionOutcomeSchema = z.object({
  narration: z.string().optional().catch(undefined),
  dialogue: looseArray(DialogueLineSchema),
  effects: LooseEffectBundleSchema.optional().catch(undefined),
  otherEffects: z.record(z.string(), LooseEffectBundleSchema.catch({})).optional().catch(undefined),
  revealedFacts: looseArray(z.object({ simId: z.string(), factIds: z.array(z.string()) })),
  npcMemories: looseArray(z.object({ simId: z.string(), text: z.string(), salience: num.optional().catch(undefined), valence: num.optional().catch(undefined) })),
  followUps: z.array(z.string().catch('')).optional().catch(undefined),
  endsConversation: z.boolean().optional().catch(undefined),
  startConversationWith: z.string().optional().catch(undefined),
  minutes: num.optional().catch(undefined),
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

/** Close a JSON document cut off mid-way (max_tokens): finish the open string, then the open containers. */
export function closeTruncatedJson(text: string): string {
  const start = text.indexOf('{');
  if (start < 0) return text;
  let t = text.slice(start).replace(/\s+$/, '');
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (inStr) t += '"';
  // drop a dangling key or separator ("...,  "key":  <EOF>)
  t = t.replace(/,\s*$/, '').replace(/:\s*$/, ': null').replace(/,\s*"[^"]*"\s*$/, '');
  while (stack.length) t += stack.pop();
  return t;
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
  // last resort: the reply was cut off mid-object
  try {
    const v = JSON.parse(repairJson(closeTruncatedJson(stripped)));
    if (v && typeof v === 'object') return v;
  } catch {
    /* give up */
  }
  return undefined;
}


/**
 * Normalize common shape drift in model output before parsing: field aliases
 * (speaker → speakerId, npcId → simId), a single dialogue object instead of an array,
 * dialogue given as a string, effects wrapped one level deep.
 */
export function normalizeOutcomeShape(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const o = { ...(raw as Record<string, unknown>) };
  const alias = (obj: Record<string, unknown>, from: string[], to: string): void => {
    if (obj[to] !== undefined) return;
    for (const f of from) if (obj[f] !== undefined) { obj[to] = obj[f]; return; }
  };
  alias(o, ['narrative', 'text', 'description'], 'narration');
  alias(o, ['lines', 'speech', 'replies', 'reply'], 'dialogue');
  alias(o, ['playerEffects', 'actorEffects', 'effect'], 'effects');
  alias(o, ['npcEffects', 'others'], 'otherEffects');
  alias(o, ['suggestions', 'options', 'nextMoves'], 'followUps');
  alias(o, ['timeMinutes', 'elapsedMinutes', 'duration'], 'minutes');
  alias(o, ['startConversation', 'conversationWith', 'openConversationWith'], 'startConversationWith');
  if (typeof o.dialogue === 'string') o.dialogue = [{ speakerId: 'narrator', text: o.dialogue }];
  if (o.dialogue && typeof o.dialogue === 'object' && !Array.isArray(o.dialogue)) o.dialogue = [o.dialogue];
  if (Array.isArray(o.dialogue)) {
    o.dialogue = o.dialogue.map((d) => {
      if (typeof d === 'string') return { speakerId: 'narrator', text: d };
      if (!d || typeof d !== 'object') return d;
      const line = { ...(d as Record<string, unknown>) };
      alias(line, ['speaker', 'simId', 'id', 'who', 'name', 'npcId'], 'speakerId');
      alias(line, ['line', 'content', 'message', 'says'], 'text');
      return line;
    });
  }
  if (o.startConversationWith && typeof o.startConversationWith === 'object') {
    const sc = o.startConversationWith as Record<string, unknown>;
    o.startConversationWith = sc.simId ?? sc.id ?? sc.npcId;
  }
  if (typeof o.startConversationWith === 'boolean') delete o.startConversationWith;
  for (const key of ['effects']) {
    const e = o[key];
    if (e && typeof e === 'object' && !Array.isArray(e)) {
      const eo = e as Record<string, unknown>;
      // some models wrap the bundle: { effects: { player: {...} } }
      if (eo.player && typeof eo.player === 'object' && Object.keys(eo).length === 1) o[key] = eo.player;
    } else if (e !== undefined && (typeof e !== 'object' || Array.isArray(e))) delete o[key];
  }
  if (o.otherEffects && (typeof o.otherEffects !== 'object' || Array.isArray(o.otherEffects))) delete o.otherEffects;
  if (typeof o.followUps === 'string') o.followUps = [o.followUps];
  return o;
}
