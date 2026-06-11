ALTER TABLE "generation_records" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_records" ADD COLUMN "dedupe_key" varchar(255);--> statement-breakpoint
ALTER TABLE "generation_records" ADD CONSTRAINT "generation_records_dedupe_key_unique" UNIQUE("dedupe_key");