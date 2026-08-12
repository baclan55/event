import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSession } from '@/lib/session';
import { invalidateUserCache } from '@/lib/auth';

const OWNER_LOGIN = 'e2e-owner';
const TARGET_LOGIN = 'e2e-target';

function allowed(request: NextRequest): boolean {
  return process.env.E2E_TEST_MODE === '1'
    && !!process.env.E2E_TEST_SECRET
    && request.headers.get('x-e2e-secret') === process.env.E2E_TEST_SECRET;
}

export async function POST(request: NextRequest) {
  if (!allowed(request)) return new NextResponse(null, { status: 404 });

  await query(`
    INSERT INTO roles(name, priority) VALUES
      ('Chief Event', 1),
      ('Event Helper', 9)
    ON CONFLICT(name) DO UPDATE SET priority=EXCLUDED.priority
  `);
  const owner = await query<{ id: number }>(
    `INSERT INTO users(login, nickname, is_owner, is_admin, status)
     VALUES($1, 'E2E Owner', TRUE, TRUE, 'member')
     ON CONFLICT(login) DO UPDATE SET nickname='E2E Owner', is_owner=TRUE, is_admin=TRUE, status='member'
     RETURNING id`,
    [OWNER_LOGIN]
  );
  const target = await query<{ id: number }>(
    `INSERT INTO users(login, nickname, status)
     VALUES($1, 'E2E Target', 'member')
     ON CONFLICT(login) DO UPDATE SET nickname='E2E Target', status='member'
     RETURNING id`,
    [TARGET_LOGIN]
  );
  await query('DELETE FROM user_roles WHERE user_id=ANY($1::int[])', [[owner.rows[0].id, target.rows[0].id]]);
  await query(
    `INSERT INTO user_roles(user_id, role_id)
     SELECT $1, id FROM roles WHERE name='Chief Event'
     ON CONFLICT DO NOTHING`,
    [owner.rows[0].id]
  );
  await query(
    `INSERT INTO user_roles(user_id, role_id)
     SELECT $1, id FROM roles WHERE name='Event Helper'
     ON CONFLICT DO NOTHING`,
    [target.rows[0].id]
  );
  await query(
    `UPDATE users SET role_id=(
       SELECT r.id FROM user_roles ur JOIN roles r ON r.id=ur.role_id
       WHERE ur.user_id=users.id ORDER BY r.priority LIMIT 1
     ) WHERE id=ANY($1::int[])`,
    [[owner.rows[0].id, target.rows[0].id]]
  );

  invalidateUserCache(owner.rows[0].id);
  invalidateUserCache(target.rows[0].id);
  const session = await getSession();
  session.userId = owner.rows[0].id;
  await session.save();
  return NextResponse.json({ ownerId: owner.rows[0].id, targetId: target.rows[0].id });
}

export async function DELETE(request: NextRequest) {
  if (!allowed(request)) return new NextResponse(null, { status: 404 });
  const users = await query<{ id: number }>('SELECT id FROM users WHERE login=ANY($1::text[])', [[OWNER_LOGIN, TARGET_LOGIN]]);
  const ids = users.rows.map((user) => user.id);
  if (ids.length) {
    await query('DELETE FROM vacations WHERE user_id=ANY($1::int[])', [ids]);
    await query('DELETE FROM reprimands WHERE user_id=ANY($1::int[]) OR issued_by=ANY($1::int[])', [ids]);
    if (request.nextUrl.searchParams.get('purge') === '1') {
      await query('DELETE FROM users WHERE id=ANY($1::int[])', [ids]);
    }
  }
  users.rows.forEach((user) => invalidateUserCache(user.id));
  const session = await getSession();
  await session.destroy();
  return NextResponse.json({ ok: true });
}
