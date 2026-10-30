ALTER TABLE "mutashabihat_clusters" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "mutashabihat_clusters" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "mutashabihat_drills" ADD COLUMN "target_ref" varchar(12);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mutashabihat_clusters" ADD CONSTRAINT "mutashabihat_clusters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mutashabihat_clusters" ADD CONSTRAINT "mutashabihat_clusters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
