import { NextResponse } from 'next/server';
import { handle } from '@/lib/api';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handle('media', request, context);
}
