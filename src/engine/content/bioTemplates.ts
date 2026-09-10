/**
 * Templated biography facts (owned by the simgen builder). The LLM layer's fallback bio generator
 * expands `{tokens}` deterministically from the sim record; the real LLM bio path may also use
 * these as inspiration. Every `BioCategory` has ≥ 10 templates.
 *
 * TOKENS (all optional in a template; unknown tokens are left for the expander to fill sensibly):
 *   {first}          sim's first name                     {age}           current age in years
 *   {hometown}       identity.hometown                    {city} {state}  the current region
 *   {sibling_count}  "an only child" | "one of N kids"    {job}           current job title (or "between jobs")
 *   {employer}       employer name                        {hobby}         one of the sim's hobbies (human label)
 *   {skill}          a skill the sim is best at           {trait}         a trait label
 *   {pet}            a pet name/species ("a beagle named Rex") or "no pets"
 *   {partner}        partner/spouse first name or "nobody right now"
 *   {ex}             an ex's first name                   {dream}         aspiration text
 *   {fear}           a fear noun ("heights", "hospitals") {food}          favorite food
 *   {drink}          favorite drink                       {team}          a local sports team
 *   {band}           a favorite band/artist               {show}          a favorite TV show
 *   {car}            a car make/model                     {school}        a school/college name
 *   {year_ago}       a number of years (1–20)             {number}        a small number (2–9)
 *   {season}         a season                             {holiday}       a holiday name
 *   {relative}       "grandmother" | "uncle" | …          {friend}        a friend's first name
 *
 * `depth` is the familiarity typically needed before the fact comes up; `secret` facts need trust.
 */
import type { BioTemplate } from './types';

const T = (category: BioTemplate['category'], text: string, opts: Partial<BioTemplate> = {}): BioTemplate => ({
  category,
  text,
  secret: opts.secret ?? false,
  depth: opts.depth ?? (opts.secret ? 60 : 15),
  weight: opts.weight ?? 1,
  minAge: opts.minAge,
  maxAge: opts.maxAge,
});

export const BIO_TEMPLATES: BioTemplate[] = [
  // ---- origin --------------------------------------------------------------
  T('origin', 'Grew up in {hometown} and moved to {city} {year_ago} years ago.', { depth: 5 }),
  T('origin', 'Born and raised in {city}; has never lived anywhere else and is a little defensive about it.', { depth: 5 }),
  T('origin', 'Moved to {city} for a job that fell through two weeks after arriving, and stayed anyway.', { depth: 20 }),
  T('origin', 'Grew up on a military base and went to {number} different schools before high school.', { depth: 10 }),
  T('origin', "Family came to the US when {first} was {number}; still translates for {relative} at appointments.", { depth: 15 }),
  T('origin', 'Grew up in a small town outside {hometown} where everyone knew their business; came to {city} partly to be anonymous.', { depth: 15 }),
  T('origin', 'Was raised mostly by {relative} after both parents worked nights.', { depth: 25 }),
  T('origin', 'Grew up in a trailer park and still bristles when people joke about them.', { depth: 30 }),
  T('origin', 'Spent every summer as a kid at a lake cabin in {state}; it is still their favorite place on earth.', { depth: 10 }),
  T('origin', 'Grew up above the family restaurant in {hometown} and can still smell fryer oil in old photos.', { depth: 10 }),
  T('origin', 'Left {hometown} the week after graduation with $300 and a duffel bag.', { depth: 20, minAge: 22 }),
  T('origin', 'Is {sibling_count}; the family group chat has 40 unread messages at any given time.', { depth: 5 }),

  // ---- family --------------------------------------------------------------
  T('family', 'Is {sibling_count} and the one everyone calls when something breaks.', { depth: 10 }),
  T('family', "Calls their mom every Sunday, without fail, even when there's nothing to say.", { depth: 10 }),
  T('family', "Hasn't spoken to their father in {year_ago} years and would rather not explain why.", { depth: 45, secret: true, minAge: 20 }),
  T('family', 'Has a younger sibling who is the "successful one" and it comes up more than it should.', { depth: 25 }),
  T('family', "{relative} lives with them now; it's fine, mostly.", { depth: 20, minAge: 30 }),
  T('family', 'Has {number} nieces and nephews and knows every one of their birthdays.', { depth: 10, minAge: 25 }),
  T('family', 'Parents divorced when they were 12; spent years splitting holidays between two houses.', { depth: 25 }),
  T('family', 'Their {relative} taught them to cook, fish, and swear, roughly in that order.', { depth: 10 }),
  T('family', 'Is quietly the person paying {relative}\'s phone bill.', { depth: 40, secret: true, minAge: 25 }),
  T('family', 'Was raised by grandparents and thinks of them as their parents.', { depth: 20 }),
  T('family', 'Has a kid from a previous relationship who lives with the other parent most of the time.', { depth: 30, minAge: 24 }),
  T('family', 'The whole extended family descends on their place every {holiday} whether they like it or not.', { depth: 15, minAge: 28 }),

  // ---- childhood -----------------------------------------------------------
  T('childhood', 'Was the kid who read under the desk during class.', { depth: 10 }),
  T('childhood', 'Broke an arm falling off a roof at 9, trying to get a frisbee.', { depth: 10 }),
  T('childhood', 'Played {hobby} obsessively as a kid and still has the trophies in a box somewhere.', { depth: 15 }),
  T('childhood', 'Was bullied badly in middle school and became the funny one to survive it.', { depth: 35 }),
  T('childhood', 'Had a paper route at 11 and has been working ever since.', { depth: 15 }),
  T('childhood', 'Was a competitive spelling bee kid; lost the regional final on "onomatopoeia."', { depth: 15 }),
  T('childhood', 'Grew up without cable and is still catching up on shows everyone else saw in 2009.', { depth: 10 }),
  T('childhood', 'Spent childhood summers working on {relative}\'s farm; can still drive a tractor.', { depth: 15 }),
  T('childhood', 'Had a best friend named {friend} in third grade who moved away; still thinks about them.', { depth: 25 }),
  T('childhood', 'Got lost at the state fair at 6 and was found eating a corn dog with the security guards.', { depth: 10 }),
  T('childhood', 'Was a theater kid. Still knows every word of the musical they did junior year.', { depth: 15 }),
  T('childhood', 'Learned to swim by being thrown into a lake by {relative}; harbors a grudge.', { depth: 15 }),

  // ---- education -----------------------------------------------------------
  T('education', 'Went to {school} for two years before the money ran out.', { depth: 20, minAge: 20 }),
  T('education', 'Was the first in the family to finish college and felt the weight of it the whole time.', { depth: 25, minAge: 22 }),
  T('education', 'Dropped out of high school at 17 and got a GED at 24, quietly proud of it.', { depth: 30, minAge: 25 }),
  T('education', 'Has a degree in something completely unrelated to their job and gets asked about it constantly.', { depth: 15, minAge: 23 }),
  T('education', 'Is still paying student loans and will be until roughly {age} plus fifteen.', { depth: 20, minAge: 23 }),
  T('education', 'Took night classes at community college while working full time.', { depth: 20, minAge: 22 }),
  T('education', 'Got kicked out of a class in college for arguing with the professor, and was right.', { depth: 25, minAge: 20 }),
  T('education', 'Was a straight-A student until sophomore year, when something changed.', { depth: 30 }),
  T('education', 'Learned more from YouTube than from any teacher and says so.', { depth: 10 }),
  T('education', 'Did a trade program instead of college and out-earns most of their friends who went.', { depth: 20, minAge: 24 }),
  T('education', 'Is taking online classes right now and nobody at work knows.', { depth: 40, secret: true, minAge: 20 }),
  T('education', 'Has a certification in {skill} that took three attempts to pass.', { depth: 20, minAge: 20 }),

  // ---- career --------------------------------------------------------------
  T('career', 'Works as a {job} at {employer} and is better at it than the pay suggests.', { depth: 5, minAge: 16 }),
  T('career', 'Has been a {job} for {year_ago} years and is starting to wonder if that was the plan.', { depth: 20, minAge: 25 }),
  T('career', 'Got fired from a job at 19 for something that genuinely was not their fault.', { depth: 30, minAge: 20 }),
  T('career', 'Runs a small side business selling {hobby} stuff online; it almost breaks even.', { depth: 20, minAge: 18 }),
  T('career', 'Interviewed for a dream job last {season} and never heard back.', { depth: 30, minAge: 20 }),
  T('career', 'Was a manager once and hated it; went back to the floor on purpose.', { depth: 25, minAge: 28 }),
  T('career', 'Has worked at {number} different places in the last five years.', { depth: 15, minAge: 20 }),
  T('career', 'Is quietly looking for another job and keeps their resume on their phone.', { depth: 45, secret: true, minAge: 18 }),
  T('career', 'Their boss takes credit for their work and everyone but the boss knows it.', { depth: 30, minAge: 18 }),
  T('career', 'Turned down a promotion because it meant moving away from {relative}.', { depth: 35, minAge: 25 }),
  T('career', 'Drives for a delivery app on weekends to cover the difference.', { depth: 20, minAge: 18 }),
  T('career', 'Wants to open a place of their own someday; has a name picked out and a notebook of menus.', { depth: 25, minAge: 20 }),

  // ---- romance -------------------------------------------------------------
  T('romance', 'Is seeing {partner} and it is going better than expected.', { depth: 15, minAge: 16 }),
  T('romance', 'Broke up with {ex} last {season} and is still finding their stuff in drawers.', { depth: 25, minAge: 18 }),
  T('romance', 'Has been single for {year_ago} years and has stopped pretending it bothers them.', { depth: 25, minAge: 22 }),
  T('romance', 'Married young, divorced younger, and does not recommend either.', { depth: 35, minAge: 28 }),
  T('romance', 'Has a crush on someone at work and is handling it terribly.', { depth: 45, secret: true, minAge: 18 }),
  T('romance', 'Deleted the dating apps three times this year. Reinstalled them four.', { depth: 20, minAge: 20 }),
  T('romance', "Still has {ex}'s hoodie and wears it when nobody's around.", { depth: 50, secret: true, minAge: 18 }),
  T('romance', 'Met {partner} at {employer}; the whole staff knew before they did.', { depth: 20, minAge: 18 }),
  T('romance', 'Was engaged once. It ended {year_ago} years ago and they kept the ring in a drawer.', { depth: 45, secret: true, minAge: 25 }),
  T('romance', 'Has been with {partner} for {year_ago} years and has never once cooked for them.', { depth: 20, minAge: 22 }),
  T('romance', 'Thinks they are bad at dating; is actually just bad at texting back.', { depth: 25, minAge: 18 }),
  T('romance', 'Got ghosted after a genuinely great third date and still wonders what happened.', { depth: 30, minAge: 20 }),

  // ---- health --------------------------------------------------------------
  T('health', 'Has a bad knee from {hobby} and predicts rain with it.', { depth: 15, minAge: 25 }),
  T('health', 'Is allergic to cats and owns {pet} anyway.', { depth: 15 }),
  T('health', 'Has not been to a dentist in {year_ago} years and knows they should go.', { depth: 25, minAge: 20 }),
  T('health', 'Has migraines that show up on the worst possible days.', { depth: 25 }),
  T('health', 'Quit smoking {year_ago} years ago and still wants one after every meal.', { depth: 30, minAge: 25 }),
  T('health', 'Was in a car accident at {number}teen and hates being a passenger.', { depth: 30, minAge: 18 }),
  T('health', 'Takes medication for anxiety and has strong feelings about the copay.', { depth: 45, secret: true, minAge: 18 }),
  T('health', "Can't see anything without glasses and lost a pair in a lake once.", { depth: 10 }),
  T('health', 'Has been sober for {year_ago} years. Counts every day.', { depth: 50, secret: true, minAge: 22 }),
  T('health', 'Runs every morning at 5:30 and is insufferable about it.', { depth: 10, minAge: 18 }),
  T('health', 'Is lactose intolerant and ignores it heroically.', { depth: 10 }),
  T('health', 'Has no health insurance right now and drives very carefully.', { depth: 35, minAge: 19 }),

  // ---- money ---------------------------------------------------------------
  T('money', 'Has about $400 in savings and calls it the emergency fund.', { depth: 40, secret: true, minAge: 18 }),
  T('money', 'Owes {number} thousand on a credit card from a bad year and is chipping away at it.', { depth: 45, secret: true, minAge: 20 }),
  T('money', 'Is unexpectedly good with money and has a spreadsheet for everything.', { depth: 25, minAge: 20 }),
  T('money', 'Sends money to family back in {hometown} every month.', { depth: 35, minAge: 20 }),
  T('money', 'Won $2,000 on a scratch-off once and spent it in a weekend.', { depth: 20, minAge: 18 }),
  T('money', 'Lent {friend} $800 two years ago and has given up on it.', { depth: 40, secret: true, minAge: 20 }),
  T('money', 'Split rent three ways with roommates until last year and misses the cheap part.', { depth: 20, minAge: 22 }),
  T('money', 'Has a car loan they regret on a {car} they love.', { depth: 25, minAge: 20 }),
  T('money', 'Grew up poor and still stockpiles canned goods.', { depth: 30 }),
  T('money', 'Buys lottery tickets every Friday and calls it a hobby.', { depth: 15, minAge: 18 }),
  T('money', 'Got a small inheritance from {relative} and has not told anyone.', { depth: 55, secret: true, minAge: 22 }),
  T('money', 'Is behind on a medical bill they are pretending does not exist.', { depth: 50, secret: true, minAge: 20 }),

  // ---- hobby ---------------------------------------------------------------
  T('hobby', 'Is deeply into {hobby} and will talk about it as long as you let them.', { depth: 5 }),
  T('hobby', 'Plays in a {band}-cover band that has played exactly two shows.', { depth: 15, minAge: 18 }),
  T('hobby', 'Has a {hobby} setup in the garage that cost more than the car parked next to it.', { depth: 20, minAge: 22 }),
  T('hobby', 'Watches {show} every night before bed and has for years.', { depth: 10 }),
  T('hobby', 'Is a diehard {team} fan and has been disappointed by them for decades.', { depth: 5 }),
  T('hobby', 'Grows tomatoes on the balcony and gives them away to the neighbors.', { depth: 10, minAge: 22 }),
  T('hobby', 'Goes to trivia every Tuesday with the same three people.', { depth: 15, minAge: 21 }),
  T('hobby', 'Has read every book by one author and refuses to name a favorite.', { depth: 10 }),
  T('hobby', 'Fishes off the pier on Sunday mornings and never keeps anything.', { depth: 10 }),
  T('hobby', 'Is learning guitar from an app and can play {number} songs badly.', { depth: 10 }),
  T('hobby', 'Runs a fantasy football league with a 14-page rulebook.', { depth: 15, minAge: 18 }),
  T('hobby', 'Does {hobby} on weekends and posts about it more than they do it.', { depth: 10 }),

  // ---- belief --------------------------------------------------------------
  T('belief', 'Goes to church every Sunday, mostly for the people.', { depth: 15 }),
  T('belief', 'Was raised religious and is quietly not anymore; hasn\'t told the family.', { depth: 45, secret: true, minAge: 18 }),
  T('belief', 'Believes in karma in a practical, keep-score sort of way.', { depth: 20 }),
  T('belief', 'Thinks most people are basically decent, and is often disappointed.', { depth: 20 }),
  T('belief', 'Reads horoscopes "for fun" and has never once made a decision against one.', { depth: 15 }),
  T('belief', 'Is convinced the {team} are cursed and can explain the timeline.', { depth: 10 }),
  T('belief', 'Votes in every election, including the school board, and judges people who don\'t.', { depth: 20, minAge: 18 }),
  T('belief', 'Thinks hard work is rewarded and is starting to reconsider.', { depth: 30, minAge: 25 }),
  T('belief', 'Keeps a rosary from {relative} in the car, not sure if it counts as praying.', { depth: 25 }),
  T('belief', 'Believes the {city} of twenty years ago was better and will tell you why.', { depth: 15, minAge: 35 }),
  T('belief', 'Believes in ghosts because of one specific night in {hometown}.', { depth: 25 }),
  T('belief', 'Is a strict vegetarian on ethical grounds and never brings it up first.', { depth: 15 }),

  // ---- secret --------------------------------------------------------------
  T('secret', 'Has a second phone that {partner} does not know about.', { secret: true, depth: 75, minAge: 20 }),
  T('secret', 'Was arrested once at 19 for something dumb; the record was sealed.', { secret: true, depth: 65, minAge: 22 }),
  T('secret', 'Has been quietly applying for jobs in another state.', { secret: true, depth: 60, minAge: 20 }),
  T('secret', 'Never actually graduated from {school}; nobody has checked.', { secret: true, depth: 80, minAge: 24 }),
  T('secret', 'Is the one who dented the neighbor\'s car and drove off.', { secret: true, depth: 70, minAge: 18 }),
  T('secret', 'Has a savings account {partner} does not know about, "just in case."', { secret: true, depth: 75, minAge: 25 }),
  T('secret', 'Reads {partner}\'s texts when they are in the shower.', { secret: true, depth: 80, minAge: 18 }),
  T('secret', 'Writes fan fiction under a pen name with a surprising number of readers.', { secret: true, depth: 55 }),
  T('secret', 'Lied about their age on their job application by {number} years.', { secret: true, depth: 70, minAge: 18 }),
  T('secret', 'Has not filed taxes in {number} years.', { secret: true, depth: 75, minAge: 22 }),
  T('secret', 'Was in love with {friend} for years and never said a word.', { secret: true, depth: 70, minAge: 18 }),
  T('secret', 'Took the fall for a sibling once and has never told anyone what actually happened.', { secret: true, depth: 80, minAge: 18 }),

  // ---- fear ----------------------------------------------------------------
  T('fear', 'Is terrified of {fear} and will go to great lengths to avoid it.', { depth: 20 }),
  T('fear', 'Is afraid of ending up like their father.', { depth: 50, secret: true, minAge: 22 }),
  T('fear', 'Hates hospitals since {relative} died in one.', { depth: 40, minAge: 18 }),
  T('fear', 'Cannot handle deep water; the lake incident.', { depth: 25 }),
  T('fear', 'Is scared of being ordinary and works too hard because of it.', { depth: 40, minAge: 20 }),
  T('fear', 'Dreads phone calls from unknown numbers; it is never good news.', { depth: 15 }),
  T('fear', 'Is afraid of dogs after a bite at age {number}, and pretends not to be.', { depth: 25 }),
  T('fear', 'Worries constantly about money, even the months there is enough.', { depth: 30, minAge: 20 }),
  T('fear', 'Is afraid of flying and drives everywhere, including to {hometown}, 14 hours away.', { depth: 20 }),
  T('fear', 'Fears being forgotten by their kids more than anything.', { depth: 45, minAge: 35 }),
  T('fear', 'Panics in crowds; leaves concerts early.', { depth: 30 }),
  T('fear', 'Is afraid of getting old alone and jokes about it too often.', { depth: 40, minAge: 30 }),

  // ---- dream ---------------------------------------------------------------
  T('dream', 'Wants to {dream} more than anything and has a plan that is 70% real.', { depth: 25 }),
  T('dream', 'Dreams of moving to the coast and opening a tiny place that sells one perfect thing.', { depth: 25, minAge: 22 }),
  T('dream', 'Wants to see the northern lights before turning {age} plus ten.', { depth: 15 }),
  T('dream', 'Wants to buy a house with a yard for {pet}.', { depth: 20, minAge: 22 }),
  T('dream', 'Would quit tomorrow to be a full-time {hobby} person if it paid.', { depth: 20, minAge: 18 }),
  T('dream', 'Wants kids someday and is not sure the timing will ever feel right.', { depth: 35, minAge: 24, maxAge: 45 }),
  T('dream', 'Wants to go back to school and finish what they started.', { depth: 30, minAge: 24 }),
  T('dream', 'Dreams of taking {relative} back to {hometown} one last time.', { depth: 35, minAge: 25 }),
  T('dream', 'Wants to run a marathon and has signed up twice without showing up.', { depth: 15, minAge: 18 }),
  T('dream', 'Wants to be the person people call when things go wrong; already kind of is.', { depth: 25 }),
  T('dream', 'Is saving for a {car}, and it is not a practical one.', { depth: 15, minAge: 18 }),
  T('dream', 'Wants to write a book about {hometown}. Has the first chapter and the title.', { depth: 25, minAge: 20 }),

  // ---- habit ---------------------------------------------------------------
  T('habit', 'Drinks {number} cups of coffee before noon and denies it is a problem.', { depth: 5, minAge: 16 }),
  T('habit', 'Goes to the same {food} place every Friday and orders the same thing.', { depth: 10 }),
  T('habit', 'Cannot fall asleep without {show} playing in the background.', { depth: 15 }),
  T('habit', 'Cracks their knuckles when nervous, which is often.', { depth: 5 }),
  T('habit', 'Checks the locks three times before bed.', { depth: 15 }),
  T('habit', 'Always orders {drink}, even at places where it makes no sense.', { depth: 10, minAge: 16 }),
  T('habit', 'Walks {pet} at exactly 6:15 every morning; the neighbors set clocks by it.', { depth: 10 }),
  T('habit', 'Keeps every receipt in a shoebox and has never once looked at them.', { depth: 15 }),
  T('habit', 'Says "no worries" when there are, in fact, worries.', { depth: 5 }),
  T('habit', 'Hums {band} songs while working and does not notice.', { depth: 10 }),
  T('habit', 'Bites their nails; has tried the bitter polish twice.', { depth: 10 }),
  T('habit', 'Naps in the car on lunch break, seat all the way back.', { depth: 15, minAge: 18 }),

  // ---- quirk ---------------------------------------------------------------
  T('quirk', 'Can name every county in {state} in order and will if provoked.', { depth: 10 }),
  T('quirk', 'Refuses to use the self-checkout on principle.', { depth: 10 }),
  T('quirk', 'Has named their car {friend} and talks to it.', { depth: 15, minAge: 16 }),
  T('quirk', 'Only eats {food} with a very specific condiment nobody else has heard of.', { depth: 10 }),
  T('quirk', 'Collects hotel pens; has a drawer of over 200.', { depth: 15 }),
  T('quirk', 'Speaks to {pet} in a voice reserved only for {pet}.', { depth: 10 }),
  T('quirk', 'Cannot stand the sound of chewing and wears earbuds at lunch.', { depth: 15 }),
  T('quirk', 'Reads the last page of a book first.', { depth: 10 }),
  T('quirk', 'Gives directions using landmarks that closed years ago.', { depth: 10, minAge: 30 }),
  T('quirk', 'Has an elaborate handshake with {friend} that takes eleven seconds.', { depth: 15 }),
  T('quirk', 'Rates every sunset out of ten and keeps a list.', { depth: 15 }),
  T('quirk', 'Sings the wrong lyrics to {band} songs with total confidence.', { depth: 5 }),

  // ---- relationship --------------------------------------------------------
  T('relationship', "Best friend is {friend}; they've known each other since they were {number}.", { depth: 15 }),
  T('relationship', 'Has a group chat with three friends from {hometown} that has not gone quiet in eight years.', { depth: 15, minAge: 20 }),
  T('relationship', 'Is on good terms with {ex}, which confuses everyone.', { depth: 25, minAge: 20 }),
  T('relationship', 'Has a coworker who is basically a sibling at this point.', { depth: 15, minAge: 18 }),
  T('relationship', 'Had a falling out with {friend} over money and misses them.', { depth: 40, minAge: 20 }),
  T('relationship', 'Is the friend who plans everything and gets thanked for none of it.', { depth: 20 }),
  T('relationship', "Is godparent to {friend}'s kid and takes it seriously.", { depth: 20, minAge: 24 }),
  T('relationship', 'Has a neighbor they have been feuding with over a fence for {number} years.', { depth: 20, minAge: 30 }),
  T('relationship', 'Made most of their friends through {hobby}.', { depth: 10 }),
  T('relationship', 'Has a mentor from a first job they still call for advice.', { depth: 25, minAge: 22 }),
  T('relationship', 'Is estranged from a sibling and it is the one topic that shuts them down.', { depth: 45, secret: true, minAge: 22 }),
  T('relationship', 'Is the one everyone at {employer} confides in, whether they want to be or not.', { depth: 20, minAge: 18 }),

  // ---- trauma --------------------------------------------------------------
  T('trauma', 'Lost {relative} suddenly {year_ago} years ago and never really talks about it.', { depth: 45, secret: true, minAge: 16 }),
  T('trauma', 'Was in a house fire as a kid; still keeps a bag packed by the door.', { depth: 40, secret: true }),
  T('trauma', 'Got out of a bad relationship with {ex} and rebuilt from nothing.', { depth: 50, secret: true, minAge: 20 }),
  T('trauma', 'Was laid off the same week {partner} left; that year is a blur.', { depth: 45, secret: true, minAge: 25 }),
  T('trauma', 'Watched the family business fail and swore never to depend on one thing.', { depth: 40, minAge: 22 }),
  T('trauma', 'Was in a serious wreck on the interstate at {number}teen; hates rain on the highway.', { depth: 35, minAge: 18 }),
  T('trauma', 'Was evicted once, with kids, and will never be behind on rent again.', { depth: 50, secret: true, minAge: 28 }),
  T('trauma', 'Has a scar from something they describe only as "a bad night in {hometown}."', { depth: 55, secret: true, minAge: 20 }),
  T('trauma', 'Was robbed at work once and still flinches when the door chime sounds.', { depth: 40, minAge: 18 }),
  T('trauma', 'Had a miscarriage nobody at work knows about.', { depth: 70, secret: true, minAge: 22 }),
  T('trauma', 'Grew up with a parent who drank; reads every room for the mood first.', { depth: 50, secret: true }),
  T('trauma', 'Lost a friend to an overdose and got very quiet about the subject.', { depth: 55, secret: true, minAge: 20 }),

  // ---- achievement ---------------------------------------------------------
  T('achievement', 'Once won a regional {hobby} competition and still has the plaque.', { depth: 15 }),
  T('achievement', 'Paid off {number} thousand in debt in a year by eating rice and beans.', { depth: 25, minAge: 22 }),
  T('achievement', 'Ran a half marathon last {season} and cried at the finish line.', { depth: 15, minAge: 18 }),
  T('achievement', 'Was employee of the month at {employer} {number} times.', { depth: 10, minAge: 18 }),
  T('achievement', 'Built the deck out back with their own hands and one YouTube video.', { depth: 15, minAge: 22 }),
  T('achievement', 'Taught themselves {skill} well enough to get paid for it.', { depth: 15, minAge: 18 }),
  T('achievement', 'Got {relative} into the country after {number} years of paperwork.', { depth: 35, minAge: 25 }),
  T('achievement', 'Got their kid into a good school by sheer persistence.', { depth: 25, minAge: 30 }),
  T('achievement', 'Survived a year of unemployment without moving back home.', { depth: 25, minAge: 23 }),
  T('achievement', 'Was on the local news once for catching a runaway dog.', { depth: 10 }),
  T('achievement', 'Has a perfect attendance streak at work going back {number} years.', { depth: 15, minAge: 20 }),
  T('achievement', 'Wrote a song that {band} would be proud of; only {friend} has heard it.', { depth: 30 }),

  // ---- daily_life ----------------------------------------------------------
  T('daily_life', 'Commutes {number}0 minutes each way and listens to true crime the whole time.', { depth: 5, minAge: 18 }),
  T('daily_life', 'Lives with {number} roommates and a rotating cast of their partners.', { depth: 10, minAge: 18, maxAge: 35 }),
  T('daily_life', 'Meal preps every Sunday and eats the same lunch five days straight.', { depth: 10, minAge: 18 }),
  T('daily_life', 'Wakes up at 5 for work and is asleep by 9, weekends included.', { depth: 5, minAge: 18 }),
  T('daily_life', 'Spends most of Saturday at the laundromat with a book.', { depth: 10, minAge: 18 }),
  T('daily_life', 'Has a standing Thursday dinner with {friend} at the same {food} place.', { depth: 15 }),
  T('daily_life', 'Does the crossword every morning in pen, and cheats.', { depth: 10 }),
  T('daily_life', 'Goes to the gym at 10pm because it is empty.', { depth: 10, minAge: 18 }),
  T('daily_life', 'Takes the bus everywhere and knows every driver by name.', { depth: 10 }),
  T('daily_life', 'Grocery shops at 7am on Sunday to avoid everyone.', { depth: 10, minAge: 18 }),
  T('daily_life', 'Calls {relative} on the drive home every day.', { depth: 10, minAge: 18 }),
  T('daily_life', 'Has a porch routine: coffee, {pet}, the news, silence.', { depth: 10, minAge: 25 }),

  // ---- opinion -------------------------------------------------------------
  T('opinion', 'Thinks {city} traffic is a moral failing of the city council.', { depth: 5 }),
  T('opinion', 'Believes {food} from {hometown} is objectively better and will not be argued with.', { depth: 5 }),
  T('opinion', 'Thinks tipping culture has gotten out of hand and tips 25% anyway.', { depth: 10, minAge: 18 }),
  T('opinion', 'Thinks {band} peaked with their second album.', { depth: 5 }),
  T('opinion', 'Is convinced {show} was ruined by its last season.', { depth: 5 }),
  T('opinion', 'Thinks rent in {city} is a scam and has the numbers to prove it.', { depth: 10, minAge: 18 }),
  T('opinion', 'Believes nobody under 30 knows how to change a tire, and is often right.', { depth: 10, minAge: 30 }),
  T('opinion', 'Thinks the {team} should fire the coach, has thought so for three coaches.', { depth: 5 }),
  T('opinion', 'Thinks self-driving cars are a mistake and says so to every rideshare driver.', { depth: 10 }),
  T('opinion', 'Believes the best {drink} in town is at a gas station on the east side.', { depth: 10, minAge: 16 }),
  T('opinion', 'Thinks {season} is the only good season and the others are punishment.', { depth: 5 }),
  T('opinion', 'Thinks {city} is getting too expensive for the people who made it worth living in.', { depth: 15 }),
];

export const BIO_TEMPLATE_COUNT = BIO_TEMPLATES.length;
