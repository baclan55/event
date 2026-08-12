import { handle } from '@/lib/api';
import { getCurrentUser, invalidateUserCache } from '@/lib/auth';
import { query } from '@/lib/db';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

type Context = { params: Promise<Record<string, string>> };

export async function PUT(request: NextRequest, context: Context) { return handle('nickname', request, context); }

/** Обычная HTML-форма: профиль работает без гидрации React и JS-чанков. */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL('/', request.url), 303);

  const form = await request.formData();
  const nickname = String(form.get('nickname') || '').trim();
  if (nickname && nickname.length <= 60) {
    await query('UPDATE users SET nickname=$1 WHERE id=$2', [nickname, user.id]);
    invalidateUserCache(user.id);
  }

  return NextResponse.redirect(new URL('/app/profile', request.url), 303);
}
