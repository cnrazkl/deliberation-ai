ALTER TABLE "runs" ADD COLUMN "attachments_ciphertext" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "attachment_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_attachment_count_range" CHECK ("runs"."attachment_count" between 0 and 3);