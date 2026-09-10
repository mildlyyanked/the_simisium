/**
 * Pet breeds — realistic 2026 US adoption / breeder prices, monthly upkeep (food, litter, toys,
 * routine vet amortized), and lifespans. `energy` is 0..1 activity need, `trainability` 0..1.
 */
import type { PetBreedDef } from './types';

const b = (species: PetBreedDef['species'], breed: string, adoptionCost: number, purchaseCost: number, monthlyCost: number, lifespanYears: number, energy: number, size: PetBreedDef['size'], temperaments: string[], trainability: number): PetBreedDef => ({ species, breed, adoptionCost, purchaseCost, monthlyCost, lifespanYears, energy, size, temperaments, trainability });

export const PET_BREEDS: PetBreedDef[] = [
  // ----- Dogs -----
  b('dog', 'Labrador Retriever', 250, 1500, 140, 12, 0.8, 'large', ['friendly', 'goofy', 'food-motivated'], 0.9),
  b('dog', 'Golden Retriever', 300, 2000, 150, 11, 0.75, 'large', ['gentle', 'eager to please', 'sheds everywhere'], 0.9),
  b('dog', 'German Shepherd', 250, 1800, 160, 11, 0.85, 'large', ['loyal', 'protective', 'needs a job'], 0.95),
  b('dog', 'French Bulldog', 400, 3500, 130, 11, 0.35, 'small', ['clownish', 'stubborn', 'snores'], 0.5),
  b('dog', 'Pit Bull mix', 120, 300, 130, 12, 0.7, 'medium', ['affectionate', 'strong', 'misunderstood'], 0.7),
  b('dog', 'Chihuahua', 150, 900, 80, 15, 0.45, 'tiny', ['sassy', 'one-person dog', 'yappy'], 0.5),
  b('dog', 'Beagle', 200, 1000, 110, 13, 0.75, 'medium', ['nose-driven', 'vocal', 'escape artist'], 0.5),
  b('dog', 'Poodle (Standard)', 300, 2200, 170, 13, 0.7, 'large', ['smart', 'proud', 'needs grooming'], 0.95),
  b('dog', 'Dachshund', 200, 1200, 90, 14, 0.5, 'small', ['bold', 'digger', 'back problems'], 0.5),
  b('dog', 'Australian Shepherd', 250, 1500, 140, 13, 0.95, 'medium', ['herding', 'brilliant', 'anxious if bored'], 0.95),
  b('dog', 'Shih Tzu', 200, 1300, 100, 14, 0.3, 'small', ['lap dog', 'affectionate', 'grooming-heavy'], 0.45),
  b('dog', 'Husky', 250, 1200, 150, 13, 1.0, 'large', ['talkative', 'runner', 'sheds seasonally'], 0.45),
  b('dog', 'Mutt (shelter special)', 100, 100, 110, 13, 0.65, 'medium', ['grateful', 'adaptable', 'surprising'], 0.7),
  b('dog', 'Senior dog', 50, 50, 150, 3, 0.25, 'medium', ['mellow', 'sleepy', 'grateful'], 0.6),
  // ----- Cats -----
  b('cat', 'Domestic Shorthair', 75, 75, 70, 15, 0.5, 'small', ['independent', 'curious', 'nocturnal zoomies'], 0.3),
  b('cat', 'Domestic Longhair', 75, 75, 80, 15, 0.45, 'small', ['fluffy', 'aloof', 'hairballs'], 0.3),
  b('cat', 'Maine Coon', 200, 1500, 100, 13, 0.55, 'medium', ['gentle giant', 'chirpy', 'dog-like'], 0.5),
  b('cat', 'Siamese', 150, 900, 75, 16, 0.7, 'small', ['loud', 'clingy', 'opinionated'], 0.5),
  b('cat', 'Ragdoll', 200, 1400, 85, 14, 0.3, 'medium', ['floppy', 'docile', 'indoor only'], 0.4),
  b('cat', 'Bengal', 250, 2000, 95, 14, 0.9, 'medium', ['wild', 'water-loving', 'destructive if bored'], 0.6),
  b('cat', 'Sphynx', 250, 2500, 110, 12, 0.6, 'small', ['warm', 'needy', 'needs baths'], 0.45),
  b('cat', 'Senior cat', 25, 25, 90, 3, 0.15, 'small', ['sleepy', 'set in ways', 'affectionate'], 0.2),
  // ----- Rabbits -----
  b('rabbit', 'Holland Lop', 60, 150, 50, 9, 0.5, 'small', ['sweet', 'chewer', 'skittish'], 0.35),
  b('rabbit', 'Netherland Dwarf', 50, 120, 45, 10, 0.6, 'tiny', ['feisty', 'quick', 'territorial'], 0.3),
  b('rabbit', 'Flemish Giant', 80, 200, 80, 7, 0.4, 'large', ['gentle', 'lazy', 'eats a lot'], 0.35),
  // ----- Hamsters / small rodents -----
  b('hamster', 'Syrian Hamster', 15, 25, 25, 2.5, 0.7, 'tiny', ['solitary', 'nocturnal', 'hoarder'], 0.2),
  b('hamster', 'Dwarf Hamster', 15, 20, 25, 2, 0.8, 'tiny', ['fast', 'nippy', 'tiny'], 0.15),
  b('hamster', 'Guinea Pig', 30, 50, 45, 6, 0.5, 'small', ['vocal', 'social', 'needs a friend'], 0.3),
  // ----- Birds -----
  b('bird', 'Parakeet (Budgie)', 25, 40, 30, 8, 0.7, 'tiny', ['chatty', 'social', 'messy'], 0.5),
  b('bird', 'Cockatiel', 60, 150, 40, 18, 0.65, 'tiny', ['whistler', 'affectionate', 'crest tells all'], 0.6),
  b('bird', 'African Grey Parrot', 500, 2500, 90, 45, 0.6, 'small', ['genius', 'sensitive', 'lifetime commitment'], 0.9),
  // ----- Fish -----
  b('fish', 'Betta', 5, 15, 12, 3, 0.2, 'tiny', ['flashy', 'solitary', 'low maintenance'], 0.05),
  b('fish', 'Goldfish', 5, 10, 15, 10, 0.2, 'tiny', ['messy', 'hardy', 'outgrows the bowl'], 0.05),
  b('fish', 'Community tank (tetras & guppies)', 30, 60, 25, 4, 0.2, 'tiny', ['peaceful', 'colorful', 'needs water changes'], 0.05),
  // ----- Reptiles -----
  b('reptile', 'Leopard Gecko', 40, 80, 30, 15, 0.3, 'tiny', ['calm', 'nocturnal', 'eats crickets'], 0.15),
  b('reptile', 'Bearded Dragon', 60, 150, 55, 10, 0.4, 'small', ['chill', 'basks', 'head-bobber'], 0.25),
  b('reptile', 'Ball Python', 80, 250, 35, 25, 0.2, 'small', ['docile', 'shy', 'eats monthly'], 0.1),
  b('reptile', 'Red-eared Slider Turtle', 30, 40, 40, 30, 0.3, 'small', ['long-lived', 'messy tank', 'sun lover'], 0.1),
];
