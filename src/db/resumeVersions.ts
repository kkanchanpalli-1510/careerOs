import { supabaseAdmin } from './client';

export interface ResumeVersion {
  id: string;
  user_id: string;
  session_id: string | null;
  name: string;
  snapshot: Record<string, unknown>;
  created_at: string;
}

export type ResumeVersionMeta = Omit<ResumeVersion, 'snapshot'>;

export async function saveResumeVersion(
  userId: string,
  sessionId: string,
  name: string,
  snapshot: Record<string, unknown>,
): Promise<ResumeVersion | null> {
  const { data, error } = await supabaseAdmin
    .from('resume_versions')
    .insert({ user_id: userId, session_id: sessionId, name, snapshot })
    .select()
    .single();
  if (error) {
    console.error('[resume_versions] save:', error.message);
    return null;
  }
  return data as ResumeVersion;
}

export async function listResumeVersions(userId: string): Promise<ResumeVersionMeta[]> {
  const { data, error } = await supabaseAdmin
    .from('resume_versions')
    .select('id, user_id, session_id, name, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    console.error('[resume_versions] list:', error.message);
    return [];
  }
  return (data ?? []) as ResumeVersionMeta[];
}

export async function getResumeVersion(id: string, userId: string): Promise<ResumeVersion | null> {
  const { data } = await supabaseAdmin
    .from('resume_versions')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single();
  return (data as ResumeVersion) ?? null;
}

export async function renameResumeVersion(id: string, userId: string, name: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('resume_versions')
    .update({ name: name.trim() || 'Resume' })
    .eq('id', id)
    .eq('user_id', userId);
  if (error) {
    console.error('[resume_versions] rename:', error.message);
    return false;
  }
  return true;
}

export async function deleteResumeVersion(id: string, userId: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('resume_versions')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  return !error;
}
