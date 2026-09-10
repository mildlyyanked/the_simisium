/**
 * Flavor narration for deterministic actions (no effects), and venue descriptions from Google data.
 */
import type { ActionDef, Venue, WorldState } from '../../core/types';
import type { SceneContext } from '../context';

export function system(): string {
  return `You narrate moments in The Simisium, a realistic life simulation of present-day America. The outcome has already been decided by the game; you only make it vivid.
Rules: second person, present tense ("You…"). One or two sentences, at most 45 words. Concrete sensory detail that fits the time of day, weather, venue, the character's mood and needs, and the outcome label. No consequences beyond the outcome given, no new facts about people, no dialogue unless an NPC's brief reaction is natural, no meta-commentary. Plain text only, no quotes or JSON.`;
}

export function user(ctx: SceneContext, action: ActionDef, outcomeLabel?: string): string {
  const w = ctx.world;
  const v = ctx.venue;
  const a = ctx.actor;
  const lines = [
    `When: ${w.dateLabel}, ${w.timeLabel} (${w.partOfDay}); ${w.weather}${w.holidays.length ? `; ${w.holidays.join(', ')}` : ''}`,
    `Where: ${v.name} (${v.archetype}${v.isHome ? ', home' : ''}); ${v.crowd}${v.ambience ? `; ${v.ambience}` : ''}`,
    `Who: ${a.name}, ${a.age}; mood ${a.mood}${a.needs.length ? `; needs: ${a.needs.join(', ')}` : ''}${a.state.length ? `; ${a.state.join(', ')}` : ''}`,
    ctx.npcs.length ? `Also here: ${ctx.npcs.map((n) => `${n.firstName}${n.role ? ` (${n.role})` : ''}`).join(', ')}` : undefined,
    `Action: ${action.label}${action.target?.name ? ` (${action.target.name})` : ''}${action.description ? ` — ${action.description}` : ''}`,
    `Outcome: ${outcomeLabel ?? 'completed normally'}`,
  ].filter(Boolean);
  return `${lines.join('\n')}\n\nNarrate it.`;
}

export function venueSystem(): string {
  return `You write short place descriptions for The Simisium, a realistic life simulation set in present-day America. You are given real data about a real kind of place (name, type, rating, price, reviews). Write 2–3 sentences, at most 70 words, second person present tense, describing what it is like to walk in right now: the layout, light, sound, smell, the kind of people, the vibe the reviews suggest. Use the data, don't recite it (never say "4.3 stars" or "reviews mention"). No invented staff names, no prices in numbers, no meta-commentary. Plain text only.`;
}

export function venueUser(state: WorldState, venue: Venue, archetypeHint?: string): string {
  const g = venue.google;
  const lines = [
    `Name: ${venue.name}`,
    `Kind: ${venue.archetype.replace(/_/g, ' ')}${g?.primaryType ? ` (${g.primaryType.replace(/_/g, ' ')})` : ''}`,
    g?.formattedAddress ? `Address: ${g.formattedAddress}` : venue.address ? `Address: ${venue.address}` : undefined,
    `City: ${state.region.name}, ${state.region.state}; ${state.region.culture}`,
    g?.rating !== undefined ? `Rating: ${g.rating.toFixed(1)} from ${g.userRatingCount ?? 'some'} reviews` : undefined,
    g?.priceLevel !== undefined ? `Price level: ${'$'.repeat(Math.max(1, g.priceLevel))}` : undefined,
    g?.editorialSummary ? `Editorial summary: ${g.editorialSummary}` : undefined,
    g?.reviewThemes?.length ? `Review themes: ${g.reviewThemes.join(', ')}` : undefined,
    ...(g?.reviewSnippets ?? []).slice(0, 3).map((s) => `Review: "${s}"`),
    archetypeHint ? `Typical ambience: ${archetypeHint}` : undefined,
    `Condition: cleanliness ${Math.round(venue.cleanliness)}/100, safety ${Math.round(venue.safety)}/100`,
  ].filter(Boolean);
  return `${lines.join('\n')}\n\nDescribe walking in.`;
}
