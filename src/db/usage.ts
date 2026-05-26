import { supabaseAdmin } from './client';

const INPUT_COST  = 0.000003;   // $3/1M tokens (Sonnet 4)
const OUTPUT_COST = 0.000015;   // $15/1M tokens

export async function logUsage(p: {
  userId: string; sessionId?: string; taskType: string;
  promptTokens?: number; completionTokens?: number; estimatedTokens?: number;
}) {
  const costCents = p.promptTokens !== undefined && p.completionTokens !== undefined
    ? Math.ceil((p.promptTokens * INPUT_COST + p.completionTokens * OUTPUT_COST) * 100)
    : undefined;

  await supabaseAdmin.from('usage_logs').insert({
    user_id: p.userId,
    session_id: p.sessionId ?? null,
    task_type: p.taskType,
    prompt_tokens: p.promptTokens ?? null,
    completion_tokens: p.completionTokens ?? null,
    total_tokens: p.promptTokens !== undefined && p.completionTokens !== undefined
      ? p.promptTokens + p.completionTokens : p.estimatedTokens ?? null,
    estimated_cost_cents: costCents ?? null,
  });
}

export async function checkRateLimit(userId: string, taskType: string): Promise<boolean> {
  const limits: Record<string, number> = {
    graph_extraction: 3, insight_generation: 5, branch_generation: 10,
    gap_enrichment: 50, final_synthesis: 5, node_chat: 100, resume_projection: 20,
  };
  const limit = limits[taskType];
  if (!limit) return true;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabaseAdmin
    .from('usage_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('task_type', taskType)
    .gte('created_at', since);

  return (count ?? 0) < limit;
}
