CREATE TABLE "run_deletions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"intent_key_hash" text NOT NULL,
	"audit_ciphertext" text NOT NULL,
	"deleted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "run_deletions_owner_intent_uq" ON "run_deletions" USING btree ("owner_id","intent_key_hash");--> statement-breakpoint
CREATE INDEX "run_deletions_owner_conversation_idx" ON "run_deletions" USING btree ("owner_id","conversation_id","id");