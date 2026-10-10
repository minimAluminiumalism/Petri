import { useEffect, useState } from "react";
import clsx from "clsx";
import { FlaskConical, History, ListChecks, SlidersHorizontal, Plus } from "lucide-react";
import RunsView from "./views/RunsView";
import RunDetailView from "./views/RunDetailView";
import TasksView from "./views/TasksView";
import NewRunView from "./views/NewRunView";
import SettingsView from "./views/SettingsView";

type View =
  | { page: "runs" }
  | { page: "run"; id: string }
  | { page: "tasks" }
  | { page: "newrun" }
  | { page: "settings" };

function pathToView(pathname: string): View {
  const m = pathname.match(/^\/runs\/([^/]+)/);
  if (m) return { page: "run", id: decodeURIComponent(m[1]) };
  if (pathname === "/tasks") return { page: "tasks" };
  if (pathname === "/new") return { page: "newrun" };
  if (pathname === "/settings") return { page: "settings" };
  return { page: "runs" };
}

function viewToPath(v: View): string {
  switch (v.page) {
    case "run": return `/runs/${encodeURIComponent(v.id)}`;
    case "tasks": return "/tasks";
    case "newrun": return "/new";
    case "settings": return "/settings";
    default: return "/";
  }
}

export default function App() {
  const [view, setView] = useState<View>(() => pathToView(window.location.pathname));

  const nav = (v: View) => {
    const path = viewToPath(v);
    if (path !== window.location.pathname) window.history.pushState(null, "", path);
    setView(v);
  };

  useEffect(() => {
    const onPop = () => setView(pathToView(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-border bg-panel px-3.5 py-5 flex flex-col gap-6 sticky top-0 h-screen">
        <div className="flex items-center gap-2 font-bold text-base">
          <FlaskConical size={18} className="text-accent" />
          Petri<span className="text-dim text-xs font-normal">agents under glass</span>
        </div>
        <button
          className="w-full inline-flex items-center justify-center gap-1.5 bg-accent text-white text-[13px] font-medium rounded-lg px-3.5 py-1.5 cursor-pointer hover:brightness-105"
          onClick={() => nav({ page: "newrun" })}
        >
          <Plus size={14} /> New run
        </button>
        <nav className="flex flex-col gap-0.5">
          {([
            { key: "runs", icon: History, label: "Runs" },
            { key: "tasks", icon: ListChecks, label: "Tasks" },
            { key: "settings", icon: SlidersHorizontal, label: "Settings" },
          ] as const).map(({ key, icon: Icon, label }) => {
            const active =
              (key === "runs" && (view.page === "runs" || view.page === "run")) ||
              view.page === key;
            return (
              <button
                key={key}
                onClick={() => nav({ page: key })}
                className={clsx(
                  "flex items-center gap-2.5 text-left rounded-lg px-2.5 py-2 text-sm cursor-pointer",
                  active ? "bg-accent-soft text-accent font-medium" : "hover:bg-panel2",
                )}
              >
                <Icon size={15} /> {label}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto text-xs flex flex-col gap-1 p-2.5 rounded-lg bg-panel2">
          <div className="text-green flex items-center gap-1.5">
            <span className="w-[7px] h-[7px] rounded-full bg-green" /> proxy listening
          </div>
          <div className="font-mono text-dim">http://127.0.0.1:8787</div>
        </div>
      </aside>
      <main className="flex-1 min-w-0 px-8 py-6 max-w-[1500px]">
        {view.page === "runs" && <RunsView onOpen={(id) => nav({ page: "run", id })} />}
        {view.page === "run" && <RunDetailView runId={view.id} onBack={() => nav({ page: "runs" })} />}
        {view.page === "tasks" && <TasksView />}
        {view.page === "newrun" && <NewRunView onLaunch={(id) => nav({ page: "run", id })} onNavigate={(p) => nav({ page: p })} />}
        {view.page === "settings" && <SettingsView />}
      </main>
    </div>
  );
}
