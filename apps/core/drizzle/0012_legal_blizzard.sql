CREATE TABLE IF NOT EXISTS "hifz_program_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"name_ar" text NOT NULL,
	"goal_ar" text,
	"start_ref" varchar(12),
	"end_ref" varchar(12),
	"pages_per_day" real DEFAULT 0.75 NOT NULL,
	"extra_pct" integer DEFAULT 0 NOT NULL,
	"fixed_weeks" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hifz_programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name_ar" text NOT NULL,
	"hifz_days_per_week" integer DEFAULT 4 NOT NULL,
	"weight_hifz" integer DEFAULT 40 NOT NULL,
	"weight_tajweed" integer DEFAULT 25 NOT NULL,
	"weight_review" integer DEFAULT 20 NOT NULL,
	"weight_retention" integer DEFAULT 15 NOT NULL,
	"pass_score" integer DEFAULT 85 NOT NULL,
	"min_criterion_pct" integer DEFAULT 70 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sections" ADD COLUMN "hifz_program_id" uuid;--> statement-breakpoint
ALTER TABLE "sections" ADD COLUMN "hifz_program_start" date;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hifz_program_periods_program_idx" ON "hifz_program_periods" ("program_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hifz_programs_tenant_idx" ON "hifz_programs" ("tenant_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sections" ADD CONSTRAINT "sections_hifz_program_id_hifz_programs_id_fk" FOREIGN KEY ("hifz_program_id") REFERENCES "hifz_programs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hifz_program_periods" ADD CONSTRAINT "hifz_program_periods_program_id_hifz_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "hifz_programs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hifz_programs" ADD CONSTRAINT "hifz_programs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hifz_programs" ADD CONSTRAINT "hifz_programs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
