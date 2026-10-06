import {
  pgTable,
  pgEnum,
  text,
  varchar,
  integer,
  boolean,
  real,
  timestamp,
  date,
  jsonb,
  uuid,
  uniqueIndex,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

// ── Enums ──

export const roleEnum = pgEnum('role', [
  'student', 'lecturer', 'muhaffiza', 'advisor', 'dean',
  'sheikh_reviewer', 'committee_member', 'sama_committee_member',
  'operator', 'superadmin', 'mahram', 'alumna',
]);

export const tenantPlanTierEnum = pgEnum('tenant_plan_tier', [
  'free', 'madrasa_basic', 'madrasa_pro', 'enterprise',
]);

export const cardStateEnum = pgEnum('card_state', [
  'new', 'learning', 'review', 'relearning', 'mastered',
]);

export const ratingEnum = pgEnum('rating', [
  'again', 'hard', 'good', 'easy',
]);

export const sessionModeEnum = pgEnum('session_mode', [
  'read', 'first-letter', 'blanks', 'hidden', 'type-it', 'verse-between', 'order-scramble',
]);

export const sessionStatusEnum = pgEnum('session_status', [
  'active', 'paused', 'completed', 'abandoned',
]);

export const sessionItemStatusEnum = pgEnum('session_item_status', [
  'pending', 'in_progress', 'answered', 'skipped',
]);

export const tasmiVerdictEnum = pgEnum('tasmi_verdict', [
  'approved', 'redo', 'flagged',
]);

export const badgeCategoryEnum = pgEnum('badge_category', [
  'streak', 'surah_mastery', 'juz_completion', 'tajweed_excellence',
  'peer_muraja', 'consistency', 'milestone',
]);

export const badgeTierEnum = pgEnum('badge_tier', [
  'bronze', 'silver', 'gold', 'diamond',
]);

export const consentPurposeEnum = pgEnum('consent_purpose', [
  'voice_recording', 'analytics', 'mahram_access', 'whatsapp_notifications',
  'peer_comparison', 'data_export',
]);

export const mutashabihatSourceEnum = pgEnum('mutashabihat_source', [
  'kirmani', 'ansari', 'sakhawi', 'other',
]);

export const mutashabihatDrillTypeEnum = pgEnum('mutashabihat_drill_type', [
  'drag-drop', 'cloze', 'timed-choice', 'split-comparison',
]);

export const approvalStatusEnum = pgEnum('approval_status', [
  'draft', 'pending_review', 'approved', 'rejected',
]);

export const wordErrorTypeEnum = pgEnum('word_error_type', [
  'missing', 'wrong', 'added', 'hesitation',
]);

export const wordErrorSeverityEnum = pgEnum('word_error_severity', [
  'khafiyy', 'jaliyy',
]);

// ── Tenants ──

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: varchar('slug', { length: 63 }).notNull().unique(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  domain: varchar('domain', { length: 255 }),
  logoUrl: text('logo_url'),
  active: boolean('active').default(true).notNull(),
  planTier: tenantPlanTierEnum('plan_tier').default('free').notNull(),
  planMaxStudents: integer('plan_max_students').default(50).notNull(),
  planMaxHalaqat: integer('plan_max_halaqat').default(5).notNull(),
  planMaxStorageMb: integer('plan_max_storage_mb').default(1024).notNull(),
  planFeatures: jsonb('plan_features').$type<string[]>().default([]),
  planValidUntil: timestamp('plan_valid_until', { withTimezone: true }),
  settings: jsonb('settings').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ── Users ──

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  role: roleEnum('role').default('student').notNull(),
  displayNameAr: text('display_name_ar').notNull(),
  displayNameEn: text('display_name_en'),
  email: varchar('email', { length: 320 }),
  whatsappE164: varchar('whatsapp_e164', { length: 20 }),
  nationalIdHash: varchar('national_id_hash', { length: 128 }),
  avatarUrl: text('avatar_url'),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  emailIdx: index('users_email_idx').on(t.email),
  tenantIdx: index('users_tenant_idx').on(t.tenantId),
  whatsappIdx: index('users_whatsapp_idx').on(t.whatsappE164),
}));

export const userRoles = pgTable('user_roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  role: roleEnum('role').notNull(),
  scopeType: varchar('scope_type', { length: 32 }).notNull(),
  scopeId: uuid('scope_id'),
  grantedBy: uuid('granted_by').references(() => users.id),
  grantedAt: timestamp('granted_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userRoleIdx: index('user_roles_user_idx').on(t.userId),
}));

export const consents = pgTable('consents', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  purpose: consentPurposeEnum('purpose').notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }),
  withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
}, (t) => ({
  userPurposeIdx: uniqueIndex('consents_user_purpose_idx').on(t.userId, t.purpose),
}));

export const guardianLinks = pgTable('guardian_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  studentId: uuid('student_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  guardianId: uuid('guardian_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  scope: jsonb('scope').$type<string[]>().default(['view_progress', 'view_badges']),
  otpVerifiedAt: timestamp('otp_verified_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const authSessions = pgTable('auth_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  deviceInfo: text('device_info'),
  ipAddress: varchar('ip_address', { length: 45 }),
  refreshTokenHash: varchar('refresh_token_hash', { length: 128 }),
  revoked: boolean('revoked').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => ({
  userSessionIdx: index('auth_sessions_user_idx').on(t.userId),
}));

// ── Sections (Halaqat) ──

export const sections = pgTable('sections', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  joinCode: varchar('join_code', { length: 12 }).notNull().unique(),
  teacherId: uuid('teacher_id').references(() => users.id),
  maxStudents: integer('max_students').default(25).notNull(),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index('sections_tenant_idx').on(t.tenantId),
  joinCodeIdx: uniqueIndex('sections_join_code_idx').on(t.joinCode),
}));

export const sectionEnrollments = pgTable('section_enrollments', {
  id: uuid('id').defaultRandom().primaryKey(),
  sectionId: uuid('section_id').references(() => sections.id, { onDelete: 'cascade' }).notNull(),
  studentId: uuid('student_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  enrolledAt: timestamp('enrolled_at', { withTimezone: true }).defaultNow().notNull(),
  droppedAt: timestamp('dropped_at', { withTimezone: true }),
}, (t) => ({
  sectionStudentIdx: uniqueIndex('enrollments_section_student_idx').on(t.sectionId, t.studentId),
}));

// ── Syllabus ──

export const syllabi = pgTable('syllabi', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  riwayahId: varchar('riwayah_id', { length: 32 }).default('hafs').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const syllabusPassages = pgTable('syllabus_passages', {
  id: uuid('id').defaultRandom().primaryKey(),
  syllabusId: uuid('syllabus_id').references(() => syllabi.id, { onDelete: 'cascade' }).notNull(),
  nameAr: text('name_ar').notNull(),
  startRef: varchar('start_ref', { length: 12 }).notNull(),
  endRef: varchar('end_ref', { length: 12 }).notNull(),
  sortOrder: integer('sort_order').notNull(),
}, (t) => ({
  syllabusIdx: index('syllabus_passages_syllabus_idx').on(t.syllabusId),
}));

// ── SRS Cards (FSRS) ──

export const studentCards = pgTable('student_cards', {
  id: uuid('id').defaultRandom().primaryKey(),
  studentId: uuid('student_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  ayahRef: varchar('ayah_ref', { length: 12 }).notNull(),
  transitionId: varchar('transition_id', { length: 32 }),
  state: cardStateEnum('state').default('new').notNull(),
  difficulty: real('difficulty').default(5.0).notNull(),
  stability: real('stability').default(0).notNull(),
  retrievability: real('retrievability').default(1.0).notNull(),
  phoneticStability: real('phonetic_stability').default(0).notNull(),
  semanticStability: real('semantic_stability').default(0).notNull(),
  positionalStability: real('positional_stability').default(0).notNull(),
  recognitionStability: real('recognition_stability').default(0).notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }),
  lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
  reps: integer('reps').default(0).notNull(),
  lapses: integer('lapses').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  studentAyahIdx: uniqueIndex('student_cards_student_ayah_idx').on(t.studentId, t.ayahRef),
  dueIdx: index('student_cards_due_idx').on(t.studentId, t.dueAt),
  stateIdx: index('student_cards_state_idx').on(t.studentId, t.state),
}));

export const reviewLogs = pgTable('review_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  cardId: uuid('card_id').references(() => studentCards.id, { onDelete: 'cascade' }).notNull(),
  rating: ratingEnum('rating').notNull(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }).defaultNow().notNull(),
  timeTakenMs: integer('time_taken_ms'),
  wasCorrect: boolean('was_correct').notNull(),
  stateBefore: jsonb('state_before').$type<Record<string, unknown>>(),
  stateAfter: jsonb('state_after').$type<Record<string, unknown>>(),
}, (t) => ({
  cardIdx: index('review_logs_card_idx').on(t.cardId),
  reviewedAtIdx: index('review_logs_reviewed_at_idx').on(t.reviewedAt),
}));

// ── Sessions ──

export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  studentId: uuid('student_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  sectionId: uuid('section_id').references(() => sections.id),
  mode: sessionModeEnum('mode').default('hidden').notNull(),
  status: sessionStatusEnum('status').default('active').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  pausedAt: timestamp('paused_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  totalDurationMs: integer('total_duration_ms').default(0).notNull(),
  totalItems: integer('total_items').default(0).notNull(),
  correctItems: integer('correct_items').default(0).notNull(),
  skippedItems: integer('skipped_items').default(0).notNull(),
}, (t) => ({
  studentIdx: index('sessions_student_idx').on(t.studentId),
  statusIdx: index('sessions_status_idx').on(t.status),
}));

export const sessionItems = pgTable('session_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'cascade' }).notNull(),
  ayahRef: varchar('ayah_ref', { length: 12 }).notNull(),
  transitionId: varchar('transition_id', { length: 32 }),
  mode: sessionModeEnum('mode').notNull(),
  status: sessionItemStatusEnum('status').default('pending').notNull(),
  selfRating: ratingEnum('self_rating'),
  timeTakenMs: integer('time_taken_ms'),
  voiceCheckResult: jsonb('voice_check_result'),
  sortOrder: integer('sort_order').notNull(),
}, (t) => ({
  sessionIdx: index('session_items_session_idx').on(t.sessionId),
}));

// ── Tasmi (Recitation Submissions) ──

export const tasmiSubmissions = pgTable('tasmi_submissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  studentId: uuid('student_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  sectionId: uuid('section_id').references(() => sections.id),
  startRef: varchar('start_ref', { length: 12 }).notNull(),
  endRef: varchar('end_ref', { length: 12 }).notNull(),
  audioUrl: text('audio_url').notNull(),
  durationMs: integer('duration_ms'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
  aiHifzAccuracy: real('ai_hifz_accuracy'),
  aiTajweedAccuracy: real('ai_tajweed_accuracy'),
  aiFluencyScore: real('ai_fluency_score'),
  aiConfidence: real('ai_confidence'),
  aiFlaggedErrors: jsonb('ai_flagged_errors').$type<unknown[]>().default([]),
  aiReadyForApproval: boolean('ai_ready_for_approval'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewHifzScore: real('review_hifz_score'),
  reviewTajweedScore: real('review_tajweed_score'),
  reviewFluencyScore: real('review_fluency_score'),
  reviewWeightedTotal: real('review_weighted_total'),
  reviewVerdict: tasmiVerdictEnum('review_verdict'),
  reviewNotes: text('review_notes'),
}, (t) => ({
  studentIdx: index('tasmi_student_idx').on(t.studentId),
  sectionIdx: index('tasmi_section_idx').on(t.sectionId),
  verdictIdx: index('tasmi_verdict_idx').on(t.reviewVerdict),
}));

// ── Gamification ──

export const badgeDefinitions = pgTable('badge_definitions', {
  id: varchar('id', { length: 64 }).primaryKey(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  descriptionAr: text('description_ar'),
  icon: varchar('icon', { length: 8 }).notNull(),
  category: badgeCategoryEnum('category').notNull(),
  tier: badgeTierEnum('tier').default('bronze').notNull(),
  conditionType: varchar('condition_type', { length: 64 }).notNull(),
  conditionValue: integer('condition_value').notNull(),
  conditionSurahNumber: integer('condition_surah_number'),
  conditionJuzNumber: integer('condition_juz_number'),
});

export const studentBadges = pgTable('student_badges', {
  id: uuid('id').defaultRandom().primaryKey(),
  studentId: uuid('student_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  badgeId: varchar('badge_id', { length: 64 }).references(() => badgeDefinitions.id).notNull(),
  earnedAt: timestamp('earned_at', { withTimezone: true }).defaultNow().notNull(),
  evidence: jsonb('evidence'),
}, (t) => ({
  studentBadgeIdx: uniqueIndex('student_badges_student_badge_idx').on(t.studentId, t.badgeId),
}));

export const streaks = pgTable('streaks', {
  id: uuid('id').defaultRandom().primaryKey(),
  studentId: uuid('student_id').references(() => users.id, { onDelete: 'cascade' }).notNull().unique(),
  currentStreak: integer('current_streak').default(0).notNull(),
  longestStreak: integer('longest_streak').default(0).notNull(),
  freezesRemaining: integer('freezes_remaining').default(2).notNull(),
  lastActiveDate: date('last_active_date'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const streakFreezes = pgTable('streak_freezes', {
  id: uuid('id').defaultRandom().primaryKey(),
  studentId: uuid('student_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  frozenDate: date('frozen_date').notNull(),
  reason: varchar('reason', { length: 64 }).default('auto').notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }).defaultNow().notNull(),
});

// ── Mutashabihat ──

export const mutashabihatClusters = pgTable('mutashabihat_clusters', {
  id: uuid('id').defaultRandom().primaryKey(),
  ayahRefs: jsonb('ayah_refs').$type<string[]>().notNull(),
  source: mutashabihatSourceEnum('source').default('other').notNull(),
  tawjihAr: text('tawjih_ar'),
  approvalStatus: approvalStatusEnum('approval_status').default('draft').notNull(),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const mutashabihatLinks = pgTable('mutashabihat_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  clusterId: uuid('cluster_id').references(() => mutashabihatClusters.id, { onDelete: 'cascade' }).notNull(),
  ayahRefA: varchar('ayah_ref_a', { length: 12 }).notNull(),
  ayahRefB: varchar('ayah_ref_b', { length: 12 }).notNull(),
  wordAlignments: jsonb('word_alignments').$type<unknown[]>().default([]),
  similarityType: varchar('similarity_type', { length: 32 }),
  strength: real('strength').default(0.5).notNull(),
});

export const mutashabihatDrills = pgTable('mutashabihat_drills', {
  id: uuid('id').defaultRandom().primaryKey(),
  studentId: uuid('student_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  clusterId: uuid('cluster_id').references(() => mutashabihatClusters.id).notNull(),
  drillType: mutashabihatDrillTypeEnum('drill_type').notNull(),
  question: text('question').notNull(),
  options: jsonb('options').$type<string[]>().default([]),
  correctAnswer: text('correct_answer'),
  studentAnswer: text('student_answer'),
  wasCorrect: boolean('was_correct'),
  answeredAt: timestamp('answered_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ── Attendance ──

export const attendance = pgTable('attendance', {
  id: uuid('id').defaultRandom().primaryKey(),
  sectionId: uuid('section_id').references(() => sections.id, { onDelete: 'cascade' }).notNull(),
  studentId: uuid('student_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  date: date('date').notNull(),
  present: boolean('present').notNull(),
  notes: text('notes'),
  markedBy: uuid('marked_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  sectionDateIdx: index('attendance_section_date_idx').on(t.sectionId, t.date),
  studentDateIdx: uniqueIndex('attendance_student_date_idx').on(t.sectionId, t.studentId, t.date),
}));

// ── Assignments (Sabaq/Sabqi/Manzil) ──

export const assignmentTypeEnum = pgEnum('assignment_type', [
  'sabaq', 'sabqi', 'manzil',
]);

export const assignments = pgTable('assignments', {
  id: uuid('id').defaultRandom().primaryKey(),
  sectionId: uuid('section_id').references(() => sections.id, { onDelete: 'cascade' }).notNull(),
  studentId: uuid('student_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  assignedBy: uuid('assigned_by').references(() => users.id).notNull(),
  type: assignmentTypeEnum('type').notNull(),
  startRef: varchar('start_ref', { length: 12 }).notNull(),
  endRef: varchar('end_ref', { length: 12 }).notNull(),
  dueDate: date('due_date'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  score: real('score'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  studentIdx: index('assignments_student_idx').on(t.studentId),
  sectionIdx: index('assignments_section_idx').on(t.sectionId),
  dueIdx: index('assignments_due_idx').on(t.dueDate),
}));

// ── Notifications ──

export const notificationChannelEnum = pgEnum('notification_channel', [
  'in_app', 'whatsapp', 'email', 'push',
]);

export const notifications = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  channel: notificationChannelEnum('channel').default('in_app').notNull(),
  titleAr: text('title_ar').notNull(),
  bodyAr: text('body_ar').notNull(),
  data: jsonb('data'),
  readAt: timestamp('read_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userIdx: index('notifications_user_idx').on(t.userId),
  unreadIdx: index('notifications_unread_idx').on(t.userId, t.readAt),
}));

// ── Audit Log ──

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  action: varchar('action', { length: 128 }).notNull(),
  resource: varchar('resource', { length: 128 }).notNull(),
  resourceId: uuid('resource_id'),
  details: jsonb('details'),
  ipAddress: varchar('ip_address', { length: 45 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userIdx: index('audit_logs_user_idx').on(t.userId),
  tenantIdx: index('audit_logs_tenant_idx').on(t.tenantId),
  createdAtIdx: index('audit_logs_created_at_idx').on(t.createdAt),
}));
