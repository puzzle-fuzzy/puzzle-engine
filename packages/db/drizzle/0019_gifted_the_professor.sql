CREATE TYPE "public"."task_domain" AS ENUM('canvas', 'generate', 'subtitle', 'gateway');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('queued', 'running', 'retrying', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"type" varchar(100) NOT NULL,
	"domain" "task_domain" NOT NULL,
	"priority" integer DEFAULT 5 NOT NULL,
	"project_id" uuid,
	"target_type" varchar(50),
	"target_id" uuid,
	"input" jsonb,
	"output" jsonb,
	"error_json" jsonb,
	"error_message" text,
	"generation_record_id" uuid,
	"locked_by" varchar(100) DEFAULT '' NOT NULL,
	"locked_until" timestamp with time zone,
	"status" "task_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "canvas_pipeline_runs" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_tasks_status_next_run" ON "tasks" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "idx_tasks_locked_until" ON "tasks" USING btree ("locked_until");--> statement-breakpoint
CREATE INDEX "idx_tasks_domain_type" ON "tasks" USING btree ("domain","type");--> statement-breakpoint
CREATE INDEX "idx_tasks_project" ON "tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_pipeline_runs_task" ON "canvas_pipeline_runs" USING btree ("task_id");