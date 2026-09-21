/**
 * Story system: hard choices with clocks (dilemmas) and the city as a character (news).
 *
 * Dilemmas: two or three times a month a controlled sim faces a real trade-off with a deadline.
 * It arrives as an interrupt, can be deferred ("think about it") and stays visible with a
 * countdown; the default happens at the deadline. Choices set lasting flags and schedule
 * follow-ups days later, so the world remembers out loud.
 *
 * News: roughly weekly, something happens to the whole city for a few days (a transit strike,
 * a heat wave, layoffs at a big employer, a gas spike, a flu wave, a water main break, a title
 * run, road works). Effects are deterministic and read by transport, health, venues and moods,
 * and the headline reaches the model's world context.
 *
 * Events consumed: time:day, time:hour, scheduled:fired, world:new_game
 * Action ids: story:decide:<dilemmaId>:<optionId>, story:defer:<dilemmaId>, story:review:<dilemmaId>
 * World flags: story:lastDilemma:<simId>, story:lastNews, dilemma:<templateId>:<optionId>:<simId>
 */
import type { ActionDef, Dilemma, DilemmaOption, EffectBundle, EmotionId, GeneratedDilemma, NewsEffects, NewsItem, Sim, SimId, VenueId, WorldState } from '../core/types';
import type { ActionResult, System, SystemContext } from '../core/systems';
import { shortId } from '../core/ids';
import { clamp, DAY, formatMoney, HOUR, round2 } from '../core/util';

// ---------------------------------------------------------------------------
// News: the active effects, for other systems
// ---------------------------------------------------------------------------
export function activeNews(state: WorldState): NewsItem[] {
  const now = state.time.minute;
  return (state.news ?? []).filter((n) => n.startedAt <= now && n.endsAt > now);
}

/** Merged effects of everything in the news right now. */
export function newsEffects(state: WorldState): NewsEffects {
  const out: NewsEffects = {};
  for (const n of activeNews(state)) {
    const e = n.effects;
    if (e.transitDown) out.transitDown = true;
    if (e.rideshareSurge) out.rideshareSurge = Math.max(out.rideshareSurge ?? 1, e.rideshareSurge);
    if (e.gasMultiplier) out.gasMultiplier = Math.max(out.gasMultiplier ?? 1, e.gasMultiplier);
    if (e.travelMultiplier) out.travelMultiplier = Math.max(out.travelMultiplier ?? 1, e.travelMultiplier);
    if (e.contagionMultiplier) out.contagionMultiplier = Math.max(out.contagionMultiplier ?? 1, e.contagionMultiplier);
    if (e.priceMultiplier) out.priceMultiplier = Math.max(out.priceMultiplier ?? 1, e.priceMultiplier);
    if (e.layoffRisk) out.layoffRisk = true;
    if (e.closedVenueId) out.closedVenueId = e.closedVenueId;
    if (e.moodlet && (!out.moodlet || Math.abs(e.moodlet.intensity) > Math.abs(out.moodlet.intensity))) out.moodlet = e.moodlet;
  }
  return out;
}

interface NewsTemplate {
  kind: string;
  weight: (ctx: SystemContext) => number;
  days: [number, number];
  make: (ctx: SystemContext) => { headline: string; body: string; effects: NewsEffects; venueId?: VenueId };
}

const NEWS: NewsTemplate[] = [
  {
    kind: 'transit_strike',
    weight: (ctx) => (ctx.state.region.transitQuality > 0.2 ? 3 : 0.5),
    days: [2, 5],
    make: (ctx) => ({
      headline: 'Transit workers walk out',
      body: `Buses and trains stop at midnight after contract talks collapse. ${ctx.state.region.name} commuters are on their own; rideshare prices are already climbing.`,
      effects: { transitDown: true, rideshareSurge: 1.6, travelMultiplier: 1.15 },
    }),
  },
  {
    kind: 'heat_wave',
    weight: (ctx) => (ctx.state.weather.current.tempF > 82 ? 4 : 0.3),
    days: [3, 6],
    make: () => ({
      headline: 'Excessive heat warning through the weekend',
      body: 'Highs above 100. Cooling centers open at libraries. The grid operator asks everyone to hold off on laundry until after 8 PM.',
      effects: { moodlet: { emotion: 'tired', label: 'Heat wave', intensity: -5 }, priceMultiplier: 1.05 },
    }),
  },
  {
    kind: 'layoffs',
    weight: () => 2,
    days: [5, 9],
    make: (ctx) => {
      const employers = Object.values(ctx.state.venues).filter((v) => v.staffSimIds.length >= 4 && v.discovered);
      const v = employers.length ? ctx.rng.pick(employers) : undefined;
      return {
        headline: v ? `${v.name} announces cuts` : 'Big employer announces layoffs',
        body: v ? `${v.name} will let go of a third of its staff by the end of the month. The city says it will "explore options". Everyone with a job is suddenly very punctual.` : 'A major employer is cutting a third of its staff. Everyone with a job is suddenly very punctual.',
        effects: { layoffRisk: true, moodlet: { emotion: 'anxious', label: 'Layoff rumors', intensity: -6 } },
        venueId: v?.id,
      };
    },
  },
  {
    kind: 'gas_spike',
    weight: () => 2,
    days: [4, 8],
    make: (ctx) => ({
      headline: `Gas jumps to ${formatMoney(round2(ctx.state.economy.gasPrice * 1.3))}`,
      body: 'A refinery outage upstream. Stations near the highway are already out of regular. Expect it to stick for a week.',
      effects: { gasMultiplier: 1.3, rideshareSurge: 1.2 },
    }),
  },
  {
    kind: 'flu_wave',
    weight: (ctx) => (ctx.clock.season === 'winter' || ctx.clock.season === 'fall' ? 3 : 0.8),
    days: [5, 10],
    make: () => ({
      headline: 'Flu cases double; clinics extend hours',
      body: 'Urgent cares are packed and pharmacies are out of the good decongestant. Wash your hands. Skip the crowded bar, maybe.',
      effects: { contagionMultiplier: 2.2 },
    }),
  },
  {
    kind: 'water_main',
    weight: () => 1.5,
    days: [1, 3],
    make: (ctx) => {
      const candidates = Object.values(ctx.state.venues).filter((v) => v.discovered && !['home', 'apartment_building', 'hospital', 'police', 'jail'].includes(v.archetype));
      const v = candidates.length ? ctx.rng.pick(candidates) : undefined;
      return {
        headline: v ? `Water main break closes ${v.name}` : 'Water main break floods a block downtown',
        body: v ? `${v.name} is closed until crews finish. Traffic is a mess for blocks around it.` : 'Crews are on site; traffic is a mess for blocks around it.',
        effects: { closedVenueId: v?.id, travelMultiplier: 1.1 },
        venueId: v?.id,
      };
    },
  },
  {
    kind: 'title_run',
    weight: () => 1.5,
    days: [3, 6],
    make: (ctx) => ({
      headline: `${ctx.state.region.name} is one win from a title`,
      body: 'Every bar has the game on. Strangers high-five. Productivity is a rumor.',
      effects: { moodlet: { emotion: 'energized', label: 'Playoff fever', intensity: 6 } },
    }),
  },
  {
    kind: 'road_works',
    weight: () => 2,
    days: [6, 12],
    make: () => ({
      headline: 'Main arterial closed for repaving',
      body: 'Detours add ten minutes to everything. The city insists it is "on schedule". Nobody believes the city.',
      effects: { travelMultiplier: 1.3 },
    }),
  },
  {
    kind: 'festival_traffic',
    weight: (ctx) => (Object.keys(ctx.state.flags).some((k) => k.startsWith('festival:')) ? 3 : 0),
    days: [2, 3],
    make: () => ({
      headline: 'Festival weekend: streets closed, prices up',
      body: 'Half the downtown grid is pedestrian-only and every bar has a cover charge. Fun, if you like people.',
      effects: { priceMultiplier: 1.15, rideshareSurge: 1.4, moodlet: { emotion: 'playful', label: 'Festival weekend', intensity: 4 } },
    }),
  },
];

function rollNews(ctx: SystemContext): void {
  const state = ctx.state;
  const now = state.time.minute;
  state.news ||= [];
  for (const n of state.news) {
    if (n.endsAt <= now && !state.flags[`news:ended:${n.id}`]) {
      state.flags[`news:ended:${n.id}`] = true;
      ctx.log({ text: `NEWS · ${n.kind === 'transit_strike' ? 'Transit is running again after the strike.' : n.kind === 'water_main' ? `Repairs are done; things are open again.` : n.kind === 'road_works' ? 'The repaving is finished. Ten minutes back in your day.' : `The ${n.headline.toLowerCase()} story has run its course.`}`, kind: 'event', importance: 1, meta: { news: n.id } });
    }
  }
  if (state.news.length > 30) state.news.splice(0, state.news.length - 30);
  if (activeNews(state).length) return;
  const last = Number(state.flags['story:lastNews'] ?? -1e9);
  if (now - last < 3 * DAY) return;
  if (!ctx.rng.chance(0.2)) return;
  const pool = NEWS.map((t) => ({ t, w: t.weight(ctx) })).filter((x) => x.w > 0);
  if (!pool.length) return;
  let r = ctx.rng.next() * pool.reduce((s, x) => s + x.w, 0);
  let chosen = pool[0].t;
  for (const x of pool) {
    r -= x.w;
    if (r <= 0) {
      chosen = x.t;
      break;
    }
  }
  const made = chosen.make(ctx);
  const days = ctx.rng.int(chosen.days[0], chosen.days[1]);
  const item: NewsItem = { id: shortId(ctx.rng, 'news'), kind: chosen.kind, headline: made.headline, body: made.body, startedAt: now, endsAt: now + days * DAY, effects: made.effects, venueId: made.venueId };
  state.news.push(item);
  state.flags['story:lastNews'] = now;
  ctx.log({ text: `NEWS · ${item.headline}. ${item.body}`, kind: 'event', importance: 2, meta: { news: item.id } });
  for (const sim of ctx.query.controlledSims()) {
    sim.phone.notifications.push({ id: shortId(ctx.rng, 'ntf'), at: now, app: 'news', title: item.headline, body: item.body.slice(0, 140), read: false });
  }
  ctx.emit({ type: 'custom', kind: 'story:news', payload: { id: item.id, kind: item.kind } });
}

/** Once a day, the city's mood lands on everyone who is fully simulated. */
function applyNewsMood(ctx: SystemContext): void {
  const fx = newsEffects(ctx.state);
  if (!fx.moodlet) return;
  for (const sim of ctx.query.simulatedSims()) {
    if (!sim.body.alive) continue;
    ctx.applyEffects(sim.id, { moodlets: [{ ...fx.moodlet, emotion: fx.moodlet.emotion as EmotionId, durationMinutes: DAY + HOUR }] }, 'story:news');
  }
}

// ---------------------------------------------------------------------------
// Dilemmas
// ---------------------------------------------------------------------------
interface DilemmaTemplate {
  id: string;
  weight: number;
  cooldownDays: number;
  condition: (ctx: SystemContext, sim: Sim) => boolean;
  /** pick the people and numbers; return undefined when the world can't supply them */
  setup: (ctx: SystemContext, sim: Sim) => { actors: Record<string, SimId>; amounts: Record<string, number> } | undefined;
  title: (ctx: SystemContext, d: Dilemma) => string;
  body: (ctx: SystemContext, d: Dilemma) => string;
  deadlineHours: number;
  options: (ctx: SystemContext, d: Dilemma) => DilemmaOption[];
  defaultOptionId: string;
  resolve: (ctx: SystemContext, sim: Sim, d: Dilemma, optionId: string, byDeadline: boolean) => void;
}

const name = (ctx: SystemContext, id?: SimId) => (id ? ctx.query.simMaybe(id)?.identity.firstName ?? 'someone' : 'someone');
const friendsOf = (ctx: SystemContext, sim: Sim, min = 25) =>
  Object.values(sim.relationships)
    .filter((r) => r.friendship >= min && r.familiarity >= 15 && ctx.state.sims[r.simId]?.body.alive && !r.flags.some((f) => ['parent', 'child', 'sibling'].includes(f)))
    .sort((a, b) => b.friendship - a.friendship);
const familyOf = (ctx: SystemContext, sim: Sim) => Object.values(sim.relationships).filter((r) => r.flags.some((f) => ['parent', 'sibling', 'grandparent'].includes(f)) && ctx.state.sims[r.simId]?.body.alive);
const coworkersOf = (ctx: SystemContext, sim: Sim) => Object.values(sim.relationships).filter((r) => r.flags.includes('coworker') && ctx.state.sims[r.simId]?.body.alive);
const cash = (ctx: SystemContext, sim: Sim) => ctx.query.liquidCash(sim);

function mood(ctx: SystemContext, sim: Sim, emotion: EmotionId, label: string, intensity: number, days = 3): void {
  ctx.applyEffects(sim.id, { moodlets: [{ emotion, label, intensity, durationMinutes: days * DAY }] }, 'story:dilemma');
}
function rel(ctx: SystemContext, sim: Sim, other: SimId | undefined, delta: { friendship?: number; trust?: number; romance?: number; familiarity?: number }, mutual = true): void {
  if (!other || !ctx.state.sims[other]) return;
  ctx.applyEffects(sim.id, { relationships: [{ simId: other, ...delta, mutual }] }, 'story:dilemma');
}
function money(ctx: SystemContext, sim: Sim, amount: number, memo: string, counterparty?: string): void {
  ctx.applyEffects(sim.id, { money: { amount, memo, category: amount < 0 ? 'other' : 'income', counterparty } }, 'story:dilemma');
}
function later(ctx: SystemContext, sim: Sim, d: Dilemma, days: number, key: string, label: string): void {
  ctx.schedule({ inMinutes: days * DAY + ctx.rng.int(8, 20) * HOUR, kind: 'story:followup', label, simId: sim.id, payload: { dilemmaId: d.id, templateId: d.templateId, key } });
}
function tell(ctx: SystemContext, sim: Sim, text: string, importance = 2): void {
  ctx.log({ text, kind: 'event', simId: sim.id, venueId: sim.location.venueId, importance, meta: { source: 'story:dilemma' } });
}

const TEMPLATES: DilemmaTemplate[] = [
  {
    id: 'friend_loan',
    weight: 3,
    cooldownDays: 30,
    condition: (ctx, sim) => friendsOf(ctx, sim).length > 0 && cash(ctx, sim) >= 300,
    setup: (ctx, sim) => {
      const f = friendsOf(ctx, sim)[0];
      const amount = Math.round(clamp(cash(ctx, sim) * 0.35, 150, 2500) / 10) * 10;
      return { actors: { friend: f.simId }, amounts: { amount } };
    },
    title: (ctx, d) => `${name(ctx, d.actors.friend)} asks to borrow ${formatMoney(d.amounts.amount)}`,
    body: (ctx, d) => `${name(ctx, d.actors.friend)} texts, then calls. Rent is short and the car needs a part. "I'll pay you back in three weeks, I swear." You have ${formatMoney(cash(ctx, ctx.query.sim(d.simId)))} to your name.`,
    deadlineHours: 36,
    options: (ctx, d) => [
      { id: 'lend', label: `Lend the ${formatMoney(d.amounts.amount)}`, hint: 'They may or may not pay it back' },
      { id: 'half', label: `Offer ${formatMoney(Math.round(d.amounts.amount / 2))}, no strings`, hint: 'A gift, not a loan' },
      { id: 'decline', label: 'Say no, gently', hint: 'They will remember' },
    ],
    defaultOptionId: 'ghost',
    resolve: (ctx, sim, d, opt, byDeadline) => {
      const f = d.actors.friend;
      if (opt === 'lend') {
        money(ctx, sim, -d.amounts.amount, `Loan to ${name(ctx, f)}`, name(ctx, f));
        rel(ctx, sim, f, { trust: 6, friendship: 4 });
        const r = sim.relationships[f];
        if (r) r.moneyOwed += d.amounts.amount;
        tell(ctx, sim, `You send ${name(ctx, f)} the money. The thank-you is long and a little too fast.`);
        later(ctx, sim, d, 21, 'repay', `${name(ctx, f)} and the loan`);
      } else if (opt === 'half') {
        money(ctx, sim, -Math.round(d.amounts.amount / 2), `Gift to ${name(ctx, f)}`, name(ctx, f));
        rel(ctx, sim, f, { friendship: 8, trust: 3 });
        tell(ctx, sim, `"Don't pay me back." ${name(ctx, f)} goes quiet, then: "Okay. Okay. Thank you."`);
      } else if (opt === 'decline') {
        rel(ctx, sim, f, { friendship: -8, trust: -3 });
        tell(ctx, sim, `${name(ctx, f)} says it's fine. It is not fine, and you both know it. They'll come around, probably.`);
        later(ctx, sim, d, 10, 'declined', `${name(ctx, f)} after the loan`);
      } else {
        rel(ctx, sim, f, { friendship: -14, trust: -8 });
        tell(ctx, sim, `You never answered. ${name(ctx, f)} stopped asking. That silence is its own answer.`, byDeadline ? 3 : 2);
        mood(ctx, sim, 'guilty', 'Left a friend hanging', -6, 4);
      }
    },
  },
  {
    id: 'job_offer',
    weight: 2,
    cooldownDays: 45,
    condition: (ctx, sim) => !!sim.career.job && !!sim.career.job.employerVenueId && ctx.query.venuesByArchetype(ctx.state.venues[sim.career.job.employerVenueId!]?.archetype ?? 'unknown').length > 1,
    setup: (ctx, sim) => {
      const job = sim.career.job!;
      const alt = ctx.query.venuesByArchetype(ctx.state.venues[job.employerVenueId!]!.archetype).filter((v) => v.id !== job.employerVenueId);
      if (!alt.length) return undefined;
      const v = ctx.rng.pick(alt);
      return { actors: { venue: v.id as unknown as SimId }, amounts: { raise: 0.15 } };
    },
    title: (ctx, d) => `An offer from ${ctx.state.venues[d.actors.venue as unknown as VenueId]?.name ?? 'a competitor'}`,
    body: (ctx, d) => {
      const sim = ctx.query.sim(d.simId);
      const v = ctx.state.venues[d.actors.venue as unknown as VenueId];
      const km = v ? ctx.query.distanceKm(ctx.query.homeOf(sim.id)?.id ?? sim.location.venueId, v.id) : 0;
      return `${v?.name ?? 'A competitor'} wants you: same title, 15% more, a new boss you've never met, and a ${km > 6 ? 'much longer' : km > 2 ? 'longer' : 'similar'} commute. Your current boss doesn't know yet. They want an answer by the end of the week.`;
    },
    deadlineHours: 72,
    options: () => [
      { id: 'take', label: 'Take it', hint: '+15% pay, new coworkers, start Monday' },
      { id: 'leverage', label: 'Use it to ask for a raise', hint: 'Your boss may or may not bite' },
      { id: 'stay', label: 'Turn it down', hint: 'Loyalty has a price too' },
    ],
    defaultOptionId: 'stay',
    resolve: (ctx, sim, d, opt) => {
      const job = sim.career.job;
      if (!job) return;
      const v = ctx.state.venues[d.actors.venue as unknown as VenueId];
      if (opt === 'take' && v) {
        const oldBoss = job.bossSimId;
        job.employerVenueId = v.id;
        job.employerName = v.name;
        if (job.annualSalary) job.annualSalary = round2(job.annualSalary * 1.15);
        if (job.hourlyRate) job.hourlyRate = round2(job.hourlyRate * 1.15);
        job.coworkerSimIds = v.staffSimIds.filter((id) => id !== sim.id).slice(0, 6);
        job.bossSimId = v.staffSimIds.find((id) => id !== sim.id);
        job.performance = 60;
        sim.flags[`dilemma:job_offer:take:${sim.id}`] = true;
        if (oldBoss) rel(ctx, sim, oldBoss, { friendship: -6, trust: -4 });
        tell(ctx, sim, `You give notice. Your old boss is gracious in a way that makes it worse. Monday you start at ${v.name}.`, 3);
        mood(ctx, sim, 'energized', 'New job', 8, 5);
        later(ctx, sim, d, 14, 'settling', 'Two weeks into the new job');
      } else if (opt === 'leverage') {
        const ok = ctx.rng.chance(0.55 + (job.performance - 60) / 200);
        if (ok) {
          if (job.annualSalary) job.annualSalary = round2(job.annualSalary * 1.08);
          if (job.hourlyRate) job.hourlyRate = round2(job.hourlyRate * 1.08);
          tell(ctx, sim, `Your boss sighs, then finds 8%. "Don't make a habit of this."`, 3);
          mood(ctx, sim, 'proud', 'Negotiated a raise', 8, 4);
        } else {
          job.performance = clamp(job.performance - 5, 0, 100);
          if (job.bossSimId) rel(ctx, sim, job.bossSimId, { trust: -6 });
          tell(ctx, sim, `"If you want to go, go." Your boss doesn't budge, and now they know you were looking.`, 3);
          mood(ctx, sim, 'embarrassed', 'Bluff called', -6, 3);
        }
      } else {
        tell(ctx, sim, `You pass. Nothing changes, which was the point, and also the problem.`, 2);
        sim.flags[`dilemma:job_offer:stay:${sim.id}`] = true;
      }
    },
  },
  {
    id: 'parent_health',
    weight: 2,
    cooldownDays: 90,
    condition: (ctx, sim) => familyOf(ctx, sim).length > 0,
    setup: (ctx, sim) => {
      const f = familyOf(ctx, sim).find((r) => r.flags.includes('parent')) ?? familyOf(ctx, sim)[0];
      return { actors: { relative: f.simId }, amounts: { trip: Math.round(clamp(cash(ctx, sim) * 0.4, 120, 900)) } };
    },
    title: (ctx, d) => `${name(ctx, d.actors.relative)} is in the hospital`,
    body: (ctx, d) => `A call you don't want at 6 AM. ${name(ctx, d.actors.relative)} had a fall; they're stable, they're scared, they're asking for you. Going means missing two days of everything and about ${formatMoney(d.amounts.trip)}.`,
    deadlineHours: 24,
    options: (ctx, d) => [
      { id: 'go', label: 'Go, today', hint: `Miss two days, spend ${formatMoney(d.amounts.trip)}` },
      { id: 'call', label: 'Call every day, send flowers', hint: 'Keep your job whole' },
      { id: 'busy', label: "Say you can't get away", hint: 'You could, though' },
    ],
    defaultOptionId: 'busy',
    resolve: (ctx, sim, d, opt) => {
      const r = d.actors.relative;
      if (opt === 'go') {
        money(ctx, sim, -d.amounts.trip, 'Trip to family', 'Travel');
        rel(ctx, sim, r, { friendship: 12, trust: 10 });
        if (sim.career.job) sim.career.job.performance = clamp(sim.career.job.performance - 4, 0, 100);
        sim.flags[`dilemma:parent_health:go:${sim.id}`] = true;
        tell(ctx, sim, `You go. Two days of vending-machine coffee and a hand that holds on tighter than it used to. Worth it.`, 3);
        mood(ctx, sim, 'grateful', 'Was there for family', 8, 6);
        ctx.applyEffects(sim.id, { needs: { energy: -20 }, stress: 8 }, 'story:dilemma');
      } else if (opt === 'call') {
        money(ctx, sim, -60, 'Flowers', 'Florist');
        rel(ctx, sim, r, { friendship: 4, trust: 2 });
        tell(ctx, sim, `You call every day. It helps. It isn't the same, and ${name(ctx, r)} is careful not to say so.`, 2);
      } else {
        rel(ctx, sim, r, { friendship: -10, trust: -12 });
        sim.flags[`dilemma:parent_health:busy:${sim.id}`] = true;
        tell(ctx, sim, `You say you can't get away. ${name(ctx, r)} says of course, of course. The word sits with you for days.`, 3);
        mood(ctx, sim, 'guilty', 'Should have gone', -10, 7);
        later(ctx, sim, d, 30, 'regret', 'Family, later');
      }
    },
  },
  {
    id: 'cover_shift',
    weight: 3,
    cooldownDays: 21,
    condition: (ctx, sim) => !!sim.career.job && friendsOf(ctx, sim, 20).length > 0,
    setup: (ctx, sim) => ({ actors: { friend: friendsOf(ctx, sim, 20)[0].simId, boss: sim.career.job!.bossSimId ?? friendsOf(ctx, sim, 20)[0].simId }, amounts: { extra: Math.round(((sim.career.job!.hourlyRate ?? (sim.career.job!.annualSalary ?? 40000) / 2080) * 8) * 1.5) } }),
    title: (ctx, d) => `Your boss needs Saturday; ${name(ctx, d.actors.friend)} needs you Saturday`,
    body: (ctx, d) => `Someone quit and ${name(ctx, d.actors.boss)} is short Saturday: time-and-a-half, about ${formatMoney(d.amounts.extra)}, and a favor banked. Saturday is also ${name(ctx, d.actors.friend)}'s thing, the one you said you'd never miss.`,
    deadlineHours: 30,
    options: (ctx, d) => [
      { id: 'work', label: `Cover the shift (+${formatMoney(d.amounts.extra)})`, hint: 'Your boss remembers this' },
      { id: 'friend', label: `Keep the promise to ${name(ctx, d.actors.friend)}`, hint: 'Your boss remembers this too' },
    ],
    defaultOptionId: 'friend',
    resolve: (ctx, sim, d, opt) => {
      if (opt === 'work') {
        money(ctx, sim, d.amounts.extra, 'Overtime', sim.career.job?.employerName);
        if (sim.career.job) sim.career.job.performance = clamp(sim.career.job.performance + 6, 0, 100);
        rel(ctx, sim, d.actors.boss, { trust: 8, friendship: 3 });
        rel(ctx, sim, d.actors.friend, { friendship: -9, trust: -4 });
        sim.flags[`dilemma:cover_shift:work:${sim.id}`] = true;
        tell(ctx, sim, `You work the Saturday. ${name(ctx, d.actors.friend)} texts "no worries" with no emoji, which is how you know.`, 2);
        ctx.applyEffects(sim.id, { needs: { energy: -15, fun: -10 } }, 'story:dilemma');
      } else {
        rel(ctx, sim, d.actors.friend, { friendship: 8, trust: 6 });
        rel(ctx, sim, d.actors.boss, { trust: -4 });
        if (sim.career.job) sim.career.job.performance = clamp(sim.career.job.performance - 3, 0, 100);
        sim.flags[`dilemma:cover_shift:friend:${sim.id}`] = true;
        tell(ctx, sim, `You tell ${name(ctx, d.actors.boss)} you can't. Saturday with ${name(ctx, d.actors.friend)} is exactly as good as promised.`, 2);
        mood(ctx, sim, 'happy', 'Kept a promise', 6, 3);
      }
    },
  },
  {
    id: 'found_wallet',
    weight: 2,
    cooldownDays: 40,
    condition: (ctx, sim) => sim.location.venueId !== ctx.query.homeOf(sim.id)?.id,
    setup: (ctx) => ({ actors: {}, amounts: { cash: ctx.rng.int(12, 34) * 10 } }),
    title: () => 'A wallet on the sidewalk',
    body: (ctx, d) => `Worn leather, a driver's license, two credit cards, and ${formatMoney(d.amounts.cash)} in cash. Nobody around. The address on the license is a bus ride away.`,
    deadlineHours: 6,
    options: (ctx, d) => [
      { id: 'return', label: 'Return it, cash and all', hint: 'An hour of your day' },
      { id: 'keep_cash', label: `Keep the ${formatMoney(d.amounts.cash)}, drop the wallet in a mailbox`, hint: 'Nobody would know' },
      { id: 'leave', label: 'Leave it where it is', hint: 'Not your problem' },
    ],
    defaultOptionId: 'leave',
    resolve: (ctx, sim, d, opt) => {
      if (opt === 'return') {
        sim.reputation = clamp(sim.reputation + 4, -100, 100);
        ctx.applyEffects(sim.id, { needs: { energy: -6 } }, 'story:dilemma');
        if (ctx.rng.chance(0.4)) {
          money(ctx, sim, 40, 'Reward for a returned wallet', 'A grateful stranger');
          tell(ctx, sim, `The owner presses two twenties into your hand and won't take no. "People don't do this anymore."`, 2);
        } else tell(ctx, sim, `The owner is more relieved than grateful, which is fine. You feel lighter walking back.`, 2);
        mood(ctx, sim, 'proud', 'Did the right thing', 6, 3);
        sim.flags[`dilemma:found_wallet:return:${sim.id}`] = true;
      } else if (opt === 'keep_cash') {
        money(ctx, sim, d.amounts.cash, 'Found cash', 'The sidewalk');
        ctx.applyEffects(sim.id, { legal: [{ kind: 'heat', delta: 4 }] }, 'story:dilemma');
        mood(ctx, sim, 'guilty', 'Kept the cash', -4, 4);
        sim.flags[`dilemma:found_wallet:keep:${sim.id}`] = true;
        tell(ctx, sim, `The cash goes in your pocket. The wallet goes in a mailbox. You check over your shoulder more than once.`, 2);
      } else tell(ctx, sim, `You step around it. Someone else's story.`, 1);
    },
  },
  {
    id: 'medical_bill',
    weight: 2,
    cooldownDays: 60,
    condition: (ctx, sim) => cash(ctx, sim) > 0,
    setup: (ctx, sim) => ({ actors: {}, amounts: { bill: Math.round(clamp(cash(ctx, sim) * 0.6, 220, 1800) / 10) * 10 } }),
    title: (ctx, d) => `A ${formatMoney(d.amounts.bill)} bill you don't remember`,
    body: (ctx, d) => `An envelope from a lab you've never heard of, for a visit months ago. "Balance due: ${formatMoney(d.amounts.bill)}." The phone number goes to hold music.`,
    deadlineHours: 72,
    options: (ctx, d) => [
      { id: 'pay', label: `Pay the ${formatMoney(d.amounts.bill)}`, hint: 'Done and gone' },
      { id: 'plan', label: 'Call and set up a payment plan', hint: 'Small monthly hits, an afternoon lost' },
      { id: 'ignore', label: 'Ignore it', hint: 'Collections is a real place' },
    ],
    defaultOptionId: 'ignore',
    resolve: (ctx, sim, d, opt) => {
      if (opt === 'pay') {
        money(ctx, sim, -d.amounts.bill, 'Medical bill', 'Lab billing');
        tell(ctx, sim, `Paid. You will never know what the visit was for.`, 1);
      } else if (opt === 'plan') {
        ctx.applyEffects(sim.id, { needs: { fun: -8 }, stress: 4 }, 'story:dilemma');
        const monthly = Math.round(d.amounts.bill / 6);
        for (let m = 1; m <= 6; m++) ctx.schedule({ inMinutes: m * 30 * DAY, kind: 'story:bill_installment', label: 'Medical bill installment', simId: sim.id, payload: { amount: monthly } });
        tell(ctx, sim, `Forty minutes of hold music, and a plan: ${formatMoney(monthly)} a month for six months.`, 1);
      } else {
        sim.flags[`dilemma:medical_bill:ignore:${sim.id}`] = true;
        later(ctx, sim, d, 45, 'collections', 'That bill');
        tell(ctx, sim, `It goes on the pile. The pile does not go away.`, 1);
      }
    },
  },
  {
    id: 'coworker_cover',
    weight: 2,
    cooldownDays: 35,
    condition: (ctx, sim) => !!sim.career.job && coworkersOf(ctx, sim).length > 0,
    setup: (ctx, sim) => ({ actors: { coworker: ctx.rng.pick(coworkersOf(ctx, sim)).simId, boss: sim.career.job!.bossSimId ?? coworkersOf(ctx, sim)[0].simId }, amounts: {} }),
    title: (ctx, d) => `${name(ctx, d.actors.coworker)} asks you to cover for them`,
    body: (ctx, d) => `${name(ctx, d.actors.coworker)} made a mistake that's going to come out. "If anyone asks, you saw me finish it Tuesday. Please. I can't lose this job." ${name(ctx, d.actors.boss)} is already asking.`,
    deadlineHours: 8,
    options: (ctx, d) => [
      { id: 'lie', label: `Back ${name(ctx, d.actors.coworker)} up`, hint: 'Might hold, might not' },
      { id: 'honest', label: 'Tell the truth if asked', hint: 'They will not forgive it quickly' },
      { id: 'dodge', label: 'Say you don’t remember', hint: 'Satisfies nobody' },
    ],
    defaultOptionId: 'dodge',
    resolve: (ctx, sim, d, opt) => {
      const c = d.actors.coworker;
      const b = d.actors.boss;
      if (opt === 'lie') {
        rel(ctx, sim, c, { trust: 12, friendship: 8 });
        if (ctx.rng.chance(0.3)) {
          if (sim.career.job) sim.career.job.performance = clamp(sim.career.job.performance - 12, 0, 100);
          rel(ctx, sim, b, { trust: -15 });
          tell(ctx, sim, `It comes out anyway. ${name(ctx, b)} now knows two things about you, and remembers both.`, 3);
          mood(ctx, sim, 'embarrassed', 'Caught in a lie', -8, 4);
        } else tell(ctx, sim, `It holds. ${name(ctx, c)} owes you one and knows it.`, 2);
        sim.flags[`dilemma:coworker_cover:lie:${sim.id}`] = true;
      } else if (opt === 'honest') {
        rel(ctx, sim, c, { friendship: -15, trust: -10 });
        rel(ctx, sim, b, { trust: 8 });
        if (sim.career.job) sim.career.job.performance = clamp(sim.career.job.performance + 2, 0, 100);
        tell(ctx, sim, `You don't lie. ${name(ctx, c)} gets written up and stops saying good morning.`, 2);
        sim.flags[`dilemma:coworker_cover:honest:${sim.id}`] = true;
      } else {
        rel(ctx, sim, c, { friendship: -5 });
        rel(ctx, sim, b, { trust: -2 });
        tell(ctx, sim, `"I don't really remember." Everyone hears exactly what that means.`, 1);
      }
    },
  },
  {
    id: 'car_trouble',
    weight: 2,
    cooldownDays: 50,
    condition: (ctx, sim) => (ctx.query.householdOf(sim.id)?.vehicleIds ?? []).some((id) => ['car', 'suv', 'truck', 'van'].includes(ctx.state.vehicles[id]?.kind ?? '')),
    setup: (ctx, sim) => {
      const id = (ctx.query.householdOf(sim.id)?.vehicleIds ?? []).find((v) => ['car', 'suv', 'truck', 'van'].includes(ctx.state.vehicles[v]?.kind ?? ''))!;
      return { actors: { vehicle: id as unknown as SimId }, amounts: { repair: ctx.rng.int(38, 120) * 10 } };
    },
    title: (ctx, d) => `The ${ctx.state.vehicles[d.actors.vehicle as never]?.make ?? 'car'} needs ${formatMoney(d.amounts.repair)} of work`,
    body: (ctx, d) => `A noise, then a light. The shop says brakes and a bearing: ${formatMoney(d.amounts.repair)}, two days. "You can drive it, but I wouldn't."`,
    deadlineHours: 48,
    options: (ctx, d) => [
      { id: 'fix', label: `Fix it (${formatMoney(d.amounts.repair)})`, hint: 'Two days without the car' },
      { id: 'defer', label: 'Drive it carefully for now', hint: 'Roll the dice' },
      { id: 'sell', label: 'Sell it as-is', hint: 'Cash now, buses forever' },
    ],
    defaultOptionId: 'defer',
    resolve: (ctx, sim, d, opt) => {
      const v = ctx.state.vehicles[d.actors.vehicle as never];
      if (!v) return;
      if (opt === 'fix') {
        money(ctx, sim, -d.amounts.repair, 'Car repair', 'Auto shop');
        v.condition = clamp(v.condition + 25, 0, 100);
        v.issues = [];
        tell(ctx, sim, `Two days of buses and it drives like it did when you bought it.`, 1);
      } else if (opt === 'defer') {
        v.condition = clamp(v.condition - 10, 0, 100);
        if (!v.issues.includes('brakes')) v.issues.push('brakes');
        sim.flags[`dilemma:car_trouble:defer:${sim.id}`] = true;
        later(ctx, sim, d, 12, 'breakdown', 'The car');
        tell(ctx, sim, `You drive it carefully. Every stop is a small prayer.`, 1);
      } else {
        const hh = ctx.query.householdOf(sim.id);
        const price = Math.round(v.value * 0.55);
        money(ctx, sim, price, `Sold ${v.make} ${v.model}`, 'A guy from the internet');
        if (hh) hh.vehicleIds = hh.vehicleIds.filter((x) => x !== v.id);
        delete ctx.state.vehicles[v.id];
        tell(ctx, sim, `A guy from the internet hands you ${formatMoney(price)} in twenties and drives off in your car. The bus stop is three blocks.`, 2);
      }
    },
  },
  {
    id: 'setup_date',
    weight: 2,
    cooldownDays: 30,
    condition: (ctx, sim) => friendsOf(ctx, sim).length > 0 && !Object.values(sim.relationships).some((r) => r.flags.some((f) => ['dating', 'partner', 'married'].includes(f))) && ['young_adult', 'adult'].includes(sim.lifeStage),
    setup: (ctx, sim) => {
      const f = friendsOf(ctx, sim)[0];
      const friendSim = ctx.state.sims[f.simId];
      const pool = Object.values(friendSim.relationships).filter((r) => r.friendship > 20 && r.simId !== sim.id && ctx.state.sims[r.simId]?.body.alive && !sim.relationships[r.simId]);
      const cand = pool.length ? ctx.rng.pick(pool).simId : undefined;
      if (!cand) return undefined;
      return { actors: { friend: f.simId, date: cand }, amounts: {} };
    },
    title: (ctx, d) => `${name(ctx, d.actors.friend)} wants to set you up`,
    body: (ctx, d) => `"You'd like ${name(ctx, d.actors.date)}. Just coffee. I already told them about you." ${name(ctx, d.actors.friend)} has that look.`,
    deadlineHours: 48,
    options: (ctx, d) => [
      { id: 'yes', label: `Coffee with ${name(ctx, d.actors.date)}`, hint: 'Saturday, 2 PM' },
      { id: 'no', label: 'Not right now', hint: 'Your friend will keep trying' },
    ],
    defaultOptionId: 'no',
    resolve: (ctx, sim, d, opt) => {
      if (opt === 'yes') {
        const date = d.actors.date;
        ctx.applyEffects(sim.id, { relationships: [{ simId: date, familiarity: 3, attraction: 5, mutual: true }] }, 'story:dilemma');
        rel(ctx, sim, d.actors.friend, { friendship: 3 });
        const hh = ctx.query.homeOf(sim.id);
        const cafe = ctx.query.nearestVenue(hh?.id ?? sim.location.venueId, 'cafe');
        ctx.schedule({ inMinutes: 2 * DAY, kind: 'appointment', label: `Coffee with ${name(ctx, date)}${cafe ? ` at ${cafe.name}` : ''}`, simId: sim.id, venueId: cafe?.id, payload: { withSimId: date, kind: 'blind_date' } });
        tell(ctx, sim, `Fine. Coffee. Saturday. ${name(ctx, d.actors.friend)} is insufferable about it.`, 2);
      } else {
        rel(ctx, sim, d.actors.friend, { friendship: -1 });
        tell(ctx, sim, `"Not right now" is heard as "ask again in a month".`, 1);
      }
    },
  },
];

function fmtDeadline(ctx: SystemContext, minute: number): string {
  const day = ctx.clock.dateLabel;
  const dayIdx = Math.floor(minute / DAY);
  const todayIdx = Math.floor(ctx.state.time.minute / DAY);
  const mod = ((minute % DAY) + DAY) % DAY;
  const h = Math.floor(mod / 60);
  const t = `${h % 12 === 0 ? 12 : h % 12}${mod % 60 ? `:${String(mod % 60).padStart(2, '0')}` : ''} ${h >= 12 ? 'PM' : 'AM'}`;
  const rel = dayIdx === todayIdx ? 'today' : dayIdx === todayIdx + 1 ? 'tomorrow' : `in ${dayIdx - todayIdx} days`;
  void day;
  return `${t} ${rel}`;
}

function raiseInterrupt(ctx: SystemContext, d: Dilemma): void {
  const options = d.options.map((o) => ({ label: o.label, actionId: `story:decide:${d.id}:${o.id}` }));
  options.push({ label: 'Think about it', actionId: `story:defer:${d.id}` });
  ctx.interrupt({ kind: 'event', title: d.title, body: `${d.body}\n\nDecide by ${fmtDeadline(ctx, d.deadlineAt)}.`, simId: d.simId, options });
}

function rollDilemma(ctx: SystemContext, sim: Sim): void {
  const state = ctx.state;
  state.dilemmas ||= [];
  if (state.dilemmas.some((d) => d.simId === sim.id && !d.resolved)) return;
  const now = state.time.minute;
  const last = Number(state.flags[`story:lastDilemma:${sim.id}`] ?? -1e9);
  if (now - last < 6 * DAY) return;
  if (now < 2 * DAY) return; // let the first days breathe
  if (!ctx.rng.chance(0.12)) return;
  const pool = TEMPLATES.filter((t) => {
    const lastT = Number(state.flags[`story:last:${t.id}:${sim.id}`] ?? -1e9);
    return now - lastT >= t.cooldownDays * DAY && t.condition(ctx, sim);
  });
  if (!pool.length) return;
  let r = ctx.rng.next() * pool.reduce((s, t) => s + t.weight, 0);
  let t = pool[0];
  for (const x of pool) {
    r -= x.weight;
    if (r <= 0) {
      t = x;
      break;
    }
  }
  if (state.flags['story:llm'] === true) {
    // the model writes it from this life; the store picks the request up and installs the result
    state.flags[`story:request:${sim.id}`] = JSON.stringify({ simId: sim.id, theme: t.id, at: now });
    state.flags[`story:lastDilemma:${sim.id}`] = now;
    ctx.emit({ type: 'custom', kind: 'story:dilemma_request', simId: sim.id, payload: { theme: t.id } });
    return;
  }
  installTemplateDilemma(ctx, sim, t.id);
}

/** Offline catalog: instantiate a template for a sim. */
export function installTemplateDilemma(ctx: SystemContext, sim: Sim, templateId: string): Dilemma | undefined {
  const state = ctx.state;
  const now = state.time.minute;
  const t = TEMPLATES.find((x) => x.id === templateId && x.condition(ctx, sim)) ?? TEMPLATES.find((x) => x.condition(ctx, sim));
  if (!t) return undefined;
  const setup = t.setup(ctx, sim);
  if (!setup) return undefined;
  const d: Dilemma = { id: shortId(ctx.rng, 'dil'), templateId: t.id, simId: sim.id, title: '', body: '', createdAt: now, deadlineAt: now + t.deadlineHours * HOUR, options: [], defaultOptionId: t.defaultOptionId, actors: setup.actors, amounts: setup.amounts, source: 'template' };
  d.title = t.title(ctx, d);
  d.body = t.body(ctx, d);
  d.options = t.options(ctx, d);
  state.dilemmas ||= [];
  state.dilemmas.push(d);
  state.flags[`story:lastDilemma:${sim.id}`] = now;
  state.flags[`story:last:${t.id}:${sim.id}`] = now;
  ctx.log({ text: `${d.title}. ${d.body}`, kind: 'event', simId: sim.id, venueId: sim.location.venueId, importance: 3, meta: { dilemma: d.id } });
  raiseInterrupt(ctx, d);
  ctx.emit({ type: 'custom', kind: 'story:dilemma', simId: sim.id, payload: { id: d.id, templateId: t.id } });
  return d;
}

/** The model wrote one: turn it into state, log it, and raise the interrupt. */
export function installGeneratedDilemma(ctx: SystemContext, sim: Sim, g: GeneratedDilemma, theme: string): Dilemma {
  const state = ctx.state;
  const now = state.time.minute;
  const d: Dilemma = {
    id: shortId(ctx.rng, 'dil'),
    templateId: `llm:${theme}`,
    simId: sim.id,
    title: g.title,
    body: g.body,
    createdAt: now,
    deadlineAt: now + g.deadlineHours * HOUR,
    options: g.options.map((o) => ({ id: o.id, label: o.label, hint: o.hint })),
    defaultOptionId: g.defaultOptionId,
    actors: Object.fromEntries(g.actors.map((id, i) => [`p${i}`, id])),
    amounts: {},
    source: 'llm',
    generated: Object.fromEntries(g.options.map((o) => [o.id, o.consequence])),
  };
  state.dilemmas ||= [];
  state.dilemmas.push(d);
  ctx.log({ text: `${d.title}. ${d.body}`, kind: 'event', simId: sim.id, venueId: sim.location.venueId, importance: 3, meta: { dilemma: d.id } });
  raiseInterrupt(ctx, d);
  ctx.emit({ type: 'custom', kind: 'story:dilemma', simId: sim.id, payload: { id: d.id, templateId: d.templateId } });
  return d;
}

function applyGenerated(ctx: SystemContext, sim: Sim, d: Dilemma, optionId: string): void {
  const c = d.generated?.[optionId];
  if (!c) return;
  if (c.narration) tell(ctx, sim, c.narration, 3);
  ctx.applyEffects(sim.id, c.effects ?? {}, 'story:dilemma');
  for (const [id, b] of Object.entries(c.otherEffects ?? {})) if (ctx.state.sims[id as SimId]) ctx.applyEffects(id as SimId, b, 'story:dilemma:other');
  for (const f of c.flags ?? []) sim.flags[`dilemma:${f}`] = true;
  for (const f of c.followUps ?? []) {
    if (!ctx.rng.chance(f.chance)) continue;
    ctx.schedule({ inMinutes: f.inDays * DAY + ctx.rng.int(8, 20) * HOUR, kind: 'story:followup_gen', label: d.title, simId: sim.id, payload: { dilemmaId: d.id, text: f.text, effects: f.effects ?? {}, otherEffects: f.otherEffects ?? {} } });
  }
}

export function resolveDilemma(ctx: SystemContext, d: Dilemma, optionId: string, byDeadline: boolean): void {
  if (d.resolved) return;
  const t = TEMPLATES.find((x) => x.id === d.templateId);
  const sim = ctx.query.simMaybe(d.simId);
  d.resolved = { optionId, at: ctx.state.time.minute, byDeadline };
  if (!sim || (!t && !d.generated)) return;
  if (byDeadline) ctx.log({ text: `The deadline passes on "${d.title}". Not deciding was a decision.`, kind: 'event', simId: sim.id, importance: 2, meta: { dilemma: d.id } });
  sim.flags[`dilemma:${d.templateId}:${optionId}`] = true;
  if (d.generated) applyGenerated(ctx, sim, d, optionId);
  else t?.resolve(ctx, sim, d, optionId, byDeadline);
  ctx.state.pendingInterrupts = ctx.state.pendingInterrupts.filter((i) => !i.options.some((o) => o.actionId.includes(`:${d.id}`)));
  ctx.emit({ type: 'custom', kind: 'story:decided', simId: sim.id, payload: { id: d.id, templateId: d.templateId, optionId, byDeadline } });
}

function followUp(ctx: SystemContext, sim: Sim, d: Dilemma, key: string): void {
  const f = (k: string) => name(ctx, d.actors[k]);
  switch (`${d.templateId}:${key}`) {
    case 'friend_loan:repay': {
      const r = sim.relationships[d.actors.friend];
      if (ctx.rng.chance(0.6)) {
        money(ctx, sim, d.amounts.amount, `${f('friend')} pays you back`, f('friend'));
        if (r) r.moneyOwed = Math.max(0, r.moneyOwed - d.amounts.amount);
        rel(ctx, sim, d.actors.friend, { trust: 10, friendship: 6 });
        tell(ctx, sim, `${f('friend')} pays you back, all of it, three days early. "Told you."`, 3);
      } else {
        rel(ctx, sim, d.actors.friend, { trust: -12, friendship: -6 });
        if (r) r.grudges.push({ text: `Still owes me ${formatMoney(d.amounts.amount)}`, at: ctx.state.time.minute, weight: 5 });
        tell(ctx, sim, `Three weeks come and go. ${f('friend')} doesn't mention the money, and starts answering texts a little slower.`, 3);
      }
      break;
    }
    case 'friend_loan:declined':
      if (ctx.rng.chance(0.6)) {
        rel(ctx, sim, d.actors.friend, { friendship: 5 });
        tell(ctx, sim, `${f('friend')} texts a meme, out of nowhere. Things are okay again.`, 2);
      } else tell(ctx, sim, `${f('friend')} is still a little formal with you. Give it time, or don't.`, 1);
      break;
    case 'job_offer:settling':
      if (ctx.rng.chance(0.65)) {
        mood(ctx, sim, 'happy', 'The new job is working out', 6, 5);
        tell(ctx, sim, `Two weeks in. The new place is what it said it was. The commute is exactly as long as you feared.`, 2);
      } else {
        mood(ctx, sim, 'anxious', 'Grass wasn’t greener', -6, 5);
        tell(ctx, sim, `Two weeks in. The new boss micromanages. The 15% buys a lot of patience, but not infinite patience.`, 2);
      }
      break;
    case 'parent_health:regret':
      rel(ctx, sim, d.actors.relative, { friendship: -4 });
      tell(ctx, sim, `${f('relative')} is home now, recovered. On the phone they mention who visited. You are not on the list, and they don't say so.`, 2);
      break;
    case 'medical_bill:collections':
      ctx.applyEffects(sim.id, { money: { amount: -Math.round(d.amounts.bill * 0.25), memo: 'Collections fee', category: 'other', counterparty: 'Collections agency' } }, 'story:dilemma');
      ctx.emit({ type: 'custom', kind: 'finance:credit_hit', simId: sim.id, payload: { points: -40, reason: 'medical collections' } });
      tell(ctx, sim, `The bill found a collections agency. They found you. Fees added; your credit takes a hit.`, 3);
      mood(ctx, sim, 'anxious', 'Collections calling', -6, 5);
      break;
    case 'car_trouble:breakdown': {
      const v = ctx.state.vehicles[d.actors.vehicle as never];
      if (!v) break;
      if (ctx.rng.chance(0.55)) {
        v.condition = clamp(v.condition - 30, 0, 100);
        money(ctx, sim, -Math.round(d.amounts.repair * 1.8), 'Tow and repair', 'Auto shop');
        tell(ctx, sim, `The brakes go on a downhill. Nobody is hurt. The tow plus the repair costs almost twice what fixing it would have.`, 3);
        mood(ctx, sim, 'scared', 'Close call', -8, 3);
      } else tell(ctx, sim, `The car keeps going, out of spite. The noise is worse.`, 1);
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------
export const storySystem: System = {
  id: 'story',
  intervalMinutes: 60,
  onInit(ctx) {
    ctx.state.dilemmas ||= [];
    ctx.state.news ||= [];
    ctx.state.feed ||= [];
  },
  onEvent(ctx, e) {
    if (e.type === 'time:day') {
      rollNews(ctx);
      applyNewsMood(ctx);
      for (const sim of ctx.query.controlledSims()) rollDilemma(ctx, sim);
      return;
    }
    if (e.type === 'time:hour') {
      const now = ctx.state.time.minute;
      for (const d of ctx.state.dilemmas ?? []) if (!d.resolved && d.deadlineAt <= now) resolveDilemma(ctx, d, d.defaultOptionId, true);
      return;
    }
    if (e.type === 'scheduled:fired') {
      const ev = e.event;
      const sim = ev.simId ? ctx.query.simMaybe(ev.simId) : undefined;
      if (!sim) return;
      if (ev.kind === 'story:followup') {
        const d = (ctx.state.dilemmas ?? []).find((x) => x.id === ev.payload?.dilemmaId);
        if (d) followUp(ctx, sim, d, String(ev.payload?.key ?? ''));
      }
      if (ev.kind === 'story:followup_gen') {
        const text = String(ev.payload?.text ?? '');
        if (text) ctx.log({ text, kind: 'event', simId: sim.id, venueId: sim.location.venueId, importance: 3, meta: { source: 'story:followup' } });
        ctx.applyEffects(sim.id, (ev.payload?.effects as EffectBundle) ?? {}, 'story:followup');
        for (const [id, b] of Object.entries((ev.payload?.otherEffects as Record<string, EffectBundle>) ?? {})) if (ctx.state.sims[id as SimId]) ctx.applyEffects(id as SimId, b, 'story:followup:other');
      }
      if (ev.kind === 'story:bill_installment') {
        const amount = Number(ev.payload?.amount ?? 0);
        if (amount > 0) ctx.applyEffects(sim.id, { money: { amount: -amount, memo: 'Medical bill installment', category: 'other', counterparty: 'Lab billing' } }, 'story:bill');
      }
    }
  },
  actions(ctx, simId) {
    const out: ActionDef[] = [];
    for (const d of ctx.state.dilemmas ?? []) {
      if (d.simId !== simId || d.resolved) continue;
      out.push({ id: `story:review:${d.id}`, label: `Decide: ${d.title}`, category: 'system', durationMinutes: 0, effects: {}, description: `By ${fmtDeadline(ctx, d.deadlineAt)}`, group: 'Decisions', icon: 'scale-balance', interruptible: true } as ActionDef);
      for (const o of d.options) out.push({ id: `story:decide:${d.id}:${o.id}`, label: `${d.title} → ${o.label}`, category: 'system', durationMinutes: 0, effects: {}, description: o.hint, group: 'Decisions', icon: 'check-decagram-outline', interruptible: true } as ActionDef);
      out.push({ id: `story:defer:${d.id}`, label: `${d.title} → think about it`, category: 'system', durationMinutes: 0, effects: {}, group: 'Decisions', icon: 'clock-outline', interruptible: true } as ActionDef);
    }
    return out;
  },
  handles(actionId) {
    return actionId.startsWith('story:');
  },
  execute(ctx, simId, action): ActionResult {
    const [, verb, dilemmaId, optionId] = action.id.split(':');
    const d = (ctx.state.dilemmas ?? []).find((x) => x.id === dilemmaId);
    if (!d) return { ok: false, text: 'That moment has passed.' };
    if (verb === 'review') {
      raiseInterrupt(ctx, d);
      return { ok: true, text: '', durationMinutes: 0 };
    }
    if (verb === 'defer') {
      ctx.log({ text: `You put off "${d.title}" for now. Decide by ${fmtDeadline(ctx, d.deadlineAt)}.`, kind: 'narrative', simId, importance: 1 });
      return { ok: true, text: '', durationMinutes: 0 };
    }
    if (verb === 'decide' && optionId) {
      if (!d.options.some((o) => o.id === optionId)) return { ok: false, text: 'Not an option.' };
      resolveDilemma(ctx, d, optionId, false);
      return { ok: true, text: '', durationMinutes: 0 };
    }
    return { ok: false, text: 'Unknown story action' };
  },
};

export { TEMPLATES as DILEMMA_TEMPLATES, NEWS as NEWS_TEMPLATES };
export type { EffectBundle };
