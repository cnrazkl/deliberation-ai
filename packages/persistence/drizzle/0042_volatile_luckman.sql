ALTER TABLE "runs" ADD COLUMN "branch_source_run_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "branch_kind" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "branch_index_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "runs_owner_branch_source_created_id_idx" ON "runs" USING btree ("owner_id","branch_source_run_id","created_at","id");--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_branch_index_valid" CHECK (("runs"."branch_index_version" = 0 and "runs"."branch_kind" is null and "runs"."branch_source_run_id" is null) or
      ("runs"."branch_index_version" = 1 and "runs"."branch_kind" is not null and (
        ("runs"."branch_kind" = 'independent' and "runs"."branch_source_run_id" is null) or
        ("runs"."branch_kind" in ('continuation-full', 'continuation-compacted', 'member-rerun') and "runs"."branch_source_run_id" is not null and "runs"."branch_source_run_id" <> "runs"."id"))));