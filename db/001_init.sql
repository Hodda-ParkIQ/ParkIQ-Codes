CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE IF NOT EXISTS parking_lots (
    id text PRIMARY KEY,
    location geography(Point,4326) NOT NULL,
    payload jsonb NOT NULL,
    demo boolean NOT NULL DEFAULT false,
    fetched_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS parking_lots_location_gist ON parking_lots USING gist(location);
CREATE INDEX IF NOT EXISTS parking_lots_mode ON parking_lots(demo);
