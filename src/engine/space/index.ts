/**
 * Spatial layer: floor plans per venue and tile positions for sims and objects.
 * Pure TypeScript; the engine owns the state, this module owns the geometry.
 */
import type { VenueId, VenueLayout, WorldState } from '../core/types';
import { generateLayout, placeNewObjects, LAYOUT_VERSION } from './layout';

/** The venue's floor plan, generated on first use and kept in the world state. */
export function ensureLayout(state: WorldState, venueId: VenueId): VenueLayout | undefined {
  const venue = state.venues[venueId];
  if (!venue) return undefined;
  state.layouts ||= {};
  let layout = state.layouts[venueId];
  if (!layout || layout.version !== LAYOUT_VERSION) {
    layout = generateLayout(venue, state.objects);
    state.layouts[venueId] = layout;
  } else placeNewObjects(layout, venue, state.objects);
  return layout;
}

export { generateLayout, placeNewObjects, LAYOUT_VERSION } from './layout';
export * from './nav';
