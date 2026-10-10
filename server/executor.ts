import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { PETRI_HOME, loadConfig } from "./config.ts";
import * as store from "./store.ts";
import { publish } from "./events.ts";
import { adapters } from "./agents.ts";
import type { ResolvedAgent, ModelConfig, Run, TaskConfig } from "./types.ts";

export interface Executor {
  start(run: Run): Promise<void>;
  stop(runId: string): Promise<void>;
}

export const PORT = Number(process.env.PETRI_PORT ?? 8787);
const HOST_PROXY = `http://host.docker.internal:${PORT}`;
const LOCAL_PROXY = `http://127.0.0.1:${PORT}`;

export function runDirFor(runId: string): string {
  return join(PETRI_HOME, "runs", runId);
}

function prepareWorkdir(runDir: string, task: TaskConfig): string {
  const work = join(runDir, "work");
  const src = task.workdir;
  if (src && existsSync(src)) {
    try {
      execFileSync("git", ["-C", src, "worktree", "add", "--detach", work], { stdio: "pipe" });
      return work;
    } catch {
      cpSync(src, work, { recursive: true });
      return work;
    }
  }
  mkdirSync(work, { recursive: true });
  return work;
}

interface RunContext {
  task: TaskConfig;
  agent: ResolvedAgent;
  model: ModelConfig;
  adapterId: string;
}

function resolveRun(run: Run): RunContext | { error: string } {
  const cfg = loadConfig();
  const task = cfg.tasks.find((t) => t.id === run.taskId);
  const adapter = adapters[run.agentId];
  const model = cfg.models.find((m) => m.id === run.modelId);
  if (!task || !adapter || !model) return { error: "missing task/agent/model config" };
  const o = cfg.agents[run.agentId] ?? {};
  const agent: ResolvedAgent = {
    id: adapter.id,
    name: adapter.name,
    version: run.agentVersion && run.agentVersion !== "?" ? run.agentVersion : "latest",
    bin: o.bin ?? "",
    features: adapter.features ?? [],
  };
  return { task, agent, model, adapterId: adapter.id };
}

function watchChild(runId: string, child: ReturnType<typeof spawn>, logPath: string): void {
  const onData = (chunk: Buffer) => appendFileSync(logPath, chunk);
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  child.on("exit", (code, signal) => {
    children.delete(runId);
    const ok = code === 0;
    store.updateRunStatus(runId, ok ? "done" : "failed", {
      exitCode: code ?? undefined,
      error: ok ? undefined : `exit code ${code}${signal ? ` signal ${signal}` : ""}`,
    });
    publish("run", { runId, status: ok ? "done" : "failed", exitCode: code });
  });
  child.on("error", (err) => {
    children.delete(runId);
    store.updateRunStatus(runId, "failed", { error: err.message });
    publish("run", { runId, status: "failed", error: err.message });
  });
}

const children = new Map<string, ReturnType<typeof spawn>>();

// Petri-managed local install: ~/.petri/agents/<id>/<version>/bin/<bin>
function ensureLocalInstall(adapterId: string, version: string): string {
  const adapter = adapters[adapterId];
  if (!adapter.npmPackage) throw new Error(`no npmPackage for agent ${adapterId}; cannot install`);
  if (version === "latest") {
    version = execFileSync("npm", ["view", adapter.npmPackage, "version"], { encoding: "utf8" }).trim();
  }
  const dir = join(PETRI_HOME, "agents", adapterId, version);
  const binDir = join(dir, "bin");
  const binPath = join(binDir, adapterId);
  if (existsSync(binPath)) return binPath;

  mkdirSync(dir, { recursive: true });
  execFileSync("npm", ["install", "-g", "--prefix", dir, `${adapter.npmPackage}@${version}`], { stdio: "inherit" });

  // bin name comes from the package, not necessarily the adapter id
  const pkgJson = join(dir, "lib", "node_modules", adapter.npmPackage, "package.json");
  if (existsSync(pkgJson)) {
    const b = (JSON.parse(readFileSync(pkgJson, "utf8")) as { bin?: string | Record<string, string> }).bin;
    const name = typeof b === "string" ? adapterId : b ? Object.keys(b)[0] : adapterId;
    const p = join(binDir, name);
    if (existsSync(p)) return p;
  }
  if (existsSync(binPath)) return binPath;
  throw new Error(`installed ${adapter.npmPackage}@${version} but found no bin in ${binDir}`);
}

export const localExecutor: Executor = {
  async start(run) {
    const ctx = resolveRun(run);
    if ("error" in ctx) {
      store.updateRunStatus(run.id, "failed", { error: ctx.error });
      return;
    }
    const adapter = adapters[ctx.adapterId];
    let bin = ctx.agent.bin;
    if (!bin) {
      try {
        bin = ensureLocalInstall(ctx.adapterId, ctx.agent.version);
      } catch (err) {
        store.updateRunStatus(run.id, "failed", { error: `install failed: ${String(err)}` });
        return;
      }
    }
    const homeDir = join(run.runDir, "home");
    mkdirSync(homeDir, { recursive: true });
    const workDir = prepareWorkdir(run.runDir, ctx.task);
    const plan = adapter.plan({
      run, task: ctx.task, model: ctx.model,
      bin,
      proxyBase: `${LOCAL_PROXY}/run/${run.id}/proxy`,
      workDir, homeDir, homePath: homeDir,
    });

    const logPath = join(run.runDir, "agent.log");
    writeFileSync(logPath, `$ ${plan.bin} ${plan.args.join(" ")}\n\n`);

    const child = spawn(plan.bin, plan.args, {
      cwd: plan.cwd,
      env: { ...process.env, HOME: homeDir, ...plan.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.set(run.id, child);
    store.setRunStatus(run.id, "running");
    publish("run", { runId: run.id, status: "running" });
    watchChild(run.id, child, logPath);
  },

  async stop(runId) {
    children.get(runId)?.kill("SIGTERM");
    store.updateRunStatus(runId, "stopped");
    publish("run", { runId, status: "stopped" });
  },
};

// ---------- docker executor ----------

function imageName(agent: ResolvedAgent): string {
  return `petri-agent-${agent.id}:${agent.version || "latest"}`;
}

function ensureImage(agent: ResolvedAgent, adapterId: string): string {
  const adapter = adapters[adapterId];
  const img = imageName(agent);
  try {
    execFileSync("docker", ["image", "inspect", img], { stdio: "pipe" });
    return img;
  } catch { /* build below */ }
  if (!adapter.npmPackage) throw new Error(`no npmPackage for agent ${adapterId}; cannot build image`);
  const version = agent.version && agent.version !== "?" ? agent.version : "latest";
  const dir = join(PETRI_HOME, "images");
  mkdirSync(dir, { recursive: true });
  const dockerfile = join(dir, `${agent.id}-${version}.Dockerfile`);
  writeFileSync(
    dockerfile,
    [
      "FROM node:22-slim",
      "RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*",
      `RUN npm install -g ${adapter.npmPackage}@${version}`,
      "WORKDIR /work",
      "",
    ].join("\n"),
  );
  execFileSync("docker", ["build", "-t", img, "-f", dockerfile, dir], { stdio: "inherit" });
  return img;
}

export const dockerExecutor: Executor = {
  async start(run) {
    const ctx = resolveRun(run);
    if ("error" in ctx) {
      store.updateRunStatus(run.id, "failed", { error: ctx.error });
      return;
    }
    const adapter = adapters[ctx.adapterId];
    const agent = run.agentVersion ? { ...ctx.agent, version: run.agentVersion } : ctx.agent;
    const homeDir = join(run.runDir, "home");
    mkdirSync(homeDir, { recursive: true });
    const workDir = prepareWorkdir(run.runDir, ctx.task);

    let img: string;
    try {
      img = ensureImage(agent, ctx.adapterId);
    } catch (err) {
      store.updateRunStatus(run.id, "failed", { error: `image build failed: ${String(err)}` });
      return;
    }

    const plan = adapter.plan({
      run, task: ctx.task, model: ctx.model,
      bin: ctx.agent.id,
      proxyBase: `${HOST_PROXY}/run/${run.id}/proxy`,
      workDir: "/work", homeDir, homePath: "/home/agent",
    });

    const logPath = join(run.runDir, "agent.log");
    writeFileSync(logPath, `$ docker ${img} ${plan.args.join(" ")}\n\n`);

    const dockerArgs = [
      "run", "--rm", "--name", `petri-${run.id}`,
      "-v", `${homeDir}:/home/agent`,
      "-v", `${workDir}:/work`,
      "-w", "/work",
      "-e", "HOME=/home/agent",
      ...Object.entries(plan.env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
      img,
      ...[basename(plan.bin), ...plan.args],
    ];
    const child = spawn("docker", dockerArgs, { stdio: ["ignore", "pipe", "pipe"] });
    children.set(run.id, child);
    store.setRunStatus(run.id, "running");
    publish("run", { runId: run.id, status: "running" });
    watchChild(run.id, child, logPath);
  },

  async stop(runId) {
    try {
      execFileSync("docker", ["kill", `petri-${runId}`], { stdio: "pipe" });
    } catch { /* already gone */ }
    children.get(runId)?.kill("SIGTERM");
    store.updateRunStatus(runId, "stopped");
    publish("run", { runId, status: "stopped" });
  },
};

export const executors: Record<string, Executor> = {
  local: localExecutor,
  docker: dockerExecutor,
};
