CREATE TYPE "public"."canvas_pipeline_phase" AS ENUM('analyze', 'characters', 'locations', 'characterRefs', 'locationRefs', 'storyboard', 'continuity', 'rebuild', 'videos');--> statement-breakpoint
CREATE TYPE "public"."canvas_pipeline_run_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "canvas_pipeline_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"phase" "canvas_pipeline_phase" NOT NULL,
	"status" "canvas_pipeline_run_status" DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_message" text,
	"created_by" uuid,
	"input_snapshot_json" jsonb,
	"output_summary_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "canvas_pipeline_runs" ADD CONSTRAINT "canvas_pipeline_runs_project_id_canvas_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."canvas_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_pipeline_runs" ADD CONSTRAINT "canvas_pipeline_runs_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_pipeline_runs_project_phase_status" ON "canvas_pipeline_runs" USING btree ("project_id","phase","status");--> statement-breakpoint
CREATE INDEX "idx_pipeline_runs_project_created" ON "canvas_pipeline_runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_pipeline_runs_one_active_per_phase" ON "canvas_pipeline_runs" ("project_id", "phase") WHERE status IN ('pending', 'running');