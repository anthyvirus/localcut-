import { useEffect, useState } from "react";
import { api } from "./lib";
import { Icon } from "./ui/icons";
import { JobTray } from "./ui/JobTray";
import { ObsView } from "./views/Obs";
import { ProjectsView } from "./views/Projects";
import { SettingsView } from "./views/Settings";
import { Editor } from "./editor/Editor";

export type Route = { page: "projects" } | { page: "project"; id: string } | { page: "obs" } | { page: "settings" };

export function App() {
  const [route, setRoute] = useState<Route>({ page: "projects" });
  const [version, setVersion] = useState("");
  const [lastProject, setLastProject] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => { void api().app.info().then((i) => setVersion(i.version)); }, []);
  const go = (r: Route) => setRoute(r);
  const open = (id: string, name: string) => { setLastProject({ id, name }); go({ page: "project", id }); };
  const nav = (page: Route["page"], label: string, icon: string, target: Route) => (
    <button className="nav-btn" aria-current={route.page === page ? "page" : undefined} onClick={() => go(target)}><Icon name={icon} />{label}</button>
  );
  if (route.page === "project") {
    // the editor takes the whole window, like a desktop editor; "Projects" in its top bar goes back
    return (
      <div className="app editor-mode">
        <Editor key={route.id} projectId={route.id} onHome={() => go({ page: "projects" })} onRenamed={(name) => setLastProject({ id: route.id, name })} />
        <JobTray />
      </div>
    );
  }
  return (
    <div className="app">
      <aside className="side" aria-label="Main">
        <div className="brand"><Icon name="logo" size={18} />LocalCut</div>
        {nav("projects", "Projects", "projects", { page: "projects" })}
        {lastProject && (<>
          <div className="side-sep" />
          <div className="side-label">Open project</div>
          <button className="nav-btn" onClick={() => go({ page: "project", id: lastProject.id })}>
            <Icon name="scissors" /><span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{lastProject.name}</span>
          </button>
        </>)}
        <div className="side-sep" />
        {nav("obs", "OBS", "obs", { page: "obs" })}
        {nav("settings", "Settings", "settings", { page: "settings" })}
        <p className="side-foot">Everything stays on this computer.{version && <><br />v{version}</>}</p>
      </aside>
      <main className="main">
        {route.page === "projects" && <ProjectsView onOpen={open} />}
        {route.page === "obs" && <ObsView onImport={async (paths) => {
          const p = lastProject ? lastProject : await api().projects.create("OBS recording").then((x) => ({ id: x.id, name: x.name }));
          await api().media.import(p.id, paths);
          open(p.id, p.name);
        }} />}
        {route.page === "settings" && <SettingsView />}
      </main>
      <JobTray />
    </div>
  );
}
