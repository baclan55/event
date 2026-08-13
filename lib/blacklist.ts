import { query } from '@/lib/db';
export { isValidStaticId } from '@/lib/staticId';

export type BlacklistHit = {
  id: number;
  reason: string;
};

export async function findBlacklistMatch(input: {
  userId?: number | null;
  discordId?: string | null;
  staticId?: string | null;
}): Promise<BlacklistHit | null> {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (input.userId != null) {
    values.push(input.userId);
    clauses.push(`user_id = $${values.length}`);
  }
  if (input.discordId) {
    values.push(String(input.discordId).trim());
    clauses.push(`discord_id = $${values.length}`);
  }
  if (input.staticId) {
    values.push(String(input.staticId).trim());
    clauses.push(`static_id = $${values.length}`);
  }
  if (!clauses.length) return null;
  try {
    const result = await query<BlacklistHit>(
      `SELECT id, reason FROM blacklist WHERE ${clauses.join(' OR ')} ORDER BY id ASC LIMIT 1`,
      values,
    );
    return result.rows[0] || null;
  } catch (error) {
    if ((error as { code?: string }).code === '42P01') return null;
    throw error;
  }
}
