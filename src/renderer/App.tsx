import { useEffect, useRef, useState } from "react";
import { api } from "./lib";
import { Icon } from "./ui/icons";
import logoUrl from "./ui/logo.svg";
import { JobTray } from "./ui/JobTray";
import { ObsView } from "./views/Obs";
import { ProjectsView } from "./views/Projects";
import { SettingsView } from "./views/Settings";
import { Editor } from "./editor/Editor";
import { Quick } from "./views/Quick";

export type Route = { page: "projects" } | { page: "project"; id: string; advanced?: boolean } | { page: "obs" } | { page: "settings" };

export function App() {
  const [route, setRoute] = useState<Route>({ page: "projects" });
  const [version, setVersion] = useState("");
  const [lastProject, setLastProject] = useState<{ id: string; name: string } | null>(null);
  const [notice, setNotice] = useState<{ projectId?: string; name?: string; error?: string } | null>(null);
  useEffect(() => { void api().app.info().then((i) => setVersion(i.version)); }, []);
  // OBS finished a recording and LocalCut started clipping it: jump there unless the user is mid-edit
  const routeRef = useRef(route); routeRef.current = route;
  useEffect(() => api().obs.onAutoClip((e) => {
    const r = routeRef.current;
    if (e.projectId && !(r.page === "project" && r.advanced)) { setLastProject({ id: e.projectId, name: e.name ?? "" }); setRoute({ page: "project", id: e.projectId }); }
    else setNotice(e);
  }), []);
  const banner = notice && (
    <div className={`notice ${notice.error ? "err" : ""}`} role="status">
      {notice.error ? <>Couldn't clip the OBS recording: {notice.error}</> : <>New OBS recording <b>{notice.name}</b> is being clipped.</>}
      {notice.projectId && <button className="btn primary" onClick={() => { setRoute({ page: "project", id: notice.projectId! }); setNotice(null); }}>Open</button>}
      <button className="btn ghost icon" aria-label="Dismiss" onClick={() => setNotice(null)}><Icon name="x" /></button>
    </div>);
  const go = (r: Route) => setRoute(r);
  const open = (id: string, name: string) => { setLastProject({ id, name }); go({ page: "project", id }); };
  const nav = (page: Route["page"], label: string, icon: string, target: Route) => (
    <button className="nav-btn" aria-current={route.page === page ? "page" : undefined} onClick={() => go(target)}><Icon name={icon} />{label}</button>
  );
  if (route.page === "project" && !route.advanced) {
    // simple mode is the default: find moments, tick, export
    return (
      <div className="app editor-mode">
        <Quick key={route.id} projectId={route.id} onHome={() => go({ page: "projects" })} onEditor={() => go({ page: "project", id: route.id, advanced: true })} />
        <JobTray />{banner}
      </div>
    );
  }
  if (route.page === "project") {
    // the editor takes the whole window, like a desktop editor; "Projects" in its top bar goes back
    return (
      <div className="app editor-mode">
        <Editor key={route.id} projectId={route.id} onHome={() => go({ page: "projects" })} onSimple={() => go({ page: "project", id: route.id })} onRenamed={(name) => setLastProject({ id: route.id, name })} />
        <JobTray />{banner}
      </div>
    );
  }
  return (
    <div className="app">
      <aside className="side" aria-label="Main">
        <div className="brand"><img src={logoUrl} width={24} height={24} alt="" />LocalCut</div>
        {nav("projects", "Home", "projects", { page: "projects" })}
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
      <JobTray />{banner}
    </div>
  );
}
