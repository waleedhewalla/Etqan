ALTER TYPE "live_session_status" ADD VALUE 'scheduled';--> statement-breakpoint
ALTER TYPE "live_session_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TABLE "live_sessions" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "live_sessions" ADD COLUMN "reminders_sent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "live_sessions" ADD COLUMN "focus_ref" varchar(12);--> statement-breakpoint
ALTER TABLE "live_sessions" ADD COLUMN "focus_at" timestamp with time zone;