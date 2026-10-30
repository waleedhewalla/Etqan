ALTER TABLE "tasmi_submissions" ALTER COLUMN "audio_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tasmi_submissions" ADD COLUMN "audio_key" text;--> statement-breakpoint
ALTER TABLE "tasmi_submissions" ADD COLUMN "audio_content_type" varchar(64);--> statement-breakpoint
ALTER TABLE "tasmi_submissions" ADD COLUMN "audio_bytes" integer;--> statement-breakpoint
ALTER TABLE "tasmi_submissions" ADD COLUMN "audio_deleted_at" timestamp with time zone;