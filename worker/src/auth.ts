import type { Ctx } from './context';

export interface AuthUser {
  id: string;
  email?: string;
}

/** Resolve the signed-in user from the Authorization header (Supabase JWT). Implemented in M7. */
export async function resolveUser(_ctx: Ctx): Promise<AuthUser | undefined> {
  return undefined;
}
