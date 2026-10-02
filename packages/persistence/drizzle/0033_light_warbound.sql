ALTER TABLE "local_schedules" ADD COLUMN "execution_limits_ciphertext" text;--> statement-breakpoint
ALTER TABLE "provider_operations" ADD COLUMN "reserved_output_tokens" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "execution_limits_ciphertext" text;--> statement-breakpoint
ALTER TABLE "provider_operations" ADD CONSTRAINT "provider_operations_reserved_output_range" CHECK ("provider_operations"."reserved_output_tokens" is null or "provider_operations"."reserved_output_tokens" between 128 and 32768);