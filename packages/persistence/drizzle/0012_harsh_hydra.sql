ALTER TABLE "evidence_sources" ADD COLUMN "excerpt_ciphertext" text;--> statement-breakpoint
ALTER TABLE "evidence_sources" ADD COLUMN "published_at" date;--> statement-breakpoint
ALTER TABLE "evidence_sources" ADD COLUMN "captured_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "evidence_sources" SET "captured_at" = "created_at";--> statement-breakpoint
ALTER TABLE "evidence_sources" ADD COLUMN "freshness_status" text DEFAULT 'unreviewed' NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence_sources" ADD COLUMN "freshness_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "evidence_sources" ADD CONSTRAINT "evidence_sources_freshness_status_valid" CHECK ("evidence_sources"."freshness_status" in ('unreviewed', 'current', 'needs-review', 'stale'));--> statement-breakpoint
CREATE FUNCTION prevent_evidence_source_snapshot_mutation() RETURNS trigger AS $$
BEGIN
  IF NEW.excerpt_ciphertext IS DISTINCT FROM OLD.excerpt_ciphertext
    OR NEW.captured_at IS DISTINCT FROM OLD.captured_at
    OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
    RAISE EXCEPTION 'Evidence source snapshot fields are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER evidence_source_snapshot_immutable
BEFORE UPDATE ON "evidence_sources"
FOR EACH ROW EXECUTE FUNCTION prevent_evidence_source_snapshot_mutation();
