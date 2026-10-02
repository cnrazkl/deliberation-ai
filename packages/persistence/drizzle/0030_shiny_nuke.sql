ALTER TABLE "local_schedules" DROP CONSTRAINT "local_schedules_review_rounds_valid";--> statement-breakpoint
ALTER TABLE "provider_operations" DROP CONSTRAINT "provider_operations_round_range";--> statement-breakpoint
ALTER TABLE "local_schedules" ADD CONSTRAINT "local_schedules_review_rounds_valid" CHECK ("local_schedules"."review_rounds" between 0 and 3);--> statement-breakpoint
ALTER TABLE "provider_operations" ADD CONSTRAINT "provider_operations_round_range" CHECK ("provider_operations"."round" between 0 and 3);--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_review_rounds_valid" CHECK ("runs"."review_rounds" between 0 and 3);