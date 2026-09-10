/**
 * System registry — order matters (tick order).
 * Calendar and weather first so everyone sees today's date and sky; needs before health;
 * money before property/amenities (bills); career before education; social systems after
 * the world has moved; NPC autonomy near the end; life events last so they react to everything.
 */
import type { System } from '../core/systems';
import { calendarSystem } from './calendar';
import { weatherSystem } from './weather';
import { needsSystem } from './needs';
import { healthSystem } from './health';
import { skillsSystem } from './skills';
import { financeSystem } from './finance';
import { propertySystem } from './property';
import { amenitiesSystem } from './amenities';
import { transportSystem } from './transport';
import { shoppingSystem } from './shopping';
import { careerSystem } from './career';
import { educationSystem } from './education';
import { relationshipsSystem } from './relationships';
import { familySystem } from './family';
import { petsSystem } from './pets';
import { lawSystem } from './law';
import { civicSystem } from './civic';
import { entertainmentSystem } from './entertainment';
import { communicationSystem } from './communication';
import { npcAISystem } from './npcAI';
import { lifeEventsSystem } from './lifeEvents';

export const SYSTEMS: System[] = [
  calendarSystem,
  weatherSystem,
  needsSystem,
  healthSystem,
  skillsSystem,
  financeSystem,
  propertySystem,
  amenitiesSystem,
  transportSystem,
  shoppingSystem,
  careerSystem,
  educationSystem,
  relationshipsSystem,
  familySystem,
  petsSystem,
  lawSystem,
  civicSystem,
  entertainmentSystem,
  communicationSystem,
  npcAISystem,
  lifeEventsSystem,
];

export { holidayResolver } from './calendar';
