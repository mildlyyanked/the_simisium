/**
 * Recipe catalog — what a sim can cook at home given ingredients (items.ts) and a
 * cooking object (objects.ts). Objects generate "Cook <recipe>" interactions from
 * this table, consuming `ingredients` and producing `producesItemId` × `servings`.
 *
 * Balance: `hunger` is per serving at perfect quality. Rough tiers:
 *   snack 15–25 · basic meal 40–50 · good meal 55–65 · gourmet 65–75.
 */
import type { ItemId, SkillId } from '../core/types';
import type { RecipeDef } from './types';

type Ing = { itemId: ItemId; qty: number };
const ing = (itemId: ItemId, qty = 1): Ing => ({ itemId, qty });

interface RecipeOpts {
  id: string;
  name: string;
  ingredients: Ing[];
  requiresObject: string[];
  skillId?: SkillId;
  minLevel?: number;
  durationMinutes: number;
  servings?: number;
  producesItemId: ItemId;
  hunger: number;
  fun?: number;
  calories: number;
  healthy: number;
  tags: string[];
}

const recipe = (o: RecipeOpts): RecipeDef => ({
  skillId: 'cooking',
  minLevel: 0,
  servings: 1,
  ...o,
});

const STOVE = ['stove', 'kitchen_line'];
const OVEN = ['oven', 'kitchen_line'];
const NO_COOK = ['counter', 'kitchen_sink', 'dining_table'];

const ALL: RecipeDef[] = [
  // ------------------------------------------------------------------ breakfast
  recipe({ id: 'cereal_bowl', name: 'Bowl of cereal', ingredients: [ing('cereal'), ing('milk')], requiresObject: NO_COOK, durationMinutes: 5, producesItemId: 'meal_basic', hunger: 30, calories: 320, healthy: 0, tags: ['breakfast', 'quick', 'cheap', 'vegetarian', 'no_cook'] }),
  recipe({ id: 'toast_and_butter', name: 'Buttered toast', ingredients: [ing('bread'), ing('butter')], requiresObject: ['toaster', 'oven', 'stove'], durationMinutes: 6, producesItemId: 'meal_basic', hunger: 25, calories: 240, healthy: -0.1, tags: ['breakfast', 'quick', 'cheap', 'vegetarian'] }),
  recipe({ id: 'scrambled_eggs', name: 'Scrambled eggs', ingredients: [ing('eggs'), ing('butter')], requiresObject: STOVE, durationMinutes: 10, producesItemId: 'meal_basic', hunger: 38, calories: 300, healthy: 0.2, tags: ['breakfast', 'quick', 'cheap', 'vegetarian', 'protein'] }),
  recipe({ id: 'egg_sandwich', name: 'Egg & cheese sandwich', ingredients: [ing('bread'), ing('eggs'), ing('cheese')], requiresObject: STOVE, durationMinutes: 12, producesItemId: 'sandwich', hunger: 42, calories: 480, healthy: 0, tags: ['breakfast', 'quick', 'vegetarian'] }),
  recipe({ id: 'omelette', name: 'Veggie omelette', ingredients: [ing('eggs'), ing('cheese'), ing('vegetables')], requiresObject: STOVE, minLevel: 2, durationMinutes: 15, producesItemId: 'meal_good', hunger: 50, fun: 3, calories: 420, healthy: 0.4, tags: ['breakfast', 'vegetarian', 'protein'] }),
  recipe({ id: 'pancakes', name: 'Pancakes', ingredients: [ing('flour'), ing('eggs'), ing('milk'), ing('butter'), ing('sugar')], requiresObject: STOVE, minLevel: 1, durationMinutes: 25, servings: 3, producesItemId: 'meal_good', hunger: 52, fun: 6, calories: 560, healthy: -0.3, tags: ['breakfast', 'weekend', 'vegetarian', 'comfort_food', 'kid_friendly'] }),
  recipe({ id: 'french_toast', name: 'French toast', ingredients: [ing('bread'), ing('eggs'), ing('milk'), ing('butter')], requiresObject: STOVE, minLevel: 1, durationMinutes: 20, servings: 2, producesItemId: 'meal_good', hunger: 50, fun: 6, calories: 520, healthy: -0.3, tags: ['breakfast', 'weekend', 'vegetarian', 'comfort_food'] }),
  recipe({ id: 'yogurt_parfait', name: 'Yogurt parfait', ingredients: [ing('yogurt'), ing('fruit'), ing('cereal')], requiresObject: NO_COOK, durationMinutes: 5, producesItemId: 'meal_basic', hunger: 28, calories: 280, healthy: 0.6, tags: ['breakfast', 'quick', 'healthy', 'vegetarian', 'no_cook'] }),
  recipe({ id: 'fruit_smoothie', name: 'Fruit smoothie', ingredients: [ing('fruit'), ing('yogurt'), ing('milk')], requiresObject: ['blender'], durationMinutes: 6, producesItemId: 'smoothie', hunger: 25, fun: 3, calories: 260, healthy: 0.7, tags: ['breakfast', 'snack', 'quick', 'healthy', 'vegetarian', 'drink'] }),
  recipe({ id: 'protein_smoothie', name: 'Protein smoothie', ingredients: [ing('fruit'), ing('milk'), ing('protein_bar')], requiresObject: ['blender'], minLevel: 1, durationMinutes: 6, producesItemId: 'smoothie', hunger: 32, calories: 380, healthy: 0.5, tags: ['snack', 'quick', 'healthy', 'fitness', 'drink'] }),
  recipe({ id: 'brew_coffee', name: 'Pot of coffee', ingredients: [ing('coffee_beans')], requiresObject: ['coffee_maker', 'espresso_machine', 'barista_station', 'kettle'], durationMinutes: 6, servings: 3, producesItemId: 'coffee_cup', hunger: 2, calories: 5, healthy: 0, tags: ['drink', 'breakfast', 'quick', 'caffeine'] }),
  recipe({ id: 'brew_tea', name: 'Cup of tea', ingredients: [ing('tea')], requiresObject: ['kettle', 'stove', 'microwave'], durationMinutes: 5, servings: 2, producesItemId: 'tea_cup', hunger: 1, calories: 2, healthy: 0.2, tags: ['drink', 'quick', 'caffeine', 'cozy'] }),

  // ---------------------------------------------------------------------- lunch
  recipe({ id: 'sandwich', name: 'Sandwich', ingredients: [ing('bread'), ing('cheese'), ing('vegetables')], requiresObject: NO_COOK, durationMinutes: 8, producesItemId: 'sandwich', hunger: 36, calories: 420, healthy: 0.1, tags: ['lunch', 'quick', 'cheap', 'vegetarian', 'no_cook', 'packable'] }),
  recipe({ id: 'chicken_sandwich', name: 'Chicken sandwich', ingredients: [ing('bread'), ing('chicken'), ing('tomatoes')], requiresObject: STOVE, minLevel: 1, durationMinutes: 15, producesItemId: 'sandwich', hunger: 45, calories: 520, healthy: 0.2, tags: ['lunch', 'protein', 'packable'] }),
  recipe({ id: 'grilled_cheese', name: 'Grilled cheese', ingredients: [ing('bread'), ing('butter'), ing('cheese')], requiresObject: STOVE, durationMinutes: 10, producesItemId: 'meal_basic', hunger: 40, fun: 4, calories: 450, healthy: -0.3, tags: ['lunch', 'quick', 'cheap', 'vegetarian', 'comfort_food', 'kid_friendly'] }),
  recipe({ id: 'instant_ramen', name: 'Instant ramen', ingredients: [ing('ramen')], requiresObject: ['microwave', 'kettle', 'stove', 'kitchen_line'], durationMinutes: 5, producesItemId: 'meal_basic', hunger: 32, calories: 380, healthy: -0.5, tags: ['lunch', 'dinner', 'quick', 'cheap', 'vegetarian', 'late_night'] }),
  recipe({ id: 'upgraded_ramen', name: 'Ramen with egg & greens', ingredients: [ing('ramen'), ing('eggs'), ing('vegetables')], requiresObject: STOVE, minLevel: 1, durationMinutes: 12, producesItemId: 'meal_good', hunger: 48, fun: 4, calories: 480, healthy: 0, tags: ['lunch', 'dinner', 'cheap', 'vegetarian', 'late_night'] }),
  recipe({ id: 'garden_salad', name: 'Garden salad', ingredients: [ing('salad_greens'), ing('vegetables'), ing('tomatoes')], requiresObject: NO_COOK, durationMinutes: 8, producesItemId: 'meal_basic', hunger: 30, calories: 180, healthy: 0.9, tags: ['lunch', 'healthy', 'vegetarian', 'no_cook', 'light'] }),
  recipe({ id: 'chicken_salad', name: 'Grilled chicken salad', ingredients: [ing('salad_greens'), ing('chicken'), ing('tomatoes')], requiresObject: STOVE, minLevel: 2, durationMinutes: 18, producesItemId: 'meal_good', hunger: 48, calories: 380, healthy: 0.8, tags: ['lunch', 'dinner', 'healthy', 'protein', 'light'] }),
  recipe({ id: 'baked_potato', name: 'Loaded baked potato', ingredients: [ing('potatoes'), ing('butter'), ing('cheese')], requiresObject: ['microwave', 'oven', 'air_fryer'], durationMinutes: 12, producesItemId: 'meal_basic', hunger: 40, calories: 420, healthy: 0, tags: ['lunch', 'dinner', 'cheap', 'vegetarian', 'comfort_food'] }),
  recipe({ id: 'vegetable_soup', name: 'Vegetable soup', ingredients: [ing('vegetables'), ing('onions'), ing('potatoes'), ing('tomatoes')], requiresObject: STOVE, minLevel: 1, durationMinutes: 40, servings: 4, producesItemId: 'soup', hunger: 40, calories: 220, healthy: 0.8, tags: ['lunch', 'dinner', 'healthy', 'vegetarian', 'batch', 'winter', 'sick_food'] }),
  recipe({ id: 'chicken_noodle_soup', name: 'Chicken noodle soup', ingredients: [ing('chicken'), ing('pasta'), ing('vegetables'), ing('onions')], requiresObject: STOVE, minLevel: 2, durationMinutes: 45, servings: 4, producesItemId: 'soup', hunger: 45, calories: 300, healthy: 0.7, tags: ['lunch', 'dinner', 'batch', 'sick_food', 'winter', 'comfort_food'] }),
  recipe({ id: 'mac_and_cheese', name: 'Mac and cheese', ingredients: [ing('pasta'), ing('cheese'), ing('milk'), ing('butter')], requiresObject: STOVE, minLevel: 1, durationMinutes: 25, servings: 3, producesItemId: 'meal_basic', hunger: 46, fun: 5, calories: 620, healthy: -0.4, tags: ['lunch', 'dinner', 'cheap', 'vegetarian', 'comfort_food', 'kid_friendly', 'batch'] }),
  recipe({ id: 'fried_rice', name: 'Egg fried rice', ingredients: [ing('rice'), ing('eggs'), ing('vegetables'), ing('onions')], requiresObject: STOVE, minLevel: 1, durationMinutes: 20, servings: 2, producesItemId: 'meal_basic', hunger: 45, calories: 520, healthy: 0.1, tags: ['lunch', 'dinner', 'cheap', 'vegetarian', 'leftover_friendly'] }),
  recipe({ id: 'quick_frozen_pizza', name: 'Frozen pizza', ingredients: [ing('frozen_pizza')], requiresObject: ['oven', 'air_fryer', 'kitchen_line'], durationMinutes: 18, servings: 2, producesItemId: 'meal_basic', hunger: 45, fun: 4, calories: 700, healthy: -0.6, tags: ['dinner', 'lunch', 'quick', 'lazy', 'vegetarian', 'late_night'] }),

  // --------------------------------------------------------------------- dinner
  recipe({ id: 'spaghetti_marinara', name: 'Spaghetti marinara', ingredients: [ing('pasta'), ing('tomatoes'), ing('onions')], requiresObject: STOVE, minLevel: 1, durationMinutes: 25, servings: 3, producesItemId: 'meal_basic', hunger: 48, calories: 540, healthy: 0.2, tags: ['dinner', 'cheap', 'vegetarian', 'batch'] }),
  recipe({ id: 'spaghetti_bolognese', name: 'Spaghetti bolognese', ingredients: [ing('pasta'), ing('ground_beef'), ing('tomatoes'), ing('onions')], requiresObject: STOVE, minLevel: 2, durationMinutes: 40, servings: 4, producesItemId: 'meal_good', hunger: 58, fun: 4, calories: 680, healthy: 0, tags: ['dinner', 'batch', 'comfort_food', 'protein'] }),
  recipe({ id: 'burgers', name: 'Homemade burgers', ingredients: [ing('ground_beef'), ing('bread'), ing('cheese'), ing('onions'), ing('tomatoes')], requiresObject: ['grill', 'stove', 'kitchen_line'], minLevel: 1, durationMinutes: 25, servings: 3, producesItemId: 'meal_good', hunger: 58, fun: 6, calories: 720, healthy: -0.3, tags: ['dinner', 'lunch', 'grill', 'summer', 'comfort_food', 'kid_friendly'] }),
  recipe({ id: 'chicken_stir_fry', name: 'Chicken stir-fry', ingredients: [ing('chicken'), ing('vegetables'), ing('rice'), ing('onions')], requiresObject: STOVE, minLevel: 2, durationMinutes: 30, servings: 3, producesItemId: 'meal_good', hunger: 58, calories: 560, healthy: 0.6, tags: ['dinner', 'healthy', 'protein', 'batch'] }),
  recipe({ id: 'tofu_stir_fry', name: 'Tofu stir-fry', ingredients: [ing('tofu'), ing('vegetables'), ing('rice'), ing('onions')], requiresObject: STOVE, minLevel: 2, durationMinutes: 30, servings: 3, producesItemId: 'meal_good', hunger: 55, calories: 480, healthy: 0.7, tags: ['dinner', 'healthy', 'vegetarian', 'vegan', 'batch'] }),
  recipe({ id: 'tacos', name: 'Ground beef tacos', ingredients: [ing('ground_beef'), ing('onions'), ing('tomatoes'), ing('cheese'), ing('salad_greens')], requiresObject: STOVE, minLevel: 1, durationMinutes: 25, servings: 3, producesItemId: 'meal_good', hunger: 55, fun: 6, calories: 640, healthy: -0.1, tags: ['dinner', 'taco_tuesday', 'comfort_food', 'kid_friendly'] }),
  recipe({ id: 'chili', name: 'Pot of chili', ingredients: [ing('ground_beef'), ing('tomatoes'), ing('onions'), ing('vegetables')], requiresObject: STOVE, minLevel: 2, durationMinutes: 60, servings: 6, producesItemId: 'meal_good', hunger: 56, fun: 3, calories: 520, healthy: 0.2, tags: ['dinner', 'batch', 'winter', 'game_day', 'comfort_food'] }),
  recipe({ id: 'beef_stew', name: 'Beef stew', ingredients: [ing('beef'), ing('potatoes'), ing('onions'), ing('vegetables')], requiresObject: STOVE, minLevel: 3, durationMinutes: 120, servings: 6, producesItemId: 'meal_good', hunger: 60, fun: 4, calories: 580, healthy: 0.3, tags: ['dinner', 'batch', 'winter', 'slow', 'comfort_food'] }),
  recipe({ id: 'chicken_curry', name: 'Chicken curry & rice', ingredients: [ing('chicken'), ing('rice'), ing('onions'), ing('vegetables'), ing('yogurt')], requiresObject: STOVE, minLevel: 3, durationMinutes: 45, servings: 4, producesItemId: 'meal_good', hunger: 62, fun: 6, calories: 620, healthy: 0.3, tags: ['dinner', 'batch', 'spicy', 'protein'] }),
  recipe({ id: 'roast_chicken', name: 'Roast chicken dinner', ingredients: [ing('chicken', 2), ing('potatoes'), ing('vegetables'), ing('butter')], requiresObject: OVEN, minLevel: 3, durationMinutes: 90, servings: 4, producesItemId: 'meal_good', hunger: 64, fun: 6, calories: 720, healthy: 0.4, tags: ['dinner', 'sunday', 'family', 'protein', 'batch'] }),
  recipe({ id: 'fried_chicken', name: 'Fried chicken', ingredients: [ing('chicken', 2), ing('flour'), ing('eggs'), ing('milk')], requiresObject: STOVE, minLevel: 3, durationMinutes: 50, servings: 4, producesItemId: 'meal_good', hunger: 62, fun: 8, calories: 820, healthy: -0.5, tags: ['dinner', 'comfort_food', 'southern', 'batch', 'protein'] }),
  recipe({ id: 'air_fryer_wings', name: 'Air-fryer wings', ingredients: [ing('chicken')], requiresObject: ['air_fryer', 'oven'], minLevel: 1, durationMinutes: 25, servings: 2, producesItemId: 'meal_basic', hunger: 42, fun: 6, calories: 560, healthy: -0.3, tags: ['dinner', 'snack', 'game_day', 'quick', 'protein'] }),
  recipe({ id: 'pan_seared_fish', name: 'Pan-seared fish', ingredients: [ing('fish'), ing('butter'), ing('vegetables')], requiresObject: STOVE, minLevel: 3, durationMinutes: 25, servings: 2, producesItemId: 'meal_good', hunger: 58, fun: 5, calories: 420, healthy: 0.8, tags: ['dinner', 'healthy', 'seafood', 'protein'] }),
  recipe({ id: 'sheet_pan_salmon', name: 'Sheet-pan salmon & veg', ingredients: [ing('fish'), ing('vegetables'), ing('potatoes')], requiresObject: OVEN, minLevel: 2, durationMinutes: 35, servings: 2, producesItemId: 'meal_good', hunger: 60, calories: 480, healthy: 0.9, tags: ['dinner', 'healthy', 'seafood', 'easy_cleanup'] }),
  recipe({ id: 'shrimp_scampi', name: 'Shrimp scampi', ingredients: [ing('shrimp'), ing('pasta'), ing('butter'), ing('onions')], requiresObject: STOVE, minLevel: 4, durationMinutes: 30, servings: 2, producesItemId: 'meal_gourmet', hunger: 66, fun: 8, calories: 640, healthy: 0.3, tags: ['dinner', 'seafood', 'date_night', 'gourmet'] }),
  recipe({ id: 'steak_dinner', name: 'Steak & potatoes', ingredients: [ing('beef'), ing('potatoes'), ing('butter'), ing('vegetables')], requiresObject: ['stove', 'grill', 'kitchen_line'], minLevel: 4, durationMinutes: 35, servings: 2, producesItemId: 'meal_gourmet', hunger: 70, fun: 10, calories: 860, healthy: 0, tags: ['dinner', 'date_night', 'gourmet', 'grill', 'protein', 'celebration'] }),
  recipe({ id: 'mushroom_risotto', name: 'Risotto', ingredients: [ing('rice'), ing('butter'), ing('cheese'), ing('onions'), ing('vegetables')], requiresObject: STOVE, minLevel: 4, durationMinutes: 45, servings: 3, producesItemId: 'meal_gourmet', hunger: 64, fun: 8, calories: 580, healthy: 0.2, tags: ['dinner', 'gourmet', 'vegetarian', 'date_night'] }),
  recipe({ id: 'chicken_pasta_bake', name: 'Chicken pasta bake', ingredients: [ing('chicken'), ing('pasta'), ing('cheese'), ing('vegetables'), ing('tomatoes')], requiresObject: OVEN, minLevel: 2, durationMinutes: 50, servings: 6, producesItemId: 'meal_good', hunger: 58, fun: 4, calories: 660, healthy: 0.1, tags: ['dinner', 'batch', 'family', 'meal_prep', 'comfort_food'] }),
  recipe({ id: 'grilled_veggie_skewers', name: 'Grilled veggie skewers', ingredients: [ing('vegetables'), ing('onions'), ing('tomatoes')], requiresObject: ['grill', 'oven'], minLevel: 1, durationMinutes: 25, servings: 2, producesItemId: 'meal_basic', hunger: 38, fun: 4, calories: 220, healthy: 0.9, tags: ['dinner', 'grill', 'summer', 'vegetarian', 'vegan', 'healthy'] }),
  recipe({ id: 'grilled_fish_tacos', name: 'Grilled fish tacos', ingredients: [ing('fish'), ing('salad_greens'), ing('tomatoes'), ing('onions')], requiresObject: ['grill', 'stove'], minLevel: 3, durationMinutes: 30, servings: 3, producesItemId: 'meal_good', hunger: 56, fun: 7, calories: 480, healthy: 0.6, tags: ['dinner', 'grill', 'summer', 'seafood'] }),
  recipe({ id: 'bbq_ribs', name: 'Slow BBQ ribs', ingredients: [ing('beef', 2), ing('sugar'), ing('onions')], requiresObject: ['grill', 'oven'], minLevel: 5, durationMinutes: 240, servings: 4, producesItemId: 'meal_gourmet', hunger: 72, fun: 12, calories: 980, healthy: -0.5, tags: ['dinner', 'grill', 'summer', 'party', 'gourmet', 'slow', 'protein'] }),
  recipe({ id: 'campfire_hot_dogs', name: 'Campfire hot dogs', ingredients: [ing('ground_beef'), ing('bread')], requiresObject: ['campfire', 'fire_pit', 'grill'], durationMinutes: 15, servings: 2, producesItemId: 'meal_basic', hunger: 40, fun: 8, calories: 520, healthy: -0.4, tags: ['dinner', 'camping', 'summer', 'cheap', 'kid_friendly'] }),

  // --------------------------------------------------------------------- baking
  recipe({ id: 'chocolate_chip_cookies', name: 'Chocolate chip cookies', ingredients: [ing('flour'), ing('sugar'), ing('butter'), ing('eggs'), ing('chocolate')], requiresObject: OVEN, skillId: 'baking', minLevel: 1, durationMinutes: 40, servings: 12, producesItemId: 'cookies', hunger: 12, fun: 6, calories: 160, healthy: -0.6, tags: ['dessert', 'baking', 'snack', 'kid_friendly', 'gift', 'batch'] }),
  recipe({ id: 'brownies', name: 'Fudgy brownies', ingredients: [ing('flour'), ing('sugar'), ing('butter'), ing('eggs'), ing('chocolate', 2)], requiresObject: OVEN, skillId: 'baking', minLevel: 2, durationMinutes: 50, servings: 9, producesItemId: 'brownies', hunger: 15, fun: 8, calories: 240, healthy: -0.7, tags: ['dessert', 'baking', 'snack', 'party', 'gift', 'batch'] }),
  recipe({ id: 'blueberry_muffins', name: 'Fruit muffins', ingredients: [ing('flour'), ing('sugar'), ing('eggs'), ing('milk'), ing('fruit'), ing('butter')], requiresObject: OVEN, skillId: 'baking', minLevel: 2, durationMinutes: 45, servings: 6, producesItemId: 'muffins', hunger: 22, fun: 5, calories: 320, healthy: -0.3, tags: ['breakfast', 'dessert', 'baking', 'snack', 'batch'] }),
  recipe({ id: 'birthday_cake', name: 'Layer cake', ingredients: [ing('flour', 2), ing('sugar', 2), ing('butter', 2), ing('eggs'), ing('milk'), ing('chocolate')], requiresObject: OVEN, skillId: 'baking', minLevel: 3, durationMinutes: 120, servings: 10, producesItemId: 'cake', hunger: 25, fun: 12, calories: 420, healthy: -0.8, tags: ['dessert', 'baking', 'party', 'birthday', 'celebration', 'batch'] }),
  recipe({ id: 'apple_pie', name: 'Fruit pie', ingredients: [ing('flour'), ing('butter'), ing('sugar'), ing('fruit', 2)], requiresObject: OVEN, skillId: 'baking', minLevel: 4, durationMinutes: 110, servings: 8, producesItemId: 'pie', hunger: 26, fun: 10, calories: 400, healthy: -0.5, tags: ['dessert', 'baking', 'thanksgiving', 'fall', 'holiday', 'batch'] }),
  recipe({ id: 'homemade_bread', name: 'Homemade bread', ingredients: [ing('flour', 2), ing('sugar'), ing('butter')], requiresObject: OVEN, skillId: 'baking', minLevel: 3, durationMinutes: 180, servings: 2, producesItemId: 'bread', hunger: 0, fun: 8, calories: 0, healthy: 0.2, tags: ['baking', 'slow', 'weekend', 'staple', 'batch'] }),
  recipe({ id: 'banana_bread', name: 'Fruit loaf', ingredients: [ing('flour'), ing('sugar'), ing('eggs'), ing('butter'), ing('fruit')], requiresObject: OVEN, skillId: 'baking', minLevel: 1, durationMinutes: 75, servings: 6, producesItemId: 'muffins', hunger: 22, fun: 6, calories: 300, healthy: -0.3, tags: ['breakfast', 'dessert', 'baking', 'snack', 'batch'] }),
  recipe({ id: 'ice_cream_sundae', name: 'Ice cream sundae', ingredients: [ing('ice_cream'), ing('chocolate'), ing('fruit')], requiresObject: NO_COOK, durationMinutes: 5, producesItemId: 'meal_basic', hunger: 18, fun: 10, calories: 520, healthy: -0.8, tags: ['dessert', 'snack', 'quick', 'no_cook', 'vegetarian', 'summer', 'kid_friendly'] }),
];

export const RECIPES: Record<string, RecipeDef> = Object.fromEntries(ALL.map((r) => [r.id, r]));

/** Recipes cookable on a given object def. */
export function recipesForObject(objectDefId: string): RecipeDef[] {
  return ALL.filter((r) => r.requiresObject.includes(objectDefId));
}
