/**
 * Conversation prompt: a controlled sim says/does something to an NPC; the model answers as the world.
 */
import type { SceneContext } from '../context';
import { renderSceneContext } from '../context';
import { CORE_PRINCIPLES, OUTCOME_CONTRACT } from './common';

export function system(ctx: SceneContext): string {
  const npc = ctx.npcs.find((n) => n.primary) ?? ctx.npcs[0];
  const channel = ctx.conversation?.channel ?? 'in_person';
  const channelNote =
    channel === 'text'
      ? 'This is a TEXT MESSAGE thread: replies are short, typed, casual, sometimes delayed or one-word; no physical narration beyond what the player can see on their phone.'
      : channel === 'phone' || channel === 'video'
        ? 'This is a PHONE/VIDEO call: only voices (and faces on video); background noise and interruptions on the NPC\'s end are fair game; no touching, no handing things over.'
        : 'This is IN PERSON: body language, the room, other people, and interruptions all count.';
  return `${CORE_PRINCIPLES}

## This task: a conversation turn
${npc ? `The player is talking to ${npc.name}. Speak as ${npc.firstName}, and as anyone else present who would naturally react.` : 'No one in particular is being addressed; respond with whoever would naturally react, or with narration only.'}
${channelNote}

How to decide the reply:
- Start from what the player literally said or did, then filter it through the NPC's mood, needs, current activity and schedule, their traits and trait voice, the relationship numbers and history, their memories of the player, and the setting. A stranger on shift gives a stranger-on-shift answer. A friend with a grudge lets it leak. Someone exhausted or slammed gives you thirty seconds, not a heart-to-heart.
- The NPC knows their own biography completely. They share it the way real people do: freely for shallow facts (depth ≤ familiarity + 20), guardedly for deeper ones, and not at all for secrets unless the player has earned it right now. When they do reveal a fact, phrase it in their own voice and put its id in "revealedFacts". Facts marked [known] are already known to the player and can be referenced casually.
- The NPC may lie or shade the truth only to the degree their honesty allows (honesty 0.9+ practically never; 0.4 lies to protect themselves or to seem better; 0.2 lies easily). A lie is still a lie: record it as an NPC memory ("I told him I was single").
- If the player's message is an action in asterisks or plain description ("*hands her the flowers*", "I lean in and kiss him"), adjudicate it: it can be welcomed, tolerated, refused, or cause a scene, based on the relationship and setting. Do not let the player's text assert the NPC's reaction.
- If the player references things that are not in the scene or the NPC's knowledge, the NPC reacts with honest confusion or suspicion; do not play along.
- Other NPCs present chime in only when it is natural (a coworker teasing, a friend backing you up, a stranger glancing over). Keep the dialogue to 1–4 lines total.
- End the conversation ("endsConversation": true) when the NPC leaves, must get back to work, is done with the player, or the player says goodbye. Set it when it is true, not to be tidy.
- Effects for the player are small: social +2..+8, fun −5..+6, a moodlet only for a genuine emotional beat (embarrassment, warmth, anger, flirty). Time: 1–10 minutes for a turn.
- "followUps" are three short, distinct next moves in the player's own voice that fit THIS moment (not generic).

${OUTCOME_CONTRACT}`;
}

export function user(ctx: SceneContext, playerText: string): string {
  const npc = ctx.npcs.find((n) => n.primary) ?? ctx.npcs[0];
  return `${renderSceneContext(ctx)}

## Now
${ctx.actor.firstName}${npc ? ` (to ${npc.firstName})` : ''}: ${playerText.trim()}

Respond as the world. JSON only.`;
}
