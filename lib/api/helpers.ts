import { NextResponse } from 'next/server';
import {
  jsonError,
  publicUser,
  requireAnyRoleUser,
  requirePermissionUser,
  requireRoleInUser,
  type DbUser,
} from '@/lib/auth';
import type { Permission } from '@/lib/roleAccess';
import { readUploadedImage } from '@/lib/images';

type ProfileOpts = { allowIncompleteProfile?: boolean };

function assertProfileComplete(user: DbUser, opts?: ProfileOpts) {
  if (opts?.allowIncompleteProfile) return null;
  const pub = publicUser(user);
  if (pub && !pub.profileComplete) {
    return jsonError('Сначала заполните игровые данные (имя и StaticID).', 403, {
      profileIncomplete: true,
    });
  }
  return null;
}

export const required = async (roles?: readonly string[], opts?: ProfileOpts) => {
  const user = roles ? await requireRoleInUser(roles) : await requireAnyRoleUser();
  if (user instanceof NextResponse) return user;
  const blocked = assertProfileComplete(user, opts);
  if (blocked) return blocked;
  return user;
};

export const requiredPerm = async (permission: Permission, opts?: ProfileOpts) => {
  const user = await requirePermissionUser(permission);
  if (user instanceof NextResponse) return user;
  const blocked = assertProfileComplete(user, opts);
  if (blocked) return blocked;
  return user;
};

export const readBody = async (request: Request) =>
  request.clone().json().catch(() => ({})) as Promise<Record<string, unknown>>;

export const parseId = (value: string) => Number.parseInt(value, 10);

export const ok = (value: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: true, ...value });

export const plain = (text: string, status: number) =>
  new NextResponse(text, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });

export async function readImage(request: Request) {
  try {
    return await readUploadedImage(await request.formData());
  } catch (error) {
    return error instanceof Error ? error : new Error('Неверный файл.');
  }
}
