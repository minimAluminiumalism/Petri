import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { PETRI_HOME } from "./config.ts";
import type { CapturedRequestMeta, Run, RunStatus } from "./types.ts";

const DB_DIR = join(PETRI_HOME, "db");
mkdirSync(DB_DIR, { recursive: true });

const db = new DatabaseSync(join(DB_DIR, "petri.db"));
db.exec(`
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  task_id TEXT, agent_id TEXT, model_id TEXT,
  flags TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  workdir TEXT, run_dir TEXT,
  created_at TEXT NOT NULL, finished_at TEXT,
  exit_code INTEGER, error TEXT
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL, seq INTEGER NOT NULL,
  method TEXT NOT NULL, path TEXT NOT NULL,
  req_body_path TEXT, resp_body_path TEXT,
  status INTEGER, duration_ms INTEGER,
  streaming INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL, finished_at TEXT,
  req_headers TEXT, resp_headers TEXT
);
CREATE INDEX IF NOT EXISTS idx_requests_run ON requests(run_id, seq);
`);
try {
  db.exec(`ALTER TABLE runs ADD COLUMN executor TEXT NOT NULL DEFAULT 'local'`);
} catch { /* column exists */ }
try {
  db.exec(`ALTER TABLE requests ADD COLUMN summary TEXT`);
} catch { /* column exists */ }
try {
  db.exec(`ALTER TABLE runs ADD COLUMN agent_version TEXT`);
} catch { /* column exists */ }
try {
  db.exec(`ALTER TABLE runs ADD COLUMN model_name TEXT`);
} catch { /* column exists */ }
try {
  db.exec(`ALTER TABLE runs ADD COLUMN task_name TEXT`);
} catch { /* column exists */ }

export function newRunId(): string {
  const ts = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `run-${ts}-${randomBytes(3).toString("hex")}`;
}

export function createRun(r: Run): void {
  db.prepare(
    `INSERT INTO runs (id,name,task_id,task_name,agent_id,agent_version,model_id,model_name,flags,executor,status,workdir,run_dir,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(r.id, r.name, r.taskId, r.taskName ?? null, r.agentId, r.agentVersion ?? null, r.modelId, r.modelName ?? null, JSON.stringify(r.flags), r.executor ?? "local", r.status, r.workdir, r.runDir, r.createdAt);
}

export function updateRunStatus(id: string, status: RunStatus, extra: { exitCode?: number; error?: string } = {}): void {
  db.prepare(
    `UPDATE runs SET status=?, finished_at=?, exit_code=?, error=? WHERE id=?`,
  ).run(status, new Date().toISOString(), extra.exitCode ?? null, extra.error ?? null, id);
}

export function setRunStatus(id: string, status: RunStatus): void {
  db.prepare(`UPDATE runs SET status=? WHERE id=?`).run(status, id);
}

interface RunRow {
  id: string; name: string; task_id: string; task_name: string | null; agent_id: string; model_id: string;
  flags: string; executor: string; status: string; workdir: string; run_dir: string;
  agent_version: string | null; model_name: string | null;
  created_at: string; finished_at: string | null; exit_code: number | null; error: string | null;
}

function rowToRun(r: RunRow): Run {
  return {
    id: r.id, name: r.name, taskId: r.task_id, taskName: r.task_name ?? undefined, agentId: r.agent_id, agentVersion: r.agent_version ?? undefined, modelId: r.model_id, modelName: r.model_name ?? undefined,
    flags: JSON.parse(r.flags) as Record<string, boolean>, executor: r.executor, status: r.status as RunStatus,
    workdir: r.workdir, runDir: r.run_dir, createdAt: r.created_at,
    finishedAt: r.finished_at ?? undefined, exitCode: r.exit_code ?? undefined, error: r.error ?? undefined,
  };
}

export function getRun(id: string): Run | null {
  const row = db.prepare(`SELECT * FROM runs WHERE id=?`).get(id) as RunRow | undefined;
  return row ? rowToRun(row) : null;
}

export function deleteRun(run: Run): void {
  db.prepare(`DELETE FROM requests WHERE run_id=?`).run(run.id);
  db.prepare(`DELETE FROM runs WHERE id=?`).run(run.id);
  rmSync(join(BODIES_DIR, run.id), { recursive: true, force: true });
  if (run.workdir) {
    try {
      execFileSync("git", ["-C", run.workdir, "worktree", "remove", "--force", join(run.runDir, "work")], { stdio: "pipe" });
    } catch { /* not a worktree, or already removed */ }
  }
  rmSync(run.runDir, { recursive: true, force: true });
}

export function listRuns(): (Run & { requestCount: number })[] {
  const rows = db.prepare(`
    SELECT r.*, (SELECT COUNT(*) FROM requests q WHERE q.run_id = r.id) AS n
    FROM runs r ORDER BY r.created_at DESC`).all() as unknown as (RunRow & { n: number })[];
  return rows.map((r) => ({ ...rowToRun(r), requestCount: r.n }));
}

const BODIES_DIR = join(PETRI_HOME, "bodies");
mkdirSync(BODIES_DIR, { recursive: true });

export function bodyPath(runId: string, seq: number, side: "req" | "resp"): string {
  const dir = join(BODIES_DIR, runId);
  mkdirSync(dir, { recursive: true });
  return join(dir, `${String(seq).padStart(4, "0")}.${side}.bin`);
}

export function writeBody(path: string, data: Buffer): void {
  writeFileSync(path, data);
}

export function readBody(path: string): Buffer | null {
  return existsSync(path) ? readFileSync(path) : null;
}

const seqCounters = new Map<string, number>();

export function nextSeq(runId: string): number {
  let cur = seqCounters.get(runId);
  if (cur === undefined) {
    const row = db.prepare(`SELECT COALESCE(MAX(seq),0) AS s FROM requests WHERE run_id=?`).get(runId) as { s: number };
    cur = row.s;
  }
  cur += 1;
  seqCounters.set(runId, cur);
  return cur;
}

export function insertRequest(m: Omit<CapturedRequestMeta, "id"> & { reqBodyPath: string }): number {
  const res = db.prepare(
    `INSERT INTO requests (run_id,seq,method,path,req_body_path,status,duration_ms,streaming,started_at,finished_at,req_headers,resp_headers,summary)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(m.runId, m.seq, m.method, m.path, m.reqBodyPath, m.status ?? null, m.durationMs ?? null,
    m.streaming ? 1 : 0, m.startedAt, m.finishedAt ?? null,
    JSON.stringify(m.reqHeaders), m.respHeaders ? JSON.stringify(m.respHeaders) : null,
    m.summary ? JSON.stringify(m.summary) : null);
  return Number(res.lastInsertRowid);
}

export function attachRespBody(requestId: number, respBodyPath: string): void {
  db.prepare(`UPDATE requests SET resp_body_path=? WHERE id=?`).run(respBodyPath, requestId);
}

interface ReqRow {
  id: number; run_id: string; seq: number; method: string; path: string;
  req_body_path: string | null; resp_body_path: string | null;
  status: number | null; duration_ms: number | null; streaming: number;
  started_at: string; finished_at: string | null; req_headers: string | null; resp_headers: string | null;
  summary: string | null;
}

export interface RequestRecord extends CapturedRequestMeta {
  reqBodyPath?: string;
  respBodyPath?: string;
}

export function listRequests(runId: string): RequestRecord[] {
  const rows = db.prepare(`SELECT * FROM requests WHERE run_id=? ORDER BY id`).all(runId) as unknown as ReqRow[];
  return rows.map((r) => ({
    id: r.id, runId: r.run_id, seq: r.seq, method: r.method, path: r.path,
    status: r.status ?? undefined, durationMs: r.duration_ms ?? undefined,
    streaming: r.streaming === 1, startedAt: r.started_at, finishedAt: r.finished_at ?? undefined,
    reqHeaders: r.req_headers ? (JSON.parse(r.req_headers) as Record<string, string>) : {},
    respHeaders: r.resp_headers ? (JSON.parse(r.resp_headers) as Record<string, string>) : undefined,
    reqBodyPath: r.req_body_path ?? undefined, respBodyPath: r.resp_body_path ?? undefined,
    summary: r.summary ? (JSON.parse(r.summary) as string[]) : undefined,
  }));
}

export function setRequestSummary(id: number, summary: string[]): void {
  db.prepare(`UPDATE requests SET summary=? WHERE id=?`).run(JSON.stringify(summary), id);
}

export function requestsMissingSummary(): { id: number; runId: string; seq: number; reqBodyPath: string }[] {
  const rows = db.prepare(
    `SELECT id, run_id, seq, req_body_path FROM requests WHERE summary IS NULL AND req_body_path IS NOT NULL`,
  ).all() as unknown as { id: number; run_id: string; seq: number; req_body_path: string }[];
  return rows.map((r) => ({ id: r.id, runId: r.run_id, seq: r.seq, reqBodyPath: r.req_body_path }));
}
