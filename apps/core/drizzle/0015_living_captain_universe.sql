CREATE TABLE IF NOT EXISTS "data_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"subject_name" text,
	"subject_role" varchar(24) NOT NULL,
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"mode" varchar(10),
	"source" varchar(6) NOT NULL,
	"requested_by" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"scheduled_for" timestamp with time zone,
	"stopped_by_request" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"summary" jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_requests_tenant_idx" ON "data_requests" ("tenant_id","status");--> statement-breakpoint
-- One open request per person (drizzle-kit does not write the WHERE clause of a partial index, so it is here by hand).
CREATE UNIQUE INDEX IF NOT EXISTS "data_requests_open_idx" ON "data_requests" ("user_id") WHERE "status" in ('pending', 'scheduled');--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
