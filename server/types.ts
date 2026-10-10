export type Protocol =
  | "anthropic-messages"
  | "openai-responses"
  | "openai-completions"
  | "google-generative-ai";

export interface ModelConfig {
  id: string;
  name: string;
  protocol: Protocol;
  upstream: string; // e.g. https://api.anthropic.com
  modelId: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

export interface AgentFeature {
  key: string;
  label: string;
  since?: string;
  enabled: boolean;
}

// per-adapter overrides stored in config; the adapter list itself is built-in
export interface AgentOverride {
  bin?: string; // local executor only; docker images are built from the adapter's npm package
}

// agent resolved for execution: adapter + config overrides + run version
export interface ResolvedAgent {
  id: string;
  name: string;
  version: string;
  bin: string;
  features: AgentFeature[];
}

export interface TaskConfig {
  id: string;
  name: string;
  prompt: string;
  workdir: string; // local path or git repo path
}

export interface PetriConfig {
  models: ModelConfig[];
  agents: Record<string, AgentOverride>; // keyed by adapter id
  tasks: TaskConfig[];
}

export type RunStatus = "pending" | "running" | "done" | "failed" | "stopped";

export interface Run {
  id: string;
  name: string;
  taskId: string;
  taskName?: string; // snapshot at creation; survives config edits
  agentId: string;
  agentVersion?: string; // per-run override; defaults to the registered agent version
  modelId: string;
  modelName?: string; // snapshot of model.modelId at creation; survives config edits
  flags: Record<string, boolean>;
  executor?: string; // "local" | "docker"
  status: RunStatus;
  workdir: string;
  runDir: string;
  createdAt: string;
  finishedAt?: string;
  exitCode?: number;
  error?: string;
}

export interface CapturedRequestMeta {
  id: number;
  runId: string;
  seq: number;
  method: string;
  path: string;
  status?: number;
  durationMs?: number;
  streaming: boolean;
  startedAt: string;
  finishedAt?: string;
  reqHeaders: Record<string, string>;
  respHeaders?: Record<string, string>;
  summary?: string[];
}
