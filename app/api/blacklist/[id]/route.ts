import { handle } from '@/lib/api';
import type { NextRequest } from 'next/server';

type Context = { params: Promise<Record<string, string>> };

export async function GET(request: NextRequest, context: Context) {
  return handle('blacklist-item', request, context);
}

export async function PATCH(request: NextRequest, context: Context) {
  return handle('blacklist-item', request, context);
}

export async function DELETE(request: NextRequest, context: Context) {
  return handle('blacklist-item', request, context);
}
