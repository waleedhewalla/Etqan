ALTER TABLE "tasmi_submissions" ADD COLUMN "live_session_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasmi_live_session_idx" ON "tasmi_submissions" ("live_session_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tasmi_submissions" ADD CONSTRAINT "tasmi_submissions_live_session_id_live_sessions_id_fk" FOREIGN KEY ("live_session_id") REFERENCES "live_sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
