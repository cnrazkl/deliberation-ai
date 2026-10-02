ALTER TABLE "local_schedules" ADD COLUMN "risk_profile" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "risk_profile" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "local_schedules" ADD CONSTRAINT "local_schedules_risk_profile_valid" CHECK ("local_schedules"."risk_profile" in ('standard', 'high'));--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_risk_profile_valid" CHECK ("runs"."risk_profile" in ('standard', 'high'));