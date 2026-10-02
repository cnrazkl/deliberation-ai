CREATE TABLE "provider_price_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"connection_revision" integer NOT NULL,
	"model" text NOT NULL,
	"fingerprint" text NOT NULL,
	"payload_ciphertext" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_price_snapshots_revision_positive" CHECK ("provider_price_snapshots"."connection_revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "provider_operations" ADD COLUMN "price_snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "provider_operations" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_operations" ADD COLUMN "cost_estimate_ciphertext" text;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_price_snapshots_owner_fingerprint_uq" ON "provider_price_snapshots" USING btree ("owner_id","fingerprint");--> statement-breakpoint
CREATE INDEX "provider_price_snapshots_lookup_idx" ON "provider_price_snapshots" USING btree ("owner_id","connection_id","connection_revision","model","recorded_at");--> statement-breakpoint
ALTER TABLE "provider_operations" ADD CONSTRAINT "provider_operations_price_snapshot_id_provider_price_snapshots_id_fk" FOREIGN KEY ("price_snapshot_id") REFERENCES "public"."provider_price_snapshots"("id") ON DELETE restrict ON UPDATE no action;