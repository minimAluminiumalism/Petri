import { useEffect, useState } from "react";
import clsx from "clsx";
import { Check, Play, Plus } from "lucide-react";
import { api, useAgents, useConfig, PROTOCOLS } from "../lib/api";
import { btn, btnPrimary, Select } from "../components/ui";

const label = "text-xs text-dim mb-1.5 uppercase tracking-wide";

export default function NewRunView({ onLaunch, onNavigate }: { onLaunch: (runId: string) => void; onNavigate: (page: "tasks" | "settings") => void }) {
  const { cfg } = useConfig();
  const [taskId, setTaskId] = useState("");
  const [agentKey, setAgentKey] = useState("");
  const [version, setVersion] = useState("");
  const [available, setAvailable] = useState<Record<string, { latest: string; versions: string[] }>>({});
  const [modelId, setModelId] = useState("");
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [executor, setExecutor] = useState("docker");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.agentVersions().then(setAvailable).catch(() => undefined);
  }, []);

  const tasks = cfg?.tasks ?? [];
  const agents = useAgents();
  const models = cfg?.models ?? [];

  const task = tasks.find((t) => t.id === taskId) ?? tasks[0];
  const agent = agents.find((a) => a.id === agentKey) ?? agents[0];
  const model = models.find((m) => m.id === modelId) ?? models[0];
  const agentIdx = agent ? agents.indexOf(agent) : -1;
  const features = agent?.features ?? [];
  const defaultVersion = agent ? (available[agent.id]?.latest ?? "latest") : "";
  const agentVersion = version.trim() || defaultVersion;

  const launch = async () => {
    if (!task || !agent || !model) return;
    setBusy(true);
    setErr(null);
    try {
      const run = await api.createRun({ taskId: task.id, agentId: agent.id, agentVersion, modelId: model.id, flags, executor });
      onLaunch(run.id);
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  };

  const missing: string[] = [];
  if (tasks.length === 0) missing.push("task");
  if (agents.length === 0) missing.push("agent");
  if (models.length === 0) missing.push("model");

  return (
    <div>
      <div className="flex items-center gap-3 mb-5"><h1 className="text-xl">New run</h1></div>

      {missing.length > 0 && (
        <div className="text-amber bg-amber-bg border border-border rounded-[10px] px-3.5 py-2.5 mb-4 text-[13px] max-w-3xl">
          Missing {missing.join(", ")} — set them up in Settings / Tasks first.
        </div>
      )}

      <div className="bg-panel border border-border rounded-[10px] p-4 max-w-3xl">
        <div className="mb-4">
          <div className={label}>Task</div>
          {tasks.length === 0 ? (
            <div className="flex items-center gap-3">
              <span className="text-dim text-[13px]">No tasks yet</span>
              <button className={btn} onClick={() => onNavigate("tasks")}><Plus size={13} /> New task</button>
            </div>
          ) : (
            <Select
              className="w-full"
              value={task?.id ?? ""}
              options={tasks.map((t) => ({ value: t.id, label: t.name }))}
              onChange={setTaskId}
            />
          )}
          {task && (
            <div className="mt-1.5 text-[12.5px] px-2.5 py-2 bg-panel2 rounded-md text-dim">
              {task.prompt} <span className="font-mono">· {task.workdir}</span>
            </div>
          )}
        </div>

        <div className="mb-4">
          <div className={label}>Agent</div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
            {agents.map((a, i) => (
              <button
                key={a.id}
                onClick={() => { setAgentKey(a.id); setVersion(""); setFlags({}); }}
                className={clsx(
                  "border rounded-lg px-3 py-2.5 cursor-pointer text-left text-text transition-colors",
                  i === agentIdx ? "border-accent bg-accent-soft" : "border-border bg-panel hover:border-accent hover:bg-panel2",
                )}
              >
                <div className={clsx("font-semibold text-[13.5px] mb-0.5", i === agentIdx && "text-accent")}>{a.name}</div>
                <div className="font-mono text-xs text-dim">
                  {a.id === agent?.id ? agentVersion : (available[a.id]?.latest ?? "latest")}
                </div>
              </button>
            ))}
          </div>
          {agent && (
            <div className="mt-2.5 flex items-center gap-2 text-[13px]">
              <span className="text-dim">version</span>
              <Select
                mono
                value={agentVersion}
                options={[
                  ...(available[agent.id]?.versions ?? ["latest"]).map((v) => ({
                    value: v,
                    label: `${v}${v === available[agent.id]?.latest ? " (latest)" : ""}`,
                  })),
                  ...(agentVersion && !(available[agent.id]?.versions ?? ["latest"]).includes(agentVersion)
                    ? [{ value: agentVersion, label: agentVersion }]
                    : []),
                ]}
                onChange={setVersion}
              />
            </div>
          )}
          {agent && features.length > 0 && (
            <div className="mt-2.5 flex items-center gap-2 text-[13px]">
              <span className="text-dim">features</span>
              <div className="flex flex-wrap gap-1.5">
                {features.map((f) => {
                  const on = flags[f.key] ?? f.enabled;
                  return (
                    <button
                      key={f.key}
                      title={f.since ? `requires ≥ ${f.since}` : undefined}
                      onClick={() => setFlags({ ...flags, [f.key]: !on })}
                      className={clsx(
                        "inline-flex items-center gap-1 border rounded-md px-2.5 py-1 text-[12.5px] cursor-pointer transition-colors",
                        on ? "border-accent bg-accent-soft text-accent" : "border-border bg-panel text-dim hover:border-accent hover:text-text",
                      )}
                    >
                      {on && <Check size={11} />}
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="mb-4">
          <div className={label}>Executor</div>
          <Select
            className="w-full"
            value={executor}
            options={[{ value: "docker", label: "docker" }, { value: "local", label: "local" }]}
            onChange={setExecutor}
          />
        </div>

        <div className="mb-4">
          <div className={label}>Model</div>
          {models.length === 0 ? (
            <div className="flex items-center gap-3">
              <span className="text-dim text-[13px]">No models yet</span>
              <button className={btn} onClick={() => onNavigate("settings")}><Plus size={13} /> Add model</button>
            </div>
          ) : (
            <Select
              className="w-full"
              value={model?.id ?? ""}
              options={models.map((m) => ({ value: m.id, label: `${m.modelId} · ${PROTOCOLS[m.protocol] ?? m.protocol}` }))}
              onChange={setModelId}
            />
          )}
        </div>

        {err && <div className="text-red text-[12.5px] mb-2">{err}</div>}

        <div className="mt-4">
          <button className={btnPrimary} disabled={busy || missing.length > 0} onClick={() => void launch()}>
            <Play size={13} /> {busy ? "Launching…" : "Launch"}
          </button>
        </div>
      </div>
    </div>
  );
}
