'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser, invalidateUserCache } from '@/lib/auth';
import { query } from '@/lib/db';

export async function updateNicknameAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  const nickname = String(formData.get('nickname') || '').trim();
  if (!nickname || nickname.length > 60) return;
  await query('UPDATE users SET nickname=$1 WHERE id=$2', [nickname, user.id]);
  invalidateUserCache(user.id);
  revalidatePath('/app/profile');
}
