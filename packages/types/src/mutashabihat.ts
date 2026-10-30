/**
 * Mutashabihat (similar verses) types
 * Based on Sefaria's Link model
 */

import type { Ref } from './ayah';

export interface MutashabihatCluster {
  id: string;
  ayahRefs: Ref[];
  source: 'kirmani' | 'ansari' | 'sakhawi' | 'other';
  sourcePage: string;
  tawjihAr: string;
  status: 'pending' | 'approved' | 'rejected' | 'archived';
  approvedBy: string | null;
  approvedAt: Date | null;
  approvalNote: string | null;
  createdAt: Date;
}

export interface MutashabihatLink {
  id: string;
  clusterId: string;
  ayahARef: Ref;
  ayahBRef: Ref;
  alignment: WordAlignment[];
  similarityType: 'literal' | 'partial' | 'structural';
  strength: number;
}

export interface WordAlignment {
  aIndex: number | null;
  bIndex: number | null;
  aWord: string | null;
  bWord: string | null;
  match: boolean;
  type: 'match' | 'substitution' | 'insertion_in_a' | 'insertion_in_b' | 'deletion_in_a' | 'deletion_in_b';
}

export interface MutashabihatDrill {
  id: string;
  studentId: string;
  clusterId: string;
  type: 'drag-drop' | 'cloze' | 'timed-choice' | 'split-comparison';
  question: string;
  options: string[];
  correctAnswer: string;
  difficulty: number;
  createdAt: Date;
}

export interface MutashabihatWeaknessReport {
  studentId: string;
  clusterId: string;
  confusionCount: number;
  lastConfusedAt: Date;
  trend: 'improving' | 'stable' | 'worsening';
}