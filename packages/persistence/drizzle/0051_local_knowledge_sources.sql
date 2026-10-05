CREATE TABLE "knowledge_source_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"original_hash" text NOT NULL,
	"parser_version" text NOT NULL,
	"status" text NOT NULL,
	"original_bytes" integer NOT NULL,
	"text_bytes" integer NOT NULL,
	"original_ciphertext" text NOT NULL,
	"extraction_ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_source_versions_original_limit" CHECK ("knowledge_source_versions"."original_bytes" between 1 and 5242880),
	CONSTRAINT "knowledge_source_versions_text_limit" CHECK ("knowledge_source_versions"."text_bytes" between 0 and 256000),
	CONSTRAINT "knowledge_source_versions_status_valid" CHECK ("knowledge_source_versions"."status" in ('complete', 'extraction_unverified', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "knowledge_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"collection_id" uuid NOT NULL,
	"active_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_source_versions" ADD CONSTRAINT "knowledge_source_versions_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_collection_id_knowledge_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."knowledge_collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_source_versions_bytes_parser_idx" ON "knowledge_source_versions" USING btree ("source_id","original_hash","parser_version");--> statement-breakpoint
CREATE INDEX "knowledge_sources_collection_idx" ON "knowledge_sources" USING btree ("owner_id","collection_id");
--> statement-breakpoint
CREATE FUNCTION prevent_knowledge_version_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Knowledge source versions are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER knowledge_source_versions_immutable BEFORE UPDATE ON knowledge_source_versions
FOR EACH ROW EXECUTE FUNCTION prevent_knowledge_version_update();
--> statement-breakpoint
CREATE FUNCTION validate_knowledge_source_relationships() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM knowledge_sources s JOIN knowledge_collections c ON c.id = s.collection_id
    JOIN knowledge_source_versions v ON v.id = s.active_version_id AND v.source_id = s.id
    WHERE s.id = NEW.id AND s.owner_id = c.owner_id AND s.owner_id = v.owner_id AND c.account_id = 'local') THEN
    RAISE EXCEPTION 'Knowledge source relationship is invalid';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER knowledge_source_active_integrity AFTER INSERT OR UPDATE ON knowledge_sources
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_knowledge_source_relationships();
