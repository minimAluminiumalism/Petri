import { useState } from "react";

function preview(value: unknown): string {
  if (Array.isArray(value)) return `[ ${value.length} ]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as object);
    return `{ ${keys.slice(0, 3).join(", ")}${keys.length > 3 ? ", …" : ""} }`;
  }
  return "";
}

function Leaf({ value }: { value: unknown }) {
  if (value === null) return <span className="j-null">null</span>;
  switch (typeof value) {
    case "string":
      return <span className="j-str">"{value}"</span>;
    case "number":
      return <span className="j-num">{String(value)}</span>;
    case "boolean":
      return <span className="j-bool">{String(value)}</span>;
    default:
      return <span className="j-str">{String(value)}</span>;
  }
}

function Node({ k, value, depth, defaultOpen }: {
  k?: string;
  value: unknown;
  depth: number;
  defaultOpen: number;
}) {
  const isObj = value !== null && typeof value === "object";
  const [open, setOpen] = useState(depth < defaultOpen);

  if (!isObj) {
    return (
      <div className="j-row" style={{ paddingLeft: depth * 16 }}>
        {k !== undefined && <span className="j-key">{k}: </span>}
        <Leaf value={value} />
      </div>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);

  return (
    <div>
      <div className="j-row j-toggle" style={{ paddingLeft: depth * 16 }} onClick={() => setOpen(!open)}>
        <span className="j-arrow">{open ? "▾" : "▸"}</span>
        {k !== undefined && <span className="j-key">{k}: </span>}
        <span className="j-preview">{preview(value)}</span>
      </div>
      {open && entries.map(([ek, ev]) => (
        <Node key={ek} k={ek} value={ev} depth={depth + 1} defaultOpen={defaultOpen} />
      ))}
    </div>
  );
}

/** depth: how many levels auto-expand; use Infinity for expand-all, 0 for collapse-all. */
export default function JsonTree({ data, depth = 1 }: { data: unknown; depth?: number }) {
  return (
    <div className="jtree">
      <Node value={data} depth={0} defaultOpen={depth} />
    </div>
  );
}
