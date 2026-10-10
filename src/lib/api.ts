import { useCallback, useEffect, useState } from "react";

export const PROTOCOLS = {
  "anthropic-messages": "Anthropic Messages",
  "openai-completions": "OpenAI Chat Completions",
  "openai-responses": "OpenAI Responses",
  "google-generative-ai": "Google Gemini",
} as const;

export type Protocol = keyof typeof PROTOCOLS;

export interface ModelConfig {
  id: string;
  name: string;
  protocol: Protocol;
  upstream: string;
  modelId: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

export interface FeatureFlag {
  key: string;
  label: string;
  since?: string;
  enabled: boolean;
}

export interface LocalInstall {
  bin: string;
  version?: string;
  source: "path" | "petri";
}

export interface AgentAdapterInfo {
  id: string;
  name: string;
  npmPackage?: string;
  features: FeatureFlag[];
  installs: LocalInstall[];
}

export interface AgentOverride {
  bin?: string;
}

export interface TaskConfig {
  id: string;
  name: string;
  prompt: string;
  workdir: string;
}

export interface PetriConfig {
  models: ModelConfig[];
  agents: Record<string, AgentOverride>;
  tasks: TaskConfig[];
}

export interface RequestMeta {
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
  summary?: string[];
  reqHeaders?: Record<string, string>;
  respHeaders?: Record<string, string>;
}

export interface Run {
  id: string;
  name: string;
  taskId: string;
  taskName?: string;
  agentId: string;
  agentVersion?: string;
  modelId: string;
  modelName?: string;
  flags: Record<string, boolean>;
  executor?: string;
  status: "pending" | "running" | "done" | "failed" | "stopped";
  workdir: string;
  createdAt: string;
  finishedAt?: string;
  exitCode?: number;
  error?: string;
  requestCount?: number;
  requests?: RequestMeta[];
}

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

export const api = {
  config: () => fetch("/api/config").then((r) => j<PetriConfig>(r)),
  saveConfig: (c: PetriConfig) =>
    fetch("/api/config", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(c) }).then((r) => j<{ ok: boolean }>(r)),
  runs: () => fetch("/api/runs").then((r) => j<Run[]>(r)),
  run: (id: string) => fetch(`/api/runs/${id}`).then((r) => j<Run>(r)),
  agents: () => fetch("/api/agents").then((r) => j<AgentAdapterInfo[]>(r)),
  checkBin: (bin: string) =>
    fetch("/api/agents/check-bin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bin }) })
      .then((r) => j<{ ok: boolean; resolved?: string; version?: string; error?: string }>(r)),
  pickBin: () =>
    fetch("/api/agents/pick-bin", { method: "POST" })
      .then((r) => j<{ cancelled?: boolean; ok?: boolean; resolved?: string; version?: string; error?: string }>(r)),
  agentVersions: () => fetch("/api/agent-versions").then((r) => j<Record<string, { latest: string; versions: string[] }>>(r)),
  createRun: (p: { taskId: string; agentId: string; agentVersion?: string; modelId: string; flags: Record<string, boolean>; executor?: string }) =>
    fetch("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p) }).then((r) => j<Run>(r)),
  stopRun: (id: string) => fetch(`/api/runs/${id}/stop`, { method: "POST" }).then((r) => j<{ ok: boolean }>(r)),
  deleteRun: (id: string) => fetch(`/api/runs/${id}`, { method: "DELETE" }).then((r) => j<{ ok: boolean }>(r)),
  body: async (runId: string, seq: number, side: "req" | "resp", assembled = false): Promise<string | null> => {
    const q = assembled ? "&assembled=1" : "";
    const r = await fetch(`/api/runs/${runId}/requests/${seq}/body?side=${side}${q}`);
    return r.ok ? r.text() : null;
  },
};

export function useConfig() {
  const [cfg, setCfg] = useState<PetriConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refresh = useCallback(() => {
    api.config().then(setCfg).catch((e) => setErr(String(e)));
  }, []);
  useEffect(refresh, [refresh]);
  const save = useCallback(
    async (next: PetriConfig) => {
      await api.saveConfig(next);
      setCfg(next);
    },
    [],
  );
  return { cfg, err, refresh, save };
}

export function useAgents() {
  const [agents, setAgents] = useState<AgentAdapterInfo[]>([]);
  useEffect(() => {
    api.agents().then(setAgents).catch(() => {});
  }, []);
  return agents;
}

export function useRuns() {
  const [runs, setRuns] = useState<Run[]>([]);
  const refresh = useCallback(() => {
    api.runs().then(setRuns).catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    const es = new EventSource("/api/events");
    es.addEventListener("run", refresh);
    es.addEventListener("request", refresh);
    return () => es.close();
  }, [refresh]);
  return { runs, refresh };
}

export function useRun(id: string) {
  const [run, setRun] = useState<Run | null>(null);
  const refresh = useCallback(() => {
    if (!id) {
      setRun(null);
      return;
    }
    api.run(id).then(setRun).catch(() => {});
  }, [id]);
  useEffect(() => {
    if (!id) {
      setRun(null);
      return;
    }
    setRun(null);
    refresh();
    const es = new EventSource("/api/events");
    const onAny = (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data as string) as { runId?: string };
        if (d.runId === id) refresh();
      } catch { /* ignore */ }
    };
    es.addEventListener("run", onAny);
    es.addEventListener("request", onAny);
    return () => es.close();
  }, [id, refresh]);
  return { run, refresh };
}

export function useBodies(runId: string, seq: number | null) {
  const [bodies, setBodies] = useState<{ req: string | null; resp: string | null; assembled: string | null }>({
    req: null, resp: null, assembled: null,
  });
  useEffect(() => {
    if (seq === null) return;
    let alive = true;
    setBodies({ req: null, resp: null, assembled: null });
    Promise.all([
      api.body(runId, seq, "req"),
      api.body(runId, seq, "resp"),
      api.body(runId, seq, "resp", true),
    ]).then(([req, resp, assembled]) => {
      if (alive) setBodies({ req, resp, assembled });
    });
    return () => {
      alive = false;
    };
  }, [runId, seq]);
  return bodies;
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
