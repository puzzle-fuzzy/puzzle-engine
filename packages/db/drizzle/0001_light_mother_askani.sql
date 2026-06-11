CREATE TYPE "public"."canvas_project_status" AS ENUM('draft', 'analyzed', 'characters_ready', 'locations_ready', 'refs_ready', 'storyboard_ready', 'continuity_checked', 'prompts_ready', 'generating', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."canvas_shot_status" AS ENUM('draft', 'ready', 'generating', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "canvas_characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"role" varchar(50),
	"description" text,
	"identity_prompt" text,
	"negative_prompt" text,
	"profile_json" jsonb,
	"reference_image_url" text,
	"turnaround_sheet_url" text,
	"locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canvas_continuity_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"issues_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canvas_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"type" varchar(50) DEFAULT 'mixed' NOT NULL,
	"profile_json" jsonb,
	"scene_prompt" text,
	"negative_prompt" text,
	"reference_image_url" text,
	"locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canvas_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"title" varchar(500),
	"story_text" text NOT NULL,
	"status" "canvas_project_status" DEFAULT 'draft' NOT NULL,
	"analysis_json" jsonb,
	"canvas_layout" jsonb,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canvas_shots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"shot_index" integer NOT NULL,
	"duration" integer DEFAULT 5 NOT NULL,
	"location_id" uuid,
	"character_ids_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"narrative" text NOT NULL,
	"camera_json" jsonb NOT NULL,
	"continuity_json" jsonb NOT NULL,
	"timeline_json" jsonb,
	"environment_json" jsonb,
	"video_prompt" text,
	"negative_prompt" text,
	"video_task_id" varchar(255),
	"video_url" text,
	"status" "canvas_shot_status" DEFAULT 'draft' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "canvas_characters" ADD CONSTRAINT "canvas_characters_project_id_canvas_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."canvas_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_continuity_reports" ADD CONSTRAINT "canvas_continuity_reports_project_id_canvas_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."canvas_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_locations" ADD CONSTRAINT "canvas_locations_project_id_canvas_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."canvas_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_projects" ADD CONSTRAINT "canvas_projects_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_shots" ADD CONSTRAINT "canvas_shots_project_id_canvas_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."canvas_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_shots" ADD CONSTRAINT "canvas_shots_location_id_canvas_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."canvas_locations"("id") ON DELETE no action ON UPDATE no action;