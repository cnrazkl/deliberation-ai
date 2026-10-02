CREATE TABLE "decision_assessments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"report_claim_id" text NOT NULL,
	"source_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"mode" text DEFAULT 'shadow' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"rubric_version" text NOT NULL,
	"requested_model" text NOT NULL,
	"returned_model" text,
	"run_state_version" integer NOT NULL,
	"request_fingerprint" text NOT NULL,
	"input_ciphertext" text NOT NULL,
	"result_ciphertext" text,
	"error_code" text,
	"queue_job_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "decision_assessments_mode_valid" CHECK ("decision_assessments"."mode" in ('shadow', 'advisory')),
	CONSTRAINT "decision_assessments_status_valid" CHECK ("decision_assessments"."status" in ('queued', 'running', 'completed', 'failed', 'outcome_unknown', 'cancelled')),
	CONSTRAINT "decision_assessments_run_version_positive" CHECK ("decision_assessments"."run_state_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "decision_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"provider" text DEFAULT 'typesafe' NOT NULL,
	"label" text NOT NULL,
	"default_model" text DEFAULT 'jev-1.13.0' NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_connections_provider_valid" CHECK ("decision_connections"."provider" = 'typesafe')
);
--> statement-breakpoint
CREATE TABLE "decision_operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"assessment_id" uuid NOT NULL,
	"batch_id" text DEFAULT 'single' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"error_code" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"result_ciphertext" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "decision_operations_attempt_positive" CHECK ("decision_operations"."attempt" > 0),
	CONSTRAINT "decision_operations_status_valid" CHECK ("decision_operations"."status" in ('prepared', 'submitted', 'succeeded', 'failed', 'outcome_unknown', 'discarded', 'retry_authorized'))
);
--> statement-breakpoint
ALTER TABLE "decision_assessments" ADD CONSTRAINT "decision_assessments_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_assessments" ADD CONSTRAINT "decision_assessments_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_assessments" ADD CONSTRAINT "decision_assessments_source_id_evidence_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."evidence_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_assessments" ADD CONSTRAINT "decision_assessments_connection_id_decision_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."decision_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_operations" ADD CONSTRAINT "decision_operations_assessment_id_decision_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."decision_assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decision_assessments_run_claim_idx" ON "decision_assessments" USING btree ("run_id","report_claim_id");--> statement-breakpoint
CREATE INDEX "decision_assessments_owner_created_idx" ON "decision_assessments" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_connections_owner_label_uq" ON "decision_connections" USING btree ("owner_id","label");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_operations_assessment_batch_attempt_uq" ON "decision_operations" USING btree ("assessment_id","batch_id","attempt");