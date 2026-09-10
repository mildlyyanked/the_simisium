/**
 * Scene context: everything the model must know about the moment, compact and consistent.
 * `buildSceneContext` gathers; `renderSceneContext` prints it deterministically (stable order)
 * so identical scenes produce identical prompts (good for caching).
 */
import type { ContentCatalog } from '../content/types';
import { ageAt, clockInfo, formatClock, minuteOfDay, weekdayAt, weekdayName, type HolidayResolver } from '../core/clock';
import { DEFAULT_ENVELOPE } from '../core/effects';
import type { SceneSnapshot } from '../core/llmTypes';
import { makeQuery } from '../core/query';
import type { BioFact, Conversation, Relationship, Sim, SimId, Venue, VenueId, WorldState } from '../core/types';
import { haversineKm, kmToMiles } from '../core/util';
import { recentMemories, relevantMemories } from './memory';

export interface WorldContext {
  dateLabel: string;
  timeLabel: string;
  weekday: string;
  partOfDay: string;
  season: string;
  holidays: string[];
  weather: string;
  region: string;
  culture: string;
}

export interface VenueContext {
  id: VenueId;
  name: string;
  archetype: string;
  typesPhrase?: string;
  rating?: string;
  priceLevel?: string;
  openNow: boolean;
  hoursToday?: string;
  editorialSummary?: string;
  reviewSnippets: string[];
  reviewThemes: string[];
  ambience?: string;
  objects: string[];
  crowd: string;
  cleanliness: number;
  safety: number;
  isHome: boolean;
  /** item ids obtainable here (venue sells + inventory + pantry when home) */
  allowedItems: string[];
  /** venues the actor may move to (id + name + archetype + distance) */
  knownVenues: { id: VenueId; name: string; archetype: string; miles: number }[];
}

export interface ActorContext {
  id: SimId;
  name: string;
  firstName: string;
  age: number;
  gender: string;
  pronouns: string;
  appearance: string;
  traits: string[];
  mood: string;
  needs: string[];
  state: string[];
  money: string;
  occupation: string;
  inventory: string[];
  aspiration?: string;
  currentAction?: string;
  skills: string[];
}

export interface NpcContext {
  id: SimId;
  name: string;
  firstName: string;
  age: number;
  gender: string;
  pronouns: string;
  role?: string;
  appearance: string;
  traits: string[];
  traitHints: string[];
  personality: string;
  speechStyle: string;
  honesty: number;
  mood: string;
  needs: string[];
  state: string[];
  bioSummary: string;
  /** full fact list only for the primary interlocutor */
  facts?: { id: string; category: string; text: string; secret: boolean; depth: number; known: boolean }[];
  relationship: string;
  relationshipNumbers: string;
  grudges: string[];
  promises: string[];
  moneyOwed?: string;
  memories: string[];
  recentMemories: string[];
  currentAction?: string;
  schedule?: string;
  primary: boolean;
}

export interface SceneContext {
  world: WorldContext;
  venue: VenueContext;
  actor: ActorContext;
  npcs: NpcContext[];
  primaryId?: SimId;
  recentLog: string[];
  conversation?: { channel: string; summary?: string; turns: { speaker: string; text: string }[]; topic?: string };
  rules: {
    maxNeedDelta: number;
    maxRelationshipDelta: number;
    maxMoneyGain: number;
    maxMoneySpend: number;
    maxSkillXp: number;
    maxHealthDelta: number;
    maxTimeElapsed: number;
    allowMoveTo: boolean;
    allowLegal: boolean;
    presentSimIds: SimId[];
    allowedItems: string[];
    knownVenueIds: VenueId[];
    crimeIds: string[];
    skillIds: string[];
    emotionIds: string[];
  };
}

export interface BuildContextOptions {
  content: ContentCatalog;
  /** the NPC being addressed; gets the full bio */
  primaryId?: SimId;
  holidayResolver?: HolidayResolver;
  maxNpcs?: number;
  /** freeform scenes may move; conversations may not */
  allowMoveTo?: boolean;
  channel?: Conversation['channel'];
}

const EMOTIONS = ['happy', 'sad', 'angry', 'anxious', 'stressed', 'bored', 'energized', 'tired', 'inspired', 'flirty', 'embarrassed', 'confident', 'lonely', 'grateful', 'guilty', 'proud', 'jealous', 'grieving', 'scared', 'focused', 'playful', 'sick', 'uncomfortable', 'tense', 'relaxed', 'nostalgic', 'hopeful', 'in_love'];

const GENERIC_GOOGLE_TYPES = new Set(['point_of_interest', 'establishment', 'food', 'store', 'health', 'finance', 'premise', 'locality', 'political', 'geocode']);

export function buildSceneContext(scene: SceneSnapshot, opts: BuildContextOptions): SceneContext {
  const { state, actor, venue } = scene;
  const content = opts.content;
  const now = state.time.minute;
  const query = makeQuery(state, content);
  const clock = clockInfo(state.epoch, now, state.region.center.lat, opts.holidayResolver ?? (() => []));

  // ---- world
  const w = state.weather.current;
  const world: WorldContext = {
    dateLabel: clock.dateLabel,
    timeLabel: clock.timeLabel,
    weekday: weekdayName(clock.weekday),
    partOfDay: clock.partOfDay.replace('_', ' '),
    season: clock.season,
    holidays: clock.day.holidays.map((h) => content.holidays[h]?.name ?? titleWords(h)),
    weather: `${w.condition.replace(/_/g, ' ')}, ${Math.round(w.tempF)}°F${w.windMph >= 15 ? `, windy (${Math.round(w.windMph)} mph)` : ''}${w.alert ? ` — ALERT: ${w.alert}` : ''}${clock.isDaylight ? '' : ', dark out'}`,
    region: `${state.region.name}, ${state.region.state}`,
    culture: state.region.culture,
  };

  // ---- venue
  const arch = content.archetypes[venue.archetype];
  const g = venue.google;
  const home = query.homeOf(actor.id);
  const isHome = !!home && home.id === venue.id;
  const objects = venue.objectIds
    .map((id) => state.objects[id])
    .filter((o): o is NonNullable<typeof o> => !!o)
    .map((o) => {
      const def = content.objects[o.defId];
      const name = o.name ?? def?.name ?? titleWords(o.defId);
      const flags = [o.state.broken ? 'broken' : '', (o.state.dirty ?? 0) > 60 ? 'dirty' : '', o.state.occupiedBy && o.state.occupiedBy !== actor.id ? 'in use' : ''].filter(Boolean);
      return flags.length ? `${name} (${flags.join(', ')})` : name;
    });
  const objectNames = dedupeCount(objects).slice(0, 12);
  const allowedItems = collectAllowedItems(state, actor, venue, content, isHome);
  const knownVenues = Object.values(state.venues)
    .filter((v) => v.id !== venue.id && (v.discovered || v.id === home?.id || v.id === actor.career.job?.employerVenueId))
    .map((v) => ({ id: v.id, name: v.name, archetype: v.archetype, miles: Math.round(kmToMiles(haversineKm(venue.location, v.location)) * 10) / 10 }))
    .sort((a, b) => a.miles - b.miles || a.name.localeCompare(b.name))
    .slice(0, 12);
  const crowdLevel = arch?.crowdByHour?.[clock.hour];
  const venueCtx: VenueContext = {
    id: venue.id,
    name: venue.name,
    archetype: arch?.name ?? titleWords(venue.archetype),
    typesPhrase: g ? googleTypesPhrase(g.types, g.primaryType) : undefined,
    rating: g?.rating !== undefined ? `${g.rating.toFixed(1)}★${g.userRatingCount ? ` (${g.userRatingCount.toLocaleString('en-US')} reviews)` : ''}` : undefined,
    priceLevel: g?.priceLevel !== undefined ? priceLevelLabel(g.priceLevel) : undefined,
    openNow: query.isVenueOpen(venue.id),
    hoursToday: hoursToday(venue, state, now, content),
    editorialSummary: g?.editorialSummary,
    reviewSnippets: (g?.reviewSnippets ?? []).slice(0, 2).map((s) => s.trim().slice(0, 180)),
    reviewThemes: (g?.reviewThemes ?? []).slice(0, 6),
    ambience: arch?.llmHint,
    objects: objectNames,
    crowd: crowdLabel(crowdLevel, venue.noise),
    cleanliness: Math.round(venue.cleanliness),
    safety: Math.round(venue.safety),
    isHome,
    allowedItems,
    knownVenues,
  };

  // ---- actor
  const actorCtx = buildActor(state, actor, content, now);

  // ---- npcs
  const maxNpcs = opts.maxNpcs ?? 6;
  const others = scene.present.filter((s) => s.id !== actor.id && s.body.alive);
  const ranked = others
    .map((s) => ({ s, score: (s.id === opts.primaryId ? 1e6 : 0) + (actor.relationships[s.id]?.familiarity ?? 0) + (actor.relationships[s.id]?.friendship ?? 0) / 2 + (s.lod === 'full' ? 5 : 0) }))
    .sort((a, b) => b.score - a.score || a.s.id.localeCompare(b.s.id))
    .slice(0, maxNpcs)
    .map((x) => x.s);
  const npcs = ranked.map((npc) => buildNpc(state, actor, npc, content, now, npc.id === opts.primaryId));

  // ---- recent log
  const recentLog = state.log
    .filter((l) => (l.venueId === venue.id || (!l.venueId && l.simId === actor.id)) && l.kind !== 'system' && l.importance >= 1)
    .slice(-8)
    .map((l) => {
      const who = l.speakerId ? nameOf(state, l.speakerId) : undefined;
      return who ? `${who}: "${l.text}"` : l.text;
    });

  // ---- conversation
  let conversation: SceneContext['conversation'];
  if (scene.conversation) {
    const c = scene.conversation;
    const turns = c.turns.length > 20 && c.summary ? c.turns.slice(-8) : c.turns.slice(-20);
    conversation = {
      channel: opts.channel ?? c.channel,
      summary: c.turns.length > 20 ? c.summary : undefined,
      topic: c.topic,
      turns: turns.map((t) => ({ speaker: t.speakerId === 'narrator' ? 'Narrator' : t.speakerId === actor.id ? actor.identity.firstName : nameOf(state, t.speakerId), text: t.action ? `*${t.action}* ${t.text}`.trim() : t.text })),
    };
  }

  return {
    world,
    venue: venueCtx,
    actor: actorCtx,
    npcs,
    primaryId: opts.primaryId,
    recentLog,
    conversation,
    rules: {
      ...DEFAULT_ENVELOPE,
      allowMoveTo: opts.allowMoveTo ?? false,
      presentSimIds: others.map((s) => s.id).sort(),
      allowedItems,
      knownVenueIds: knownVenues.map((v) => v.id),
      crimeIds: Object.keys(content.crimes).sort(),
      skillIds: Object.keys(content.skills).sort(),
      emotionIds: EMOTIONS,
    },
  };
}

// ---------------------------------------------------------------------------
// Sub-builders
// ---------------------------------------------------------------------------
function buildActor(state: WorldState, sim: Sim, content: ContentCatalog, now: number): ActorContext {
  const age = ageAt(sim.identity.birthDate, state.epoch, now);
  const inv = Object.entries(sim.inventory.consumables)
    .filter(([, q]) => q > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, q]) => `${content.items[id]?.name ?? titleWords(id)}${q > 1 ? ` ×${q}` : ''}`);
  const objs = sim.inventory.objectIds.map((id) => state.objects[id]).filter(Boolean).map((o) => o!.name ?? content.objects[o!.defId]?.name ?? titleWords(o!.defId));
  const skills = Object.entries(sim.skills)
    .filter(([, s]) => s.level >= 2)
    .sort((a, b) => b[1].level - a[1].level)
    .slice(0, 6)
    .map(([id, s]) => `${content.skills[id]?.name ?? titleWords(id)} ${s.level}`);
  const asp = sim.aspirations.find((a) => !a.completed);
  return {
    id: sim.id,
    name: fullName(sim),
    firstName: sim.identity.firstName,
    age,
    gender: sim.identity.gender,
    pronouns: sim.identity.pronouns,
    appearance: appearanceLine(sim),
    traits: sim.personality.traits.map((t) => content.traits[t]?.name ?? titleWords(t)),
    mood: moodLine(sim),
    needs: needWords(sim),
    state: stateWords(sim, now),
    money: moneyLine(sim),
    occupation: occupationLine(sim, state, age),
    inventory: [...objs, ...inv].slice(0, 10),
    aspiration: asp ? `${asp.text} (${asp.progress}% there)` : undefined,
    currentAction: sim.currentAction?.label,
    skills,
  };
}

function buildNpc(state: WorldState, actor: Sim, npc: Sim, content: ContentCatalog, now: number, primary: boolean): NpcContext {
  const age = ageAt(npc.identity.birthDate, state.epoch, now);
  const rel = npc.relationships[actor.id];
  const facts = primary
    ? [...npc.bio.facts]
        .sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id))
        .map((f) => ({ id: f.id, category: f.category, text: f.text, secret: f.secret, depth: f.depth, known: f.revealedTo.includes(actor.id) }))
    : undefined;
  const memories = relevantMemories(npc, actor.id, 8).map((m) => memoryLine(m, state, now));
  const recent = recentMemories(npc, 3)
    .filter((m) => !m.participants.includes(actor.id))
    .map((m) => memoryLine(m, state, now));
  const hints = npc.personality.traits.map((t) => content.traits[t]?.llmHint).filter((h): h is string => !!h);
  return {
    id: npc.id,
    name: fullName(npc),
    firstName: npc.identity.firstName,
    age,
    gender: npc.identity.gender,
    pronouns: npc.identity.pronouns,
    role: roleLine(npc, state),
    appearance: appearanceLine(npc),
    traits: npc.personality.traits.map((t) => content.traits[t]?.name ?? titleWords(t)),
    traitHints: hints,
    personality: bigFiveWords(npc),
    speechStyle: npc.personality.speechStyle,
    honesty: Math.round(npc.personality.honesty * 100) / 100,
    mood: moodLine(npc),
    needs: needWords(npc),
    state: stateWords(npc, now),
    bioSummary: npc.bio.summary || npc.publicSummary || '(no biography yet — improvise only small, non-durable color)',
    facts,
    relationship: relationshipLabel(rel, actor),
    relationshipNumbers: rel ? `friendship ${r0(rel.friendship)}, romance ${r0(rel.romance)}, trust ${r0(rel.trust)}, familiarity ${r0(rel.familiarity)}, attraction ${r0(rel.attraction)}, ${rel.interactionsCount} past interactions` : 'no history (all axes 0)',
    grudges: (rel?.grudges ?? []).slice(0, 3).map((g) => g.text),
    promises: (rel?.promises ?? []).filter((p) => p.kept === undefined).slice(0, 3).map((p) => p.text),
    moneyOwed: rel && rel.moneyOwed ? (rel.moneyOwed > 0 ? `${actor.identity.firstName} owes ${npc.identity.firstName} $${Math.abs(rel.moneyOwed).toFixed(0)}` : `${npc.identity.firstName} owes ${actor.identity.firstName} $${Math.abs(rel.moneyOwed).toFixed(0)}`) : undefined,
    memories,
    recentMemories: recent,
    currentAction: npc.currentAction?.label,
    schedule: scheduleLine(npc, state, now),
    primary,
  };
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------
export function fullName(sim: Sim): string {
  return `${sim.identity.firstName} ${sim.identity.lastName}`;
}
function nameOf(state: WorldState, id: SimId): string {
  const s = state.sims[id];
  return s ? fullName(s) : 'someone';
}
function r0(n: number): string {
  return String(Math.round(n));
}
export function titleWords(s: string): string {
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function appearanceLine(sim: Sim): string {
  const a = sim.identity.appearance;
  const parts = [`${a.hair} hair`, `${a.eyes} eyes`, `${a.build} build`, `${a.style} style`, ...a.distinguishing.slice(0, 2)];
  return parts.join(', ');
}

function moodLine(sim: Sim): string {
  const m = sim.mind;
  const level = m.mood >= 40 ? 'great mood' : m.mood >= 15 ? 'good mood' : m.mood > -15 ? 'neutral mood' : m.mood > -40 ? 'bad mood' : 'terrible mood';
  const top = [...m.moodlets].sort((a, b) => Math.abs(b.intensity) - Math.abs(a.intensity)).slice(0, 3).map((x) => x.label);
  const stress = m.stress >= 70 ? 'very stressed' : m.stress >= 45 ? 'stressed' : undefined;
  return [`${level} (${m.dominantEmotion.replace('_', ' ')})`, stress, top.length ? `feeling: ${top.join(', ')}` : undefined].filter(Boolean).join('; ');
}

const NEED_WORDS: Record<string, [string, string]> = {
  hunger: ['starving', 'hungry'],
  thirst: ['parched', 'thirsty'],
  energy: ['exhausted', 'tired'],
  bladder: ['desperate for a bathroom', 'needs a bathroom soon'],
  hygiene: ['unwashed and smelly', 'a little grubby'],
  social: ['starved for company', 'lonely'],
  fun: ['bored stiff', 'bored'],
  comfort: ['aching and uncomfortable', 'uncomfortable'],
};
export function needWords(sim: Sim): string[] {
  return Object.entries(sim.needs)
    .filter(([, v]) => v < 55)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3)
    .map(([k, v]) => (v < 25 ? `very ${NEED_WORDS[k]?.[0] ?? k}` : NEED_WORDS[k]?.[1] ?? k));
}

function stateWords(sim: Sim, now: number): string[] {
  const b = sim.body;
  const out: string[] = [];
  if (b.bloodAlcohol >= 0.08) out.push(b.bloodAlcohol >= 0.15 ? 'very drunk' : 'drunk');
  else if (b.bloodAlcohol >= 0.03) out.push('tipsy');
  if (b.cannabis >= 30) out.push('high');
  if (b.caffeine >= 250) out.push('wired on caffeine');
  const ill = b.illnesses.filter((i) => i.severity >= 20).map((i) => i.name);
  if (ill.length) out.push(`sick (${ill.join(', ')})`);
  const inj = b.injuries.filter((i) => i.healsAt > now).map((i) => i.name);
  if (inj.length) out.push(`injured (${inj.join(', ')})`);
  if (b.pregnancy?.known) out.push('pregnant');
  if (b.health < 40) out.push('in poor health');
  if (b.sleepDebtHours >= 8) out.push('badly sleep-deprived');
  if (sim.legal.incarceratedUntil && sim.legal.incarceratedUntil > now) out.push('incarcerated');
  if (sim.legal.warrants.length) out.push('has an outstanding warrant');
  if (sim.legal.heat >= 50) out.push('police are paying attention to them');
  return out;
}

function moneyLine(sim: Sim): string {
  const cash = sim.finance.accounts.filter((a) => a.kind === 'cash').reduce((s, a) => s + a.balance, 0);
  const checking = sim.finance.accounts.filter((a) => a.kind === 'checking' && !a.frozen).reduce((s, a) => s + a.balance, 0);
  const savings = sim.finance.accounts.filter((a) => a.kind === 'savings').reduce((s, a) => s + a.balance, 0);
  const cc = sim.finance.accounts.filter((a) => a.kind === 'credit_card').reduce((s, a) => s + a.balance, 0);
  const parts = [`about $${roundMoney(cash)} cash`, `~$${roundMoney(checking)} in checking`];
  if (savings > 0) parts.push(`~$${roundMoney(savings)} in savings`);
  if (cc > 0) parts.push(`$${roundMoney(cc)} credit card debt`);
  return parts.join(', ');
}
function roundMoney(v: number): string {
  const abs = Math.abs(v);
  const step = abs >= 10_000 ? 500 : abs >= 1000 ? 100 : abs >= 100 ? 10 : 5;
  const r = Math.round(v / step) * step;
  return (v < 0 ? '-' : '') + Math.abs(r).toLocaleString('en-US');
}

function occupationLine(sim: Sim, state: WorldState, age: number): string {
  const job = sim.career.job;
  const parts: string[] = [];
  if (job) parts.push(`${job.title} at ${job.employerName}${job.employerVenueId && state.venues[job.employerVenueId] ? '' : ''}`);
  else if (sim.role?.title || sim.role?.role) parts.push(`${sim.role.title ?? titleWords(sim.role.role)}${sim.role.venueId && state.venues[sim.role.venueId] ? ` at ${state.venues[sim.role.venueId].name}` : ''}`);
  else if (sim.career.retired) parts.push('retired');
  else if (age >= 18) parts.push('unemployed');
  const e = sim.education.enrollment;
  if (e && e.status === 'enrolled') parts.push(`student (${e.program} at ${e.institutionName})`);
  else if (age < 18 && sim.education.grade !== undefined) parts.push(`in grade ${sim.education.grade}`);
  if (sim.education.highestLevel !== 'none' && age >= 18) parts.push(`education: ${titleWords(sim.education.highestLevel)}`);
  return parts.join('; ') || 'no occupation';
}

function roleLine(npc: Sim, state: WorldState): string | undefined {
  const job = npc.career.job;
  if (npc.role) {
    const venue = npc.role.venueId ? state.venues[npc.role.venueId] : undefined;
    return `${npc.role.title ?? titleWords(npc.role.role)}${venue ? ` at ${venue.name}` : ''}`;
  }
  if (job) return `${job.title} at ${job.employerName}`;
  return undefined;
}

export function bigFiveWords(sim: Sim): string {
  const p = sim.personality;
  const pick = (v: number, hi: string, lo: string, mid = ''): string => (v >= 0.65 ? hi : v <= 0.35 ? lo : mid);
  const words = [
    pick(p.openness, 'curious, open-minded', 'conventional, set in their ways'),
    pick(p.conscientiousness, 'organized, reliable', 'impulsive, disorganized'),
    pick(p.extraversion, 'outgoing, talkative', 'reserved, quiet'),
    pick(p.agreeableness, 'warm, accommodating', 'blunt, competitive'),
    pick(p.neuroticism, 'anxious, moody', 'calm, unflappable'),
  ].filter(Boolean);
  const extras: string[] = [];
  if (p.humor >= 0.65) extras.push('funny');
  if (p.honesty <= 0.4) extras.push('bends the truth');
  if (p.ambition >= 0.7) extras.push('driven');
  if (p.riskTolerance >= 0.7) extras.push('risk-taker');
  return [...words, ...extras].join('; ') || 'even-tempered, average in most ways';
}

export function relationshipLabel(rel: Relationship | undefined, actor: Sim): string {
  if (!rel) return `stranger (has never met ${actor.identity.firstName})`;
  const f = rel.flags;
  const named = ['married', 'engaged', 'partner', 'dating', 'ex', 'divorced', 'affair', 'crush', 'parent', 'child', 'sibling', 'grandparent', 'grandchild', 'aunt_uncle', 'niece_nephew', 'cousin', 'in_law', 'step_parent', 'step_child', 'roommate', 'boss', 'employee', 'coworker', 'teacher', 'student', 'classmate', 'doctor', 'patient', 'landlord', 'tenant', 'neighbor', 'mentor', 'mentee', 'rival', 'enemy', 'best_friend', 'good_friend', 'friend', 'acquaintance', 'blocked'];
  const labels = named.filter((n) => f.includes(n as never)).map((n) => n.replace(/_/g, ' '));
  if (!labels.length) {
    if (rel.friendship <= -40) labels.push('enemy');
    else if (rel.friendship >= 60 && rel.familiarity >= 30) labels.push('good friend');
    else if (rel.friendship >= 30 && rel.familiarity >= 15) labels.push('friend');
    else if (rel.familiarity >= 5 || rel.interactionsCount > 0) labels.push('acquaintance');
    else labels.push('stranger');
  }
  if (rel.romance >= 30 && !labels.some((l) => ['married', 'engaged', 'partner', 'dating'].includes(l))) labels.push('romantic interest');
  return labels.join(', ');
}

function scheduleLine(npc: Sim, state: WorldState, now: number): string | undefined {
  const wd = weekdayAt(state.epoch, now);
  const mod = minuteOfDay(now);
  const job = npc.career.job;
  const shift = job?.shifts.find((s) => s.day === wd);
  if (shift) {
    if (mod >= shift.start && mod < shift.end) return `on shift until ${formatClock(shift.end)}`;
    if (mod < shift.start) return `off duty; shift starts at ${formatClock(shift.start)}`;
  }
  const block = npc.schedule.find((b) => (b.day === 'daily' || b.day === wd || (b.day === 'weekday' && wd >= 1 && wd <= 5) || (b.day === 'weekend' && (wd === 0 || wd === 6))) && mod >= b.start && mod < b.end);
  if (block) return `${block.label ?? block.kind} until ${formatClock(block.end)}`;
  if (npc.role && npc.role.venueId === npc.location.venueId) return 'working here right now';
  return undefined;
}

function memoryLine(m: { at: number; text: string; valence: number }, state: WorldState, now: number): string {
  return `${agoLabel(now - m.at)}: ${m.text}${m.valence <= -0.4 ? ' (still stings)' : m.valence >= 0.4 ? ' (fond)' : ''}`;
}
function agoLabel(mins: number): string {
  if (mins < 60) return `${Math.max(1, Math.round(mins))} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  const d = Math.round(mins / 1440);
  if (d < 14) return `${d} day${d === 1 ? '' : 's'} ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  return `${Math.round(d / 30)} months ago`;
}

function googleTypesPhrase(types: string[], primary?: string): string | undefined {
  const ordered = [primary, ...types].filter((t): t is string => !!t && !GENERIC_GOOGLE_TYPES.has(t));
  const uniq = [...new Set(ordered)].slice(0, 3).map((t) => t.replace(/_/g, ' '));
  return uniq.length ? uniq.join(' / ') : undefined;
}
function priceLevelLabel(level: number): string {
  if (level <= 0) return 'free';
  return '$'.repeat(Math.min(4, Math.max(1, Math.round(level))));
}
function crowdLabel(level: number | undefined, noise: number): string {
  const l = level ?? Math.min(1, noise / 100);
  if (l < 0.15) return 'nearly empty';
  if (l < 0.4) return 'quiet';
  if (l < 0.7) return 'moderately busy';
  if (l < 0.9) return 'busy';
  return 'packed';
}
function hoursToday(venue: Venue, state: WorldState, now: number, content: ContentCatalog): string | undefined {
  const wd = weekdayAt(state.epoch, now);
  const periods = venue.google?.openingPeriods?.filter((p) => p.day === wd);
  if (periods?.length) return periods.map((p) => `${formatClock(p.open)}–${formatClock(p.close >= 1440 ? p.close - 1440 : p.close)}`).join(', ');
  if (venue.google?.businessStatus && venue.google.businessStatus !== 'OPERATIONAL') return venue.google.businessStatus.replace(/_/g, ' ').toLowerCase();
  const h = content.archetypes[venue.archetype]?.defaultHours;
  if (h && h.days.includes(wd)) return `${formatClock(h.open)}–${formatClock(h.close >= 1440 ? h.close - 1440 : h.close)} (typical)`;
  if (h) return 'closed today';
  return undefined;
}
function dedupeCount(names: string[]): string[] {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n, c]) => (c > 1 ? `${n} ×${c}` : n));
}

function collectAllowedItems(state: WorldState, actor: Sim, venue: Venue, content: ContentCatalog, isHome: boolean): string[] {
  const set = new Set<string>();
  for (const [id, q] of Object.entries(actor.inventory.consumables)) if (q > 0) set.add(id);
  if (isHome && actor.householdId) for (const [id, q] of Object.entries(state.households[actor.householdId]?.pantry ?? {})) if (q > 0) set.add(id);
  const sells = content.archetypes[venue.archetype]?.sells;
  if (Array.isArray(sells)) for (const id of sells) set.add(id);
  else if (typeof sells === 'string') {
    const cats: Record<string, string[]> = {
      grocery: ['food', 'drink', 'ingredient', 'toiletry', 'alcohol'],
      convenience: ['food', 'drink', 'alcohol', 'tobacco', 'misc'],
      pharmacy: ['medicine', 'toiletry'],
      clothing: ['clothing'],
      electronics: ['electronics'],
      furniture: [],
      hardware: ['tool'],
      pet: ['pet_supply'],
      books: ['book'],
      liquor: ['alcohol'],
    };
    const wanted = new Set(cats[sells] ?? []);
    for (const it of Object.values(content.items)) if (wanted.has(it.category)) set.add(it.id);
  } else {
    // sensible defaults by archetype when the catalog has no `sells`
    const byArch: Partial<Record<Venue['archetype'], string[]>> = {
      cafe: ['coffee_cup', 'sandwich', 'smoothie', 'cookies'],
      restaurant: ['restaurant_meal', 'wine', 'beer', 'soda'],
      fast_food: ['fast_food_meal', 'soda'],
      bar: ['beer', 'wine', 'liquor', 'soda'],
      nightclub: ['beer', 'liquor', 'soda'],
      gas_station: ['snacks', 'chips', 'soda', 'coffee_cup', 'energy_drink', 'cigarettes', 'lottery_ticket'],
      grocery: ['eggs', 'milk', 'bread', 'rice', 'pasta', 'chicken', 'vegetables', 'fruit', 'cheese', 'coffee_beans', 'snacks', 'soda', 'beer', 'wine'],
      convenience: ['snacks', 'chips', 'soda', 'beer', 'cigarettes', 'lottery_ticket', 'energy_drink'],
      pharmacy: ['painkillers', 'cold_medicine', 'vitamins', 'bandages', 'allergy_meds', 'antacid', 'condoms', 'pregnancy_test', 'toothpaste', 'soap'],
      liquor_store: ['beer', 'wine', 'liquor'],
      cinema: ['movie_ticket', 'snacks', 'soda'],
      bookstore: ['book_novel', 'notebook'],
      florist: ['gift_flowers'],
      bakery: ['cookies', 'bread', 'coffee_cup'],
      farmers_market: ['vegetables', 'fruit', 'eggs', 'bread'],
      pet_store: ['dog_food', 'cat_food', 'cat_litter', 'pet_treats', 'pet_toy', 'leash'],
      dispensary: ['cannabis_flower'],
    };
    for (const id of byArch[venue.archetype] ?? []) set.add(id);
  }
  return [...set].sort();
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
export function renderSceneContext(ctx: SceneContext): string {
  const L: string[] = [];
  const push = (s?: string) => {
    if (s !== undefined && s !== '') L.push(s);
  };
  const w = ctx.world;
  push('## World');
  push(`- When: ${w.dateLabel}, ${w.timeLabel} (${w.partOfDay}, ${w.season})${w.holidays.length ? ` — ${w.holidays.join(', ')}` : ''}`);
  push(`- Weather: ${w.weather}`);
  push(`- Where: ${w.region}. Local flavor: ${w.culture}`);

  const v = ctx.venue;
  push('');
  push(`## Venue: ${v.name}${v.isHome ? ' (home)' : ''}`);
  push(`- Kind: ${v.archetype}${v.typesPhrase ? ` (${v.typesPhrase})` : ''}`);
  const gl = [v.rating, v.priceLevel ? `price ${v.priceLevel}` : undefined].filter(Boolean).join(', ');
  if (gl) push(`- Google: ${gl}`);
  push(`- Status: ${v.openNow ? 'open' : 'CLOSED'} now${v.hoursToday ? `; hours today ${v.hoursToday}` : ''}; ${v.crowd}; cleanliness ${v.cleanliness}/100, safety ${v.safety}/100`);
  if (v.editorialSummary) push(`- About: ${v.editorialSummary}`);
  if (v.reviewThemes.length) push(`- Review themes: ${v.reviewThemes.join(', ')}`);
  for (const s of v.reviewSnippets) push(`- Review: "${s}"`);
  if (v.ambience) push(`- Ambience: ${v.ambience}`);
  if (v.objects.length) push(`- Notable objects: ${v.objects.join(', ')}`);
  if (v.allowedItems.length) push(`- Items obtainable here (ids): ${v.allowedItems.slice(0, 40).join(', ')}${v.allowedItems.length > 40 ? ', …' : ''}`);
  if (v.knownVenues.length) push(`- Known nearby venues (id — name, kind, miles): ${v.knownVenues.map((k) => `${k.id} — ${k.name}, ${k.archetype.replace(/_/g, ' ')}, ${k.miles} mi`).join('; ')}`);

  const a = ctx.actor;
  push('');
  push(`## Player character: ${a.name} (id ${a.id})`);
  push(`- ${a.age}, ${a.gender} (${a.pronouns}); ${a.appearance}`);
  if (a.traits.length) push(`- Traits: ${a.traits.join(', ')}`);
  push(`- Mood: ${a.mood}`);
  if (a.needs.length) push(`- Needs: ${a.needs.join(', ')}`);
  if (a.state.length) push(`- Condition: ${a.state.join(', ')}`);
  push(`- Money: ${a.money}`);
  push(`- Occupation: ${a.occupation}`);
  if (a.skills.length) push(`- Notable skills: ${a.skills.join(', ')}`);
  if (a.inventory.length) push(`- Carrying: ${a.inventory.join(', ')}`);
  if (a.aspiration) push(`- Aspiration: ${a.aspiration}`);
  if (a.currentAction) push(`- Was doing: ${a.currentAction}`);

  for (const n of ctx.npcs) {
    push('');
    push(`## ${n.primary ? 'NPC (addressed)' : 'NPC present'}: ${n.name} (id ${n.id})`);
    push(`- ${n.age}, ${n.gender} (${n.pronouns})${n.role ? `; ${n.role}` : ''}; ${n.appearance}`);
    if (n.traits.length) push(`- Traits: ${n.traits.join(', ')}`);
    push(`- Personality: ${n.personality}`);
    push(`- Speech: ${n.speechStyle}. Honesty ${n.honesty} (0 = liar, 1 = scrupulously honest)`);
    for (const h of n.traitHints) push(`- Trait voice: ${h}`);
    push(`- Mood: ${n.mood}`);
    if (n.needs.length) push(`- Needs: ${n.needs.join(', ')}`);
    if (n.state.length) push(`- Condition: ${n.state.join(', ')}`);
    if (n.currentAction) push(`- Doing now: ${n.currentAction}`);
    if (n.schedule) push(`- Schedule: ${n.schedule}`);
    push(`- Relationship with ${a.firstName} (from ${n.firstName}'s side): ${n.relationship}; ${n.relationshipNumbers}`);
    if (n.grudges.length) push(`- Grudges: ${n.grudges.join(' | ')}`);
    if (n.promises.length) push(`- Open promises: ${n.promises.join(' | ')}`);
    if (n.moneyOwed) push(`- Money: ${n.moneyOwed}`);
    push(`- Bio: ${n.bioSummary}`);
    if (n.facts) {
      push(`- Bio facts (ground truth; id — text). ${a.firstName} already knows the ones marked [known]:`);
      for (const f of n.facts) push(`  - ${f.id} [${f.category}${f.secret ? `, SECRET, depth ${f.depth}` : `, depth ${f.depth}`}${f.known ? ', known' : ''}] ${f.text}`);
    }
    if (n.memories.length) push(`- Memories of ${a.firstName}:${n.memories.map((m) => `\n  - ${m}`).join('')}`);
    if (n.recentMemories.length) push(`- Other recent memories:${n.recentMemories.map((m) => `\n  - ${m}`).join('')}`);
  }

  if (ctx.recentLog.length) {
    push('');
    push('## Recent happenings here');
    for (const l of ctx.recentLog) push(`- ${l}`);
  }
  if (ctx.conversation) {
    push('');
    push(`## Conversation (${ctx.conversation.channel}${ctx.conversation.topic ? `, topic: ${ctx.conversation.topic}` : ''})`);
    if (ctx.conversation.summary) push(`Earlier: ${ctx.conversation.summary}`);
    for (const t of ctx.conversation.turns) push(`${t.speaker}: ${t.text}`);
  }

  const r = ctx.rules;
  push('');
  push('## Limits the world enforces');
  push(`- Need deltas within ±${r.maxNeedDelta}; relationship deltas within ±${r.maxRelationshipDelta}; skill xp ≤ ${r.maxSkillXp}; health ±${r.maxHealthDelta}; money gain ≤ $${r.maxMoneyGain}, spend ≤ $${r.maxMoneySpend}; elapsed time ≤ ${r.maxTimeElapsed} min`);
  push(`- Present sim ids you may reference: ${[a.id, ...r.presentSimIds].join(', ')}`);
  push(`- moveTo: ${r.allowMoveTo && r.knownVenueIds.length ? `only ids ${r.knownVenueIds.join(', ')}` : 'not allowed in this scene'}`);
  push(`- legal effects: ${r.allowLegal ? 'allowed when a crime/violation actually happens' : 'not allowed'}`);
  push(`- Emotions: ${r.emotionIds.join(', ')}`);
  push(`- Skill ids: ${r.skillIds.join(', ')}`);
  push(`- Crime ids: ${r.crimeIds.join(', ')}`);
  return L.join('\n');
}
