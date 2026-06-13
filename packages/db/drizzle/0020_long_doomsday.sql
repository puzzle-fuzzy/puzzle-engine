CREATE TYPE "public"."canvas_asset_category" AS ENUM('analysis', 'characterProfile', 'locationProfile', 'characterPortrait', 'characterTurnaround', 'locationRef', 'storyboard', 'continuityReport', 'videoPrompt', 'shotVideo');--> statement-breakpoint
CREATE TYPE "public"."canvas_asset_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "canvas_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"category" "canvas_asset_category" NOT NULL,
	"target_entity_type" varchar(50) NOT NULL,
	"target_entity_id" uuid NOT NULL,
	"status" "canvas_asset_status" DEFAULT 'queued' NOT NULL,
	"model" varchar(100),
	"pipeline_run_id" uuid,
	"task_id" uuid,
	"input_json" jsonb,
	"output_json" jsonb,
	"public_url" text,
	"storage_path" text,
	"provider_url" text,
	"cost" jsonb,
	"total_price_cents" integer,
	"error_message" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "canvas_assets" ADD CONSTRAINT "canvas_assets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_assets" ADD CONSTRAINT "canvas_assets_project_id_canvas_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."canvas_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_assets" ADD CONSTRAINT "canvas_assets_pipeline_run_id_canvas_pipeline_runs_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."canvas_pipeline_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_assets" ADD CONSTRAINT "canvas_assets_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_canvas_assets_project_category" ON "canvas_assets" USING btree ("project_id","category");--> statement-breakpoint
CREATE INDEX "idx_canvas_assets_target" ON "canvas_assets" USING btree ("target_entity_type","target_entity_id");--> statement-breakpoint
CREATE INDEX "idx_canvas_assets_project_status" ON "canvas_assets" USING btree ("project_id","status");