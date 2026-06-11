ALTER TABLE "generation_records" ALTER COLUMN "category" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."generation_category";--> statement-breakpoint
CREATE TYPE "public"."generation_category" AS ENUM('text', 'image', 'video');--> statement-breakpoint
ALTER TABLE "generation_records" ALTER COLUMN "category" SET DATA TYPE "public"."generation_category" USING "category"::"public"."generation_category";