CREATE TABLE "evidence_publications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"dedup_hash" text NOT NULL,
	"body_ciphertext" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	CONSTRAINT "evidence_publications_status_valid" CHECK ("evidence_publications"."status" in ('local_saved', 'awaiting_manual_addition', 'manual_acknowledged'))
);
--> statement-breakpoint
CREATE INDEX "evidence_publications_owner_run_idx" ON "evidence_publications" USING btree ("owner_id","run_id");--> statement-breakpoint
CREATE INDEX "evidence_publications_dedup_idx" ON "evidence_publications" USING btree ("owner_id","dedup_hash");
--> statement-breakpoint
CREATE FUNCTION evidence_publication_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW.owner_id, NEW.run_id, NEW.candidate_id, NEW.request_hash, NEW.dedup_hash, NEW.body_ciphertext, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.owner_id, OLD.run_id, OLD.candidate_id, OLD.request_hash, OLD.dedup_hash, OLD.body_ciphertext, OLD.created_at)
    OR NOT (NEW.status = OLD.status AND NEW.acknowledged_at IS NOT DISTINCT FROM OLD.acknowledged_at
      OR OLD.status = 'awaiting_manual_addition' AND NEW.status = 'manual_acknowledged' AND NEW.acknowledged_at IS NOT NULL)
  THEN RAISE EXCEPTION 'Evidence publication snapshot is immutable'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER evidence_publication_snapshot_immutable BEFORE UPDATE ON evidence_publications
FOR EACH ROW EXECUTE FUNCTION evidence_publication_snapshot_immutable();
