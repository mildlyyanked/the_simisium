/**
 * Entertainment system: a rotating weekly catalog of movies, concerts, games and shows at real
 * venues; happy hours, trivia and karaoke nights; streaming and gaming at home; and the
 * bookkeeping behind `entertainment:*` custom effects from objects (gambling, rides, exhibits).
 *
 * Events emitted:  entertainment:event, entertainment:watched, life:event
 * Events consumed: world:new_game, world:loaded, time:week, time:hour, custom (entertainment:*)
 * Action ids:      entertainment:*
 *
 * World flags: `happyHour` (1 during 16–18), `ent:week` (internal seed), `ent:catalog` (JSON).
 * Sim flags: `ent:gamblingLoss` (rolling loss for problem-gambling checks), `ent:lastMovie`.
 */
import type { ActionDef, Sim, Venue, VenueArchetype } from '../core/types';
import type { ActionResult, System, SystemContext } from '../core/systems';
import { RNG } from '../core/rng';
import { clamp, DAY, formatMoney, round2 } from '../core/util';

interface Showing {
  id: string;
  kind: 'movie' | 'concert' | 'game' | 'play' | 'comedy' | 'exhibit';
  title: string;
  sub: string;
  archetypes: VenueArchetype[];
  price: number;
  minutes: number;
  fun: number;
  emotion: 'happy' | 'inspired' | 'energized' | 'scared' | 'nostalgic' | 'playful' | 'sad';
  /** weekday indices it plays */
  days: number[];
  /** minutes since midnight of the start */
  start: number;
}

const MOVIE_TITLES = ['The Long Drive Home', 'Hollow Signal', 'Second Summer', 'Northbound', 'Paper Cranes', 'Wolf Hour', 'The Understudy', 'Quiet Machines', 'Salt & Static', 'Every Other Tuesday', 'The Cartographer', 'Low Tide', 'Neon Choir', 'Borrowed Time', 'Hard Frost', 'The Kestrel Job'];
const MOVIE_GENRES: [string, Showing['emotion']][] = [['thriller', 'energized'], ['comedy', 'happy'], ['drama', 'inspired'], ['horror', 'scared'], ['romance', 'nostalgic'], ['animated', 'playful'], ['documentary', 'inspired'], ['action', 'energized'], ['indie', 'sad']];
const BANDS = ['The Marfa Lights', 'Cassette Motel', 'Hollis & the Tide', 'Dry County', 'Velvet Antenna', 'Sister Radio', 'The Low Fives', 'Junebug Orchestra', 'Paper Thin', 'Night Bus', 'Copperhead Choir', 'Ana Ruiz Trio'];
const COMEDIANS = ['Dee Okafor', 'Marcus Vale', 'Priya Sethi', 'Tommy Ledbetter', 'Jo Marchetti'];
const PLAYS = ['Our Town', 'A Streetcar Named Desire', 'The Glass Menagerie', 'Proof', 'Sweat', 'The Humans', 'Fences', 'A Raisin in the Sun'];
const EXHIBITS = ['Light & Weather: Regional Painters', 'Dinosaurs of the Southwest', 'Photographs from the Interstate', 'Textiles of the Americas', 'The Space Race in Objects'];

function teamFor(regionName: string): { name: string; sport: string } {
  const n = regionName.toLowerCase();
  const table: Record<string, [string, string]> = {
    austin: ['Austin FC', 'soccer'], dallas: ['Dallas Mavericks', 'basketball'], houston: ['Houston Astros', 'baseball'], 'san antonio': ['San Antonio Spurs', 'basketball'], chicago: ['Chicago Bulls', 'basketball'], 'new york': ['New York Knicks', 'basketball'], 'los angeles': ['Los Angeles Dodgers', 'baseball'], seattle: ['Seattle Mariners', 'baseball'], denver: ['Denver Nuggets', 'basketball'], miami: ['Miami Heat', 'basketball'], atlanta: ['Atlanta Braves', 'baseball'], boston: ['Boston Celtics', 'basketball'], phoenix: ['Phoenix Suns', 'basketball'], portland: ['Portland Timbers', 'soccer'], nashville: ['Nashville Predators', 'hockey'], minneapolis: ['Minnesota Twins', 'baseball'], philadelphia: ['Philadelphia Eagles', 'football'], detroit: ['Detroit Lions', 'football'], 'kansas city': ['Kansas City Chiefs', 'football'], 'san francisco': ['San Francisco Giants', 'baseball'], 'san diego': ['San Diego Padres', 'baseball'], 'salt lake city': ['Utah Jazz', 'basketball'], pittsburgh: ['Pittsburgh Penguins', 'hockey'], cleveland: ['Cleveland Guardians', 'baseball'], milwaukee: ['Milwaukee Bucks', 'basketball'], 'new orleans': ['New Orleans Saints', 'football'], 'las vegas': ['Vegas Golden Knights', 'hockey'], charlotte: ['Charlotte Hornets', 'basketball'], tampa: ['Tampa Bay Lightning', 'hockey'], baltimore: ['Baltimore Orioles', 'baseball'], indianapolis: ['Indiana Pacers', 'basketball'], columbus: ['Columbus Crew', 'soccer'], sacramento: ['Sacramento Kings', 'basketball'], orlando: ['Orlando Magic', 'basketball'], raleigh: ['Carolina Hurricanes', 'hockey'], cincinnati: ['Cincinnati Reds', 'baseball'], 'st. louis': ['St. Louis Cardinals', 'baseball'], 'oklahoma city': ['Oklahoma City Thunder', 'basketball'], memphis: ['Memphis Grizzlies', 'basketball'],
  };
  for (const [k, v] of Object.entries(table)) if (n.includes(k)) return { name: v[0], sport: v[1] };
  return { name: `${regionName} FC`, sport: 'soccer' };
}

/** Deterministic weekly catalog from seed + week number. */
export function weeklyCatalog(state: { meta: { seed: string }; region: { name: string } }, week: number): Showing[] {
  const rng = new RNG(`${state.meta.seed}:ent:${week}`);
  const out: Showing[] = [];
  for (let i = 0; i < 6; i++) {
    const [genre, emotion] = rng.pick(MOVIE_GENRES);
    out.push({ id: `m${week}_${i}`, kind: 'movie', title: rng.pick(MOVIE_TITLES), sub: `${genre} · ${rng.int(88, 152)} min`, archetypes: ['cinema'], price: 16, minutes: 130, fun: 34, emotion, days: [0, 1, 2, 3, 4, 5, 6], start: rng.pick([13 * 60, 16 * 60 + 30, 19 * 60 + 15, 21 * 60 + 45]) });
  }
  for (let i = 0; i < 3; i++) {
    out.push({ id: `c${week}_${i}`, kind: 'concert', title: rng.pick(BANDS), sub: rng.pick(['indie rock', 'country', 'hip-hop', 'jazz', 'folk', 'electronic', 'punk']), archetypes: i === 0 ? ['concert_hall', 'stadium', 'arena'] : ['bar', 'concert_hall'], price: i === 0 ? rng.int(55, 180) : rng.int(15, 35), minutes: 170, fun: 44, emotion: 'energized', days: [rng.pick([4, 5, 6])], start: 20 * 60 });
  }
  const team = teamFor(state.region.name);
  for (let i = 0; i < 2; i++) out.push({ id: `g${week}_${i}`, kind: 'game', title: `${team.name} vs. ${rng.pick(['the Rivals', 'Portland', 'Denver', 'Chicago', 'Miami', 'Seattle', 'Houston'])}`, sub: team.sport, archetypes: ['stadium', 'arena'], price: rng.int(38, 220), minutes: 200, fun: 42, emotion: 'energized', days: [rng.pick([2, 5, 6, 0])], start: rng.pick([13 * 60, 19 * 60]) });
  out.push({ id: `p${week}`, kind: 'play', title: rng.pick(PLAYS), sub: 'community theater', archetypes: ['theater'], price: 42, minutes: 150, fun: 38, emotion: 'inspired', days: [4, 5, 6, 0], start: 19 * 60 + 30 });
  out.push({ id: `k${week}`, kind: 'comedy', title: `${rng.pick(COMEDIANS)} — stand-up`, sub: 'comedy night', archetypes: ['bar', 'theater'], price: 22, minutes: 100, fun: 36, emotion: 'happy', days: [3, 6], start: 20 * 60 });
  out.push({ id: `x${week}`, kind: 'exhibit', title: rng.pick(EXHIBITS), sub: 'special exhibit', archetypes: ['museum'], price: 12, minutes: 70, fun: 26, emotion: 'inspired', days: [1, 2, 3, 4, 5, 6], start: 10 * 60 });
  return out;
}

function catalogFor(ctx: SystemContext): Showing[] {
  const week = Math.floor(ctx.state.time.minute / (7 * DAY));
  return weeklyCatalog(ctx.state, week);
}

function venuesFor(ctx: SystemContext, archetypes: VenueArchetype[]): Venue[] {
  return archetypes.flatMap((a) => ctx.query.venuesByArchetype(a)).filter((v) => v.discovered);
}

export const entertainmentSystem: System = {
  id: 'entertainment',
  intervalMinutes: 60,

  onInit(ctx) {
    ctx.state.flags['ent:week'] = Math.floor(ctx.state.time.minute / (7 * DAY));
  },

  onTick(ctx) {
    const h = ctx.clock.hour;
    ctx.state.flags.happyHour = h >= 16 && h < 18 ? 1 : 0;
  },

  onEvent(ctx, e) {
    if (e.type === 'time:week' || e.type === 'world:new_game') {
      const catalog = catalogFor(ctx);
      // schedule visible events for the week so the calendar shows them
      for (const s of catalog) {
        if (s.kind === 'movie' || s.kind === 'exhibit') continue;
        const venue = venuesFor(ctx, s.archetypes)[0] ?? ctx.query.venuesByArchetype(s.archetypes[0])[0];
        if (!venue) continue;
        for (const d of s.days) {
          const dayOffset = (d - ctx.clock.weekday + 7) % 7;
          const at = ctx.state.time.minute - ctx.clock.minuteOfDay + dayOffset * DAY + s.start;
          if (at < ctx.state.time.minute) continue;
          ctx.schedule({ atMinute: at, kind: 'festival', label: `${s.title} @ ${venue.name}`, venueId: venue.id, payload: { entertainment: s.id, kind: s.kind } });
          ctx.emit({ type: 'entertainment:event', venueId: venue.id, kind: s.kind, label: s.title, at });
        }
      }
      if (e.type === 'time:week') {
        const picks = catalog.filter((s) => s.kind !== 'movie').slice(0, 3).map((s) => s.title).join(', ');
        for (const sim of ctx.query.controlledSims()) ctx.log({ text: `This week around town: ${picks}. New at the movies: ${catalog.find((s) => s.kind === 'movie')?.title}.`, kind: 'event', simId: sim.id, importance: 1 });
      }
      return;
    }
    if (e.type === 'custom' && e.simId) {
      const sim = ctx.query.simMaybe(e.simId);
      if (!sim) return;
      const p = e.payload ?? {};
      switch (e.kind) {
        case 'entertainment:watch':
          ctx.emit({ type: 'entertainment:watched', simId: sim.id, title: String(p.title ?? p.channel ?? 'something'), kind: String(p.channel ?? 'tv') });
          if (p.channel === 'news') sim.flags['ent:newsAware'] = ctx.state.time.minute;
          break;
        case 'entertainment:gamble': {
          const net = Number(p.net ?? 0);
          const loss = Number(sim.flags['ent:gamblingLoss'] ?? 0);
          sim.flags['ent:gamblingLoss'] = round2(Math.max(0, loss - net));
          ctx.emit({ type: 'custom', kind: 'health:gambled', simId: sim.id, payload: { amount: Math.abs(net), lost: net < 0 } });
          if (Number(sim.flags['ent:gamblingLoss']) > 800 && ctx.query.isControlled(sim.id)) {
            ctx.log({ text: `You are down ${formatMoney(Number(sim.flags['ent:gamblingLoss']))} lately. The machines don't care.`, kind: 'alert', simId: sim.id, importance: 2 });
          }
          break;
        }
        case 'entertainment:game': {
          const minutes = Number(p.minutes ?? 60);
          if (minutes >= 180 && ctx.clock.hour >= 1 && ctx.clock.hour < 5) ctx.applyEffects(sim.id, { moodlets: [{ emotion: 'tired', label: 'Gamed till 3 AM', intensity: -6, durationMinutes: 600 }] }, 'ent:game');
          break;
        }
        case 'entertainment:karaoke':
        case 'entertainment:dance':
        case 'entertainment:dj':
          ctx.emit({ type: 'life:event', simId: sim.id, kind: e.kind.split(':')[1], label: 'Performed in public' });
          if (ctx.rng.chance(0.15)) ctx.applyEffects(sim.id, { relationships: ctx.query.simsAt(sim.location.venueId).filter((s) => s.id !== sim.id).slice(0, 3).map((s) => ({ simId: s.id, friendship: 3, familiarity: 3, mutual: true })) }, 'ent:perform');
          break;
        case 'entertainment:ride':
        case 'entertainment:exhibit':
        case 'entertainment:ticket':
        default:
          break;
      }
    }
  },

  actions(ctx, simId) {
    const sim = ctx.query.sim(simId);
    const venue = ctx.query.venueMaybe(sim.location.venueId);
    if (!venue) return [];
    const out: ActionDef[] = [];
    const catalog = catalogFor(ctx);
    const wd = ctx.clock.weekday;
    const mod = ctx.clock.minuteOfDay;
    for (const s of catalog) {
      if (!s.archetypes.includes(venue.archetype)) continue;
      if (!s.days.includes(wd)) continue;
      const startsSoon = s.kind === 'movie' || s.kind === 'exhibit' ? true : Math.abs(mod - s.start) <= 90;
      if (!startsSoon) continue;
      const price = round2(s.price * venue.priceMultiplier);
      out.push({
        id: `entertainment:show:${s.id}`,
        label: s.kind === 'movie' ? `See "${s.title}"` : s.kind === 'game' ? `Watch ${s.title}` : s.kind === 'exhibit' ? `See "${s.title}"` : `See ${s.title}`,
        description: s.sub,
        category: 'entertainment',
        icon: s.kind === 'movie' ? '🎬' : s.kind === 'concert' ? '🎤' : s.kind === 'game' ? '🏟️' : s.kind === 'play' ? '🎭' : s.kind === 'comedy' ? '😂' : '🖼️',
        durationMinutes: s.minutes,
        cost: { amount: price, memo: `${s.title} ticket`, category: 'entertainment', counterparty: venue.name },
        effects: { needs: { fun: s.fun, social: 12, bladder: -15 }, stress: -18, moodlets: [{ emotion: s.emotion, label: s.kind === 'movie' ? `Saw ${s.title}` : s.title, intensity: 9, durationMinutes: 600 }], custom: [{ kind: 'entertainment:watch', payload: { channel: s.kind, title: s.title } }] },
        llm: 'narrate',
        satisfies: ['fun'],
        autonomyWeight: 0.35,
        group: "What's on",
        params: { showId: s.id },
      });
    }
    // home streaming / gaming extras
    if (venue.archetype === 'home') {
      const hasTv = ctx.query.objectsAt(venue.id).some((o) => o.defId === 'tv' || o.defId === 'tv_big');
      if (hasTv) out.push({ id: 'entertainment:binge', label: 'Binge a series', category: 'entertainment', icon: '📺', durationMinutes: 180, effects: { perMinute: { fun: 0.3, comfort: 0.15, energy: -0.02 }, stress: -12, custom: [{ kind: 'entertainment:watch', payload: { channel: 'streaming', title: 'a series' } }] }, satisfies: ['fun'], autonomyWeight: 0.5, group: 'Screens' });
      out.push({ id: 'entertainment:podcast', label: 'Put on a podcast', category: 'entertainment', icon: '🎧', durationMinutes: 45, effects: { needs: { fun: 12 }, skills: { research: 8 }, stress: -6 }, autonomyWeight: 0.25, group: 'Screens' });
    }
    if (venue.archetype === 'bar' && ctx.clock.weekday === 4 && mod >= 20 * 60) {
      out.push({ id: 'entertainment:karaoke_night', label: 'Sing karaoke', category: 'entertainment', icon: '🎤', durationMinutes: 40, effects: { needs: { fun: 30, social: 26 }, skills: { singing: 30 }, custom: [{ kind: 'entertainment:karaoke', payload: {} }] }, outcomes: { outcomes: [{ weight: 5, label: 'Brought the house down', effects: { moodlets: [{ emotion: 'proud', label: 'Karaoke legend', intensity: 12, durationMinutes: 720 }] }, skillId: 'singing', skillBias: 2 }, { weight: 4, label: 'Survived it', effects: {} }, { weight: 2, label: 'Forgot the second verse', effects: { moodlets: [{ emotion: 'embarrassed', label: 'Karaoke disaster', intensity: -6, durationMinutes: 300 }] } }] }, llm: 'narrate', autonomyWeight: 0.2, group: 'Bar' });
    }
    return out;
  },

  handles(actionId) {
    return actionId.startsWith('entertainment:');
  },

  execute(ctx, simId, action): ActionResult {
    const sim = ctx.query.sim(simId);
    if (action.id.startsWith('entertainment:show:')) {
      sim.flags['ent:lastMovie'] = ctx.state.time.minute;
      const others = ctx.query.simsAt(sim.location.venueId).filter((s) => s.id !== simId && sim.relationships[s.id]);
      const effects = others.length ? { relationships: others.slice(0, 2).map((o) => ({ simId: o.id, friendship: 4, familiarity: 2, mutual: true })) } : undefined;
      return { ok: true, effects, text: others.length ? `You go in with ${others[0].identity.firstName}.` : undefined };
    }
    return { ok: true };
  },
};

export function gamblingRoll(rng: RNG, bet: number, skill = 0): number {
  const edge = clamp(0.06 - skill * 0.006, 0.01, 0.1);
  return rng.chance(0.5 - edge) ? bet : -bet;
}
