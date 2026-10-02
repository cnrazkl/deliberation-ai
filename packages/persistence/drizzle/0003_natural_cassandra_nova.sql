CREATE TABLE "council_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"members_ciphertext" text NOT NULL,
	"member_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "council_templates_member_count_range" CHECK ("council_templates"."member_count" between 2 and 6)
);
--> statement-breakpoint
DROP INDEX "provider_connections_owner_provider_uq";--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "members_ciphertext" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "member_count" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "council_templates_owner_name_uq" ON "council_templates" USING btree ("owner_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_connections_owner_label_uq" ON "provider_connections" USING btree ("owner_id","label");--> statement-breakpoint
CREATE INDEX "provider_connections_owner_provider_idx" ON "provider_connections" USING btree ("owner_id","provider");--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_member_count_range" CHECK ("runs"."member_count" between 2 and 6);