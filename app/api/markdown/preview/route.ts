import { handle } from '@/lib/api';
import type { NextRequest } from 'next/server';
type Context = { params: Promise<Record<string, string>> };
export async function POST(request: NextRequest, context: Context) { return handle('markdown', request, context); }
