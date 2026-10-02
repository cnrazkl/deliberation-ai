CREATE TABLE "billing_statement_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"identity_fingerprint" text NOT NULL,
	"sequence" integer NOT NULL,
	"request_fingerprint" text NOT NULL,
	"fingerprint" text NOT NULL,
	"payload_ciphertext" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_statement_versions_sequence_range" CHECK ("billing_statement_versions"."sequence" between 1 and 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_statement_versions_identity_sequence_uq" ON "billing_statement_versions" USING btree ("owner_id","identity_fingerprint","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_statement_versions_identity_request_uq" ON "billing_statement_versions" USING btree ("owner_id","identity_fingerprint","request_fingerprint");--> statement-breakpoint
CREATE INDEX "billing_statement_versions_owner_recorded_idx" ON "billing_statement_versions" USING btree ("owner_id","recorded_at","id");