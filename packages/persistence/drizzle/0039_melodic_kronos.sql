CREATE TABLE "provider_billing_claims" (
	"record_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"source_line_fingerprint" text NOT NULL,
	"remote_identity_fingerprint" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_billing_reallocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"source_record_id" uuid NOT NULL,
	"target_record_id" uuid NOT NULL,
	"request_fingerprint" text NOT NULL,
	"fingerprint" text NOT NULL,
	"payload_ciphertext" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "provider_billing_records_owner_operation_uq";--> statement-breakpoint
DROP INDEX "provider_billing_records_owner_source_line_uq";--> statement-breakpoint
DROP INDEX "provider_billing_records_owner_remote_uq";--> statement-breakpoint
ALTER TABLE "provider_billing_claims" ADD CONSTRAINT "provider_billing_claims_record_id_provider_billing_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."provider_billing_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_billing_reallocations" ADD CONSTRAINT "provider_billing_reallocations_source_record_id_provider_billing_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."provider_billing_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_billing_reallocations" ADD CONSTRAINT "provider_billing_reallocations_target_record_id_provider_billing_records_id_fk" FOREIGN KEY ("target_record_id") REFERENCES "public"."provider_billing_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_billing_claims_owner_operation_uq" ON "provider_billing_claims" USING btree ("owner_id","operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_billing_claims_owner_source_uq" ON "provider_billing_claims" USING btree ("owner_id","source_line_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_billing_claims_owner_remote_uq" ON "provider_billing_claims" USING btree ("owner_id","remote_identity_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_billing_reallocations_source_uq" ON "provider_billing_reallocations" USING btree ("source_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_billing_reallocations_target_uq" ON "provider_billing_reallocations" USING btree ("target_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_billing_reallocations_request_uq" ON "provider_billing_reallocations" USING btree ("owner_id","request_fingerprint");--> statement-breakpoint
CREATE INDEX "provider_billing_records_owner_operation_idx" ON "provider_billing_records" USING btree ("owner_id","operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_billing_records_owner_fingerprint_uq" ON "provider_billing_records" USING btree ("owner_id","fingerprint");
--> statement-breakpoint
-- Preserve every existing identity reservation, including withdrawn evidence.
INSERT INTO "provider_billing_claims" ("record_id", "owner_id", "operation_id", "source_line_fingerprint", "remote_identity_fingerprint")
SELECT "id", "owner_id", "operation_id", "source_line_fingerprint", "remote_identity_fingerprint" FROM "provider_billing_records";
