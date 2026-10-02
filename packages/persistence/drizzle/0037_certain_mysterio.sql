CREATE TABLE "provider_billing_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"record_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"request_fingerprint" text NOT NULL,
	"fingerprint" text NOT NULL,
	"payload_ciphertext" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_billing_changes_sequence_range" CHECK ("provider_billing_changes"."sequence" between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "provider_billing_changes" ADD CONSTRAINT "provider_billing_changes_record_id_provider_billing_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."provider_billing_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_billing_changes_record_sequence_uq" ON "provider_billing_changes" USING btree ("record_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_billing_changes_record_request_uq" ON "provider_billing_changes" USING btree ("record_id","request_fingerprint");