ALTER TYPE "public"."notification_type" ADD VALUE 'canvas_completed' BEFORE 'api_key_expired';--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "meta" jsonb;