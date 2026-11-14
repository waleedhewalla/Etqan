DO $$ BEGIN
 CREATE TYPE "live_session_status" AS ENUM('live', 'ended');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "live_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"teacher_id" uuid,
	"title" text NOT NULL,
	"start_ref" varchar(12),
	"end_ref" varchar(12),
	"status" "live_session_status" DEFAULT 'live' NOT NULL,
	"room_name" varchar(64) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "live_sessions_room_name_unique" UNIQUE("room_name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hand_raised_at" timestamp with time zone,
	"can_speak" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"text" text NOT NULL,
	"asked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "live_sessions_section_idx" ON "live_sessions" ("section_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "session_participants_session_user_idx" ON "session_participants" ("session_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_questions_session_idx" ON "session_questions" ("session_id","asked_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_session_id_live_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "live_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session_questions" ADD CONSTRAINT "session_questions_session_id_live_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "live_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session_questions" ADD CONSTRAINT "session_questions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
