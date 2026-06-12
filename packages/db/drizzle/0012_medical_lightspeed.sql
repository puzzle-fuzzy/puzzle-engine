CREATE TYPE "public"."audit_action" AS ENUM('login', 'register', 'generate', 'file_delete', 'billing_transaction', 'api_key_create', 'api_key_revoke', 'admin_action');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"action" "audit_action" NOT NULL,
	"target_id" varchar(255),
	"detail" jsonb,
	"ip" varchar(45),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_logs_account" ON "audit_logs" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_action" ON "audit_logs" USING btree ("action","created_at");