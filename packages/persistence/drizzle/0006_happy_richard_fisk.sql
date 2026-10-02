DROP INDEX "provider_operations_run_member_attempt_uq";--> statement-breakpoint
ALTER TABLE "provider_operations" ADD COLUMN "round" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "review_rounds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_operations_run_member_round_attempt_uq" ON "provider_operations" USING btree ("run_id","member_id","round","attempt");--> statement-breakpoint
ALTER TABLE "provider_operations" ADD CONSTRAINT "provider_operations_round_range" CHECK ("provider_operations"."round" between 0 and 1);