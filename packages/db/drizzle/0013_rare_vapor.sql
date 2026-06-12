ALTER TABLE "generation_records" ADD COLUMN "trace_id" varchar(36);--> statement-breakpoint
CREATE INDEX "idx_gen_records_trace_id" ON "generation_records" USING btree ("trace_id");