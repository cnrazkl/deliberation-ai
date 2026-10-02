ALTER TABLE "runs" ADD COLUMN "prompt_version" text DEFAULT 'council-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "prompt_fingerprint" text;