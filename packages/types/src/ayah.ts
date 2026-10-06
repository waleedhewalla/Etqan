/**
 * Quran-specific types
 * Ref format: "sura:ayah" (e.g., "2:255")
 * All ayah text stored in Uthmani script (KFGQPC)
 */

export type Ref = `${number}:${number}`;

export interface Ayah {
  ref: Ref;
  sura: number;
  ayah: number;
  textUthmani: string;
  textSimplified: string;
  textNormalized: string;
  pageMadani: number;
  juz: number;
  hizb: number;
  ruku: number;
  suraNameAr: string;
}

export interface Recitation {
  id: string;
  ayahRef: Ref;
  reciterId: string;
  audioUrl: string;
  durationMs: number;
  format: 'mp3' | 'ogg';
}

export interface Passage {
  id: string;
  nameAr: string;
  startRef: Ref;
  endRef: Ref;
  ayahRefs: Ref[];
}

export interface Riwayah {
  id: string;
  nameAr: string;
  nameEn: string;
  sourcePackageHash: string;
  isDefault: boolean;
}

export interface Transition {
  id: string;
  sourceRef: Ref;
  targetRef: Ref;
  boundaryType: 'ayah' | 'sura' | 'juz' | 'page';
  weight: number;
  mutashabihAlternates: Ref[];
  pageMadani: number;
}

export interface StudentTransition {
  studentId: string;
  transitionId: string;
  phoneticStability: number;
  semanticStability: number;
  positionalStability: number;
  recognitionStability: number;
  difficulty: number;
  dueAt: Date;
  lastReviewedAt: Date | null;
  reps: number;
  lapses: number;
}

// Tajweed Interactive Learning Objects (RLOs)
export type TajweedCategory = 'noon_sakinah' | 'meem_sakinah' | 'madd' | 'qalqalah' | 'lam' | 'ra' | 'makhaarij' | 'sifaat';

export interface TajweedRule {
  id: string;
  nameAr: string;
  nameEn: string;
  transliteration: string;
  category: TajweedCategory;
  descriptionAr: string;
  exampleAyahRef: Ref;
  exampleText: string;
  audioUrl: string | null;
  color: string;
}

export interface TajweedRLO {
  rule: TajweedRule;
  mastery: number;
  practiceCount: number;
  lastPracticedAt: Date | null;
}

// Tasmi / SpeedGrader types
export interface TasmiSubmission {
  id: string;
  studentId: string;
  studentName: string;
  passage: Passage;
  audioUrl: string | null;
  durationSeconds: number;
  submittedAt: Date;
  previousMastery: number;
  sessionType: 'sabaq' | 'sabaq_para' | 'manzil';
  aiPreScreen: AIPreScreen | null;
  teacherReview: TeacherReview | null;
}

export interface AIPreScreen {
  hifzAccuracy: number;
  tajweedAccuracy: number;
  fluencyScore: number;
  confidence: number;
  flaggedErrors: string[];
  readyForApproval: boolean;
}

export interface TeacherReview {
  hifzScore: number;
  tajweedScore: number;
  fluencyScore: number;
  weightedTotal: number;
  verdict: 'approved' | 'needs_review' | 'rejected';
  notes: string;
  reviewedAt: Date;
  reviewedBy: string;
}