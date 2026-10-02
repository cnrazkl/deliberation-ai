CREATE TABLE "evidence_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"report_claim_id" text NOT NULL,
	"relation" text NOT NULL,
	"review_status" text DEFAULT 'unreviewed' NOT NULL,
	"title_ciphertext" text NOT NULL,
	"url_ciphertext" text NOT NULL,
	"note_ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_sources_relation_valid" CHECK ("evidence_sources"."relation" in ('supports', 'contradicts', 'context')),
	CONSTRAINT "evidence_sources_review_status_valid" CHECK ("evidence_sources"."review_status" in ('unreviewed', 'verified', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "evidence_sources" ADD CONSTRAINT "evidence_sources_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_sources" ADD CONSTRAINT "evidence_sources_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_sources_run_claim_idx" ON "evidence_sources" USING btree ("run_id","report_claim_id");