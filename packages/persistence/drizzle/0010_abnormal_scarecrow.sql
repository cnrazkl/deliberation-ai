CREATE TABLE "memory_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"source_run_id" uuid NOT NULL,
	"source_claim_id" text NOT NULL,
	"source_type" text NOT NULL,
	"evidence_state" text NOT NULL,
	"content_ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_entries_source_type_valid" CHECK ("memory_entries"."source_type" in ('analyst-claim', 'red-team-challenge')),
	CONSTRAINT "memory_entries_evidence_state_valid" CHECK ("memory_entries"."evidence_state" in ('unsupported', 'model-supported', 'externally-verified', 'contradicted', 'stale'))
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "memory_context_ciphertext" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "memory_entry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_entries" ADD CONSTRAINT "memory_entries_source_run_id_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_entries_owner_source_uq" ON "memory_entries" USING btree ("owner_id","source_run_id","source_claim_id");--> statement-breakpoint
CREATE INDEX "memory_entries_owner_created_idx" ON "memory_entries" USING btree ("owner_id","created_at");--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_memory_entry_count_range" CHECK ("runs"."memory_entry_count" between 0 and 5);