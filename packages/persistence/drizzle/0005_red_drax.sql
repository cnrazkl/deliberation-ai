ALTER TABLE "provider_connections" ADD COLUMN "base_url" text;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD COLUMN "endpoint_preset" text DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD COLUMN "reasoning_protocol" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD COLUMN "structured_output_mode" text DEFAULT 'json-object' NOT NULL;