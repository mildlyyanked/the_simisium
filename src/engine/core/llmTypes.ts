/**
 * Boundary between the synchronous engine and the async LLM layer.
 * Implemented in src/engine/llm; the engine only knows this interface.
 */
import type { ActionDef, BioFact, Conversation, EffectBundle, Sim, SimId, Venue, WorldState } from './types';

export type LLMTask = 'dialogue' | 'adjudicate' | 'bio' | 'narrate' | 'summarize' | 'director';

/** A reply still being written: what the player sees while the model streams. */
export interface PartialReply {
  kind: 'dialogue' | 'narration';
  speakerId?: string;
  text: string;
}

export interface LLMUsage {
  task: LLMTask;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  ms: number;
  cached: boolean;
}

/** What the LLM returns for any interaction. Always passes through validateEffects before applying. */
export interface InteractionOutcome {
  /** narrator prose, second person for the player */
  narration: string;
  /** lines spoken by NPCs (and optionally the player, echoed) */
  dialogue: { speakerId: SimId | 'narrator'; text: string; emotion?: string }[];
  /** effects on the actor */
  effects: EffectBundle;
  /** effects on other sims present, keyed by sim id */
  otherEffects?: Record<SimId, EffectBundle>;
  /** bio facts of NPCs that were revealed to the actor in this exchange */
  revealedFacts: { simId: SimId; factIds: string[] }[];
  /** new memories for NPCs (their POV) */
  npcMemories: { simId: SimId; text: string; salience: number; valence: number }[];
  /** suggested follow-up choices for the player */
  followUps: string[];
  /** whether the conversation should end */
  endsConversation?: boolean;
  /** time the exchange took */
  minutes: number;
  /** flags for content the world rejected */
  rejected?: string[];
  usage?: LLMUsage;
  /** whether the fallback (non-LLM) path produced this */
  fallback?: boolean;
  /** the player addressed a present NPC and a conversation should open with them */
  startConversationWith?: SimId;
}

export interface SceneSnapshot {
  state: WorldState;
  actor: Sim;
  venue: Venue;
  present: Sim[];
  conversation?: Conversation;
}

export interface LLMService {
  /** true if a real model is configured and reachable */
  isLive(): boolean;
  /** most recent live-call failure (the fallback path was used), for diagnostics */
  lastError?: { task: LLMTask; message: string; at: number };
  /** A controlled sim says/does something in a conversation with NPCs. */
  converse(scene: SceneSnapshot, targetId: SimId, playerText: string, opts?: { channel?: Conversation['channel']; onPartial?: (p: PartialReply) => void }): Promise<InteractionOutcome>;
  /** A controlled sim attempts a freeform action described in text. */
  adjudicate(scene: SceneSnapshot, text: string, opts?: { action?: ActionDef; onPartial?: (p: PartialReply) => void }): Promise<InteractionOutcome>;
  /** Narrate a completed deterministic action (flavor only; no effects). */
  narrate(scene: SceneSnapshot, action: ActionDef, outcomeLabel?: string): Promise<string>;
  /** Generate an NPC's hidden biography. Deterministic given seed. */
  generateBio(state: WorldState, sim: Sim): Promise<{ summary: string; facts: BioFact[]; by: 'llm' | 'fallback' }>;
  /** Compress a sim's memories into a summary memory. */
  summarizeMemories(sim: Sim, texts: string[]): Promise<string>;
  /** Describe a venue from Google data. */
  describeVenue(state: WorldState, venue: Venue): Promise<string>;
  /** NPC-initiated outreach (text message / call content) */
  npcMessage(state: WorldState, from: Sim, to: Sim, reason: string): Promise<string>;
  /** Write one dilemma grounded in this sim's life; undefined when the model can't (the caller falls back to a template). */
  generateDilemma?(state: WorldState, sim: Sim, opts?: { theme?: string }): Promise<import('./types').GeneratedDilemma | undefined>;
  /** A realistic portrait photo (data URL) from an image-capable model; absent when no key is configured. */
  generatePortrait?(state: WorldState, sim: Sim): Promise<{ dataUrl: string; usage: LLMUsage }>;
  /** Weekly story direction (optional). */
  direct?(state: WorldState): Promise<{ beats: { label: string; simId?: SimId; inMinutes: number; kind: string; payload?: Record<string, unknown> }[] }>;
}
