/**
 * Vehicle catalog — realistic present-day US makes/models (2010–2026).
 * `basePriceNew` is an approximate MSRP at cost-of-living 1.0; the transport system
 * depreciates by age/mileage for used prices. `mpg` is MPGe for EVs (tankGallons = kWh).
 * For bicycles / e-bikes / e-scooters `tankGallons` is battery kWh (0 for pedal bikes).
 */
import type { VehicleDef } from './types';

const V = (
  make: string,
  model: string,
  kind: VehicleDef['kind'],
  fuelType: VehicleDef['fuelType'],
  basePriceNew: number,
  mpg: number,
  tankGallons: number,
  seats: number,
  reliability: number,
  insuranceMonthly: number,
  years: [number, number],
  tags: string[] = [],
): VehicleDef => ({ make, model, kind, fuelType, basePriceNew, mpg, tankGallons, seats, reliability, insuranceMonthly, years, tags });

export const VEHICLES: VehicleDef[] = [
  // --- compact & midsize sedans -------------------------------------------------
  V('Toyota', 'Corolla', 'car', 'gas', 22500, 33, 13.2, 5, 0.94, 108, [2010, 2026], ['compact', 'reliable', 'popular']),
  V('Toyota', 'Camry', 'car', 'gas', 27000, 32, 15.8, 5, 0.92, 118, [2010, 2026], ['midsize', 'reliable', 'popular']),
  V('Honda', 'Civic', 'car', 'gas', 24500, 35, 12.4, 5, 0.92, 114, [2010, 2026], ['compact', 'reliable', 'popular']),
  V('Honda', 'Accord', 'car', 'gas', 28500, 32, 14.8, 5, 0.91, 120, [2010, 2026], ['midsize', 'reliable']),
  V('Nissan', 'Altima', 'car', 'gas', 26500, 31, 16.2, 5, 0.76, 126, [2010, 2026], ['midsize']),
  V('Nissan', 'Sentra', 'car', 'gas', 21500, 33, 12.4, 5, 0.77, 110, [2013, 2026], ['compact', 'budget']),
  V('Hyundai', 'Elantra', 'car', 'gas', 22000, 35, 12.4, 5, 0.83, 114, [2011, 2026], ['compact', 'budget']),
  V('Hyundai', 'Sonata', 'car', 'gas', 27500, 31, 15.9, 5, 0.8, 122, [2011, 2026], ['midsize']),
  V('Kia', 'Forte', 'car', 'gas', 20500, 34, 14, 5, 0.8, 112, [2010, 2024], ['compact', 'budget']),
  V('Kia', 'Optima', 'car', 'gas', 24500, 30, 18.5, 5, 0.78, 122, [2011, 2020], ['midsize']),
  V('Ford', 'Focus', 'car', 'gas', 19500, 30, 12.4, 5, 0.66, 108, [2012, 2018], ['compact', 'budget']),
  V('Ford', 'Fusion', 'car', 'gas', 24500, 27, 16.5, 5, 0.72, 118, [2010, 2020], ['midsize']),
  V('Chevrolet', 'Malibu', 'car', 'gas', 25500, 30, 15.8, 5, 0.74, 118, [2010, 2025], ['midsize']),
  V('Chevrolet', 'Cruze', 'car', 'gas', 19500, 31, 13.7, 5, 0.68, 110, [2011, 2019], ['compact', 'budget']),
  V('Mazda', 'Mazda3', 'car', 'gas', 25000, 31, 13.2, 5, 0.9, 114, [2010, 2026], ['compact', 'sporty']),
  V('Subaru', 'Impreza', 'car', 'gas', 24000, 31, 13.2, 5, 0.86, 116, [2012, 2026], ['compact', 'awd']),
  V('Volkswagen', 'Jetta', 'car', 'gas', 22500, 34, 13.2, 5, 0.7, 120, [2011, 2026], ['compact']),
  V('Toyota', 'Prius', 'car', 'hybrid', 29000, 52, 11.3, 5, 0.94, 116, [2010, 2026], ['hybrid', 'efficient', 'reliable']),
  V('Honda', 'Fit', 'car', 'gas', 17500, 36, 10.6, 5, 0.9, 104, [2010, 2020], ['subcompact', 'budget', 'reliable']),
  V('Dodge', 'Charger', 'car', 'gas', 35000, 23, 18.5, 5, 0.68, 178, [2011, 2023], ['muscle', 'fast']),
  V('Ford', 'Mustang', 'car', 'gas', 31000, 25, 15.5, 4, 0.74, 172, [2010, 2026], ['muscle', 'fast']),
  V('BMW', '3 Series', 'car', 'gas', 46000, 28, 15.6, 5, 0.64, 192, [2010, 2026], ['luxury', 'sporty']),
  V('Mercedes-Benz', 'C-Class', 'car', 'gas', 48000, 27, 17.4, 5, 0.62, 198, [2010, 2026], ['luxury']),
  V('Lexus', 'ES', 'car', 'gas', 43500, 26, 15.9, 5, 0.94, 152, [2010, 2026], ['luxury', 'reliable']),
  // --- pickup trucks ----------------------------------------------------------
  V('Ford', 'F-150', 'truck', 'gas', 41000, 21, 26, 5, 0.8, 150, [2010, 2026], ['fullsize', 'popular', 'tow']),
  V('Chevrolet', 'Silverado 1500', 'truck', 'gas', 42000, 20, 24, 5, 0.78, 150, [2010, 2026], ['fullsize', 'tow']),
  V('Ram', '1500', 'truck', 'gas', 43000, 20, 26, 5, 0.7, 156, [2011, 2026], ['fullsize', 'tow']),
  V('Toyota', 'Tacoma', 'truck', 'gas', 34000, 21, 21.1, 5, 0.93, 130, [2010, 2026], ['midsize', 'reliable']),
  V('Toyota', 'Tundra', 'truck', 'gas', 43000, 19, 22.5, 5, 0.9, 146, [2010, 2026], ['fullsize', 'reliable']),
  V('Ford', 'Ranger', 'truck', 'gas', 32000, 23, 18, 5, 0.78, 128, [2019, 2026], ['midsize']),
  // --- SUVs & crossovers ------------------------------------------------------
  V('Toyota', 'RAV4', 'suv', 'gas', 31000, 30, 14.5, 5, 0.92, 126, [2010, 2026], ['compact_suv', 'popular', 'reliable']),
  V('Honda', 'CR-V', 'suv', 'gas', 31500, 30, 14, 5, 0.92, 126, [2010, 2026], ['compact_suv', 'popular', 'reliable']),
  V('Ford', 'Explorer', 'suv', 'gas', 39000, 22, 18.6, 7, 0.68, 152, [2011, 2026], ['3row']),
  V('Ford', 'Escape', 'suv', 'gas', 29500, 28, 15.7, 5, 0.7, 126, [2013, 2026], ['compact_suv']),
  V('Chevrolet', 'Equinox', 'suv', 'gas', 28500, 28, 14.9, 5, 0.72, 126, [2010, 2026], ['compact_suv']),
  V('Chevrolet', 'Tahoe', 'suv', 'gas', 58000, 17, 24, 8, 0.7, 175, [2010, 2026], ['fullsize', '3row', 'tow']),
  V('Jeep', 'Wrangler', 'suv', 'gas', 36000, 20, 21.5, 5, 0.58, 162, [2010, 2026], ['offroad', 'iconic']),
  V('Jeep', 'Grand Cherokee', 'suv', 'gas', 41000, 21, 24.6, 5, 0.6, 162, [2011, 2026], ['midsize_suv']),
  V('Subaru', 'Outback', 'suv', 'gas', 31000, 29, 18.5, 5, 0.88, 126, [2010, 2026], ['wagon', 'awd', 'reliable']),
  V('Subaru', 'Forester', 'suv', 'gas', 30000, 29, 16.6, 5, 0.88, 124, [2010, 2026], ['compact_suv', 'awd']),
  V('Toyota', 'Highlander', 'suv', 'gas', 41000, 24, 17.9, 8, 0.9, 140, [2010, 2026], ['3row', 'reliable']),
  V('Toyota', '4Runner', 'suv', 'gas', 42000, 19, 23, 5, 0.93, 142, [2010, 2026], ['offroad', 'reliable']),
  V('Nissan', 'Rogue', 'suv', 'gas', 29500, 30, 14.5, 5, 0.74, 126, [2010, 2026], ['compact_suv']),
  V('Hyundai', 'Tucson', 'suv', 'gas', 28500, 28, 14.3, 5, 0.82, 126, [2010, 2026], ['compact_suv']),
  V('Kia', 'Telluride', 'suv', 'gas', 38000, 23, 18.8, 8, 0.82, 140, [2020, 2026], ['3row']),
  V('Mazda', 'CX-5', 'suv', 'gas', 30000, 28, 15.3, 5, 0.9, 126, [2013, 2026], ['compact_suv', 'sporty']),
  // --- minivans ---------------------------------------------------------------
  V('Honda', 'Odyssey', 'van', 'gas', 39000, 22, 19.5, 8, 0.86, 140, [2011, 2026], ['minivan', 'family']),
  V('Toyota', 'Sienna', 'van', 'hybrid', 41000, 36, 18, 8, 0.9, 140, [2011, 2026], ['minivan', 'family', 'hybrid']),
  V('Chrysler', 'Pacifica', 'van', 'gas', 40000, 22, 19, 7, 0.62, 146, [2017, 2026], ['minivan', 'family']),
  V('Dodge', 'Grand Caravan', 'van', 'gas', 28000, 20, 20, 7, 0.6, 132, [2010, 2020], ['minivan', 'budget']),
  V('Ford', 'Transit Connect', 'van', 'gas', 30000, 26, 15.8, 5, 0.7, 138, [2010, 2023], ['cargo', 'work']),
  // --- electric vehicles (mpg = MPGe, tankGallons = battery kWh) --------------
  V('Tesla', 'Model 3', 'car', 'electric', 42000, 132, 60, 5, 0.8, 166, [2017, 2026], ['ev', 'tech']),
  V('Tesla', 'Model Y', 'suv', 'electric', 47000, 122, 75, 5, 0.8, 172, [2020, 2026], ['ev', 'popular']),
  V('Chevrolet', 'Bolt EV', 'car', 'electric', 30000, 120, 65, 5, 0.82, 130, [2017, 2023], ['ev', 'budget']),
  V('Nissan', 'Leaf', 'car', 'electric', 29000, 111, 40, 5, 0.8, 124, [2011, 2025], ['ev', 'budget']),
  V('Ford', 'Mustang Mach-E', 'suv', 'electric', 45000, 100, 88, 5, 0.74, 160, [2021, 2026], ['ev']),
  V('Hyundai', 'Ioniq 5', 'suv', 'electric', 44000, 110, 77, 5, 0.85, 156, [2022, 2026], ['ev']),
  V('Rivian', 'R1T', 'truck', 'electric', 72000, 70, 135, 5, 0.7, 210, [2022, 2026], ['ev', 'luxury', 'tow']),
  // --- motorcycles ------------------------------------------------------------
  V('Honda', 'Rebel 500', 'motorcycle', 'gas', 6600, 67, 3, 2, 0.92, 46, [2017, 2026], ['cruiser', 'beginner']),
  V('Honda', 'Grom', 'motorcycle', 'gas', 3600, 134, 1.6, 2, 0.92, 32, [2014, 2026], ['mini', 'cheap']),
  V('Harley-Davidson', 'Sportster', 'motorcycle', 'gas', 12500, 48, 3.3, 2, 0.74, 72, [2010, 2022], ['cruiser', 'iconic']),
  V('Kawasaki', 'Ninja 400', 'motorcycle', 'gas', 5600, 58, 3.7, 2, 0.88, 62, [2018, 2026], ['sport', 'beginner']),
  V('Yamaha', 'MT-07', 'motorcycle', 'gas', 8300, 58, 3.7, 2, 0.88, 64, [2015, 2026], ['naked', 'fun']),
  V('Vespa', 'Primavera 150', 'scooter', 'gas', 6000, 90, 2.1, 2, 0.8, 40, [2014, 2026], ['scooter', 'city']),
  // --- bicycles ---------------------------------------------------------------
  V('Huffy', 'Rock Creek', 'bicycle', 'none', 200, 0, 0, 1, 0.7, 0, [2015, 2026], ['bike', 'budget', 'big_box']),
  V('Schwinn', 'Cruiser', 'bicycle', 'none', 350, 0, 0, 1, 0.8, 0, [2010, 2026], ['bike', 'cruiser']),
  V('Trek', 'FX 2', 'bicycle', 'none', 650, 0, 0, 1, 0.95, 0, [2012, 2026], ['bike', 'hybrid', 'commuter']),
  V('Specialized', 'Sirrus', 'bicycle', 'none', 800, 0, 0, 1, 0.95, 0, [2012, 2026], ['bike', 'fitness']),
  V('Trek', 'Marlin', 'bicycle', 'none', 700, 0, 0, 1, 0.93, 0, [2014, 2026], ['bike', 'mountain']),
  // --- e-bikes & e-scooters (tankGallons = battery kWh) -----------------------
  V('Rad Power', 'RadRunner', 'ebike', 'electric', 1500, 0, 0.67, 1, 0.85, 0, [2019, 2026], ['ebike', 'utility']),
  V('Aventon', 'Level.2', 'ebike', 'electric', 1800, 0, 0.72, 1, 0.85, 0, [2021, 2026], ['ebike', 'commuter']),
  V('Lectric', 'XP 3.0', 'ebike', 'electric', 1000, 0, 0.5, 1, 0.8, 0, [2022, 2026], ['ebike', 'folding', 'budget']),
  V('Segway', 'Ninebot Max', 'scooter', 'electric', 800, 0, 0.55, 1, 0.82, 0, [2019, 2026], ['escooter', 'commuter']),
  V('Xiaomi', 'Mi Electric Scooter', 'scooter', 'electric', 500, 0, 0.28, 1, 0.75, 0, [2018, 2026], ['escooter', 'budget']),
];

/** Look up a catalog entry for a vehicle instance by make/model. */
export function findVehicleDef(make: string, model: string): VehicleDef | undefined {
  return VEHICLES.find((v) => v.make === make && v.model === model);
}
