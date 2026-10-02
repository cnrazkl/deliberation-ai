ALTER TABLE "provider_connections" ADD COLUMN "catalog_snapshot_ciphertext" text;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;