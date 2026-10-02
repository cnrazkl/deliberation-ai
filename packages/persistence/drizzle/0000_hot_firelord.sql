CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'completed', 'partially_completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "claim_occurrences" (
	"claim_id" uuid NOT NULL,
	"model_run_id" uuid NOT NULL,
	"quote" text NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "claim_occurrences_claim_id_model_run_id_quote_pk" PRIMARY KEY("claim_id","model_run_id","quote")
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"statement" text NOT NULL,
	"disposition" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"member_id" text NOT NULL,
	"member_label" text NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"raw_text" text,
	"parsed_output" jsonb,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_runs_round_range" CHECK ("model_runs"."round" between 0 and 3)
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_events_run_id_sequence_pk" PRIMARY KEY("run_id","sequence"),
	CONSTRAINT "run_events_sequence_positive" CHECK ("run_events"."sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"question" text NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"state_version" integer DEFAULT 1 NOT NULL,
	"last_sequence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runs_state_version_positive" CHECK ("runs"."state_version" > 0),
	CONSTRAINT "runs_last_sequence_nonnegative" CHECK ("runs"."last_sequence" >= 0)
);
--> statement-breakpoint
ALTER TABLE "claim_occurrences" ADD CONSTRAINT "claim_occurrences_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_occurrences" ADD CONSTRAINT "claim_occurrences_model_run_id_model_runs_id_fk" FOREIGN KEY ("model_run_id") REFERENCES "public"."model_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_runs" ADD CONSTRAINT "model_runs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claims_run_idx" ON "claims" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "model_runs_run_member_round_uq" ON "model_runs" USING btree ("run_id","member_id","round");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_owner_idempotency_key_uq" ON "runs" USING btree ("owner_id","idempotency_key");