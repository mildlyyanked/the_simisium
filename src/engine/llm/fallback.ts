/**
 * Deterministic, network-free LLMService. Used when there is no API key, when a live call fails,
 * and in tests. Seeded from `state.meta.seed + time.minute` (+ the input text) so it replays.
 */
import type { ContentCatalog } from '../content/types';
import { ageAt, formatClock, minuteOfDay, partOfDay } from '../core/clock';
import { liquidCash } from '../core/effects';
import type { InteractionOutcome, LLMService, SceneSnapshot } from '../core/llmTypes';
import { RNG } from '../core/rng';
import type { ActionDef, BioCategory, BioFact, EffectBundle, EmotionId, Sim, SimId, Venue, VenueId, WorldState } from '../core/types';
import { haversineKm, kmToMiles } from '../core/util';
import { generateBioFallback } from './bioFallback';
import { buildSceneContext, needWords, relationshipLabel, titleWords } from './context';

type Intent = 'greeting' | 'goodbye' | 'compliment' | 'insult' | 'flirt' | 'ask_money' | 'ask_job' | 'ask_family' | 'ask_hobby' | 'ask_origin' | 'ask_personal' | 'question' | 'apology' | 'smalltalk';

const INTENT_RULES: [Intent, RegExp][] = [
  ['goodbye', /\b(bye|goodbye|see you|see ya|later|gotta go|take care|good night|goodnight|talk soon)\b/i],
  ['insult', /\b(stupid|idiot|ugly|hate you|shut up|loser|moron|dumb|pathetic|worthless|jerk|screw you|f+u+c*k+ (you|off)|suck)\b/i],
  ['apology', /\b(sorry|apologi[sz]e|my bad|forgive me)\b/i],
  ['ask_money', /\b(lend|borrow|spot me|spare|loan|can i have|give me)\b.*\b(money|cash|bucks|dollars|\$\d+|twenty|fifty|hundred)\b|\b(money|cash|bucks|dollars)\b.*\b(lend|borrow|spot|spare|loan)\b|\$\d+/i],
  ['flirt', /\b(cute|gorgeous|beautiful|handsome|hot|sexy|single|your number|a drink sometime|go out|date|dinner sometime|kiss|attractive|pretty eyes)\b/i],
  ['compliment', /\b(nice|love your|great|awesome|amazing|cool|good job|well done|impressive|like your|you're good|you are good|talented|thank you|thanks)\b/i],
  ['ask_job', /\b(job|work|working|shift|boss|career|do for a living|what do you do|paid|salary|hiring)\b/i],
  ['ask_family', /\b(family|mom|dad|mother|father|parents|kids|children|sister|brother|siblings|married|husband|wife|grandma|grandpa)\b/i],
  ['ask_hobby', /\b(hobby|hobbies|for fun|free time|weekend|weekends|like to do|into|favorite|music|band|team|game|sports)\b/i],
  ['ask_origin', /\b(where are you from|grew up|hometown|originally|born|from around here|local)\b/i],
  ['ask_personal', /\b(secret|afraid|fear|dream|regret|worst|biggest|ever been|tell me about yourself|your story|really like)\b/i],
  ['greeting', /^(hi|hey|hello|yo|howdy|good (morning|afternoon|evening)|what's up|whats up|sup|morning|evening)\b/i],
  ['question', /\?\s*$/],
];

const CATEGORY_FOR_INTENT: Partial<Record<Intent, BioCategory[]>> = {
  ask_job: ['career', 'education', 'daily_life'],
  ask_family: ['family', 'childhood', 'origin'],
  ask_hobby: ['hobby', 'opinion', 'habit'],
  ask_origin: ['origin', 'childhood', 'education'],
  ask_personal: ['dream', 'fear', 'belief', 'quirk', 'achievement', 'relationship'],
  smalltalk: ['daily_life', 'opinion', 'habit', 'hobby'],
  question: ['daily_life', 'opinion', 'career', 'hobby'],
};

export class FallbackLLMService implements LLMService {
  constructor(private readonly content: ContentCatalog) {}

  isLive(): boolean {
    return false;
  }

  private rngFor(state: WorldState, salt: string): RNG {
    return new RNG(`${state.meta.seed}:${state.time.minute}:${salt}`);
  }

  // ---------------------------------------------------------------------
  // converse
  // ---------------------------------------------------------------------
  async converse(scene: SceneSnapshot, targetId: SimId, playerText: string, opts: { channel?: 'in_person' | 'phone' | 'text' | 'video' } = {}): Promise<InteractionOutcome> {
    const { state, actor } = scene;
    const npc = state.sims[targetId] ?? scene.present[0];
    const rng = this.rngFor(state, `converse:${targetId}:${playerText}`);
    if (!npc) {
      return this.outcome({ narration: 'There is nobody here to talk to.', minutes: 1, followUps: ['Look around', 'Leave', 'Wait a while'] });
    }
    const text = playerText.trim();
    const intent = classifyIntent(text);
    const rel = npc.relationships[actor.id];
    const relToActor = actor.relationships[npc.id];
    const familiarity = rel?.familiarity ?? 0;
    const friendship = rel?.friendship ?? 0;
    const stage = friendship >= 30 && familiarity >= 15 ? 'friend' : familiarity >= 5 || (rel?.interactionsCount ?? 0) > 0 ? 'acquaintance' : 'stranger';
    const traits = new Set(npc.personality.traits);
    const mood = npc.mind.mood;
    const grumpy = mood < -15 || traits.has('gloomy') || traits.has('mean') || traits.has('hot_headed') || npc.mind.stress > 70;
    const warm = traits.has('cheerful') || traits.has('kind') || traits.has('outgoing') || traits.has('empathetic');
    const busy = isOnShift(npc, state) && (scene.venue.noise > 55 || (npc.currentAction !== undefined && npc.currentAction.actionId !== 'idle'));
    const name = actor.identity.firstName;
    const npcFirst = npc.identity.firstName;
    const channel = opts.channel ?? scene.conversation?.channel ?? 'in_person';

    const lines: string[] = [];
    let emotion: EmotionId = grumpy ? 'bored' : warm ? 'happy' : 'relaxed';
    const actorFx: EffectBundle = { needs: { social: 5, fun: 2 }, relationships: [{ simId: npc.id, familiarity: 2, mutual: false }] };
    const npcRel: NonNullable<EffectBundle['relationships']>[number] = { simId: actor.id, familiarity: 2, mutual: false };
    const npcFx: EffectBundle = { relationships: [npcRel] };
    const revealed: { simId: SimId; factIds: string[] }[] = [];
    const memories: InteractionOutcome['npcMemories'] = [];
    let ends = false;
    let narration = '';
    let followUps: string[] = [];

    const revealFact = (cats: BioCategory[]): BioFact | undefined => {
      const maxDepth = familiarity + 25 + (friendship > 0 ? friendship / 4 : 0) + (warm ? 5 : 0) - (grumpy ? 10 : 0);
      const cands = npc.bio.facts.filter((f) => !f.secret && cats.includes(f.category) && f.depth <= maxDepth && !f.revealedTo.includes(actor.id));
      if (!cands.length) return undefined;
      const f = rng.pick(cands);
      revealed.push({ simId: npc.id, factIds: [f.id] });
      return f;
    };
    const deflect = (): string => rng.pick([`${grumpy ? "Not really something I get into." : "Ha, that's a longer story."} ${stage === 'stranger' ? "We just met." : "Maybe another time."}`, `Eh. ${grumpy ? 'Pass.' : "I'll tell you sometime."}`, `You ask a lot of questions. ${warm ? "I don't mind, though." : ''}`.trim()]);
    const asFact = (f: BioFact): string => firstPersonize(f.text, npc);

    switch (intent) {
      case 'greeting': {
        lines.push(
          busy
            ? rng.pick([`Hey. ${rng.pick(["Give me one sec.", "Bit slammed right now.", "What can I get you?"])}`, `${rng.pick(['Hi.', 'Hey there.'])} It's a little crazy in here.`])
            : grumpy
              ? rng.pick(['Hey.', "Yeah, hi.", `${name}. What's up.`])
              : stage === 'stranger'
                ? rng.pick([`Hi there. ${warm ? "How's it going?" : ''}`.trim(), `Hey. ${rng.pick(['Do I know you?', 'Nice out today, right?', "What's up?"])}`])
                : rng.pick([`Hey ${name}! Good to see you.`, `${name}! What's going on?`, `Oh hey, ${name}. How've you been?`]),
        );
        emotion = grumpy ? 'bored' : 'happy';
        followUps = ['Ask how their day is going', `Ask ${npcFirst} what they do for work`, 'Make a joke about the weather'];
        break;
      }
      case 'goodbye': {
        lines.push(grumpy ? rng.pick(['Yep.', 'Later.', 'See you.']) : rng.pick([`See you around, ${name}.`, 'Take care!', `Later, ${name}. Don't be a stranger.`]));
        ends = true;
        emotion = 'relaxed';
        followUps = ['Head out', 'Look around the place', 'Check your phone'];
        break;
      }
      case 'compliment': {
        const rec = traits.has('vain') || traits.has('self_assured') ? rng.pick(["I know, right?", 'Finally, someone notices.']) : grumpy ? rng.pick(['...Thanks, I guess.', 'Okay.', "What do you want?"]) : rng.pick(["Oh, thank you! That's sweet.", 'Ha, thanks. Appreciate that.', "Well, aren't you nice."]);
        lines.push(rec);
        emotion = grumpy ? 'uncomfortable' : 'happy';
        npcRel.friendship = grumpy ? 1 : 4;
        npcRel.trust = 1;
        actorFx.needs!.social = 6;
        followUps = ['Ask what they are up to today', `Ask ${npcFirst} about themselves`, 'Change the subject to something local'];
        break;
      }
      case 'insult': {
        lines.push(traits.has('hot_headed') || traits.has('mean') ? rng.pick(["Excuse me? Say that again.", "Wow. Get out of my face.", "You're lucky I'm working right now."]) : traits.has('stoic') || traits.has('self_assured') ? rng.pick(['Okay.', "Cool. We're done here."]) : rng.pick(["...What? What did I do?", "Wow. Okay. Have a good one.", "That's really unnecessary."]));
        emotion = traits.has('hot_headed') ? 'angry' : 'embarrassed';
        npcRel.friendship = -8;
        npcRel.trust = -5;
        actorFx.needs = { social: -2, fun: -2 };
        actorFx.moodlets = [{ emotion: 'tense', label: 'Made a scene', intensity: -6, durationMinutes: 90 }];
        narration = `${npcFirst} stiffens. ${rng.pick(['A couple of heads turn.', 'The air goes cold.', 'Nobody else says anything.'])}`;
        memories.push({ simId: npc.id, text: `${name} insulted me out of nowhere. Not forgetting that.`, salience: 65, valence: -0.8 });
        ends = rng.chance(0.4) || stage === 'stranger';
        followUps = ['Apologize', 'Walk away', 'Double down'];
        break;
      }
      case 'apology': {
        const grudge = (rel?.grudges.length ?? 0) > 0 || friendship < -5;
        lines.push(grudge ? rng.pick(["...Fine. We're not square, but fine.", "It's going to take more than sorry, honestly.", 'Okay. I hear you.']) : rng.pick(["It's fine, really.", 'No worries.', "You're good, don't sweat it."]));
        emotion = grudge ? 'tense' : 'relaxed';
        npcRel.friendship = grudge ? 3 : 1;
        npcRel.trust = 2;
        followUps = ['Offer to make it up to them', 'Ask how they have been', 'Leave it there and say goodbye'];
        break;
      }
      case 'flirt': {
        const single = !Object.values(npc.relationships).some((r) => r.flags.some((f) => ['married', 'engaged', 'partner', 'dating'].includes(f)));
        const compatible = isCompatible(actor, npc);
        const interested = single && compatible && !busy && !grumpy && ((rel?.attraction ?? 0) >= 20 || (relToActor?.romance ?? 0) > 0 || rng.chance(0.35 + npc.personality.libido * 0.3 + (traits.has('romantic') || traits.has('hopeless_romantic') ? 0.15 : 0)));
        if (busy) {
          lines.push(rng.pick([`I'm kind of in the middle of a rush. Did you need something?`, `Ha. Okay. ${rng.pick(['Anything else?', 'Next!', "I've got a line."])}`]));
          emotion = 'uncomfortable';
          npcRel.friendship = -2;
          npcRel.romance = -3;
          actorFx.moodlets = [{ emotion: 'embarrassed', label: 'Bad timing', intensity: -5, durationMinutes: 60 }];
          followUps = ['Apologize and order something', 'Come back when it is quieter', 'Leave'];
        } else if (interested) {
          lines.push(rng.pick([`Oh? ${rng.pick(["Well. Okay.", 'Is that so.', "Bold of you."])} ${rng.pick(["I'm not saying no.", 'Keep talking.', "You're not bad yourself."])}`, `${rng.pick(['Ha.', 'Okay.'])} ${rng.pick(["Maybe. What'd you have in mind?", "I get off at " + shiftEndLabel(npc, state) + ".", 'Give me your number and we\'ll see.'])}`]));
          emotion = 'flirty';
          npcRel.romance = 5;
          npcRel.attraction = 3;
          npcRel.friendship = 2;
          actorFx.relationships!.push({ simId: npc.id, romance: 3, mutual: false });
          actorFx.moodlets = [{ emotion: 'flirty', label: 'That went well', intensity: 8, durationMinutes: 120 }];
          memories.push({ simId: npc.id, text: `${name} flirted with me and I didn't hate it.`, salience: 55, valence: 0.6 });
          followUps = ['Ask for their number', 'Suggest a specific time and place', 'Play it cool and change the subject'];
        } else {
          lines.push(single ? rng.pick(["Ha. I'm good, thanks.", "That's... nice of you. Not really looking, though.", `${warm ? "You're sweet." : "Okay."} I'm gonna pass.`]) : rng.pick([`I'm seeing someone, actually. But thanks.`, 'Ha, my partner would love that. No.', "Taken. Sorry."]));
          emotion = 'uncomfortable';
          npcRel.romance = -3;
          npcRel.friendship = -1;
          actorFx.moodlets = [{ emotion: 'embarrassed', label: 'Shot down', intensity: -6, durationMinutes: 90 }];
          followUps = ['Laugh it off and apologize', 'Ask something normal instead', 'Say goodbye'];
        }
        break;
      }
      case 'ask_money': {
        const owe = rel?.moneyOwed ?? 0;
        if (stage === 'friend' && friendship >= 45 && (rel?.trust ?? 0) >= 20 && owe >= 0) {
          const amt = Math.min(40, Math.round(liquidCash(npc) * 0.05));
          if (amt >= 10) {
            lines.push(rng.pick([`How much? ...Okay, I can do $${amt}, but I want it back Friday.`, `Ugh. Fine. $${amt}. Don't make it a thing.`]));
            actorFx.money = { amount: amt, memo: `Borrowed from ${npcFirst}`, counterparty: npc.identity.firstName };
            npcRel.trust = -2;
            memories.push({ simId: npc.id, text: `Lent ${name} $${amt}. Expecting it back by Friday.`, salience: 60, valence: -0.2 });
            followUps = ['Promise to pay it back Friday', 'Thank them and change the subject', 'Ask for a little more'];
            emotion = 'tense';
            break;
          }
        }
        lines.push(stage === 'stranger' ? rng.pick(["Sorry, no.", "I don't carry cash.", "Yeah, I'm not doing that."]) : rng.pick([`I'm tapped out myself, ${name}.`, "Not right now, honestly. Things are tight.", `Didn't you still owe me from last time?`]));
        emotion = 'uncomfortable';
        npcRel.friendship = -2;
        npcRel.trust = -3;
        followUps = ['Drop it and apologize', 'Explain why you need it', 'Ask about something else'];
        break;
      }
      case 'ask_job':
      case 'ask_family':
      case 'ask_hobby':
      case 'ask_origin':
      case 'ask_personal':
      case 'question':
      case 'smalltalk': {
        const cats = CATEGORY_FOR_INTENT[intent] ?? CATEGORY_FOR_INTENT.smalltalk!;
        const f = busy && rng.chance(0.5) ? undefined : revealFact(cats);
        if (f) {
          lines.push(`${rng.pick(grumpy ? ['Eh.', 'Sure.', 'I mean...'] : ['Oh,', 'Honestly?', 'Ha, well,'])} ${asFact(f)}`);
          if (warm && rng.chance(0.5)) lines.push(rng.pick([`What about you, ${name}?`, 'And you?', "Anyway. What's your deal?"]));
          npcRel.friendship = 2;
          npcRel.familiarity = 3;
          actorFx.relationships![0].familiarity = 3;
          emotion = f.category === 'fear' || f.category === 'trauma' ? 'anxious' : f.category === 'achievement' || f.category === 'hobby' ? 'proud' : 'relaxed';
          memories.push({ simId: npc.id, text: `Told ${name} about ${f.category === 'career' ? 'my job' : f.category === 'family' ? 'my family' : f.category === 'origin' ? 'where I\'m from' : `my ${f.category.replace('_', ' ')}`}.`, salience: 30, valence: 0.3 });
        } else if (busy) {
          lines.push(rng.pick([`Can't really chat right now, ${stage === 'stranger' ? 'sorry' : name}. ${rng.pick(['Rush hour.', "Come back after " + shiftEndLabel(npc, state) + ".", 'Boss is watching.'])}`, `Hang on... yeah, no, it's nuts in here.`]));
          emotion = 'stressed';
          ends = rng.chance(0.5);
        } else if (intent === 'ask_personal' || (intent === 'question' && stage === 'stranger')) {
          lines.push(deflect());
          emotion = 'uncomfortable';
          npcRel.familiarity = 1;
        } else {
          lines.push(rng.pick(smalltalkBank(scene, npc, actor, rng, grumpy, warm)));
          npcRel.friendship = 1;
        }
        followUps = followUpsFor(intent, npcFirst, rng);
        break;
      }
    }

    if (busy && !ends && rng.chance(0.25)) {
      lines.push(rng.pick(["Okay, I've really got to get back to it.", "Sorry, duty calls.", "Give me a minute."]));
      ends = true;
    }
    if (traits.has('gossip') && !busy && rng.chance(0.3)) lines.push(rng.pick(['Did you hear about the place down the street? Total mess.', "Don't tell anyone I said that."]));
    if (channel === 'text') for (let i = 0; i < lines.length; i++) lines[i] = lines[i].replace(/\s+/g, ' ').slice(0, 140);

    const minutes = channel === 'text' ? rng.int(1, 3) : rng.int(3, 6);
    const otherEffects: Record<SimId, EffectBundle> = { [npc.id]: npcFx };
    if (!narration && rng.chance(0.35) && channel === 'in_person') narration = ambientNarration(scene, npc, rng);
    return this.outcome({
      narration,
      dialogue: lines.filter(Boolean).map((t, i) => ({ speakerId: npc.id, text: t, emotion: i === 0 ? emotion : undefined })),
      effects: actorFx,
      otherEffects,
      revealedFacts: revealed,
      npcMemories: memories,
      followUps: followUps.length ? followUps : ['Keep talking', 'Ask something else', 'Say goodbye'],
      endsConversation: ends,
      minutes,
    });
  }

  // ---------------------------------------------------------------------
  // adjudicate
  // ---------------------------------------------------------------------
  async adjudicate(scene: SceneSnapshot, text: string, _opts: { action?: ActionDef } = {}): Promise<InteractionOutcome> {
    const { state, actor, venue } = scene;
    const rng = this.rngFor(state, `adjudicate:${text}`);
    const t = text.trim();
    const lower = t.toLowerCase();
    const ctx = buildSceneContext(scene, { content: this.content, allowMoveTo: true });
    const skill = (id: string) => actor.skills[id]?.level ?? 0;
    const drunk = actor.body.bloodAlcohol >= 0.08;
    const home = ctx.venue.isHome;
    const fx: EffectBundle = {};
    let narration = '';
    let minutes = 5;
    let followUps: string[] = [];
    let dialogue: InteractionOutcome['dialogue'] = [];
    const other: Record<SimId, EffectBundle> = {};
    const memories: InteractionOutcome['npcMemories'] = [];

    const goMatch = /\b(?:go|head|walk|drive|travel|get)\s+(?:over\s+)?(?:to|toward|towards|into)\s+(?:the\s+)?(.+?)\s*[.!]?$/i.exec(t);
    const dest = goMatch ? findVenueByName(state, goMatch[1], venue.id) : undefined;

    if (dest) {
      const miles = kmToMiles(haversineKm(venue.location, dest.location));
      const driving = /\bdrive\b/i.test(t) || miles > 1.5;
      minutes = Math.max(3, Math.round(driving ? miles * 3 + 5 : miles * 20));
      fx.moveTo = { venueId: dest.id };
      fx.timeElapsedMinutes = minutes;
      fx.needs = { energy: driving ? -2 : -Math.min(15, Math.round(miles * 4)), comfort: -3 };
      narration = `You ${driving ? 'drive' : 'walk'} the ${miles < 0.2 ? 'short way' : `${miles.toFixed(1)} miles`} to ${dest.name}${partOfDay(minuteOfDay(state.time.minute + minutes)) === 'night' ? ' under the streetlights' : ''}.`;
      followUps = ['Look around', 'Talk to someone here', 'Head back'];
    } else if (/\b(sleep|go to bed|nap|lie down|lay down|doze|rest)\b/.test(lower)) {
      const nap = /\b(nap|doze|rest|lie down|lay down)\b/.test(lower);
      const hasBed = home || venue.archetype === 'hotel';
      minutes = nap ? rng.int(25, 60) : Math.min(240, rng.int(180, 240));
      fx.needs = { energy: hasBed ? (nap ? 20 : 40) : nap ? 10 : 20, comfort: hasBed ? 8 : -6 };
      fx.timeElapsedMinutes = minutes;
      narration = hasBed ? (nap ? 'You stretch out and drift off for a while.' : `You get under the covers. Sleep comes ${actor.needs.energy < 30 ? 'instantly' : 'eventually'}.`) : `You find a spot and close your eyes. It is not comfortable, and ${rng.pick(['someone keeps walking past', 'the noise never quite stops', 'you wake up stiff'])}.`;
      if (!hasBed && venue.archetype !== 'park' && rng.chance(0.35)) {
        dialogue = staffLine(scene, rng, "Hey. Hey. You can't sleep here.");
        minutes = Math.min(minutes, 20);
        fx.needs.energy = 5;
        fx.moodlets = [{ emotion: 'embarrassed', label: 'Woken by staff', intensity: -5, durationMinutes: 60 }];
      }
      followUps = ['Get up and stretch', 'Sleep a little longer', 'Check the time'];
    } else if (/\b(eat|snack|breakfast|lunch|dinner|grab a bite|order (some )?food|have a meal)\b/.test(lower)) {
      const food = pickFoodHere(ctx.venue.allowedItems, this.content);
      const pantryHit = home && Object.keys(actor.inventory.consumables).some((k) => this.content.items[k]?.category === 'food');
      if (food && !home) {
        const price = Math.round(food.basePrice * venue.priceMultiplier * state.region.costOfLiving * 100) / 100;
        if (liquidCash(actor) >= price) {
          fx.money = { amount: -price, memo: `${food.name} at ${venue.name}`, counterparty: venue.name };
          fx.needs = { hunger: Math.min(40, Math.max(15, food.calories ? food.calories / 25 : 25)), thirst: 5, fun: 3 };
          minutes = rng.int(15, 35);
          narration = `You order ${food.name.toLowerCase()} and eat ${rng.pick(['at the counter', 'by the window', 'standing up', 'without hurrying'])}. $${price.toFixed(2)}.`;
        } else {
          narration = `You look at the prices, count what you have, and put your wallet away.`;
          minutes = 3;
          fx.moodlets = [{ emotion: 'stressed', label: 'Too broke to eat out', intensity: -5, durationMinutes: 120 }];
        }
      } else if (pantryHit || home) {
        fx.needs = { hunger: 25, fun: 2 };
        minutes = rng.int(15, 30);
        narration = `You put together ${rng.pick(['a sandwich', 'leftovers', 'eggs and toast', 'a bowl of cereal', 'something from the fridge'])} and eat at the counter.`;
      } else {
        narration = `There's nothing to eat here. Your stomach is not impressed.`;
        minutes = 2;
      }
      followUps = ['Get something to drink', 'Sit for a while', 'Head out'];
    } else if (/\b(drink|coffee|beer|water|soda|a shot|cocktail|tea)\b/.test(lower)) {
      const alcoholic = /\b(beer|shot|cocktail|wine|liquor|whiskey|vodka|drink(s)?\b(?!.*water))\b/.test(lower) && !/\bwater\b/.test(lower);
      const coffee = /\b(coffee|latte|espresso|tea)\b/.test(lower);
      const sells = ctx.venue.allowedItems;
      const item = alcoholic ? (sells.includes('beer') ? this.content.items.beer : sells.includes('liquor') ? this.content.items.liquor : undefined) : coffee ? (sells.includes('coffee_cup') ? this.content.items.coffee_cup : undefined) : sells.includes('water_bottle') ? this.content.items.water_bottle : undefined;
      if (alcoholic && !item && !home) {
        narration = `They don't serve alcohol here.`;
        minutes = 2;
      } else if (alcoholic && ageAt(actor.identity.birthDate, state.epoch, state.time.minute) < 21 && !home) {
        dialogue = staffLine(scene, rng, "ID? ...Yeah, no. Sorry.");
        narration = `You get carded and turned down.`;
        minutes = 3;
        fx.moodlets = [{ emotion: 'embarrassed', label: 'Carded', intensity: -3, durationMinutes: 60 }];
      } else {
        const price = item ? Math.round(item.basePrice * venue.priceMultiplier * state.region.costOfLiving * 100) / 100 : 0;
        if (item && liquidCash(actor) < price) {
          narration = `You can't cover it right now.`;
          minutes = 2;
        } else {
          if (item && !home) fx.money = { amount: -price, memo: `${item.name} at ${venue.name}`, counterparty: venue.name };
          fx.needs = { thirst: alcoholic ? 10 : 25, fun: alcoholic ? 8 : coffee ? 5 : 1, comfort: 2 };
          if (alcoholic) fx.bloodAlcohol = 0.02;
          if (coffee) {
            fx.caffeine = 95;
            fx.needs.energy = 8;
          }
          minutes = alcoholic ? rng.int(20, 40) : rng.int(5, 15);
          narration = alcoholic ? `You nurse a ${item?.name.toLowerCase() ?? 'drink'} and let the room do its thing.` : coffee ? `Hot ${item?.name.toLowerCase() ?? 'coffee'}, too fast. It helps.` : `You drink some water. Simple, effective.`;
        }
      }
      followUps = ['Order another', 'Talk to whoever is nearby', 'Head out'];
    } else if (/\b(shower|bath|wash up|freshen up|brush (my )?teeth|clean up)\b/.test(lower)) {
      const can = home || venue.archetype === 'gym' || venue.archetype === 'hotel' || venue.archetype === 'pool';
      if (can) {
        fx.needs = { hygiene: 45, comfort: 8 };
        minutes = rng.int(10, 25);
        narration = `Hot water, steam, ten minutes of not thinking. You come out a different person.`;
      } else {
        fx.needs = { hygiene: 8 };
        minutes = 4;
        narration = `You do what you can at a sink. It's something.`;
      }
      followUps = ['Get dressed and go out', 'Relax for a bit', 'Eat something'];
    } else if (/\b(bathroom|restroom|pee|toilet|use the (restroom|bathroom))\b/.test(lower)) {
      fx.needs = { bladder: 60 };
      minutes = 4;
      narration = ctx.venue.openNow || home ? `You find the restroom. Relief.` : `The place is closed; you find a gas station down the street instead.`;
      followUps = ['Wash your hands and head back', 'Check your phone', 'Look around'];
    } else if (/\b(work out|workout|exercise|lift|run|jog|gym|push-?ups|squats|stretch|yoga)\b/.test(lower)) {
      const good = venue.archetype === 'gym' || venue.archetype === 'park' || venue.archetype === 'trail' || home || venue.archetype === 'yoga';
      const s = Math.max(skill('fitness'), skill('athletics'));
      minutes = rng.int(30, 60);
      fx.needs = { energy: -20 + s, hygiene: -20, fun: 6, thirst: -15 };
      fx.fitness = good ? 1 : 0.4;
      fx.skills = { [/\b(run|jog)\b/.test(lower) ? 'athletics' : 'fitness']: 15 + s * 2 };
      fx.stress = -8;
      narration = good ? `You put in ${minutes} honest minutes. ${s >= 5 ? 'Muscle memory does most of it.' : rng.pick(['You feel every rep.', 'Form is questionable; effort is not.'])}` : `You improvise a workout where you are. A few people look; you keep going.`;
      if (rng.chance(0.06 + (actor.body.fitness < 30 ? 0.06 : 0))) {
        fx.health = -3;
        fx.moodlets = [{ emotion: 'uncomfortable', label: 'Tweaked something', intensity: -6, durationMinutes: 480 }];
        narration += ' Something in your back complains on the way out.';
      }
      followUps = ['Drink water', 'Shower', 'Head home'];
    } else if (/\b(steal|shoplift|pocket|swipe|take .* without paying|rob|pickpocket)\b/.test(lower)) {
      const crimeId = venue.archetype === 'retail' || venue.archetype === 'grocery' || venue.archetype === 'convenience' || venue.archetype === 'clothing' || venue.archetype === 'pharmacy' || venue.archetype === 'liquor_store' ? 'shoplifting' : /\b(rob|pickpocket)\b/.test(lower) ? 'robbery' : 'petty_theft';
      const crime = this.content.crimes[crimeId];
      const witnesses = scene.present.length;
      const catchChance = Math.min(0.95, (crime?.detection ?? 0.35) * (1 + witnesses * 0.35) * (venue.safety / 60) * (drunk ? 1.4 : 1) * (1 - skill('charisma') * 0.03));
      const caught = rng.chance(catchChance);
      const gain = crime?.gainRange ? rng.int(crime.gainRange[0], crime.gainRange[1]) : rng.int(5, 40);
      minutes = rng.int(4, 12);
      if (caught) {
        narration = `${rng.pick(['A hand lands on your shoulder before you reach the door.', "You're halfway out when someone says your description into a radio.", 'The clerk saw the whole thing. So did the camera.'])} ${crimeId === 'robbery' ? 'Police are on the way.' : 'They want to talk to you in the back.'}`;
        fx.legal = [{ kind: 'charge', crimeId, label: crime?.label ?? titleWords(crimeId), severity: crime?.severity ?? 'misdemeanor', amount: crime?.fineRange ? rng.int(crime.fineRange[0], Math.min(crime.fineRange[1], crime.fineRange[0] * 3)) : 200 }, { kind: 'heat', delta: 15 }];
        fx.stress = 20;
        fx.moodlets = [{ emotion: 'scared', label: 'Caught stealing', intensity: -15, durationMinutes: 600 }];
        dialogue = staffLine(scene, rng, "Sir— ma'am— you need to come with me. Now.");
        for (const p of scene.present) other[p.id] = { relationships: [{ simId: actor.id, trust: -15, friendship: -8, mutual: false }] };
        followUps = ['Cooperate', 'Deny everything', 'Run'];
      } else {
        const item = pickFoodHere(ctx.venue.allowedItems, this.content) ?? (ctx.venue.allowedItems.length ? this.content.items[ctx.venue.allowedItems[0]] : undefined);
        narration = `${rng.pick(['Nobody looks up.', 'Your heart is going a mile a minute, but nobody stops you.', 'Easier than it should be.'])} You walk out with ${item ? item.name.toLowerCase() : `about $${gain} worth of stuff`}.`;
        if (item) fx.items = [{ op: 'gain', itemId: item.id, qty: 1 }];
        fx.legal = [{ kind: 'heat', delta: 5 }];
        fx.stress = 10;
        fx.moodlets = [{ emotion: 'guilty', label: 'Got away with it', intensity: -4, durationMinutes: 240 }];
        followUps = ['Leave quickly', 'Act normal and browse', 'Put it back'];
      }
    } else if (/\b(punch|fight|hit|attack|shove|slap|kick)\b/.test(lower)) {
      const target = findPresentByText(scene, t) ?? scene.present[0];
      minutes = rng.int(3, 8);
      if (!target) {
        narration = `You swing at nothing in particular. Nothing swings back.`;
        minutes = 1;
        followUps = ['Calm down', 'Leave', 'Look around'];
      } else {
        const win = rng.chance(0.35 + skill('athletics') * 0.05 + (actor.body.fitness - target.body.fitness) / 200 - (drunk ? 0.15 : 0));
        narration = win ? `You go at ${target.identity.firstName}. It's ugly and short and ${rng.pick(['you come out on top', 'they hit the floor', 'they back off bleeding'])}. Everyone is staring. Someone has a phone out.` : `You go at ${target.identity.firstName} and it goes badly: ${rng.pick(['a fist finds your eye', 'you end up on the floor', 'they are stronger than they look'])}. Someone is already calling it in.`;
        fx.health = win ? -3 : -8;
        fx.stress = 20;
        fx.legal = [{ kind: 'charge', crimeId: 'assault', label: 'Assault', severity: 'misdemeanor', amount: rng.int(250, 1000) }, { kind: 'heat', delta: 25 }];
        fx.moodlets = [{ emotion: win ? 'angry' : 'scared', label: 'Got in a fight', intensity: -12, durationMinutes: 480 }];
        fx.relationships = [{ simId: target.id, friendship: -15, trust: -10, mutual: false }];
        other[target.id] = { health: win ? -8 : -2, relationships: [{ simId: actor.id, friendship: -20, trust: -20, mutual: false }], moodlets: [{ emotion: 'angry', label: 'Attacked', intensity: -15, durationMinutes: 720 }] };
        memories.push({ simId: target.id, text: `${actor.identity.firstName} attacked me at ${venue.name}. I will not forget it.`, salience: 90, valence: -1 });
        dialogue = [{ speakerId: target.id, text: rng.pick(["What the hell is wrong with you?!", "Get off me!", "You're done. You're so done."]), emotion: 'angry' }];
        followUps = ['Get out before the police arrive', 'Stay and explain', 'Apologize'];
      }
    } else if (/\b(read|book|study|homework|review notes|library)\b/.test(lower)) {
      const s = skill('research');
      minutes = rng.int(30, 75);
      fx.needs = { fun: 8, energy: -5, social: -2 };
      fx.skills = { research: 12 + s, ...( /\bstudy|homework|notes\b/.test(lower) ? { logic: 8 } : {}) };
      fx.stress = -5;
      narration = `You settle in and ${/\bstudy|homework|notes\b/.test(lower) ? 'work through the material' : 'read'} for a while. ${rng.pick(['The time goes.', 'You get through more than you expected.', 'Your mind wanders twice; you drag it back.'])}`;
      followUps = ['Take a break', 'Keep going', 'Get a coffee'];
    } else if (/\b(watch (tv|television|a movie|netflix|youtube|something)|binge|scroll|tiktok|instagram|doom-?scroll)\b/.test(lower)) {
      minutes = rng.int(30, 90);
      fx.needs = { fun: 12, energy: -3, comfort: 4 };
      fx.stress = -4;
      narration = /\b(scroll|tiktok|instagram)\b/.test(lower) ? `You scroll. Forty minutes vanish. You learn nothing and feel slightly worse and slightly better.` : `You watch ${rng.pick(['something you have already seen', 'half of something new', 'whatever autoplays'])}. It does the job.`;
      followUps = ['Put the phone down', 'Watch one more', 'Go to bed'];
    } else if (/\b(call|phone|text|message|dm)\b/.test(lower)) {
      const who = findKnownByText(state, actor, t);
      minutes = rng.int(3, 12);
      if (who) {
        const rel = who.relationships[actor.id];
        const picks = rel && rel.friendship > 20 ? rng.chance(0.8) : rng.chance(0.45);
        narration = picks ? `You ${/\btext|message|dm\b/.test(lower) ? 'text' : 'call'} ${who.identity.firstName}. ${rng.pick(['They answer on the second ring.', 'A reply comes back after a minute.', 'You talk for a few minutes about nothing much.'])}` : `You try ${who.identity.firstName}. ${rng.pick(['Straight to voicemail.', 'No answer.', 'Left on read, for now.'])}`;
        if (picks) {
          fx.needs = { social: 10, fun: 3 };
          fx.relationships = [{ simId: who.id, familiarity: 2, friendship: 1, mutual: false }];
          other[who.id] = { relationships: [{ simId: actor.id, familiarity: 2, friendship: 1, mutual: false }] };
        }
        followUps = ['Make plans to meet up', 'Ask how they are doing', 'Hang up and do something else'];
      } else {
        narration = `You pull out your phone, then realize you're not sure who you meant to reach.`;
        minutes = 2;
        followUps = ['Text someone you know', 'Put the phone away', 'Check the news'];
      }
    } else if (/\b(pray|meditate|breathe|church|worship)\b/.test(lower)) {
      minutes = rng.int(10, 30);
      fx.stress = -12;
      fx.needs = { comfort: 4 };
      fx.moodlets = [{ emotion: 'relaxed', label: 'Quiet moment', intensity: 5, durationMinutes: 180 }];
      narration = `You go still for a while. ${rng.pick(['Your breathing slows.', 'The noise recedes.', 'It does not fix anything, and it helps.'])}`;
      followUps = ['Sit a little longer', 'Get on with the day', 'Call someone'];
    } else if (/\b(dance|dancing)\b/.test(lower)) {
      const s = skill('dancing');
      const fits = ['nightclub', 'bar', 'dance_studio', 'home', 'concert_hall'].includes(venue.archetype);
      minutes = rng.int(15, 45);
      fx.needs = { fun: fits ? 15 : 6, energy: -10, hygiene: -8, social: fits ? 6 : 0 };
      fx.skills = { dancing: 10 + s };
      narration = fits ? `You dance. ${s >= 4 ? 'People make room, in a good way.' : 'Nobody is grading you, which is lucky.'}` : `You dance where you are. ${rng.pick(['A kid joins in.', 'Someone films you.', 'It is, at least, memorable.'])}`;
      if (!fits) fx.moodlets = [{ emotion: 'playful', label: 'Danced in public', intensity: 4, durationMinutes: 120 }];
      followUps = ['Keep going', 'Get a drink', 'Sit down'];
    } else if (/\b(sing|karaoke|hum)\b/.test(lower)) {
      const s = skill('singing');
      minutes = rng.int(5, 20);
      fx.needs = { fun: 10, social: 3 };
      fx.skills = { singing: 10 + s };
      narration = s >= 4 ? `You sing, and it is actually good. A couple of people turn around for the right reasons.` : `You sing. Enthusiasm outpaces pitch. ${rng.pick(['Someone claps anyway.', 'A dog howls somewhere.', 'You commit to it.'])}`;
      followUps = ['Take a bow', 'Do another one', 'Quit while ahead'];
    } else if (/\b(clean|tidy|vacuum|dishes|laundry|mop|organize|sweep)\b/.test(lower)) {
      minutes = rng.int(20, 60);
      fx.needs = { fun: -4, energy: -6, comfort: 6 };
      fx.stress = -5;
      fx.skills = { handiness: 4 };
      if (home) fx.venue = [{ venueId: venue.id, cleanliness: 15 }];
      narration = home ? `You clean. ${rng.pick(['The place looks like someone lives here on purpose.', 'You find a fork you forgot you owned.', 'Music on, sleeves up.'])}` : `You tidy up around you. Staff looks confused but grateful.`;
      followUps = ['Sit down and enjoy it', 'Keep going', 'Reward yourself'];
    } else if (/\b(cook|make (dinner|lunch|breakfast|pancakes|eggs|pasta|food)|bake)\b/.test(lower)) {
      const s = skill('cooking');
      const canCook = home || ctx.venue.objects.some((o) => /stove|oven|kitchen|grill|microwave/i.test(o));
      minutes = rng.int(25, 60);
      if (canCook) {
        const good = rng.chance(0.4 + s * 0.06);
        fx.needs = { hunger: good ? 40 : 25, fun: good ? 8 : 2 };
        fx.skills = { cooking: 15 + s };
        fx.items = [{ op: 'lose', itemId: 'eggs', qty: 1 }];
        narration = good ? `You cook something real. ${rng.pick(['It comes out better than the recipe deserved.', 'The kitchen smells like a kitchen.', 'Someone asks for the leftovers.'])}` : `You cook. It is ${rng.pick(['edible', 'slightly burnt', 'more soup than intended'])}, which counts.`;
        for (const p of scene.present.slice(0, 3)) {
          other[p.id] = { needs: { hunger: good ? 25 : 15 }, relationships: [{ simId: actor.id, friendship: good ? 4 : 1, familiarity: 1, mutual: false }] };
          memories.push({ simId: p.id, text: `${actor.identity.firstName} cooked for us. ${good ? 'It was good.' : 'It was... an effort.'}`, salience: 35, valence: good ? 0.5 : 0.1 });
        }
      } else {
        narration = `There's nothing here to cook with.`;
        minutes = 2;
      }
      followUps = ['Eat', 'Clean up', 'Offer some to someone'];
    } else if (/\b(smoke|vape|cigarette|joint|weed|hit)\b/.test(lower)) {
      const weed = /\b(joint|weed|blunt)\b/.test(lower);
      const has = (actor.inventory.consumables[weed ? 'cannabis_flower' : 'cigarettes'] ?? 0) > 0 || (!weed && (actor.inventory.consumables.vape ?? 0) > 0);
      minutes = rng.int(5, 15);
      if (!has) {
        narration = `You pat your pockets. Nothing.`;
        minutes = 1;
      } else {
        fx.items = [{ op: 'lose', itemId: weed ? 'cannabis_flower' : 'cigarettes', qty: 1 }];
        fx.needs = { fun: 5, comfort: 4 };
        fx.stress = -8;
        if (weed) fx.cannabis = 25;
        fx.health = -1;
        narration = weed ? `You step somewhere quiet and light up. ${rng.pick(['The edges go soft.', 'Time gets generous.', 'Someone nearby definitely notices.'])}` : `You step outside and smoke. ${rng.pick(['The first drag is the whole reason.', 'It is a bad habit and a good five minutes.'])}`;
        if (weed && venue.archetype !== 'home' && rng.chance(0.15)) fx.legal = [{ kind: 'heat', delta: 8 }];
      }
      followUps = ['Head back in', 'Have another', 'Get some water'];
    } else if (/\b(look around|explore|check (the place|it) out|observe|people-?watch|glance around|survey)\b/.test(lower) || /^(what|who|where|is there|are there)\b/.test(lower)) {
      minutes = rng.int(1, 4);
      const people = scene.present.slice(0, 4).map((p) => `${p.identity.firstName}${p.role ? ` (${p.role.title ?? titleWords(p.role.role)})` : ''}`);
      narration = `${ctx.venue.name}: ${ctx.venue.crowd}. ${ctx.venue.objects.length ? `You clock ${ctx.venue.objects.slice(0, 4).join(', ')}.` : ''} ${people.length ? `Around: ${people.join(', ')}.` : 'Nobody you know.'}`.replace(/\s+/g, ' ').trim();
      fx.needs = { fun: 1 };
      followUps = people.length ? [`Talk to ${scene.present[0].identity.firstName}`, 'Find something to do here', 'Leave'] : ['Find something to do here', 'Check your phone', 'Leave'];
    } else if (/\b(apply|ask (for|about) (a )?job|hiring|application|resume)\b/.test(lower)) {
      const staff = scene.present.find((p) => p.role?.venueId === venue.id) ?? scene.present[0];
      const open = ctx.venue.openNow && !home;
      minutes = rng.int(5, 15);
      if (open) {
        const good = rng.chance(0.35 + skill('charisma') * 0.05 + (actor.needs.hygiene < 30 ? -0.2 : 0));
        if (staff) dialogue = [{ speakerId: staff.id, text: good ? rng.pick(["We might be. Come back tomorrow at ten and ask for the manager.", "Fill this out and the manager does interviews Thursday mornings."]) : rng.pick(["Not right now, sorry. Try the website?", "Manager's not in. Maybe leave your number."]), emotion: good ? 'relaxed' : 'bored' }];
        narration = good ? `You ask about work. It's not a no.` : `You ask about work and get the polite version of no.`;
        if (good) {
          const tomorrow10 = (Math.floor(state.time.minute / 1440) + 1) * 1440 + 600 - state.time.minute;
          fx.schedule = [{ inMinutes: tomorrow10, kind: 'interview', label: `Ask for the manager at ${venue.name}`, venueId: venue.id, payload: { venueId: venue.id } }];
          fx.moodlets = [{ emotion: 'hopeful', label: 'A lead', intensity: 6, durationMinutes: 720 }];
        }
        followUps = good ? ['Ask what the pay is like', 'Thank them and leave', 'Ask what the job involves'] : ['Ask where else is hiring', 'Leave', 'Order something anyway'];
      } else {
        narration = `Nobody here to ask.`;
        minutes = 1;
        followUps = ['Come back during business hours', 'Check job listings on your phone', 'Leave'];
      }
    } else if (/\b(buy|purchase|get (a |some )?(pack|bottle|bag))\b/.test(lower)) {
      const item = findItemByText(this.content, ctx.venue.allowedItems, lower);
      minutes = rng.int(3, 10);
      if (!item) {
        narration = `They don't sell that here.`;
        minutes = 2;
      } else {
        const price = Math.round(item.basePrice * venue.priceMultiplier * state.region.costOfLiving * 100) / 100;
        if (liquidCash(actor) < price) narration = `$${price.toFixed(2)}. You don't have it.`;
        else {
          fx.money = { amount: -price, memo: `${item.name} at ${venue.name}`, counterparty: venue.name };
          fx.items = [{ op: 'gain', itemId: item.id, qty: 1 }];
          narration = `You buy ${item.name.toLowerCase()} for $${price.toFixed(2)}.`;
        }
      }
      followUps = ['Buy something else', 'Leave', 'Look around'];
    } else if (/\b(talk to|chat with|say hi to|approach|introduce myself to)\b/.test(lower)) {
      const who = findPresentByText(scene, t) ?? scene.present[0];
      minutes = 2;
      narration = who ? `You catch ${who.identity.firstName}'s eye and step over.` : `There's nobody around to talk to.`;
      followUps = who ? [`Say hi to ${who.identity.firstName}`, `Ask ${who.identity.firstName} a question`, 'Change your mind'] : ['Look around', 'Leave', 'Check your phone'];
      if (who) fx.needs = { social: 1 };
    } else if (/\b(wait|hang out|chill|sit|relax|kill time|do nothing|loiter)\b/.test(lower)) {
      minutes = rng.int(10, 30);
      fx.needs = { comfort: 3, fun: -2 };
      fx.stress = -3;
      narration = `You ${rng.pick(['sit', 'lean against something', 'find a spot'])} and let ${minutes} minutes go by. ${rng.pick(['Nothing happens, which is fine.', 'A song you half know plays.', 'The light shifts.'])}`;
      followUps = ['Keep waiting', 'Do something', 'Leave'];
    } else if (/\b(climb|jump off|fly|teleport|dragon|magic|summon|spell|hack the mainframe|rob a bank|time travel)\b/.test(lower)) {
      minutes = rng.int(1, 5);
      narration = rng.pick([`You size it up, think about it seriously, and think better of it. ${rng.pick(['A kid is watching.', 'Nobody needs to see that.', 'Reality declines to cooperate.'])}`, `You try. It goes exactly as physics suggests, which is to say: not at all. ${scene.present.length ? `${scene.present[0].identity.firstName} gives you a look.` : ''}`.trim()]);
      if (scene.present.length) fx.moodlets = [{ emotion: 'embarrassed', label: 'That was a moment', intensity: -3, durationMinutes: 60 }];
      followUps = ['Act like nothing happened', 'Do something normal', 'Leave'];
    } else {
      minutes = 5;
      narration = rng.pick([`You give it a shot. ${rng.pick(['It mostly amounts to five minutes of standing around.', 'Nothing much comes of it.', 'The world carries on around you.'])}`, `You try. It is not really a thing you can do here, or at least not now.`]);
      followUps = ['Try something else', 'Look around', 'Talk to someone'];
    }

    fx.timeElapsedMinutes = fx.timeElapsedMinutes ?? minutes;
    return this.outcome({ narration, dialogue, effects: fx, otherEffects: other, npcMemories: memories, followUps, minutes });
  }

  // ---------------------------------------------------------------------
  // narrate / bio / summarize / describe / npcMessage / direct
  // ---------------------------------------------------------------------
  async narrate(scene: SceneSnapshot, action: ActionDef, outcomeLabel?: string): Promise<string> {
    const { state, actor, venue } = scene;
    const rng = this.rngFor(state, `narrate:${action.id}:${outcomeLabel ?? ''}`);
    const label = action.label.charAt(0).toLowerCase() + action.label.slice(1);
    const pod = partOfDay(minuteOfDay(state.time.minute)).replace('_', ' ');
    const w = state.weather.current;
    const flavor = rng.pick([
      `The ${pod} ${w.condition === 'rain' || w.condition === 'heavy_rain' ? 'rain keeps on' : w.tempF > 90 ? 'heat sits on everything' : w.tempF < 40 ? 'cold gets into your hands' : 'goes on around you'}.`,
      venue.archetype === 'home' ? rng.pick(['The apartment hums.', 'Somewhere a neighbor is watching TV too loud.', 'The fridge clicks on.']) : rng.pick([`${venue.name} carries on around you.`, 'Someone laughs at the far end of the room.', 'A door opens and closes.']),
      needWords(actor)[0] ? `You are still ${needWords(actor)[0]}.` : rng.pick(['Not bad.', 'Time well spent, probably.', 'It is what it is.']),
    ]);
    const outcome = outcomeLabel ? ` ${outcomeSentence(outcomeLabel, rng)}` : '';
    return `You ${label}${action.target?.name ? ` (${action.target.name})` : ''}.${outcome} ${flavor}`.replace(/\s+/g, ' ').trim();
  }

  async generateBio(state: WorldState, sim: Sim): Promise<{ summary: string; facts: BioFact[]; by: 'llm' | 'fallback' }> {
    const { summary, facts } = generateBioFallback(state, sim, this.content);
    return { summary, facts, by: 'fallback' };
  }

  async summarizeMemories(sim: Sim, texts: string[]): Promise<string> {
    const cleaned = texts.map((t) => t.trim().replace(/\s+/g, ' ')).filter(Boolean);
    if (!cleaned.length) return '';
    const head = cleaned.slice(0, 8).map((t) => (t.endsWith('.') ? t.slice(0, -1) : t));
    const more = cleaned.length > 8 ? ` And ${cleaned.length - 8} smaller things I mostly remember the shape of.` : '';
    return `Looking back over a stretch of days: ${head.join('; ')}.${more}`.slice(0, 600);
  }

  async describeVenue(state: WorldState, venue: Venue): Promise<string> {
    const rng = this.rngFor(state, `venue:${venue.id}`);
    const g = venue.google;
    const arch = this.content.archetypes[venue.archetype];
    const kind = (arch?.name ?? venue.archetype).replace(/_/g, ' ').toLowerCase();
    const vibe = g?.rating !== undefined ? (g.rating >= 4.5 ? 'the kind of place people go out of their way for' : g.rating >= 4 ? 'well liked, a little worn in' : g.rating >= 3.3 ? 'fine, if you keep your expectations honest' : 'the kind of place with a reputation') : rng.pick(['unremarkable in a comfortable way', 'busier than it looks from outside', 'quiet most of the day']);
    const price = g?.priceLevel !== undefined ? (g.priceLevel >= 3 ? 'Prices lean high.' : g.priceLevel <= 1 ? 'Cheap, and it knows it.' : 'Prices are about what you would expect.') : '';
    const themes = g?.reviewThemes?.length ? `People mention ${g.reviewThemes.slice(0, 3).join(', ')}.` : '';
    const hint = arch?.llmHint ? ` ${arch.llmHint.split('. ')[0]}.` : '';
    const summary = g?.editorialSummary ? ` ${g.editorialSummary.replace(/\.$/, '')}.` : '';
    return `${venue.name} is a ${kind} in ${state.region.name}, ${vibe}.${summary}${hint} ${price} ${themes}`.replace(/\s+/g, ' ').trim();
  }

  async npcMessage(state: WorldState, from: Sim, to: Sim, reason: string): Promise<string> {
    const rng = this.rngFor(state, `msg:${from.id}:${to.id}:${reason}`);
    const rel = from.relationships[to.id];
    const label = relationshipLabel(rel, to);
    const name = to.identity.firstName;
    const me = from.identity.firstName;
    const r = reason.toLowerCase();
    const close = (rel?.friendship ?? 0) >= 40;
    if (/\b(invite|party|hang|come over|drinks|dinner|game)\b/.test(r)) return rng.pick([`hey ${name}, a few of us are getting together ${rng.pick(['Friday', 'Saturday', 'tonight'])}. you in?`, `${name}! ${rng.pick(['trivia', 'drinks', 'a cookout'])} ${rng.pick(['tomorrow', 'this weekend'])} — come.`, `no pressure but ${rng.pick(["we're doing a thing", 'people are coming over'])} ${rng.pick(['sat', 'fri'])} if you want`]);
    if (/\b(money|owe|debt|pay|loan)\b/.test(r)) return rng.pick([`hey so… about that ${rng.pick(['$40', 'money', 'cash'])} — any chance this week?`, `${name}, not trying to be weird but I could really use that money back`, `friendly reminder you still owe me lol`]);
    if (/\b(apolog|sorry)\b/.test(r)) return rng.pick([`hey. I was out of line earlier. sorry.`, `${name} — I've been thinking about it and I owe you an apology`, `sorry about ${rng.pick(['the other day', 'earlier', 'how I acted'])}. can we talk?`]);
    if (/\b(angry|mad|upset|confront|grudge)\b/.test(r)) return rng.pick([`we need to talk about what happened.`, `${name}. really?`, `I heard what you said. call me.`]);
    if (/\b(birthday|congrat|celebrat)\b/.test(r)) return rng.pick([`happy birthday ${name}!! 🎉`, `heard the news — congrats!! we're celebrating, right?`, `HBD ${name} 🎂 do something fun`]);
    if (/\b(work|shift|cover|boss|schedule|late)\b/.test(r)) return rng.pick([`any chance you can cover ${rng.pick(['my Thursday', 'a shift', 'the morning'])}? I'll owe you`, `${name} — ${rng.pick(['schedule changed', 'boss wants everyone in early', 'we\'re short tomorrow'])}, fyi`, `you seen the new schedule? we need to talk`]);
    if (/\b(date|flirt|romance|crush|miss)\b/.test(r)) return rng.pick([`so… when am I seeing you again?`, `thinking about you. that's it, that's the text`, `${name} 👀 free ${rng.pick(['tonight', 'this weekend'])}?`]);
    if (/\b(check|checking in|how are you|haven't|long time)\b/.test(r)) return rng.pick([`hey stranger. you alive?`, `${name}! long time. how've you been?`, `just checking in. ${close ? 'miss you.' : 'hope things are good.'}`]);
    if (/\b(remind|appointment|tomorrow|don't forget)\b/.test(r)) return rng.pick([`reminder: ${rng.pick(['tomorrow at 10', 'Thursday', 'tonight'])}. don't flake`, `you're still coming ${rng.pick(['tomorrow', 'tonight'])} right?`]);
    if (/\b(gossip|heard|news|did you see)\b/.test(r)) return rng.pick([`ok you did NOT hear this from me but`, `did you see what happened at ${rng.pick(['work', 'the bar', 'the park'])}??`, `call me. I have news.`]);
    return close ? rng.pick([`hey ${name}, what are you up to?`, `${me} here. bored. entertain me`, `you around later?`]) : rng.pick([`hi ${name}, it's ${me}. quick question when you have a sec?`, `hey — ${label.includes('coworker') ? 'work thing' : 'random'}, but are you free sometime this week?`, `hey ${name}, ${me} from ${rng.pick(['the other day', 'the cafe', 'work'])}. hope this is ok`]);
  }

  async direct(state: WorldState): Promise<{ beats: { label: string; simId?: SimId; inMinutes: number; kind: string; payload?: Record<string, unknown> }[] }> {
    const rng = this.rngFor(state, 'director');
    const beats: { label: string; simId?: SimId; inMinutes: number; kind: string; payload?: Record<string, unknown> }[] = [];
    for (const id of state.player.controlledSimIds) {
      const sim = state.sims[id];
      if (!sim) continue;
      const cash = liquidCash(sim);
      const job = sim.career.job;
      const rels = Object.values(sim.relationships).map((r) => state.sims[r.simId]).filter((s): s is Sim => !!s);
      const friend = rels.length ? rng.pick(rels) : undefined;
      if (cash < 300) beats.push({ label: 'An unexpected bill', simId: id, inMinutes: rng.int(600, 4000), kind: 'story_beat', payload: { text: `A ${rng.pick(['medical', 'utility', 'car'])} bill you forgot about shows up: $${rng.int(60, 180)}, due in a week.`, options: ['Pay it now', 'Call and ask for a payment plan', 'Ignore it for now'] } });
      else if (job) beats.push({ label: 'Extra shift offered', simId: id, inMinutes: rng.int(600, 5000), kind: 'story_beat', payload: { text: `Your manager at ${job.employerName} asks if you can pick up an extra shift this week. It would help.`, options: ['Take it', 'Decline politely', 'Ask for a raise instead'] } });
      else beats.push({ label: 'A job lead', simId: id, inMinutes: rng.int(600, 5000), kind: 'story_beat', payload: { text: `Someone mentions a place nearby is hiring. Nothing fancy, but it starts this week.`, options: ['Go ask about it', 'Look for something better', 'Let it go'] } });
      if (friend) beats.push({ label: `${friend.identity.firstName} reaches out`, simId: id, inMinutes: rng.int(1200, 9000), kind: 'story_beat', payload: { text: `${friend.identity.firstName} texts: they want to ${rng.pick(['grab a drink', 'ask a favor', 'talk about something'])}.`, options: ['Say yes', 'Ask what it is about', 'Leave it on read'] } });
      const asp = sim.aspirations.find((a) => !a.completed);
      if (asp) beats.push({ label: 'A step toward the goal', simId: id, inMinutes: rng.int(2000, 9500), kind: 'story_beat', payload: { text: `You come across something that could move "${asp.text}" forward, if you make time for it this week.`, options: ['Make time', 'Not this week'] } });
    }
    return { beats: beats.slice(0, 4) };
  }

  private outcome(partial: Partial<InteractionOutcome>): InteractionOutcome {
    return {
      narration: partial.narration ?? '',
      dialogue: partial.dialogue ?? [],
      effects: partial.effects ?? {},
      otherEffects: partial.otherEffects,
      revealedFacts: partial.revealedFacts ?? [],
      npcMemories: partial.npcMemories ?? [],
      followUps: partial.followUps ?? [],
      endsConversation: partial.endsConversation,
      minutes: Math.max(1, Math.round(partial.minutes ?? 5)),
      fallback: true,
    };
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
export function classifyIntent(text: string): Intent {
  for (const [intent, re] of INTENT_RULES) if (re.test(text)) return intent;
  return 'smalltalk';
}

function isOnShift(npc: Sim, state: WorldState): boolean {
  const mod = minuteOfDay(state.time.minute);
  const wd = new Date(Date.UTC(Number(state.epoch.slice(0, 4)), Number(state.epoch.slice(5, 7)) - 1, Number(state.epoch.slice(8, 10))) + state.time.minute * 60000).getUTCDay();
  const shift = npc.career.job?.shifts.find((s) => s.day === wd);
  if (shift) return mod >= shift.start && mod < shift.end;
  return !!npc.role && npc.role.venueId === npc.location.venueId;
}

function shiftEndLabel(npc: Sim, state: WorldState): string {
  const wd = new Date(Date.UTC(Number(state.epoch.slice(0, 4)), Number(state.epoch.slice(5, 7)) - 1, Number(state.epoch.slice(8, 10))) + state.time.minute * 60000).getUTCDay();
  const shift = npc.career.job?.shifts.find((s) => s.day === wd);
  return shift ? formatClock(shift.end) : 'six';
}

function isCompatible(a: Sim, b: Sim): boolean {
  const likes = (s: Sim, g: Sim['identity']['gender']): boolean => {
    const sx = s.personality.sexuality;
    if (sx === 'ace') return false;
    if (sx === 'bi' || sx === 'pan' || sx === 'questioning') return true;
    if (sx === 'straight') return g !== s.identity.gender;
    if (sx === 'gay') return g === s.identity.gender;
    return true;
  };
  return likes(a, b.identity.gender) && likes(b, a.identity.gender);
}

function firstPersonize(text: string, npc: Sim): string {
  const first = npc.identity.firstName;
  let t = text;
  t = t.replace(new RegExp(`\\b${first}'s\\b`, 'g'), 'my').replace(new RegExp(`\\b${first}\\b`, 'g'), 'I');
  t = t.replace(/\b(She|He|They) (has|have)\b/g, 'I have').replace(/\b(she|he|they) (has|have)\b/g, 'I have');
  t = t.replace(/\b(She|He|They) (is|are)\b/g, 'I am').replace(/\b(she|he|they) (is|are)\b/g, 'I am');
  t = t.replace(/\b(Her|His|Their)\b/g, 'My').replace(/\b(her|his|their)\b/g, 'my');
  t = t.replace(/\b(She|He|They)\b/g, 'I').replace(/\b(she|he|they)\b/g, 'I');
  // sentence-initial third-person verbs from the template style ("Grew up in…", "Has two siblings…")
  t = t.replace(/^(Grew|Was|Has|Spends|Works|Got|Broke|Drinks|Lives|Keeps|Names|Hums|Refers|Takes|Eats|Cannot|Always|Never|Gets|Sends|Carries|Lent|Believes|Thinks|Does|Dreams|Secretly|Picked|Finished|Did|Graduated|Currently|Ran|Won|Paid|Up|Family|Born|Parents|Father|Closest|Raised|Terrified|Biggest|Bad|Applied|Once|Owes|Lost|First|Before|Married|Engaged|Seeing|Single|Parent)\b/, (m) => {
    const map: Record<string, string> = { Grew: 'I grew', Was: 'I was', Has: 'I have', Spends: 'I spend', Works: 'I work', Got: 'I got', Broke: 'I broke', Drinks: 'I drink', Lives: 'I live', Keeps: 'I keep', Names: 'I name', Hums: 'I hum', Refers: 'I refer', Takes: 'I take', Eats: 'I eat', Cannot: "I can't", Always: 'I always', Never: 'I never', Gets: 'I get', Sends: 'I send', Carries: 'I carry', Lent: 'I lent', Believes: 'I believe', Thinks: 'I think', Does: 'I do', Dreams: 'I dream', Secretly: 'I secretly', Picked: 'I picked', Finished: 'I finished', Did: 'I did', Graduated: 'I graduated', Currently: "I'm currently", Ran: 'I ran', Won: 'I won', Paid: 'I paid', Up: "I'm up", Family: 'My family', Born: 'I was born', Parents: 'My parents', Father: 'My father', Closest: "I'm closest", Raised: 'I was raised', Terrified: "I'm terrified", Biggest: 'My biggest', Bad: 'I have a bad', Applied: 'I applied', Once: 'I once', Owes: 'I owe', Lost: 'I lost', First: 'I was the first', Before: 'Before', Married: "I'm married", Engaged: "I'm engaged", Seeing: "I'm seeing", Single: "I'm single", Parent: "I'm a parent" };
    return map[m] ?? m;
  });
  t = t.replace(/\bI (is|are)\b/g, 'I am').replace(/\bI has\b/g, 'I have').replace(/\bmy own account\b/g, 'my own account');
  return t;
}

function smalltalkBank(scene: SceneSnapshot, npc: Sim, actor: Sim, rng: RNG, grumpy: boolean, warm: boolean): string[] {
  const w = scene.state.weather.current;
  const weather = w.condition === 'rain' || w.condition === 'heavy_rain' ? 'this rain' : w.tempF >= 92 ? 'this heat' : w.tempF <= 40 ? 'this cold' : 'the weather';
  const name = actor.identity.firstName;
  void rng;
  return grumpy
    ? ['Yeah.', "Mm-hm.", `Can't complain. Well, I could.`, `Is this going somewhere?`]
    : warm
      ? [`Ha, I know, right? ${weather === 'the weather' ? "Not a bad day, honestly." : `${weather.charAt(0).toUpperCase() + weather.slice(1)} is something else.`}`, `Same old, same old. How about you, ${name}?`, `You know how it is. ${scene.venue.name} keeps me busy.`, `Oh, totally. ${npc.identity.firstName === actor.identity.firstName ? '' : "Anyway, what brings you in?"}`.trim()]
      : ['Yeah, pretty much.', `Same as always. ${weather === 'the weather' ? '' : `${weather.charAt(0).toUpperCase() + weather.slice(1)} isn't helping.`}`.trim(), `Not much. You?`, `Sure.`];
}

function followUpsFor(intent: Intent, npcFirst: string, rng: RNG): string[] {
  const banks: Record<string, string[][]> = {
    ask_job: [[`Ask ${npcFirst} if they like it`, 'Ask what the pay is like', 'Ask if they are hiring']],
    ask_family: [[`Ask about ${npcFirst}'s parents`, 'Share something about your own family', 'Ask if they see them much']],
    ask_hobby: [[`Ask ${npcFirst} to show you sometime`, 'Mention what you do for fun', 'Tease them about it a little']],
    ask_origin: [['Ask what brought them here', 'Ask if they miss it', 'Say where you are from']],
    ask_personal: [['Share something personal first', 'Back off and lighten the mood', 'Push a little']],
    question: [['Follow up on that', 'Ask something lighter', 'Say thanks and move on']],
    smalltalk: [['Ask about their day', `Ask ${npcFirst} what they do`, 'Make a joke']],
  };
  return rng.pick(banks[intent] ?? banks.smalltalk);
}

function ambientNarration(scene: SceneSnapshot, npc: Sim, rng: RNG): string {
  const v = scene.venue;
  return rng.pick([`${npc.identity.firstName} ${rng.pick(['glances at the door', 'wipes the counter without looking at it', 'shifts their weight', 'checks the time'])}.`, `${v.name} ${rng.pick(['hums along around you', 'is louder than it was a minute ago', 'smells like it always does'])}.`, `Somewhere behind you ${rng.pick(['a chair scrapes', 'a phone buzzes', 'someone laughs'])}.`]);
}

function staffLine(scene: SceneSnapshot, rng: RNG, text: string): InteractionOutcome['dialogue'] {
  const staff = scene.present.find((p) => p.role?.venueId === scene.venue.id) ?? scene.present[0];
  void rng;
  return staff ? [{ speakerId: staff.id, text, emotion: 'tense' }] : [{ speakerId: 'narrator', text: `A voice from somewhere: "${text}"` }];
}

function outcomeSentence(label: string, rng: RNG): string {
  const l = label.toLowerCase();
  if (/(great|excellent|perfect|success|nailed|amazing)/.test(l)) return rng.pick(['It goes better than expected.', 'Everything clicks.', 'You nail it.']);
  if (/(fail|burn|bad|poor|botch|disaster|broke)/.test(l)) return rng.pick(['It does not go well.', 'Something goes wrong halfway through.', 'You will not be bragging about this one.']);
  if (/(ok|fine|average|normal|decent)/.test(l)) return rng.pick(['Nothing special, nothing wrong.', 'It goes about how it usually goes.']);
  return `${label.charAt(0).toUpperCase() + label.slice(1)}.`;
}

function findVenueByName(state: WorldState, raw: string, currentId: VenueId): Venue | undefined {
  const q = raw.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  if (!q) return undefined;
  let best: Venue | undefined;
  let bestScore = 0;
  for (const v of Object.values(state.venues)) {
    if (v.id === currentId) continue;
    const name = v.name.toLowerCase();
    const arch = v.archetype.replace(/_/g, ' ');
    let score = 0;
    if (name === q) score = 100;
    else if (name.includes(q) || q.includes(name)) score = 60 + Math.min(20, name.length);
    else if (q === arch || q === `the ${arch}` || q.includes(arch)) score = 40;
    else if (q === 'home' && v.archetype === 'home') score = 90;
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  return bestScore >= 40 ? best : undefined;
}

function findPresentByText(scene: SceneSnapshot, text: string): Sim | undefined {
  const lower = text.toLowerCase();
  return scene.present.find((p) => lower.includes(p.identity.firstName.toLowerCase()) || lower.includes(p.identity.lastName.toLowerCase()) || (p.role && lower.includes(p.role.role.replace(/_/g, ' '))));
}

function findKnownByText(state: WorldState, actor: Sim, text: string): Sim | undefined {
  const lower = text.toLowerCase();
  for (const id of Object.keys(actor.relationships) as SimId[]) {
    const s = state.sims[id];
    if (s && (lower.includes(s.identity.firstName.toLowerCase()) || lower.includes(s.identity.lastName.toLowerCase()))) return s;
  }
  const rel = actor.relationships[actor.id];
  void rel;
  if (/\b(mom|mother)\b/.test(lower)) return Object.keys(actor.relationships).map((id) => state.sims[id as SimId]).find((s) => s && actor.relationships[s.id].flags.includes('parent') && s.identity.gender === 'female');
  if (/\b(dad|father)\b/.test(lower)) return Object.keys(actor.relationships).map((id) => state.sims[id as SimId]).find((s) => s && actor.relationships[s.id].flags.includes('parent') && s.identity.gender === 'male');
  return undefined;
}

function pickFoodHere(allowed: string[], content: ContentCatalog) {
  const foods = allowed.map((id) => content.items[id]).filter((i) => i && (i.category === 'food' || i.id.includes('meal') || i.id === 'sandwich'));
  foods.sort((a, b) => a.basePrice - b.basePrice);
  const prepared = foods.filter((f) => /meal|sandwich|takeout|fast_food|restaurant/.test(f.id));
  return prepared[Math.floor(prepared.length / 2)] ?? foods[0];
}

function findItemByText(content: ContentCatalog, allowed: string[], lower: string) {
  let best: (typeof content.items)[string] | undefined;
  let bestLen = 0;
  for (const id of allowed) {
    const it = content.items[id];
    if (!it) continue;
    const names = [it.name.toLowerCase(), id.replace(/_/g, ' ')];
    for (const n of names) {
      if (lower.includes(n) && n.length > bestLen) {
        best = it;
        bestLen = n.length;
      }
    }
  }
  return best;
}
