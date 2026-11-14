CREATE TABLE IF NOT EXISTS "recitation_lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"teacher_id" uuid,
	"start_ref" varchar(12) NOT NULL,
	"end_ref" varchar(12) NOT NULL,
	"note" text,
	"audio_key" text NOT NULL,
	"audio_content_type" varchar(64) NOT NULL,
	"audio_bytes" integer NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasmi_submissions" ADD COLUMN "lesson_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recitation_lessons_section_idx" ON "recitation_lessons" ("section_id","created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tasmi_submissions" ADD CONSTRAINT "tasmi_submissions_lesson_id_recitation_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "recitation_lessons"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recitation_lessons" ADD CONSTRAINT "recitation_lessons_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recitation_lessons" ADD CONSTRAINT "recitation_lessons_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
