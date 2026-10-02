CREATE TABLE "research_captures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"report_claim_id" text NOT NULL,
	"requested_url_ciphertext" text NOT NULL,
	"final_url_ciphertext" text NOT NULL,
	"title_ciphertext" text NOT NULL,
	"content_ciphertext" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_length" integer NOT NULL,
	"content_sha256" text NOT NULL,
	"redirect_count" integer DEFAULT 0 NOT NULL,
	"review_status" text DEFAULT 'unreviewed' NOT NULL,
	"evidence_source_id" uuid,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "research_captures_byte_length_positive" CHECK ("research_captures"."byte_length" > 0),
	CONSTRAINT "research_captures_redirect_count_range" CHECK ("research_captures"."redirect_count" between 0 and 3),
	CONSTRAINT "research_captures_review_status_valid" CHECK ("research_captures"."review_status" in ('unreviewed', 'accepted', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "research_captures" ADD CONSTRAINT "research_captures_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_captures" ADD CONSTRAINT "research_captures_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_captures" ADD CONSTRAINT "research_captures_evidence_source_id_evidence_sources_id_fk" FOREIGN KEY ("evidence_source_id") REFERENCES "public"."evidence_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_captures_run_claim_idx" ON "research_captures" USING btree ("run_id","report_claim_id");--> statement-breakpoint
CREATE INDEX "research_captures_owner_captured_idx" ON "research_captures" USING btree ("owner_id","captured_at");