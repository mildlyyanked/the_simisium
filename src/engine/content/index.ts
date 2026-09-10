/**
 * Assembles the static content catalog. Each data file owns one slice.
 */
import type { ContentCatalog } from './types';
import { OBJECTS } from './objects';
import { ITEMS } from './items';
import { RECIPES } from './recipes';
import { SKILLS } from './skills';
import { HOBBIES } from './hobbies';
import { TRAITS } from './traits';
import { CAREERS } from './careers';
import { PROGRAMS } from './programs';
import { ILLNESSES } from './illnesses';
import { CRIMES } from './crimes';
import { HOLIDAYS } from './holidays';
import { FESTIVALS } from './festivals';
import { ARCHETYPES } from './archetypes';
import { PET_BREEDS } from './petBreeds';
import { VEHICLES } from './vehicles';
import { BIO_TEMPLATES } from './bioTemplates';
import { NAMES } from './names';

export const CONTENT: ContentCatalog = {
  objects: OBJECTS,
  items: ITEMS,
  recipes: RECIPES,
  skills: SKILLS,
  hobbies: HOBBIES,
  traits: TRAITS,
  careers: CAREERS,
  programs: PROGRAMS,
  illnesses: ILLNESSES,
  crimes: CRIMES,
  holidays: HOLIDAYS,
  festivals: FESTIVALS,
  archetypes: ARCHETYPES,
  petBreeds: PET_BREEDS,
  vehicles: VEHICLES,
  bioTemplates: BIO_TEMPLATES,
  names: NAMES,
};

export type { ContentCatalog } from './types';
