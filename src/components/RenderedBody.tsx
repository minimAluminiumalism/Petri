import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Wrench, Terminal, Info } from "lucide-react";
import { normalizeBody } from "../lib/normalize";
import type { Block } from "../lib/normalize";

function BlockView({ b }: { b: Block }) {
  if (b.kind === "tool_call") {
    return (
      <div className="blk blk-tool">
        <div className="blk-tool-head">
          <Wrench size={13} />
          <span className="font-mono">{b.name}</span>
          {b.id && <span className="text-dim font-mono">· {String(b.id).slice(0, 12)}</span>}
        </div>
        <pre className="blk-pre mono">{typeof b.args === "string" ? b.args : JSON.stringify(b.args, null, 2)}</pre>
      </div>
    );
  }
  if (b.kind === "tool_result") {
    return (
      <div className="blk blk-result">
        <div className="blk-tool-head">
          <Terminal size={13} />
          <span>tool result</span>
          {b.id && <span className="text-dim font-mono">· {String(b.id).slice(0, 12)}</span>}
        </div>
        <pre className="blk-pre mono">{b.text}</pre>
      </div>
    );
  }
  if (b.kind === "note") {
    return (
      <div className="blk blk-note">
        <div className="blk-tool-head"><Info size={13} /><span className="font-mono">{b.name}</span></div>
        <pre className="blk-pre mono">{b.text}</pre>
      </div>
    );
  }
  return (
    <div className={`blk blk-${b.kind}`}>
      <div className="blk-role">{b.kind}</div>
      <div className="blk-text md-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{b.text ?? ""}</ReactMarkdown>
      </div>
    </div>
  );
}

function blockColor(b: Block): string {
  switch (b.kind) {
    case "system": return "var(--dim)";
    case "user": return "var(--accent)";
    case "assistant": return "var(--green)";
    case "tool_call": return "var(--accent)";
    case "tool_result": return "var(--amber)";
    case "note": return "var(--purple)";
  }
}

export default function RenderedBody({ data }: { data: unknown }) {
  const blocks = normalizeBody(data);
  if (blocks.length === 0) {
    return <div className="text-dim" style={{ padding: 16 }}>Cannot render as structured messages — use the Wire view.</div>;
  }
  const jump = (i: number) => {
    const el = document.getElementById(`rblk-${i}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1200);
  };
  return (
    <div className="rendered">
      <div className="mmap">
        {blocks.map((b, i) => (
          <button
            key={i}
            className="mmap-cell"
            style={{ background: blockColor(b) }}
            title={`#${i + 1} ${b.kind}${b.name ? " · " + b.name : ""}`}
            onClick={() => jump(i)}
          />
        ))}
      </div>
      {blocks.map((b, i) => (
        <div id={`rblk-${i}`} key={i}>
          <BlockView b={b} />
        </div>
      ))}
    </div>
  );
}
