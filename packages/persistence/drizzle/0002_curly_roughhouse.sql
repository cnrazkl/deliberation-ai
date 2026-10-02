CREATE TABLE "provider_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"default_model" text NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"member_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"remote_response_id" text,
	"error_code" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"raw_text_ciphertext" text,
	"parsed_output_ciphertext" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "provider_operations_status_valid" CHECK ("provider_operations"."status" in ('prepared', 'submitted', 'succeeded', 'failed', 'outcome_unknown'))
);
--> statement-breakpoint
ALTER TABLE "claim_occurrences" ADD COLUMN "quote_ciphertext" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "statement_ciphertext" text;--> statement-breakpoint
ALTER TABLE "model_runs" ADD COLUMN "raw_text_ciphertext" text;--> statement-breakpoint
ALTER TABLE "model_runs" ADD COLUMN "parsed_output_ciphertext" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "question_ciphertext" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "provider_mode" text DEFAULT 'fake' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "report_ciphertext" text;--> statement-breakpoint
ALTER TABLE "provider_operations" ADD CONSTRAINT "provider_operations_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_connections_owner_provider_uq" ON "provider_connections" USING btree ("owner_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_operations_run_member_uq" ON "provider_operations" USING btree ("run_id","member_id");