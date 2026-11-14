ALTER TABLE "tasmi_submissions" ADD COLUMN "revision_of" uuid;--> statement-breakpoint
ALTER TABLE "tasmi_submissions" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasmi_submissions" ADD COLUMN "review_started_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tasmi_revision_of_idx" ON "tasmi_submissions" ("revision_of");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tasmi_submissions" ADD CONSTRAINT "tasmi_submissions_revision_of_tasmi_submissions_id_fk" FOREIGN KEY ("revision_of") REFERENCES "tasmi_submissions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
