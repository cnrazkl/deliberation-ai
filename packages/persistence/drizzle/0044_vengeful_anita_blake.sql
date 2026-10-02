CREATE TABLE "conversation_private_branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"source_run_id" uuid NOT NULL,
	"source_member_id" text NOT NULL,
	"parent_branch_id" uuid,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"body_ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "private_branches_bounds" CHECK ("conversation_private_branches"."revision" between 1 and 65 and "conversation_private_branches"."message_count" between 0 and 64),
	CONSTRAINT "private_branches_parent_valid" CHECK ("conversation_private_branches"."parent_branch_id" is null or "conversation_private_branches"."parent_branch_id" <> "conversation_private_branches"."id")
);
--> statement-breakpoint
ALTER TABLE "conversation_private_branches" ADD CONSTRAINT "conversation_private_branches_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "private_branches_owner_request_uq" ON "conversation_private_branches" USING btree ("owner_id","request_id");--> statement-breakpoint
CREATE INDEX "private_branches_owner_conversation_created_idx" ON "conversation_private_branches" USING btree ("owner_id","conversation_id","created_at","id");