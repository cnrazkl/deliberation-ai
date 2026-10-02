CREATE TABLE "conversation_runs" (
	"owner_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"source_run_id" uuid,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "conversation_runs_owner_id_run_id_pk" PRIMARY KEY("owner_id","run_id"),
	CONSTRAINT "conversation_runs_kind_valid" CHECK (("conversation_runs"."kind" = 'independent' and "conversation_runs"."source_run_id" is null) or
    ("conversation_runs"."kind" in ('continuation-full', 'continuation-compacted', 'member-rerun') and "conversation_runs"."source_run_id" is not null and "conversation_runs"."source_run_id" <> "conversation_runs"."run_id"))
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"anchor_run_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_origin_valid" CHECK ("conversations"."origin" in ('native', 'legacy-reconstructed'))
);
--> statement-breakpoint
ALTER TABLE "conversation_runs" ADD CONSTRAINT "conversation_runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_runs_owner_conversation_created_idx" ON "conversation_runs" USING btree ("owner_id","conversation_id","created_at","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_owner_anchor_uq" ON "conversations" USING btree ("owner_id","anchor_run_id");