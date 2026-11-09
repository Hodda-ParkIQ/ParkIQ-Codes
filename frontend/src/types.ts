export type Point = { lat: number; lng: number };
export type Place = Point & {
  id: string;
  name: string;
  address: string;
  category: string;
};
export type Preference = "balanced" | "less_walking" | "fastest" | "cheapest";
export type Lot = Place & {
  capacity: number;
  available: number | null;
  base_fee: number | null;
  base_minutes: number;
  extra_fee: number | null;
  extra_minutes: number;
  daily_max: number | null;
  ev: boolean | null;
  accessible: boolean | null;
  source: string;
  source_id: string;
  is_open: boolean | null;
  observed_at: string | null;
  fetched_at: string;
  demo: boolean;
};
export type Candidate = {
  lot: Lot;
  drive_minutes: number;
  walk_minutes: number;
  walk_meters: number;
  search_minutes: number;
  total_minutes: number;
  estimated_fee: number | null;
  risk: "low" | "medium" | "high" | "unknown";
  stale: boolean;
  score: number;
  reasons: string[];
  routing_source: string;
  drive_path: Point[];
  walk_path: Point[];
};
export type Result = {
  mode: "demo" | "live";
  generated_at: string;
  destination: Place;
  preference: Preference;
  candidates: Candidate[];
  excluded_full: number;
  warnings: string[];
};
export type Intent = {
  action:
    | "search"
    | "preference"
    | "select"
    | "navigate"
    | "cancel"
    | "unknown";
  preference: Preference | null;
  rank: number | null;
  query: string | null;
  reply: string;
};
export type VehicleState = { moving: boolean; origin?: Point };
export type GleoCall = {
  id: string;
  action: string;
  parameters: Record<string, unknown>;
};
