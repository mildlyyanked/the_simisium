/**
 * Communication system — the phone.
 *
 *  - contacts, text threads, missed calls, notifications (`sim.phone`)
 *  - NPC-initiated texts & calls for controlled sims, scaled by relationship (partner daily, friends 2–3×/week,
 *    parents weekly). NPC text content is a TEMPLATE the LLM layer replaces: the TextMessage.text is
 *    "[Maya texts you about weekend plans]" and the log entry carries `meta.needsLlm = true`,
 *    `meta.reason`, `meta.fromSimId`, `meta.messageId`. The store should call `llm.npcMessage(state, from, to, reason)`
 *    and overwrite that message's text in both threads.
 *  - incoming call → `phone:call_incoming` + interrupt 'phone_call' with Answer / Decline / Voicemail options.
 *    `phone:answer:<simId>` (and `phone:call:<simId>` / `phone:text:<simId>` / `phone:video:<simId>`) return
 *    `{ ok: true, data: { openConversation: true, targetId, channel } }` — the store must then call
 *    `engine.startConversation(actorId, [targetId], channel)` and open the chat view.
 *  - phone apps: social media (post / scroll), news, dating app, block / favorites, invite friends over (party)
 *  - `phone:notification` events from other systems are stored in the inbox.
 *
 * Exports: `sendText(ctx, from, to, text, opts?)`, `pushNotification(ctx, simId, app, title, body, actionId?)`.
 * Emits: phone:text_received, phone:call_incoming, phone:social_post, legal:crime_committed (noise_violation)
 * Consumes: phone:notification, scheduled:fired (party / _party_end / _party_noise), time:day (via tick)
 * Action prefix handled: `phone:`
 */
import { ensureRelationship } from '../core/effects';
import type { GameEvent } from '../core/events';
import { shortId } from '../core/ids';
import { simName } from '../core/query';
import type { ActionResult, System, SystemContext } from '../core/systems';
import type { ActionDef, Relationship, Requirement, Sim, SimId, TextMessage, VenueId } from '../core/types';
import { clamp, clamp100, DAY, HOUR } from '../core/util';
import { blocked, compatibility, hasTrait, isAdult, isCloseFamily, isPartnered, isSingle, pendingInterruptActions, pushMemory, romanticallyCompatible } from './relationships';

const first = (s: Sim) => s.identity.firstName;

// ---------------------------------------------------------------------------
// Exports used by the store and by this system
// ---------------------------------------------------------------------------
export function pushNotification(ctx: SystemContext, simId: SimId, app: string, title: string, body: string, actionId?: string): void {
  const sim = ctx.state.sims[simId];
  if (!sim) return;
  sim.phone.notifications.push({ id: shortId(ctx.rng, 'ntf'), at: ctx.state.time.minute, app, title, body, read: false, actionId });
  if (sim.phone.notifications.length > 60) sim.phone.notifications.splice(0, sim.phone.notifications.length - 60);
  if (ctx.query.isControlled(simId)) ctx.log({ text: `📱 ${title}: ${body}`, kind: 'phone', simId, importance: 1, meta: { app, actionId } });
}

export function sendText(ctx: SystemContext, from: SimId, to: SimId, text: string, opts: { reason?: string; needsLlm?: boolean } = {}): TextMessage | undefined {
  const a = ctx.state.sims[from];
  const b = ctx.state.sims[to];
  if (!a || !b) return undefined;
  if (b.relationships[from]?.flags.includes('blocked')) return undefined;
  const now = ctx.state.time.minute;
  const msg: TextMessage = { id: shortId(ctx.rng, 'msg'), from, to, at: now, text: text.slice(0, 500), read: false };
  (a.phone.threads[to] ||= []).push({ ...msg, read: true });
  (b.phone.threads[from] ||= []).push(msg);
  for (const s of [a, b]) {
    const key = s === a ? to : from;
    const t = s.phone.threads[key];
    if (t.length > 100) t.splice(0, t.length - 100);
  }
  if (!a.phone.contacts.includes(to)) a.phone.contacts.push(to);
  if (!b.phone.contacts.includes(from)) b.phone.contacts.push(from);
  const needsLlm = opts.needsLlm ?? (!ctx.query.isControlled(from) && text.startsWith('['));
  b.phone.notifications.push({ id: shortId(ctx.rng, 'ntf'), at: now, app: 'messages', title: simName(a), body: msg.text, read: false, actionId: `phone:text:${from}` });
  if (b.phone.notifications.length > 60) b.phone.notifications.splice(0, b.phone.notifications.length - 60);
  ctx.emit({ type: 'phone:text_received', simId: to, fromSimId: from, text: msg.text });
  if (ctx.query.isControlled(to)) ctx.log({ text: `📱 ${first(a)}: ${msg.text}`, kind: 'phone', simId: to, speakerId: from, importance: 1, meta: { needsLlm, reason: opts.reason, fromSimId: from, messageId: msg.id, actionId: `phone:text:${from}` } });
  return msg;
}

// ---------------------------------------------------------------------------
// NPC outreach
// ---------------------------------------------------------------------------
type RelKind = 'partner' | 'parent' | 'child' | 'sibling' | 'family' | 'best_friend' | 'good_friend' | 'friend' | 'acquaintance' | 'coworker' | 'ex';

function relKind(rel: Relationship): RelKind {
  const f = rel.flags;
  if (isPartnered(rel)) return 'partner';
  if (f.includes('parent')) return 'parent';
  if (f.includes('child')) return 'child';
  if (f.includes('sibling')) return 'sibling';
  if (isCloseFamily(rel) || f.includes('in_law')) return 'family';
  if (f.includes('ex') || f.includes('divorced')) return 'ex';
  if (f.includes('best_friend')) return 'best_friend';
  if (f.includes('good_friend')) return 'good_friend';
  if (f.includes('friend')) return 'friend';
  if (f.includes('coworker') || f.includes('boss') || f.includes('employee')) return 'coworker';
  return 'acquaintance';
}

const DAILY_RATE: Record<RelKind, number> = { partner: 1.0, parent: 1 / 7, child: 1 / 5, sibling: 1 / 5, family: 1 / 14, best_friend: 3 / 7, good_friend: 2 / 7, friend: 1.5 / 7, acquaintance: 0.3 / 7, coworker: 0.5 / 7, ex: 0.1 / 7 };

const REASONS: Record<RelKind, string[]> = {
  partner: ['checking in', 'asking what you want for dinner', 'sending a meme', 'saying they miss you', 'asking about your day', 'making weekend plans', 'about something funny that happened at work'],
  parent: ['checking in', 'asking when you will visit', 'forwarding an article', 'asking if you are eating well', 'about a family update'],
  child: ['checking in', 'sharing something from school', 'asking for a small favor'],
  sibling: ['sending a meme', 'about a family update', 'asking for advice', 'reminiscing about something'],
  family: ['about a family gathering', 'checking in', 'about a relative'],
  best_friend: ['about weekend plans', 'venting about work', 'sending a meme', 'about a show you both watch', 'asking to hang out', 'about some gossip'],
  good_friend: ['about weekend plans', 'sending a meme', 'asking to hang out', 'about a game last night'],
  friend: ['asking to grab coffee', 'about weekend plans', 'sharing a link'],
  acquaintance: ['saying it was nice meeting you', 'asking a quick question', 'inviting you to something'],
  coworker: ['about a shift swap', 'about something at work', 'asking a work question'],
  ex: ['saying they have been thinking about you', 'asking how you have been', 'about something they left at your place'],
};

const NPC_TEXT_TEMPLATES = ['hey, you around?', 'lol did you see this', 'we still on for this weekend?', 'call me when you get a sec', 'how did it go today?', 'miss you', 'thinking about you', 'ugh, work.', 'you free friday?', 'happy friday!!'];

function isAsleep(ctx: SystemContext, s: Sim): boolean {
  if (s.currentAction && /sleep/i.test(s.currentAction.actionId)) return true;
  const mod = ctx.clock.minuteOfDay;
  const wd = ctx.clock.weekday;
  const sleepBlock = s.schedule.find((b) => b.kind === 'sleep' && mod >= b.start && mod < b.end && (b.day === 'daily' || (b.day === 'weekday' && wd >= 1 && wd <= 5) || (b.day === 'weekend' && (wd === 0 || wd === 6)) || b.day === wd));
  if (sleepBlock) return true;
  return s.schedule.length === 0 && (mod >= 23 * HOUR || mod < 7 * HOUR);
}

function npcOutreach(ctx: SystemContext, ticksPerDay: number): void {
  const now = ctx.state.time.minute;
  const mod = ctx.clock.minuteOfDay;
  if (mod < 8 * HOUR || mod >= 22 * HOUR) return;
  for (const me of ctx.query.controlledSims()) {
    if (!me.phone.plan.active) continue;
    for (const id of me.phone.contacts) {
      const npc = ctx.state.sims[id];
      if (!npc || !npc.body.alive || ctx.query.isControlled(id)) continue;
      if (npc.location.venueId === me.location.venueId && !npc.travel) continue;
      if (me.relationships[id]?.flags.includes('blocked') || npc.relationships[me.id]?.flags.includes('blocked')) continue;
      if (me.flags[`ghosted:${id}`]) continue;
      const rel = npc.relationships[me.id];
      if (!rel) continue;
      const kind = relKind(rel);
      let daily = DAILY_RATE[kind] * (0.6 + npc.personality.extraversion * 0.8);
      if (hasTrait(npc, 'loner')) daily *= 0.5;
      if (rel.grudges.length) daily *= 0.3;
      if (rel.friendship < 0 && kind !== 'partner' && !isCloseFamily(rel)) daily *= 0.2;
      if (npc.householdId && npc.householdId === me.householdId) daily *= 0.3;
      const p = daily / (ticksPerDay * (14 / 24));
      if (!ctx.rng.chance(clamp(p, 0, 0.5))) continue;
      const wantsCall = ctx.rng.chance(kind === 'parent' ? 0.5 : kind === 'partner' ? 0.3 : 0.15);
      if (wantsCall && !isAsleep(ctx, npc)) {
        incomingCall(ctx, npc, me, ctx.rng.pick(REASONS[kind]));
      } else {
        const reason = ctx.rng.pick(REASONS[kind]);
        sendText(ctx, npc.id, me.id, `[${first(npc)} texts you ${reason}]`, { reason, needsLlm: true });
        rel.lastInteractedAt = now;
      }
    }
  }
}

function incomingCall(ctx: SystemContext, from: Sim, to: Sim, reason: string): void {
  const now = ctx.state.time.minute;
  const key = `phone:lastCall:${to.id}`;
  if (now - Number(ctx.state.flags[key] ?? -1e9) < 3 * HOUR) return;
  ctx.state.flags[key] = now;
  ctx.emit({ type: 'phone:call_incoming', simId: to.id, fromSimId: from.id, reason });
  if (isAsleep(ctx, to) || (to.currentAction && !to.currentAction.interruptible)) {
    to.phone.missedCalls.push({ from: from.id, at: now });
    pushNotification(ctx, to.id, 'phone', `Missed call: ${simName(from)}`, `Voicemail: ${reason}.`, `phone:call:${from.id}`);
    return;
  }
  ctx.log({ text: `📱 ${simName(from)} is calling.`, kind: 'phone', simId: to.id, speakerId: from.id, importance: 1, meta: { reason, fromSimId: from.id } });
  ctx.interrupt({ kind: 'phone_call', title: `${simName(from)} is calling`, body: `Your phone buzzes. ${first(from)} — probably ${reason}.`, simId: to.id, fromSimId: from.id, options: [{ label: 'Answer', actionId: `phone:answer:${from.id}`, params: { reason } }, { label: 'Decline', actionId: `phone:decline:${from.id}` }, { label: 'Let it go to voicemail', actionId: `phone:voicemail:${from.id}`, params: { reason } }] });
}

// ---------------------------------------------------------------------------
// Social media / dating
// ---------------------------------------------------------------------------
function platform(sim: Sim) {
  let p = sim.phone.socialMedia[0];
  if (!p) {
    p = { followers: 40, posts: 0, platform: 'Instagram' };
    sim.phone.socialMedia.push(p);
  }
  return p;
}

function datingCandidates(ctx: SystemContext, me: Sim): Sim[] {
  return ctx.query.aliveSims().filter((s) => s.id !== me.id && !ctx.query.isControlled(s.id) && isAdult(s) && isSingle(s) && s.householdId !== me.householdId && (me.relationships[s.id]?.familiarity ?? 0) < 5 && !me.phone.contacts.includes(s.id) && romanticallyCompatible(me, s) && !hasTrait(s, 'commitment_issues'));
}

// ---------------------------------------------------------------------------
// Parties
// ---------------------------------------------------------------------------
function throwParty(ctx: SystemContext, hostId: SimId, guestIds: SimId[]): void {
  const host = ctx.state.sims[hostId];
  const home = host && ctx.query.homeOf(hostId);
  if (!host || !home) return;
  const now = ctx.state.time.minute;
  if (host.location.venueId !== home.id) {
    ctx.log({ text: 'Your friends showed up for the party but you were not home.', kind: 'relationship', simId: hostId, importance: 2 });
    for (const id of guestIds) ctx.applyEffects(id, { relationships: [{ simId: hostId, friendship: -4, trust: -2 }] }, 'party:missed');
    return;
  }
  const came = guestIds.map((id) => ctx.state.sims[id]).filter((s): s is Sim => !!s && s.body.alive && !ctx.query.isControlled(s.id)).filter(() => ctx.rng.chance(0.7));
  for (const g of came) {
    g.travel = undefined;
    g.currentAction = undefined;
    g.location = { venueId: home.id, arrivedAt: now };
    ctx.emit({ type: 'sim:arrived', simId: g.id, venueId: home.id });
    ctx.applyEffects(g.id, { needs: { fun: 25, social: 30 }, relationships: [{ simId: hostId, friendship: 4, familiarity: 2, mutual: true }], moodlets: [{ emotion: 'happy', label: `Party at ${first(host)}'s`, intensity: 6, durationMinutes: DAY }] }, 'party');
    pushMemory(g, { text: `Went to a party at ${simName(host)}'s place.`, participants: [hostId], valence: 0.5, salience: 30, tags: ['party'] }, now, ctx.rng);
  }
  ctx.applyEffects(hostId, { needs: { fun: 30, social: 40 }, moodlets: [{ emotion: came.length ? 'happy' : 'sad', label: came.length ? 'Hosting a party' : 'Nobody came', intensity: came.length ? 10 : -8, durationMinutes: DAY }], venue: [{ venueId: home.id, noise: 25 + came.length * 5, cleanliness: -5 - came.length * 3 }], memories: [{ kind: 'event', text: came.length ? `Threw a party; ${came.map(first).join(', ')} came.` : 'Threw a party and nobody showed.', participants: came.map((c) => c.id), valence: came.length ? 0.6 : -0.5, salience: 40 }] }, 'party');
  ctx.log({ text: came.length ? `${came.map(first).join(', ')} arrive for your party.` : 'Nobody shows up to your party.', kind: 'event', simId: hostId, importance: 2 });
  host.flags.party_guests = came.map((c) => c.id).join(',');
  ctx.schedule({ inMinutes: 3 * HOUR, kind: '_party_end', label: 'party winds down', simId: hostId, venueId: home.id });
  const noiseAt = now - ctx.clock.minuteOfDay + 22 * HOUR + 30;
  if (noiseAt > now && noiseAt < now + 3 * HOUR) ctx.schedule({ atMinute: noiseAt, kind: '_party_noise', label: 'noise check', simId: hostId, venueId: home.id });
  else if (ctx.clock.minuteOfDay >= 22 * HOUR) ctx.schedule({ inMinutes: 45, kind: '_party_noise', label: 'noise check', simId: hostId, venueId: home.id });
}

function endParty(ctx: SystemContext, hostId: SimId): void {
  const host = ctx.state.sims[hostId];
  if (!host) return;
  const ids = String(host.flags.party_guests ?? '').split(',').filter(Boolean) as SimId[];
  delete host.flags.party_guests;
  const home = ctx.query.homeOf(hostId);
  for (const id of ids) {
    const g = ctx.state.sims[id];
    const gh = g && ctx.query.homeOf(id);
    if (g && gh) g.location = { venueId: gh.id, arrivedAt: ctx.state.time.minute };
  }
  if (home) home.noise = clamp100(home.noise - 30);
  if (ids.length) ctx.log({ text: 'The party winds down. Your place is a mess.', kind: 'narrative', simId: hostId, importance: 1 });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function actions(ctx: SystemContext, simId: SimId): ActionDef[] {
  const sim = ctx.state.sims[simId];
  if (!sim || !sim.body.alive || sim.lifeStage === 'infant' || sim.lifeStage === 'toddler') return [];
  const out: ActionDef[] = [];
  const service: Requirement[] = sim.phone.plan.active ? [] : [blocked('No phone service — plan inactive')];
  const def = (id: string, label: string, minutes: number, extra: Partial<ActionDef> = {}): ActionDef => ({ id, label, category: 'phone', durationMinutes: minutes, effects: {}, group: 'Phone', icon: 'phone', interruptible: true, autonomyWeight: 0, ...extra });
  const favs = sim.phone.contacts.filter((id) => sim.flags[`phone:fav:${id}`]);
  const ordered = [...favs, ...sim.phone.contacts.filter((id) => !favs.includes(id))];
  for (const id of ordered) {
    const c = ctx.state.sims[id];
    if (!c || !c.body.alive) continue;
    const rel = sim.relationships[id];
    const isBlocked = rel?.flags.includes('blocked');
    const name = simName(c);
    const g = { group: `Phone: ${favs.includes(id) ? '★ ' : ''}${name}`, target: { kind: 'sim' as const, id, name } };
    if (isBlocked) {
      out.push(def(`phone:block:${id}`, `Unblock ${first(c)}`, 1, g));
      continue;
    }
    const here = c.location.venueId === sim.location.venueId && !c.travel;
    const unread = (sim.phone.threads[id] ?? []).filter((m) => !m.read && m.to === simId).length;
    out.push(def(`phone:text:${id}`, unread ? `Text ${first(c)} (${unread} new)` : `Text ${first(c)}`, 0, { ...g, requirements: [...service, ...(here ? [blocked(`${first(c)} is right here`)] : [])], llm: 'converse', icon: 'message' }));
    const asleep = isAsleep(ctx, c);
    out.push(def(`phone:call:${id}`, asleep ? `Call ${first(c)} (probably asleep)` : `Call ${first(c)}`, 0, { ...g, requirements: [...service, ...(here ? [blocked(`${first(c)} is right here`)] : [])], llm: 'converse' }));
    if ((rel?.friendship ?? 0) >= 20 || isPartnered(rel) || isCloseFamily(rel)) out.push(def(`phone:video:${id}`, `Video call ${first(c)}`, 0, { ...g, requirements: [...service, ...(here ? [blocked(`${first(c)} is right here`)] : []), ...(asleep ? [blocked(`${first(c)} is asleep`)] : [])], llm: 'converse' }));
    if (sim.flags[`dating_match:${id}`] && !isPartnered(rel)) {
      const venue = ctx.query.nearestVenue(sim.location.venueId, 'restaurant') ?? ctx.query.nearestVenue(sim.location.venueId, 'cafe');
      out.push(def(`phone:date:${id}`, `Ask ${first(c)} on a date${venue ? ` (${venue.name})` : ''}`, 5, { ...g, category: 'romance', params: { venueId: venue?.id } }));
    }
    out.push(def(`phone:favorite:${id}`, favs.includes(id) ? `Remove ${first(c)} from favorites` : `Add ${first(c)} to favorites`, 1, g));
    if (!isCloseFamily(rel)) out.push(def(`phone:block:${id}`, `Block ${first(c)}`, 1, g));
  }
  const p = platform(sim);
  out.push(def('phone:social:post', `Post on ${p.platform} (${p.followers} followers)`, 10, { group: 'Phone: apps', effects: { needs: { fun: 6 } }, icon: 'camera' }));
  out.push(def('phone:social:scroll', `Scroll ${p.platform}`, 15, { group: 'Phone: apps', autonomyWeight: 0.35, satisfies: ['fun'], effects: { needs: { fun: 10 } } }));
  out.push(def('phone:news:read', 'Check the news', 10, { group: 'Phone: apps', effects: { needs: { fun: 3 } } }));
  if (isAdult(sim) && isSingle(sim)) out.push(def('phone:dating:browse', 'Browse the dating app', 15, { group: 'Phone: apps', category: 'romance', icon: 'heart' }));
  const hh = ctx.query.householdOf(simId);
  const friends = Object.values(sim.relationships).filter((r) => r.friendship >= 20 && sim.phone.contacts.includes(r.simId) && !ctx.query.isControlled(r.simId));
  if (hh && friends.length && !sim.flags.party_planned) out.push(def('phone:party:invite', `Invite friends over (${friends.length} friends)`, 10, { group: 'Phone: apps', category: 'social', requirements: [...service, { kind: 'money', reason: 'Snacks & drinks cost $40', params: { amount: 40 } }], cost: { amount: 40, memo: 'Party snacks & drinks', category: 'entertainment' } }));
  if (sim.phone.notifications.some((n) => !n.read)) out.push(def('phone:notifications:clear', `Clear ${sim.phone.notifications.filter((n) => !n.read).length} notifications`, 1, { group: 'Phone: apps' }));
  out.push(...pendingInterruptActions(ctx, 'phone:'));
  return out;
}

function execute(ctx: SystemContext, simId: SimId, action: ActionDef, params: Record<string, unknown>): ActionResult {
  const sim = ctx.state.sims[simId];
  if (!sim) return { ok: false };
  const now = ctx.state.time.minute;
  const parts = action.id.split(':');
  const app = parts[1];
  const arg = parts[2];
  const target = arg?.startsWith('sim_') ? ctx.state.sims[arg as SimId] : undefined;
  const openConv = (channel: 'phone' | 'text' | 'video') => ({ ok: true, text: channel === 'text' ? `You open your thread with ${first(target!)}.` : `You call ${first(target!)}.`, data: { openConversation: true, targetId: target!.id, channel } });
  switch (app) {
    case 'text': {
      if (!target) return { ok: false };
      for (const m of sim.phone.threads[target.id] ?? []) m.read = true;
      for (const n of sim.phone.notifications) if (n.actionId === action.id) n.read = true;
      return openConv('text');
    }
    case 'call':
    case 'video': {
      if (!target) return { ok: false };
      if (target.relationships[simId]?.flags.includes('blocked')) return { ok: true, text: `Straight to voicemail. ${first(target)} may have blocked you.`, effects: { moodlets: [{ emotion: 'sad', label: 'Blocked?', intensity: -3, durationMinutes: 120 }] } };
      if (isAsleep(ctx, target) || (target.currentAction && /work|school/.test(target.currentAction.actionId) && ctx.rng.chance(0.6))) {
        target.phone.missedCalls.push({ from: simId, at: now });
        return { ok: true, text: `No answer. You leave ${first(target)} a voicemail.`, durationMinutes: 2, effects: { moodlets: [{ emotion: 'lonely', label: `${first(target)} didn't pick up`, intensity: -2, durationMinutes: 60 }], relationships: [{ simId: target.id, familiarity: 0.5 }] } };
      }
      ensureRelationship(target, simId, now).lastInteractedAt = now;
      return openConv(app === 'video' ? 'video' : 'phone');
    }
    case 'answer': {
      if (!target) return { ok: false };
      ensureRelationship(target, simId, now).lastInteractedAt = now;
      return { ok: true, text: `You pick up.`, data: { openConversation: true, targetId: target.id, channel: 'phone', reason: params.reason } };
    }
    case 'decline': {
      if (!target) return { ok: false };
      sim.phone.missedCalls.push({ from: target.id, at: now });
      ctx.applyEffects(target.id, { relationships: [{ simId, friendship: -1 }] }, 'phone:declined');
      return { ok: true, text: `You decline the call.` };
    }
    case 'voicemail': {
      if (!target) return { ok: false };
      sim.phone.missedCalls.push({ from: target.id, at: now });
      pushNotification(ctx, simId, 'phone', `Voicemail from ${simName(target)}`, `${first(target)} called ${params.reason ?? 'to talk'}.`, `phone:call:${target.id}`);
      return { ok: true, text: 'It rings out.' };
    }
    case 'block': {
      if (!target) return { ok: false };
      const rel = ensureRelationship(sim, target.id, now);
      if (rel.flags.includes('blocked')) {
        rel.flags = rel.flags.filter((f) => f !== 'blocked');
        return { ok: true, text: `You unblock ${first(target)}.` };
      }
      rel.flags.push('blocked');
      sim.flags[`phone:fav:${target.id}`] = false;
      ensureRelationship(target, simId, now).grudges.push({ text: `${first(sim)} blocked me`, at: now, weight: 1.5 });
      return { ok: true, text: `You block ${first(target)}.` };
    }
    case 'favorite': {
      if (!target) return { ok: false };
      const on = !sim.flags[`phone:fav:${target.id}`];
      sim.flags[`phone:fav:${target.id}`] = on;
      return { ok: true, text: on ? `${first(target)} added to favorites.` : `${first(target)} removed from favorites.` };
    }
    case 'date': {
      if (!target) return { ok: false };
      const rel = target.relationships[simId];
      const p = 0.5 + (rel?.attraction ?? 0) / 200 + (compatibility(sim, target) - 0.5) * 0.4;
      if (!ctx.rng.chance(clamp(p, 0.1, 0.9))) return { ok: true, text: `${first(target)} says maybe another time.`, effects: { moodlets: [{ emotion: 'sad', label: 'Turned down', intensity: -3, durationMinutes: 120 }] } };
      const venueId = (params.venueId as VenueId | undefined) ?? ctx.query.nearestVenue(sim.location.venueId, 'restaurant')?.id;
      const daysAhead = ctx.clock.minuteOfDay < 15 * HOUR ? 1 : 2;
      const at = now - ctx.clock.minuteOfDay + daysAhead * DAY + 19 * HOUR;
      ctx.schedule({ atMinute: at, kind: 'reminder', label: `Date with ${first(target)}${venueId ? ` at ${ctx.query.venueMaybe(venueId)?.name}` : ''}`, simId, venueId, payload: { source: 'relationships', kind: 'date', simId, otherId: target.id, venueId } });
      delete sim.flags[`dating_match:${target.id}`];
      return { ok: true, text: `${first(target)} says yes. ${daysAhead === 1 ? 'Tomorrow' : 'Day after tomorrow'} at 7.`, effects: { moodlets: [{ emotion: 'hopeful', label: 'Got a date', intensity: 6, durationMinutes: DAY }], relationships: [{ simId: target.id, romance: 4, mutual: true }] } };
    }
    case 'social': {
      const p = platform(sim);
      if (arg === 'post') {
        const skill = (sim.skills.charisma?.level ?? 0) + (sim.skills.creativity?.level ?? 0) * 0.7 + (sim.skills.photography?.level ?? 0) * 0.8;
        const likes = Math.round(p.followers * (0.04 + skill * 0.012) * ctx.rng.range(0.4, 1.6) + ctx.rng.int(0, 8));
        const viral = ctx.rng.chance(0.01 + skill * 0.002);
        const gained = viral ? ctx.rng.int(200, 2000) : Math.round(likes * ctx.rng.range(0.05, 0.2));
        p.followers += gained;
        p.posts += 1;
        p.lastPostAt = now;
        const text = ctx.rng.pick(['a photo from today', 'a selfie', 'a food pic', 'a hot take', 'a throwback', 'a workout update', 'a pet photo']);
        ctx.emit({ type: 'phone:social_post', simId, text, likes });
        const vain = hasTrait(sim, 'vain');
        return { ok: true, text: viral ? `Your post blows up: ${likes} likes, +${gained} followers.` : `${likes} likes${gained ? `, +${gained} followers` : ''}.`, outcomeLabel: viral ? 'viral' : undefined, effects: { needs: { fun: viral ? 20 : 6, social: 4 }, skills: { photography: 4 }, moodlets: viral ? [{ emotion: 'proud', label: 'Went viral', intensity: 12, durationMinutes: DAY * 2 }] : likes < 3 && vain ? [{ emotion: 'embarrassed', label: 'Post flopped', intensity: -6, durationMinutes: 240 }] : vain ? [{ emotion: 'confident', label: 'Likes rolling in', intensity: 5, durationMinutes: 240 }] : [] } };
      }
      // scroll
      const late = ctx.clock.minuteOfDay >= 23 * HOUR || ctx.clock.minuteOfDay < 5 * HOUR;
      const neurotic = sim.personality.neuroticism;
      if (late) sim.body.sleepDebtHours += 0.25;
      return { ok: true, text: late ? 'You scroll longer than you meant to.' : 'You scroll for a bit.', effects: { needs: { fun: 10, social: 2, energy: late ? -3 : 0 }, stress: neurotic > 0.6 ? 4 : -3, moodlets: neurotic > 0.75 && ctx.rng.chance(0.3) ? [{ emotion: 'jealous', label: 'Everyone seems happier online', intensity: -4, durationMinutes: 180 }] : [] } };
    }
    case 'news':
      return { ok: true, text: ctx.rng.pick(['Nothing good.', 'Rates are up again.', 'Local team lost.', 'Weather looks rough this week.', 'Some politician said something.']), effects: { needs: { fun: 3 }, stress: sim.personality.neuroticism > 0.6 ? 3 : 0, skills: { research: 2 } } };
    case 'dating': {
      if (!sim.phone.apps.includes('dating')) sim.phone.apps.push('dating');
      const cands = datingCandidates(ctx, sim);
      if (!cands.length) return { ok: true, text: 'You swipe for a while. Nothing clicks.', effects: { needs: { fun: 4 } } };
      const scored = cands.map((c) => ({ c, s: compatibility(sim, c) + ctx.rng.range(-0.15, 0.15) })).sort((a, b) => b.s - a.s);
      const pick = scored[0].c;
      const compat = compatibility(sim, pick);
      if (!ctx.rng.chance(0.35 + compat * 0.45)) return { ok: true, text: 'A few likes, no matches tonight.', effects: { needs: { fun: 5 }, moodlets: sim.personality.neuroticism > 0.6 ? [{ emotion: 'lonely', label: 'No matches', intensity: -3, durationMinutes: 180 }] : [] } };
      if (!sim.phone.contacts.includes(pick.id)) sim.phone.contacts.push(pick.id);
      if (!pick.phone.contacts.includes(simId)) pick.phone.contacts.push(simId);
      const a = ensureRelationship(sim, pick.id, now);
      const b = ensureRelationship(pick, simId, now);
      a.familiarity = Math.max(a.familiarity, 5);
      b.familiarity = Math.max(b.familiarity, 5);
      a.attraction = Math.max(a.attraction, Math.round(30 + compat * 50));
      b.attraction = Math.max(b.attraction, Math.round(25 + compat * 50));
      a.romance = Math.max(a.romance, 5);
      b.romance = Math.max(b.romance, 5);
      sim.flags[`dating_match:${pick.id}`] = now;
      ctx.emit({ type: 'sim:met', simId, otherId: pick.id, venueId: sim.location.venueId });
      ctx.log({ text: `You matched with ${simName(pick)} (${ctx.query.ageOf(pick)}, ${pick.role?.title ?? pick.role?.role ?? pick.career.job?.title ?? 'no job listed'}).`, kind: 'relationship', simId, importance: 2 });
      sendText(ctx, pick.id, simId, `[${first(pick)} texts you after matching on the dating app]`, { reason: 'just matched on the dating app', needsLlm: true });
      return { ok: true, text: `It's a match: ${simName(pick)}.`, effects: { needs: { fun: 10 }, moodlets: [{ emotion: 'flirty', label: `Matched with ${first(pick)}`, intensity: 6, durationMinutes: DAY }], memories: [{ kind: 'event', text: `Matched with ${simName(pick)} on the dating app.`, participants: [pick.id], valence: 0.5, salience: 35 }] }, data: { matchId: pick.id } };
    }
    case 'party': {
      const home = ctx.query.homeOf(simId);
      if (!home) return { ok: false, text: 'You need a place first.' };
      const friends = Object.values(sim.relationships).filter((r) => r.friendship >= 20 && sim.phone.contacts.includes(r.simId)).map((r) => r.simId).slice(0, 8);
      const mod = ctx.clock.minuteOfDay;
      const at = mod < 17 * HOUR ? now - mod + 19 * HOUR : now - mod + DAY + 19 * HOUR;
      ctx.schedule({ atMinute: at, kind: 'party', label: 'Friends over', simId, venueId: home.id, payload: { source: 'communication', hostId: simId, guests: friends } });
      sim.flags.party_planned = at;
      for (const id of friends) sendText(ctx, simId, id, `Party at my place ${mod < 17 * HOUR ? 'tonight' : 'tomorrow'} at 7. Come through!`, { needsLlm: false });
      return { ok: true, text: `Invites sent to ${friends.length} people for ${mod < 17 * HOUR ? 'tonight' : 'tomorrow'} at 7.` };
    }
    case 'notifications':
      for (const n of sim.phone.notifications) n.read = true;
      return { ok: true, text: 'Inbox cleared.' };
    default:
      return { ok: false, text: 'Unknown phone action.' };
  }
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------
export const communicationSystem: System = {
  id: 'communication',
  intervalMinutes: 15,
  onTick(ctx, dt) {
    const ticksPerDay = DAY / Math.max(15, dt);
    npcOutreach(ctx, ticksPerDay);
    const day = Math.floor(ctx.state.time.minute / DAY);
    if (Number(ctx.state.flags['comm:lastDay'] ?? -1) !== day) {
      ctx.state.flags['comm:lastDay'] = day;
      for (const s of ctx.query.simulatedSims()) {
        for (const p of s.phone.socialMedia) {
          const drift = 1 + ctx.rng.normal(0.001, 0.006) - (p.lastPostAt && ctx.state.time.minute - p.lastPostAt > 30 * DAY ? 0.004 : 0);
          p.followers = Math.max(0, Math.round(p.followers * drift));
        }
        if (s.phone.missedCalls.length > 30) s.phone.missedCalls.splice(0, s.phone.missedCalls.length - 30);
        if (s.flags.party_planned && Number(s.flags.party_planned) < ctx.state.time.minute) delete s.flags.party_planned;
      }
    }
  },
  onEvent(ctx, e: GameEvent) {
    switch (e.type) {
      case 'phone:notification':
        pushNotification(ctx, e.simId, e.app, e.title, e.body);
        break;
      case 'scheduled:fired': {
        const ev = e.event;
        if (ev.kind === 'party' && ev.payload?.source === 'communication') {
          const host = ctx.state.sims[ev.payload.hostId as SimId];
          if (host) delete host.flags.party_planned;
          throwParty(ctx, ev.payload.hostId as SimId, (ev.payload.guests as SimId[]) ?? []);
        } else if (ev.kind === '_party_end' && ev.simId) endParty(ctx, ev.simId);
        else if (ev.kind === '_party_noise' && ev.simId && ev.venueId) {
          const host = ctx.state.sims[ev.simId];
          const venue = ctx.query.venueMaybe(ev.venueId);
          if (host?.flags.party_guests && venue && ctx.rng.chance(clamp(venue.noise / 100, 0.15, 0.7))) {
            ctx.log({ text: 'A neighbor called in a noise complaint.', kind: 'alert', simId: ev.simId, importance: 2 });
            ctx.emit({ type: 'legal:crime_committed', simId: ev.simId, crimeId: 'noise_violation', venueId: ev.venueId, witnessed: true });
          }
        }
        break;
      }
      default:
        break;
    }
  },
  actions,
  handles: (id) => id.startsWith('phone:'),
  execute,
};
