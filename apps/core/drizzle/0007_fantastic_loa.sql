CREATE TABLE IF NOT EXISTS "student_monthly_appraisals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"month" varchar(7) NOT NULL,
	"note" text NOT NULL,
	"teacher_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasmi_submissions" ADD COLUMN "reply_audio_key" text;--> statement-breakpoint
ALTER TABLE "tasmi_submissions" ADD COLUMN "reply_audio_content_type" varchar(64);--> statement-breakpoint
ALTER TABLE "tasmi_submissions" ADD COLUMN "reply_audio_bytes" integer;--> statement-breakpoint
ALTER TABLE "tasmi_submissions" ADD COLUMN "reply_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "tasmi_submissions" ADD COLUMN "reply_by" uuid;--> statement-breakpoint
ALTER TABLE "tasmi_submissions" ADD COLUMN "reply_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "monthly_appraisal_student_month_idx" ON "student_monthly_appraisals" ("student_id","month");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tasmi_submissions" ADD CONSTRAINT "tasmi_submissions_reply_by_users_id_fk" FOREIGN KEY ("reply_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "student_monthly_appraisals" ADD CONSTRAINT "student_monthly_appraisals_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "student_monthly_appraisals" ADD CONSTRAINT "student_monthly_appraisals_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
