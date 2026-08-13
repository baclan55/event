import { NextResponse } from 'next/server';
import { requireAnyRoleUser, requirePermissionUser, requireRoleInUser } from '@/lib/auth';
import type { Permission } from '@/lib/roleAccess';
import { readUploadedImage } from '@/lib/images';

export const required = async (roles?: readonly string[]) =>
  roles ? requireRoleInUser(roles) : requireAnyRoleUser();

export const requiredPerm = async (permission: Permission) =>
  requirePermissionUser(permission);

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
