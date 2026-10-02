CREATE OR REPLACE FUNCTION prevent_research_capture_snapshot_update()
RETURNS trigger AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.run_id IS DISTINCT FROM OLD.run_id
    OR NEW.claim_id IS DISTINCT FROM OLD.claim_id
    OR NEW.report_claim_id IS DISTINCT FROM OLD.report_claim_id
    OR NEW.requested_url_ciphertext IS DISTINCT FROM OLD.requested_url_ciphertext
    OR NEW.final_url_ciphertext IS DISTINCT FROM OLD.final_url_ciphertext
    OR NEW.title_ciphertext IS DISTINCT FROM OLD.title_ciphertext
    OR NEW.content_ciphertext IS DISTINCT FROM OLD.content_ciphertext
    OR NEW.content_type IS DISTINCT FROM OLD.content_type
    OR NEW.byte_length IS DISTINCT FROM OLD.byte_length
    OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
    OR NEW.redirect_count IS DISTINCT FROM OLD.redirect_count
    OR NEW.captured_at IS DISTINCT FROM OLD.captured_at
  THEN
    RAISE EXCEPTION 'research capture snapshot fields are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER research_capture_snapshot_immutable
BEFORE UPDATE ON "research_captures"
FOR EACH ROW EXECUTE FUNCTION prevent_research_capture_snapshot_update();
