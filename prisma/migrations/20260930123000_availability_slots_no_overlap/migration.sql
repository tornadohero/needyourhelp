-- T011: an availability slot is the unit a confirmed booking consumes, so two
-- slots of one provider may never overlap. Without this, two bookings could
-- overlap in time and the invariant "no overlapping confirmed bookings"
-- (`specs/01-business-rules.md` §Orders: an order needs valid service
-- availability) would depend on application timing alone.
--
-- `btree_gist` is required to combine an equality column with a range operator
-- in one GiST exclusion constraint. It is a standard contrib extension; on a
-- managed PostgreSQL it must be allow-listed before deploying.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "availability_slots"
  ADD CONSTRAINT "availability_slots_no_overlap"
  EXCLUDE USING gist (
    "provider_id" WITH =,
    tsrange("start_at", "end_at", '[)') WITH &&
  );
