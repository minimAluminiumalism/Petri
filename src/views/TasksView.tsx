import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { newId, useConfig, useRuns } from "../lib/api";
import { tbl, th, td, btn, btnPrimary, input, iconBtn } from "../components/ui";

export default function TasksView() {
  const { cfg, save } = useConfig();
  const { runs } = useRuns();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [workdir, setWorkdir] = useState("");
  const [prompt, setPrompt] = useState("");

  const add = async () => {
    if (!cfg || !name.trim()) return;
    await save({ ...cfg, tasks: [...cfg.tasks, { id: newId("t"), name: name.trim(), prompt, workdir }] });
    setName(""); setWorkdir(""); setPrompt(""); setShowForm(false);
  };

  const remove = async (id: string) => {
    if (!cfg) return;
    await save({ ...cfg, tasks: cfg.tasks.filter((t) => t.id !== id) });
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <h1 className="text-xl">Tasks</h1>
        <span className="flex-1" />
        <button className={btnPrimary} onClick={() => setShowForm(!showForm)}>
          <Plus size={13} /> New task
        </button>
      </div>

      {showForm && (
        <div className="bg-panel border border-border rounded-[10px] p-3.5 mb-4">
          <div className="text-xs text-dim mb-2.5">New task</div>
          <div className="flex gap-2 flex-wrap">
            <input className={`${input} w-52`} placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className={`${input} w-64`} placeholder="workdir / repo path" value={workdir} onChange={(e) => setWorkdir(e.target.value)} />
          </div>
          <div className="mt-2">
            <textarea className={`${input} w-full`} rows={3} placeholder="prompt — make it trigger tool calls, otherwise there is nothing to observe" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </div>
          <div className="flex gap-2 mt-2">
            <button className={btnPrimary} onClick={() => void add()}>Save</button>
            <button className={btn} onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      <table className={tbl}>
        <thead><tr><th className={th}>Name</th><th className={th}>Prompt</th><th className={th}>Workdir</th><th className={th}>Runs</th><th className={th}></th></tr></thead>
        <tbody>
          {(cfg?.tasks ?? []).map((t) => (
            <tr key={t.id}>
              <td className={td}>{t.name}</td>
              <td className={`${td} text-dim`}>{t.prompt}</td>
              <td className={`${td} font-mono text-dim`}>{t.workdir}</td>
              <td className={`${td} text-dim`}>{runs.filter((r) => r.taskId === t.id).length}</td>
              <td className={td}>
                <button className={iconBtn} title="Remove" onClick={() => void remove(t.id)}><Trash2 size={13} /></button>
              </td>
            </tr>
          ))}
          {(cfg?.tasks ?? []).length === 0 && (
            <tr><td className={`${td} text-dim`} colSpan={5}>No tasks yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
