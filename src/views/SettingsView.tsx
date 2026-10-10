import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, newId, useAgents, useConfig, PROTOCOLS } from "../lib/api";
import type { AgentAdapterInfo, ModelConfig } from "../lib/api";
import { tbl, th, td, btn, btnPrimary, input, iconBtn, Select } from "../components/ui";

function HeadersEditor({ rows, setRows }: {
  rows: { k: string; v: string }[];
  setRows: (r: { k: string; v: string }[]) => void;
}) {
  const set = (i: number, field: "k" | "v", val: string) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, [field]: val } : r)));
  return (
    <div className="mt-3 pt-3 border-t border-dashed border-border">
      <div className="text-dim text-xs mb-1.5">Custom headers</div>
      {rows.map((r, i) => (
        <div className="flex gap-2 mb-1.5" key={i}>
          <input className={`${input} w-56`} placeholder="header name" value={r.k} onChange={(e) => set(i, "k", e.target.value)} />
          <input className={`${input} flex-1`} placeholder="value" value={r.v} onChange={(e) => set(i, "v", e.target.value)} />
          <button className={iconBtn} title="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button className={btn} onClick={() => setRows([...rows, { k: "", v: "" }])}>
        <Plus size={13} /> Add header
      </button>
    </div>
  );
}

const h2 = "text-[13px] my-0 text-dim uppercase tracking-wider";

const BASE_URL_EXAMPLES: Record<ModelConfig["protocol"], string> = {
  "anthropic-messages": "https://api.anthropic.com",
  "openai-completions": "https://api.openai.com/v1",
  "openai-responses": "https://api.openai.com/v1",
  "google-generative-ai": "https://generativelanguage.googleapis.com",
};

const MODEL_ID_EXAMPLES: Record<ModelConfig["protocol"], string> = {
  "anthropic-messages": "claude-opus-5-5",
  "openai-completions": "gpt-5.6-terra",
  "openai-responses": "gpt-5.6-terra",
  "google-generative-ai": "gemini-3.1-pro-preview",
};

const fieldLabel = "block text-[11px] text-dim mb-1";

const BROWSE = "__browse__";

function AgentBinCell({ agent, value, onSave }: {
  agent: AgentAdapterInfo;
  value: string;
  onSave: (bin: string) => Promise<void>;
}) {
  const [sel, setSel] = useState(value);
  const [picking, setPicking] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null);

  const choose = async (v: string) => {
    if (v === BROWSE) {
      setPicking(true);
      setMsg(null);
      const r = await api.pickBin().catch((e) => ({ cancelled: false as const, ok: false as const, error: String(e) }));
      setPicking(false);
      if (r.cancelled) { setSel(value); return; }
      if (!r.ok) { setMsg({ text: r.error ?? "invalid", err: true }); setSel(value); return; }
      setMsg({ text: r.version ? `ok · ${r.version}` : "ok", err: false });
      await onSave(r.resolved!);
      setSel(r.resolved!);
      return;
    }
    setSel(v);
    setMsg(null);
    await onSave(v);
  };

  const known = agent.installs.some((i) => i.bin === sel);
  const options = [
    {
      value: "",
      label: agent.npmPackage
        ? "default (auto-install from npm)"
        : agent.installs.find((i) => i.source === "path")
          ? `default (${agent.installs.find((i) => i.source === "path")!.bin})`
          : `default (${agent.id} — not found on PATH)`,
    },
    ...agent.installs.map((i) => ({ value: i.bin, label: `${i.version ?? "?"} · ${i.bin}` })),
    ...(sel && !known ? [{ value: sel, label: sel }] : []),
    { value: BROWSE, label: picking ? "choosing…" : "browse…" },
  ];
  return (
    <div>
      <Select mono className="w-[380px]" value={sel} options={options} onChange={(v) => void choose(v)} disabled={picking} />
      {msg && <div className={`text-xs mt-1 ${msg.err ? "text-red" : "text-dim"}`}>{msg.text}</div>}
    </div>
  );
}

export default function SettingsView() {
  const { cfg, save } = useConfig();
  const agents = useAgents();
  const [showModelForm, setShowModelForm] = useState(false);
  const [protocol, setProtocol] = useState<ModelConfig["protocol"]>("anthropic-messages");
  const [name, setName] = useState("");
  const [upstream, setUpstream] = useState("");
  const [modelId, setModelId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [headerRows, setHeaderRows] = useState<{ k: string; v: string }[]>([]);

  const addModel = async () => {
    if (!cfg || !name.trim() || !modelId.trim()) return;
    const headers = Object.fromEntries(headerRows.filter((r) => r.k.trim()).map((r) => [r.k.trim(), r.v]));
    const m: ModelConfig = {
      id: newId("m"), name: name.trim(), protocol,
      upstream: upstream.trim() || BASE_URL_EXAMPLES[protocol], modelId: modelId.trim(),
      apiKey: apiKey || undefined, headers: Object.keys(headers).length ? headers : undefined,
    };
    await save({ ...cfg, models: [...cfg.models, m] });
    setName(""); setUpstream(""); setModelId(""); setApiKey(""); setHeaderRows([]); setShowModelForm(false);
  };

  const removeModel = async (id: string) => {
    if (cfg) await save({ ...cfg, models: cfg.models.filter((m) => m.id !== id) });
  };

  const setAgentBin = async (id: string, bin: string) => {
    if (!cfg) return;
    const o = { ...(cfg.agents[id] ?? {}) };
    if (bin.trim()) o.bin = bin.trim(); else delete o.bin;
    await save({ ...cfg, agents: { ...cfg.agents, [id]: o } });
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-5"><h1 className="text-xl">Settings</h1></div>

      <div className="flex items-center gap-2.5 mt-7 mb-2.5">
        <h2 className={`${h2} flex-1`}>Models</h2>
        <button className={btn} onClick={() => setShowModelForm(!showModelForm)}><Plus size={13} /> Add model</button>
      </div>
      {showModelForm && (
        <div className="bg-panel border border-border rounded-[10px] p-3.5 mb-3.5">
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className={fieldLabel}>Name</label>
              <input className={`${input} w-full`} placeholder="my model" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className={fieldLabel}>Protocol</label>
              <Select
                className="w-full"
                value={protocol}
                options={Object.entries(PROTOCOLS).map(([v, label]) => ({ value: v, label }))}
                onChange={(v) => setProtocol(v as ModelConfig["protocol"])}
              />
            </div>
            <div className="col-span-2">
              <label className={fieldLabel}>Base URL</label>
              <input className={`${input} w-full font-mono`} placeholder={BASE_URL_EXAMPLES[protocol]} value={upstream} onChange={(e) => setUpstream(e.target.value)} />
            </div>
            <div>
              <label className={fieldLabel}>Model ID</label>
              <input className={`${input} w-full font-mono`} placeholder={MODEL_ID_EXAMPLES[protocol]} value={modelId} onChange={(e) => setModelId(e.target.value)} />
            </div>
            <div>
              <label className={fieldLabel}>API key</label>
              <input className={`${input} w-full`} placeholder="optional" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            </div>
          </div>
          <HeadersEditor rows={headerRows} setRows={setHeaderRows} />
          <div className="flex gap-2 mt-2.5">
            <button className={btnPrimary} onClick={() => void addModel()}>Save</button>
            <button className={btn} onClick={() => setShowModelForm(false)}>Cancel</button>
          </div>
        </div>
      )}
      <table className={tbl}>
        <thead><tr><th className={th}>Name</th><th className={th}>Protocol</th><th className={th}>Base URL</th><th className={th}>Model ID</th><th className={th}>Headers</th><th className={th}></th></tr></thead>
        <tbody>
          {(cfg?.models ?? []).map((m) => (
            <tr key={m.id}>
              <td className={td}>{m.name}</td>
              <td className={`${td} font-mono`}>{PROTOCOLS[m.protocol] ?? m.protocol}</td>
              <td className={`${td} font-mono text-dim`}>{m.upstream}</td>
              <td className={`${td} font-mono`}>{m.modelId}</td>
              <td className={td}>
                {m.headers && Object.keys(m.headers).length > 0
                  ? Object.entries(m.headers).map(([k, v]) => (
                      <div key={k} className="font-mono text-xs">
                        <span className="text-accent">{k}</span>
                        <span className="text-dim">: {v.length > 32 ? v.slice(0, 32) + "…" : v}</span>
                      </div>
                    ))
                  : <span className="text-dim">—</span>}
              </td>
              <td className={td}>
                <button className={iconBtn} title="Remove" onClick={() => void removeModel(m.id)}><Trash2 size={13} /></button>
              </td>
            </tr>
          ))}
          {(cfg?.models ?? []).length === 0 && (
            <tr><td className={`${td} text-dim`} colSpan={6}>No models yet.</td></tr>
          )}
        </tbody>
      </table>

      <div className="flex items-center gap-2.5 mt-7 mb-2.5">
        <h2 className={`${h2} flex-1`}>Agents</h2>
      </div>
      <table className={tbl}>
        <thead><tr><th className={th}>Agent</th><th className={th}>npm package</th></tr></thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.id}>
              <td className={td}>{a.name}</td>
              <td className={`${td} font-mono text-dim`}>{a.npmPackage ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex items-center gap-2.5 mt-7 mb-2.5">
        <h2 className={`${h2} flex-1`}>Local executor</h2>
        <span className="text-amber text-[12px]">Only used by the local executor. Docker builds an image from the npm package.</span>
      </div>
      <table className={tbl}>
        <thead><tr><th className={th}>Agent</th><th className={th}>Install</th></tr></thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.id}>
              <td className={td}>{a.name}</td>
              <td className={td}>
                <AgentBinCell agent={a} value={cfg?.agents[a.id]?.bin ?? ""} onSave={(b) => setAgentBin(a.id, b)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
