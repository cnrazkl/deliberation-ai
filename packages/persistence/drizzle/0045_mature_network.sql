CREATE TABLE "private_branch_deletions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"audit_ciphertext" text NOT NULL,
	"deleted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "private_branch_deletions_owner_conversation_idx" ON "private_branch_deletions" USING btree ("owner_id","conversation_id","id");