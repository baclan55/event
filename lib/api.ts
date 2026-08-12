import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { pool, query } from '@/lib/db';
import { getCurrentUser, requireAnyRoleUser, requireRoleInUser, publicUser, invalidateUserCache, jsonError, loadUserById } from '@/lib/auth';
import { getSession } from '@/lib/session';
import { EDIT_ROLES, REPRIMANDS_ROLES, APPLICATIONS_ROLES, CANDIDATES_ROLES, OWNER_PANEL_ROLES, VACATIONS_REVIEW_ROLES, userHasRoleIn } from '@/lib/roleAccess';
import { tierForPriority } from '@/lib/tier';
import { replaceUserRoles, getRolesForUsers, addUserRole } from '@/lib/roles';
import { saveImage, readUploadedImage } from '@/lib/images';
import { isConfigured, uploadAvatar, deleteAvatar } from '@/lib/cloudinary';
import { LIMITS_PAYLOAD, syncBlockStatus, maybeConvertVerbalToStrict, adminPointActive, helperActivePoints, ADMIN_POINT_DECAY_DAYS, ADMIN_POINT_LIMIT, HELPER_BLOCK_POINTS } from '@/lib/reprimandRules';
import { renderBody, rawBodyForEdit, normalizeMarkdownSource, renderMarkdown } from '@/lib/richText';

type Ctx = { params: Promise<Record<string, string>> };
type User = Exclude<Awaited<ReturnType<typeof getCurrentUser>>, null>;
const required = async (roles?: readonly string[]) => roles ? requireRoleInUser(roles) : requireAnyRoleUser();
const body = async (r: Request) => r.clone().json().catch(() => ({})) as Promise<Record<string, unknown>>;
const id = (v: string) => Number.parseInt(v, 10);
const ok = (value: Record<string, unknown> = {}) => NextResponse.json({ ok: true, ...value });
const plain = (text: string, status: number) => new NextResponse(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
const redirectUri = () => {
  const domain = (process.env.APP_DOMAIN || '').trim().toLowerCase();
  const fromEnv = (process.env.DISCORD_REDIRECT_URI || '').trim();
  if (domain) return `https://${domain}/api/auth/discord/callback`;
  return process.env.NODE_ENV === 'production' && fromEnv.startsWith('http://') ? `https://${fromEnv.slice(7)}` : fromEnv || null;
};
async function image(r: Request) {
  try { return await readUploadedImage(await r.formData()); } catch (e) { return e instanceof Error ? e : new Error('Неверный файл.'); }
}
async function avatar(userId: number, file: { mimetype: string; buffer: Buffer }, oldPublicId?: string | null) {
  if (isConfigured()) {
    const uploaded = await uploadAvatar(file.buffer);
    await query('UPDATE users SET avatar_url=$1, avatar_public_id=$2, avatar_image_id=NULL WHERE id=$3', [uploaded.url, uploaded.publicId, userId]);
    if (oldPublicId) void deleteAvatar(oldPublicId);
    return { avatarUrl: uploaded.url };
  }
  const imageId = await saveImage(file);
  await query('UPDATE users SET avatar_image_id=$1, avatar_url=NULL, avatar_public_id=NULL WHERE id=$2', [imageId, userId]);
  return { imageId };
}
function active(rows: Record<string, unknown>[]) {
  return rows.map((r) => ({ ...r, active: r.type === 'point' ? adminPointActive(r.created_at as string) : !(r.type === 'verbal' && r.converted), expires_at: r.type === 'point' ? new Date(new Date(r.created_at as string).getTime() + ADMIN_POINT_DECAY_DAYS * 864e5).toISOString() : null }));
}
async function login(discordUser: { id: string; username: string }, session: Awaited<ReturnType<typeof getSession>>) {
  const owner = !!process.env.DISCORD_OWNER_ID && String(discordUser.id) === String(process.env.DISCORD_OWNER_ID);
  const existing = await query<{ id: number }>('SELECT id FROM users WHERE discord_id=$1', [discordUser.id]);
  let userId: number;
  if (existing.rows[0]) { userId = existing.rows[0].id; await query('UPDATE users SET discord_username=$1 WHERE id=$2', [discordUser.username, userId]); }
  else {
    const count = await query<{ c: number }>('SELECT COUNT(*)::int AS c FROM users');
    const grant = owner || count.rows[0].c === 0;
    const role = grant ? await query<{ id: number }>('SELECT id FROM roles ORDER BY priority LIMIT 1') : { rows: [] };
    const inserted = await query<{ id: number }>('INSERT INTO users(discord_id,discord_username,nickname,role_id,is_owner,is_admin) VALUES($1,$2,$2,$3,$4,$4) RETURNING id', [discordUser.id, discordUser.username, role.rows[0]?.id ?? null, grant]);
    userId = inserted.rows[0].id;
  }
  if (owner) await query('UPDATE users SET is_owner=TRUE,is_admin=TRUE WHERE id=$1', [userId]);
  session.userId = userId; const ret = session.discordOAuthReturnTo; delete session.discordOAuthReturnTo; return ret === 'apply' ? '/apply' : '/app/faq';
}

export async function handle(key: string, request: NextRequest, context: Ctx): Promise<Response> {
  const p = await context.params; const method = request.method; const b = await body(request);
  try {
    if (key === 'config') return NextResponse.json({ appTitle: process.env.APP_TITLE || 'Events Denver', appSubtitle: process.env.APP_SUBTITLE || 'Ивент-отдел сервера', weeklyEventsTarget: Number.parseInt(process.env.WEEKLY_EVENTS_TARGET || '', 10) || 5, discordEnabled: !!(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) });
    if (key === 'live') return NextResponse.json({ ok: true });
    if (key === 'health') { try { await pool.query('SELECT 1'); return ok(); } catch { return NextResponse.json({ ok: false, error: 'База данных недоступна.' }, { status: 503 }); } }
    if (key === 'me') return NextResponse.json({ user: publicUser(await getCurrentUser()) });
    if (key === 'logout') { const s = await getSession(); const uid = s.userId; await s.destroy(); if (uid) invalidateUserCache(uid); return ok(); }
    if (key === 'oauth') {
      const client = process.env.DISCORD_CLIENT_ID, uri = redirectUri(); if (!client || !uri) return plain('Вход через Discord не настроен.', 400);
      if (request.nextUrl.searchParams.get('consent') !== '1') return plain('Необходимо подтвердить согласие на обработку персональных данных.', 400);
      const s = await getSession(); const state = crypto.randomBytes(24).toString('hex'); s.discordOAuthState = state; s.discordOAuthReturnTo = request.nextUrl.searchParams.get('returnTo') === 'apply' ? 'apply' : null; await s.save();
      const u = new URL('https://discord.com/api/oauth2/authorize'); u.search = new URLSearchParams({ client_id: client, redirect_uri: uri, response_type: 'code', scope: 'identify', state }).toString(); return NextResponse.redirect(u);
    }
    if (key === 'callback') {
      const uri = redirectUri(), code = request.nextUrl.searchParams.get('code'), state = request.nextUrl.searchParams.get('state'), s = await getSession();
      const expected = s.discordOAuthState; delete s.discordOAuthState;
      if (!uri || !code) return plain('Discord не передал код авторизации.', 400);
      if (!expected || state !== expected) return plain('Недействительный запрос авторизации (state не совпадает).', 400);
      const relay = (process.env.DISCORD_RELAY_URL || '').replace(/\/$/, ''), secret = process.env.DISCORD_RELAY_SECRET || '';
      let discordUser: { id: string; username: string };
      if (relay) { if (!secret) return plain('DISCORD_RELAY_URL задан, но нет DISCORD_RELAY_SECRET.', 500); const r = await fetch(`${relay}/oauth/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Relay-Secret': secret }, body: JSON.stringify({ code, redirect_uri: uri }), signal: AbortSignal.timeout(15_000) }); const d = await r.json().catch(() => ({})); if (!r.ok || !d.discordUser?.id) return plain(`Не удалось подтвердить вход через Discord (relay): ${d.error || r.status}`, 400); discordUser = d.discordUser; }
      else { if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) return plain('Вход через Discord не настроен на сервере.', 400); const t = await fetch('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: uri }) }); if (!t.ok) return plain('Не удалось подтвердить вход через Discord.', 400); const token = await t.json(); const u = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } }); if (!u.ok) return plain('Не удалось получить данные пользователя Discord.', 400); discordUser = await u.json(); }
      const path = await login(discordUser, s); await s.save(); const domain = (process.env.APP_DOMAIN || '').trim(); return NextResponse.redirect(domain ? `https://${domain}${path}` : new URL(path, request.url));
    }
    if (key === 'nickname') { const u = await required(); if (u instanceof NextResponse) return u; const nickname = String(b.nickname || '').trim(); if (!nickname || nickname.length > 60) return jsonError(!nickname ? 'Введите никнейм.' : 'Никнейм слишком длинный (максимум 60 символов).', 400); await query('UPDATE users SET nickname=$1 WHERE id=$2', [nickname, u.id]); invalidateUserCache(u.id); return NextResponse.json({ user: publicUser(await loadUserById(u.id)) }); }
    if (key === 'my-avatar') { const u = await required(); if (u instanceof NextResponse) return u; const f = await image(request); if (!f || f instanceof Error) return jsonError(f?.message || 'Файл не получен.', 400); await avatar(u.id, f, u.avatar_public_id); invalidateUserCache(u.id); return NextResponse.json({ user: publicUser(await loadUserById(u.id)) }); }
    if (key === 'media') { const r = await query<{ mime_type: string; data: Buffer }>('SELECT mime_type,data FROM images WHERE id=$1', [id(p.id)]); return r.rows[0] ? new NextResponse(new Uint8Array(r.rows[0].data), { headers: { 'Content-Type': r.rows[0].mime_type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } }) : new NextResponse(null, { status: 404 }); }
    if (key === 'markdown') { const u = await required(EDIT_ROLES); if (u instanceof NextResponse) return u; return NextResponse.json({ html: renderMarkdown(String((await body(request)).body || '')) }); }
    if (key.startsWith('content')) { const u = await required(method === 'GET' ? undefined : EDIT_ROLES); if (u instanceof NextResponse) return u; const section = p.section; if (!['faq','regulations','first_steps'].includes(section)) return jsonError('Неизвестный раздел.',404); const b = await body(request); const audience = ['helper','administrator','general'].includes(String(b.audience || request.nextUrl.searchParams.get('audience'))) ? String(b.audience || request.nextUrl.searchParams.get('audience')) : 'general'; if (key === 'content') { if (method === 'GET') { const r=await query<Record<string,unknown>>('SELECT c.audience,c.body,c.image_id,c.updated_at,u.nickname AS updated_by_name FROM content_blocks c LEFT JOIN users u ON u.id=c.updated_by WHERE c.section=$1',[section]); const blocks=Object.fromEntries(r.rows.filter(x => x.audience !== 'administrator' || u.is_owner || tierForPriority(u.role_priority)==='admin').map(x=>[x.audience as string,{body:renderBody(x.body),bodyRaw:rawBodyForEdit(x.body),imageId:x.image_id,updatedAt:x.updated_at,updatedBy:x.updated_by_name}])); return NextResponse.json({section,blocks}); } await query('INSERT INTO content_blocks(section,audience,body,updated_by,updated_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(section,audience) DO UPDATE SET body=EXCLUDED.body,updated_by=EXCLUDED.updated_by,updated_at=now()',[section,audience,normalizeMarkdownSource(String(b.body||'')),u.id]); return ok(); } if (method === 'DELETE') { await query('UPDATE content_blocks SET image_id=NULL,updated_by=$3,updated_at=now() WHERE section=$1 AND audience=$2',[section,audience,u.id]); return ok(); } const f=await image(request); if(!f||f instanceof Error)return jsonError(f?.message||'Файл не получен.',400); const imageId=await saveImage(f); await query("INSERT INTO content_blocks(section,audience,body,image_id,updated_by,updated_at) VALUES($1,$2,'',$3,$4,now()) ON CONFLICT(section,audience) DO UPDATE SET image_id=EXCLUDED.image_id,updated_by=EXCLUDED.updated_by,updated_at=now()",[section,audience,imageId,u.id]); return ok({imageId}); }
    if (key.startsWith('rule')) { const u=await required(method==='GET'?undefined:EDIT_ROLES); if(u instanceof NextResponse)return u; const b=await body(request); if(key==='rules'&&method==='GET'){const r=await query<Record<string,unknown>>('SELECT id,position,title,body,image_id,updated_at FROM rules ORDER BY position,id');return NextResponse.json({rules:r.rows.map(x=>({...x,body:renderBody(x.body),bodyRaw:rawBodyForEdit(x.body)}))});} if(key==='rules'&&method==='POST'){const title=String(b.title||'').trim();if(!title)return jsonError('Укажите заголовок правила.',400);const n=await query<{next:number}>('SELECT COALESCE(MAX(position),-1)+1 AS next FROM rules');const r=await query<{id:number}>('INSERT INTO rules(position,title,body) VALUES($1,$2,$3) RETURNING id',[n.rows[0].next,title,normalizeMarkdownSource(String(b.body||''))]);return ok({id:r.rows[0].id});} if(key==='rules-reorder'){if(!Array.isArray(b.order))return jsonError('order должен быть массивом id.',400);await Promise.all(b.order.map((v,i)=>query('UPDATE rules SET position=$1 WHERE id=$2',[i,v])));return ok();} if(key==='rule-image'){if(method==='DELETE'){await query('UPDATE rules SET image_id=NULL,updated_at=now() WHERE id=$1',[id(p.id)]);return ok();}const f=await image(request);if(!f||f instanceof Error)return jsonError(f?.message||'Файл не получен.',400);const imageId=await saveImage(f);await query('UPDATE rules SET image_id=$1,updated_at=now() WHERE id=$2',[imageId,id(p.id)]);return ok({imageId});} if(method==='DELETE'){await query('DELETE FROM rules WHERE id=$1',[id(p.id)]);return ok();}const title=String(b.title||'').trim();if(!title)return jsonError('Укажите заголовок правила.',400);await query('UPDATE rules SET title=$1,body=$2,updated_at=now() WHERE id=$3',[title,normalizeMarkdownSource(String(b.body||'')),id(p.id)]);return ok();}
    if (key.startsWith('roster')) { const u=await required(key==='roster'&&method==='GET'||key==='roster-roles'?undefined:EDIT_ROLES);if(u instanceof NextResponse)return u;const b=await body(request);if(key==='roster-roles'){const r=await query('SELECT id,name,priority FROM roles ORDER BY priority');return NextResponse.json({roles:r.rows});}if(key==='roster'&&method==='GET'){const r=await query<Record<string,unknown>>('SELECT u.id,u.nickname,u.discord_username,u.avatar_image_id,u.avatar_url,u.weekly_events,u.note,u.role_id,u.status,u.is_blocked,u.blocked_at,r.name role_name,r.priority role_priority FROM users u LEFT JOIN roles r ON r.id=u.role_id ORDER BY COALESCE(r.priority,999),u.nickname');const roles=await getRolesForUsers(r.rows.map(x=>x.id as number));const all=await query('SELECT id,name,priority FROM roles ORDER BY priority');return NextResponse.json({members:r.rows.map(x=>({...x,tier:tierForPriority(x.role_priority as number),roles:roles.get(x.id as number)||[]})),target:Number(process.env.WEEKLY_EVENTS_TARGET)||5,roles:all.rows});}if(key==='roster-avatar'){const f=await image(request);if(!f||f instanceof Error)return jsonError(f?.message||'Файл не получен.',400);const old=await query<{avatar_public_id:string}>('SELECT avatar_public_id FROM users WHERE id=$1',[id(p.id)]);const result=await avatar(id(p.id),f,old.rows[0]?.avatar_public_id);invalidateUserCache(p.id);return ok(result);}if(key==='roster-user'&&method==='DELETE'){const x=await query<{is_owner:boolean}>('SELECT is_owner FROM users WHERE id=$1',[id(p.id)]);if(x.rows[0]?.is_owner)return jsonError('Нельзя удалить владельца из состава.',400);await query('DELETE FROM users WHERE id=$1',[id(p.id)]);invalidateUserCache(p.id);return ok();}const nickname=String(b.nickname||'').trim();if(!nickname)return jsonError('Укажите никнейм участника.',400);const roleIds=Array.isArray(b.roleIds)?b.roleIds:b.roleId?[b.roleId]:[];if(key==='roster'){const x=await query<{id:number}>('INSERT INTO users(nickname,weekly_events,note) VALUES($1,$2,$3) RETURNING id',[nickname,Number(b.weeklyEvents)||0,String(b.note||'')]);if(roleIds.length)await replaceUserRoles(x.rows[0].id,roleIds as number[]);return ok({id:x.rows[0].id});}await query('UPDATE users SET nickname=$1,weekly_events=COALESCE($2::integer,weekly_events),note=$3 WHERE id=$4',[nickname,Number.isFinite(Number(b.weeklyEvents))?Number(b.weeklyEvents):null,String(b.note||''),id(p.id)]);await replaceUserRoles(id(p.id),roleIds as number[]);invalidateUserCache(p.id);return ok();}
    if (key==='applications-status') {if(method==='GET'){const r=await query<{is_open:boolean}>('SELECT is_open FROM applications_settings WHERE id=1');return NextResponse.json({isOpen:r.rows[0]?.is_open??true});}const u=await required(APPLICATIONS_ROLES);if(u instanceof NextResponse)return u;const isOpen=b.isOpen===true||b.isOpen==='true';await query('UPDATE applications_settings SET is_open=$1,updated_by=$2,updated_at=now() WHERE id=1',[isOpen,u.id]);return ok({isOpen});}
    if (key==='vacations-mine'||key==='vacations'||key==='vacation') {const u=await required();if(u instanceof NextResponse)return u;const fields='v.id,v.user_id,v.start_date,v.end_date,v.reason,v.status,v.created_at,v.reviewed_by,v.reviewed_at,u.nickname,u.avatar_image_id,u.avatar_url,rb.nickname reviewed_by_nickname';if(key==='vacations-mine'){const r=await query(`SELECT ${fields} FROM vacations v JOIN users u ON u.id=v.user_id LEFT JOIN users rb ON rb.id=v.reviewed_by WHERE v.user_id=$1 ORDER BY v.created_at DESC`,[u.id]);return NextResponse.json({vacations:r.rows});}if(key==='vacations'&&method==='GET'){const r=await query<Record<string,unknown>>(`SELECT ${fields} FROM vacations v JOIN users u ON u.id=v.user_id LEFT JOIN users rb ON rb.id=v.reviewed_by ORDER BY v.start_date`);const mine=r.rows.filter(x=>x.user_id===u.id);return NextResponse.json({vacations:r.rows.map(x=>({...x,reason:u.is_owner||u.id===x.user_id||userHasRoleIn(u,VACATIONS_REVIEW_ROLES)?x.reason:''})),mine});}if(key==='vacations'){const start=String(b.startDate||''),end=String(b.endDate||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||end<start)return jsonError('Укажите корректный период отпуска.',400);const r=await query<{id:number}>('INSERT INTO vacations(user_id,start_date,end_date,reason) VALUES($1,$2,$3,$4) RETURNING id',[u.id,start,end,String(b.reason||'')]);return ok({id:r.rows[0].id});}if(method==='DELETE'){const x=await required(VACATIONS_REVIEW_ROLES);if(x instanceof NextResponse)return x;await query('DELETE FROM vacations WHERE id=$1',[id(p.id)]);return ok();}const v=await query<{user_id:number,status:string}>('SELECT user_id,status FROM vacations WHERE id=$1',[id(p.id)]);if(!v.rows[0])return jsonError('Заявка не найдена.',404);const status=String(b.status);const reviewer=userHasRoleIn(u,VACATIONS_REVIEW_ROLES);if(!reviewer&&!(status==='cancelled'&&v.rows[0].user_id===u.id&&v.rows[0].status==='pending'))return jsonError('Недостаточно прав для рассмотрения заявок на отпуск.',403);await query('UPDATE vacations SET status=$1,reviewed_by=$2,reviewed_at=now() WHERE id=$3',[status,u.id,id(p.id)]);return ok();}

    if (key.startsWith('reprimand')) {
      if (key === 'reprimands-me') {
        const u = await required(); if (u instanceof NextResponse) return u;
        const r = await query<Record<string, unknown>>(`SELECT rp.id, rp.reason, rp.type, rp.created_at, rp.converted, rp.auto_generated,
          ib.nickname AS issued_by_nickname FROM reprimands rp LEFT JOIN users ib ON ib.id = rp.issued_by
          WHERE rp.user_id=$1 ORDER BY rp.created_at DESC`, [u.id]);
        return NextResponse.json({
          reprimands: active(r.rows),
          tier: tierForPriority(u.role_priority),
          isBlocked: !!u.is_blocked,
          blockedAt: u.blocked_at,
          limits: LIMITS_PAYLOAD,
        });
      }
      if (key === 'reprimands-user') {
        const u = await required(REPRIMANDS_ROLES); if (u instanceof NextResponse) return u;
        const userId = id(p.userId);
        const ur = await query<Record<string, unknown>>(`SELECT u.id, u.nickname, u.discord_username, u.avatar_image_id, u.avatar_url,
          u.weekly_events, u.is_blocked, u.blocked_at, u.role_id, r.name AS role_name, r.priority AS role_priority
          FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=$1`, [userId]);
        if (!ur.rows[0]) return jsonError('Участник не найден.', 404);
        const roles = await getRolesForUsers([userId]);
        const r = await query<Record<string, unknown>>(`SELECT rp.id, rp.reason, rp.type, rp.created_at, rp.converted, rp.auto_generated,
          ib.nickname AS issued_by_nickname FROM reprimands rp LEFT JOIN users ib ON ib.id=rp.issued_by
          WHERE rp.user_id=$1 ORDER BY rp.created_at DESC`, [userId]);
        return NextResponse.json({
          user: { ...ur.rows[0], roles: roles.get(userId) || [], tier: tierForPriority(ur.rows[0].role_priority as number) },
          reprimands: active(r.rows),
          limits: LIMITS_PAYLOAD,
        });
      }
      if (key === 'reprimands-unblock') {
        const u = await required(REPRIMANDS_ROLES); if (u instanceof NextResponse) return u;
        await query('UPDATE users SET is_blocked=FALSE, blocked_at=NULL WHERE id=$1', [id(p.userId)]);
        invalidateUserCache(p.userId);
        return ok();
      }
      if (key === 'reprimand' && method === 'DELETE') {
        const u = await required(REPRIMANDS_ROLES); if (u instanceof NextResponse) return u;
        const { rows } = await query<{ user_id: number; type: string; auto_generated: boolean }>(
          'SELECT user_id, type, auto_generated FROM reprimands WHERE id=$1', [id(p.id)]);
        const target = rows[0];
        if (target?.auto_generated && target.type === 'strict') {
          await query('UPDATE reprimands SET converted=FALSE WHERE merged_into=$1', [id(p.id)]);
        }
        await query('DELETE FROM reprimands WHERE id=$1', [id(p.id)]);
        if (target) { await syncBlockStatus(target.user_id); invalidateUserCache(target.user_id); }
        return ok();
      }
      const u = await required(REPRIMANDS_ROLES); if (u instanceof NextResponse) return u;
      if (method === 'GET') {
        const r = await query<Record<string, unknown>>(`SELECT rp.id, rp.reason, rp.type, rp.created_at, rp.converted, rp.auto_generated,
          u.id AS user_id, u.nickname AS user_nickname, u.avatar_image_id, u.avatar_url, u.is_blocked, u.blocked_at,
          rr.name AS role_name, rr.priority AS role_priority, ib.nickname AS issued_by_nickname
          FROM reprimands rp JOIN users u ON u.id=rp.user_id LEFT JOIN roles rr ON rr.id=u.role_id
          LEFT JOIN users ib ON ib.id=rp.issued_by ORDER BY rp.created_at DESC`);
        const members = await query<Record<string, unknown>>(`SELECT u.id, u.nickname, u.is_blocked,
          r.name AS role_name, r.priority AS role_priority FROM users u LEFT JOIN roles r ON r.id=u.role_id
          WHERE u.status='member' OR u.role_id IS NOT NULL ORDER BY u.nickname`);
        return NextResponse.json({ reprimands: active(r.rows), members: members.rows, limits: LIMITS_PAYLOAD });
      }
      const userId = Number(b.userId);
      const reason = String(b.reason || '').trim();
      let type = String(b.type || '').trim();
      if (!userId || !reason) return jsonError('Укажите участника и причину.', 400);
      const target = await query<{ id: number; is_blocked: boolean; role_priority: number | null }>(
        `SELECT u.id, u.is_blocked, r.priority AS role_priority FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=$1`, [userId]);
      if (!target.rows[0]) return jsonError('Участник не найден.', 404);
      if (target.rows[0].is_blocked) return jsonError('Участник уже заблокирован.', 400);
      const targetPriority = target.rows[0].role_priority;
      if (!u.is_owner && u.role_priority != null && targetPriority != null && targetPriority < u.role_priority) {
        return jsonError('Нельзя выдать выговор сотруднику выше по иерархии.', 403);
      }
      const tier = tierForPriority(targetPriority);
      if (tier === 'admin') {
        type = 'point';
        const cnt = await query<{ c: number }>(
          `SELECT COUNT(*)::int AS c FROM reprimands WHERE user_id=$1 AND type='point' AND created_at > now() - make_interval(days => $2)`,
          [userId, ADMIN_POINT_DECAY_DAYS]);
        if (cnt.rows[0].c >= ADMIN_POINT_LIMIT) return jsonError('Лимит баллов администратора исчерпан.', 400);
        await query('INSERT INTO reprimands(user_id,reason,type,issued_by) VALUES($1,$2,$3,$4)', [userId, reason, type, u.id]);
      } else {
        if (type !== 'verbal' && type !== 'strict') return jsonError('Тип выговора: verbal или strict.', 400);
        const all = await query<{ type: string; converted: boolean }>('SELECT type, converted FROM reprimands WHERE user_id=$1', [userId]);
        if (helperActivePoints(all.rows) >= HELPER_BLOCK_POINTS) return jsonError('Участник уже набрал лимит баллов.', 400);
        await query('INSERT INTO reprimands(user_id,reason,type,issued_by) VALUES($1,$2,$3,$4)', [userId, reason, type, u.id]);
        if (type === 'verbal') await maybeConvertVerbalToStrict(userId, u.id);
      }
      const status = await syncBlockStatus(userId);
      invalidateUserCache(userId);
      return ok({ blocked: status?.blocked });
    }

    if (key.startsWith('application') || key === 'candidates') {
      async function releaseCandidate(userId: number | null) {
        if (!userId) return;
        const { rows } = await query<{ discord_username: string | null; login: string | null }>(
          'SELECT discord_username, login FROM users WHERE id=$1', [userId]);
        if (!rows[0]) return;
        if (!rows[0].discord_username && !rows[0].login) await query('DELETE FROM users WHERE id=$1', [userId]);
        else await query(`UPDATE users SET status='member' WHERE id=$1`, [userId]);
      }
      async function notifyDiscord(text: string) {
        const url = process.env.APPLICATIONS_WEBHOOK_URL;
        if (!url) return;
        try {
          await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text }), signal: AbortSignal.timeout(8_000) });
        } catch { /* ignore */ }
      }
      if (key === 'candidates') {
        const u = await required(CANDIDATES_ROLES); if (u instanceof NextResponse) return u;
        const r = await query(`SELECT a.id, a.applicant_name, a.discord, a.nickname_static, a.status, a.created_at, a.candidate_user_id
          FROM applications a WHERE a.status='approved' ORDER BY a.created_at ASC`);
        return NextResponse.json({ candidates: r.rows });
      }
      if (key === 'application-call') {
        const u = await required(CANDIDATES_ROLES); if (u instanceof NextResponse) return u;
        const passed = b.passed === true || b.passed === 'true';
        const { rows } = await query<Record<string, unknown>>('SELECT * FROM applications WHERE id=$1', [id(p.id)]);
        const application = rows[0];
        if (!application) return jsonError('Заявка не найдена.', 404);
        if (application.status !== 'approved') return jsonError('Обзвон доступен только для одобренных заявок.', 400);
        if (passed) {
          if (application.candidate_user_id) {
            await query(`UPDATE users SET status='member' WHERE id=$1`, [application.candidate_user_id]);
            await addUserRole(application.candidate_user_id as number, 'Mini Event Helper');
          }
          await query(`UPDATE applications SET status='call_passed' WHERE id=$1`, [id(p.id)]);
        } else {
          await releaseCandidate(application.candidate_user_id as number | null);
          await query(`UPDATE applications SET status='call_failed', candidate_user_id=NULL WHERE id=$1`, [id(p.id)]);
        }
        return ok({ passed });
      }
      if (key === 'application' && method === 'DELETE') {
        const u = await required(APPLICATIONS_ROLES); if (u instanceof NextResponse) return u;
        const { rows } = await query<{ status: string; candidate_user_id: number | null }>(
          'SELECT status, candidate_user_id FROM applications WHERE id=$1', [id(p.id)]);
        if (!rows[0]) return jsonError('Заявка не найдена.', 404);
        await releaseCandidate(rows[0].candidate_user_id);
        await query('DELETE FROM applications WHERE id=$1', [id(p.id)]);
        return ok();
      }
      if (key === 'application' && method === 'PUT') {
        const u = await required(APPLICATIONS_ROLES); if (u instanceof NextResponse) return u;
        const status = String(b.status || '');
        if (!['pending', 'approved', 'rejected'].includes(status)) return jsonError('Некорректный статус.', 400);
        const { rows: appRows } = await query<Record<string, unknown>>('SELECT * FROM applications WHERE id=$1', [id(p.id)]);
        const application = appRows[0];
        if (!application) return jsonError('Заявка не найдена.', 404);
        let candidateId = (application.candidate_user_id || application.applicant_id) as number | null;
        if (status === 'approved') {
          const discordId = String(application.discord || '');
          if (!candidateId && discordId) {
            const existing = await query<{ id: number }>('SELECT id FROM users WHERE discord_id=$1', [discordId]);
            if (existing.rows[0]) candidateId = existing.rows[0].id;
            else {
              const nu = await query<{ id: number }>(
                `INSERT INTO users (nickname, status, discord_id) VALUES ($1,'candidate',$2) RETURNING id`,
                [application.nickname_static || application.applicant_name || discordId, discordId]);
              candidateId = nu.rows[0].id;
            }
          }
          if (candidateId) await query(`UPDATE users SET status='candidate' WHERE id=$1`, [candidateId]);
          await query('UPDATE applications SET status=$1, reviewed_by=$2, candidate_user_id=$3 WHERE id=$4',
            [status, u.id, candidateId, id(p.id)]);
          await notifyDiscord(`Заявка #${p.id} одобрена. Discord: ${application.discord}`);
        } else {
          if (application.candidate_user_id) await releaseCandidate(application.candidate_user_id as number);
          await query('UPDATE applications SET status=$1, reviewed_by=$2, candidate_user_id=NULL WHERE id=$3',
            [status, u.id, id(p.id)]);
        }
        return ok({ status });
      }
      if (method === 'GET') {
        const u = await required(APPLICATIONS_ROLES); if (u instanceof NextResponse) return u;
        const r = await query('SELECT * FROM applications ORDER BY created_at DESC');
        const s = await query<{ is_open: boolean }>('SELECT is_open FROM applications_settings WHERE id=1');
        return NextResponse.json({ applications: r.rows, isOpen: s.rows[0]?.is_open ?? true });
      }
      // POST public application — needs Discord session, not role
      {
        const user = await getCurrentUser();
        if (!user?.discord_id) return jsonError('Для подачи заявки войдите через Discord.', 401);
        const settings = await query<{ is_open: boolean }>('SELECT is_open FROM applications_settings WHERE id=1');
        if (settings.rows[0] && settings.rows[0].is_open === false) return jsonError('Набор сейчас закрыт.', 403);
        const fields = {
          nicknameStatic: String(b.nicknameStatic || '').trim(),
          age: String(b.age || '').trim(),
          avgOnline: String(b.avgOnline || '').trim(),
          timePeriod: String(b.timePeriod || '').trim(),
          experience: String(b.experience || '').trim(),
          ideas: String(b.ideas || '').trim(),
          motivation: String(b.motivation || '').trim(),
        };
        if (Object.values(fields).some((v) => !v)) return jsonError('Заполните все поля анкеты.', 400);
        if (!(b.consent === true || b.consent === 'true')) return jsonError('Нужно согласие на обработку персональных данных.', 400);
        const pending = await query('SELECT id FROM applications WHERE status=$1 AND discord=$2 LIMIT 1', ['pending', user.discord_id]);
        if (pending.rows[0]) return jsonError('У вас уже есть заявка на рассмотрении.', 400);
        const r = await query<{ id: number }>(
          `INSERT INTO applications (applicant_id, applicant_name, discord, nickname_static, age, avg_online, time_period, experience, ideas, motivation)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [user.id, fields.nicknameStatic || user.discord_username || user.discord_id, user.discord_id,
            fields.nicknameStatic, fields.age, fields.avgOnline, fields.timePeriod, fields.experience, fields.ideas, fields.motivation]);
        await notifyDiscord(`Новая заявка #${r.rows[0].id} от ${user.discord_username || user.discord_id}`);
        return ok({ id: r.rows[0].id });
      }
    }

    if (key === 'owner-users' || key === 'owner-user') {
      const u = await required(OWNER_PANEL_ROLES); if (u instanceof NextResponse) return u;
      if (key === 'owner-users' && method === 'GET') {
        const r = await query<Record<string, unknown>>(`SELECT u.id, u.discord_id, u.nickname, u.discord_username, u.is_owner, u.is_admin,
          u.weekly_events, u.role_id, rr.name AS role_name, u.created_at
          FROM users u LEFT JOIN roles rr ON rr.id=u.role_id ORDER BY u.created_at ASC`);
        const rolesMap = await getRolesForUsers(r.rows.map((x) => x.id as number));
        const roleRows = await query('SELECT id, name, priority FROM roles ORDER BY priority ASC');
        return NextResponse.json({
          users: r.rows.map((x) => ({ ...x, roles: rolesMap.get(x.id as number) || [] })),
          roles: roleRows.rows,
        });
      }
      if (method === 'DELETE') {
        if (String(u.id) === String(p.id)) return jsonError('Нельзя удалить самого себя.', 400);
        await query('DELETE FROM users WHERE id=$1', [id(p.id)]);
        invalidateUserCache(p.id);
        return ok();
      }
      const fields: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (typeof b.nickname === 'string' && b.nickname.trim()) { fields.push(`nickname=$${i++}`); values.push(b.nickname.trim()); }
      if (typeof b.isAdmin === 'boolean') { fields.push(`is_admin=$${i++}`); values.push(b.isAdmin); }
      if (typeof b.isOwner === 'boolean') { fields.push(`is_owner=$${i++}`); values.push(b.isOwner); }
      if (fields.length) {
        values.push(id(p.id));
        await query(`UPDATE users SET ${fields.join(', ')} WHERE id=$${i}`, values);
      }
      if (Array.isArray(b.roleIds)) await replaceUserRoles(id(p.id), b.roleIds as number[]);
      invalidateUserCache(p.id);
      return ok();
    }

    return jsonError('Маршрут ещё не реализован.', 501);
  } catch (error) { console.error(`[api:${key}]`, error); return jsonError('Внутренняя ошибка сервера.', 500); }
}
