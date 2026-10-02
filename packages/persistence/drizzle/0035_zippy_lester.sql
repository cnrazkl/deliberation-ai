CREATE TABLE "provider_billing_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"source_line_fingerprint" text NOT NULL,
	"fingerprint" text NOT NULL,
	"payload_ciphertext" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "provider_billing_records_owner_operation_uq" ON "provider_billing_records" USING btree ("owner_id","operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_billing_records_owner_source_line_uq" ON "provider_billing_records" USING btree ("owner_id","source_line_fingerprint");--> statement-breakpoint
CREATE INDEX "provider_billing_records_owner_run_idx" ON "provider_billing_records" USING btree ("owner_id","run_id");