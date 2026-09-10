/**
 * Deterministic biography generation (no network). Expands `content.bioTemplates` (plus a built-in
 * bank so the game works while the catalog is a stub) with tokens derived from the sim and a seeded RNG.
 *
 * Supported tokens: {first} {last} {age} {hometown} {city} {state} {job} {employer} {hobby} {hobby2}
 * {trait} {partner} {ex} {pet} {sibling_count} {dream} {fear} {food} {team} {band} {school} {year_ago} {n}
 * ({year_ago} and {n} re-roll per fact; everything else is fixed per bio for consistency.)
 */
import type { BioTemplate, ContentCatalog } from '../content/types';
import { ageAt } from '../core/clock';
import { RNG } from '../core/rng';
import type { BioCategory, BioFact, Sim, WorldState } from '../core/types';
import { titleWords } from './context';

export interface BioTokens {
  first: string;
  last: string;
  age: string;
  hometown: string;
  city: string;
  state: string;
  job: string;
  employer: string;
  hobby: string;
  hobby2: string;
  trait: string;
  partner: string;
  ex: string;
  pet: string;
  sibling_count: string;
  dream: string;
  fear: string;
  food: string;
  team: string;
  band: string;
  school: string;
  year_ago: string;
  n: string;
}

export const DEPTH_BY_CATEGORY: Record<BioCategory, number> = {
  origin: 5,
  daily_life: 8,
  hobby: 10,
  opinion: 15,
  career: 15,
  education: 20,
  habit: 20,
  quirk: 22,
  family: 25,
  achievement: 30,
  dream: 35,
  belief: 35,
  relationship: 40,
  money: 45,
  romance: 45,
  health: 50,
  fear: 55,
  trauma: 70,
  secret: 75,
};

const FIRST_F = ['Maya', 'Jasmine', 'Rachel', 'Danielle', 'Priya', 'Karen', 'Alyssa', 'Brianna', 'Sofia', 'Megan', 'Tasha', 'Lauren', 'Erin', 'Nicole', 'Gabriela', 'Hannah', 'Denise', 'Monica', 'Kelsey', 'Amber', 'Leah', 'Vanessa', 'Christina', 'Jill', 'Tiffany', 'Rosa', 'Whitney', 'Carla', 'Beth', 'Jenna'];
const FIRST_M = ['Marcus', 'Tyler', 'Andre', 'Kevin', 'Luis', 'Derek', 'Jordan', 'Brandon', 'Chris', 'Eli', 'Raymond', 'Nate', 'Omar', 'Travis', 'Devin', 'Josh', 'Ricky', 'Sean', 'Caleb', 'Darnell', 'Miguel', 'Greg', 'Trevor', 'Isaac', 'Danny', 'Cody', 'Malik', 'Victor', 'Paul', 'Jesse'];
const FIRST_N = ['Sam', 'Alex', 'Jordan', 'Riley', 'Casey', 'Taylor', 'Morgan', 'Quinn', 'Avery', 'Rowan'];
const PET_NAMES = ['Biscuit', 'Luna', 'Max', 'Pepper', 'Mochi', 'Bear', 'Daisy', 'Tuna', 'Waffles', 'Milo', 'Nala', 'Ziggy', 'Olive', 'Bandit', 'Peaches'];
const PET_KINDS = ['dog', 'cat', 'cat', 'dog', 'rescue mutt', 'tabby', 'pit mix', 'beagle', 'orange cat', 'bearded dragon'];
const HOMETOWNS = ['Waco, TX', 'Toledo, OH', 'Fresno, CA', 'Dayton, OH', 'Lubbock, TX', 'Tucson, AZ', 'Baton Rouge, LA', 'Little Rock, AR', 'Wichita, KS', 'Reno, NV', 'Albany, NY', 'Bakersfield, CA', 'Tulsa, OK', 'Corpus Christi, TX', 'Mobile, AL', 'Spokane, WA', 'Shreveport, LA', 'Peoria, IL', 'Chattanooga, TN', 'Amarillo, TX', 'Springfield, MO', 'Scranton, PA', 'El Paso, TX', 'Boise, ID', 'Macon, GA', 'Fort Wayne, IN', 'Duluth, MN', 'Yuma, AZ', 'Erie, PA', 'Lakeland, FL'];
const DREAMS = ['opening a small food truck', 'paying off every last loan', 'buying a little house with a yard', 'moving to the coast', 'finishing the degree', 'running a marathon before forty', 'a year of travel with no return ticket', 'making a living from music', 'getting the kids through college debt-free', 'owning the place they work at', 'writing a book nobody asked for', 'retiring early enough to enjoy it', 'a cabin with no cell service', 'being the person people call when things go wrong'];
const FEARS = ['ending up like their father', 'being broke at fifty', 'hospitals', 'driving on the interstate at night', 'being forgotten', 'dogs (a childhood bite)', 'flying', 'getting fired without warning', 'being alone in a big house', 'the phone ringing after midnight', 'crowds', 'saying the wrong thing and losing someone', 'needles', 'deep water'];
const FOODS = ['breakfast tacos', 'their mom\'s pozole', 'gas-station fried chicken', 'Whataburger at 1 a.m.', 'pad see ew from the place on the corner', 'brisket, no sauce', 'boxed mac and cheese', 'pho with extra jalapeños', 'a Costco hot dog', 'Sunday pancakes', 'anything with pickles', 'Detroit-style pizza', 'their grandmother\'s cornbread', 'sushi they can\'t afford'];
const BANDS = ['Turnstile', 'Zach Bryan', 'Bad Bunny', 'the Killers', 'Beyoncé', 'Tyler Childers', 'Fleetwood Mac', 'Kendrick', 'Phoebe Bridgers', 'Morgan Wallen', 'Radiohead', 'SZA', 'Tool', 'Chappell Roan', 'the Strokes', 'Selena', 'Dolly Parton', 'Metallica', 'Olivia Rodrigo', 'Outkast'];
const TRAIT_WORDS = ['stubborn', 'impatient', 'soft-hearted', 'private', 'restless', 'competitive', 'sentimental', 'blunt', 'cautious', 'proud', 'easygoing', 'nosy', 'loyal', 'thrifty', 'dramatic', 'meticulous'];
const EMPLOYERS = ['the H-E-B on the highway', 'a dental office off the loop', 'a regional trucking outfit', 'the county', 'a chain restaurant', 'an Amazon warehouse', 'a small law firm', 'the school district', 'a Chevy dealership', 'a hospital system', 'a roofing company', 'a call center'];
const TEAMS_BY_STATE: Record<string, string[]> = {
  TX: ['the Cowboys', 'the Astros', 'the Spurs', 'the Longhorns', 'the Rangers', 'Texas A&M'],
  CA: ['the Dodgers', 'the Warriors', 'the 49ers', 'the Lakers', 'the Rams'],
  NY: ['the Yankees', 'the Knicks', 'the Bills', 'the Giants', 'the Mets'],
  FL: ['the Bucs', 'the Dolphins', 'the Gators', 'the Heat', 'the Rays'],
  IL: ['the Bears', 'the Cubs', 'the Bulls', 'the White Sox'],
  OH: ['the Browns', 'the Bengals', 'the Buckeyes', 'the Guardians'],
  PA: ['the Eagles', 'the Steelers', 'the Phillies', 'the Penguins'],
  GA: ['the Braves', 'the Falcons', 'the Bulldogs'],
  MI: ['the Lions', 'the Tigers', 'Michigan', 'the Red Wings'],
  WA: ['the Seahawks', 'the Mariners', 'the Huskies'],
  AZ: ['the Cardinals', 'the Suns', 'the Diamondbacks'],
  CO: ['the Broncos', 'the Nuggets', 'the Rockies'],
  MA: ['the Patriots', 'the Red Sox', 'the Celtics'],
  TN: ['the Titans', 'the Vols', 'the Predators'],
  NC: ['the Panthers', 'Duke', 'UNC', 'the Hornets'],
  MN: ['the Vikings', 'the Twins', 'the Wild'],
  WI: ['the Packers', 'the Brewers', 'the Bucks'],
  MO: ['the Chiefs', 'the Cardinals', 'the Royals'],
  LA: ['the Saints', 'LSU', 'the Pelicans'],
  NV: ['the Raiders', 'the Golden Knights'],
  OR: ['the Blazers', 'the Ducks'],
};
const DEFAULT_TEAMS = ['the Cowboys', 'the Yankees', 'the Lakers', 'the Steelers', 'whoever is playing the Patriots'];
const SUMMARY_FILLER = [
  'Most weeks look the same: work, errands, a couple of nights on the couch, one night out if the money allows.',
  'People who know {first} well describe {first} as {trait}, which {first} takes as a compliment about half the time.',
  '{first} keeps a running list of things to fix and a longer list of things to ignore.',
  'Weekends are for {hobby}, laundry, and whatever {partner} has planned.',
  'The car needs work, the phone bill is a week late, and none of it is a crisis yet.',
  '{first} still calls home most Sundays, even when there is nothing new to say.',
  'Nobody in {city} would call {first} a local, but after this long it is starting to feel like home.',
  'Ask about {team} or {band} and you will get twenty minutes; ask about feelings and you get a shrug.',
];

type Tmpl = BioTemplate & { minAge?: number; maxAge?: number };
const t = (category: BioCategory, text: string, o: { secret?: boolean; depth?: number; minAge?: number; maxAge?: number; weight?: number } = {}): Tmpl => ({
  category,
  text,
  secret: o.secret ?? false,
  depth: o.depth ?? DEPTH_BY_CATEGORY[category],
  minAge: o.minAge,
  maxAge: o.maxAge,
  weight: o.weight ?? 1,
});

/** Built-in bank used when `content.bioTemplates` is thin. */
export const BUILTIN_BIO_TEMPLATES: Tmpl[] = [
  // origin
  t('origin', 'Grew up in {hometown} and moved to {city} {year_ago} years ago.', { minAge: 18 }),
  t('origin', 'Born and raised in {hometown}; still says "back home" when talking about it.'),
  t('origin', 'Family moved to {city} when {first} was {n} because of a job; never left.'),
  t('origin', 'The {last} side of the family has been in {state} for four generations.', { weight: 0.6 }),
  // family
  t('family', 'Has {sibling_count} siblings; {first} is the one who still calls their mother every Sunday.'),
  t('family', 'Parents divorced when {first} was {n}; splits holidays between two houses to this day.', { depth: 30 }),
  t('family', 'Closest to a cousin who lives in {hometown}; they text almost daily.'),
  t('family', 'Father worked at {employer} for years; {first} swore never to do the same, then did.', { minAge: 22, depth: 30 }),
  t('family', 'Has a kid, {n} years old, who lives with {first} most of the week.', { minAge: 24, maxAge: 55, depth: 15, weight: 0.7 }),
  t('family', 'Has not spoken to a brother in {n} years over money; nobody in the family brings it up.', { secret: true, minAge: 25 }),
  // childhood
  t('childhood', 'Was the kid who read the whole encyclopedia set in the garage in {hometown}.', { weight: 0.7 }),
  t('childhood', 'Broke an arm falling off a trampoline at {n}; still has the crooked wrist to show for it.'),
  t('childhood', 'Spent summers at a grandmother\'s house with no air conditioning and a chest freezer full of popsicles.'),
  t('childhood', 'Was bullied in middle school for a stutter that mostly went away by high school.', { depth: 45, secret: true, weight: 0.5 }),
  // education
  t('education', 'Graduated from {school}; still has the letter jacket somewhere.', { minAge: 18 }),
  t('education', 'Did two semesters of community college before the money ran out.', { minAge: 20, depth: 30, weight: 0.8 }),
  t('education', 'Finished a degree at night while working full time; it took {n} years.', { minAge: 26, depth: 25, weight: 0.7 }),
  t('education', 'Currently in school; the tuition bill is the thing that keeps {first} up at night.', { maxAge: 25, depth: 15 }),
  // career
  t('career', 'Works as a {job} at {employer}; has been there {year_ago} years.', { minAge: 18 }),
  t('career', 'Got the {job} job through a friend of a friend after {n} months of applying to everything.', { minAge: 18 }),
  t('career', 'Was passed over for a promotion last year and is quietly looking for something else.', { minAge: 22, depth: 35, secret: true }),
  t('career', 'Before this, drove for a delivery app for {n} months and still has the insulated bag in the trunk.', { minAge: 20, weight: 0.7 }),
  t('career', 'Was let go from a previous job for "attitude"; tells people it was layoffs.', { minAge: 22, secret: true, depth: 65 }),
  // romance
  t('romance', 'Has been with {partner} for {n} years; they met at a friend\'s barbecue.', { minAge: 20, depth: 20 }),
  t('romance', 'Broke up with {ex} about {year_ago} years ago; still checks their profile more than they should.', { minAge: 19, depth: 45 }),
  t('romance', 'Single and says it is by choice; it is about half by choice.', { minAge: 20, depth: 35 }),
  t('romance', 'Was briefly engaged to {ex}; the ring got returned and the story rarely gets told.', { minAge: 25, secret: true, depth: 70, weight: 0.7 }),
  t('romance', 'Has a crush on someone at work and has told exactly one person.', { minAge: 18, secret: true, depth: 75, weight: 0.6 }),
  // health
  t('health', 'Gets migraines when the weather changes; keeps ibuprofen in every bag.', { depth: 30 }),
  t('health', 'Has been trying to quit vaping for {n} months, with mixed results.', { minAge: 18, depth: 35, weight: 0.7 }),
  t('health', 'Was diagnosed with anxiety in {hometown} at {n}; takes medication and does not talk about it.', { secret: true, depth: 70, minAge: 20 }),
  t('health', 'Bad knee from years of {hobby}; feels it on cold mornings.', { minAge: 28, depth: 20 }),
  // money
  t('money', 'Carries about ${n},000 in credit card debt from a rough stretch a couple of years ago.', { minAge: 21, secret: true, depth: 60 }),
  t('money', 'Sends money to family in {hometown} every month, no matter how tight things are.', { minAge: 20, depth: 45 }),
  t('money', 'Has exactly one savings goal, a used truck, and a jar of cash labeled for it.', { depth: 30 }),
  t('money', 'Lent {ex} a chunk of money years ago and never saw it again; still keeps the Venmo request open.', { minAge: 22, secret: true, depth: 65, weight: 0.7 }),
  t('money', 'Student loans of about ${n}0,000; pays the minimum and tries not to look at the balance.', { minAge: 22, maxAge: 50, depth: 45, weight: 0.8 }),
  // hobby
  t('hobby', 'Spends most free evenings on {hobby}; has gotten genuinely good at it.'),
  t('hobby', 'Picked up {hobby2} during a slow winter and never dropped it.'),
  t('hobby', 'Never misses a {team} game; has a lucky shirt that is not allowed in the wash during the season.'),
  t('hobby', 'Has seen {band} live {n} times and will tell you about every one.'),
  // belief
  t('belief', 'Raised religious in {hometown}; goes to services a couple of times a year, mostly for family.', { depth: 30 }),
  t('belief', 'Believes people mostly get what they work for, and is uneasy about the exceptions.', { depth: 30 }),
  t('belief', 'Does not vote and gets defensive about it.', { depth: 40, weight: 0.6 }),
  t('belief', 'Thinks the city is changing too fast and says so to anyone who will listen.', { depth: 25 }),
  // fear
  t('fear', 'Terrified of {fear}; will change plans to avoid it.', { depth: 50 }),
  t('fear', 'Biggest fear is {fear}; has never said it out loud.', { secret: true, depth: 70 }),
  // dream
  t('dream', 'Dreams of {dream}; has a folder of screenshots about it.', { depth: 35 }),
  t('dream', 'Secretly wants {dream} and is embarrassed by how much.', { secret: true, depth: 60 }),
  // habit
  t('habit', 'Drinks {n} cups of coffee before noon and calls it "just one".'),
  t('habit', 'Cannot fall asleep without a fan running, even in winter.'),
  t('habit', 'Always parks in the same spot and gets thrown off when it is taken.'),
  t('habit', 'Eats {food} at least once a week, usually alone in the car.'),
  // quirk
  t('quirk', 'Names every car {first} has owned; the current one is called "the Boat".'),
  t('quirk', 'Hums {band} songs without noticing, badly, at work.'),
  t('quirk', 'Keeps every receipt in a shoebox and has never once looked at them.'),
  t('quirk', 'Refers to the {pet} as "my roommate".'),
  // relationship
  t('relationship', 'Best friend since high school is still in {hometown}; they talk every few days and fight about {team}.', { depth: 30 }),
  t('relationship', 'Has a neighbor who watches the {pet} when {first} travels, in exchange for beer.', { depth: 25 }),
  t('relationship', 'Does not get along with their manager and keeps a list of the reasons on their phone.', { minAge: 18, depth: 45, secret: true, weight: 0.7 }),
  // trauma
  t('trauma', 'Lost a close friend in a car accident at {n}; does not drive on the highway at night since.', { secret: true, depth: 80, minAge: 20 }),
  t('trauma', 'Was in a bad relationship in their early twenties that {first} describes, when pressed, as "a lot".', { secret: true, depth: 85, minAge: 26, weight: 0.7 }),
  t('trauma', 'The house in {hometown} burned when {first} was {n}; the family lost almost everything.', { secret: true, depth: 75, weight: 0.5 }),
  // achievement
  t('achievement', 'Ran a half marathon {year_ago} years ago and has the medal on the fridge.', { minAge: 18 }),
  t('achievement', 'Won a regional {hobby} competition once; the trophy is in a closet.'),
  t('achievement', 'First in the family to finish high school, a fact the family repeats at every holiday.', { depth: 25 }),
  t('achievement', 'Paid off a car loan early and considers it the proudest moment of adult life so far.', { minAge: 22, depth: 25 }),
  // daily_life
  t('daily_life', 'Up at {n} most days, coffee, {job} shift, home, and something easy for dinner.'),
  t('daily_life', 'Lives with a {pet} that runs the household.'),
  t('daily_life', 'Grocery shops on Sunday nights when the store is empty; hates crowds.'),
  t('daily_life', 'Takes the same route to work every day and knows the timing of every light.'),
  // opinion
  t('opinion', 'Thinks {food} is the best food in {city}, full stop.'),
  t('opinion', 'Has strong opinions about {band} and will defend them at length.'),
  t('opinion', 'Believes tipping culture has gotten out of hand, but tips well anyway.'),
  t('opinion', 'Thinks {team} will never win anything again and watches every game anyway.'),
  // secret
  t('secret', 'Got a DUI at {n}0; it is expunged now and nobody in {city} knows.', { secret: true, depth: 85, minAge: 25 }),
  t('secret', 'Has a second phone that {partner} does not know about.', { secret: true, depth: 90, minAge: 22, weight: 0.4 }),
  t('secret', 'Owes a former roommate ${n}00 and has been avoiding their texts for months.', { secret: true, depth: 70, minAge: 19 }),
  t('secret', 'Once shoplifted regularly as a teenager; stopped after nearly getting caught at a Target in {hometown}.', { secret: true, depth: 75, minAge: 18 }),
  t('secret', 'Applied for a job in another state last month and has not told anyone.', { secret: true, depth: 70, minAge: 20 }),
];

export function buildBioTokens(state: WorldState, sim: Sim, content: ContentCatalog, rng: RNG): BioTokens {
  const age = ageAt(sim.identity.birthDate, state.epoch, state.time.minute);
  const region = state.region;
  const g = sim.identity.gender;
  const partnerRel = Object.values(sim.relationships).find((r) => r.flags.some((f) => ['married', 'engaged', 'partner', 'dating'].includes(f)));
  const exRel = Object.values(sim.relationships).find((r) => r.flags.some((f) => ['ex', 'divorced'].includes(f)));
  const partnerSim = partnerRel ? state.sims[partnerRel.simId] : undefined;
  const exSim = exRel ? state.sims[exRel.simId] : undefined;
  const prefersWomen = sim.personality.sexuality === 'gay' ? g === 'female' : sim.personality.sexuality === 'straight' ? g !== 'female' : rng.chance(0.5);
  const partnerPool = prefersWomen ? FIRST_F : FIRST_M;
  const exPool = rng.chance(0.85) ? partnerPool : prefersWomen ? FIRST_M : FIRST_F;
  const hobbyNames = sim.hobbies.map((h) => content.hobbies[h]?.name?.toLowerCase() ?? titleWords(h).toLowerCase());
  const allHobbies = Object.values(content.hobbies).map((h) => h.name.toLowerCase());
  const hobby = hobbyNames[0] ?? (allHobbies.length ? rng.pick(allHobbies) : 'fishing');
  let hobby2 = hobbyNames[1] ?? (allHobbies.length ? rng.pick(allHobbies.filter((h) => h !== hobby)) : 'cooking');
  if (hobby2 === hobby) hobby2 = 'cooking';
  const traitName = sim.personality.traits.length ? (content.traits[rng.pick(sim.personality.traits)]?.name ?? rng.pick(TRAIT_WORDS)).toLowerCase() : rng.pick(TRAIT_WORDS);
  const job = sim.career.job?.title ?? sim.role?.title ?? (sim.role ? titleWords(sim.role.role) : undefined) ?? (age < 18 ? 'student' : age >= 65 ? 'retiree' : rng.pick(['temp worker', 'gig driver', 'job seeker']));
  const roleVenue = sim.role?.venueId ? state.venues[sim.role.venueId] : undefined;
  const employer = sim.career.job?.employerName ?? roleVenue?.name ?? rng.pick(EMPLOYERS);
  const hh = sim.householdId ? state.households[sim.householdId] : undefined;
  const petObj = hh?.petIds.map((p) => state.pets[p]).find((p) => p && p.alive);
  const localHometown = !sim.identity.hometown || sim.identity.hometown === 'here';
  const hometown = localHometown ? (rng.chance(0.55) ? `${region.name}, ${region.stateCode}` : rng.pick(HOMETOWNS)) : sim.identity.hometown;
  const townOnly = hometown.split(',')[0];
  const nameList = content.names?.first?.[g] ?? [];
  const school = rng.chance(0.6) ? `${townOnly} High` : rng.pick([`${rng.pick(['Central', 'North', 'East', 'Lake', 'Memorial', 'Roosevelt', 'Jefferson'])} High in ${townOnly}`, `${townOnly} Community College`]);
  void nameList;
  return {
    first: sim.identity.firstName,
    last: sim.identity.lastName,
    age: String(age),
    hometown,
    city: region.name,
    state: region.state,
    job: job.toLowerCase(),
    employer,
    hobby,
    hobby2,
    trait: traitName,
    partner: partnerSim?.identity.firstName ?? rng.pick(partnerPool),
    ex: exSim?.identity.firstName ?? rng.pick(exPool.filter((n) => n !== partnerSim?.identity.firstName)),
    pet: petObj ? `${petObj.name} the ${petObj.breed || petObj.species}` : `${rng.pick(PET_NAMES)} the ${rng.pick(PET_KINDS)}`,
    sibling_count: ['no', 'one', 'two', 'three', 'four'][Math.min(4, Math.max(0, Math.round(rng.normalClamped(1.8, 1.2, 0, 4))))],
    dream: rng.pick(DREAMS),
    fear: rng.pick(FEARS),
    food: rng.pick(FOODS),
    team: rng.pick(TEAMS_BY_STATE[region.stateCode] ?? DEFAULT_TEAMS),
    band: rng.pick(BANDS),
    school,
    year_ago: String(Math.max(1, Math.min(rng.int(1, 12), age - 17))),
    n: String(rng.int(2, 9)),
  };
}

export function expandTemplate(text: string, tokens: BioTokens, rng: RNG, age: number): string {
  return text.replace(/\{(\w+)\}/g, (_m, key: string) => {
    if (key === 'n') return String(rng.int(2, 9));
    if (key === 'year_ago') return String(Math.max(1, Math.min(rng.int(1, 12), Math.max(1, age - 17))));
    const v = (tokens as unknown as Record<string, string>)[key];
    return v ?? `{${key}}`;
  });
}

export function generateBioFallback(state: WorldState, sim: Sim, content: ContentCatalog, opts: { count?: number } = {}): { summary: string; facts: BioFact[] } {
  const rng = new RNG(`bio:${sim.bio.seed}`);
  const age = ageAt(sim.identity.birthDate, state.epoch, state.time.minute);
  const tokens = buildBioTokens(state, sim, content, rng);
  const catalog = (content.bioTemplates ?? []) as Tmpl[];
  const pool = (catalog.length >= 20 ? catalog : [...catalog, ...BUILTIN_BIO_TEMPLATES]).filter((tp) => (tp.minAge === undefined || age >= tp.minAge) && (tp.maxAge === undefined || age <= tp.maxAge) && tp.weight > 0);
  const target = Math.min(pool.length, Math.max(14, Math.min(22, opts.count ?? rng.int(16, 20))));

  const facts: BioFact[] = [];
  const perCategory = new Map<BioCategory, number>();
  const used = new Set<Tmpl>();
  const add = (category: BioCategory, text: string, secret: boolean, depth: number) => {
    facts.push({ id: `bf_${rng.uuidLike()}`, category, text, secret, depth: Math.round(Math.max(0, Math.min(100, depth))), revealedTo: [] });
    perCategory.set(category, (perCategory.get(category) ?? 0) + 1);
  };

  // hard facts from existing family/partner relationships (fixed names)
  const relFacts = Object.values(sim.relationships)
    .map((r) => ({ r, o: state.sims[r.simId] }))
    .filter((x) => x.o)
    .slice(0, 3);
  for (const { r, o } of relFacts) {
    const name = `${o!.identity.firstName} ${o!.identity.lastName}`;
    const f = r.flags;
    if (f.includes('married')) add('family', `Married to ${name}; they have been together ${tokens.n} years.`, false, 10);
    else if (f.includes('engaged')) add('romance', `Engaged to ${name}; no date set yet.`, false, 12);
    else if (f.includes('partner') || f.includes('dating')) add('romance', `Seeing ${name}; it is getting serious.`, false, 18);
    else if (f.includes('ex') || f.includes('divorced')) add('romance', `${name} is an ex; it did not end well.`, false, 40);
    else if (f.includes('child')) add('family', `Parent of ${o!.identity.firstName}, ${ageAt(o!.identity.birthDate, state.epoch, state.time.minute)}.`, false, 8);
    else if (f.includes('parent')) add('family', `${o!.identity.firstName} ${o!.identity.lastName} is ${sim.identity.firstName}'s ${o!.identity.gender === 'female' ? 'mother' : o!.identity.gender === 'male' ? 'father' : 'parent'}.`, false, 8);
    else if (f.includes('sibling')) add('family', `Has a ${o!.identity.gender === 'female' ? 'sister' : o!.identity.gender === 'male' ? 'brother' : 'sibling'}, ${o!.identity.firstName}, ${ageAt(o!.identity.birthDate, state.epoch, state.time.minute)}.`, false, 10);
    else if (f.includes('roommate')) add('daily_life', `Shares a place with ${o!.identity.firstName}.`, false, 5);
  }

  const secretTarget = Math.round(target * 0.3);
  const pickFrom = (cands: Tmpl[]): Tmpl | undefined => {
    const avail = cands.filter((c) => !used.has(c) && (perCategory.get(c.category) ?? 0) < 3);
    if (!avail.length) return undefined;
    return rng.weighted(avail.map((c) => ({ weight: c.weight, value: c })));
  };
  const commit = (tp: Tmpl) => {
    used.add(tp);
    const depth = tp.secret ? Math.max(60, tp.depth) : tp.depth + rng.int(-4, 4);
    add(tp.category, expandTemplate(tp.text, tokens, rng, age), tp.secret, depth);
  };

  // secrets first (category-diverse)
  const secretPool = pool.filter((p) => p.secret);
  while (facts.filter((f) => f.secret).length < secretTarget) {
    const tp = pickFrom(secretPool);
    if (!tp) break;
    commit(tp);
  }
  // one per category in shuffled order for coverage
  const openPool = pool.filter((p) => !p.secret);
  const cats = rng.shuffle([...new Set(openPool.map((p) => p.category))]);
  for (const c of cats) {
    if (facts.length >= target) break;
    if ((perCategory.get(c) ?? 0) > 0 && c !== 'daily_life' && c !== 'career') continue;
    const tp = pickFrom(openPool.filter((p) => p.category === c));
    if (tp) commit(tp);
  }
  // fill
  while (facts.length < target) {
    const tp = pickFrom(openPool);
    if (!tp) break;
    commit(tp);
  }

  const summary = buildSummary(sim, tokens, rng, age, facts);
  return { summary, facts };
}

function buildSummary(sim: Sim, tk: BioTokens, rng: RNG, age: number, facts: BioFact[]): string {
  const first = tk.first;
  const p = sim.personality;
  const they = sim.identity.gender === 'female' ? 'she' : sim.identity.gender === 'male' ? 'he' : 'they';
  const has = they === 'they' ? 'have' : 'has';
  const is = they === 'they' ? 'are' : 'is';
  const local = tk.hometown.startsWith(tk.city);
  const sentences: string[] = [
    `${first} ${tk.last} is ${age}, ${local ? `born and raised in ${tk.city}` : `originally from ${tk.hometown}`}, and ${age < 18 ? 'still in school' : `works as a ${tk.job} at ${tk.employer}`}.`,
    `${cap(they)} ${is} ${p.extraversion >= 0.6 ? 'easy to talk to and quick to fill a silence' : p.extraversion <= 0.4 ? 'quiet until ${first} knows you, then hard to stop' : 'friendly enough, in a take-it-or-leave-it way'}, ${p.conscientiousness >= 0.6 ? 'reliable to a fault' : p.conscientiousness <= 0.4 ? 'chronically late and unbothered by it' : 'organized about the things that matter and nothing else'}, and, by ${they === 'they' ? 'their' : they === 'she' ? 'her' : 'his'} own account, ${tk.trait}.`.replace('${first}', first),
    `Free time goes to ${tk.hobby} and, lately, ${tk.hobby2}; ${they} ${has} strong opinions about ${tk.food} and ${tk.team}.`,
    age >= 20 ? (facts.some((f) => f.category === 'romance' && !f.secret) ? `There is ${tk.partner} in the picture, more or less.` : `${cap(they)} ${is} single, and mostly fine with it.`) : `Home is a full house with ${tk.sibling_count === 'no' ? 'no siblings' : `${tk.sibling_count} siblings`} and not much privacy.`,
    `What ${they} ${they === 'they' ? 'want' : 'wants'} is ${tk.dream}; what ${they} ${they === 'they' ? 'fear' : 'fears'} is ${tk.fear}.`,
    `Money is ${p.values.wealth >= 0.6 ? 'a constant calculation' : 'tight but manageable'}, and ${first} ${they === 'they' ? 'have' : 'has'} a couple of things ${they} ${they === 'they' ? 'don\'t' : 'doesn\'t'} tell people about.`,
  ];
  const fillers = rng.shuffle(SUMMARY_FILLER);
  let text = sentences.join(' ');
  let fi = 0;
  while (wordCount(text) < 130 && fi < fillers.length) {
    text += ' ' + fillers[fi++].replace(/\{(\w+)\}/g, (_m, k: string) => (tk as unknown as Record<string, string>)[k] ?? k);
  }
  while (wordCount(text) > 200) {
    const idx = text.lastIndexOf('. ');
    if (idx <= 0) break;
    text = text.slice(0, idx + 1);
  }
  return text;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}
