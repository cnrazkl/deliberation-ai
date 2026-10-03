DROP INDEX "council_templates_owner_name_uq";--> statement-breakpoint
ALTER TABLE "council_templates" ADD COLUMN "creation_request_id" uuid;--> statement-breakpoint
ALTER TABLE "council_templates" ADD COLUMN "creation_request_hash" text;--> statement-breakpoint
ALTER TABLE "council_templates" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "council_templates" ADD COLUMN "deletion_receipt_ciphertext" text;--> statement-breakpoint
CREATE UNIQUE INDEX "council_templates_owner_request_uq" ON "council_templates" USING btree ("owner_id","creation_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "council_templates_owner_name_uq" ON "council_templates" USING btree ("owner_id","name") WHERE "council_templates"."deleted_at" is null;