ALTER TABLE "claims" ADD COLUMN "report_claim_id" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "evidence_state" text DEFAULT 'unsupported' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "claims_run_report_claim_uq" ON "claims" USING btree ("run_id","report_claim_id");--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_evidence_state_valid" CHECK ("claims"."evidence_state" in ('unsupported', 'model-supported', 'externally-verified', 'contradicted', 'stale'));