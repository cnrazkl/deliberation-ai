ALTER TABLE "local_schedules" ADD COLUMN "creation_request_id" uuid;--> statement-breakpoint
ALTER TABLE "local_schedules" ADD COLUMN "creation_request_hash" text;--> statement-breakpoint
ALTER TABLE "local_schedules" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "local_schedules" ADD COLUMN "deletion_receipt_ciphertext" text;--> statement-breakpoint
CREATE UNIQUE INDEX "local_schedules_owner_request_uq" ON "local_schedules" USING btree ("owner_id","creation_request_id");--> statement-breakpoint
ALTER TABLE "local_schedules" ADD CONSTRAINT "local_schedules_deletion_valid" CHECK (("local_schedules"."deleted_at" is null and "local_schedules"."deletion_receipt_ciphertext" is null) or ("local_schedules"."deleted_at" is not null and "local_schedules"."deletion_receipt_ciphertext" is not null and "local_schedules"."status" = 'paused'));