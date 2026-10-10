import { useMemo, useState } from "react";
import clsx from "clsx";
import JsonTree from "./JsonTree";

interface SseFrame {
  i: number;
  event: string;
  data: string;
  parsed: unknown;
}

interface SseGroup {
  event: string;
  frames: SseFrame[];
}

function parseSse(raw: string): SseFrame[] {
  const frames: SseFrame[] = [];
  for (const block of raw.split(/\r?\n\r?\n/)) {
    let event = "";
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (!event && dataLines.length === 0) continue;
    const data = dataLines.join("\n");
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      parsed = undefined;
    }
    frames.push({ i: frames.length + 1, event: event || "message", data, parsed });
  }
  return frames;
}

function groupContiguous(frames: SseFrame[]): SseGroup[] {
  const groups: SseGroup[] = [];
  for (const f of frames) {
    const last = groups[groups.length - 1];
    if (last && last.event === f.event) last.frames.push(f);
    else groups.push({ event: f.event, frames: [f] });
  }
  return groups;
}

function deltaText(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const p = parsed as Record<string, unknown>;
  const d = p.delta;
  if (typeof d === "string") return d;
  if (d && typeof d === "object") {
    const o = d as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if (typeof o.partial_json === "string") return o.partial_json;
    if (typeof o.content === "string") return o.content;
  }
  const ch = p.choices;
  if (Array.isArray(ch) && ch[0] && typeof ch[0] === "object") {
    const dd = (ch[0] as Record<string, unknown>).delta;
    if (dd && typeof dd === "object") {
      const c = (dd as Record<string, unknown>).content;
      if (typeof c === "string") return c;
    }
  }
  return undefined;
}

function groupPreview(g: SseGroup): string {
  const parts = g.frames.map(deltaText).filter((s): s is string => s !== undefined);
  if (parts.length === g.frames.length && parts.length > 0) {
    const joined = parts.join("");
    return joined.length > 120 ? joined.slice(0, 120) + "…" : joined;
  }
  return `${g.frames.length} frames`;
}

function eventCls(event: string): string {
  if (/error|fail/i.test(event)) return "text-red";
  if (/delta|chunk|part/i.test(event)) return "text-purple";
  if (/complet|done|stop|finish/i.test(event)) return "text-green";
  if (/creat|start|begin|open|in_progress/i.test(event)) return "text-accent";
  return "text-dim";
}

function FrameDetail({ f }: { f: SseFrame }) {
  if (f.parsed !== undefined) return <JsonTree data={f.parsed} depth={2} />;
  return <pre className="font-mono text-xs whitespace-pre-wrap break-all m-0 text-dim">{f.data || "(empty)"}</pre>;
}

export default function SseStream({ raw }: { raw: string }) {
  const frames = useMemo(() => parseSse(raw), [raw]);
  const [filter, setFilter] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Set<number>>(new Set());
  const [openFrames, setOpenFrames] = useState<Set<number>>(new Set());

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of frames) m.set(f.event, (m.get(f.event) ?? 0) + 1);
    return [...m.entries()];
  }, [frames]);

  const visible = filter === null ? frames : frames.filter((f) => f.event === filter);
  const groups = useMemo(() => groupContiguous(visible), [visible]);

  const toggleSet = (set: Set<number>, k: number) => {
    const next = new Set(set);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    return next;
  };

  if (frames.length === 0)
    return <div className="text-dim text-xs">No SSE frames parsed</div>;

  return (
    <div>
      <div className="flex gap-1.5 flex-wrap mb-2.5 items-center">
        <span className="text-xs text-dim mr-1">{frames.length} events</span>
        <button
          onClick={() => setFilter(null)}
          className={clsx(
            "text-xs px-1.5 py-0.5 rounded border cursor-pointer",
            filter === null ? "border-accent text-accent bg-accent-soft" : "border-border text-dim hover:text-text",
          )}
        >
          all
        </button>
        {counts.map(([ev, n]) => (
          <button
            key={ev}
            onClick={() => setFilter(filter === ev ? null : ev)}
            className={clsx(
              "text-xs px-1.5 py-0.5 rounded border cursor-pointer font-mono",
              filter === ev ? "border-accent text-accent bg-accent-soft" : "border-border text-dim hover:text-text",
            )}
          >
            {ev} <span className="opacity-60">×{n}</span>
          </button>
        ))}
      </div>
      <div className="border border-border rounded-md overflow-hidden">
        {groups.map((g, gi) => {
          const single = g.frames.length === 1;
          const open = openGroups.has(gi);
          const f0 = g.frames[0];
          return (
            <div key={gi} className="border-b border-border last:border-b-0">
              <div
                className="flex gap-2 items-center px-2.5 py-1.5 cursor-pointer hover:bg-panel2 select-none"
                onClick={() => {
                  if (single) setOpenFrames(toggleSet(openFrames, f0.i));
                  else setOpenGroups(toggleSet(openGroups, gi));
                }}
              >
                <span className="text-dim text-xs font-mono w-14 shrink-0">
                  #{f0.i}{single ? "" : `–${g.frames[g.frames.length - 1].i}`}
                </span>
                <span className="text-dim text-xs w-3">{single ? (openFrames.has(f0.i) ? "▾" : "▸") : open ? "▾" : "▸"}</span>
                <span className={clsx("font-mono text-xs", eventCls(g.event))}>{g.event}</span>
                {!single && <span className="text-dim text-xs">×{g.frames.length}</span>}
                <span className="flex-1" />
                <span className="text-xs text-dim truncate max-w-[45%] font-mono">{groupPreview(g)}</span>
              </div>
              {single && openFrames.has(f0.i) && (
                <div className="px-3 py-2 border-t border-border bg-panel2/50">
                  <FrameDetail f={f0} />
                </div>
              )}
              {!single && open && g.frames.map((f) => (
                <div key={f.i} className="border-t border-border">
                  <div
                    className="flex gap-2 items-center px-2.5 py-1 pl-8 cursor-pointer hover:bg-panel2 select-none"
                    onClick={() => setOpenFrames(toggleSet(openFrames, f.i))}
                  >
                    <span className="text-dim text-xs font-mono w-10 shrink-0">#{f.i}</span>
                    <span className="text-dim text-xs w-3">{openFrames.has(f.i) ? "▾" : "▸"}</span>
                    <span className="text-xs text-dim font-mono truncate">{deltaText(f.parsed) ?? f.data.slice(0, 80)}</span>
                  </div>
                  {openFrames.has(f.i) && (
                    <div className="px-3 py-2 pl-12 border-t border-border bg-panel2/50">
                      <FrameDetail f={f} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
