CREATE TABLE "conversation_knowledge" (
	"conversation_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"revision" uuid NOT NULL,
	"selection_ciphertext" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_knowledge_selections" (
	"conversation_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"collection_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"grant_revision" integer NOT NULL,
	CONSTRAINT "conversation_knowledge_selections_conversation_id_collection_id_pk" PRIMARY KEY("conversation_id","collection_id"),
	CONSTRAINT "conversation_knowledge_selections_revision_positive" CHECK ("conversation_knowledge_selections"."grant_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "knowledge_collections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"account_id" text NOT NULL,
	"body_ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"collection_id" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_grants_revision_positive" CHECK ("knowledge_grants"."revision" > 0),
	CONSTRAINT "knowledge_grants_status_valid" CHECK ("knowledge_grants"."status" in ('active', 'revoked'))
);
--> statement-breakpoint
ALTER TABLE "conversation_knowledge" ADD CONSTRAINT "conversation_knowledge_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_knowledge_selections" ADD CONSTRAINT "conversation_knowledge_selections_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_knowledge_selections" ADD CONSTRAINT "conversation_knowledge_selections_collection_id_knowledge_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."knowledge_collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_knowledge_selections" ADD CONSTRAINT "conversation_knowledge_selections_grant_id_knowledge_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."knowledge_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_grants" ADD CONSTRAINT "knowledge_grants_collection_id_knowledge_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."knowledge_collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_knowledge_owner_idx" ON "conversation_knowledge" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "knowledge_collections_owner_idx" ON "knowledge_collections" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_grants_collection_uq" ON "knowledge_grants" USING btree ("collection_id");