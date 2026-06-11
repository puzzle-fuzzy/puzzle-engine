ALTER TYPE "public"."generation_status" ADD VALUE 'submitting' BEFORE 'processing';--> statement-breakpoint
ALTER TYPE "public"."generation_status" ADD VALUE 'saving_output' BEFORE 'succeeded';--> statement-breakpoint
ALTER TYPE "public"."generation_status" ADD VALUE 'cancelled';