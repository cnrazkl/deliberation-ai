ALTER TABLE "runs" ADD COLUMN "scenario" text DEFAULT 'success' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "queue_job_id" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "report" jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "finished_at" timestamp with time zone;