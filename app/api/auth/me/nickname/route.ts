import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

type Context = { params: Promise<Record<string, string>> };

/** Ник больше не редактируется отдельно — берётся из поля «Имя». */
export async function PUT(_request: NextRequest, _context: Context) {
  return NextResponse.json(
    { error: 'Ник на сайте задаётся полем «Имя» в игровых данных.' },
    { status: 410 },
  );
}

export async function POST(request: NextRequest) {
  return NextResponse.redirect(new URL('/app/profile', request.url), 303);
}
