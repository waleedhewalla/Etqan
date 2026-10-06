/**
 * Multi-tenancy: institution management and tenant isolation
 */

export type TenantPlanTier = 'free' | 'madrasa_basic' | 'madrasa_pro' | 'enterprise';

export interface Tenant {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  domain: string | null;
  logoUrl: string | null;
  active: boolean;
  plan: TenantPlan;
  createdAt: Date;
  settings: TenantSettings;
}

export interface TenantPlan {
  tier: TenantPlanTier;
  maxStudents: number;
  maxHalaqat: number;
  maxStorage: number;
  features: TenantFeature[];
  validUntil: Date | null;
}

export type TenantFeature =
  | 'asr_voice_check'
  | 'guardian_portal'
  | 'mutashabihat_drills'
  | 'advanced_reports'
  | 'api_access'
  | 'custom_branding'
  | 'ijazah_certificates';

export interface TenantSettings {
  gatekeeperThreshold: number;
  defaultRiwayah: string;
  hijriCalendar: boolean;
  locale: 'ar' | 'en';
  timezone: string;
}

export interface TenantStats {
  tenantId: string;
  totalStudents: number;
  activeHalaqat: number;
  totalSessions: number;
  avgMastery: number;
  seatUsage: number;
  maxSeats: number;
}
