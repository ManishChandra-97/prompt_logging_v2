"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { bootstrap, idealActions, idealReplyTemplate, localRequest } from "./local-evaluator";

type Doc = Record<string, any>;
type Page = "Dashboard" | "Prompts" | "Evaluation Workspace" | "Results" | "Settings";

const nav: Page[] = ["Dashboard", "Prompts", "Evaluation Workspace", "Results", "Settings"];

function Badge({ value }: { value?: string | null }) {
  const display = value ?? "NOT RUN";
  return <span className={`badge ${display.toLowerCase().replaceAll("_", "-")}`}>{display.replaceAll("_", " ")}</span>;
}

function Header({ eyebrow, title, subtitle, children }: { eyebrow: string; title: string; subtitle: string; children?: React.ReactNode }) {
  return <div className="top"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p className="sub">{subtitle}</p></div>{children && <div className="top-meta">{children}</div>}</div>;
}

function Select({ value, onChange, items, empty = "Not selected" }: { value: string; onChange: (value: string) => void; items: Doc[]; empty?: string }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)}><option value="">{empty}</option>{items.map((item) => <option value={item.id} key={item.id}>{item.name} v{item.version}{item.active ? " — active" : ""}</option>)}</select>;
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const body = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function readFile(event: ChangeEvent<HTMLInputElement>, setValue: (value: string) => void) {
  const file = event.target.files?.[0];
  if (file) void file.text().then(setValue);
}

export default function Home() {
  const [page, setPage] = useState<Page>("Dashboard");
  const [data, setData] = useState<Doc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [resultRuns, setResultRuns] = useState<Doc[]>([]);

  const refresh = async () => {
    try {
      setData(bootstrap());
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load the local evaluator.");
    }
  };
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);
  const request = async (url: string, options: RequestInit = {}, message?: string) => {
    try {
      const output = await localRequest<Doc>(url, options);
      if (message) setToast(message);
      await refresh();
      return output;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Request failed");
      return null;
    }
  };
  const openResults = (runs: Doc[]) => { setResultRuns(runs); setPage("Results"); };

  if (!data) return <main className="loading"><div className="brand"><span className="brand-mark">◈</span> CPU EVALUATOR</div><p>{error ?? "Loading your local workspace…"}</p><button className="button primary" onClick={() => void refresh()}>Retry</button></main>;

  const prompts = data.prompts ?? [];
  return <div className="shell"><aside className="side"><div className="brand"><span className="brand-mark">◈</span><span>CPU EVALUATOR</span></div><div className="nav-label">WORKBENCH</div>{nav.map((item) => <button key={item} className={`nav ${page === item ? "active" : ""}`} onClick={() => setPage(item)}>{item}</button>)}<div className="side-foot"><span className="security-dot">●</span> local-first evaluation<br />CPU intake</div></aside><main className="content">{error && <div className="notice" style={{ marginBottom: 14 }}>{error} <button className="button tiny" onClick={() => setError(null)}>Dismiss</button></div>}{page === "Dashboard" && <Dashboard data={data} setPage={setPage} />}{page === "Prompts" && <Prompts prompts={prompts} onRequest={request} />}{page === "Evaluation Workspace" && <Workspace data={data} prompts={prompts} onRequest={request} openResults={openResults} />}{page === "Results" && <Results runs={resultRuns.length ? resultRuns : data.runs ?? []} />}{page === "Settings" && <Settings />}</main>{toast && <div className="toast">{toast}</div>}</div>;
}

function Dashboard({ data, setPage }: { data: Doc; setPage: (page: Page) => void }) {
  const dashboard = data.dashboard;
  return <><Header eyebrow="OVERVIEW" title="Conversation evaluation, grounded in turns." subtitle="Add the policy prompts that define ideal behavior, import actual-agent data, then inspect one score per metric for each conversation."><span className="pill">● local service connected</span></Header><div className="grid stats"><Stat label="DATASETS" value={String(data.datasets?.length ?? 0)} detail="CSV turn-wise imports" /><Stat label="CUSTOM METRICS" value={String(data.metrics?.length ?? 0)} detail="none auto-selected" /><Stat label="LATEST SCORE" value={dashboard.latestScore == null ? "—" : `${Math.round(dashboard.latestScore * 100)}%`} detail="only selected metrics count" /><Stat label="RESULTS" value={String(data.runs?.length ?? 0)} detail="conversation-level records" /></div><section className="section card panel"><h2 className="section-title">Start with prompts</h2><p className="section-desc">Save a global policy and optional node policy, then upload caller and actual-agent turns. The selected prompts generate an editable ideal scenario table before analysis.</p><button className="button primary" style={{ marginTop: 14 }} onClick={() => setPage("Prompts")}>Add prompt sources</button></section></>;
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="card stat"><label>{label}</label><strong>{value}</strong><span>{detail}</span></div>;
}

function Prompts({ prompts, onRequest }: { prompts: Doc[]; onRequest: (path: string, options?: RequestInit, message?: string) => Promise<Doc | null> }) {
  const [source, setSource] = useState<"global" | "node">("global");
  const [name, setName] = useState("Global call policy");
  const [nodeName, setNodeName] = useState("intake");
  const [text, setText] = useState("");

  useEffect(() => {
    const next = prompts.find((item) => item.source === source && item.active) ?? prompts.find((item) => item.source === source);
    setName(next?.name ?? (source === "global" ? "Global call policy" : "Node policy"));
    setNodeName(next?.node_name ?? "intake");
    setText(next?.text ?? "");
  }, [source, prompts]);

  const save = () => {
    if (!name.trim() || !text.trim() || (source === "node" && !nodeName.trim())) return;
    void onRequest("/api/prompts", { method: "POST", body: JSON.stringify({ name, source, node_name: source === "node" ? nodeName : null, text, set_active: true }) }, `${source === "global" ? "Global" : "Node"} prompt saved and set active.`);
  };

  return <><Header eyebrow="POLICY" title="Global & node prompts" subtitle="Create versioned prompt sources. The selected versions generate the ideal scenario table; global policy is required and a node policy is optional."><span className="pill">{prompts.length} saved</span></Header><div className="tabs"><button className={`tab ${source === "global" ? "active" : ""}`} onClick={() => setSource("global")}>Global prompt</button><button className={`tab ${source === "node" ? "active" : ""}`} onClick={() => setSource("node")}>Node prompt</button></div><div className="split"><section className="card panel"><div className="form-grid"><div className="field"><label>Name</label><input value={name} onChange={(event) => setName(event.target.value)} placeholder={source === "global" ? "e.g. Main call policy" : "e.g. Intake node"} /></div><div className="field"><label>Node name</label><input disabled={source === "global"} value={nodeName} onChange={(event) => setNodeName(event.target.value)} placeholder="e.g. intake" /></div><div className="field full"><label>{source === "global" ? "Global prompt" : "Node prompt"}</label><textarea className="editor" value={text} spellCheck={false} onChange={(event) => setText(event.target.value)} placeholder="Add the instructions that should drive ideal behavior…" /></div></div><button className="button primary" style={{ marginTop: 12 }} disabled={!name.trim() || !text.trim() || (source === "node" && !nodeName.trim())} onClick={save}>Save & set active</button></section><section className="card panel"><h3>Version ledger</h3>{prompts.filter((item) => item.source === source).length ? <div className="metric-list" style={{ marginTop: 10 }}>{prompts.filter((item) => item.source === source).map((item) => <div className="metric" key={item.id}><div><h4>{item.name} <span className="fine">v{item.version}</span></h4><p>{item.source === "node" ? `${item.node_name} · ` : ""}{new Date(item.created_at).toLocaleString()}</p></div><Badge value={item.active ? "ACTIVE" : "SAVED"} /></div>)}</div> : <div className="empty">No {source} prompts saved yet.</div>}</section></div></>;
}

function Workspace({ data, prompts, onRequest, openResults }: { data: Doc; prompts: Doc[]; onRequest: (path: string, options?: RequestInit, message?: string) => Promise<Doc | null>; openResults: (runs: Doc[]) => void }) {
  const [name, setName] = useState("CPU intake dataset");
  const [turnDataCsv, setTurnDataCsv] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [working, setWorking] = useState<Doc | null>(null);
  const [metricName, setMetricName] = useState("");
  const [metricPrompt, setMetricPrompt] = useState("");
  const [metricThreshold, setMetricThreshold] = useState(.8);
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);
  const [metricPicker, setMetricPicker] = useState("");
  const [defaultsInitialized, setDefaultsInitialized] = useState(false);
  const [running, setRunning] = useState(false);
  const [generatingIdeals, setGeneratingIdeals] = useState(false);
  const [globalId, setGlobalId] = useState("");
  const [nodeId, setNodeId] = useState("");
  const datasets = data.datasets ?? [];
  const metrics = data.metrics ?? [];
  const globals = prompts.filter((item: Doc) => item.source === "global");
  const nodes = prompts.filter((item: Doc) => item.source === "node");
  const selectedDataset = working ?? datasets.find((item: Doc) => item.id === datasetId);
  const selectedGlobal = globals.find((item: Doc) => item.id === globalId) ?? globals.find((item: Doc) => item.active) ?? globals[0];
  const selectedNode = nodes.find((item: Doc) => item.id === nodeId);
  const evaluationMetrics = metrics.filter((item: Doc) => selectedMetrics.includes(item.id));
  const availableMetrics = metrics.filter((item: Doc) => !selectedMetrics.includes(item.id));
  useEffect(() => {
    if (!defaultsInitialized && metrics.length) {
      setSelectedMetrics(metrics.filter((item: Doc) => item.isDefault).map((item: Doc) => item.id));
      setDefaultsInitialized(true);
    }
  }, [metrics, defaultsInitialized]);
  useEffect(() => {
    if (!globals.some((item: Doc) => item.id === globalId)) setGlobalId(globals.find((item: Doc) => item.active)?.id ?? globals[0]?.id ?? "");
  }, [globals, globalId]);

  async function createDataset() {
    if (!selectedGlobal?.id) return;
    setGeneratingIdeals(true);
    const result = await onRequest("/api/datasets", { method: "POST", body: JSON.stringify({ name, turn_data_csv: turnDataCsv, global_prompt_id: selectedGlobal.id, node_prompt_id: selectedNode?.id ?? null }) }, "Ideal behavior table generated from the selected prompts.");
    setGeneratingIdeals(false);
    if (result) { setWorking(result); setDatasetId(result.id); }
  }
  async function addMetric() {
    if (!metricName.trim() || !metricPrompt.trim()) return;
    const result = await onRequest("/api/metrics", { method: "POST", body: JSON.stringify({ name: metricName, type: "conversational_geval", description: "User-authored conversation metric", enabled: false, threshold: metricThreshold, weight: 1, judge_model: "gpt-4.1-mini", criteria: metricPrompt, evaluation_steps: null, strict_mode: false }) }, "Metric added to this evaluation list.");
    if (result) { setSelectedMetrics((items) => [...items, result.id]); setMetricName(""); setMetricPrompt(""); }
  }
  const addPickedMetric = () => {
    if (!metricPicker) return;
    setSelectedMetrics((items) => [...items, metricPicker]);
    setMetricPicker("");
  };
  async function analyze() {
    if (!selectedDataset?.id) return;
    setRunning(true);
    const result = await onRequest(`/api/datasets/${selectedDataset.id}/analyze`, { method: "POST", body: JSON.stringify({ global_prompt_id: selectedGlobal?.id ?? null, node_prompt_id: selectedNode?.id ?? null, metric_ids: selectedMetrics, mode: "full" }) });
    setRunning(false);
    if (result) openResults(result.runs);
  }
  async function regenerateIdeals() {
    if (!selectedDataset?.id || !selectedGlobal?.id) return;
    setGeneratingIdeals(true);
    const result = await onRequest(`/api/datasets/${selectedDataset.id}/generate-ideals`, { method: "POST", body: JSON.stringify({ global_prompt_id: selectedGlobal.id, node_prompt_id: selectedNode?.id ?? null, preserve_manual_overrides: true }) }, "Ideal behavior regenerated from the selected prompts. Manual edits were retained.");
    setGeneratingIdeals(false);
    if (result) setWorking(result);
  }

  return <><Header eyebrow="ONE WORKSPACE" title="Datasets, prompts & analysis" subtitle="Choose the prompt versions that generate each ideal scenario, then compare actual agent turns against the editable ideal table."><Badge value={data.judgeConfigured ? "LLM READY" : "LOCAL ONLY"} /></Header><section className="card panel"><h3>1. Prompt sources</h3><p className="section-desc">A global prompt is required. Add or revise prompt versions in the Prompts section, then select the policy that should generate the ideal scenarios. Node prompts provide optional node-specific instructions.</p><div className="form-grid" style={{ marginTop: 12 }}><div className="field"><label>Global prompt</label><Select value={selectedGlobal?.id ?? ""} onChange={setGlobalId} items={globals} empty="Add a global prompt first" /></div><div className="field"><label>Node prompt <span className="fine">optional</span></label><Select value={selectedNode?.id ?? ""} onChange={setNodeId} items={nodes} empty="No node prompt" /></div></div>{!selectedGlobal && <div className="notice info" style={{ marginTop: 10 }}>Save a global prompt in the Prompts section before generating ideal behavior.</div>}</section><section className="section card panel"><h3>2. Actual Agent Turn Data</h3><p className="section-desc">Upload one CSV with these fields: <span className="score">Conversation ID, Turn, User_Turn, Agent_Turn</span>. Header aliases such as <span className="score">conversation_id</span> and <span className="score">actual_agent_turn</span> are accepted. Agent turns can be blank when you only want to generate ideal behavior.</p><div className="drop" style={{ marginTop: 12 }}>Upload Actual Agent Turn Data CSV<br /><input type="file" accept=".csv,text/csv" onChange={(event) => readFile(event, setTurnDataCsv)} /></div>{turnDataCsv && <div className="notice safe" style={{ marginTop: 9 }}>Turn data loaded · {turnDataCsv.split("\n").length - 1} data lines</div>}</section><section className="section card panel"><div className="form-grid"><div className="field"><label>Dataset name</label><input value={name} onChange={(event) => setName(event.target.value)} /></div><div className="field"><label>Existing dataset</label><Select value={datasetId} onChange={(value) => { setDatasetId(value); setWorking(null); }} items={datasets} empty="Choose an existing dataset" /></div></div><button className="button primary" disabled={!turnDataCsv.trim() || !selectedGlobal || generatingIdeals} style={{ marginTop: 12 }} onClick={() => void createDataset()}>{generatingIdeals ? "Generating ideal behavior…" : "Generate editable ideal behavior table"}</button></section>{selectedDataset && <DatasetTable dataset={selectedDataset} canGenerate={Boolean(selectedGlobal)} generating={generatingIdeals} onGenerate={() => regenerateIdeals()} onUpdate={async (next) => { const saved = await onRequest(`/api/datasets/${next.id}`, { method: "PUT", body: JSON.stringify(next) }); if (saved) setWorking(saved); }} onImportIdealCsv={async (csv) => { const saved = await onRequest(`/api/datasets/${selectedDataset.id}/ideal-table`, { method: "POST", body: JSON.stringify({ ideal_behavior_csv: csv }) }, "Ideal behavior CSV applied to matching rows."); if (saved) setWorking(saved); }} />}<section className="section"><MetricBuilder name={metricName} prompt={metricPrompt} threshold={metricThreshold} setName={setMetricName} setPrompt={setMetricPrompt} setThreshold={setMetricThreshold} add={addMetric} /></section><section className="section card panel"><div className="section-header"><div><h2 className="section-title">Evaluation list</h2><p className="section-desc">Only selected metrics are used as evaluation prompts. Use the filter to add a supplied or custom evaluation to this run.</p></div><span className="pill">{evaluationMetrics.length} selected</span></div><div className="catalog-picker"><div className="field"><label>Add evaluation from filter</label><select value={metricPicker} onChange={(event) => setMetricPicker(event.target.value)}><option value="">Choose an evaluation</option>{availableMetrics.map((metric: Doc) => <option key={metric.id} value={metric.id}>{metric.name}</option>)}</select></div><button className="button" disabled={!metricPicker} onClick={addPickedMetric}>Add to evaluation list</button></div>{evaluationMetrics.length ? <div className="metric-list" style={{ marginTop: 12 }}>{evaluationMetrics.map((metric: Doc) => <EvaluationMetric key={metric.id} metric={metric} onSave={async (next) => { const saved = await onRequest(`/api/metrics/${metric.id}`, { method: "PUT", body: JSON.stringify(next) }, "Metric version saved."); if (saved) setSelectedMetrics((items) => items.map((id) => id === metric.id ? saved.id : id)); }} onRemove={() => setSelectedMetrics((items) => items.filter((id) => id !== metric.id))} />)}</div> : <div className="empty">Choose evaluations from the filter or create a custom metric above.</div>}</section><section className="section card panel"><div className="section-header"><div><h2 className="section-title">5. Analyze attached conversations</h2><p className="section-desc">The selected prompt versions and metrics are recorded with the conversation analysis.</p></div>{selectedDataset && <span className="pill">{selectedDataset.actualConversationCount ?? 0} actual conversations attached</span>}</div><button className="button primary" disabled={running || !selectedDataset?.id} style={{ marginTop: 12 }} onClick={() => void analyze()}>{running ? "Analyzing conversations…" : "Analyze dataset"}</button>{!evaluationMetrics.length && <div className="notice info" style={{ marginTop: 10 }}>Add at least one metric before analysis; the prompt-driven ideal table is still available without one.</div>}</section></>;
}

function DatasetTable({ dataset, canGenerate, generating, onGenerate, onUpdate, onImportIdealCsv }: { dataset: Doc; canGenerate: boolean; generating: boolean; onGenerate: () => void; onUpdate: (dataset: Doc) => Promise<void>; onImportIdealCsv: (csv: string) => Promise<void> }) {
  const [draft, setDraft] = useState<Doc>(dataset);
  useEffect(() => setDraft(dataset), [dataset]);
  const updateRow = (conversationId: string, rowId: string, field: "idealAction" | "idealResponse", value: string) => {
    const next = { ...draft, conversations: draft.conversations.map((conversation: Doc) => conversation.conversationId !== conversationId ? conversation : { ...conversation, idealRows: conversation.idealRows.map((row: Doc) => { if (row.id !== rowId) return row; return field === "idealAction" ? { ...row, idealAction: value, idealResponse: idealReplyTemplate(value), idealOverride: true } : { ...row, idealResponse: value, idealOverride: true }; }) }) };
    setDraft(next);
    void onUpdate(next);
  };
  const rows = draft.conversations?.flatMap((conversation: Doc) => conversation.idealRows.map((row: Doc) => ({ conversationId: conversation.conversationId, actual: conversation.actualRows?.find((item: Doc) => item.turn === row.turn)?.content ?? "", ...row }))) ?? [];
  const downloadActualData = () => downloadCsv("actual-agent-turn-data.csv", ["Conversation ID", "Turn", "User_Turn", "Agent_Turn"], rows.map((row: Doc) => [row.conversationId, row.turn, row.userTurn, row.actual]));
  const downloadIdealTable = () => downloadCsv("ideal-behavior-table.csv", ["Conversation ID", "Turn", "User_Turn", "Agent_Turn", "Ideal_Action", "Ideal_Agent_Turn"], rows.map((row: Doc) => [row.conversationId, row.turn, row.userTurn, row.actual, row.idealAction || row.suggestedAction, row.idealResponse]));
  const sources = dataset.idealGeneration?.sources ?? [];
  return <section className="section card panel"><div className="section-header"><div><h2 className="section-title">Editable ideal behavior table</h2><p className="section-desc">This ideal behavior was generated from {sources.length ? sources.join(" · ") : "the selected prompts"}. Edit any row, download either CSV, or upload your own ideal behavior CSV to override matching rows.</p></div><div className="section-actions"><span className="pill">{draft.conversationCount} conversations</span><button className="button tiny" disabled={generating || !canGenerate} onClick={onGenerate}>{generating ? "Generating…" : "Regenerate from prompts"}</button><button className="button tiny" onClick={downloadActualData}>Download actual data CSV</button><button className="button tiny" onClick={downloadIdealTable}>Download ideal CSV</button></div></div><div className="notice info" style={{ marginBottom: 10 }}>Regenerating updates prompt-generated rows and keeps your edited rows intact.</div><div className="ideal-import"><span className="fine">Optional override CSV: <span className="score">Conversation ID, Turn, Ideal_Action, Ideal_Agent_Turn</span></span><input type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then(onImportIdealCsv); }} /></div><div className="table-wrap"><table className="table ideal-table"><thead><tr><th>Conversation ID</th><th>Turn</th><th>User turn</th><th>Ideal next action</th><th>Ideal agent turn / tool event</th><th>Agent turn</th></tr></thead><tbody>{rows.map((row: Doc, index: number) => <tr key={`${row.conversationId}-${row.turn}-${index}`}><td><span className="score">{row.conversationId}</span></td><td>{row.turn}</td><td>{row.userTurn}</td><td><div className="field"><select value={row.idealAction || row.suggestedAction} onChange={(event) => updateRow(row.conversationId, row.id, "idealAction", event.target.value)}>{idealActions.map((action) => <option key={action} value={action}>{action.replaceAll("_", " ")}</option>)}</select><span className="fine">Prompt-generated action: {row.suggestedAction.replaceAll("_", " ")}</span></div></td><td><textarea className="ideal-reply" value={row.idealResponse} onChange={(event) => updateRow(row.conversationId, row.id, "idealResponse", event.target.value)} /></td><td>{row.actual || <Badge value="MISSING" />}</td></tr>)}</tbody></table></div></section>;
}

function MetricBuilder({ name, prompt, threshold, setName, setPrompt, setThreshold, add }: { name: string; prompt: string; threshold: number; setName: (value: string) => void; setPrompt: (value: string) => void; setThreshold: (value: number) => void; add: () => Promise<void> }) {
  return <div className="card panel"><h3>3. Add an evaluation metric</h3><p className="section-desc">Create a Conversational G-Eval metric with your own prompt. It is added only when you click Add metric and will be scored across the full conversation.</p><div className="form-grid" style={{ marginTop: 10 }}><div className="field"><label>Metric name</label><input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Correction handling" /></div><div className="field"><label>Threshold <span className="score">{threshold.toFixed(2)}</span></label><input className="range" type="range" min="0" max="1" step=".01" value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} /></div><div className="field full"><label>Evaluation prompt</label><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Evaluate whether the agent preserves corrected details and follows the required CPU flow…" /></div></div><button className="button primary" disabled={!name.trim() || !prompt.trim()} onClick={() => void add()}>Add metric</button></div>;
}

function EvaluationMetric({ metric, onSave, onRemove }: { metric: Doc; onSave: (value: Doc) => Promise<void>; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(metric.criteria ?? "");
  const [threshold, setThreshold] = useState(metric.threshold);
  const save = () => void onSave({ name: metric.name, type: metric.type, description: metric.description, enabled: false, isDefault: metric.isDefault ?? false, threshold, weight: metric.weight, judge_model: metric.judge_model, criteria: prompt, evaluation_steps: null, strict_mode: metric.strict_mode, implementation_key: metric.implementation_key });
  return <div className="metric"><div><h4>{metric.name} <span className="fine">v{metric.version}</span></h4><p>{metric.type.replaceAll("_", " ")} · full-conversation score threshold {metric.threshold.toFixed(2)}</p></div><div className="metric-controls"><button className="button tiny" onClick={() => setOpen(!open)}>{open ? "Collapse" : "Expand"}</button><button className="button tiny danger" onClick={onRemove}>Remove</button></div>{open && <div className="metric-expanded"><div className="field"><label>Evaluation prompt</label><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} /></div><div className="field"><label>Threshold <span className="score">{threshold.toFixed(2)}</span></label><input className="range" type="range" min="0" max="1" step=".01" value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} /></div><button className="button tiny" onClick={save}>Save metric version</button></div>}</div>;
}

function PromptTrace({ trace, legacyEvidence, incorrect }: { trace?: Doc; legacyEvidence?: string; incorrect: boolean }) {
  if (!trace) return <span className="fine">{legacyEvidence ? `${legacyEvidence}. Run this dataset again to capture the actual prompt text and improvement.` : "Run this dataset again to capture the prompt trace."}</span>;
  const matches = trace.topSources ?? [trace.problematicInstruction, trace.promptLine].filter(Boolean);
  const renderInstruction = (item: Doc, index: number) => <div className="trace-item" key={`${item.id}-${index}`}><span className="trace-label">#{index + 1} Prompt / metric match</span><span className="trace-source">{item.sourceLabel} · line {item.lineStart} · relevance {item.relevance ?? "—"}</span><code>{item.text}</code></div>;
  return <div className="prompt-trace">{incorrect ? <><div className="trace-item expected"><span className="trace-label">Relevant instruction</span><span className="trace-source">{trace.promptLine?.sourceLabel ?? "No matching selected instruction"}{trace.promptLine ? ` · line ${trace.promptLine.lineStart}` : ""}</span>{trace.promptLine && <code>{trace.promptLine.text}</code>}</div><div className="trace-heading">Top {Math.min(3, matches.length)} selected prompt or metric instructions related to the actual behavior</div>{matches.length ? matches.slice(0, 3).map(renderInstruction) : <span className="fine">No related wording was found in the selected prompt or metric instructions.</span>}<div className="trace-item improvement"><span className="trace-label">Suggested instruction refinement</span><p>{trace.improvement}</p></div></> : <span className="fine">The observed behavior matches the selected ideal action; no remediation source is needed.</span>}</div>;
}

function Results({ runs }: { runs: Doc[] }) {
  const [activeId, setActiveId] = useState(runs[0]?.id ?? "");
  useEffect(() => { if (runs.length && !runs.some((item) => item.id === activeId)) setActiveId(runs[0].id); }, [runs, activeId]);
  const active = runs.find((item) => item.id === activeId) ?? runs[0];
  if (!active) return <><Header eyebrow="RESULTS" title="Conversation results" subtitle="Analyze a dataset in the workspace to see each attached conversation here." /><div className="card empty">No result records available yet.</div></>;
  const metricResults = active.metricResults ?? [];
  const agentRows = buildRows(active);
  const download = () => {
    const metricHeaders = metricResults.flatMap((metric: Doc) => [`${metric.name} score`, `${metric.name} status`, `${metric.name} reason`]);
    downloadCsv("conversation-evaluations.csv", ["conversation_id", "outcome", "weighted_score", ...metricHeaders], runs.map((run) => {
      const byId = new Map<string, Doc>((run.metricResults ?? []).map((metric: Doc) => [metric.metric_id, metric]));
      return [run.conversationId ?? run.id, run.outcome, run.weightedScore ?? "NOT RUN", ...metricResults.flatMap((metric: Doc) => { const result = byId.get(metric.metric_id); return [result?.score ?? "NOT RUN", result?.status ?? "NOT RUN", result?.reason ?? ""]; })];
    }));
  };
  const sourceLabels = [...(active.sources?.policy ?? []), ...(active.sources?.criteria ?? [])].filter(Boolean);
  return <><Header eyebrow="RESULTS" title="Conversation-by-conversation analysis" subtitle="Each metric is evaluated once across the complete conversation. Turn-level details show the selected prompt and metric instructions behind the comparison."><button className="button primary" onClick={download}>Download CSV</button></Header><div className="results-picker">{runs.map((run) => <button key={run.id} className={`result-chip ${run.id === active.id ? "active" : ""}`} onClick={() => setActiveId(run.id)}><span className="score">{run.conversationId ?? run.id.slice(0, 8)}</span><Badge value={run.outcome} /></button>)}</div><div className="card panel" style={{ marginTop: 13 }}><div className="report-header"><div><h3>{active.name}</h3><p className="section-desc">Conversation ID: <span className="score">{active.conversationId ?? "not supplied"}</span> · {sourceLabels.join(" · ")}</p></div><div style={{ textAlign: "right" }}><Badge value={active.outcome} /><div className="report-score">{active.weightedScore == null ? "—" : `${Math.round(active.weightedScore * 100)}%`}</div></div></div></div><ConversationMetricScores metricResults={metricResults} /><div className="table-wrap results-table"><table className="table analysis-table"><thead><tr><th>Conversation ID</th><th>Turn</th><th>Caller</th><th>Actual agent</th><th>Ideal behavior</th><th>Expected → actual</th><th>Prompt / metric trace</th></tr></thead><tbody>{agentRows.map((row: Doc) => <tr key={row.turn} className={row.decision === "INCORRECT" ? "analysis-error" : ""}><td><span className="score">{active.conversationId ?? "—"}</span></td><td>{row.turn}</td><td>{row.caller}</td><td>{row.actual}</td><td style={{ whiteSpace: "pre-wrap" }}>{row.ideal}</td><td><span className="score">{row.expected}</span><br /><span className="severity">{row.observed}</span><br /><Badge value={row.decision} /></td><td><PromptTrace trace={row.promptTrace} legacyEvidence={row.evidence} incorrect={row.decision === "INCORRECT"} /></td></tr>)}</tbody></table></div><section className="section card panel"><h3>First break and recommendations</h3>{active.breaks?.length ? active.breaks.map((item: Doc) => <div className="break" key={`${item.turn}-${item.expectedAction}`}><Badge value={item.severity} /> <strong>Turn {item.turn}: {item.expectedAction} expected, {item.actualAction} observed</strong><p>{item.suggestedFix}</p></div>) : <div className="notice safe">No action mismatch was detected in this conversation.</div>}</section></>;
}

function ConversationMetricScores({ metricResults }: { metricResults: Doc[] }) {
  return <section className="section card panel"><div className="section-header"><div><h2 className="section-title">Conversation metric scores</h2><p className="section-desc">One pass/fail decision and 0–1 score per metric, evaluated against the entire conversation.</p></div><span className="pill">{metricResults.length} metrics</span></div>{metricResults.length ? <div className="table-wrap"><table className="table metric-score-table"><thead><tr><th>Metric</th><th>Score</th><th>Threshold</th><th>Result</th><th>Conversation-level reasoning</th></tr></thead><tbody>{metricResults.map((metric: Doc) => <tr key={metric.metric_id}><td><strong>{metric.name}</strong><br /><span className="fine">full conversation</span></td><td><span className="score">{metric.score == null ? "NOT RUN" : metric.score.toFixed(2)}</span></td><td><span className="score">{metric.threshold.toFixed(2)}</span></td><td><Badge value={metric.status} /></td><td>{metric.reason}</td></tr>)}</tbody></table></div> : <div className="empty">No metrics were selected for this conversation.</div>}</section>;
}

function buildRows(run: Doc) {
  const turns = run.transcript ?? [];
  const ideal = run.idealTranscript ?? [];
  const actions = run.actionTrace ?? [];
  let caller = "";
  let callerNumber = -1;
  return turns.filter((turn: Doc) => turn.role === "agent").map((turn: Doc) => {
    const index = turns.indexOf(turn);
    for (let i = index; i >= 0; i -= 1) if (turns[i].role === "caller") { caller = turns[i].content; callerNumber = turns.slice(0, i + 1).filter((item: Doc) => item.role === "caller").length - 1; break; }
    const action = actions.find((item: Doc) => item.turn === turn.index + 1) ?? {};
    const idealCallerIndexes = ideal.map((item: Doc, i: number) => item.role === "caller" ? i : -1).filter((i: number) => i >= 0);
    const start = idealCallerIndexes[callerNumber] ?? -1;
    const end = idealCallerIndexes[callerNumber + 1] ?? ideal.length;
    const idealText = start >= 0 ? ideal.slice(start + 1, end).map((item: Doc) => `${item.role.replaceAll("_", " ")}: ${item.content}`).join("\n") : "Ideal reference not attached";
    const evidence = action.topPromptEvidence?.map((item: Doc) => `${item.ruleId} (${Math.round(item.relevance * 100)}%, lines ${item.lineStart}–${item.lineEnd})`).join("\n");
    return { turn: turn.index + 1, caller, actual: turn.content, ideal: idealText, expected: action.expectedAction ?? "—", observed: action.actualAction ?? "—", decision: action.decision ?? "NOT EVALUATED", promptTrace: action.promptTrace, evidence };
  });
}

function Settings() {
  const [judgeStatus, setJudgeStatus] = useState<{ configured: boolean; keySuffix: string | null; model: string } | null>(null);
  const checkJudge = () => { void fetch("/api/judge", { cache: "no-store" }).then(async (response) => response.ok ? response.json() : null).then(setJudgeStatus).catch(() => setJudgeStatus(null)); };
  useEffect(checkJudge, []);
  return <><Header eyebrow="LOCAL SETUP" title="Settings" subtitle="The local Next server reads the LLM key from .env.local; it is never sent to the browser." /><div className="split"><div className="card panel"><h3>Local workspace</h3><div className="notice safe" style={{ marginTop: 12 }}>Prompts, metric criteria, datasets, ideal-action choices, and results are stored in this browser&apos;s local storage.</div><p className="section-desc" style={{ marginTop: 12 }}>The server-only OpenAI path generates ideal scenarios from the selected prompts and evaluates selected LLM metrics.</p><div className={`notice ${judgeStatus?.configured ? "safe" : "info"}`} style={{ marginTop: 12 }}>{judgeStatus ? judgeStatus.configured ? `Local judge loaded · key ending ${judgeStatus.keySuffix} · ${judgeStatus.model}` : "No API key is loaded by this local server." : "Checking the local judge key…"}</div><button className="button tiny" style={{ marginTop: 8 }} onClick={checkJudge}>Refresh key status</button></div><div className="card panel"><h3>Ideal behavior workflow</h3><div className="notice info" style={{ marginTop: 12 }}>Save a global prompt, optionally add a node prompt, select their versions in the workspace, and generate the editable ideal table. Regeneration preserves intentional row edits.</div></div></div></>;
}
