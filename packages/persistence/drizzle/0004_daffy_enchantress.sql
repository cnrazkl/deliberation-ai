ALTER TABLE "provider_operations" DROP CONSTRAINT "provider_operations_status_valid";--> statement-breakpoint
DROP INDEX "provider_operations_run_member_uq";--> statement-breakpoint
ALTER TABLE "provider_operations" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_operations_run_member_attempt_uq" ON "provider_operations" USING btree ("run_id","member_id","attempt");--> statement-breakpoint
ALTER TABLE "provider_operations" ADD CONSTRAINT "provider_operations_attempt_positive" CHECK ("provider_operations"."attempt" > 0);--> statement-breakpoint
ALTER TABLE "provider_operations" ADD CONSTRAINT "provider_operations_status_valid" CHECK ("provider_operations"."status" in ('prepared', 'submitted', 'succeeded', 'failed', 'outcome_unknown', 'discarded', 'retry_authorized'));