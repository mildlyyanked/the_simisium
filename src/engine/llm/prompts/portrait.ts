/**
 * Portrait prompt: a realistic, candid photo of a sim built only from facts the game already holds,
 * so the same person always gets the same face description.
 */
import type { Sim, WorldState } from '../../core/types';

function ageOf(state: WorldState, sim: Sim): number {
  const birth = new Date(sim.identity.birthDate).getTime();
  const nowMs = new Date(state.epoch).getTime() + state.time.minute * 60_000;
  return Math.max(0, Math.floor((nowMs - birth) / (365.25 * 24 * 3600 * 1000)));
}

export function portraitPrompt(state: WorldState, sim: Sim): string {
  const a = sim.identity.appearance;
  const age = ageOf(state, sim);
  const gender = sim.identity.gender === 'male' ? 'man' : sim.identity.gender === 'female' ? 'woman' : 'person';
  const who = age < 13 ? (sim.identity.gender === 'male' ? 'boy' : sim.identity.gender === 'female' ? 'girl' : 'child') : age < 20 ? `teenage ${gender}` : gender;
  const heritage = sim.identity.heritage ? `of ${sim.identity.heritage} heritage` : '';
  const where = state.venues[sim.location.venueId];
  const setting = where?.archetype === 'home' || where?.archetype === 'apartment_building' ? 'at home, in a lived-in apartment' : where ? `at ${where.name.replace(/#\d+$/, '').trim()}, a ${where.archetype.replace(/_/g, ' ')}` : `in ${state.region.name}`;
  const mood = sim.mind.mood > 25 ? 'a relaxed half-smile' : sim.mind.mood < -25 ? 'a tired, guarded expression' : 'a neutral, natural expression';
  const details = a.distinguishing.length ? `${a.distinguishing.join('; ')}.` : '';
  return [
    `Photorealistic candid photograph, head and shoulders, of a ${age}-year-old ${who} ${heritage}.`,
    `Hair: ${a.hair}. Eyes: ${a.eyes}. Build: ${a.build}. Wearing ${a.style}. ${details}`,
    `${mood}, looking slightly off camera. Setting: ${setting}, present-day United States, ${state.region.name}.`,
    'Natural light, 35mm lens, shallow depth of field, realistic skin texture, documentary style. No text, no watermark, no logo, not a painting, not a cartoon.',
  ]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
