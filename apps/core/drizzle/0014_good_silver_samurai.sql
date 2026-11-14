CREATE TABLE IF NOT EXISTS "hifz_period_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"section_id" uuid,
	"program_id" uuid NOT NULL,
	"period_index" integer NOT NULL,
	"period_name" text NOT NULL,
	"attempt" integer NOT NULL,
	"score_hifz" real NOT NULL,
	"score_tajweed" real NOT NULL,
	"score_review" real,
	"score_retention" real NOT NULL,
	"weights" jsonb NOT NULL,
	"pass_score" integer NOT NULL,
	"min_criterion_pct" integer NOT NULL,
	"total" real NOT NULL,
	"outcome" varchar(8) NOT NULL,
	"failed_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposals" jsonb,
	"note" text,
	"entered_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hifz_period_results_student_idx" ON "hifz_period_results" ("student_id","program_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hifz_period_results_section_idx" ON "hifz_period_results" ("section_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hifz_period_results" ADD CONSTRAINT "hifz_period_results_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hifz_period_results" ADD CONSTRAINT "hifz_period_results_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hifz_period_results" ADD CONSTRAINT "hifz_period_results_program_id_hifz_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "hifz_programs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hifz_period_results" ADD CONSTRAINT "hifz_period_results_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hifz_period_results" ADD CONSTRAINT "hifz_period_results_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
