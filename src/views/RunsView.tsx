import { Trash2 } from "lucide-react";
import { api, useAgents, useConfig, useRuns } from "../lib/api";
import { tbl, th, td, statusCls, flagChipCls, iconBtn, useConfirm } from "../components/ui";

export default function RunsView({ onOpen }: { onOpen: (id: string) => void }) {
  const { runs, refresh } = useRuns();
  const { cfg } = useConfig();
  const agents = useAgents();
  const { confirm, confirmEl } = useConfirm();

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <h1 className="text-xl">Runs</h1>
      </div>
      {runs.length === 0 && (
        <div className="text-dim text-[13px] px-4 py-8 text-center bg-panel border border-border rounded-[10px]">
          No runs yet. Configure a model and an agent in Settings, create a task in Tasks, then hit New run.
        </div>
      )}
      {runs.length > 0 && (
        <table className={tbl}>
          <thead>
            <tr>
              <th className={th}>Run</th><th className={th}>Task</th><th className={th}>Agent</th>
              <th className={th}>Model</th><th className={th}>Flags</th><th className={th}>Requests</th>
              <th className={th}>Status</th><th className={th}>Started</th><th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const task = cfg?.tasks.find((t) => t.id === r.taskId);
              const agent = agents.find((a) => a.id === r.agentId);
              const model = cfg?.models.find((m) => m.id === r.modelId);
              return (
                <tr key={r.id} className="cursor-pointer hover:[&>td]:bg-panel2" onClick={() => onOpen(r.id)}>
                  <td className={`${td} font-mono`}>{r.id}</td>
                  <td className={td}>{task?.name ?? r.taskName ?? r.taskId}</td>
                  <td className={td}>{agent?.name ?? r.agentId} <span className="text-dim">{r.agentVersion}</span></td>
                  <td className={td}>{model?.modelId ?? r.modelName ?? r.modelId}</td>
                  <td className={td}>
                    {Object.entries(r.flags).map(([k, v]) => (
                      <span key={k} className={flagChipCls(v)}>{k}={v ? "on" : "off"}</span>
                    ))}
                  </td>
                  <td className={td}>{r.requestCount ?? 0}</td>
                  <td className={td}><span className={statusCls(r.status)}>{r.status}</span></td>
                  <td className={`${td} text-dim`}>{r.createdAt?.slice(0, 19).replace("T", " ")}</td>
                  <td className={td}>
                    <button
                      className={iconBtn}
                      title={r.status === "running" || r.status === "pending" ? "Stop the run first" : "Delete run"}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (r.status === "running" || r.status === "pending") return;
                        void confirm("Delete run?", `${r.id} — captured bodies and the run directory will be removed.`).then((yes) => {
                          if (yes) void api.deleteRun(r.id).then(refresh);
                        });
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {confirmEl}
    </div>
  );
}
