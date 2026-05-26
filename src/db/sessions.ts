import { supabaseAdmin } from './client';

export async function validateSessionOwnership(sessionId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from('career_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .single();
  return data;
}

export async function updateSession(sessionId: string, userId: string, patch: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin
    .from('career_sessions')
    .update(patch)
    .eq('id', sessionId)
    .eq('user_id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
