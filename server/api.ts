import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig, saveConfig } from "./config.ts";
import * as store from "./store.ts";
import { executors, runDirFor } from "./executor.ts";
import { publish } from "./events.ts";
import { adapters } from "./agents.ts";
import { checkBin, detectInstalls, pickFile } from "./detect.ts";
import type { Run } from "./types.ts";

function json(res: ServerResponse, code: number, data: unknown): void {
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(data));
}

export interface AgentVersions {
  latest: string;
  versions: string[]; // newest first
}

let versionsCache: { at: number; data: Record<string, AgentVersions> } | null = null;

function semverDesc(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((s) => parseInt(s, 10));
  const pb = b.split(/[.-]/).map((s) => parseInt(s, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

const MAX_LISTED_VERSIONS = 50;

async function latestAgentVersions(): Promise<Record<string, AgentVersions>> {
  if (versionsCache && Date.now() - versionsCache.at < 5 * 60_000) return versionsCache.data;
  const data: Record<string, AgentVersions> = {};
  await Promise.all(
    Object.values(adapters).map(async (a) => {
      if (!a.npmPackage) return;
      try {
        const r = await fetch(`https://registry.npmjs.org/${a.npmPackage.replace("/", "%2f")}`, {
          headers: { accept: "application/vnd.npm.install-v1+json" },
          signal: AbortSignal.timeout(8000),
        });
        const j = (await r.json()) as { "dist-tags"?: { latest?: string }; versions?: Record<string, unknown> };
        const versions = Object.keys(j.versions ?? {})
          .filter((v) => !v.includes("-")) // skip prerelease/platform variants like 0.162.0-alpha.18-darwin-arm64
          .sort(semverDesc)
          .slice(0, MAX_LISTED_VERSIONS);
        const latest = j["dist-tags"]?.latest ?? versions[0];
        if (latest) data[a.id] = { latest, versions: versions.length ? versions : [latest] };
      } catch { /* offline or registry error: omit */ }
    }),
  );
  versionsCache = { at: Date.now(), data };
  return data;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const path = url.pathname;
  const m = (re: RegExp) => path.match(re);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    res.end();
    return true;
  }

  if (req.method === "GET" && path === "/api/config") {
    json(res, 200, loadConfig());
    return true;
  }
  if (req.method === "PUT" && path === "/api/config") {
    const body = await readJson(req);
    saveConfig(body as never);
    json(res, 200, { ok: true });
    return true;
  }

  if (req.method === "GET" && path === "/api/agents") {
    json(res, 200, Object.values(adapters).map((a) => ({
      id: a.id, name: a.name, npmPackage: a.npmPackage, features: a.features ?? [], installs: detectInstalls(a.id),
    })));
    return true;
  }

  if (req.method === "POST" && path === "/api/agents/check-bin") {
    const body = await readJson(req);
    json(res, 200, typeof body.bin === "string" && body.bin.trim() ? checkBin(body.bin.trim()) : { ok: false, error: "empty" });
    return true;
  }

  if (req.method === "POST" && path === "/api/agents/pick-bin") {
    try {
      const path = await pickFile();
      json(res, 200, path === null ? { cancelled: true } : { cancelled: false, ...checkBin(path) });
    } catch (err) {
      json(res, 200, { cancelled: false, ok: false, error: String(err) });
    }
    return true;
  }

  if (req.method === "GET" && path === "/api/agent-versions") {
    json(res, 200, await latestAgentVersions());
    return true;
  }

  if (req.method === "GET" && path === "/api/runs") {
    json(res, 200, store.listRuns());
    return true;
  }

  if (req.method === "POST" && path === "/api/runs") {
    const body = await readJson(req);
    const cfg = loadConfig();
    const task = cfg.tasks.find((t) => t.id === body.taskId);
    const agent = typeof body.agentId === "string" ? adapters[body.agentId] : undefined;
    const model = cfg.models.find((mo) => mo.id === body.modelId);
    if (!task || !agent || !model) {
      json(res, 400, { error: "taskId/agentId/modelId must reference configured entries" });
      return true;
    }
    const id = store.newRunId();
    const run: Run = {
      id,
      name: `${agent.name} / ${model.modelId}`,
      taskId: task.id,
      taskName: task.name,
      agentId: agent.id,
      agentVersion: typeof body.agentVersion === "string" && body.agentVersion.trim() ? body.agentVersion.trim() : "latest",
      modelId: model.id,
      modelName: model.modelId,
      flags: (body.flags as Record<string, boolean>) ?? {},
      executor: typeof body.executor === "string" && executors[body.executor] ? body.executor : "local",
      status: "pending",
      workdir: task.workdir,
      runDir: runDirFor(id),
      createdAt: new Date().toISOString(),
    };
    store.createRun(run);
    if (body.manual === true) {
      json(res, 200, run);
      return true;
    }
    void executors[run.executor ?? "local"].start(run);
    json(res, 200, run);
    return true;
  }

  let mm = m(/^\/api\/runs\/([^/]+)$/);
  if (mm && req.method === "GET") {
    const run = store.getRun(mm[1]);
    if (!run) {
      json(res, 404, { error: "not found" });
      return true;
    }
    json(res, 200, { ...run, requests: store.listRequests(run.id) });
    return true;
  }
  if (mm && req.method === "DELETE") {
    const run = store.getRun(mm[1]);
    if (!run) {
      json(res, 404, { error: "not found" });
      return true;
    }
    if (run.status === "running" || run.status === "pending") {
      json(res, 409, { error: "stop the run before deleting it" });
      return true;
    }
    store.deleteRun(run);
    publish("run", { runId: run.id, deleted: true });
    json(res, 200, { ok: true });
    return true;
  }

  mm = m(/^\/api\/runs\/([^/]+)\/stop$/);
  if (mm && req.method === "POST") {
    const run = store.getRun(mm[1]);
    await (executors[run?.executor ?? "local"] ?? executors.local).stop(mm[1]);
    json(res, 200, { ok: true });
    return true;
  }

  mm = m(/^\/api\/runs\/([^/]+)\/requests\/(\d+)\/body$/);
  if (mm && req.method === "GET") {
    const side = url.searchParams.get("side") === "resp" ? "resp" : "req";
    const requests = store.listRequests(mm[1]);
    const r = requests.find((x) => x.seq === Number(mm[2]));
    let p = side === "resp" ? r?.respBodyPath : r?.reqBodyPath;
    if (side === "resp" && url.searchParams.get("assembled") === "1" && p) {
      p = p.replace(/\.bin$/, ".json");
    }
    const body = p ? store.readBody(p) : null;
    if (!body) {
      json(res, 404, { error: "no body" });
      return true;
    }
    res.writeHead(200, { "content-type": "application/octet-stream", "access-control-allow-origin": "*" });
    res.end(body);
    return true;
  }

  return false;
}

export function agentCapabilities(): string[] {
  return Object.keys(adapters);
}
