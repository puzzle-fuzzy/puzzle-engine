CREATE TYPE "public"."subtitle_project_status" AS ENUM('draft', 'extracting_audio', 'asr_processing', 'subtitle_editing', 'exporting', 'completed', 'failed');--> statement-breakpoint
ALTER TYPE "public"."generation_category" ADD VALUE 'subtitle';--> statement-breakpoint
CREATE TABLE "subtitle_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"video_file_id" uuid NOT NULL,
	"video_url" text NOT NULL,
	"audio_file_url" text,
	"video_duration_ms" integer,
	"asr_record_id" uuid,
	"status" "subtitle_project_status" DEFAULT 'draft' NOT NULL,
	"raw_transcription" jsonb,
	"sentences" jsonb,
	"style_config" jsonb DEFAULT '{"templateId":"cinema","fontSize":24,"fontColor":"#FFFFFF","outlineColor":"#000000","outlineWidth":2,"position":"bottom","marginV":30,"bold":false}'::jsonb,
	"export_record_id" uuid,
	"exported_video_url" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subtitle_projects" ADD CONSTRAINT "subtitle_projects_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtitle_projects" ADD CONSTRAINT "subtitle_projects_video_file_id_uploaded_files_id_fk" FOREIGN KEY ("video_file_id") REFERENCES "public"."uploaded_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtitle_projects" ADD CONSTRAINT "subtitle_projects_asr_record_id_generation_records_id_fk" FOREIGN KEY ("asr_record_id") REFERENCES "public"."generation_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtitle_projects" ADD CONSTRAINT "subtitle_projects_export_record_id_generation_records_id_fk" FOREIGN KEY ("export_record_id") REFERENCES "public"."generation_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_subtitle_projects_account_created" ON "subtitle_projects" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_subtitle_projects_status" ON "subtitle_projects" USING btree ("status");