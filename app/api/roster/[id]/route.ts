import { handle } from '@/lib/api';
import type { NextRequest } from 'next/server';
type Context = { params: Promise<Record<string, string>> };
export async function PUT(request: NextRequest, context: Context) { return handle('roster-user', request, context); }
export async function DELETE(request: NextRequest, context: Context) { return handle('roster-user', request, context); }
