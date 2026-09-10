/**
 * Item catalog — consumables, groceries, toiletries, medicine, pet supplies, clothing.
 * Prices are 2026 US averages at cost-of-living 1.0 (scale by region / venue).
 *
 * `effects` is what happens when a sim *uses* one unit (eats / drinks / applies).
 * Custom event kinds emitted by items:
 *   health:medicate   { itemId }              — health system applies the drug's clinical effect
 *   health:nicotine   { itemId, strength }    — addiction tracking
 *   health:cannabis   { itemId }              — addiction / impairment tracking (cannabis field carries the dose)
 *   health:contraception { itemId }           — family system: pregnancy chance modifier
 *   health:pregnancy_test                      — family system reveals pregnancy status
 *   finance:lottery   { itemId }              — finance system rolls the ticket
 *   transport:refuel  { gallons }             — transport system fuels the household vehicle
 *   transport:bus_pass                         — transport system credits a ride
 *   entertainment:ticket { kind }             — entertainment system admits the sim
 *   phone:charge                               — communication system tops up the phone battery
 *   shop:gift_card    { amount }              — shopping system credits store balance
 */
import type { EffectBundle, EmotionId, ItemDef, ItemId, MoodletSpec } from '../core/types';

const mood = (emotion: EmotionId, label: string, intensity: number, durationMinutes: number): MoodletSpec => ({ emotion, label, intensity, durationMinutes });

type Cat = ItemDef['category'];
interface ItemOpts {
  id: ItemId;
  name: string;
  category: Cat;
  basePrice: number;
  unit: string;
  perishDays?: number;
  calories?: number;
  effects?: EffectBundle;
  tags?: string[];
}
const item = (o: ItemOpts): ItemDef => ({ tags: [], ...o });

/** eating a basic portion */
const eat = (hunger: number, extra: Partial<EffectBundle> = {}): EffectBundle => ({ needs: { hunger }, ...extra });
const drink = (thirst: number, extra: Partial<EffectBundle> = {}): EffectBundle => ({ needs: { thirst, bladder: -6 }, ...extra });
const medicate = (id: ItemId, extra: Partial<EffectBundle> = {}): EffectBundle => ({ custom: [{ kind: 'health:medicate', payload: { itemId: id } }], ...extra });

const ALL: ItemDef[] = [
  // ------------------------------------------------------------------ groceries
  item({ id: 'eggs', name: 'Eggs', category: 'ingredient', basePrice: 4.2, unit: 'dozen', perishDays: 28, calories: 70, effects: eat(6), tags: ['grocery', 'protein', 'vegetarian', 'breakfast', 'staple'] }),
  item({ id: 'milk', name: 'Milk', category: 'ingredient', basePrice: 3.9, unit: 'gallon', perishDays: 10, calories: 150, effects: drink(15, { needs: { thirst: 15, hunger: 6, bladder: -6 } }), tags: ['grocery', 'dairy', 'vegetarian', 'staple', 'drink'] }),
  item({ id: 'bread', name: 'Bread', category: 'ingredient', basePrice: 3.5, unit: 'loaf', perishDays: 7, calories: 80, effects: eat(8), tags: ['grocery', 'carb', 'vegetarian', 'staple'] }),
  item({ id: 'rice', name: 'Rice', category: 'ingredient', basePrice: 2.8, unit: '2 lb bag', calories: 200, tags: ['grocery', 'carb', 'vegetarian', 'vegan', 'staple', 'cheap'] }),
  item({ id: 'pasta', name: 'Pasta', category: 'ingredient', basePrice: 1.6, unit: '1 lb box', calories: 210, tags: ['grocery', 'carb', 'vegetarian', 'vegan', 'staple', 'cheap'] }),
  item({ id: 'chicken', name: 'Chicken', category: 'ingredient', basePrice: 6.5, unit: 'lb', perishDays: 3, calories: 250, tags: ['grocery', 'meat', 'protein'] }),
  item({ id: 'beef', name: 'Beef steak', category: 'ingredient', basePrice: 12.0, unit: 'lb', perishDays: 4, calories: 300, tags: ['grocery', 'meat', 'protein', 'pricey'] }),
  item({ id: 'ground_beef', name: 'Ground beef', category: 'ingredient', basePrice: 5.8, unit: 'lb', perishDays: 3, calories: 290, tags: ['grocery', 'meat', 'protein'] }),
  item({ id: 'fish', name: 'Fish fillet', category: 'ingredient', basePrice: 10.5, unit: 'lb', perishDays: 2, calories: 200, tags: ['grocery', 'seafood', 'protein', 'healthy'] }),
  item({ id: 'shrimp', name: 'Shrimp', category: 'ingredient', basePrice: 11.0, unit: 'lb', perishDays: 2, calories: 120, tags: ['grocery', 'seafood', 'protein', 'pricey'] }),
  item({ id: 'tofu', name: 'Tofu', category: 'ingredient', basePrice: 2.9, unit: 'block', perishDays: 14, calories: 180, tags: ['grocery', 'protein', 'vegetarian', 'vegan', 'cheap'] }),
  item({ id: 'vegetables', name: 'Mixed vegetables', category: 'ingredient', basePrice: 3.2, unit: 'lb', perishDays: 7, calories: 60, effects: eat(6, { health: 0.1 }), tags: ['grocery', 'produce', 'vegetarian', 'vegan', 'healthy', 'staple'] }),
  item({ id: 'salad_greens', name: 'Salad greens', category: 'ingredient', basePrice: 4.0, unit: 'bag', perishDays: 5, calories: 20, tags: ['grocery', 'produce', 'vegetarian', 'vegan', 'healthy'] }),
  item({ id: 'fruit', name: 'Fresh fruit', category: 'food', basePrice: 3.5, unit: 'lb', perishDays: 6, calories: 90, effects: eat(10, { needs: { hunger: 10, thirst: 3 }, health: 0.1 }), tags: ['grocery', 'produce', 'snack', 'vegetarian', 'vegan', 'healthy'] }),
  item({ id: 'potatoes', name: 'Potatoes', category: 'ingredient', basePrice: 4.5, unit: '5 lb bag', perishDays: 30, calories: 160, tags: ['grocery', 'produce', 'carb', 'vegetarian', 'vegan', 'staple', 'cheap'] }),
  item({ id: 'onions', name: 'Onions', category: 'ingredient', basePrice: 1.8, unit: '3 lb bag', perishDays: 30, calories: 40, tags: ['grocery', 'produce', 'vegetarian', 'vegan', 'staple', 'cheap'] }),
  item({ id: 'tomatoes', name: 'Tomatoes', category: 'ingredient', basePrice: 2.6, unit: 'lb', perishDays: 6, calories: 30, tags: ['grocery', 'produce', 'vegetarian', 'vegan', 'healthy'] }),
  item({ id: 'cheese', name: 'Cheese', category: 'ingredient', basePrice: 5.2, unit: '8 oz block', perishDays: 30, calories: 110, effects: eat(8), tags: ['grocery', 'dairy', 'vegetarian', 'staple'] }),
  item({ id: 'butter', name: 'Butter', category: 'ingredient', basePrice: 4.9, unit: 'lb', perishDays: 60, calories: 100, tags: ['grocery', 'dairy', 'vegetarian', 'staple'] }),
  item({ id: 'yogurt', name: 'Yogurt', category: 'food', basePrice: 1.3, unit: 'cup', perishDays: 14, calories: 150, effects: eat(14, { health: 0.05 }), tags: ['grocery', 'dairy', 'snack', 'breakfast', 'vegetarian', 'healthy'] }),
  item({ id: 'coffee_beans', name: 'Coffee', category: 'ingredient', basePrice: 11.0, unit: '12 oz bag', perishDays: 180, calories: 0, tags: ['grocery', 'caffeine', 'staple', 'vegan'] }),
  item({ id: 'tea', name: 'Tea bags', category: 'ingredient', basePrice: 4.5, unit: 'box of 20', perishDays: 365, calories: 0, tags: ['grocery', 'caffeine', 'vegan'] }),
  item({ id: 'sugar', name: 'Sugar', category: 'ingredient', basePrice: 3.4, unit: '4 lb bag', calories: 50, tags: ['grocery', 'baking', 'staple', 'vegan'] }),
  item({ id: 'flour', name: 'Flour', category: 'ingredient', basePrice: 3.9, unit: '5 lb bag', calories: 110, tags: ['grocery', 'baking', 'staple', 'vegan'] }),
  item({ id: 'cereal', name: 'Cereal', category: 'ingredient', basePrice: 4.8, unit: 'box', perishDays: 120, calories: 150, effects: eat(12), tags: ['grocery', 'breakfast', 'vegetarian', 'kid_friendly'] }),
  item({ id: 'snacks', name: 'Snack mix', category: 'food', basePrice: 3.9, unit: 'bag', perishDays: 60, calories: 200, effects: eat(15, { needs: { hunger: 15, fun: 2 } }), tags: ['grocery', 'snack', 'vegetarian', 'junk'] }),
  item({ id: 'chips', name: 'Potato chips', category: 'food', basePrice: 4.3, unit: 'bag', perishDays: 60, calories: 300, effects: eat(14, { needs: { hunger: 14, fun: 3, thirst: -4 }, weight: 0.03 }), tags: ['grocery', 'snack', 'vegetarian', 'vegan', 'junk', 'game_day'] }),
  item({ id: 'soda', name: 'Soda', category: 'drink', basePrice: 2.3, unit: '20 oz bottle', perishDays: 180, calories: 240, effects: drink(25, { needs: { thirst: 25, fun: 3, bladder: -8 }, caffeine: 25, weight: 0.03 }), tags: ['grocery', 'drink', 'sugary', 'caffeine', 'junk', 'vegan'] }),
  item({ id: 'juice', name: 'Orange juice', category: 'drink', basePrice: 4.2, unit: '64 oz', perishDays: 14, calories: 110, effects: drink(22, { needs: { thirst: 22, hunger: 4, bladder: -8 }, health: 0.05 }), tags: ['grocery', 'drink', 'breakfast', 'vegan', 'kid_friendly'] }),
  item({ id: 'beer', name: 'Beer', category: 'alcohol', basePrice: 2.25, unit: 'can', perishDays: 180, calories: 150, effects: { needs: { thirst: 10, fun: 8, bladder: -10 }, bloodAlcohol: 0.02, stress: -3, moodlets: [mood('relaxed', 'Buzzed', 3, 90)] }, tags: ['alcohol', 'drink', 'grocery', 'party', 'game_day', 'adult'] }),
  item({ id: 'wine', name: 'Wine', category: 'alcohol', basePrice: 13.0, unit: 'bottle', perishDays: 7, calories: 125, effects: { needs: { thirst: 4, fun: 8, bladder: -6 }, bloodAlcohol: 0.025, stress: -4, moodlets: [mood('relaxed', 'Glass of wine', 4, 90)] }, tags: ['alcohol', 'drink', 'grocery', 'date_night', 'gift', 'adult'] }),
  item({ id: 'liquor', name: 'Liquor', category: 'alcohol', basePrice: 24.0, unit: '750 ml bottle', calories: 100, effects: { needs: { fun: 9, bladder: -3 }, bloodAlcohol: 0.035, stress: -5, moodlets: [mood('playful', 'Feeling it', 4, 75)] }, tags: ['alcohol', 'drink', 'party', 'adult', 'hard'] }),
  item({ id: 'water_bottle', name: 'Bottled water', category: 'drink', basePrice: 1.75, unit: 'bottle', calories: 0, effects: drink(30, { needs: { thirst: 30, bladder: -8 }, health: 0.02 }), tags: ['drink', 'healthy', 'vegan', 'convenience', 'fitness'] }),
  item({ id: 'energy_drink', name: 'Energy drink', category: 'drink', basePrice: 3.5, unit: 'can', perishDays: 180, calories: 160, effects: drink(18, { needs: { thirst: 18, energy: 18, bladder: -8 }, caffeine: 150, stress: 2, moodlets: [mood('energized', 'Wired', 5, 120)] }), tags: ['drink', 'caffeine', 'convenience', 'junk', 'late_night'] }),
  item({ id: 'frozen_pizza', name: 'Frozen pizza', category: 'ingredient', basePrice: 7.5, unit: 'pizza', perishDays: 180, calories: 700, tags: ['grocery', 'frozen', 'lazy', 'vegetarian', 'cheap'] }),
  item({ id: 'ramen', name: 'Instant ramen', category: 'ingredient', basePrice: 0.6, unit: 'pack', perishDays: 365, calories: 380, tags: ['grocery', 'cheap', 'vegetarian', 'staple', 'college'] }),
  item({ id: 'ice_cream', name: 'Ice cream', category: 'food', basePrice: 5.5, unit: 'pint', perishDays: 90, calories: 280, effects: eat(18, { needs: { hunger: 18, fun: 10, comfort: 4 }, weight: 0.05, moodlets: [mood('happy', 'Ice cream', 4, 60)] }), tags: ['grocery', 'dessert', 'snack', 'frozen', 'vegetarian', 'comfort_food'] }),
  item({ id: 'chocolate', name: 'Chocolate bar', category: 'food', basePrice: 2.8, unit: 'bar', perishDays: 180, calories: 230, effects: eat(10, { needs: { hunger: 10, fun: 6 }, stress: -2, weight: 0.03 }), tags: ['grocery', 'snack', 'dessert', 'vegetarian', 'gift', 'baking'] }),
  item({ id: 'cookies', name: 'Cookies', category: 'food', basePrice: 4.5, unit: 'dozen', perishDays: 21, calories: 160, effects: eat(12, { needs: { hunger: 12, fun: 5 }, weight: 0.02 }), tags: ['grocery', 'snack', 'dessert', 'baked', 'vegetarian', 'kid_friendly', 'gift'] }),
  item({ id: 'protein_bar', name: 'Protein bar', category: 'food', basePrice: 2.6, unit: 'bar', perishDays: 180, calories: 220, effects: eat(18, { needs: { hunger: 18 } }), tags: ['snack', 'fitness', 'convenience', 'protein', 'vegetarian'] }),
  item({ id: 'baby_formula', name: 'Baby formula', category: 'food', basePrice: 32.0, unit: 'can', perishDays: 365, calories: 100, effects: { custom: [{ kind: 'family:feed_infant', payload: { itemId: 'baby_formula' } }] }, tags: ['baby', 'grocery', 'essential'] }),
  item({ id: 'diapers', name: 'Diapers', category: 'misc', basePrice: 28.0, unit: 'pack of 80', effects: { custom: [{ kind: 'family:change_diaper', payload: { itemId: 'diapers' } }] }, tags: ['baby', 'grocery', 'essential'] }),

  // -------------------------------------------------------------- prepared food
  item({ id: 'meal_basic', name: 'Simple meal', category: 'food', basePrice: 4.0, unit: 'serving', perishDays: 3, calories: 500, effects: eat(45, { needs: { hunger: 45, comfort: 2 } }), tags: ['meal', 'prepared', 'homemade'] }),
  item({ id: 'meal_good', name: 'Good meal', category: 'food', basePrice: 8.0, unit: 'serving', perishDays: 3, calories: 620, effects: eat(60, { needs: { hunger: 60, comfort: 4, fun: 4 }, moodlets: [mood('happy', 'Good meal', 4, 120)] }), tags: ['meal', 'prepared', 'homemade'] }),
  item({ id: 'meal_gourmet', name: 'Gourmet meal', category: 'food', basePrice: 18.0, unit: 'serving', perishDays: 2, calories: 720, effects: eat(70, { needs: { hunger: 70, comfort: 6, fun: 8 }, moodlets: [mood('happy', 'Gourmet meal', 8, 240)] }), tags: ['meal', 'prepared', 'homemade', 'gourmet'] }),
  item({ id: 'leftovers', name: 'Leftovers', category: 'food', basePrice: 3.0, unit: 'container', perishDays: 4, calories: 450, effects: eat(40), tags: ['meal', 'prepared', 'homemade', 'cheap'] }),
  item({ id: 'takeout_meal', name: 'Takeout', category: 'food', basePrice: 16.5, unit: 'order', perishDays: 2, calories: 850, effects: eat(58, { needs: { hunger: 58, fun: 6 }, weight: 0.05 }), tags: ['meal', 'prepared', 'takeout', 'delivery'] }),
  item({ id: 'sandwich', name: 'Sandwich', category: 'food', basePrice: 9.0, unit: 'sandwich', perishDays: 2, calories: 450, effects: eat(35), tags: ['meal', 'prepared', 'lunch', 'packable'] }),
  item({ id: 'coffee_cup', name: 'Coffee', category: 'drink', basePrice: 4.25, unit: 'cup', perishDays: 1, calories: 10, effects: { needs: { energy: 15, thirst: 8, bladder: -8, comfort: 3 }, caffeine: 95, moodlets: [mood('energized', 'Caffeinated', 4, 150)] }, tags: ['drink', 'caffeine', 'prepared', 'breakfast', 'vegan'] }),
  item({ id: 'tea_cup', name: 'Cup of tea', category: 'drink', basePrice: 3.25, unit: 'cup', perishDays: 1, calories: 2, effects: { needs: { energy: 6, thirst: 14, bladder: -8, comfort: 5 }, caffeine: 40, stress: -3, moodlets: [mood('relaxed', 'Cup of tea', 3, 90)] }, tags: ['drink', 'caffeine', 'prepared', 'cozy', 'vegan'] }),
  item({ id: 'smoothie', name: 'Smoothie', category: 'drink', basePrice: 7.5, unit: 'cup', perishDays: 1, calories: 280, effects: { needs: { hunger: 25, thirst: 18, bladder: -5 }, health: 0.1 }, tags: ['drink', 'prepared', 'healthy', 'breakfast', 'fitness', 'vegetarian'] }),
  item({ id: 'fast_food_meal', name: 'Fast food combo', category: 'food', basePrice: 11.5, unit: 'combo', perishDays: 1, calories: 1100, effects: eat(55, { needs: { hunger: 55, thirst: 15, fun: 5 }, weight: 0.08, health: -0.1 }), tags: ['meal', 'prepared', 'fast_food', 'junk', 'cheap'] }),
  item({ id: 'restaurant_meal', name: 'Restaurant meal', category: 'food', basePrice: 24.0, unit: 'plate', perishDays: 1, calories: 900, effects: eat(65, { needs: { hunger: 65, fun: 8, comfort: 4 }, moodlets: [mood('happy', 'Ate out', 5, 180)] }), tags: ['meal', 'prepared', 'restaurant'] }),
  item({ id: 'soup', name: 'Homemade soup', category: 'food', basePrice: 4.5, unit: 'bowl', perishDays: 5, calories: 260, effects: eat(40, { needs: { hunger: 40, comfort: 6, thirst: 8 }, health: 0.15, moodlets: [mood('relaxed', 'Warm soup', 3, 90)] }), tags: ['meal', 'prepared', 'homemade', 'healthy', 'sick_food', 'winter'] }),
  item({ id: 'brownies', name: 'Brownies', category: 'food', basePrice: 3.0, unit: 'square', perishDays: 5, calories: 240, effects: eat(15, { needs: { hunger: 15, fun: 8 }, weight: 0.03, moodlets: [mood('happy', 'Brownie', 3, 60)] }), tags: ['dessert', 'snack', 'baked', 'homemade', 'vegetarian', 'gift'] }),
  item({ id: 'muffins', name: 'Muffins', category: 'food', basePrice: 3.0, unit: 'muffin', perishDays: 4, calories: 320, effects: eat(22, { needs: { hunger: 22, fun: 4 }, weight: 0.02 }), tags: ['breakfast', 'snack', 'baked', 'homemade', 'vegetarian'] }),
  item({ id: 'cake', name: 'Cake', category: 'food', basePrice: 4.0, unit: 'slice', perishDays: 4, calories: 420, effects: eat(25, { needs: { hunger: 25, fun: 12 }, weight: 0.05, moodlets: [mood('happy', 'Cake!', 6, 120)] }), tags: ['dessert', 'baked', 'homemade', 'party', 'birthday', 'vegetarian'] }),
  item({ id: 'pie', name: 'Pie', category: 'food', basePrice: 4.0, unit: 'slice', perishDays: 4, calories: 400, effects: eat(26, { needs: { hunger: 26, fun: 10, comfort: 4 }, weight: 0.05, moodlets: [mood('nostalgic', 'Homemade pie', 5, 120)] }), tags: ['dessert', 'baked', 'homemade', 'holiday', 'vegetarian'] }),

  // ------------------------------------------------------ toiletries / household
  item({ id: 'toothpaste', name: 'Toothpaste', category: 'toiletry', basePrice: 3.8, unit: 'tube', effects: { needs: { hygiene: 6 }, health: 0.05 }, tags: ['hygiene', 'household', 'essential'] }),
  item({ id: 'soap', name: 'Bar soap', category: 'toiletry', basePrice: 2.2, unit: 'bar', effects: { needs: { hygiene: 4 } }, tags: ['hygiene', 'household', 'essential'] }),
  item({ id: 'shampoo', name: 'Shampoo', category: 'toiletry', basePrice: 6.5, unit: 'bottle', effects: { needs: { hygiene: 4 } }, tags: ['hygiene', 'household', 'essential'] }),
  item({ id: 'toilet_paper', name: 'Toilet paper', category: 'toiletry', basePrice: 9.5, unit: '12-pack', tags: ['household', 'essential', 'bathroom'] }),
  item({ id: 'laundry_detergent', name: 'Laundry detergent', category: 'toiletry', basePrice: 13.0, unit: 'jug (32 loads)', tags: ['household', 'laundry', 'essential'] }),
  item({ id: 'dish_soap', name: 'Dish soap', category: 'toiletry', basePrice: 3.6, unit: 'bottle', tags: ['household', 'kitchen', 'cleaning', 'essential'] }),
  item({ id: 'trash_bags', name: 'Trash bags', category: 'misc', basePrice: 9.0, unit: 'box of 40', tags: ['household', 'cleaning', 'essential'] }),
  item({ id: 'cleaning_supplies', name: 'Cleaning supplies', category: 'misc', basePrice: 7.5, unit: 'kit', tags: ['household', 'cleaning'] }),
  item({ id: 'paper_towels', name: 'Paper towels', category: 'misc', basePrice: 8.0, unit: '6-pack', tags: ['household', 'cleaning', 'kitchen'] }),
  item({ id: 'deodorant', name: 'Deodorant', category: 'toiletry', basePrice: 5.5, unit: 'stick', effects: { needs: { hygiene: 8 }, moodlets: [mood('confident', 'Fresh', 2, 240)] }, tags: ['hygiene', 'essential'] }),
  item({ id: 'razor', name: 'Razor', category: 'toiletry', basePrice: 9.0, unit: 'pack', effects: { needs: { hygiene: 5 }, moodlets: [mood('confident', 'Clean shave', 3, 480)] }, tags: ['hygiene', 'grooming'] }),
  item({ id: 'sunscreen', name: 'Sunscreen', category: 'toiletry', basePrice: 11.0, unit: 'bottle', effects: { flags: { sunscreen_applied: true }, health: 0.05 }, tags: ['summer', 'beach', 'health', 'outdoor'] }),
  item({ id: 'bug_spray', name: 'Bug spray', category: 'toiletry', basePrice: 7.5, unit: 'can', effects: { flags: { bug_spray_applied: true } }, tags: ['summer', 'camping', 'outdoor'] }),
  item({ id: 'lightbulb', name: 'LED bulb', category: 'tool', basePrice: 4.0, unit: 'bulb', tags: ['household', 'hardware', 'repair'] }),
  item({ id: 'batteries', name: 'Batteries', category: 'tool', basePrice: 9.5, unit: '8-pack', tags: ['household', 'hardware', 'electronics'] }),

  // ------------------------------------------------------------------- medicine
  item({ id: 'painkillers', name: 'Ibuprofen', category: 'medicine', basePrice: 7.5, unit: 'bottle of 100', effects: medicate('painkillers', { needs: { comfort: 8 }, health: 0.2, stress: -2 }), tags: ['otc', 'pain', 'pharmacy', 'first_aid'] }),
  item({ id: 'cold_medicine', name: 'Cold & flu medicine', category: 'medicine', basePrice: 9.5, unit: 'box', effects: medicate('cold_medicine', { needs: { comfort: 6, energy: -5 }, health: 0.3 }), tags: ['otc', 'cold', 'pharmacy', 'winter'] }),
  item({ id: 'antibiotics', name: 'Antibiotics', category: 'medicine', basePrice: 18.0, unit: 'course', effects: medicate('antibiotics', { health: 0.5 }), tags: ['prescription', 'infection', 'pharmacy'] }),
  item({ id: 'vitamins', name: 'Multivitamins', category: 'medicine', basePrice: 12.0, unit: 'bottle of 90', effects: medicate('vitamins', { health: 0.1 }), tags: ['otc', 'supplement', 'pharmacy', 'healthy'] }),
  item({ id: 'bandages', name: 'Bandages', category: 'medicine', basePrice: 4.5, unit: 'box', effects: medicate('bandages', { needs: { comfort: 3 }, health: 0.3 }), tags: ['otc', 'first_aid', 'injury', 'pharmacy'] }),
  item({ id: 'allergy_meds', name: 'Allergy medicine', category: 'medicine', basePrice: 14.0, unit: 'box', effects: medicate('allergy_meds', { needs: { comfort: 6 }, health: 0.2 }), tags: ['otc', 'allergy', 'pharmacy', 'spring'] }),
  item({ id: 'antacid', name: 'Antacid', category: 'medicine', basePrice: 6.5, unit: 'bottle', effects: medicate('antacid', { needs: { comfort: 8 } }), tags: ['otc', 'stomach', 'pharmacy'] }),
  item({ id: 'prescription_meds', name: 'Prescription medication', category: 'medicine', basePrice: 25.0, unit: '30-day fill (copay)', effects: medicate('prescription_meds', { health: 0.4 }), tags: ['prescription', 'pharmacy', 'chronic'] }),
  item({ id: 'birth_control', name: 'Birth control', category: 'medicine', basePrice: 20.0, unit: 'monthly pack', effects: { custom: [{ kind: 'health:contraception', payload: { itemId: 'birth_control', days: 30 } }] }, tags: ['prescription', 'pharmacy', 'contraception', 'adult'] }),
  item({ id: 'condoms', name: 'Condoms', category: 'medicine', basePrice: 12.0, unit: 'box of 12', effects: { custom: [{ kind: 'health:contraception', payload: { itemId: 'condoms', uses: 1 } }] }, tags: ['otc', 'pharmacy', 'contraception', 'adult'] }),
  item({ id: 'pregnancy_test', name: 'Pregnancy test', category: 'medicine', basePrice: 12.0, unit: 'test', effects: { custom: [{ kind: 'health:pregnancy_test', payload: {} }], stress: 4 }, tags: ['otc', 'pharmacy', 'adult'] }),
  item({ id: 'first_aid_kit', name: 'First aid kit', category: 'medicine', basePrice: 22.0, unit: 'kit', effects: medicate('first_aid_kit', { health: 0.5, needs: { comfort: 4 } }), tags: ['first_aid', 'injury', 'pharmacy', 'car', 'camping'] }),

  // ---------------------------------------------------------------------- pets
  item({ id: 'dog_food', name: 'Dog food', category: 'pet_supply', basePrice: 28.0, unit: '15 lb bag', perishDays: 365, effects: { custom: [{ kind: 'pet:feed', payload: { itemId: 'dog_food', species: 'dog' } }] }, tags: ['pet', 'dog', 'essential'] }),
  item({ id: 'cat_food', name: 'Cat food', category: 'pet_supply', basePrice: 22.0, unit: '10 lb bag', perishDays: 365, effects: { custom: [{ kind: 'pet:feed', payload: { itemId: 'cat_food', species: 'cat' } }] }, tags: ['pet', 'cat', 'essential'] }),
  item({ id: 'cat_litter', name: 'Cat litter', category: 'pet_supply', basePrice: 16.0, unit: '20 lb box', effects: { custom: [{ kind: 'pet:litter_refill', payload: { itemId: 'cat_litter' } }] }, tags: ['pet', 'cat', 'essential'] }),
  item({ id: 'pet_treats', name: 'Pet treats', category: 'pet_supply', basePrice: 7.0, unit: 'bag', perishDays: 180, effects: { custom: [{ kind: 'pet:treat', payload: { itemId: 'pet_treats' } }] }, tags: ['pet', 'dog', 'cat', 'training'] }),
  item({ id: 'pet_toy', name: 'Pet toy', category: 'pet_supply', basePrice: 9.0, unit: 'toy', effects: { custom: [{ kind: 'pet:play', payload: { itemId: 'pet_toy' } }] }, tags: ['pet', 'dog', 'cat', 'play'] }),
  item({ id: 'leash', name: 'Leash', category: 'pet_supply', basePrice: 15.0, unit: 'leash', tags: ['pet', 'dog', 'walk', 'gear'] }),

  // ---------------------------------------------------------------------- misc
  item({ id: 'phone_charger', name: 'Phone charger', category: 'electronics', basePrice: 18.0, unit: 'cable + brick', effects: { custom: [{ kind: 'phone:charge', payload: { amount: 100 } }] }, tags: ['electronics', 'phone', 'essential'] }),
  item({ id: 'gift_flowers', name: 'Bouquet of flowers', category: 'gift', basePrice: 45.0, unit: 'bouquet', perishDays: 5, tags: ['gift', 'romantic', 'apology', 'valentines', 'mothers_day'] }),
  item({ id: 'gift_chocolate', name: 'Box of chocolates', category: 'gift', basePrice: 22.0, unit: 'box', perishDays: 120, effects: eat(8, { needs: { hunger: 8, fun: 6 } }), tags: ['gift', 'romantic', 'valentines', 'sweet'] }),
  item({ id: 'gift_generic', name: 'Wrapped gift', category: 'gift', basePrice: 30.0, unit: 'gift', tags: ['gift', 'birthday', 'holiday', 'housewarming'] }),
  item({ id: 'book_novel', name: 'Paperback novel', category: 'book', basePrice: 17.0, unit: 'book', effects: { needs: { fun: 12 }, skills: { writing: 3, research: 2 }, stress: -4, moodlets: [mood('inspired', 'Lost in a book', 3, 120)] }, tags: ['book', 'reading', 'hobby', 'gift', 'quiet'] }),
  item({ id: 'textbook', name: 'Textbook', category: 'book', basePrice: 140.0, unit: 'book', effects: { needs: { fun: -4 }, skills: { logic: 6, research: 6 }, stress: 3 }, tags: ['book', 'school', 'college', 'study', 'pricey'] }),
  item({ id: 'notebook', name: 'Notebook', category: 'misc', basePrice: 4.5, unit: 'notebook', effects: { skills: { writing: 2 }, needs: { fun: 3 } }, tags: ['school', 'office', 'writing', 'cheap'] }),
  item({ id: 'cigarettes', name: 'Cigarettes', category: 'tobacco', basePrice: 9.5, unit: 'pack of 20', effects: { stress: -8, health: -0.3, needs: { fun: 4, hygiene: -4 }, custom: [{ kind: 'health:nicotine', payload: { itemId: 'cigarettes', strength: 1 } }], moodlets: [mood('relaxed', 'Smoke break', 3, 45)] }, tags: ['tobacco', 'addictive', 'adult', 'convenience'] }),
  item({ id: 'vape', name: 'Disposable vape', category: 'tobacco', basePrice: 22.0, unit: 'device', effects: { stress: -6, health: -0.15, needs: { fun: 3 }, custom: [{ kind: 'health:nicotine', payload: { itemId: 'vape', strength: 0.8 } }], moodlets: [mood('relaxed', 'Nicotine hit', 2, 40)] }, tags: ['tobacco', 'addictive', 'adult', 'convenience', 'nicotine'] }),
  item({ id: 'cannabis_flower', name: 'Cannabis (eighth)', category: 'cannabis', basePrice: 40.0, unit: '3.5 g', perishDays: 180, effects: { needs: { fun: 12, hunger: -10, comfort: 6 }, cannabis: 40, stress: -10, custom: [{ kind: 'health:cannabis', payload: { itemId: 'cannabis_flower' } }], moodlets: [mood('relaxed', 'High', 6, 150)] }, tags: ['cannabis', 'adult', 'dispensary', 'relax', 'controlled'] }),
  item({ id: 'lottery_ticket', name: 'Scratch-off', category: 'misc', basePrice: 2.0, unit: 'ticket', effects: { needs: { fun: 3 }, custom: [{ kind: 'finance:lottery', payload: { itemId: 'lottery_ticket', price: 2 } }] }, tags: ['gambling', 'convenience', 'adult', 'cheap'] }),
  item({ id: 'umbrella', name: 'Umbrella', category: 'misc', basePrice: 16.0, unit: 'umbrella', effects: { flags: { has_umbrella: true } }, tags: ['weather', 'rain', 'gear'] }),
  item({ id: 'gas_can', name: 'Gas can (1 gal)', category: 'tool', basePrice: 25.0, unit: 'can', effects: { custom: [{ kind: 'transport:refuel', payload: { gallons: 1, source: 'gas_can' } }] }, tags: ['car', 'emergency', 'hardware', 'fuel'] }),
  item({ id: 'bus_pass', name: 'Transit fare', category: 'ticket', basePrice: 2.75, unit: 'ride', effects: { custom: [{ kind: 'transport:bus_pass', payload: { rides: 1 } }] }, tags: ['transit', 'ticket', 'cheap', 'commute'] }),
  item({ id: 'movie_ticket', name: 'Movie ticket', category: 'ticket', basePrice: 16.0, unit: 'ticket', effects: { custom: [{ kind: 'entertainment:ticket', payload: { kind: 'movie' } }] }, tags: ['ticket', 'entertainment', 'date_night'] }),
  item({ id: 'concert_ticket', name: 'Concert ticket', category: 'ticket', basePrice: 95.0, unit: 'ticket', effects: { custom: [{ kind: 'entertainment:ticket', payload: { kind: 'concert' } }] }, tags: ['ticket', 'entertainment', 'music', 'pricey', 'gift'] }),
  item({ id: 'event_ticket', name: 'Event ticket', category: 'ticket', basePrice: 45.0, unit: 'ticket', effects: { custom: [{ kind: 'entertainment:ticket', payload: { kind: 'event' } }] }, tags: ['ticket', 'entertainment', 'sports', 'theater', 'gift'] }),
  item({ id: 'gift_card', name: 'Gift card ($25)', category: 'gift', basePrice: 25.0, unit: 'card', effects: { custom: [{ kind: 'shop:gift_card', payload: { amount: 25 } }] }, tags: ['gift', 'holiday', 'birthday', 'money'] }),
  item({ id: 'tool_kit', name: 'Tool kit', category: 'tool', basePrice: 45.0, unit: 'kit', tags: ['hardware', 'repair', 'handiness', 'household'] }),
  item({ id: 'paint_supplies', name: 'Paint supplies', category: 'tool', basePrice: 35.0, unit: 'set', tags: ['hobby', 'art', 'painting', 'craft'] }),
  item({ id: 'guitar_strings', name: 'Guitar strings', category: 'tool', basePrice: 12.0, unit: 'set', tags: ['hobby', 'music', 'guitar', 'repair'] }),
  item({ id: 'fishing_bait', name: 'Fishing bait', category: 'tool', basePrice: 6.0, unit: 'tub', perishDays: 7, tags: ['hobby', 'fishing', 'outdoor'] }),
  item({ id: 'seeds', name: 'Seed packets', category: 'tool', basePrice: 4.0, unit: 'packet', tags: ['hobby', 'gardening', 'outdoor', 'spring'] }),

  // ------------------------------------------------------------------ clothing
  item({ id: 'outfit_casual', name: 'Casual outfit', category: 'clothing', basePrice: 60.0, unit: 'outfit', effects: { flags: { outfit: 'casual' } }, tags: ['clothing', 'everyday'] }),
  item({ id: 'outfit_business', name: 'Business outfit', category: 'clothing', basePrice: 180.0, unit: 'outfit', effects: { flags: { outfit: 'business' }, moodlets: [mood('confident', 'Dressed for work', 3, 480)] }, tags: ['clothing', 'work', 'interview', 'professional'] }),
  item({ id: 'outfit_formal', name: 'Formal wear', category: 'clothing', basePrice: 260.0, unit: 'outfit', effects: { flags: { outfit: 'formal' }, moodlets: [mood('confident', 'Dressed up', 5, 480)] }, tags: ['clothing', 'formal', 'wedding', 'date_night', 'pricey'] }),
  item({ id: 'outfit_athletic', name: 'Athletic wear', category: 'clothing', basePrice: 75.0, unit: 'outfit', effects: { flags: { outfit: 'athletic' } }, tags: ['clothing', 'gym', 'fitness', 'running'] }),
  item({ id: 'outfit_winter_coat', name: 'Winter coat', category: 'clothing', basePrice: 140.0, unit: 'coat', effects: { flags: { has_winter_coat: true }, needs: { comfort: 5 } }, tags: ['clothing', 'winter', 'weather', 'essential'] }),
  item({ id: 'outfit_swimwear', name: 'Swimwear', category: 'clothing', basePrice: 45.0, unit: 'swimsuit', effects: { flags: { has_swimwear: true } }, tags: ['clothing', 'summer', 'beach', 'pool'] }),
  item({ id: 'shoes_sneakers', name: 'Sneakers', category: 'clothing', basePrice: 85.0, unit: 'pair', effects: { flags: { has_sneakers: true }, needs: { comfort: 4 } }, tags: ['clothing', 'shoes', 'everyday', 'fitness'] }),
  item({ id: 'shoes_dress', name: 'Dress shoes', category: 'clothing', basePrice: 110.0, unit: 'pair', effects: { flags: { has_dress_shoes: true } }, tags: ['clothing', 'shoes', 'formal', 'work'] }),
];

export const ITEMS: Record<ItemId, ItemDef> = Object.fromEntries(ALL.map((i) => [i.id, i]));

/** Ids of items that count as a ready-to-eat meal (for autonomy and "eat" interactions). */
export const MEAL_ITEM_IDS: ItemId[] = ['meal_basic', 'meal_good', 'meal_gourmet', 'leftovers', 'takeout_meal', 'sandwich', 'soup', 'fast_food_meal', 'restaurant_meal'];
