CREATE TABLE "local_login_attempts" (
	"identity_hash" text PRIMARY KEY NOT NULL,
	"attempts" integer NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "local_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"scope_user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "local_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "local_users_role_valid" CHECK ("local_users"."role" in ('root','user')),
	CONSTRAINT "local_users_root_owner_valid" CHECK (("local_users"."role" = 'root' and "local_users"."owner_id" = 'local-owner' and "local_users"."username" = 'root') or ("local_users"."role" = 'user' and "local_users"."owner_id" <> 'local-owner' and "local_users"."username" <> 'root'))
);
--> statement-breakpoint
ALTER TABLE "local_sessions" ADD CONSTRAINT "local_sessions_user_id_local_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."local_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_sessions" ADD CONSTRAINT "local_sessions_scope_user_id_local_users_id_fk" FOREIGN KEY ("scope_user_id") REFERENCES "public"."local_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "local_sessions_user_idx" ON "local_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "local_sessions_expiry_idx" ON "local_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "local_users_username_uq" ON "local_users" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "local_users_owner_uq" ON "local_users" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "local_users_single_root_uq" ON "local_users" USING btree ("role") WHERE "local_users"."role" = 'root';