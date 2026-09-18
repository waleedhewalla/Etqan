/**
 * User, roles, and permissions types
 */

export type Role = 
  | 'student' 
  | 'lecturer' 
  | 'muhaffiza' 
  | 'advisor' 
  | 'dean' 
  | 'sheikh_reviewer' 
  | 'committee_member' 
  | 'sama_committee_member'
  | 'operator' 
  | 'superadmin'
  | 'mahram'
  | 'alumna';

export type PermissionCode = 
  // Student permissions
  | 'read.own.profile'
  | 'write.own.profile'
  | 'read.own.submissions'
  | 'write.own.submissions'
  | 'read.own.plans'
  | 'write.own.plans'
  | 'revoke.own.consents'
  | 'read.own.cases'
  | 'read.own.credentials'
  
  // Teaching Assistant
  | 'read.section.roster'
  | 'read.section.submissions'
  | 'write.section.grading'
  
  // Lecturer
  | 'write.section.grades'
  | 'write.section.cases'
  | 'write.course.content'
  | 'submit.course.for-review'
  | 'read.section.analytics'
  
  // Muhaffiza (Recitation Lecturer)
  | 'write.section.lajnat'
  | 'write.section.recitation-feedback'
  | 'write.section.mistake-markings'
  
  // Advisor
  | 'read.section.roster.any'
  | 'full.case.management'
  | 'write.case.referrals'
  | 'write.case.appointments'
  
  // Sama Committee
  | 'read.faculty.recitation-recordings'
  | 'read.faculty.audit-trail'
  | 'decide.sama-approvals'
  
  // Committee Member
  | 'read.faculty.outcomes'
  | 'read.faculty.evidence'
  | 'decide.reviews'
  | 'write.improvement-actions'
  
  // Sheikh Reviewer
  | 'approve.content'
  | 'request.content-changes'
  | 'reject.content'
  | 'delegate.to.backup-sheikh'
  
  // Dean
  | 'read.all'
  | 'override.stalled-reviews'
  | 'approve.critical-changes'
  | 'manage.roles'
  
  // Operator
  | 'manage.users'
  | 'manage.integrations'
  | 'manage.system-config'
  // Cannot read student academic data (separation of concerns)
  
  // Mahram
  | 'read.child.mothers-view-summary';

export interface User {
  id: string;
  role: Role;
  facultyId: string | null;
  displayNameAr: string;
  displayNameEn: string | null;
  email: string | null;
  whatsappE164: string | null;
  nationalIdHash: string | null;
  avatarUrl: string | null;
  active: boolean;
  createdAt: Date;
  lastActiveAt: Date | null;
}

export interface UserRole {
  userId: string;
  role: Role;
  scopeType: 'institution' | 'faculty' | 'department' | 'section' | 'own';
  scopeId: string | null;
  grantedBy: string;
  grantedAt: Date;
}

export interface Permission {
  id: string;
  code: PermissionCode;
  descriptionAr: string;
}

export interface Consent {
  id: string;
  userId: string;
  purpose: 'voice_recording' | 'analytics' | 'mahram_access' | 'notifications' | 'data_processing';
  grantedAt: Date;
  withdrawnAt: Date | null;
  evidenceRef: string | null;
}

export interface GuardianLink {
  id: string;
  studentId: string;
  guardianId: string;
  scope: 'summary' | 'alerts' | 'full';
  grantedAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  otpVerifiedAt: Date | null;
}

export interface AuthSession {
  id: string;
  userId: string;
  device: string;
  ip: string;
  startedAt: Date;
  endedAt: Date | null;
  revoked: boolean;
}