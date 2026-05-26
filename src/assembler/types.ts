export type NodeType = 'role' | 'skill' | 'project' | 'outcome' | 'decision';
export type RelationType = 'USED' | 'LED_TO' | 'DEMONSTRATED' | 'REQUIRED' | 'INFLUENCED' | 'BUILT_ON';
export type TaskType =
  | 'graph_extraction'
  | 'insight_generation'
  | 'branch_generation'
  | 'gap_enrichment'
  | 'final_synthesis'
  | 'node_chat'
  | 'resume_projection'
  | 'career_summary_generation';

export interface Node {
  id: string;
  type: NodeType;
  label: string;
  detail: string;
  year: string | null;
  weight: 1 | 2 | 3;
}

export interface Edge {
  source: string;
  target: string;
  relation: RelationType;
}

export interface CareerGraph {
  nodes: Node[];
  edges: Edge[];
}

export interface Branch {
  title: string;
  description: string;
  timeline: string;
  type: 'immediate' | 'emerging' | 'nonobvious';
}

export interface SessionInsights {
  strength?: string;
  branches?: Branch[];
  portrait?: Record<string, string>;
  projection?: Record<string, unknown>;
}

export interface AssemblerInput {
  user_id: string;
  task: TaskType;
  params: Record<string, unknown>;
}

export interface PromptPackage {
  system: string;
  user_context: string;
  task_prompt: string;
  estimated_tokens: number;
  cache_key: string;
  metadata: {
    nodes_selected: number;
    node_ids_selected: string[];
    truncated: boolean;
    summary_version: number;
  };
}
