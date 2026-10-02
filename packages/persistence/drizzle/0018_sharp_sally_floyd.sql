CREATE TABLE "mcp_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"label_ciphertext" text NOT NULL,
	"endpoint_ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_tool_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"arguments_ciphertext" text NOT NULL,
	"content_ciphertext" text NOT NULL,
	"content_sha256" text NOT NULL,
	"is_error" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "tool_context_ciphertext" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "tool_result_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_tool_results" ADD CONSTRAINT "mcp_tool_results_connection_id_mcp_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."mcp_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_connections_owner_created_idx" ON "mcp_connections" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "mcp_tool_results_owner_created_idx" ON "mcp_tool_results" USING btree ("owner_id","created_at");--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_tool_result_count_range" CHECK ("runs"."tool_result_count" between 0 and 3);