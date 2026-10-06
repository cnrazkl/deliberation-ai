ALTER TABLE "evidence_sources" DROP CONSTRAINT "evidence_sources_freshness_status_valid";--> statement-breakpoint
ALTER TABLE "evidence_sources" ADD COLUMN "candidate_provenance_ciphertext" text;--> statement-breakpoint
ALTER TABLE "evidence_sources" ADD CONSTRAINT "evidence_sources_freshness_status_valid" CHECK ("evidence_sources"."freshness_status" in ('unreviewed', 'current', 'needs-review', 'stale', 'changed', 'inaccessible'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_evidence_source_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.excerpt_ciphertext IS DISTINCT FROM OLD.excerpt_ciphertext
  OR NEW.captured_at IS DISTINCT FROM OLD.captured_at OR NEW.published_at IS DISTINCT FROM OLD.published_at
  OR NEW.candidate_provenance_ciphertext IS DISTINCT FROM OLD.candidate_provenance_ciphertext
  OR (OLD.candidate_provenance_ciphertext IS NOT NULL AND (
    NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.run_id IS DISTINCT FROM OLD.run_id
    OR NEW.claim_id IS DISTINCT FROM OLD.claim_id OR NEW.report_claim_id IS DISTINCT FROM OLD.report_claim_id
    OR NEW.title_ciphertext IS DISTINCT FROM OLD.title_ciphertext OR NEW.url_ciphertext IS DISTINCT FROM OLD.url_ciphertext
    OR NEW.note_ciphertext IS DISTINCT FROM OLD.note_ciphertext OR NEW.relation IS DISTINCT FROM OLD.relation)) THEN
  RAISE EXCEPTION 'Evidence source snapshot fields are immutable'; END IF; RETURN NEW; END;
$$;
