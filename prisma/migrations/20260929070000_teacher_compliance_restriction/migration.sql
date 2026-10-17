-- T007 Teacher compliance
-- Scope of a `RESTRICTED` compliance decision on a provider capability.
-- `specs/06-verification-state-machine.md` §Teacher compliance:
-- "Restriction can be category/time/location specific through `restriction_json`".
ALTER TABLE "provider_capabilities" ADD COLUMN "restriction_json" JSONB;
