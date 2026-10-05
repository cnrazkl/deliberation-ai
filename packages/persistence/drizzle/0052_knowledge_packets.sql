CREATE TABLE "knowledge_preparations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"packet_ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "knowledge_packet_ciphertext" text;--> statement-breakpoint
CREATE INDEX "knowledge_preparations_owner_conversation_idx" ON "knowledge_preparations" USING btree ("owner_id","conversation_id");
--> statement-breakpoint
CREATE FUNCTION prevent_knowledge_preparation_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Knowledge preparations are immutable'; END;
$$;
--> statement-breakpoint
CREATE TRIGGER knowledge_preparations_immutable BEFORE UPDATE ON knowledge_preparations
FOR EACH ROW EXECUTE FUNCTION prevent_knowledge_preparation_update();
