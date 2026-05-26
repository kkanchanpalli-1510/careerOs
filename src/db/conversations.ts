import { supabaseAdmin } from './client';

interface Message { role: 'user' | 'assistant'; content: string; timestamp: string }

export async function appendNodeMessages(
  sessionId: string, nodeId: string, userId: string,
  userMsg: string, assistantMsg: string
) {
  const { data: existing } = await supabaseAdmin
    .from('node_conversations')
    .select('*')
    .eq('session_id', sessionId)
    .eq('node_id', nodeId)
    .eq('user_id', userId)
    .single();

  const now = new Date().toISOString();
  const newMessages: Message[] = [
    { role: 'user', content: userMsg, timestamp: now },
    { role: 'assistant', content: assistantMsg, timestamp: now },
  ];

  const WINDOW = 6;
  const current: Message[] = existing?.messages ?? [];
  const all = [...current, ...newMessages];

  let messages = all;
  let summary = existing?.summary ?? null;
  if (all.length > WINDOW) {
    const older = all.slice(0, all.length - WINDOW);
    const olderText = older.map(m => `${m.role}: ${m.content}`).join('\n');
    summary = existing?.summary ? `${existing.summary}\n${olderText}` : olderText;
    messages = all.slice(-WINDOW);
  }

  if (existing) {
    await supabaseAdmin
      .from('node_conversations')
      .update({ messages, summary, message_count: all.length })
      .eq('id', existing.id);
  } else {
    await supabaseAdmin
      .from('node_conversations')
      .insert({ session_id: sessionId, node_id: nodeId, user_id: userId, messages, message_count: all.length });
  }
}
