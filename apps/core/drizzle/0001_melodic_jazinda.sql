CREATE TABLE IF NOT EXISTS "quran_ayat" (
	"ref" varchar(12) PRIMARY KEY NOT NULL,
	"sura" integer NOT NULL,
	"ayah" integer NOT NULL,
	"sura_name_ar" text NOT NULL,
	"text_uthmani" text NOT NULL,
	"text_normalized" text NOT NULL,
	"word_count" integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quran_ayat_sura_ayah_idx" ON "quran_ayat" ("sura","ayah");