import type { GooglePlaceData, LatLng, TravelMode } from '../core/types';

export interface PlaceSummary extends GooglePlaceData {}

export interface PlaceDetails extends GooglePlaceData {}

export interface PlacePrediction {
  placeId: string;
  text: string;
  secondaryText?: string;
  types: string[];
}

export interface TravelEstimate {
  mode: TravelMode;
  minutes: number;
  distanceKm: number;
  /** dollars: fuel / fare */
  cost: number;
  /** provider used */
  source: 'routes_api' | 'estimate';
}

export interface PlacesProvider {
  readonly id: 'google' | 'mock';
  searchNearby(center: LatLng, radiusM: number, includedTypes: string[], maxResults?: number): Promise<PlaceSummary[]>;
  searchText(query: string, center: LatLng, radiusM: number, maxResults?: number): Promise<PlaceSummary[]>;
  details(placeId: string): Promise<PlaceDetails>;
  autocomplete(input: string, center?: LatLng): Promise<PlacePrediction[]>;
  geocode(address: string): Promise<{ location: LatLng; formatted: string; city?: string; state?: string; stateCode?: string } | undefined>;
  reverseGeocode(location: LatLng): Promise<{ formatted: string; city?: string; state?: string; stateCode?: string } | undefined>;
  travel(from: LatLng, to: LatLng, mode: TravelMode, departAtIso?: string): Promise<TravelEstimate>;
}
