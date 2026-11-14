/**
 * The product's modules, and how an institution configures them. Every module can be switched off for an
 * institution (except the core ones), and some have settings whose defaults are the deployment's own values, so
 * an institution that configures nothing behaves exactly as before.
 *
 * What an institution chose is kept in its `settings.modules`: `{ [module]: { enabled?, config? } }`.
 * A module that depends on another is off whenever that one is off, whatever was chosen for it.
 * `ai_checking` is the exception: it keeps its own flag, `settings.aiChecking`, which the plan and the
 * deployment's speech provider also gate.
 */
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { tenants } from '../db/schema';
import { config } from '../config';
import { ItqanError } from './errors';
import { MAX_ATTEMPTS } from './tasmi-status';

export const MODULE_KEYS = [
  'review', 'mushaf', 'recitation', 'ai_checking', 'lessons', 'live', 'mutashabihat', 'attendance',
  'monthly_record', 'badges', 'guardians', 'notifications', 'program',
] as const;
export type ModuleKey = typeof MODULE_KEYS[number];
export type SettingValue = number | boolean;

export interface SettingDef {
  key: string;
  labelAr: string;
  helpAr?: string;
  kind: 'int' | 'bool';
  min?: number;
  max?: number;
  unitAr?: string;
  /** The value when the institution has not set one: the deployment's own. */
  fallback: () => SettingValue;
}

export interface ModuleDef {
  key: ModuleKey;
  labelAr: string;
  descriptionAr: string;
  /** Always on: the product does not work without it. Its settings can still be changed. */
  core?: true;
  /** Off whenever any of these is off. Listed earlier in MODULE_KEYS than this module. */
  dependsOn?: ModuleKey[];
  settings: SettingDef[];
  /** API paths (without the /v1 prefix) that belong to the module and are refused while it is off. */
  routes: RegExp[];
}

/** The same numbers as `hifz-plan` and `assessment`, which cannot be imported here without a cycle; a test keeps them equal. */
export const DEFAULT_NEW_PER_DAY = 10;
export const DEFAULT_MAX_AYAT_PER_RECORDING = 60;

export const MODULES: ModuleDef[] = [
  {
    key: 'review', core: true, labelAr: 'المراجعة اليومية والحفظ الجديد',
    descriptionAr: 'ورد الطالبة اليومي: مراجعة ما حفظته بجدولة ذكية، وآيات جديدة كل يوم. هذه الوحدة أساس المنصة ولا تُعطَّل.',
    settings: [{
      key: 'newPerDay', labelAr: 'الآيات الجديدة في اليوم', kind: 'int', min: 1, max: 50, unitAr: 'آية',
      helpAr: 'يُطبَّق على كل طالبة لم تضبط معلمتها وتيرة خاصة لها.', fallback: () => DEFAULT_NEW_PER_DAY,
    }],
    routes: [],
  },
  {
    key: 'mushaf', labelAr: 'المصحف', descriptionAr: 'قراءة المصحف من تبويب «المصحف والحفظ». آيات الورد تبقى ظاهرة في بقية الوحدات.',
    settings: [], routes: [],
  },
  {
    key: 'recitation', labelAr: 'التسميع والتقييم',
    descriptionAr: 'تسجّل الطالبة تلاوتها وتراجعها المعلمة: درجات، وردّ نصي أو صوتي، وإعادة التسميع عند الحاجة.',
    settings: [
      { key: 'maxAttempts', labelAr: 'مرات إعادة التسميع', kind: 'int', min: 1, max: 5, unitAr: 'مرة', helpAr: 'عدد المحاولات المسموحة للآيات نفسها، والحكم على الأخيرة نهائي.', fallback: () => MAX_ATTEMPTS },
      { key: 'maxAyatPerRecording', labelAr: 'أطول تسميع في تسجيل واحد', kind: 'int', min: 5, max: 150, unitAr: 'آية', helpAr: 'وهو أيضاً أطول مقطع في «آيات للحفظ».', fallback: () => DEFAULT_MAX_AYAT_PER_RECORDING },
      { key: 'audioRetentionHours', labelAr: 'حذف التسجيل بعد مراجعته بـ', kind: 'int', min: 1, max: 720, unitAr: 'ساعة', helpAr: 'تبقى الدرجة وملاحظات المعلمة، ويُحذف الصوت فقط.', fallback: () => Math.max(1, Math.round(config.AUDIO_RETENTION_HOURS)) },
      { key: 'unreviewedMaxDays', labelAr: 'حذف التسجيل الذي لم يُراجَع بعد', kind: 'int', min: 1, max: 365, unitAr: 'يوم', helpAr: 'وهي مدة بقاء ردّ المعلمة الصوتي أيضاً.', fallback: () => Math.max(1, Math.round(config.AUDIO_UNREVIEWED_MAX_DAYS)) },
    ],
    routes: [/^\/tasmi(\/|$)/],
  },
  {
    key: 'ai_checking', labelAr: 'الفحص الآلي للتسميع',
    descriptionAr: 'فحص أوّلي للتلاوة يضع علامات على الكلمات لمعلمتكِ فقط. لا يُحتسب درجة. يحتاج ترخيصاً يشمله، وخدمة تفريغ صوتي على الخادم، وموافقة الطالبة.',
    settings: [], routes: [],
  },
  {
    key: 'lessons', dependsOn: ['recitation'], labelAr: 'آيات للحفظ',
    descriptionAr: 'تسجّل المعلمة تلاوة آيات لتستمع إليها طالبات الحلقة ثم يسمّعنها. تحتاج وحدة التسميع.',
    settings: [], routes: [/^\/sections\/[^/]+\/lessons/, /^\/lessons(\/|$)/],
  },
  {
    key: 'live', labelAr: 'الدروس المباشرة',
    descriptionAr: 'درس صوتي ومرئي مباشر لحلقتكِ: شاشة المصحف، وأسئلة مكتوبة، ورفع اليد. يحتاج خادم صوت وصورة على الخادم.',
    settings: [
      { key: 'recordingAllowed', labelAr: 'السماح بتسجيل الدرس', kind: 'bool', helpAr: 'تسجَّل أصوات المعلمة وشاشتها فقط، لا الطالبات. تشاهد الحلقة التسجيل لاحقاً.', fallback: () => true },
      { key: 'recordingMaxMb', labelAr: 'أكبر حجم لتسجيل درس', kind: 'int', min: 50, max: 2000, unitAr: 'ميغابايت', helpAr: 'نحو ٢٠٠ ميغابايت لكل ساعة.', fallback: () => config.LIVE_RECORDING_MAX_MB },
      { key: 'recordingRetentionDays', labelAr: 'حذف تسجيل الدرس بعد', kind: 'int', min: 7, max: 365, unitAr: 'يوم', fallback: () => config.LIVE_RECORDING_RETENTION_DAYS },
    ],
    routes: [/^\/sections\/[^/]+\/live/, /^\/live(\/|$)/],
  },
  {
    key: 'mutashabihat', labelAr: 'المتشابهات',
    descriptionAr: 'تدريب على الآيات المتشابهة، ويمكن للمعلمة والعميدة إضافة مجموعات.', settings: [], routes: [/^\/mutashabihat(\/|$)/],
  },
  {
    key: 'attendance', labelAr: 'الحضور', descriptionAr: 'تسجيل حضور الطالبات، وتنبيه أولياء أمور الغائبات.',
    settings: [], routes: [/^\/sections\/[^/]+\/attendance/, /^\/reports\/attendance(\/|$)/],
  },
  {
    key: 'monthly_record', dependsOn: ['recitation'], labelAr: 'السجل الشهري',
    descriptionAr: 'ملخص الشهر لكل طالبة: ما تعثرت فيه، والتقدير الإجمالي والدرجة، وتقدير المعلمة. يعتمد على التسميع.',
    settings: [], routes: [/^\/reports\/student\/[^/]+\/monthly/],
  },
  {
    key: 'badges', labelAr: 'الأوسمة والسلاسل', descriptionAr: 'أوسمة التقدّم وسلسلة الأيام المتتابعة.', settings: [], routes: [/^\/badges(\/|$)/],
  },
  {
    key: 'guardians', labelAr: 'بوابة أولياء الأمور',
    descriptionAr: 'يتابع ولي الأمر تقدّم ابنته، وتربط المعلمة أولياء الأمور بطالباتها.',
    settings: [], routes: [/^\/guardian(\/|$)/, /^\/sections\/[^/]+\/students\/[^/]+\/guardians/],
  },
  {
    key: 'notifications', labelAr: 'الإشعارات', descriptionAr: 'إشعارات داخل المنصة للطالبات والمعلمات.', settings: [], routes: [/^\/notifications(\/|$)/],
  },
  {
    key: 'program', labelAr: 'برنامج الحفظ', descriptionAr: 'برنامج الفترات والمقرّر لكل فترة، يظهر لكل حلقة تتبعه.',
    settings: [], routes: [/^\/admin\/programs(\/|$)/, /^\/admin\/halaqat\/[^/]+\/program/, /^\/sections\/[^/]+\/program/],
  },
];

export const moduleDef = (key: string) => MODULES.find((m) => m.key === key);

export interface ModuleState {
  /** On in effect: chosen, and everything it depends on is on. */
  enabled: boolean;
  /** What the institution chose. */
  requested: boolean;
  /** The module that holds this one off, if one does. */
  blockedBy: ModuleKey | null;
  config: Record<string, SettingValue>;
}

type Stored = { modules?: Record<string, { enabled?: boolean; config?: Record<string, unknown> }>; aiChecking?: boolean };

function validValue(def: SettingDef, value: unknown): value is SettingValue {
  if (def.kind === 'bool') return typeof value === 'boolean';
  return typeof value === 'number' && Number.isInteger(value) && value >= (def.min ?? -Infinity) && value <= (def.max ?? Infinity);
}

/** Every module's state for an institution with these settings. A stored value that is no longer valid is ignored. */
export function resolveModules(settings: Record<string, unknown> | null | undefined): Record<ModuleKey, ModuleState> {
  const stored = (settings ?? {}) as Stored;
  const out = {} as Record<ModuleKey, ModuleState>;
  for (const def of MODULES) {
    const mine = stored.modules?.[def.key];
    const requested = def.core ? true : def.key === 'ai_checking' ? stored.aiChecking === true : mine?.enabled !== false;
    const blockedBy = def.dependsOn?.find((d) => !out[d].enabled) ?? null;
    const configValues: Record<string, SettingValue> = {};
    for (const s of def.settings) configValues[s.key] = validValue(s, mine?.config?.[s.key]) ? (mine!.config![s.key] as SettingValue) : s.fallback();
    out[def.key] = { enabled: requested && !blockedBy, requested, blockedBy, config: configValues };
  }
  return out;
}

/** Checks a change to a module's settings: only its own settings, each of the right kind and within range. */
export function checkConfig(def: ModuleDef, input: Record<string, unknown>): { ok: true; config: Record<string, SettingValue> } | { ok: false; error: string } {
  const config: Record<string, SettingValue> = {};
  for (const [key, value] of Object.entries(input)) {
    const setting = def.settings.find((s) => s.key === key);
    if (!setting) return { ok: false, error: `Unknown setting: ${key}` };
    if (!validValue(setting, value)) return { ok: false, error: `Invalid value for ${key}` };
    config[key] = value;
  }
  return { ok: true, config };
}

// ---- Reading an institution's modules ----

const KEPT_FOR_MS = config.NODE_ENV === 'test' ? 0 : 5000;
const kept = new Map<string, { settings: Record<string, unknown>; at: number }>();

async function settingsOf(tenantId: string): Promise<Record<string, unknown>> {
  const hit = kept.get(tenantId);
  if (hit && Date.now() - hit.at < KEPT_FOR_MS) return hit.settings;
  const [row] = await getDb().select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const settings = row?.settings ?? {};
  kept.set(tenantId, { settings, at: Date.now() });
  return settings;
}

export const forgetModules = (tenantId: string) => { kept.delete(tenantId); };
export const tenantModules = async (tenantId: string) => resolveModules(await settingsOf(tenantId));
export const moduleOn = async (tenantId: string, key: ModuleKey) => (await tenantModules(tenantId))[key].enabled;

/** A module's settings for an institution, each with the institution's value or the default. */
export async function moduleConfig<K extends ModuleKey>(tenantId: string, key: K) {
  return (await tenantModules(tenantId))[key].config;
}

/** The module a route belongs to, from its path (with or without the /v1 prefix), or null. */
export function moduleForPath(path: string): ModuleKey | null {
  const p = path.replace(/^\/v1/, '').split('?')[0];
  return MODULES.find((m) => m.routes.some((r) => r.test(p)))?.key ?? null;
}

export class ModuleDisabledError extends ItqanError {
  constructor(module: ModuleKey) {
    super('This module is turned off for your institution', 'MODULE_DISABLED', 403, { module });
  }
}

/** preHandler for a route of a module. Requests with no signed-in user (links that carry their own token) pass. */
export function requireModule(key: ModuleKey) {
  return async (request: { user?: { facultyId?: string } }) => {
    const tenantId = request.user?.facultyId;
    if (tenantId && !(await moduleOn(tenantId, key))) throw new ModuleDisabledError(key);
  };
}
