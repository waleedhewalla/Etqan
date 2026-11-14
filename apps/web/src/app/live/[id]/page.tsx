'use client';

import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { FullPageSpinner } from '@/components/LoadState';
import { LiveRoom } from '@/components/LiveRoom';

/** A live lesson's room. Who may enter is decided by the API when the room token is requested. */
export default function LivePage({ params }: { params: { id: string } }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!isLoading && !user) router.replace('/auth/login');
  }, [isLoading, user, router]);
  if (isLoading || !user) return <FullPageSpinner />;
  return <LiveRoom sessionId={params.id} />;
}
