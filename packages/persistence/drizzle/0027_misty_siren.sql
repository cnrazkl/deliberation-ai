CREATE TABLE "preflight_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"question_ciphertext" text,
	"request_ciphertext" text,
	"questions" jsonb NOT NULL,
	"status" text DEFAULT 'awaiting_input' NOT NULL,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preflight_drafts_status_valid" CHECK ("preflight_drafts"."status" in ('awaiting_input', 'started', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "preflight_decision_ciphertext" text;--> statement-breakpoint
CREATE UNIQUE INDEX "preflight_drafts_owner_key_uq" ON "preflight_drafts" USING btree ("owner_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "preflight_drafts_owner_status_created_idx" ON "preflight_drafts" USING btree ("owner_id","status","created_at");