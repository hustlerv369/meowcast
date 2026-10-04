import { h } from "./dom";
import { Bridge, IS_TAURI, onEvent, type ProjectTarget, type WorkAuth, type WorkJob, type WorkProvider } from "../core/bridge";
import { State } from "../core/state";
import type { ViewHost } from "./views";
import { mergeWorkJob, mergeWorkSnapshot } from "../core/work-history";
import { createProjectPicker } from "../components/project-picker";
import "../components/project-picker.css";
import "../components/model-picker.css";

const jobs = new Map<string, WorkJob>();
let registered = false;
let updateView: (() => void) | null = null;
let pickingFolder = false;
export const workHasOpenPicker = () => pickingFolder;
export const workIsRunning = () => [...jobs.values()].some(j => j.status === "running");
const labels = {running:"Running",completed:"Completed",failed:"Failed",cancelled:"Stopped",interrupted:"Interrupted"};
const samePath = (a:string,b:string) => a.replace(/^\\\\\?\\/,"").replace(/[\\/]+$/,"").toLowerCase() === b.replace(/^\\\\\?\\/,"").replace(/[\\/]+$/,"").toLowerCase();

export function buildWork(): ViewHost {
  let projects: ProjectTarget[] = [];
  const pickedProjects: ProjectTarget[] = [];
  let lastActivity: string | null | undefined;
  let auth: WorkAuth | null = null;
  let selectedJob: string | null = null;
  let sending = false;
  let generation = 0;
  let activation = 0;
  let selectionRevision = 0;
  let loginStarted = false;
  let historyKey = "";
  let modelLoading=false;
  let modelReady=false;
  let defaultModel="";
  const model=createProjectPicker({label:"Task model",className:"inline-model work-model",placeholder:"Loading models…",onChange(){render();}});
  const provider = createProjectPicker({label:"Task agent",className:"work-provider",placeholder:"Choose an agent",
    options:[{value:"",disabled:true,label:"Choose an agent"},{value:"codex",label:"Codex",color:"#34D399"},{value:"claude",label:"Claude Code",color:"#F5A06A"}],
    onChange(){error.textContent="";void checkAuth();}});
  const project = createProjectPicker({label:"Task project",className:"work-project",placeholder:"Choose a project",
    onChange(){selectionRevision++;selectedJob=null;error.textContent="";render();}});
  const folder = h("button",{type:"button",class:"work-folder",text:"Folder…",title:"Choose a local project folder"});
  const path = h("div",{class:"work-path"});
  const input = h("textarea",{class:"work-input",placeholder:"What should the agent do in this project?","aria-label":"Task instructions",rows:2,maxlength:16000});
  const run = h("button",{type:"button",class:"btn primary",text:"Run task"});
  const stop = h("button",{type:"button",class:"btn secondary",text:"Stop"});
  const login = h("button",{type:"button",class:"btn secondary",text:"Sign in to Claude Code"});
  const refresh = h("button",{type:"button",class:"work-refresh",text:"Check sign-in"});
  const status = h("span",{class:"work-status",role:"status"});
  const error = h("div",{class:"work-error",role:"alert"});
  const history = createProjectPicker({label:"Task results",className:"work-history",onChange(value){selectedJob=value;render();}});
  const result = h("div",{class:"work-result","aria-live":"polite"});
  const el = h("div",{class:"view work-view"},
    h("div",{class:"work-heading"},h("strong",{text:"Tasks"}),provider.el),model.el,
    h("div",{class:"work-target"},project.el,folder),path,input,
    h("div",{class:"work-controls"},run,stop,login,refresh,status),error,history.el,result);

  const currentProvider = () => provider.value as WorkProvider;
  const current = () => selectedJob ? jobs.get(selectedJob) : [...jobs.values()].filter(j => samePath(j.project,project.value)).sort((a,b)=>b.startedMs-a.startedMs)[0];
  function render() {
    path.textContent = project.value || "Choose a project or its folder.";
    path.title = path.textContent;
    const job = current();
    const running = job?.status === "running";
    const codex=currentProvider()==="codex";
    model.el.hidden=!codex;
    model.el.disabled=sending || !!running || modelLoading || pickingFolder || !modelReady;
    run.disabled = (codex && (!modelReady || modelLoading)) || sending || !auth?.connected || !project.value || !input.value.trim() ||
      [...jobs.values()].some(j => samePath(j.project,project.value) && j.status === "running");
    stop.style.display = running ? "" : "none";
    login.style.display = currentProvider() === "claude" && !auth?.connected ? "" : "none";
    refresh.style.display = !auth?.connected ? "" : "none";
    status.textContent = sending ? "Starting…" : running ? job.step || "Running" : auth?.connected ? "Signed in" : "Sign-in required";
    status.title = auth?.message || "Checking subscription sign-in.";
    const relevant = [...jobs.values()].filter(j => samePath(j.project,project.value)).sort((a,b)=>b.startedMs-a.startedMs);
    const nextKey=JSON.stringify(relevant.map(j=>[j.id,j.status,j.prompt]));
    if(historyKey!==nextKey){
      historyKey=nextKey;
      history.setOptions(relevant.map(j=>({value:j.id,label:j.prompt.slice(0,100),detail:`${labels[j.status]} · ${j.provider === "codex" ? "Codex" : "Claude Code"}`,color:j.provider === "codex" ? "#34D399" : "#F5A06A"})));
    }
    history.el.style.display = relevant.length ? "" : "none";
    if (selectedJob && relevant.some(j=>j.id===selectedJob)) history.value = selectedJob;
    const nextText = job ? job.error || job.text || job.step || labels[job.status] : "The agent can edit files in this folder and run commands under your Windows account.";
    if(result.textContent!==nextText){result.textContent=nextText;result.scrollTop=result.scrollHeight;}
    result.classList.toggle("work-failed",job?.status === "failed" || job?.status === "interrupted");
  }
  function addProject(target:ProjectTarget) {
    selectionRevision++;
    if (!projects.some(p=>samePath(p.path,target.path))) projects.push(target);
    project.setOptions([{value:"",label:"Choose a project"},...projects.map(p=>({value:p.path,label:p.label,detail:p.path}))]);
    project.value=target.path;
    selectedJob=null;render();
  }
  async function checkAuth() {
    const token=++generation;auth=null;render();
    if(!provider.value){error.textContent="Choose Codex or Claude Code to work in this folder.";return;}
    modelLoading=currentProvider()==="codex";modelReady=false;render();
    try {
      const next=await Bridge.workAuth(currentProvider());
      if(token!==generation)return;
      auth=next;
      if(currentProvider()==="codex"){
        const catalog=await Bridge.chatStatus("");
        if(token!==generation)return;
        defaultModel=catalog.model;
        model.setOptions([{value:"",label:`Follow Codex default · ${defaultModel}`},...(catalog.models??[]).map(m=>({value:m.id,label:m.label}))]);
        modelReady=catalog.connected && (catalog.models??[]).some(m=>m.id===defaultModel);
        if(!modelReady)error.textContent="No available Codex model. Check sign-in and try again.";
      }
    }
    catch(e) { if(token===generation)error.textContent=String(e); }
    if(token===generation){modelLoading=false;render();}
  }
  async function activate() {
    const token=++activation;
    const revision=selectionRevision;
    const task=State.focusTask;
    const activity=task?.activityId??task?.id??null;
    const previous=lastActivity===activity ? project.value : "";
    lastActivity=activity;
    provider.value=task?.source === "claudeDesktop" || task?.source === "claudeCode" ? "claude" : !task || task.source === "codex" ? "codex" : "";
    error.textContent="";
    try {
      const all=await Bridge.projectTargets();
      const requestedMs=Date.now();const snapshot=await Bridge.workList()??[];
      const target=task?.activityId ? await Bridge.projectSelected(task.activityId) : task?.sessionCwd ? {path:task.sessionCwd,label:task.name} : null;
      if(token!==activation)return;
      mergeWorkSnapshot(jobs,snapshot,requestedMs);
      projects=all??[];
      for(const picked of pickedProjects)if(!projects.some(p=>samePath(p.path,picked.path)))projects.push(picked);
      const latest=project.value;
      project.setOptions([{value:"",label:"Choose a project"},...projects.map(p=>({value:p.path,label:p.label,detail:p.path}))]);
      if(selectionRevision!==revision)project.value=projects.some(p=>samePath(p.path,latest)) ? latest : "";
      else if(previous && projects.some(p=>samePath(p.path,previous)))project.value=previous;
      else if(target)addProject(target);else if(projects.length)project.value=projects[0].path;
      selectedJob=null;
    }catch(e){if(token!==activation)return;error.textContent=String(e);}
    if(token!==activation)return;
    await checkAuth();render();
  }
  if(!registered && IS_TAURI){
    registered=true;
    void onEvent<WorkJob>("project-work",job=>{
      mergeWorkJob(jobs,job);updateView?.();
      // Closing the assistant never interrupts a job and never reopens it.
      State.notify();
    });
  }
  updateView=render;
  folder.addEventListener("click",()=>{void (async()=>{
    if(pickingFolder)return;
    pickingFolder=true;render();
    try{
      const target=await Bridge.projectPick();
      if(target){
        if(!pickedProjects.some(p=>samePath(p.path,target.path)))pickedProjects.push(target);
        addProject(target);
      }
    }catch(e){error.textContent=String(e);}
    finally{pickingFolder=false;render();State.notify();}
  })();});
  input.addEventListener("input",render);
  input.addEventListener("keydown",e=>{if(e.key === "Enter" && (e.ctrlKey || e.metaKey)){e.preventDefault();if(!run.disabled)run.click();}});
  refresh.addEventListener("click",()=>void checkAuth());
  login.addEventListener("click",()=>{void (async()=>{
    if(loginStarted)return;loginStarted=true;
    try{await Bridge.claudeLogin();error.textContent="Finish signing in in your browser, then choose Check sign-in.";}catch(e){error.textContent=String(e);}
    finally{loginStarted=false;}
  })();});
  run.addEventListener("click",()=>{void (async()=>{
    if(run.disabled)return;
    const submitted={project:project.value,provider:currentProvider(),draft:input.value,model:model.value,revision:selectionRevision};
    const stillCurrent=()=>selectionRevision===submitted.revision && samePath(project.value,submitted.project) && currentProvider()===submitted.provider && input.value===submitted.draft;
    sending=true;error.textContent="";render();
    try{
      const job=await Bridge.workStart(submitted.project,submitted.provider,submitted.draft.trim(),`work-${crypto.randomUUID()}`,submitted.provider==="codex" ? submitted.model : undefined);
      if(job){
        mergeWorkJob(jobs,job);
        if(stillCurrent()){selectedJob=job.id;input.value="";}
      }
    }catch(e){if(stillCurrent())error.textContent=String(e);}
    finally{sending=false;render();}
  })();});
  stop.addEventListener("click",()=>{void (async()=>{const job=current();if(job)await Bridge.workCancel(job.id);})().catch(e=>{error.textContent=String(e);});});
  return {el,sync(){render();},focus(){void activate();input.focus();}};
}
