'use client';

import { alignWords, splitWords } from '@itqan/quran';
import { formatAyahRef } from '@/lib/quran';
import type { Cluster } from '@/lib/api';

/** For each verse, the positions of words that differ from at least one other verse of the cluster. */
export function differingPositions(texts: string[]): Set<number>[] {
  const words = texts.map(splitWords);
  return words.map((mine, i) => {
    const marked = new Set<number>();
    words.forEach((theirs, j) => {
      if (i === j) return;
      for (const op of alignWords(mine, theirs)) {
        if ((op.type === 'wrong' || op.type === 'missing')) marked.add(op.expectedIndex);
      }
    });
    return marked;
  });
}

/** The verses of a cluster one under another, with the words that set them apart highlighted. */
export function ClusterCompare({ cluster }: { cluster: Cluster }) {
  const loaded = cluster.ayat.every((a) => a.text);
  const marks = loaded ? differingPositions(cluster.ayat.map((a) => a.text!)) : [];

  return (
    <div className="space-y-2">
      {cluster.ayat.map((a, i) => (
        <div key={a.ref} className="rounded-xl border border-divider bg-surface-canvas p-3">
          <p className="text-xs text-text-secondary mb-1">{formatAyahRef(a.ref)}</p>
          {a.text ? (
            <p lang="ar" dir="rtl" className="font-quran text-mushaf text-text-primary">
              {splitWords(a.text).map((w, k) => (
                <span key={k}>
                  <span data-diff={marks[i]?.has(k) ? 'true' : undefined} className={marks[i]?.has(k) ? 'rounded px-0.5 bg-amber-100 text-amber-900 underline decoration-wavy decoration-amber-600' : ''}>{w}</span>{' '}
                </span>
              ))}
            </p>
          ) : <p className="text-sm text-state-attention">نص هذه الآية غير محمّل بعد.</p>}
        </div>
      ))}
      {cluster.tawjihAr && <p className="text-sm rounded-lg bg-surface-canvas px-3 py-2"><b>توجيه:</b> {cluster.tawjihAr}</p>}
    </div>
  );
}
