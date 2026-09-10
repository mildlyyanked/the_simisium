/**
 * Relationships system — the deterministic, menu-driven social layer.
 *
 * Responsibilities
 *  - relationship decay (daily), grudges (monthly decay), memory hygiene, crush/affair flag sync
 *  - social actions `social:<simId>:<interactionId>` for every present sim (friendly / romantic / mean / kids)
 *  - "Talk to <sim>" (`social:<simId>:converse`, llm 'converse'): `execute` returns
 *    `{ ok: true, data: { openConversation: true, targetId, channel: 'in_person' } }` — the store/UI must then call
 *    `engine.startConversation(actorId, [targetId])` and switch to the chat view. The engine cannot start it from a system.
 *  - meeting strangers on arrival (familiarity 1 → they appear in the menu with "Introduce yourself")
 *  - milestones (`relationship:milestone` from core) → moodlets + log for controlled sims
 *  - gossip: spreads a memory between sims; negative gossip about a sim lowers their reputation
 *
 * Emits: relationship:breakup, family:proposal, legal:crime_committed, custom family:conception,
 *        custom health:exposure_sti, custom health:injury, sim:met
 * Consumes: sim:arrived, relationship:milestone, relationship:changed, scheduled:fired (payload.source === 'relationships'),
 *           time:day, time:month
 */
import { ensureRelationship, liquidCash, transact } from '../core/effects';
import type { GameEvent } from '../core/events';
import { shortId } from '../core/ids';
import { simName } from '../core/query';
import type { RNG } from '../core/rng';
import type { ActionResult, System, SystemContext } from '../core/systems';
import type { ActionCategory, ActionDef, EffectBundle, EmotionId, Memory, Relationship, RelationshipFlag, Requirement, Sim, SimId, VenueId } from '../core/types';
import { clamp, DAY, HOUR, round2 } from '../core/util';

// ---------------------------------------------------------------------------
// Shared helpers (family.ts / npcAI.ts import these pure functions)
// ---------------------------------------------------------------------------
const STAGES = ['infant', 'toddler', 'child', 'teen', 'young_adult', 'adult', 'middle_aged', 'senior'] as const;
export const stageIndex = (s: Sim): number => STAGES.indexOf(s.lifeStage);
export const isAdult = (s: Sim): boolean => stageIndex(s) >= 4;
export const isKid = (s: Sim): boolean => stageIndex(s) <= 2;
export const isTeenOrKid = (s: Sim): boolean => stageIndex(s) <= 3;
export const hasTrait = (s: Sim, t: string): boolean => s.personality.traits.includes(t);

export const FAMILY_FLAGS: RelationshipFlag[] = ['parent', 'child', 'sibling', 'grandparent', 'grandchild', 'aunt_uncle', 'niece_nephew', 'cousin', 'step_parent', 'step_child'];
export const PARTNER_FLAGS: RelationshipFlag[] = ['dating', 'partner', 'engaged', 'married'];

export function isCloseFamily(rel?: Relationship): boolean {
  return !!rel && rel.flags.some((f) => FAMILY_FLAGS.includes(f));
}
export function isPartnered(rel?: Relationship): boolean {
  return !!rel && rel.flags.some((f) => PARTNER_FLAGS.includes(f));
}
/** id of the sim this sim is dating/engaged/married to, if any */
export function partnerOf(sim: Sim): SimId | undefined {
  for (const r of Object.values(sim.relationships)) if (isPartnered(r)) return r.simId;
  return undefined;
}
export function isSingle(sim: Sim): boolean {
  return partnerOf(sim) === undefined;
}

const TRAIT_CONFLICTS: [string, string][] = [
  ['neat', 'slob'],
  ['active', 'couch_potato'],
  ['outgoing', 'loner'],
  ['cheerful', 'gloomy'],
  ['workaholic', 'lazy'],
  ['frugal', 'materialistic'],
  ['spiritual', 'skeptic'],
  ['kind', 'mean'],
  ['snob', 'generous'],
  ['party_animal', 'homebody'],
  ['brave', 'coward'],
  ['stoic', 'anxious'],
];

/** 0..1 how well two personalities fit (Big Five distance, traits, hobbies, values). */
export function compatibility(a: Sim, b: Sim): number {
  const pa = a.personality;
  const pb = b.personality;
  const dims = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'] as const;
  let d = 0;
  for (const k of dims) d += (pa[k] - pb[k]) ** 2;
  const dist = Math.sqrt(d / dims.length); // 0..1
  let score = 0.75 - dist * 0.6;
  const shared = pa.traits.filter((t) => pb.traits.includes(t)).length;
  score += Math.min(0.2, shared * 0.05);
  for (const [x, y] of TRAIT_CONFLICTS) {
    if ((pa.traits.includes(x) && pb.traits.includes(y)) || (pa.traits.includes(y) && pb.traits.includes(x))) score -= 0.08;
  }
  const sharedHobbies = a.hobbies.filter((h) => b.hobbies.includes(h)).length;
  score += Math.min(0.15, sharedHobbies * 0.05);
  const vk = Object.keys(pa.values) as (keyof typeof pa.values)[];
  let vd = 0;
  for (const k of vk) vd += Math.abs(pa.values[k] - pb.values[k]);
  score -= (vd / vk.length) * 0.3;
  if (pa.politics !== 'apolitical' && pb.politics !== 'apolitical') {
    const order = ['left', 'center-left', 'center', 'center-right', 'right'];
    const gap = Math.abs(order.indexOf(pa.politics) - order.indexOf(pb.politics));
    score -= gap * 0.03;
  }
  return clamp(round2(score), 0, 1);
}

function attractedTo(s: Sim, other: Sim): boolean {
  const sx = s.personality.sexuality;
  if (sx === 'ace') return false;
  if (sx === 'bi' || sx === 'pan' || sx === 'questioning') return true;
  const g = s.identity.gender;
  const og = other.identity.gender;
  if (og === 'nonbinary' || g === 'nonbinary') return sx !== 'straight' || og === 'nonbinary';
  return sx === 'straight' ? og !== g : og === g;
}

/** Both adults, not close family, orientations line up. */
export function romanticallyCompatible(a: Sim, b: Sim): boolean {
  if (a.id === b.id) return false;
  if (!isAdult(a) || !isAdult(b)) return false;
  if (isCloseFamily(a.relationships[b.id]) || isCloseFamily(b.relationships[a.id])) return false;
  return attractedTo(a, b) && attractedTo(b, a);
}

export function pushMemory(sim: Sim, spec: { kind?: Memory['kind']; text: string; participants?: SimId[]; salience?: number; valence?: number; tags?: string[]; venueId?: VenueId }, now: number, rng?: RNG): void {
  sim.memory.push({ id: shortId(rng, 'mem'), kind: spec.kind ?? 'interaction', at: now, text: spec.text.slice(0, 400), participants: spec.participants ?? [], venueId: spec.venueId ?? sim.location.venueId, salience: clamp(spec.salience ?? 35, 0, 100), valence: clamp(spec.valence ?? 0, -1, 1), tags: spec.tags ?? [] });
  if (sim.memory.length > 200) {
    sim.memory.sort((x, y) => y.salience - x.salience || y.at - x.at);
    sim.memory = sim.memory.slice(0, 200);
  }
}

export function decayRateFor(rel: Relationship): number {
  if (rel.flags.some((f) => FAMILY_FLAGS.includes(f) || PARTNER_FLAGS.includes(f))) return 0.05;
  if (rel.flags.includes('best_friend') || rel.flags.includes('good_friend')) return 0.2;
  if (rel.familiarity < 10) return 0.8;
  return 0.4;
}

export function daysSince(minute: number | undefined, now: number): number {
  return minute === undefined ? 999 : (now - minute) / DAY;
}

/** Unmet requirement that greys an action out with a reason. */
export const blocked = (reason: string): Requirement => ({ kind: 'custom', reason, params: { fn: () => false } });

// ---------------------------------------------------------------------------
// Social interaction catalog
// ---------------------------------------------------------------------------
interface SocialCtx {
  ctx: SystemContext;
  actor: Sim;
  target: Sim;
  rel: Relationship; // actor → target
  trel: Relationship; // target → actor
  present: boolean;
  atHome: boolean;
  compat: number;
}

interface Delta {
  friendship?: number;
  romance?: number;
  trust?: number;
  familiarity?: number;
  attraction?: number;
  social?: number;
  fun?: number;
  stress?: number;
  targetSocial?: number;
  targetFun?: number;
  targetStress?: number;
  actorMood?: [EmotionId, string, number, number];
  targetMood?: [EmotionId, string, number, number];
  grudge?: string;
  grudgeWeight?: number;
  reputation?: number;
}

interface SocialDef {
  id: string;
  label: string;
  group: 'Friendly' | 'Romantic' | 'Mean' | 'Kids';
  category: ActionCategory;
  minutes: number;
  /** base success probability */
  base: number;
  skill?: string;
  romantic?: boolean;
  mean?: boolean;
  show: (c: SocialCtx) => boolean;
  block?: (c: SocialCtx) => string | undefined;
  success: Delta;
  fail: Delta;
  /** [actor POV, target POV] memory texts */
  mem: (c: SocialCtx, ok: boolean) => [string, string];
  valence?: number;
  icon?: string;
}

const first = (s: Sim) => s.identity.firstName;
const venueName = (c: SocialCtx) => c.ctx.query.venueMaybe(c.actor.location.venueId)?.name ?? 'somewhere';
const canTalk = (c: SocialCtx) => !isKid(c.target) || c.target.lifeStage === 'child';
const bothAdults = (c: SocialCtx) => isAdult(c.actor) && isAdult(c.target);
const romanticOk = (c: SocialCtx) => bothAdults(c) && romanticallyCompatible(c.actor, c.target) && (isPartnered(c.rel) || (isSingle(c.target) && (isSingle(c.actor) || hasTrait(c.actor, 'commitment_issues'))) || c.rel.flags.includes('affair'));
const grudgeWeight = (rel: Relationship) => rel.grudges.reduce((s, g) => s + g.weight, 0);
const grudgeBlock = (c: SocialCtx): string | undefined => (grudgeWeight(c.trel) >= 3 ? `${first(c.target)} is still upset with you` : undefined);
const datingDays = (c: SocialCtx) => daysSince(Number(c.actor.flags[`dating_since:${c.target.id}`] ?? undefined) || undefined, c.ctx.state.time.minute);

export const SOCIAL_DEFS: SocialDef[] = [
  // ----- Friendly -----
  { id: 'introduce', label: 'Introduce yourself', group: 'Friendly', category: 'social', minutes: 5, base: 0.8, icon: 'hand', show: (c) => c.rel.familiarity < 5 && c.rel.flags.length === 0 && canTalk(c), success: { familiarity: 5, friendship: 3, social: 5, targetSocial: 3 }, fail: { familiarity: 3, friendship: -1, actorMood: ['embarrassed', 'Awkward introduction', -4, 60] }, mem: (c, ok) => [ok ? `I introduced myself to ${simName(c.target)} at ${venueName(c)}.` : `I awkwardly introduced myself to ${simName(c.target)} at ${venueName(c)}.`, ok ? `${simName(c.actor)} introduced themselves to me at ${venueName(c)}.` : `${simName(c.actor)} introduced themselves to me a bit awkwardly at ${venueName(c)}.`] },
  { id: 'small_talk', label: 'Small talk', group: 'Friendly', category: 'social', minutes: 10, base: 0.72, show: (c) => c.rel.familiarity >= 3 && canTalk(c), block: grudgeBlock, success: { friendship: 2, familiarity: 2, social: 8, targetSocial: 6 }, fail: { friendship: -1, social: 2, actorMood: ['bored', 'Dull small talk', -2, 60] }, mem: (c, ok) => [`I chatted with ${first(c.target)} about nothing much at ${venueName(c)}.`, ok ? `${first(c.actor)} and I made small talk at ${venueName(c)}.` : `${first(c.actor)} tried to make small talk with me; it dragged.`] },
  { id: 'ask_day', label: 'Ask about their day', group: 'Friendly', category: 'social', minutes: 10, base: 0.75, show: (c) => c.rel.familiarity >= 5 && canTalk(c), block: grudgeBlock, success: { friendship: 3, familiarity: 2, trust: 1, social: 8, targetSocial: 8 }, fail: { friendship: 0, social: 3 }, mem: (c) => [`I asked ${first(c.target)} how their day was going.`, `${first(c.actor)} asked about my day and actually listened.`] },
  { id: 'joke', label: 'Tell a joke', group: 'Friendly', category: 'social', minutes: 5, base: 0.5, skill: 'comedy', show: (c) => c.rel.familiarity >= 3 && canTalk(c), block: grudgeBlock, success: { friendship: 4, fun: 8, targetFun: 8, social: 5, targetSocial: 4, actorMood: ['playful', 'Got a laugh', 4, 90], targetMood: ['playful', 'Heard a good joke', 4, 90] }, fail: { friendship: -2, fun: -2, actorMood: ['embarrassed', 'Joke fell flat', -4, 90] }, mem: (c, ok) => [ok ? `I told ${first(c.target)} a joke and they cracked up.` : `I told ${first(c.target)} a joke that went nowhere.`, ok ? `${first(c.actor)} told me a genuinely funny joke at ${venueName(c)}.` : `${first(c.actor)} told me a terrible joke at ${venueName(c)}.`] },
  { id: 'compliment', label: 'Compliment', group: 'Friendly', category: 'social', minutes: 5, base: 0.7, skill: 'charisma', show: (c) => c.rel.familiarity >= 3 && canTalk(c), block: grudgeBlock, success: { friendship: 3, attraction: 2, social: 4, targetSocial: 5, targetMood: ['confident', 'Got a compliment', 4, 120] }, fail: { friendship: -1, actorMood: ['embarrassed', 'Compliment landed wrong', -3, 60] }, mem: (c, ok) => [`I complimented ${first(c.target)}.`, ok ? `${first(c.actor)} paid me a nice compliment.` : `${first(c.actor)} gave me a weird compliment.`] },
  { id: 'gossip', label: 'Share gossip', group: 'Friendly', category: 'social', minutes: 10, base: 0.65, show: (c) => c.rel.familiarity >= 10 && canTalk(c) && findGossip(c.actor, c.target.id) !== undefined, block: grudgeBlock, success: { friendship: 3, fun: 5, targetFun: 5, familiarity: 2, social: 6, targetSocial: 6 }, fail: { friendship: -2, trust: -2, targetMood: ['uncomfortable', 'Did not care for the gossip', -3, 60] }, mem: (c, ok) => [`I shared some gossip with ${first(c.target)}.`, ok ? `${first(c.actor)} told me some juicy gossip.` : `${first(c.actor)} gossiped at me; not my thing.`] },
  { id: 'deep_talk', label: 'Deep conversation', group: 'Friendly', category: 'social', minutes: 30, base: 0.6, skill: 'charisma', show: (c) => c.rel.familiarity >= 20 && canTalk(c) && !isKid(c.target), block: grudgeBlock, success: { friendship: 6, trust: 5, familiarity: 4, social: 18, targetSocial: 15, stress: -5, targetStress: -5, actorMood: ['grateful', 'Meaningful conversation', 6, 240], targetMood: ['grateful', 'Meaningful conversation', 6, 240] }, fail: { friendship: 1, social: 6, familiarity: 2 }, mem: (c, ok) => [ok ? `${first(c.target)} and I had a real heart-to-heart at ${venueName(c)}.` : `I tried to go deep with ${first(c.target)} but it stayed surface-level.`, ok ? `${first(c.actor)} and I had a real heart-to-heart at ${venueName(c)}.` : `${first(c.actor)} tried to have a serious talk with me; I wasn't really in the mood.`] },
  { id: 'ask_advice', label: 'Ask for advice', group: 'Friendly', category: 'social', minutes: 15, base: 0.7, show: (c) => c.rel.familiarity >= 10 && canTalk(c) && !isKid(c.target), block: grudgeBlock, success: { friendship: 2, trust: 3, social: 8, targetSocial: 6, stress: -6, targetMood: ['confident', 'Someone valued my opinion', 3, 120] }, fail: { friendship: 0, social: 3 }, mem: (c) => [`I asked ${first(c.target)} for advice.`, `${first(c.actor)} asked me for advice.`] },
  { id: 'offer_help', label: 'Offer help', group: 'Friendly', category: 'social', minutes: 15, base: 0.8, show: (c) => c.rel.familiarity >= 5 && canTalk(c), success: { friendship: 3, trust: 4, social: 6, targetSocial: 6, targetMood: ['grateful', 'Someone offered to help', 4, 180] }, fail: { friendship: 0 }, mem: (c, ok) => [`I offered ${first(c.target)} a hand.`, ok ? `${first(c.actor)} offered to help me out.` : `${first(c.actor)} offered help I didn't need.`] },
  { id: 'hangout', label: 'Hang out', group: 'Friendly', category: 'social', minutes: 60, base: 0.8, show: (c) => c.rel.friendship >= 10 && canTalk(c), block: grudgeBlock, success: { friendship: 5, familiarity: 3, fun: 20, targetFun: 20, social: 25, targetSocial: 25, actorMood: ['happy', 'Good time with a friend', 6, 240] }, fail: { friendship: 1, fun: 8, social: 12 }, mem: (c) => [`I hung out with ${first(c.target)} at ${venueName(c)}.`, `${first(c.actor)} and I hung out at ${venueName(c)}.`] },
  { id: 'invite_hangout', label: 'Invite to hang out', group: 'Friendly', category: 'social', minutes: 5, base: 0.6, show: (c) => c.rel.friendship >= 10 && canTalk(c) && !isKid(c.target), block: grudgeBlock, success: { friendship: 2, social: 3 }, fail: { friendship: 0, actorMood: ['sad', 'They were busy', -2, 60] }, mem: (c, ok) => [ok ? `I invited ${first(c.target)} over tomorrow evening.` : `${first(c.target)} couldn't make it when I invited them over.`, ok ? `${first(c.actor)} invited me over tomorrow evening.` : `${first(c.actor)} invited me over; I had to pass.`] },
  { id: 'exchange_numbers', label: 'Exchange numbers', group: 'Friendly', category: 'social', minutes: 3, base: 0.9, show: (c) => c.rel.friendship >= 10 && !c.actor.phone.contacts.includes(c.target.id) && !isKid(c.target), block: grudgeBlock, success: { friendship: 2, familiarity: 2 }, fail: { friendship: 0 }, mem: (c) => [`${first(c.target)} and I swapped numbers.`, `${first(c.actor)} and I swapped numbers.`] },
  { id: 'apologize', label: 'Apologize', group: 'Friendly', category: 'social', minutes: 10, base: 0.5, skill: 'charisma', show: (c) => c.trel.grudges.length > 0 && canTalk(c), success: { friendship: 4, trust: 4, social: 4, targetMood: ['relaxed', 'Got an apology', 4, 180], actorMood: ['relaxed', 'Cleared the air', 4, 180] }, fail: { friendship: -1, actorMood: ['embarrassed', 'Apology rejected', -4, 120] }, mem: (c, ok) => [ok ? `I apologized to ${first(c.target)} and they accepted.` : `I apologized to ${first(c.target)}; they weren't ready to hear it.`, ok ? `${first(c.actor)} apologized to me. I accepted.` : `${first(c.actor)} apologized but I'm not over it.`] },
  { id: 'lend_money', label: 'Lend money', group: 'Friendly', category: 'social', minutes: 5, base: 1, show: (c) => c.rel.friendship >= 20 && !isKid(c.target), success: { trust: 3, friendship: 2, targetMood: ['grateful', 'A friend lent me money', 5, 480] }, fail: {}, mem: (c) => [`I lent ${first(c.target)} some money.`, `${first(c.actor)} lent me money. I owe them.`] },
  { id: 'borrow_money', label: 'Ask to borrow money', group: 'Friendly', category: 'social', minutes: 5, base: 0.4, show: (c) => c.rel.friendship >= 20 && !isKid(c.target), block: grudgeBlock, success: { trust: -1, actorMood: ['grateful', 'A friend helped me out', 4, 480] }, fail: { friendship: -2, actorMood: ['embarrassed', 'Turned down for a loan', -4, 240] }, mem: (c, ok) => [ok ? `${first(c.target)} lent me money.` : `${first(c.target)} turned me down when I asked to borrow money.`, ok ? `I lent ${first(c.actor)} money.` : `${first(c.actor)} asked me for money; I said no.`] },
  // ----- Romantic -----
  { id: 'flirt', label: 'Flirt', group: 'Romantic', category: 'romance', minutes: 10, base: 0.45, skill: 'charisma', romantic: true, show: (c) => romanticOk(c), block: grudgeBlock, success: { romance: 5, attraction: 3, friendship: 1, social: 6, targetSocial: 5, actorMood: ['flirty', 'Sparks flying', 5, 120], targetMood: ['flirty', 'Someone was flirting with me', 4, 120] }, fail: { romance: -2, friendship: -1, actorMood: ['embarrassed', 'Flirting flopped', -5, 120], targetMood: ['uncomfortable', 'Unwanted flirting', -3, 90] }, mem: (c, ok) => [ok ? `I flirted with ${first(c.target)} and they flirted back.` : `I flirted with ${first(c.target)}; they weren't into it.`, ok ? `${first(c.actor)} flirted with me at ${venueName(c)}. Cute.` : `${first(c.actor)} flirted with me at ${venueName(c)}. Not interested.`] },
  { id: 'compliment_appearance', label: 'Compliment appearance', group: 'Romantic', category: 'romance', minutes: 5, base: 0.6, skill: 'charisma', romantic: true, show: (c) => romanticOk(c), block: grudgeBlock, success: { romance: 3, attraction: 2, friendship: 1, social: 4, targetMood: ['confident', 'Feeling attractive', 4, 120] }, fail: { romance: -1, targetMood: ['uncomfortable', 'Awkward comment', -3, 60] }, mem: (c, ok) => [`I told ${first(c.target)} they looked great.`, ok ? `${first(c.actor)} told me I looked great today.` : `${first(c.actor)} commented on my looks; it felt off.`] },
  { id: 'ask_date', label: 'Ask on a date', group: 'Romantic', category: 'romance', minutes: 5, base: 0.4, skill: 'charisma', romantic: true, show: (c) => romanticOk(c) && c.rel.romance >= 10, block: grudgeBlock, success: { romance: 4, actorMood: ['hopeful', 'Got a date', 6, 480] }, fail: { romance: -4, actorMood: ['sad', 'Turned down', -6, 240] }, mem: (c, ok) => [ok ? `I asked ${first(c.target)} out and they said yes.` : `I asked ${first(c.target)} out and got turned down.`, ok ? `${first(c.actor)} asked me out. I said yes.` : `${first(c.actor)} asked me out. I said no.`] },
  { id: 'confess', label: 'Confess feelings', group: 'Romantic', category: 'romance', minutes: 10, base: 0.3, romantic: true, show: (c) => romanticOk(c) && c.rel.romance >= 30 && !isPartnered(c.rel), block: grudgeBlock, success: { romance: 10, trust: 5, actorMood: ['in_love', 'They feel the same way', 10, 720], targetMood: ['in_love', 'A new relationship', 8, 720] }, fail: { romance: -10, friendship: -3, actorMood: ['sad', 'Feelings not returned', -10, 720], targetMood: ['uncomfortable', 'Awkward confession', -3, 240] }, mem: (c, ok) => [ok ? `I told ${first(c.target)} how I feel. We're together now.` : `I confessed my feelings to ${first(c.target)}. They don't feel the same.`, ok ? `${first(c.actor)} confessed feelings for me. I said yes; we're dating.` : `${first(c.actor)} confessed feelings for me. I had to let them down.`] },
  { id: 'kiss', label: 'Kiss', group: 'Romantic', category: 'romance', minutes: 5, base: 0.7, romantic: true, show: (c) => romanticOk(c) && (c.rel.romance >= 40 || isPartnered(c.rel)), block: grudgeBlock, success: { romance: 8, attraction: 3, fun: 10, targetFun: 10, social: 6, targetSocial: 6, actorMood: ['in_love', 'A kiss', 8, 240], targetMood: ['in_love', 'A kiss', 8, 240] }, fail: { romance: -8, trust: -3, actorMood: ['embarrassed', 'Rejected kiss', -8, 240], targetMood: ['uncomfortable', 'Unwanted kiss', -6, 240] }, mem: (c, ok) => [ok ? `I kissed ${first(c.target)} at ${venueName(c)}.` : `I went in for a kiss and ${first(c.target)} pulled away.`, ok ? `${first(c.actor)} kissed me at ${venueName(c)}.` : `${first(c.actor)} tried to kiss me and I pulled away.`] },
  { id: 'exclusive', label: 'Ask to be exclusive', group: 'Romantic', category: 'romance', minutes: 10, base: 0.5, romantic: true, show: (c) => c.rel.flags.includes('dating') && !c.rel.flags.includes('partner') && !c.rel.flags.includes('engaged') && !c.rel.flags.includes('married'), success: { romance: 6, trust: 6, actorMood: ['in_love', 'Officially a couple', 8, 720], targetMood: ['in_love', 'Officially a couple', 8, 720] }, fail: { romance: -4, actorMood: ['sad', 'Not ready to commit', -5, 480] }, mem: (c, ok) => [ok ? `${first(c.target)} and I agreed to be exclusive.` : `${first(c.target)} isn't ready to be exclusive.`, ok ? `${first(c.actor)} and I are exclusive now.` : `${first(c.actor)} asked to be exclusive; I'm not ready.`] },
  { id: 'woohoo', label: 'Woohoo', group: 'Romantic', category: 'romance', minutes: 45, base: 0.9, romantic: true, show: (c) => bothAdults(c) && (isPartnered(c.rel) || c.rel.flags.includes('affair')) && romanticallyCompatible(c.actor, c.target), success: { romance: 8, attraction: 2, trust: 2, fun: 25, targetFun: 25, social: 20, targetSocial: 20, stress: -10, targetStress: -10, actorMood: ['in_love', 'Intimate time', 10, 480], targetMood: ['in_love', 'Intimate time', 10, 480] }, fail: { romance: 2, fun: 8, social: 8 }, mem: (c) => [`${first(c.target)} and I were intimate.`, `${first(c.actor)} and I were intimate.`] },
  { id: 'propose', label: 'Propose', group: 'Romantic', category: 'romance', minutes: 10, base: 0.5, romantic: true, show: (c) => isPartnered(c.rel) && !c.rel.flags.includes('engaged') && !c.rel.flags.includes('married'), success: { romance: 15, trust: 10, actorMood: ['in_love', 'Engaged!', 15, 1440 * 3], targetMood: ['in_love', 'Engaged!', 15, 1440 * 3] }, fail: { romance: -10, trust: -5, actorMood: ['sad', 'Proposal declined', -15, 1440 * 2], targetMood: ['guilty', 'Said no to a proposal', -6, 1440] }, mem: (c, ok) => [ok ? `I proposed to ${first(c.target)} and they said yes!` : `I proposed to ${first(c.target)}. They said no.`, ok ? `${first(c.actor)} proposed to me and I said yes!` : `${first(c.actor)} proposed. I wasn't ready and said no.`] },
  { id: 'breakup', label: 'Break up', group: 'Romantic', category: 'romance', minutes: 15, base: 1, romantic: true, show: (c) => isPartnered(c.rel) && !c.rel.flags.includes('married'), success: { romance: -40, trust: -10, friendship: -10, stress: 10, targetStress: 15, actorMood: ['sad', 'Just broke up', -12, 1440 * 3], targetMood: ['sad', 'Got dumped', -18, 1440 * 5], grudge: 'broke up with me', grudgeWeight: 2 }, fail: {}, mem: (c) => [`I broke up with ${first(c.target)}.`, `${first(c.actor)} broke up with me.`], valence: -0.8 },
  // ----- Mean -----
  { id: 'insult', label: 'Insult', group: 'Mean', category: 'social', minutes: 5, base: 1, mean: true, show: (c) => c.rel.familiarity >= 1 && canTalk(c), success: { friendship: -6, trust: -3, targetMood: ['angry', 'Was insulted', -8, 240], actorMood: ['angry', 'Let off steam', 2, 60], grudge: 'insulted me', grudgeWeight: 1, reputation: -1 }, fail: {}, mem: (c) => [`I insulted ${first(c.target)}.`, `${first(c.actor)} insulted me at ${venueName(c)}.`], valence: -0.6 },
  { id: 'argue', label: 'Argue', group: 'Mean', category: 'social', minutes: 15, base: 0.3, mean: true, show: (c) => c.rel.familiarity >= 5 && canTalk(c) && !isKid(c.target), success: { friendship: 1, trust: 2, stress: -3, targetStress: -3, actorMood: ['relaxed', 'Cleared the air', 3, 180] }, fail: { friendship: -4, trust: -2, stress: 6, targetStress: 6, targetMood: ['angry', 'Had a fight', -6, 240], actorMood: ['angry', 'Had a fight', -6, 240], grudge: 'picked a fight with me', grudgeWeight: 1 }, mem: (c, ok) => [ok ? `${first(c.target)} and I argued but worked it out.` : `${first(c.target)} and I had a nasty argument.`, ok ? `${first(c.actor)} and I argued, then made up.` : `${first(c.actor)} and I had a nasty argument.`], valence: -0.4 },
  { id: 'mock', label: 'Mock', group: 'Mean', category: 'social', minutes: 5, base: 1, mean: true, show: (c) => c.rel.familiarity >= 1 && canTalk(c), success: { friendship: -5, trust: -2, targetMood: ['embarrassed', 'Was mocked', -7, 240], grudge: 'mocked me', grudgeWeight: 1, reputation: -1 }, fail: {}, mem: (c) => [`I made fun of ${first(c.target)} in front of people.`, `${first(c.actor)} mocked me at ${venueName(c)}.`], valence: -0.6 },
  { id: 'threaten', label: 'Threaten', group: 'Mean', category: 'social', minutes: 5, base: 1, mean: true, show: (c) => c.rel.familiarity >= 1 && !isKid(c.target), success: { friendship: -10, trust: -10, targetMood: ['scared', 'Was threatened', -10, 480], grudge: 'threatened me', grudgeWeight: 2, reputation: -2 }, fail: {}, mem: (c) => [`I threatened ${first(c.target)}.`, `${first(c.actor)} threatened me at ${venueName(c)}. I'm scared of them.`], valence: -0.9 },
  { id: 'slap', label: 'Slap', group: 'Mean', category: 'social', minutes: 2, base: 1, mean: true, show: (c) => c.rel.familiarity >= 1 && !isKid(c.target), success: { friendship: -20, trust: -15, romance: -15, targetMood: ['angry', 'Was slapped', -12, 720], grudge: 'slapped me', grudgeWeight: 3, reputation: -3 }, fail: {}, mem: (c) => [`I slapped ${first(c.target)}.`, `${first(c.actor)} slapped me at ${venueName(c)}.`], valence: -0.9 },
  { id: 'fight', label: 'Fight', group: 'Mean', category: 'social', minutes: 10, base: 0.5, skill: 'athletics', mean: true, show: (c) => c.rel.familiarity >= 1 && !isTeenOrKid(c.target) && !isTeenOrKid(c.actor), success: { friendship: -25, trust: -20, targetMood: ['angry', 'Lost a fight', -15, 720], actorMood: ['confident', 'Won a fight', 5, 240], grudge: 'beat me up', grudgeWeight: 4, reputation: -3 }, fail: { friendship: -25, trust: -20, targetMood: ['angry', 'Got into a fight', -8, 480], actorMood: ['angry', 'Lost a fight', -12, 720], grudge: 'started a fight with me', grudgeWeight: 3, reputation: -3 }, mem: (c, ok) => [ok ? `I fought ${first(c.target)} and won.` : `I fought ${first(c.target)} and lost.`, ok ? `${first(c.actor)} beat me up at ${venueName(c)}.` : `${first(c.actor)} started a fight with me and lost.`], valence: -1 },
  // ----- Kids -----
  { id: 'play', label: 'Play', group: 'Kids', category: 'family', minutes: 30, base: 0.85, show: (c) => (isKid(c.target) && c.target.lifeStage !== 'infant') || (isKid(c.actor) && isTeenOrKid(c.target)), success: { friendship: 5, familiarity: 3, fun: 15, targetFun: 20, social: 10, targetSocial: 15, actorMood: ['playful', 'Playtime', 4, 180], targetMood: ['playful', 'Playtime', 6, 180] }, fail: { friendship: 1, fun: 5, targetFun: 8 }, mem: (c) => [`I played with ${first(c.target)}.`, `${first(c.actor)} played with me.`] },
  { id: 'tell_story', label: 'Tell a story', group: 'Kids', category: 'family', minutes: 15, base: 0.75, skill: 'writing', show: (c) => isKid(c.target) && !isKid(c.actor), success: { friendship: 4, familiarity: 2, targetFun: 12, social: 6, targetSocial: 8, targetMood: ['inspired', 'Heard a great story', 4, 180] }, fail: { friendship: 1, targetFun: 4 }, mem: (c) => [`I told ${first(c.target)} a story.`, `${first(c.actor)} told me a story.`] },
  { id: 'help_homework', label: 'Help with homework', group: 'Kids', category: 'family', minutes: 45, base: 0.7, skill: 'logic', show: (c) => (c.target.lifeStage === 'child' || c.target.lifeStage === 'teen') && isAdult(c.actor) && (c.target.education.grade !== undefined || !!c.target.education.enrollment), success: { friendship: 4, trust: 3, social: 6, targetSocial: 6, targetMood: ['focused', 'Homework done', 3, 240] }, fail: { friendship: 1, stress: 4, targetStress: 4, targetMood: ['stressed', 'Homework struggle', -3, 120] }, mem: (c, ok) => [ok ? `I helped ${first(c.target)} with homework.` : `I tried to help ${first(c.target)} with homework; we both got frustrated.`, ok ? `${first(c.actor)} helped me with my homework.` : `${first(c.actor)} tried to help with homework and it was a mess.`] },
  { id: 'scold', label: 'Scold', group: 'Kids', category: 'family', minutes: 5, base: 1, show: (c) => isTeenOrKid(c.target) && c.target.lifeStage !== 'infant' && (c.rel.flags.includes('child') || c.rel.flags.includes('step_child')), success: { friendship: -3, trust: 1, targetMood: ['guilty', 'Got scolded', -5, 180] }, fail: {}, mem: (c) => [`I scolded ${first(c.target)}.`, `${first(c.actor)} scolded me.`], valence: -0.3 },
  { id: 'hug', label: 'Hug', group: 'Kids', category: 'family', minutes: 2, base: 0.9, show: (c) => isCloseFamily(c.rel) || isPartnered(c.rel) || c.rel.friendship >= 30, success: { friendship: 3, social: 10, targetSocial: 10, actorMood: ['happy', 'A warm hug', 3, 120], targetMood: ['happy', 'A warm hug', 3, 120] }, fail: { friendship: 0, targetMood: ['uncomfortable', 'Awkward hug', -2, 60] }, mem: (c) => [`I hugged ${first(c.target)}.`, `${first(c.actor)} gave me a hug.`] },
  { id: 'read_to', label: 'Read to', group: 'Kids', category: 'family', minutes: 20, base: 0.85, show: (c) => isKid(c.target) && !isKid(c.actor), success: { friendship: 3, familiarity: 2, targetFun: 8, social: 6, targetSocial: 8, targetMood: ['relaxed', 'Story time', 4, 180] }, fail: { friendship: 1, targetFun: 3 }, mem: (c) => [`I read to ${first(c.target)}.`, `${first(c.actor)} read to me.`] },
];

const GIFT_ITEMS: { itemId: string; label: string; romance: number; friendship: number }[] = [
  { itemId: 'gift_flowers', label: 'Give flowers', romance: 8, friendship: 4 },
  { itemId: 'gift_chocolate', label: 'Give chocolate', romance: 6, friendship: 5 },
  { itemId: 'gift_generic', label: 'Give gift', romance: 2, friendship: 6 },
];

/** A memory of the actor about a third sim, suitable for gossip. */
export function findGossip(actor: Sim, targetId: SimId): Memory | undefined {
  const candidates = actor.memory.filter((m) => m.participants.some((p) => p !== actor.id && p !== targetId) && m.kind !== 'summary' && m.salience >= 10);
  if (!candidates.length) return undefined;
  candidates.sort((a, b) => Math.abs(b.valence) - Math.abs(a.valence) || b.at - a.at);
  return candidates[0];
}

// ---------------------------------------------------------------------------
// Outcome model
// ---------------------------------------------------------------------------
function successChance(c: SocialCtx, def: SocialDef): number {
  const a = c.actor;
  const t = c.target;
  let p = def.base;
  const charisma = a.skills.charisma?.level ?? 0;
  p += charisma * 0.02;
  if (def.skill) p += (a.skills[def.skill]?.level ?? 0) * 0.04;
  p += (a.mind.mood / 100) * 0.1 + (t.mind.mood / 100) * 0.1;
  p += (c.compat - 0.5) * 0.3;
  if (hasTrait(a, 'outgoing')) p += 0.05;
  if (hasTrait(a, 'loner')) p -= 0.05;
  if (hasTrait(t, 'mean')) p -= 0.1;
  if (hasTrait(t, 'kind')) p += 0.08;
  if (hasTrait(a, 'clumsy')) p -= 0.03;
  if (def.romantic) {
    p += (c.trel.attraction / 100) * 0.3 + (c.rel.romance / 100) * 0.2;
    if (hasTrait(a, 'romantic') || hasTrait(a, 'hopeless_romantic')) p += 0.05;
    if (hasTrait(t, 'hopeless_romantic')) p += 0.05;
    if (hasTrait(t, 'commitment_issues') && ['confess', 'exclusive', 'propose'].includes(def.id)) p -= 0.25;
    p += (a.personality.libido - 0.5) * 0.1;
  }
  p -= Math.min(0.3, grudgeWeight(c.trel) * 0.08);
  if (t.needs.social < 30) p += 0.08; // lonely people welcome contact
  if (t.needs.energy < 20) p -= 0.1;
  return clamp(p, 0.03, 0.97);
}

function applyDelta(c: SocialCtx, def: SocialDef, d: Delta, ok: boolean, valence: number, mem: [string, string], source: string): EffectBundle {
  const { ctx, actor, target } = c;
  const now = ctx.state.time.minute;
  const relDelta: NonNullable<EffectBundle['relationships']>[number] = { simId: target.id, friendship: d.friendship, romance: d.romance, trust: d.trust, familiarity: d.familiarity ?? (ok ? 1 : 0.5), attraction: d.attraction, mutual: true };
  const actorBundle: EffectBundle = {
    relationships: [relDelta],
    needs: { social: d.social ?? 2, fun: d.fun },
    stress: d.stress,
    moodlets: d.actorMood ? [{ emotion: d.actorMood[0], label: d.actorMood[1], intensity: d.actorMood[2], durationMinutes: d.actorMood[3], source }] : undefined,
    memories: [{ kind: def.mean ? 'conflict' : 'interaction', text: mem[0], participants: [target.id], valence, salience: def.mean || def.romantic ? 45 : 30, tags: [def.group.toLowerCase(), def.id] }],
    skills: def.skill && ok ? { [def.skill]: 6 } : def.skill ? { [def.skill]: 2 } : undefined,
  };
  if (!def.mean && !def.romantic && isTeenOrKid(target) && isAdult(actor)) actorBundle.skills = { ...(actorBundle.skills ?? {}), parenting: 5 };
  // target-side immediate effects (needs / moodlets / grudges / memory)
  const targetBundle: EffectBundle = { needs: { social: d.targetSocial, fun: d.targetFun }, stress: d.targetStress, moodlets: d.targetMood ? [{ emotion: d.targetMood[0], label: d.targetMood[1], intensity: d.targetMood[2], durationMinutes: d.targetMood[3], source }] : undefined };
  ctx.applyEffects(target.id, targetBundle, source);
  pushMemory(target, { kind: def.mean ? 'conflict' : 'interaction', text: mem[1], participants: [actor.id], valence, salience: def.mean || def.romantic ? 45 : 30, tags: [def.group.toLowerCase(), def.id] }, now, ctx.rng);
  if (d.grudge) c.trel.grudges.push({ text: `${first(actor)} ${d.grudge}`, at: now, weight: d.grudgeWeight ?? 1 });
  if (d.reputation) {
    const witnesses = ctx.query.simsAt(actor.location.venueId).length - 2;
    if (witnesses > 0 || !c.atHome) actor.reputation = clamp(actor.reputation + d.reputation, -100, 100);
  }
  return actorBundle;
}

function witnessed(ctx: SystemContext, actor: Sim, target: Sim): boolean {
  const others = ctx.query.simsAt(actor.location.venueId).filter((s) => s.id !== actor.id && s.id !== target.id);
  const v = ctx.query.venueMaybe(actor.location.venueId);
  const isHome = v?.archetype === 'home';
  return others.length > 0 || (!isHome && ctx.rng.chance(0.5));
}

function npcAccepts(c: SocialCtx, kind: 'date' | 'confess' | 'exclusive' | 'propose' | 'hangout' | 'lend'): boolean {
  const t = c.target;
  const rel = c.trel;
  let p = 0;
  switch (kind) {
    case 'hangout':
      p = 0.5 + rel.friendship / 200 + (hasTrait(t, 'outgoing') ? 0.15 : 0) - (hasTrait(t, 'loner') ? 0.15 : 0);
      break;
    case 'date':
      p = 0.25 + rel.romance / 150 + rel.attraction / 250 + (c.compat - 0.5) * 0.3;
      break;
    case 'confess':
      p = 0.15 + rel.romance / 100 + (c.compat - 0.5) * 0.4 + (hasTrait(t, 'hopeless_romantic') ? 0.15 : 0) - (hasTrait(t, 'commitment_issues') ? 0.3 : 0);
      break;
    case 'exclusive':
      p = 0.3 + rel.romance / 120 + rel.trust / 200 - (hasTrait(t, 'commitment_issues') ? 0.4 : 0);
      break;
    case 'propose':
      p = 0.1 + rel.romance / 120 + rel.trust / 150 + (t.personality.values.family - 0.5) * 0.5 - (hasTrait(t, 'commitment_issues') ? 0.5 : 0) + (daysSince(Number(t.flags[`dating_since:${c.actor.id}`]) || undefined, c.ctx.state.time.minute) > 180 ? 0.15 : 0);
      break;
    case 'lend':
      p = 0.15 + rel.trust / 150 + rel.friendship / 250 + (hasTrait(t, 'generous') ? 0.25 : 0) - (hasTrait(t, 'frugal') ? 0.15 : 0);
      break;
  }
  p -= Math.min(0.4, grudgeWeight(rel) * 0.1);
  return c.ctx.rng.chance(clamp(p, 0.02, 0.98));
}

// ---------------------------------------------------------------------------
// Action construction
// ---------------------------------------------------------------------------
function buildCtx(ctx: SystemContext, actor: Sim, target: Sim): SocialCtx {
  const now = ctx.state.time.minute;
  const rel = ensureRelationship(actor, target.id, now);
  const trel = ensureRelationship(target, actor.id, now);
  const venue = ctx.query.venueMaybe(actor.location.venueId);
  const home = ctx.query.homeOf(actor.id);
  return { ctx, actor, target, rel, trel, present: target.location.venueId === actor.location.venueId && !target.travel, atHome: !!home && home.id === venue?.id, compat: compatibility(actor, target) };
}

function socialActionsFor(ctx: SystemContext, actor: Sim, target: Sim): ActionDef[] {
  const c = buildCtx(ctx, actor, target);
  const name = simName(target);
  const out: ActionDef[] = [];
  const base = (id: string, label: string, category: ActionCategory, minutes: number, reqs: Requirement[] = [], extra: Partial<ActionDef> = {}): ActionDef => ({
    id: `social:${target.id}:${id}`,
    label,
    category,
    target: { kind: 'sim', id: target.id, name },
    durationMinutes: minutes,
    requirements: reqs,
    effects: {},
    interruptible: true,
    group: name,
    ...extra,
  });
  const asleep = !!target.currentAction && /sleep|nap/i.test(target.currentAction.actionId);
  // Talk (LLM conversation)
  if (canTalk(c)) {
    out.push(base('converse', `Talk to ${first(target)}`, 'social', 0, asleep ? [blocked(`${first(target)} is asleep`)] : [], { llm: 'converse', icon: 'chat', description: 'Start a conversation (LLM-driven).' }));
  }
  for (const def of SOCIAL_DEFS) {
    if (!def.show(c)) continue;
    const reqs: Requirement[] = [];
    if (asleep) reqs.push(blocked(`${first(target)} is asleep`));
    const reason = def.block?.(c);
    if (reason) reqs.push(blocked(reason));
    if (def.id === 'woohoo') {
      const v = ctx.query.venueMaybe(actor.location.venueId);
      const hasBed = ctx.query.objectsAt(actor.location.venueId).some((o) => o.defId.startsWith('bed_') || o.defId === 'hotel_bed');
      const okVenue = v && (v.archetype === 'home' || v.archetype === 'hotel' || v.archetype === 'apartment_building');
      if (!okVenue) reqs.push(blocked('Needs somewhere private'));
      else if (!hasBed && Object.keys(ctx.content.objects).length > 0) reqs.push(blocked('No bed here'));
      reqs.push({ kind: 'energy', reason: 'Too tired', params: { min: 20 } });
      if (target.needs.energy < 15) reqs.push(blocked(`${first(target)} is exhausted`));
    }
    if (def.id === 'propose') {
      if (c.rel.romance < 70) reqs.push(blocked('Not enough romance yet (70)'));
      if (c.rel.trust < 40) reqs.push(blocked('Not enough trust yet (40)'));
      if (datingDays(c) < 30) reqs.push(blocked('You have not been together long enough (30 days)'));
    }
    if (def.id === 'lend_money') reqs.push({ kind: 'money', reason: 'Not enough cash', params: { amount: 50, noCredit: true } });
    let label = def.label;
    if (def.id === 'flirt' && !isSingle(actor) && !isPartnered(c.rel)) label = 'Flirt (cheating)';
    const extra: Partial<ActionDef> = { icon: def.icon, autonomyWeight: def.mean ? 0 : def.romantic ? 0.4 : 0.8 };
    if (def.id === 'lend_money' || def.id === 'borrow_money') extra.params = { amount: def.id === 'lend_money' ? 50 : 100 };
    out.push(base(def.id, label, def.category, def.minutes, reqs, extra));
  }
  // gifts (one action per owned gift item)
  if (canTalk(c) && c.rel.familiarity >= 3) {
    for (const g of GIFT_ITEMS) {
      if ((actor.inventory.consumables[g.itemId] ?? 0) > 0) out.push(base(`give_${g.itemId}`, `${g.label} to ${first(target)}`, 'social', 5, [{ kind: 'item', reason: `Need ${g.itemId.replace('gift_', '')}`, params: { itemId: g.itemId, qty: 1 } }], { icon: 'gift' }));
    }
  }
  return out;
}

function ghostActions(ctx: SystemContext, actor: Sim): ActionDef[] {
  const out: ActionDef[] = [];
  for (const id of actor.phone.contacts) {
    const t = ctx.state.sims[id];
    if (!t || !t.body.alive || t.location.venueId === actor.location.venueId) continue;
    const rel = actor.relationships[id];
    if (!rel || rel.flags.includes('blocked') || isCloseFamily(rel)) continue;
    if (actor.flags[`ghosted:${id}`]) continue;
    out.push({ id: `social:${id}:ghost`, label: `Ghost ${first(t)}`, description: 'Stop responding. They will notice.', category: 'phone', target: { kind: 'sim', id, name: simName(t) }, durationMinutes: 1, effects: {}, group: 'Phone: contacts', icon: 'ghost' });
  }
  return out;
}

/** Expose pending-interrupt options (for a system prefix) as executable actions so `engine.perform` can find them. */
export function pendingInterruptActions(ctx: SystemContext, prefix: string): ActionDef[] {
  const out: ActionDef[] = [];
  for (const i of ctx.state.pendingInterrupts) {
    for (const o of i.options) {
      if (!o.actionId.startsWith(prefix)) continue;
      out.push({ id: o.actionId, label: o.label, category: 'system', durationMinutes: 0, effects: {}, group: i.title, params: o.params, interruptible: false });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------
function execute(ctx: SystemContext, simId: SimId, action: ActionDef, params: Record<string, unknown>): ActionResult {
  const parts = action.id.split(':');
  const targetId = parts[1] as SimId;
  const inter = parts.slice(2).join(':');
  const actor = ctx.state.sims[simId];
  const target = ctx.state.sims[targetId];
  if (!actor || !target || !target.body.alive) return { ok: false, text: 'They are not here.' };
  const now = ctx.state.time.minute;
  const c = buildCtx(ctx, actor, target);
  const src = `social:${inter}`;
  const you = ctx.query.isControlled(simId);
  const tn = first(target);

  if (inter === 'converse') {
    if (!c.present) return { ok: false, text: `${tn} is not here.` };
    return { ok: true, text: `You start talking to ${tn}.`, effects: { needs: { social: 4 }, relationships: [{ simId: target.id, familiarity: 1, mutual: true }] }, data: { openConversation: true, targetId: target.id, channel: 'in_person' } };
  }
  if (inter === 'ghost') {
    actor.flags[`ghosted:${target.id}`] = now;
    c.trel.grudges.push({ text: `${first(actor)} ghosted me`, at: now, weight: 2 });
    ctx.applyEffects(target.id, { relationships: [{ simId: actor.id, trust: -20, friendship: -10, romance: -10 }], moodlets: [{ emotion: 'sad', label: `${first(actor)} stopped responding`, intensity: -6, durationMinutes: 1440 * 3 }] }, src);
    pushMemory(target, { text: `${simName(actor)} ghosted me.`, participants: [actor.id], valence: -0.6, salience: 45, tags: ['mean', 'ghost'] }, now, ctx.rng);
    return { ok: true, text: `You stop responding to ${tn}.`, effects: { memories: [{ kind: 'interaction', text: `I ghosted ${simName(target)}.`, participants: [target.id], valence: -0.2 }] } };
  }
  if (inter.startsWith('give_gift_')) {
    const itemId = inter.replace('give_', '');
    const g = GIFT_ITEMS.find((x) => x.itemId === itemId);
    if (!g) return { ok: false, text: 'No gift.' };
    const romantic = romanticallyCompatible(actor, target) && (isSingle(target) || isPartnered(c.rel));
    const liked = ctx.rng.chance(0.85 + (hasTrait(target, 'materialistic') ? 0.1 : 0));
    const mem: [string, string] = [`I gave ${tn} ${itemId.replace('gift_', '')}.`, `${first(actor)} gave me ${itemId.replace('gift_', '')}${liked ? '. Sweet.' : '. Odd choice.'}`];
    const bundle = applyDelta(c, { id: inter, label: g.label, group: 'Friendly', category: 'social', minutes: 5, base: 1, show: () => true, success: {}, fail: {}, mem: () => mem }, liked ? { friendship: g.friendship, romance: romantic ? g.romance : 0, attraction: romantic ? 2 : 0, targetMood: ['grateful', 'Got a gift', 6, 480], social: 4, targetSocial: 6 } : { friendship: 1, targetMood: ['uncomfortable', 'Awkward gift', -2, 120] }, liked, liked ? 0.5 : 0, mem, src);
    bundle.items = [{ op: 'lose', itemId, qty: 1 }];
    return { ok: true, text: liked ? `${tn} loves it.` : `${tn} thanks you politely.`, effects: bundle };
  }

  const def = SOCIAL_DEFS.find((d) => d.id === inter);
  if (!def) return { ok: false, text: 'Unknown interaction.' };
  if (!c.present) return { ok: false, text: `${tn} is not here.` };

  // decisions that need the NPC's consent rather than a skill roll
  let ok: boolean;
  switch (def.id) {
    case 'invite_hangout':
      ok = npcAccepts(c, 'hangout');
      break;
    case 'ask_date':
      ok = npcAccepts(c, 'date') || ctx.rng.chance(successChance(c, def) * 0.5);
      break;
    case 'confess':
      ok = npcAccepts(c, 'confess');
      break;
    case 'exclusive':
      ok = npcAccepts(c, 'exclusive');
      break;
    case 'propose':
      ok = npcAccepts(c, 'propose');
      break;
    case 'borrow_money':
      ok = npcAccepts(c, 'lend');
      break;
    case 'lend_money':
    case 'breakup':
    case 'insult':
    case 'mock':
    case 'threaten':
    case 'slap':
    case 'scold':
      ok = true;
      break;
    default:
      ok = ctx.rng.chance(successChance(c, def));
  }
  const delta = ok ? def.success : def.fail;
  const valence = def.valence ?? (ok ? 0.4 : -0.3);
  const mem = def.mem(c, ok);
  const bundle = applyDelta(c, def, delta, ok, valence, mem, src);
  let text = ok ? `${tn} responds well.` : `That didn't land.`;

  switch (def.id) {
    case 'exchange_numbers':
      if (!actor.phone.contacts.includes(target.id)) actor.phone.contacts.push(target.id);
      if (!target.phone.contacts.includes(actor.id)) target.phone.contacts.push(actor.id);
      text = `You and ${tn} exchange numbers.`;
      break;
    case 'invite_hangout': {
      if (ok) {
        const home = ctx.query.homeOf(actor.id);
        const mod = ctx.clock.minuteOfDay;
        const at = now - mod + DAY + 18 * HOUR;
        ctx.schedule({ atMinute: at, kind: 'visitor', label: `${tn} comes over`, simId: actor.id, venueId: home?.id, payload: { source: 'relationships', kind: 'hangout', hostId: actor.id, guestId: target.id } });
        text = `${tn} says they'll come by tomorrow evening.`;
      } else text = `${tn} is busy this week.`;
      break;
    }
    case 'ask_date': {
      if (ok) {
        const venue = ctx.query.nearestVenue(actor.location.venueId, 'restaurant') ?? ctx.query.nearestVenue(actor.location.venueId, 'cinema') ?? ctx.query.nearestVenue(actor.location.venueId, 'cafe');
        const mod = ctx.clock.minuteOfDay;
        const daysAhead = mod < 15 * HOUR ? 1 : 2;
        const at = now - mod + daysAhead * DAY + 19 * HOUR;
        ctx.schedule({ atMinute: at, kind: 'reminder', label: `Date with ${tn}${venue ? ` at ${venue.name}` : ''}`, simId: actor.id, venueId: venue?.id, payload: { source: 'relationships', kind: 'date', simId: actor.id, otherId: target.id, venueId: venue?.id } });
        text = `${tn} says yes${venue ? ` — ${venue.name}, 7 PM` : ''}.`;
      } else text = `${tn} lets you down gently.`;
      break;
    }
    case 'confess':
      if (ok) {
        setFlags(ctx, actor, target, [{ flag: 'dating', op: 'add' }], src);
        actor.flags[`dating_since:${target.id}`] = now;
        target.flags[`dating_since:${actor.id}`] = now;
        ctx.emit({ type: 'relationship:milestone', simId: actor.id, otherId: target.id, milestone: 'dating' });
        text = `${tn} feels the same. You're dating.`;
        ctx.log({ text: you ? `You and ${simName(target)} are now dating.` : `${simName(actor)} and ${simName(target)} started dating.`, kind: 'relationship', simId: actor.id, importance: 3 });
      } else text = `${tn} doesn't feel the same way.`;
      break;
    case 'exclusive':
      if (ok) {
        setFlags(ctx, actor, target, [{ flag: 'partner', op: 'add' }], src);
        ctx.emit({ type: 'relationship:milestone', simId: actor.id, otherId: target.id, milestone: 'partner' });
        text = `${tn} agrees — you're officially a couple.`;
      } else text = `${tn} isn't ready for that.`;
      break;
    case 'propose':
      ctx.emit({ type: 'family:proposal', simId: actor.id, otherId: target.id, accepted: ok });
      text = ok ? `${tn} says YES.` : `${tn} says no.`;
      ctx.log({ text: ok ? (you ? `You proposed to ${simName(target)} — they said yes!` : `${simName(actor)} proposed to ${simName(target)}; they said yes.`) : you ? `You proposed to ${simName(target)}. They said no.` : `${simName(target)} turned down ${simName(actor)}'s proposal.`, kind: 'relationship', simId: actor.id, importance: 3 });
      break;
    case 'breakup':
      breakUp(ctx, actor, target, actor.id, src);
      text = `You break up with ${tn}.`;
      break;
    case 'lend_money': {
      const amount = round2(Math.max(1, Number(params.amount ?? 50)));
      if (liquidCash(actor) < amount) return { ok: false, text: 'Not enough cash.' };
      transact(actor, -amount, `Loan to ${simName(target)}`, now, { category: 'loan', counterparty: simName(target), rng: ctx.rng, allowCredit: false });
      transact(target, amount, `Loan from ${simName(actor)}`, now, { category: 'loan', counterparty: simName(actor), rng: ctx.rng });
      c.rel.moneyOwed = round2(c.rel.moneyOwed + amount);
      c.trel.moneyOwed = round2(c.trel.moneyOwed - amount);
      text = `You lend ${tn} $${amount.toFixed(2)}.`;
      break;
    }
    case 'borrow_money': {
      const amount = round2(Math.max(1, Number(params.amount ?? 100)));
      if (ok && liquidCash(target) >= amount) {
        transact(target, -amount, `Loan to ${simName(actor)}`, now, { category: 'loan', counterparty: simName(actor), rng: ctx.rng, allowCredit: false });
        transact(actor, amount, `Loan from ${simName(target)}`, now, { category: 'loan', counterparty: simName(target), rng: ctx.rng });
        c.trel.moneyOwed = round2(c.trel.moneyOwed + amount);
        c.rel.moneyOwed = round2(c.rel.moneyOwed - amount);
        text = `${tn} lends you $${amount.toFixed(2)}.`;
      } else text = ok ? `${tn} would help but is broke right now.` : `${tn} says no.`;
      break;
    }
    case 'gossip': {
      const m = findGossip(actor, target.id);
      if (m) {
        const subjectId = m.participants.find((p) => p !== actor.id && p !== target.id);
        pushMemory(target, { kind: 'gossip', text: `${first(actor)} told me: ${m.text}`, participants: subjectId ? [actor.id, subjectId] : [actor.id], valence: m.valence, salience: Math.max(15, m.salience - 10), tags: ['gossip', ...m.tags] }, now, ctx.rng);
        const subject = subjectId ? ctx.state.sims[subjectId] : undefined;
        if (subject && m.valence < -0.2) subject.reputation = clamp(subject.reputation - 1, -100, 100);
        if (hasTrait(actor, 'gossip')) bundle.needs = { ...(bundle.needs ?? {}), fun: (bundle.needs?.fun ?? 0) + 5 };
        text = ok ? `${tn} leans in for the details.` : `${tn} isn't interested in gossip.`;
      }
      break;
    }
    case 'apologize':
      if (ok) c.trel.grudges.shift();
      break;
    case 'woohoo': {
      const condoms = (actor.inventory.consumables.condoms ?? 0) > 0 ? actor : (target.inventory.consumables.condoms ?? 0) > 0 ? target : undefined;
      if (condoms) ctx.applyEffects(condoms.id, { items: [{ op: 'lose', itemId: 'condoms', qty: 1 }] }, src);
      bundle.needs = { ...(bundle.needs ?? {}), hygiene: -15, energy: -10 };
      ctx.applyEffects(target.id, { needs: { hygiene: -15, energy: -10 } }, src);
      const female = [actor, target].find((s) => s.identity.gender === 'female');
      const male = [actor, target].find((s) => s.identity.gender === 'male');
      if (!condoms) {
        if (female && male && !female.body.pregnancy) {
          const onPill = (female.inventory.consumables.birth_control ?? 0) > 0 || female.body.medications.includes('birth_control') || female.flags.birth_control === true;
          const chance = onPill ? 0.005 : 0.12 * female.body.fertility * male.body.fertility * (ctx.state.flags.fastPregnancy ? 1 : 1);
          if (ctx.rng.chance(chance)) bundle.custom = [...(bundle.custom ?? []), { kind: 'family:conception', payload: { a: female.id, b: male.id } }];
        }
        if (ctx.rng.chance(0.02)) bundle.custom = [...(bundle.custom ?? []), { kind: 'health:exposure_sti', payload: { partnerId: target.id } }];
      }
      if (!isPartnered(c.rel) && c.rel.flags.includes('affair')) c.rel.flags.push('affair');
      text = `You and ${tn} spend some time together.`;
      break;
    }
    case 'flirt':
      if (ok) {
        const partner = partnerOf(actor);
        if (partner && partner !== target.id && c.rel.romance + 5 >= 15) {
          if (!c.rel.flags.includes('affair')) setFlags(ctx, actor, target, [{ flag: 'affair', op: 'add' }], src);
          bundle.moodlets = [...(bundle.moodlets ?? []), { emotion: 'guilty', label: 'Sneaking around', intensity: -3, durationMinutes: 240 }];
        }
      }
      break;
    case 'threaten':
      if (witnessed(ctx, actor, target)) {
        ctx.emit({ type: 'legal:crime_committed', simId: actor.id, crimeId: 'disorderly_conduct', venueId: actor.location.venueId, witnessed: true });
        text = `People saw that.`;
      }
      break;
    case 'slap': {
      const wit = witnessed(ctx, actor, target);
      ctx.emit({ type: 'legal:crime_committed', simId: actor.id, crimeId: 'assault', venueId: actor.location.venueId, witnessed: wit });
      ctx.emit({ type: 'custom', kind: 'health:injury', simId: target.id, payload: { name: 'Slapped', bodyPart: 'face', severity: 6, cause: actor.id } });
      text = `You slap ${tn}.${wit ? ' People saw.' : ''}`;
      break;
    }
    case 'fight': {
      const wit = witnessed(ctx, actor, target);
      ctx.emit({ type: 'legal:crime_committed', simId: actor.id, crimeId: 'assault', venueId: actor.location.venueId, witnessed: wit });
      const loser = ok ? target : actor;
      const winner = ok ? actor : target;
      ctx.emit({ type: 'custom', kind: 'health:injury', simId: loser.id, payload: { name: 'Bruises and cuts', bodyPart: 'face', severity: 20 + ctx.rng.int(0, 20), cause: winner.id } });
      ctx.emit({ type: 'custom', kind: 'health:injury', simId: winner.id, payload: { name: 'Bruised knuckles', bodyPart: 'hand', severity: 5 + ctx.rng.int(0, 10), cause: loser.id } });
      ctx.applyEffects(loser.id, { health: -5 }, src);
      if (ctx.rng.chance(wit ? 0.5 : 0.1)) ctx.emit({ type: 'legal:police_called', venueId: actor.location.venueId, reason: 'fight', simId: actor.id });
      text = ok ? `You win the fight.` : `${tn} gets the better of you.`;
      break;
    }
    default:
      break;
  }
  if (def.mean && isPartnered(c.rel) && def.id !== 'argue') c.trel.romance = clamp(c.trel.romance - 5, -100, 100);
  return { ok: true, text, effects: bundle, outcomeLabel: ok ? 'success' : 'fail' };
}

export function setFlags(ctx: SystemContext, a: Sim, b: Sim, flags: { flag: RelationshipFlag; op: 'add' | 'remove' }[], source: string): void {
  ctx.applyEffects(a.id, { relationships: [{ simId: b.id, flags, mutual: true }] }, source);
}

export function breakUp(ctx: SystemContext, a: Sim, b: Sim, initiator: SimId, source: string): void {
  const now = ctx.state.time.minute;
  const wasMarried = !!a.relationships[b.id]?.flags.includes('married');
  const remove: { flag: RelationshipFlag; op: 'remove' }[] = PARTNER_FLAGS.map((f) => ({ flag: f, op: 'remove' as const }));
  remove.push({ flag: 'crush', op: 'remove' }, { flag: 'affair', op: 'remove' });
  setFlags(ctx, a, b, [...remove, { flag: wasMarried ? 'divorced' : 'ex', op: 'add' }], source);
  const ra = ensureRelationship(a, b.id, now);
  const rb = ensureRelationship(b, a.id, now);
  ra.decayRate = 0.4;
  rb.decayRate = 0.4;
  delete a.flags[`dating_since:${b.id}`];
  delete b.flags[`dating_since:${a.id}`];
  ctx.emit({ type: 'relationship:breakup', simId: a.id, otherId: b.id, initiator });
  const dumped = initiator === a.id ? b : a;
  const who = initiator === a.id ? a : b;
  ctx.log({ text: ctx.query.isControlled(who.id) ? `You broke up with ${simName(dumped)}.` : ctx.query.isControlled(dumped.id) ? `${simName(who)} broke up with you.` : `${simName(who)} and ${simName(dumped)} broke up.`, kind: 'relationship', simId: who.id, importance: 3 });
}

// ---------------------------------------------------------------------------
// Ticks & events
// ---------------------------------------------------------------------------
function dailyPass(ctx: SystemContext): void {
  const now = ctx.state.time.minute;
  const sims = ctx.query.simulatedSims();
  const controlled = new Set(ctx.state.player.controlledSimIds);
  for (const sim of sims) {
    for (const rel of Object.values(sim.relationships)) {
      if (rel.decayRate === 0.4 || rel.decayRate === 0.05) rel.decayRate = decayRateFor(rel);
      const idle = daysSince(rel.lastInteractedAt ?? rel.firstMetAt, now);
      if (idle > 3) {
        const r = rel.decayRate;
        if (rel.friendship > 0) rel.friendship = Math.max(0, rel.friendship - r);
        else if (rel.friendship < 0) rel.friendship = Math.min(0, rel.friendship + r * 0.5);
        if (rel.romance > 0) rel.romance = Math.max(0, rel.romance - r);
        else if (rel.romance < 0) rel.romance = Math.min(0, rel.romance + r * 0.5);
        if (rel.trust > 0) rel.trust = Math.max(0, rel.trust - r * 0.25);
      }
      // affair discovery
      if (rel.flags.includes('affair')) {
        const partnerId = partnerOf(sim);
        const partner = partnerId ? ctx.state.sims[partnerId] : undefined;
        const third = ctx.state.sims[rel.simId];
        if (partner && third && partnerId !== rel.simId) {
          const knowsThird = (partner.relationships[third.id]?.familiarity ?? 0) > 10;
          if (ctx.rng.chance(knowsThird ? 0.08 : 0.03)) {
            ctx.applyEffects(partner.id, { relationships: [{ simId: sim.id, trust: -40, romance: -50, friendship: -20 }], moodlets: [{ emotion: 'angry', label: 'Betrayed', intensity: -20, durationMinutes: 1440 * 7 }] }, 'affair:discovered');
            ensureRelationship(partner, sim.id, now).grudges.push({ text: `${first(sim)} cheated on me with ${first(third)}`, at: now, weight: 5 });
            pushMemory(partner, { kind: 'conflict', text: `I found out ${simName(sim)} has been cheating on me with ${simName(third)}.`, participants: [sim.id, third.id], valence: -1, salience: 90, tags: ['affair'] }, now, ctx.rng);
            ctx.log({ text: controlled.has(sim.id) ? `${simName(partner)} found out about you and ${simName(third)}.` : controlled.has(partner.id) ? `You found out ${simName(sim)} has been seeing ${simName(third)} behind your back.` : `${simName(partner)} found out ${simName(sim)} was cheating.`, kind: 'relationship', simId: partner.id, importance: 3 });
            breakUp(ctx, partner, sim, partner.id, 'affair');
            rel.flags = rel.flags.filter((f) => f !== 'affair');
          }
        } else rel.flags = rel.flags.filter((f) => f !== 'affair');
      }
    }
    // memory hygiene: salience decays, prune the dull stuff
    for (const m of sim.memory) if (m.kind !== 'summary' && m.kind !== 'milestone') m.salience = Math.max(3, m.salience - (m.kind === 'interaction' ? 1 : 0.5));
    if (sim.memory.length > 150) {
      sim.memory.sort((a, b) => b.salience - a.salience || b.at - a.at);
      sim.memory = sim.memory.slice(0, 150);
    }
  }
}

function monthlyPass(ctx: SystemContext): void {
  for (const sim of ctx.query.aliveSims()) {
    for (const rel of Object.values(sim.relationships)) {
      if (!rel.grudges.length) continue;
      const forgiving = sim.personality.agreeableness > 0.6 || hasTrait(sim, 'kind');
      for (const g of rel.grudges) g.weight *= forgiving ? 0.4 : 0.6;
      rel.grudges = rel.grudges.filter((g) => g.weight >= 0.5);
    }
  }
}

function onArrived(ctx: SystemContext, simId: SimId, venueId: VenueId): void {
  if (!ctx.query.isControlled(simId)) return;
  const sim = ctx.state.sims[simId];
  if (!sim) return;
  const venue = ctx.query.venueMaybe(venueId);
  if (!venue || venue.archetype === 'home') return;
  const rate = ctx.content.archetypes[venue.archetype]?.encounterRate ?? 0.15;
  const strangers = ctx.query.simsAt(venueId).filter((s) => s.id !== simId && !sim.relationships[s.id] && !isKid(s));
  if (!strangers.length) return;
  if (!ctx.rng.chance(clamp(rate + sim.personality.extraversion * 0.1, 0.05, 0.6))) return;
  const s = ctx.rng.pick(strangers);
  const now = ctx.state.time.minute;
  const a = ensureRelationship(sim, s.id, now);
  const b = ensureRelationship(s, sim.id, now);
  a.familiarity = Math.max(a.familiarity, 1);
  b.familiarity = Math.max(b.familiarity, 1);
  a.attraction = romanticallyCompatible(sim, s) ? ctx.rng.int(10, 60) : 0;
  b.attraction = romanticallyCompatible(s, sim) ? ctx.rng.int(10, 60) : 0;
  const desc = `${s.identity.appearance.build} ${s.identity.gender === 'female' ? 'woman' : s.identity.gender === 'male' ? 'man' : 'person'} with ${s.identity.appearance.hair} hair, ${s.identity.appearance.style} style`;
  ctx.log({ text: `You notice a ${desc}${s.role?.role ? ` (${s.role.role})` : ''} at ${venue.name}.`, kind: 'narrative', simId, venueId, importance: 1, meta: { noticedSimId: s.id } });
  ctx.emit({ type: 'sim:met', simId, otherId: s.id, venueId });
}

function onMilestone(ctx: SystemContext, e: Extract<GameEvent, { type: 'relationship:milestone' }>): void {
  const sim = ctx.state.sims[e.simId];
  const other = ctx.state.sims[e.otherId];
  if (!sim || !other) return;
  const labels: Record<string, [string, EmotionId, number]> = {
    friend: ['are now friends', 'happy', 5],
    good_friend: ['are now good friends', 'happy', 8],
    best_friend: ['are now best friends', 'proud', 12],
    enemy: ['are now enemies', 'angry', -8],
    dating: ['are now dating', 'in_love', 10],
    partner: ['are officially a couple', 'in_love', 10],
  };
  const l = labels[e.milestone];
  if (!l) return;
  if (ctx.query.isControlled(sim.id)) {
    ctx.log({ text: `You and ${simName(other)} ${l[0]}.`, kind: 'relationship', simId: sim.id, importance: 2 });
    ctx.applyEffects(sim.id, { moodlets: [{ emotion: l[1], label: `${simName(other)}: ${e.milestone.replace('_', ' ')}`, intensity: l[2], durationMinutes: 1440, id: `ms:${other.id}:${e.milestone}` }] }, 'relationship:milestone');
    pushMemory(sim, { kind: 'milestone', text: `${simName(other)} and I ${l[0]}.`, participants: [other.id], salience: 60, valence: l[2] > 0 ? 0.6 : -0.6, tags: ['milestone'] }, ctx.state.time.minute, ctx.rng);
  } else if (ctx.query.isControlled(other.id) && e.milestone !== 'enemy') {
    ctx.log({ text: `${simName(sim)} now considers you a ${e.milestone.replace('_', ' ')}.`, kind: 'relationship', simId: other.id, importance: 1 });
  }
}

function onRomanceChanged(ctx: SystemContext, e: Extract<GameEvent, { type: 'relationship:changed' }>): void {
  if (e.axis !== 'romance') return;
  const sim = ctx.state.sims[e.simId];
  const rel = sim?.relationships[e.otherId];
  if (!sim || !rel) return;
  const has = rel.flags.includes('crush');
  if (e.value >= 20 && !has && !isPartnered(rel)) rel.flags.push('crush');
  else if ((e.value < 5 || isPartnered(rel)) && has) rel.flags = rel.flags.filter((f) => f !== 'crush');
}

function onScheduled(ctx: SystemContext, ev: Extract<GameEvent, { type: 'scheduled:fired' }>['event']): void {
  const p = ev.payload ?? {};
  if (p.source !== 'relationships') return;
  const now = ctx.state.time.minute;
  if (p.kind === 'hangout') {
    const host = ctx.state.sims[p.hostId as SimId];
    const guest = ctx.state.sims[p.guestId as SimId];
    const home = host && ctx.query.homeOf(host.id);
    if (!host || !guest || !home || !guest.body.alive || !host.body.alive) return;
    if (host.location.venueId !== home.id) {
      ctx.log({ text: `${first(guest)} stopped by your place but you weren't home.`, kind: 'relationship', simId: host.id, importance: 1 });
      ctx.applyEffects(guest.id, { relationships: [{ simId: host.id, friendship: -3, trust: -2 }] }, 'hangout:missed');
      ensureRelationship(guest, host.id, now).grudges.push({ text: `${first(host)} invited me over and wasn't home`, at: now, weight: 1 });
      return;
    }
    guest.travel = undefined;
    guest.location = { venueId: home.id, arrivedAt: now };
    ctx.emit({ type: 'sim:arrived', simId: guest.id, venueId: home.id });
    if (ctx.query.isControlled(host.id)) {
      ctx.interrupt({ kind: 'visitor', title: `${first(guest)} is at the door`, body: `${simName(guest)} came over to hang out.`, simId: host.id, fromSimId: guest.id, options: [{ label: 'Hang out', actionId: `social:${guest.id}:hangout` }, { label: 'Talk', actionId: `social:${guest.id}:converse` }] });
    }
  } else if (p.kind === 'date') {
    const a = ctx.state.sims[p.simId as SimId];
    const b = ctx.state.sims[p.otherId as SimId];
    const venueId = (p.venueId as VenueId | undefined) ?? a?.location.venueId;
    if (!a || !b || !venueId || !a.body.alive || !b.body.alive) return;
    if (a.location.venueId !== venueId) {
      ctx.log({ text: `You stood ${simName(b)} up.`, kind: 'relationship', simId: a.id, importance: 2 });
      ctx.applyEffects(b.id, { relationships: [{ simId: a.id, romance: -15, trust: -10, friendship: -5 }], moodlets: [{ emotion: 'sad', label: 'Stood up', intensity: -8, durationMinutes: 1440 }] }, 'date:stood_up');
      ensureRelationship(b, a.id, now).grudges.push({ text: `${first(a)} stood me up`, at: now, weight: 2 });
      pushMemory(b, { kind: 'conflict', text: `${simName(a)} stood me up on our date.`, participants: [a.id], valence: -0.7, salience: 55, tags: ['date'] }, now, ctx.rng);
      return;
    }
    b.travel = undefined;
    b.location = { venueId, arrivedAt: now };
    ctx.emit({ type: 'sim:arrived', simId: b.id, venueId });
    ctx.applyEffects(a.id, { relationships: [{ simId: b.id, romance: 6, friendship: 3, familiarity: 3, mutual: true }], moodlets: [{ emotion: 'flirty', label: 'On a date', intensity: 8, durationMinutes: 240 }], needs: { social: 15, fun: 10 } }, 'date');
    ctx.applyEffects(b.id, { moodlets: [{ emotion: 'flirty', label: 'On a date', intensity: 8, durationMinutes: 240 }], needs: { social: 15, fun: 10 } }, 'date');
    pushMemory(b, { text: `${simName(a)} and I went on a date at ${ctx.query.venueMaybe(venueId)?.name ?? 'a restaurant'}.`, participants: [a.id], valence: 0.6, salience: 50, tags: ['date'] }, now, ctx.rng);
    if (ctx.query.isControlled(a.id)) {
      ctx.log({ text: `${simName(b)} arrives for your date.`, kind: 'relationship', simId: a.id, importance: 2 });
      ctx.interrupt({ kind: 'visitor', title: `Your date is here`, body: `${simName(b)} just walked in.`, simId: a.id, fromSimId: b.id, options: [{ label: 'Talk', actionId: `social:${b.id}:converse` }, { label: 'Flirt', actionId: `social:${b.id}:flirt` }] });
    }
  }
}

export const relationshipsSystem: System = {
  id: 'relationships',
  intervalMinutes: 60,
  onTick(ctx) {
    const day = Math.floor(ctx.state.time.minute / DAY);
    const last = Number(ctx.state.flags['rel:lastDecayDay'] ?? -1);
    if (day !== last) {
      ctx.state.flags['rel:lastDecayDay'] = day;
      dailyPass(ctx);
    }
  },
  onEvent(ctx, e) {
    switch (e.type) {
      case 'sim:arrived':
        onArrived(ctx, e.simId, e.venueId);
        break;
      case 'relationship:milestone':
        onMilestone(ctx, e);
        break;
      case 'relationship:changed':
        onRomanceChanged(ctx, e);
        break;
      case 'scheduled:fired':
        onScheduled(ctx, e.event);
        break;
      case 'time:month':
        monthlyPass(ctx);
        break;
      default:
        break;
    }
  },
  actions(ctx, simId) {
    const actor = ctx.state.sims[simId];
    if (!actor || !actor.body.alive) return [];
    const out: ActionDef[] = [];
    if (!isKid(actor) || actor.lifeStage === 'child') {
      for (const t of ctx.query.simsAt(actor.location.venueId)) {
        if (t.id === simId) continue;
        out.push(...socialActionsFor(ctx, actor, t));
      }
      out.push(...ghostActions(ctx, actor));
    }
    out.push(...pendingInterruptActions(ctx, 'social:'));
    return out;
  },
  handles: (id) => id.startsWith('social:'),
  execute,
};
