import { useMemo, useState } from "react";
import clsx from "clsx";
import { ArrowLeft, ChevronsUpDown, ChevronsDownUp, Square, Trash2 } from "lucide-react";
import JsonTree from "../components/JsonTree";
import RenderedBody from "../components/RenderedBody";
import SseStream from "../components/SseStream";
import { toolNamesOf, summarizeRequest } from "../lib/normalize";
import { api, useAgents, useBodies, useConfig, useRun, useRuns } from "../lib/api";
import type { RequestMeta, Run } from "../lib/api";
import { btn, iconBtn, statusCls, flagChipCls, diffChipCls, useConfirm, Select } from "../components/ui";

function toolDiff(a: unknown, b: unknown) {
  const ta = new Set(toolNamesOf(a));
  const tb = new Set(toolNamesOf(b));
  return {
    added: [...tb].filter((x) => !ta.has(x)),
    removed: [...ta].filter((x) => !tb.has(x)),
  };
}

function parseBody(text: string | null): unknown {
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

type View = "headers" | "json" | "rendered" | "events" | "raw";

function Seg({ children }: { children: React.ReactNode }) {
  return <div className="inline-flex bg-bg border border-border rounded-md p-0.5 gap-0.5">{children}</div>;
}

function SegItem({ on, onClick, title, children }: {
  on: boolean; onClick: () => void; title?: string; children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={clsx(
        "inline-flex items-center gap-1 text-xs px-2 py-[3px] rounded cursor-pointer",
        on ? "text-text bg-panel shadow-sm" : "text-dim hover:text-text",
      )}
    >
      {children}
    </button>
  );
}

const VIEW_LABEL: Record<View, string> = { headers: "Headers", json: "JSON", rendered: "Rendered", events: "Events", raw: "Raw" };

const GENERIC_HEADERS = new Set([
  "host", "connection", "content-length", "content-type", "content-encoding",
  "accept", "accept-encoding", "accept-language", "user-agent", "authorization",
  "x-api-key", "api-key", "cookie", "set-cookie", "cache-control", "pragma",
  "origin", "referer", "upgrade", "expect", "keep-alive", "transfer-encoding",
  "te", "trailer", "via", "date", "server", "dnt", "max-forwards",
]);

function isGenericHeader(name: string): boolean {
  const n = name.toLowerCase();
  return GENERIC_HEADERS.has(n)
    || n.startsWith("sec-") || n.startsWith("x-forwarded-") || n.startsWith("cf-")
    || n.startsWith("access-control-") || n.startsWith("x-real-");
}

function HeadersTable({ headers }: { headers?: Record<string, string> }) {
  const entries = Object.entries(headers ?? {});
  const special = entries.filter(([k]) => !isGenericHeader(k));
  const generic = entries.filter(([k]) => isGenericHeader(k));
  const sorted = [...special, ...generic];
  if (entries.length === 0) return <div className="text-dim text-xs">no headers captured</div>;
  return (
    <table className="w-full font-mono text-xs">
      <tbody>
        {sorted.map(([k, v]) => (
          <tr key={k} className={isGenericHeader(k) ? "opacity-60" : undefined}>
            <td className="align-top py-0.5 pr-4 text-dim whitespace-nowrap">{k}</td>
            <td className="align-top py-0.5 break-all">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RequestPane({ runId, req }: { runId: string; req: RequestMeta }) {
  const [side, setSide] = useState<"req" | "resp">("req");
  const [view, setView] = useState<View>("json");
  const [treeDepth, setTreeDepth] = useState(1);
  const [treeKey, setTreeKey] = useState(0);

  const bodies = useBodies(runId, req.seq);
  const reqSummary = useMemo(() => summarizeRequest(parseBody(bodies.req)), [bodies.req]);

  const views: View[] = side === "resp" && req.streaming
    ? ["headers", "json", "rendered", "events"]
    : ["headers", "json", "rendered", "raw"];
  const effView = views.includes(view) ? view : "json";

  const respAssembled = req.streaming && bodies.assembled !== null ? bodies.assembled : bodies.resp;
  const structured = side === "req" ? bodies.req : respAssembled;
  const verbatim = side === "req" ? bodies.req : bodies.resp;
  const data = parseBody(structured);
  const renderedData = side === "resp" ? parseBody(respAssembled) : data;
  const resetTree = (d: number) => { setTreeDepth(d); setTreeKey((k) => k + 1); };

  return (
    <div className="border border-border rounded-[10px] overflow-hidden bg-panel">
      <div className="flex gap-2.5 items-center px-3 py-2 border-b border-border bg-panel2 flex-wrap">
        <span className="font-mono text-xs text-dim">#{req.seq}</span>
        {reqSummary.length > 0 && <span className="font-mono text-xs">{reqSummary.join(" · ")}</span>}
        <span className="font-mono text-xs text-dim">{req.method} {req.path}</span>
        {req.status !== undefined && (
          <span className={statusCls(req.status === 200 ? "done" : "failed")}>{req.status}</span>
        )}
        {req.durationMs !== undefined && <span className="text-dim text-xs">{fmtDur(req.durationMs)}</span>}
        <span className="font-mono text-xs text-dim">{fmtClock(req.startedAt)}</span>
        <span className="flex-1" />
        <Seg>
          <SegItem on={side === "req"} onClick={() => setSide("req")}>Request</SegItem>
          <SegItem on={side === "resp"} onClick={() => setSide("resp")}>
            Response{req.streaming ? " ·SSE" : ""}
          </SegItem>
        </Seg>
        <Seg>
          {views.map((v) => (
            <SegItem key={v} on={effView === v} onClick={() => setView(v)}>{VIEW_LABEL[v]}</SegItem>
          ))}
        </Seg>
        {effView === "json" && data !== undefined && (
          <>
            <button className={iconBtn} title="Expand all" onClick={() => resetTree(Infinity)}><ChevronsUpDown size={14} /></button>
            <button className={iconBtn} title="Collapse to top-level keys" onClick={() => resetTree(1)}><ChevronsDownUp size={14} /></button>
          </>
        )}
      </div>
      <div className="max-h-[62vh] overflow-auto px-3.5 py-3">
        {effView === "headers" && (
          <HeadersTable headers={side === "req" ? req.reqHeaders : req.respHeaders} />
        )}
        {effView === "events" && (bodies.resp === null
          ? <div className="text-dim text-xs">loading…</div>
          : <SseStream raw={bodies.resp} />)}
        {effView === "rendered" && (renderedData === undefined
          ? <pre className="font-mono text-xs whitespace-pre-wrap break-all m-0">{verbatim ?? "…"}</pre>
          : <RenderedBody data={renderedData} />)}
        {effView === "raw" && (verbatim === null
          ? <div className="text-dim text-xs">loading…</div>
          : <pre className="font-mono text-xs whitespace-pre-wrap break-all m-0">{verbatim}</pre>)}
        {effView === "json" && (structured === null
          ? <div className="text-dim text-xs">loading…</div>
          : data === undefined
            ? <pre className="font-mono text-xs whitespace-pre-wrap break-all m-0">{structured}</pre>
            : <JsonTree key={treeKey} data={data} depth={treeDepth} />)}
      </div>
    </div>
  );
}

function fmtClock(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour12: false });
}

function fmtOffset(startedAt: string, base: string) {
  const d = new Date(startedAt).getTime() - new Date(base).getTime();
  return `+${(d / 1000).toFixed(1)}s`;
}

function fmtDur(ms: number) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function runTotalMs(run: Run) {
  return Math.max(new Date(run.finishedAt ?? new Date().toISOString()).getTime() - new Date(run.createdAt).getTime(), 1);
}

/** Horizontal timeline bar: position = request start offset within the run, width = duration. */
function Timeline({ run, req }: { run: Run; req: RequestMeta }) {
  const t0 = new Date(run.createdAt).getTime();
  const t1 = new Date(run.finishedAt ?? new Date().toISOString()).getTime();
  const total = Math.max(t1 - t0, 1);
  const start = new Date(req.startedAt).getTime() - t0;
  const dur = req.durationMs ?? 0;
  const left = Math.min(Math.max((start / total) * 100, 0), 100);
  const width = Math.min(Math.max((dur / total) * 100, 2.5), 100 - left);
  const failed = req.status !== undefined && req.status !== 200;
  return (
    <div className="relative h-1.5 w-24 rounded bg-panel2 overflow-hidden shrink-0">
      <div
        className={clsx("absolute top-0 bottom-0 rounded", failed ? "bg-red" : "bg-accent")}
        style={{ left: `${left}%`, width: `${width}%` }}
      />
    </div>
  );
}

function ReqRow({ run, r, i, sel, onPick }: {
  run: Run; r: RequestMeta; i: number; sel: number; onPick: (i: number, r: RequestMeta) => void;
}) {
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  return (
    <div
      onClick={() => onPick(i, r)}
      onMouseEnter={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setTip({ x: rect.right - 8, y: rect.top });
      }}
      onMouseLeave={() => setTip(null)}
      className={clsx(
        "flex gap-2.5 items-center px-3 py-2 cursor-pointer border-b border-border last:border-b-0 hover:bg-panel2",
        i === sel && "bg-accent-soft shadow-[inset_2.5px_0_0_var(--accent)]",
      )}
    >
      <span className="text-dim">#{r.seq}</span>
      <span className="font-mono text-xs truncate">{r.summary?.join(" · ") ?? `${r.method} ${r.path}`}</span>
      <span className="flex-1" />
      <Timeline run={run} req={r} />
      {r.durationMs !== undefined && <span className="text-dim text-xs w-16 text-right">{fmtDur(r.durationMs)}</span>}
      {r.durationMs === undefined && <span className="text-amber text-xs w-16 text-right">…</span>}
      {tip && (
        <div
          className="fixed z-50 px-2.5 py-1.5 rounded-md bg-panel border border-border shadow-lg font-mono text-xs pointer-events-none whitespace-nowrap"
          style={{ left: tip.x, top: tip.y - 6, transform: "translate(-100%, -100%)" }}
        >
          <div><span className="text-dim">sent</span> {fmtClock(r.startedAt)} <span className="text-dim">({fmtOffset(r.startedAt, run.createdAt)} into run)</span></div>
          {r.finishedAt && <div><span className="text-dim">done</span> {fmtClock(r.finishedAt)} <span className="text-dim">({r.durationMs !== undefined ? fmtDur(r.durationMs) : "?"})</span></div>}
        </div>
      )}
    </div>
  );
}

function RunColumn({ run, sel, setSel, onSelect }: {
  run: Run; sel: number; setSel: (i: number) => void; onSelect?: (req: RequestMeta) => void;
}) {
  const requests = run.requests ?? [];
  const active = requests[Math.min(sel, requests.length - 1)];
  const totalMs = runTotalMs(run);
  return (
    <div>
      <div className="font-mono text-xs text-dim mb-2">{run.id} · {run.name}</div>
      <div className="mb-3 border border-border rounded-[10px] overflow-hidden bg-panel">
        {requests.length > 0 && (
          <div className="flex gap-2.5 items-center px-3 pt-1.5 pb-0.5 border-b border-border text-[10px] text-dim select-none">
            <span className="flex-1" />
            <div className="relative w-24 shrink-0">
              <span className="absolute left-0 font-mono">0s</span>
              <span className="absolute right-0 font-mono">{fmtDur(totalMs)}</span>
              <div className="absolute left-1/2 top-0 bottom-0 border-l border-border" />
            </div>
            <span className="w-16 shrink-0" />
          </div>
        )}
        {requests.map((r, i) => (
          <ReqRow key={r.id} run={run} r={r} i={i} sel={sel} onPick={(idx, req) => { setSel(idx); onSelect?.(req); }} />
        ))}
        {requests.length === 0 && (
          <div className="px-3 py-4 text-dim text-xs">Waiting for traffic… (agent is starting or has not called the API yet)</div>
        )}
      </div>
      {active && <RequestPane key={`${run.id}-${active.seq}`} runId={run.id} req={active} />}
    </div>
  );
}

export default function RunDetailView({ runId, onBack }: { runId: string; onBack: () => void }) {
  const { run } = useRun(runId);
  const { runs } = useRuns();
  const { cfg } = useConfig();
  const agents = useAgents();
  const [sel, setSel] = useState(0);
  const [compareId, setCompareId] = useState<string | null>(null);
  const { confirm, confirmEl } = useConfirm();
  const [selB, setSelB] = useState(0);
  const { run: compareRun } = useRun(compareId ?? "");

  const [reqBodyA, setReqBodyA] = useState<string | null>(null);
  const [reqBodyB, setReqBodyB] = useState<string | null>(null);

  const diff = useMemo(() => {
    const a = parseBody(reqBodyA);
    const b = parseBody(reqBodyB);
    if (a === undefined || b === undefined) return null;
    return toolDiff(a, b);
  }, [reqBodyA, reqBodyB]);

  if (!run) return <div className="text-dim text-[13px]">loading…</div>;

  const task = cfg?.tasks.find((t) => t.id === run.taskId);
  const agent = agents.find((a) => a.id === run.agentId);
  const model = cfg?.models.find((m) => m.id === run.modelId);
  const requests = run.requests ?? [];
  const active = requests[Math.min(sel, requests.length - 1)];

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <button className={btn} onClick={onBack}><ArrowLeft size={14} /> Runs</button>
        <h1 className="font-mono text-xl whitespace-nowrap min-w-0 truncate">{run.id}</h1>
        <span className={statusCls(run.status)}>{run.status}</span>
        {run.status === "running" && (
          <button className={btn} onClick={() => void api.stopRun(run.id)}><Square size={12} /> Stop</button>
        )}
        {run.status !== "running" && run.status !== "pending" && (
          <button
            className={btn}
            title="Delete run"
            onClick={() => {
              void confirm("Delete run?", `${run.id} — captured bodies and the run directory will be removed.`).then((yes) => {
                if (yes) void api.deleteRun(run.id).then(onBack);
              });
            }}
          >
            <Trash2 size={12} /> Delete
          </button>
        )}
        <span className="flex-1" />
        {compareId && (
          <button
            className={btn}
            title="Clear comparison"
            onClick={() => setCompareId(null)}
          >
            Clear compare
          </button>
        )}
        <Select
          className="w-[300px] shrink-0"
          value={compareId ?? ""}
          placeholder="Compare with…"
          options={runs.filter((r) => r.id !== run.id).map((r) => ({ value: r.id, label: `${r.id} · ${r.name}` }))}
          onChange={(v) => setCompareId(v || null)}
        />
      </div>

      <div className="flex gap-6 flex-wrap bg-panel border border-border rounded-[10px] px-4 py-3.5 mb-4 text-[13px]">
        <div><span className="text-dim mr-1.5">Task</span>{task?.name ?? run.taskName ?? run.taskId}</div>
        <div><span className="text-dim mr-1.5">Agent</span>{agent?.name ?? run.agentId} {run.agentVersion}</div>
        <div><span className="text-dim mr-1.5">Model</span>{model?.modelId ?? run.modelName ?? run.modelId} <span className="text-dim">({model?.protocol})</span></div>
        <div><span className="text-dim mr-1.5">Executor</span>{run.executor ?? "local"}</div>
        <div>
          <span className="text-dim mr-1.5">Flags</span>
          {Object.entries(run.flags).length === 0 && <span className="text-dim">—</span>}
          {Object.entries(run.flags).map(([k, v]) => (
            <span key={k} className={flagChipCls(v)}>{k}={v ? "on" : "off"}</span>
          ))}
        </div>
        {task && <div className="text-dim w-full">Prompt: {task.prompt}</div>}
        {run.error && <div className="text-red w-full">Error: {run.error}</div>}
      </div>

      <div className={compareRun ? "grid grid-cols-2 gap-4 items-start" : ""}>
        <div>
          <RunColumn
            run={run}
            sel={sel}
            setSel={(i) => {
              setSel(i);
              const r = requests[i];
              if (r) void api.body(run.id, r.seq, "req").then(setReqBodyA);
            }}
          />
        </div>
        {compareRun && (
          <div>
            {diff && (diff.added.length > 0 || diff.removed.length > 0) && (
              <div className="px-3 py-2 mb-3 text-[12.5px] bg-panel border border-border rounded-[10px]">
                tools[] diff:
                {diff.added.map((t) => <span key={t} className={diffChipCls(true)}>+ {t}</span>)}
                {diff.removed.map((t) => <span key={t} className={diffChipCls(false)}>− {t}</span>)}
              </div>
            )}
            <RunColumn
              run={compareRun}
              sel={selB}
              setSel={(i) => {
                setSelB(i);
                const r = (compareRun.requests ?? [])[i];
                if (r) void api.body(compareRun.id, r.seq, "req").then(setReqBodyB);
              }}
            />
          </div>
        )}
      </div>
      {active === undefined && run.status !== "running" && (
        <div className="text-dim text-[13px] mt-2">No requests were captured in this run.</div>
      )}
      {confirmEl}
    </div>
  );
}
