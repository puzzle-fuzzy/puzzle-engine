ALTER TABLE "generation_records" ADD COLUMN "total_price_cents" integer;

-- Backfill from existing cost JSONB
UPDATE "generation_records"
SET "total_price_cents" = ("cost"->>'totalPriceCents')::int
WHERE "cost" IS NOT NULL AND "total_price_cents" IS NULL;

-- Index for account-level cost aggregation queries
CREATE INDEX "idx_gen_records_account_cost" ON "generation_records" ("account_id", "total_price_cents")
WHERE "total_price_cents" IS NOT NULL;