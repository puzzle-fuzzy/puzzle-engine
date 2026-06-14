ALTER TYPE "public"."audit_action" ADD VALUE 'canvas_project_create';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'canvas_project_delete';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'canvas_phase_run';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'canvas_cancel';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'canvas_asset_regenerate';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'gateway_call';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'generation_retry';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'generation_cancel';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'credit_reserve';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'credit_debit';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'credit_refund';