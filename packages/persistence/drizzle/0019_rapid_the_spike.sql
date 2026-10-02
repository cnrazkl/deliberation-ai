CREATE TABLE "local_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name_ciphertext" text NOT NULL,
	"question_ciphertext" text NOT NULL,
	"members_ciphertext" text NOT NULL,
	"provider_mode" text NOT NULL,
	"review_rounds" integer DEFAULT 1 NOT NULL,
	"cadence" text NOT NULL,
	"status" text DEFAULT 'paused' NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "local_schedules_provider_mode_valid" CHECK ("local_schedules"."provider_mode" in ('fake', 'remote')),
	CONSTRAINT "local_schedules_review_rounds_valid" CHECK ("local_schedules"."review_rounds" between 0 and 1),
	CONSTRAINT "local_schedules_cadence_valid" CHECK ("local_schedules"."cadence" in ('daily', 'weekly')),
	CONSTRAINT "local_schedules_status_valid" CHECK ("local_schedules"."status" in ('active', 'paused'))
);
--> statement-breakpoint
ALTER TABLE "local_schedules" ADD CONSTRAINT "local_schedules_last_run_id_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "local_schedules_owner_next_idx" ON "local_schedules" USING btree ("owner_id","status","next_run_at");