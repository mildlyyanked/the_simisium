/**
 * Deterministic intent routing for freeform text. Ordinary world interactions ("go to work",
 * "take a shower", "make breakfast", "wait an hour", "drive to the gym") map onto the
 * simulation's own actions, so they behave the same every time and never need a model.
 * Only speech and genuinely open-ended attempts fall through to the LLM adjudicator.
 */
import type { ActionAvailability } from './actions';
import type { ActionDef, Sim, SimId, VenueId, WorldState } from './types';
import { minuteOfDay, weekdayAt } from './clock';

export interface ResolvedIntent {
  actionId: string;
  params?: Record<string, unknown>;
  /** what the player will see they did */
  label: string;
  /** why this was picked (for the log / debugging) */
  via: 'work' | 'home' | 'travel' | 'wait' | 'object' | 'phone' | 'match';
  /** minutes to wait (wait intents) */
  waitMinutes?: number;
}

export interface QuickAction {
  label: string;
  icon: string;
  actionId?: string;
  params?: Record<string, unknown>;
  waitMinutes?: number;
  /** free text to run through the router instead (e.g. "Go to work") */
  text?: string;
}

const STOP = new Set(['the', 'a', 'an', 'to', 'my', 'me', 'i', 'and', 'of', 'in', 'on', 'at', 'for', 'some', 'go', 'get', 'try', 'then', 'now', 'please', 'want', 'wanna', 'gonna', 'lets', "let's", 'just', 'up', 'out', 'it', 'this', 'that', 'with', 'into', 'onto']);
const SPEECH = /^(hi|hey|hello|yo|sup|howdy|excuse me|good (morning|afternoon|evening))\b|^".*"$|^(ask|tell|say|talk|chat|flirt|compliment|apologi[sz]e|thank|greet|introduce|argue|confront|call out|yell|whisper|joke)\b|\?$/i;
const MODE_WORDS: [RegExp, string][] = [
  [/\b(drive|driving|take (the|my) car|by car)\b/, 'drive'],
  [/\b(walk|walking|on foot|stroll)\b/, 'walk'],
  [/\b(bike|cycle|bicycle|ride my bike)\b/, 'bike'],
  [/\b(bus|train|transit|subway|metro|light rail)\b/, 'transit'],
  [/\b(uber|lyft|rideshare|ride share|cab|taxi)\b/, 'rideshare'],
  [/\b(scooter)\b/, 'scooter'],
];
const VERB_ALIASES: [RegExp, string][] = [
  [/\b(shower|wash up|bathe|clean up|freshen up|rinse off)\b/, 'shower'],
  [/\b(pee|piss|bathroom|restroom|toilet|use the john)\b/, 'toilet'],
  [/\b(brush (my )?teeth)\b/, 'brush teeth'],
  [/\b(sleep|go to bed|bed time|bedtime|turn in|crash|hit the hay|lie down|lay down|nap|snooze|rest my eyes)\b/, 'sleep'],
  [/\b(eat|breakfast|lunch|dinner|supper|snack|meal|food|hungry|cook|make (something|some food|a meal|breakfast|lunch|dinner)|fix (something|a plate|food))\b/, 'eat'],
  [/\b(drink|water|thirsty|hydrate)\b/, 'drink water'],
  [/\b(coffee|caffeine|espresso|latte)\b/, 'coffee'],
  [/\b(tv|television|netflix|show|movie|watch something)\b/, 'watch tv'],
  [/\b(read|book|novel)\b/, 'read'],
  [/\b(work ?out|exercise|lift|gym session|run on the treadmill|treadmill|cardio|weights|push-?ups|stretch|yoga)\b/, 'exercise'],
  [/\b(laundry|wash (my )?clothes)\b/, 'laundry'],
  [/\b(dishes|wash up the dishes|clean the kitchen|tidy|clean up the (apartment|house|room|place)|vacuum|sweep|mop|take out the trash)\b/, 'clean'],
  [/\b(phone|scroll|doom ?scroll|social media|instagram|tiktok|check my messages|texts)\b/, 'phone'],
  [/\b(game|gaming|play (video )?games|console|xbox|playstation|switch)\b/, 'play games'],
  [/\b(music|play guitar|piano|practice (guitar|piano|singing))\b/, 'music'],
  [/\b(study|homework|do my homework|revise)\b/, 'study'],
];

const NEED_OF_ALIAS: Record<string, string> = { eat: 'hunger', 'drink water': 'thirst', coffee: 'thirst', sleep: 'energy', shower: 'hygiene', toilet: 'bladder' };

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));
}

function overlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const bs = new Set(b);
  let hit = 0;
  for (const w of a) if (bs.has(w) || [...bs].some((x) => x.length > 3 && (x.startsWith(w) || w.startsWith(x)))) hit++;
  return hit / a.length;
}

export function looksLikeSpeech(text: string, present: Sim[]): boolean {
  const t = text.trim();
  if (SPEECH.test(t)) return true;
  const lower = t.toLowerCase();
  return present.some((p) => lower.includes(p.identity.firstName.toLowerCase()) && !/\b(walk|go|head) (over )?to\b/.test(lower));
}

function travelActionFor(actions: ActionAvailability[], venueId: VenueId, mode?: string): ActionAvailability | undefined {
  const list = actions.filter((a) => a.available && a.action.id.startsWith(`travel:${venueId}:`));
  if (!list.length) return undefined;
  if (mode) {
    const m = list.find((a) => a.action.id.endsWith(`:${mode}`));
    if (m) return m;
  }
  // best default: shortest time, then cheapest
  return [...list].sort((a, b) => a.action.durationMinutes - b.action.durationMinutes || (a.action.cost?.amount ?? 0) - (b.action.cost?.amount ?? 0))[0];
}

function venueByName(state: WorldState, text: string): VenueId | undefined {
  const lower = text.toLowerCase();
  let best: { id: VenueId; score: number } | undefined;
  for (const v of Object.values(state.venues)) {
    if (!v.discovered && v.archetype !== 'home') continue;
    const name = v.name.toLowerCase();
    let score = 0;
    if (lower.includes(name)) score = name.length + 10;
    else {
      const vt = tokens(name);
      const tt = tokens(lower);
      const o = overlap(vt, tt);
      if (o >= 0.6 && vt.length) score = o * 8 + vt.length;
    }
    // archetype words ("the gym", "a grocery store", "the park")
    const arch = v.archetype.replace(/_/g, ' ');
    if (new RegExp(`\\b(${arch}|${arch.split(' ')[0]})\\b`).test(lower)) score = Math.max(score, 3 + (v.discovered ? 1 : 0));
    if (score > 0 && (!best || score > best.score)) best = { id: v.id, score };
  }
  return best?.id;
}

/** Try to turn player text into one deterministic action. */
export function resolveIntent(state: WorldState, sim: Sim, actions: ActionAvailability[], text: string, present: Sim[]): ResolvedIntent | undefined {
  const raw = text.trim();
  const lower = raw.toLowerCase();
  if (!raw || looksLikeSpeech(raw, present)) return undefined;
  const here = sim.location.venueId;
  const mode = MODE_WORDS.find(([re]) => re.test(lower))?.[1];

  // wait / pass time
  const w = /^(wait|pass time|kill time|hang (?:around|out)|chill|sit around|do nothing|idle)\b(?:.*?(\d+)\s*(min|minute|minutes|hr|hrs|hour|hours))?/i.exec(raw);
  if (w) {
    const n = w[2] ? Number(w[2]) : 30;
    const minutes = Math.max(5, Math.min(720, /h/.test(w[3] ?? '') ? n * 60 : n));
    return { actionId: 'system:wait', label: `Wait ${minutes} minutes`, via: 'wait', waitMinutes: minutes };
  }
  if (/\b(sleep|go to bed)\b.*\b(until|till) (morning|tomorrow)\b|\bsleep (the night|through)\b/.test(lower)) {
    const bed = actions.find((a) => a.available && /\bsleep\b/i.test(a.action.label) && a.action.target?.kind === 'object');
    if (bed) return { actionId: bed.action.id, label: bed.action.label, via: 'object' };
  }

  // work
  if (/\b(work|shift|clock in|the office|my job)\b/.test(lower) && /\b(go|get|head|drive|walk|bike|take|leave for|off to|to)\b/.test(lower)) {
    const job = sim.career.job;
    if (!job) return { actionId: 'system:noop', label: 'You don’t have a job to go to.', via: 'work' };
    const target = job.employerVenueId;
    if (!target) return { actionId: 'system:noop', label: 'Your job has no workplace to go to.', via: 'work' };
    if (target === here) {
      const work = actions.find((a) => a.available && a.action.id === 'career:work_shift') ?? actions.find((a) => a.available && a.action.id.startsWith('career:work'));
      if (work) return { actionId: work.action.id, label: work.action.label, via: 'work' };
      return { actionId: 'system:noop', label: `You’re already at ${state.venues[target]?.name ?? 'work'}. Your shift will start on its own.`, via: 'work' };
    }
    const t = travelActionFor(actions, target, mode);
    if (t) return { actionId: t.action.id, params: t.action.params, label: t.action.label, via: 'work' };
    return { actionId: 'system:noop', label: `No way to get to ${state.venues[target]?.name ?? 'work'} right now.`, via: 'work' };
  }

  // home
  if (/\b(go|head|get|drive|walk|bike|take .* )?\b(home|back to my place|to my (apartment|house|room))\b/.test(lower) && /\b(go|head|get|back|drive|walk|bike|return|leave)\b/.test(lower)) {
    const hh = sim.householdId ? state.households[sim.householdId] : undefined;
    const homeId = hh?.homeVenueId;
    if (!homeId) return undefined;
    if (homeId === here) return { actionId: 'system:noop', label: 'You’re already home.', via: 'home' };
    const t = travelActionFor(actions, homeId, mode);
    if (t) return { actionId: t.action.id, params: t.action.params, label: t.action.label, via: 'home' };
    return undefined;
  }

  // travel to a named or typed place
  if (/\b(go|head|walk|drive|bike|ride|take (the|a) (bus|train|cab|uber|lyft)|get|swing by|stop by|run|pop) (over |out |down |up |back )?(to|by)\b/.test(lower) || /^(to|visit) the\b/.test(lower)) {
    const vid = venueByName(state, lower);
    if (vid && vid !== here) {
      const t = travelActionFor(actions, vid, mode);
      if (t) return { actionId: t.action.id, params: t.action.params, label: t.action.label, via: 'travel' };
    }
  }

  // objects and routines: alias the verb, then find the best matching available action here
  const alias = VERB_ALIASES.find(([re]) => re.test(lower))?.[1];
  const wanted = tokens(alias ? `${alias} ${lower}` : lower);
  let best: { a: ActionAvailability; score: number } | undefined;
  for (const a of actions) {
    if (!a.available) continue;
    const def: ActionDef = a.action;
    if (def.llm === 'adjudicate' || def.id.startsWith('travel:') || def.id.startsWith('legal:') || def.category === 'romance') continue;
    const labelTokens = tokens(`${def.label} ${def.target?.name ?? ''} ${def.group ?? ''}`);
    let score = overlap(wanted, labelTokens) * 0.7 + overlap(labelTokens, wanted) * 0.3;
    if (alias) {
      const al = tokens(alias);
      if (overlap(al, labelTokens) >= 0.99) score += 0.35;
      // aliases pick the canonical routine over exotic variants ("Take a shower" over "Take a cold shower")
      if (labelTokens.length <= al.length + 2) score += 0.05;
    }
    const need = alias ? NEED_OF_ALIAS[alias] : undefined;
    if (need && def.satisfies?.includes(need as never)) {
      // any action that meets the need qualifies; text overlap and a proper meal break ties
      let s2 = 0.66 + overlap(wanted, labelTokens) * 0.3;
      if (alias === 'eat' && /\b(make|cook|meal|breakfast|lunch|dinner)\b/i.test(def.label)) s2 += 0.08;
      if (alias === 'eat' && /\b(stand|graze)\b/i.test(def.label)) s2 -= 0.2;
      if (alias === 'sleep' && /^sleep$/i.test(def.label)) s2 += 0.1;
      if (alias === 'sleep' && /\bcouch\b/i.test(def.label)) s2 -= 0.05;
      if (alias === 'shower' && /^take a shower$/i.test(def.label)) s2 += 0.1;
      if (alias === 'toilet' && /^use the toilet$/i.test(def.label)) s2 += 0.1;
      if (alias === 'drink water' && /\bwater\b/i.test(def.label)) s2 += 0.1;
      if (alias === 'coffee' && /\bcoffee\b/i.test(def.label)) s2 += 0.2;
      score = Math.max(score, s2);
    }
    if (score > (best?.score ?? 0)) best = { a, score };
  }
  if (best && best.score >= 0.62) return { actionId: best.a.action.id, params: best.a.action.params, label: best.a.action.label, via: alias ? 'object' : 'match' };
  return undefined;
}

/** Contextual one-tap actions for the composer: what a person would plausibly do next. */
export function quickActions(state: WorldState, sim: Sim, actions: ActionAvailability[]): QuickAction[] {
  const out: QuickAction[] = [];
  const now = state.time.minute;
  const mod = minuteOfDay(now);
  const day = weekdayAt(state.epoch, now);
  const here = sim.location.venueId;
  const job = sim.career.job;
  const avail = (pred: (a: ActionDef) => boolean): ActionDef | undefined => actions.find((a) => a.available && pred(a.action))?.action;

  if (job?.employerVenueId && job.shifts.length) {
    const today = job.shifts.find((s) => s.day === day);
    const soon = today && mod >= today.start - 120 && mod < today.end - 30;
    const atWork = here === job.employerVenueId;
    if (soon && !atWork && !sim.travel) {
      const t = travelActionFor(actions, job.employerVenueId);
      if (t) out.push({ label: `Go to work · ${fmt(today!.start)}`, icon: 'briefcase', actionId: t.action.id, params: t.action.params });
    } else if (soon && atWork && !sim.currentAction) {
      const work = avail((a) => a.id === 'career:work_shift');
      if (work) out.push({ label: 'Start your shift', icon: 'briefcase', actionId: work.id });
    }
  }
  if (sim.needs.hunger < 45) {
    const eat = avail((a) => a.category === 'needs' && /\b(eat|cook|make|snack|order)\b/i.test(a.label) && !/\bdrink\b/i.test(a.label));
    if (eat) out.push({ label: eat.label, icon: 'silverware-fork-knife', actionId: eat.id, params: eat.params });
  }
  if (sim.needs.energy < 35 || (mod >= 22 * 60 || mod < 5 * 60)) {
    const bed = avail((a) => /\bsleep\b/i.test(a.label) && a.target?.kind === 'object');
    if (bed) out.push({ label: bed.label, icon: 'bed', actionId: bed.id, params: bed.params });
  }
  if (sim.needs.hygiene < 45) {
    const sh = avail((a) => /^take a shower$/i.test(a.label) || /\bshower\b/i.test(a.label));
    if (sh) out.push({ label: sh.label, icon: 'shower', actionId: sh.id, params: sh.params });
  }
  if (sim.needs.bladder < 35) {
    const t = avail((a) => /^use the toilet$/i.test(a.label) || /\btoilet\b/i.test(a.label));
    if (t) out.push({ label: t.label, icon: 'toilet', actionId: t.id, params: t.params });
  }
  const hh = sim.householdId ? state.households[sim.householdId] : undefined;
  if (hh && hh.homeVenueId !== here && !sim.travel && (mod >= 20 * 60 || sim.needs.energy < 30)) {
    const t = travelActionFor(actions, hh.homeVenueId);
    if (t) out.push({ label: 'Go home', icon: 'home', actionId: t.action.id, params: t.action.params });
  }
  if (!out.length) {
    out.push({ label: 'Look around', icon: 'eye-outline', text: 'Look around' });
    out.push({ label: 'Wait 30 min', icon: 'timer-sand', waitMinutes: 30 });
  }
  return out.slice(0, 4);
}

function fmt(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hh}:${String(m).padStart(2, '0')} ${ampm}` : `${hh} ${ampm}`;
}

export type { SimId };
