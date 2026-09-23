/**
 * Social fabric: the visible lives of the people you know, and how places and circles regard you.
 *
 *  - Feed: a few posts a day from people you know (their shifts, hobbies, the weather, the news),
 *    plus replies when you post. Shown in the phone's Social app. Only known people, capped.
 *  - Gossip: a strong memory an NPC formed about you travels to one of their friends, who now
 *    thinks a little differently of you. You hear about it only when it reaches someone you know.
 *  - Milestones: slow-arc moments with a person, recognised rather than scored: met, first real
 *    talk, first text, hung out, came over, met their friends, dating, exclusive, married.
 *  - Standing: each place keeps a short opinion of you (regular, tips well, caused a scene) that
 *    staff act on, and a ban when you cross a line.
 *
 * Events consumed: time:day, time:hour, sim:met, conversation:ended, transport:arrived, sim:arrived,
 *                  money:transaction, legal:crime_committed, phone:social_post, relationship:changed
 */
import type { FeedPost, Relationship, Sim, SimId, Venue, VenueStanding, WorldState } from '../core/types';
import type { System, SystemContext } from '../core/systems';
import { shortId } from '../core/ids';
import { clamp, DAY, HOUR } from '../core/util';

// ---------------------------------------------------------------------------
// Venue standing
// ---------------------------------------------------------------------------
export function standingOf(venue: Venue, simId: SimId): VenueStanding | undefined {
  return venue.standing?.[simId];
}

function bump(ctx: SystemContext, venue: Venue, sim: Sim, delta: number, note?: string): VenueStanding {
  venue.standing ||= {};
  const st = (venue.standing[sim.id] ||= { score: 0, visits: 0, lastVisitAt: ctx.state.time.minute, notes: [] });
  st.score = clamp(st.score + delta, -100, 100);
  if (note && !st.notes.includes(note)) {
    st.notes.push(note);
    if (st.notes.length > 4) st.notes.shift();
  }
  return st;
}

/** One line a bartender might think when you walk in; undefined when you're nobody yet. */
export function standingLabel(venue: Venue, simId: SimId, now: number): string | undefined {
  const st = standingOf(venue, simId);
  if (!st) return undefined;
  if (st.bannedUntil && st.bannedUntil > now) return `banned (${Math.ceil((st.bannedUntil - now) / DAY)} more days)`;
  const parts: string[] = [];
  if (st.visits >= 12) parts.push('a regular');
  else if (st.visits >= 5) parts.push('a familiar face');
  for (const n of st.notes) parts.push(n);
  if (st.score <= -20 && !parts.some((p) => /scene|trouble/.test(p))) parts.push('not welcome');
  if (!parts.length) return undefined;
  return parts.join(', ');
}

export function isBanned(venue: Venue, simId: SimId, now: number): boolean {
  const st = standingOf(venue, simId);
  return !!st?.bannedUntil && st.bannedUntil > now;
}

function noteVisit(ctx: SystemContext, sim: Sim, venueId: string): void {
  const venue = ctx.state.venues[venueId as never];
  if (!venue || !ctx.query.isControlled(sim.id)) return;
  if (venue.archetype === 'home' || venue.archetype === 'apartment_building' || venue.archetype === 'transit_stop' || venue.archetype === 'park') return;
  venue.standing ||= {};
  const st = (venue.standing[sim.id] ||= { score: 0, visits: 0, lastVisitAt: -1e9, notes: [] });
  const now = ctx.state.time.minute;
  if (now - st.lastVisitAt >= 6 * HOUR) {
    st.visits += 1;
    st.score = clamp(st.score + 1, -100, 100);
    if (st.visits === 12) ctx.log({ text: `${venue.name}: they know your order now.`, kind: 'event', simId: sim.id, venueId: venue.id, importance: 2 });
  }
  st.lastVisitAt = now;
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------
const MILESTONE_TEXT: Record<string, (other: string) => string> = {
  met: (o) => `You met ${o}.`,
  first_real_talk: (o) => `You and ${o} talked. Actually talked.`,
  first_text: (o) => `First text from ${o}. You have their number now, and they have yours.`,
  hung_out: (o) => `You and ${o} spent an afternoon together, no reason needed.`,
  came_over: (o) => `${o} came over. Your place is somewhere they've been now.`,
  met_their_friends: (o) => `You met ${o}'s people. That's a different kind of knowing someone.`,
  dating: (o) => `You and ${o} are seeing each other.`,
  exclusive: (o) => `You and ${o}: just each other, then.`,
  married: (o) => `You married ${o}.`,
};

export function milestone(ctx: SystemContext, sim: Sim, otherId: SimId, id: string): void {
  const rel = sim.relationships[otherId];
  const other = ctx.state.sims[otherId];
  if (!rel || !other) return;
  rel.milestones ||= [];
  if (rel.milestones.some((m) => m.id === id)) return;
  rel.milestones.push({ id, at: ctx.state.time.minute });
  const mirror = other.relationships[sim.id];
  if (mirror) {
    mirror.milestones ||= [];
    if (!mirror.milestones.some((m) => m.id === id)) mirror.milestones.push({ id, at: ctx.state.time.minute });
  }
  if (ctx.query.isControlled(sim.id) && MILESTONE_TEXT[id]) ctx.log({ text: MILESTONE_TEXT[id](other.identity.firstName), kind: 'relationship', simId: sim.id, importance: 2, meta: { milestone: id, otherId } });
}

const together = new Map<string, { since: number; venueId: string }>();

function scanMilestones(ctx: SystemContext): void {
  const now = ctx.state.time.minute;
  for (const sim of ctx.query.controlledSims()) {
    if (!sim.body.alive) continue;
    const home = ctx.query.homeOf(sim.id);
    const work = sim.career.job?.employerVenueId;
    const here = sim.location.venueId;
    const present = new Set(ctx.query.simsAt(here).map((s) => s.id));
    for (const rel of Object.values(sim.relationships)) {
      const other = ctx.state.sims[rel.simId];
      if (!other?.body.alive) continue;
      const key = `${sim.id}|${rel.simId}`;
      // co-presence timer (not at work, both present)
      if (present.has(rel.simId) && !sim.travel && here !== work && rel.familiarity >= 10) {
        const t = together.get(key);
        if (!t || t.venueId !== here) together.set(key, { since: now, venueId: here });
        else if (now - t.since >= 90 && here !== home?.id) milestone(ctx, sim, rel.simId, 'hung_out');
        if (home && here === home.id && now - (together.get(key)?.since ?? now) >= 30 && other.householdId !== sim.householdId) milestone(ctx, sim, rel.simId, 'came_over');
      } else together.delete(key);
      // flags → arcs
      if (rel.flags.includes('dating')) milestone(ctx, sim, rel.simId, 'dating');
      if (rel.flags.includes('partner')) milestone(ctx, sim, rel.simId, 'exclusive');
      if (rel.flags.includes('married')) milestone(ctx, sim, rel.simId, 'married');
      // texts
      const thread = sim.phone.threads[rel.simId];
      if (thread?.some((m) => m.from === rel.simId)) milestone(ctx, sim, rel.simId, 'first_text');
    }
  }
}

// ---------------------------------------------------------------------------
// Gossip
// ---------------------------------------------------------------------------
function spreadGossip(ctx: SystemContext): void {
  const state = ctx.state;
  const now = state.time.minute;
  let spread = 0;
  for (const you of ctx.query.controlledSims()) {
    for (const npc of Object.values(state.sims)) {
      if (spread >= 2) return;
      if (npc.id === you.id || !npc.body.alive || npc.lod === 'far') continue;
      const fresh = npc.memory.filter((m) => m.participants.includes(you.id) && now - m.at < DAY && m.salience >= 55 && !m.tags.includes('gossiped'));
      if (!fresh.length) continue;
      const m = fresh[0];
      m.tags.push('gossiped');
      if (!ctx.rng.chance(0.4)) continue;
      const friends = Object.values(npc.relationships).filter((r) => r.simId !== you.id && r.friendship >= 30 && r.familiarity >= 20 && state.sims[r.simId]?.body.alive);
      if (!friends.length) continue;
      const to = state.sims[ctx.rng.pick(friends).simId];
      const heard = `${npc.identity.firstName} told me about ${you.identity.firstName}: ${m.text.replace(/^(She|He|They) /, '').slice(0, 200)}`;
      to.memory.push({ id: shortId(ctx.rng, 'mem'), kind: 'conversation', at: now, text: heard, participants: [you.id, npc.id], venueId: to.location.venueId, salience: 45, valence: m.valence, tags: ['gossip'] });
      const delta = Math.round(m.valence * 4);
      if (delta) ctx.applyEffects(to.id, { relationships: [{ simId: you.id, friendship: delta, trust: Math.round(delta / 2), familiarity: 1 }] }, 'social:gossip');
      spread++;
      if (you.relationships[to.id]?.familiarity) ctx.log({ text: `Word travels: ${to.identity.firstName} heard about you from ${npc.identity.firstName}. ${m.valence > 0.2 ? 'Good things, it sounds like.' : m.valence < -0.2 ? 'Not flattering.' : 'Hard to say what.'}`, kind: 'relationship', simId: you.id, importance: 1, meta: { gossip: true } });
    }
  }
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------
function knownPeople(ctx: SystemContext, you: Sim): Sim[] {
  return Object.values(you.relationships)
    .filter((r) => r.familiarity >= 10 || you.phone.contacts.includes(r.simId))
    .map((r) => ctx.state.sims[r.simId])
    .filter((s): s is Sim => !!s && s.body.alive && s.lifeStage !== 'infant' && s.lifeStage !== 'toddler' && s.lifeStage !== 'child');
}

function postFor(ctx: SystemContext, s: Sim, at: number): { text: string; kind: FeedPost['kind']; venueId?: string } | undefined {
  const rng = ctx.rng;
  const w = ctx.state.weather.current;
  const job = s.career.job;
  const hobby = s.hobbies?.[0];
  const hobbyName = hobby ? (ctx.content.hobbies[hobby]?.name ?? hobby).toLowerCase() : undefined;
  const news = (ctx.state.news ?? []).find((n) => n.startedAt <= at && n.endsAt > at);
  const options: (() => { text: string; kind: FeedPost['kind']; venueId?: string })[] = [];
  if (job) {
    options.push(() => ({ text: rng.pick([`Double at ${job.employerName} today. Send coffee.`, `${job.employerName} at 6am is a different planet.`, `Somebody tipped in coins today. All coins. I'm choosing to find it charming.`, `Closing shift, then the walk home. Not mad about it.`, `Three years at ${job.employerName} this week. Huh.`]), kind: 'work', venueId: job.employerVenueId }));
  }
  if (hobbyName) options.push(() => ({ text: rng.pick([`Finally back to ${hobbyName}. Body says no, brain says yes.`, `${hobbyName} weekend. Do not text me unless it's about ${hobbyName}.`, `Small win at ${hobbyName} today. Nobody saw. I'm telling you.`]), kind: 'hobby' }));
  if (w.tempF > 88) options.push(() => ({ text: rng.pick(['It is too hot to be a person.', 'Whoever invented the afternoon should be arrested.', 'Popsicle for dinner. I am an adult.']), kind: 'life' }));
  else if (w.condition === 'rain' || w.condition === 'heavy_rain') options.push(() => ({ text: rng.pick(['Rain day. Soup day. Cancel everything.', 'Forgot the umbrella. Soaked. Thriving, somehow.']), kind: 'life' }));
  else options.push(() => ({ text: rng.pick(['Sunday plan: none. Executing flawlessly.', 'Coffee, walk, coffee. The good loop.', 'Grocery store had the good tortillas. That is the whole post.', 'Talked to my neighbor for 40 minutes about a fence. Loved it.', 'New place on the corner is okay. Not great. Okay.', `Good day in ${ctx.state.region.name}. Nothing happened. Perfect.`]), kind: 'life' }));
  if (news) options.push(() => ({ text: rng.pick([`So, the ${news.headline.toLowerCase()} thing. Great. Love that for us.`, `${news.headline}. Anyway.`, `Everyone's talking about the ${news.kind.replace(/_/g, ' ')}. Can we not.`]), kind: 'news' }));
  if (s.mind.mood < -30) options.push(() => ({ text: rng.pick(['Rough week. Don\'t ask, but also, ask.', 'Some days you just get through.', 'Logging off for a bit.']), kind: 'life' }));
  if (s.mind.mood > 35) options.push(() => ({ text: rng.pick(['Good news I can\'t share yet!!', 'Best day in a while. That\'s it, that\'s the post.', 'Feeling like myself again.']), kind: 'life' }));
  if (!options.length) return undefined;
  return rng.pick(options)();
}

function dailyFeed(ctx: SystemContext): void {
  const state = ctx.state;
  state.feed ||= [];
  const dayStart = state.time.minute - (state.time.minute % DAY);
  const you = ctx.query.activeSim();
  const people = knownPeople(ctx, you);
  if (!people.length) return;
  const n = Math.min(people.length, ctx.rng.int(3, 6));
  const posters = ctx.rng.shuffle(people).slice(0, n);
  for (const s of posters) {
    if (s.personality.humor < 0.15 && ctx.rng.chance(0.5)) continue; // some people never post
    const at = dayStart + ctx.rng.int(7 * 60, 22 * 60);
    const p = postFor(ctx, s, at);
    if (!p) continue;
    state.feed.push({ id: shortId(ctx.rng, 'post'), simId: s.id, at, text: p.text, likes: ctx.rng.int(2, 40), venueId: p.venueId as never, kind: p.kind });
  }
  if (state.feed.length > 80) state.feed.splice(0, state.feed.length - 80);
}

function repliesToPlayerPost(ctx: SystemContext, you: Sim, text: string): void {
  const state = ctx.state;
  state.feed ||= [];
  const now = state.time.minute;
  const mine: FeedPost = { id: shortId(ctx.rng, 'post'), simId: you.id, at: now, text, likes: 0, kind: 'life' };
  state.feed.push(mine);
  const friends = knownPeople(ctx, you).filter((s) => (you.relationships[s.id]?.friendship ?? 0) > 15);
  const repliers = ctx.rng.shuffle(friends).slice(0, Math.min(3, friends.length));
  let i = 1;
  for (const s of repliers) {
    const line = ctx.rng.pick(['lol', 'this is so you', 'ok but where', 'come through!!', 'proud of u', 'no way', '😂😂', 'when are we hanging out', 'need details', 'mood']);
    state.feed.push({ id: shortId(ctx.rng, 'post'), simId: s.id, at: now + ctx.rng.int(5, 90) * i, text: line, likes: ctx.rng.int(0, 6), kind: 'reply', replyTo: mine.id });
    mine.likes += ctx.rng.int(1, 6);
    i++;
  }
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------
export const socialSystem: System = {
  id: 'social',
  intervalMinutes: 30,
  onInit(ctx) {
    ctx.state.feed ||= [];
  },
  onTick(ctx) {
    scanMilestones(ctx);
  },
  onEvent(ctx, e) {
    const state = ctx.state;
    switch (e.type) {
      case 'time:day':
        dailyFeed(ctx);
        spreadGossip(ctx);
        return;
      case 'sim:met': {
        const sim = ctx.query.simMaybe(e.simId);
        if (sim && ctx.query.isControlled(sim.id)) {
          milestone(ctx, sim, e.otherId, 'met');
          // meeting someone who is a friend of someone you know
          for (const rel of Object.values(sim.relationships)) {
            if (rel.simId === e.otherId || rel.familiarity < 20) continue;
            const theirs = state.sims[rel.simId]?.relationships[e.otherId];
            if (theirs && theirs.friendship >= 30) milestone(ctx, sim, rel.simId, 'met_their_friends');
          }
        }
        return;
      }
      case 'conversation:ended': {
        const c = state.conversations[e.conversationId as never];
        if (!c) return;
        const npcTurns = c.turns.filter((t) => t.speakerId !== 'narrator');
        if (npcTurns.length < 4) return;
        for (const id of c.participantIds) {
          const sim = state.sims[id];
          if (!sim || !ctx.query.isControlled(id)) continue;
          for (const other of c.participantIds) if (other !== id) milestone(ctx, sim, other, 'first_real_talk');
        }
        return;
      }
      case 'sim:arrived':
      case 'transport:arrived': {
        const sim = ctx.query.simMaybe(e.simId);
        if (sim) noteVisit(ctx, sim, e.venueId);
        return;
      }
      case 'money:transaction': {
        if (e.amount >= 0 || !/\btip\b/i.test(e.memo)) return;
        const sim = ctx.query.simMaybe(e.simId);
        const venue = sim ? state.venues[sim.location.venueId] : undefined;
        if (sim && venue && ctx.query.isControlled(sim.id)) bump(ctx, venue, sim, 3, 'tips well');
        return;
      }
      case 'legal:crime_committed': {
        const sim = ctx.query.simMaybe(e.simId);
        const venue = e.venueId ? state.venues[e.venueId] : undefined;
        if (!sim || !venue || !ctx.query.isControlled(sim.id) || !e.witnessed) return;
        const prior = standingOf(venue, sim.id)?.score ?? 0;
        const st = bump(ctx, venue, sim, -30, 'caused trouble');
        if (venue.archetype !== 'home') {
          // getting caught bars you whoever you are; a valued regular gets a shorter one
          const days = prior >= 20 ? 14 : 30;
          st.bannedUntil = state.time.minute + days * DAY;
          ctx.log({ text: `${venue.name} tells you not to come back.${days === 14 ? ' Two weeks, and only because they know you.' : ' Thirty days, at least.'}`, kind: 'alert', simId: sim.id, venueId: venue.id, importance: 3 });
        }
        return;
      }
      case 'phone:social_post': {
        const sim = ctx.query.simMaybe(e.simId);
        if (sim && ctx.query.isControlled(sim.id)) repliesToPlayerPost(ctx, sim, e.text);
        return;
      }
      case 'custom': {
        // staff opinion from conversations: the engine files NPC memories; a staff member's strong feeling moves standing
        if (e.kind !== 'social:staff_opinion') return;
        return;
      }
      default:
        return;
    }
  },
};

/** Staff at a venue forming an opinion of a controlled sim after a conversation (called by the engine). */
export function staffOpinion(state: WorldState, venue: Venue, staffId: SimId, you: Sim, valence: number, now: number): void {
  if (!venue.staffSimIds.includes(staffId) || Math.abs(valence) < 0.45) return;
  venue.standing ||= {};
  const st = (venue.standing[you.id] ||= { score: 0, visits: 0, lastVisitAt: now, notes: [] });
  st.score = clamp(st.score + Math.round(valence * 8), -100, 100);
  const note = valence > 0 ? 'friendly with the staff' : 'was rude to staff';
  if (!st.notes.includes(note)) {
    st.notes = st.notes.filter((n) => n !== (valence > 0 ? 'was rude to staff' : 'friendly with the staff'));
    st.notes.push(note);
    if (st.notes.length > 4) st.notes.shift();
  }
}

export type { Relationship };
