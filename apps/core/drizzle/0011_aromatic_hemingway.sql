ALTER TABLE "live_sessions" ADD COLUMN "recording_status" varchar(12);--> statement-breakpoint
ALTER TABLE "live_sessions" ADD COLUMN "recording_chunks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "live_sessions" ADD COLUMN "recording_key" text;--> statement-breakpoint
ALTER TABLE "live_sessions" ADD COLUMN "recording_bytes" integer;--> statement-breakpoint
ALTER TABLE "live_sessions" ADD COLUMN "recording_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "live_sessions" ADD COLUMN "recording_ready_at" timestamp with time zone;