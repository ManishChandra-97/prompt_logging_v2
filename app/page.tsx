"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { bootstrap, localRequest } from "./local-evaluator";

type Doc = Record<string, any>;
type Page = "Dashboard" | "Prompts" | "Evaluation Workspace" | "Results" | "Settings";
type PromptMode = "pathway" | "assistant";

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

function readFile(event: ChangeEvent<HTMLInputElement>, setValue: (value: string) => void) {
  const file = event.target.files?.[0];
  if (file) void file.text().then(setValue);
}

function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const cell = (value: unknown) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const blob = new Blob([[headers, ...rows].map((row) => row.map(cell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export default function Home() {
  const [page, setPage] = useState<Page>("Dashboard");
  const [data, setData] = useState<Doc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [resultRuns, setResultRuns] = useState<Doc[]>([]);

  const refresh = async () => {
    try {
      setData(await bootstrap());
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
  const request = async (url: string, options: RequestInit = {}, message?: string, refreshAfter = true) => {
    try {
      const output = await localRequest<Doc>(url, options);
      if (message) setToast(message);
      if (refreshAfter) await refresh();
      return output;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Request failed");
      return null;
    }
  };
  const openResults = (runs: Doc[]) => { setResultRuns(runs); setPage("Results"); };

  if (!data) return <main className="loading"><div className="brand"><span className="brand-mark">◈</span> CPU EVALUATOR</div><p>{error ?? "Loading your local workspace…"}</p><button className="button primary" onClick={() => void refresh()}>Retry</button></main>;

  const prompts = data.prompts ?? [];
  return <div className="shell"><aside className="side"><div className="brand"><span className="brand-mark">◈</span><span>CPU EVALUATOR</span></div><div className="nav-label">WORKBENCH</div>{nav.map((item) => <button key={item} className={`nav ${page === item ? "active" : ""}`} onClick={() => setPage(item)}>{item}</button>)}<div className="side-foot"><span className="security-dot">●</span> local-first evaluation<br />CPU intake</div></aside><main className="content">{error && <div className="notice" style={{ marginBottom: 14 }}>{error} <button className="button tiny" onClick={() => setError(null)}>Dismiss</button></div>}{page === "Dashboard" && <Dashboard data={data} setPage={setPage} />}{page === "Prompts" && <Prompts prompts={prompts} promptMode={data.promptMode ?? "pathway"} onRequest={request} />}{page === "Evaluation Workspace" && <Workspace data={data} prompts={prompts} onRequest={request} openResults={openResults} />}{page === "Results" && <Results runs={resultRuns.length ? resultRuns : data.runs ?? []} />}{page === "Settings" && <Settings />}</main>{toast && <div className="toast">{toast}</div>}</div>;
}

function Dashboard({ data, setPage }: { data: Doc; setPage: (page: Page) => void }) {
  const dashboard = data.dashboard;
  return <><Header eyebrow="OVERVIEW" title="Conversation evaluation, grounded in turns." subtitle="Choose a Pathway or Assistant policy, import actual-agent data, then review a clear score for every metric and conversation."><span className="pill">● local service connected</span></Header><div className="grid stats"><Stat label="DATASETS" value={String(data.datasets?.length ?? 0)} detail="CSV turn-wise imports" /><Stat label="CUSTOM METRICS" value={String(data.metrics?.length ?? 0)} detail="none auto-selected" /><Stat label="LATEST SCORE" value={dashboard.latestScore == null ? "—" : `${Math.round(dashboard.latestScore * 100)}%`} detail="only selected metrics count" score={dashboard.latestScore} /><Stat label="RESULTS" value={String(data.runs?.length ?? 0)} detail="conversation-level records" /></div><section className="section card panel"><h2 className="section-title">Start with prompts</h2><p className="section-desc">In Pathway mode, save a global policy and any needed node policies. In Assistant mode, save one assistant prompt. Then evaluate the uploaded conversations against your selected metrics.</p><button className="button primary" style={{ marginTop: 14 }} onClick={() => setPage("Prompts")}>Add prompt sources</button></section></>;
}

function scoreStatus(score?: number | null) {
  if (typeof score !== "number") return { label: "NOT RUN", tone: "not-run" };
  if (score > .8) return { label: "PASS", tone: "pass" };
  if (score >= .5) return { label: "PARTIAL PASS", tone: "partial-pass" };
  return { label: "FAIL", tone: "fail" };
}

function ScoreMeter({ score, compact = false }: { score?: number | null; compact?: boolean }) {
  const { label, tone } = scoreStatus(score);
  const percentage = typeof score === "number" ? Math.round(Math.max(0, Math.min(1, score)) * 100) : null;
  return <div className={`score-meter ${compact ? "compact" : ""} ${tone}`} aria-label={percentage == null ? "Score not run" : `${percentage}% ${label}`}><div className="score-meter-top"><span>{label}</span><strong>{percentage == null ? "—" : `${percentage}%`}</strong></div><div className="score-meter-track"><span style={{ width: `${percentage ?? 0}%` }} /></div></div>;
}

function Stat({ label, value, detail, score }: { label: string; value: string; detail: string; score?: number | null }) {
  return <div className="card stat"><label>{label}</label><strong>{value}</strong><span>{detail}</span>{typeof score === "number" && <ScoreMeter score={score} compact />}</div>;
}

function Prompts({ prompts, promptMode, onRequest }: { prompts: Doc[]; promptMode: PromptMode; onRequest: (path: string, options?: RequestInit, message?: string) => Promise<Doc | null> }) {
  const [mode, setMode] = useState<PromptMode>(promptMode);
  const [source, setSource] = useState<"global" | "node" | "assistant">(promptMode === "assistant" ? "assistant" : "global");
  const [name, setName] = useState("Global call policy");
  const [nodeName, setNodeName] = useState("intake");
  const [text, setText] = useState("");
  const nodeNames = [...new Set(prompts.filter((item) => item.source === "node").map((item) => item.node_name).filter(Boolean))];
  const ledger = prompts.filter((item) => mode === "assistant" ? item.source === "assistant" : item.source === "global" || item.source === "node");

  useEffect(() => {
    setMode(promptMode);
    setSource(promptMode === "assistant" ? "assistant" : "global");
  }, [promptMode]);

  useEffect(() => {
    const next = source === "node"
      ? prompts.find((item) => item.source === "node" && item.node_name === nodeName && item.active) ?? prompts.find((item) => item.source === "node" && item.node_name === nodeName) ?? prompts.find((item) => item.source === "node" && item.active) ?? prompts.find((item) => item.source === "node")
      : prompts.find((item) => item.source === source && item.active) ?? prompts.find((item) => item.source === source);
    setName(next?.name ?? (source === "global" ? "Global call policy" : source === "assistant" ? "Assistant policy" : "Node policy"));
    if (source === "node") setNodeName((next?.node_name ?? nodeName) || "intake");
    setText(next?.text ?? "");
  }, [source, prompts]);

  const chooseMode = (next: PromptMode) => {
    setMode(next);
    setSource(next === "assistant" ? "assistant" : "global");
    void onRequest("/api/prompt-mode", { method: "POST", body: JSON.stringify({ mode: next }) }, `${next === "pathway" ? "Pathway" : "Assistant"} mode selected.`);
  };
  const selectNode = (nextNodeName: string) => {
    const next = prompts.find((item) => item.source === "node" && item.node_name === nextNodeName && item.active) ?? prompts.find((item) => item.source === "node" && item.node_name === nextNodeName);
    setSource("node");
    setNodeName(nextNodeName);
    setName(next?.name ?? "Node policy");
    setText(next?.text ?? "");
  };
  const addNode = () => {
    const nextNodeName = `node-${nodeNames.length + 1}`;
    setSource("node");
    setNodeName(nextNodeName);
    setName("Node policy");
    setText("");
  };
  const save = () => {
    if (!name.trim() || !text.trim() || (source === "node" && !nodeName.trim())) return;
    void onRequest("/api/prompts", { method: "POST", body: JSON.stringify({ name, source, node_name: source === "node" ? nodeName : null, text, set_active: true }) }, `${source === "global" ? "Global" : source === "assistant" ? "Assistant" : nodeName} prompt saved and set active.`);
  };
  const modeSource = source === "global" ? "Global prompt" : source === "assistant" ? "Assistant prompt" : "Node prompt";

  return <><Header eyebrow="POLICY" title="Prompt configuration" subtitle="Choose how the evaluator should build its policy. Pathway combines a global prompt with one or more node prompts; Assistant uses exactly one assistant prompt."><span className="pill">{prompts.length} saved</span></Header><div className="mode-picker" aria-label="Prompt mode"><button className={`mode-option ${mode === "pathway" ? "active" : ""}`} onClick={() => chooseMode("pathway")}><strong>Pathway</strong><span>Global prompt + one or more node prompts</span></button><button className={`mode-option ${mode === "assistant" ? "active" : ""}`} onClick={() => chooseMode("assistant")}><strong>Assistant</strong><span>One standalone assistant prompt</span></button></div>{mode === "pathway" && <div className="tabs"><button className={`tab ${source === "global" ? "active" : ""}`} onClick={() => setSource("global")}>Global prompt</button><button className={`tab ${source === "node" ? "active" : ""}`} onClick={() => setSource("node")}>Node prompt</button></div>}<div className="split"><section className="card panel">{mode === "pathway" && source === "node" && <div className="node-toolbar"><div className="field"><label>Editing node</label><select value={nodeName} onChange={(event) => selectNode(event.target.value)}>{!nodeNames.includes(nodeName) && <option value={nodeName}>{nodeName} (new)</option>}{nodeNames.map((item) => <option key={item} value={item}>{item}</option>)}</select></div><button className="button tiny" onClick={addNode}>+ Add node</button></div>}<div className="form-grid"><div className="field"><label>Name</label><input value={name} onChange={(event) => setName(event.target.value)} placeholder={source === "global" ? "e.g. Main call policy" : source === "assistant" ? "e.g. Support assistant" : "e.g. Intake node"} /></div><div className="field"><label>Node name</label><input disabled={source !== "node"} value={nodeName} onChange={(event) => setNodeName(event.target.value)} placeholder="e.g. intake" /></div><div className="field full"><label>{modeSource}</label><textarea className="editor" value={text} spellCheck={false} onChange={(event) => setText(event.target.value)} placeholder="Add the policy instructions for this evaluation workspace…" /></div></div><button className="button primary" style={{ marginTop: 12 }} disabled={!name.trim() || !text.trim() || (source === "node" && !nodeName.trim())} onClick={save}>Save & set active</button></section><section className="card panel"><h3>Version ledger</h3><p className="section-desc">{mode === "pathway" ? "Each active node participates in Pathway analysis. Saving a node creates a new active version only for that node." : "Only the active assistant prompt participates in Assistant analysis."}</p>{ledger.length ? <div className="metric-list" style={{ marginTop: 10 }}>{ledger.map((item) => <div className="metric" key={item.id}><div><h4>{item.source === "node" ? `${item.node_name} · ` : ""}{item.name} <span className="fine">v{item.version}</span></h4><p>{item.source === "global" ? "Global" : item.source === "assistant" ? "Assistant" : "Node"} · {new Date(item.created_at).toLocaleString()}</p></div><Badge value={item.active ? "ACTIVE" : "SAVED"} /></div>)}</div> : <div className="empty">No {mode === "assistant" ? "assistant" : "pathway"} prompts saved yet.</div>}</section></div></>;
}

function Workspace({ data, prompts, onRequest, openResults }: { data: Doc; prompts: Doc[]; onRequest: (path: string, options?: RequestInit, message?: string, refreshAfter?: boolean) => Promise<Doc | null>; openResults: (runs: Doc[]) => void }) {
  const [name, setName] = useState("CPU intake dataset");
  const [turnDataCsv, setTurnDataCsv] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [working, setWorking] = useState<Doc | null>(null);
  const [metricName, setMetricName] = useState("");
  const [metricPrompt, setMetricPrompt] = useState("");
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);
  const [metricPicker, setMetricPicker] = useState("");
  const [defaultsInitialized, setDefaultsInitialized] = useState(false);
  const [running, setRunning] = useState(false);
  const [creatingDataset, setCreatingDataset] = useState(false);
  const datasets = data.datasets ?? [];
  const metrics = data.metrics ?? [];
  const promptMode = (data.promptMode ?? "pathway") as PromptMode;
  const selectedGlobal = prompts.find((item: Doc) => item.source === "global" && item.active);
  const selectedNodes = prompts.filter((item: Doc) => item.source === "node" && item.active);
  const selectedAssistant = prompts.find((item: Doc) => item.source === "assistant" && item.active);
  const hasActivePolicy = promptMode === "assistant" ? Boolean(selectedAssistant?.id) : Boolean(selectedGlobal?.id || selectedNodes.length);
  const selectedDataset = working ?? datasets.find((item: Doc) => item.id === datasetId);
  const evaluationMetrics = metrics.filter((item: Doc) => selectedMetrics.includes(item.id));
  const availableMetrics = metrics.filter((item: Doc) => !selectedMetrics.includes(item.id));

  useEffect(() => {
    if (!defaultsInitialized && metrics.length) {
      setSelectedMetrics(metrics.filter((item: Doc) => item.isDefault).map((item: Doc) => item.id));
      setDefaultsInitialized(true);
    }
  }, [metrics, defaultsInitialized]);

  async function createDataset() {
    if (!turnDataCsv.trim()) return;
    setCreatingDataset(true);
    const result = await onRequest("/api/datasets", {
      method: "POST",
      body: JSON.stringify({ name, turn_data_csv: turnDataCsv }),
    }, "Dataset created. Metrics can now be analyzed without ideal-state generation.");
    setCreatingDataset(false);
    if (result) { setWorking(result); setDatasetId(result.id); }
  }

  async function addMetric() {
    if (!metricName.trim() || !metricPrompt.trim()) return;
    const result = await onRequest("/api/metrics", { method: "POST", body: JSON.stringify({ name: metricName, type: "conversational_geval", description: "User-authored conversation metric", enabled: false, threshold: .8, weight: 1, judge_model: "gpt-4.1-mini", criteria: metricPrompt, evaluation_steps: null, strict_mode: false }) }, "Metric added to this evaluation list.");
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
    const result = await onRequest(`/api/datasets/${selectedDataset.id}/analyze`, { method: "POST", body: JSON.stringify({ metric_ids: selectedMetrics, mode: "full" }) });
    setRunning(false);
    if (result) openResults(result.runs);
  }
  return <>
    <Header eyebrow="ONE WORKSPACE" title="Datasets, prompts & analysis" subtitle={`Analyze uploaded conversations with the active ${promptMode === "pathway" ? "Pathway" : "Assistant"} setup.`}><Badge value={data.judgeConfigured ? "LLM READY" : "LOCAL ONLY"} /></Header>
    <section className="card panel"><h3>1. Active prompt sources</h3><p className="section-desc">Mode: <span className="score">{promptMode === "pathway" ? "Pathway" : "Assistant"}</span>. Keep the policy configuration associated with this evaluation workspace.</p><div className="metric-list" style={{ marginTop: 12 }}>{promptMode === "assistant" ? <div className="metric"><div><h4>Assistant prompt</h4><p>{selectedAssistant ? `${selectedAssistant.name} · v${selectedAssistant.version}` : "No active assistant prompt"}</p></div><Badge value={selectedAssistant ? "ACTIVE" : "NOT SET"} /></div> : <><div className="metric"><div><h4>Global prompt</h4><p>{selectedGlobal ? `${selectedGlobal.name} · v${selectedGlobal.version}` : "No active global prompt"}</p></div><Badge value={selectedGlobal ? "ACTIVE" : "NOT SET"} /></div><div className="metric"><div><h4>Node prompts <span className="fine">optional</span></h4><p>{selectedNodes.length ? selectedNodes.map((node: Doc) => `${node.node_name || node.name} · v${node.version}`).join(" · ") : "No active node prompts"}</p></div><Badge value={selectedNodes.length ? "ACTIVE" : "NOT SET"} /></div></>}</div>{!hasActivePolicy && <div className="notice info" style={{ marginTop: 10 }}>A prompt policy is optional; the selected metrics are evaluated directly against the uploaded conversations.</div>}</section>
    <section className="section card panel"><h3>2. Actual agent turn data</h3><p className="section-desc">Upload one CSV with <span className="score">Conversation ID, Turn, User_Turn, Agent_Turn</span>. Header aliases such as <span className="score">conversation_id</span> and <span className="score">actual_agent_turn</span> are accepted.</p><div className="drop" style={{ marginTop: 12 }}>Upload Actual Agent Turn Data CSV<br /><input type="file" accept=".csv,text/csv" onChange={(event) => readFile(event, setTurnDataCsv)} /></div>{turnDataCsv && <div className="notice safe" style={{ marginTop: 9 }}>Turn data loaded · {turnDataCsv.split("\n").length - 1} data lines</div>}</section>
    <section className="section card panel"><div className="form-grid"><div className="field"><label>Dataset name</label><input value={name} onChange={(event) => setName(event.target.value)} /></div><div className="field"><label>Existing dataset</label><Select value={datasetId} onChange={(value) => { setDatasetId(value); setWorking(null); }} items={datasets} empty="Choose an existing dataset" /></div></div><button className="button primary" disabled={!turnDataCsv.trim() || creatingDataset} style={{ marginTop: 12 }} onClick={() => void createDataset()}>{creatingDataset ? "Creating dataset…" : "Create dataset"}</button></section>
    <section className="section"><MetricBuilder name={metricName} prompt={metricPrompt} setName={setMetricName} setPrompt={setMetricPrompt} add={addMetric} /></section>
    <section className="section card panel"><div className="section-header"><div><h2 className="section-title">Evaluation list</h2><p className="section-desc">Only selected metrics are used as evaluation prompts. Use the filter to add a supplied or custom evaluation to this run.</p></div><span className="pill">{evaluationMetrics.length} selected</span></div><div className="catalog-picker"><div className="field"><label>Add evaluation from filter</label><select value={metricPicker} onChange={(event) => setMetricPicker(event.target.value)}><option value="">Choose an evaluation</option>{availableMetrics.map((metric: Doc) => <option key={metric.id} value={metric.id}>{metric.name}</option>)}</select></div><button className="button" disabled={!metricPicker} onClick={addPickedMetric}>Add to evaluation list</button></div>{evaluationMetrics.length ? <div className="metric-list" style={{ marginTop: 12 }}>{evaluationMetrics.map((metric: Doc) => <EvaluationMetric key={metric.id} metric={metric} onSave={async (next) => { const saved = await onRequest(`/api/metrics/${metric.id}`, { method: "PUT", body: JSON.stringify(next) }, "Metric version saved."); if (saved) setSelectedMetrics((items) => items.map((id) => id === metric.id ? saved.id : id)); }} onRemove={() => setSelectedMetrics((items) => items.filter((id) => id !== metric.id))} />)}</div> : <div className="empty">Choose evaluations from the filter or create a custom metric above.</div>}</section>
    <section className="section card panel"><div className="section-header"><div><h2 className="section-title">5. Analyze attached conversations</h2><p className="section-desc">Each metric receives a clear score and concise evaluation rationale.</p></div>{selectedDataset && <span className="pill">{selectedDataset.actualConversationCount ?? 0} actual conversations attached</span>}</div><button className="button primary" disabled={running || !selectedDataset?.id} style={{ marginTop: 12 }} onClick={() => void analyze()}>{running ? "Analyzing conversations…" : "Analyze dataset"}</button>{!evaluationMetrics.length && <div className="notice info" style={{ marginTop: 10 }}>Add at least one metric before analysis.</div>}</section>
  </>;
}

function MetricBuilder({ name, prompt, setName, setPrompt, add }: { name: string; prompt: string; setName: (value: string) => void; setPrompt: (value: string) => void; add: () => Promise<void> }) {
  return <div className="card panel"><h3>4. Add an evaluation metric</h3><p className="section-desc">Create a Conversational G-Eval metric with your own prompt. Scores are categorized as PASS above 80%, PARTIAL PASS from 50% to 80%, and FAIL below 50%.</p><div className="form-grid" style={{ marginTop: 10 }}><div className="field"><label>Metric name</label><input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Correction handling" /></div><div className="field full"><label>Evaluation prompt</label><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Evaluate whether the agent preserves corrected details and follows the required CPU flow…" /></div></div><button className="button primary" disabled={!name.trim() || !prompt.trim()} onClick={() => void add()}>Add metric</button></div>;
}

function EvaluationMetric({ metric, onSave, onRemove }: { metric: Doc; onSave: (value: Doc) => Promise<void>; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(metric.criteria ?? "");
  const save = () => void onSave({ name: metric.name, type: metric.type, description: metric.description, enabled: false, isDefault: metric.isDefault ?? false, threshold: .8, weight: metric.weight, judge_model: metric.judge_model, criteria: prompt, evaluation_steps: null, strict_mode: metric.strict_mode, implementation_key: metric.implementation_key });
  return <div className="metric"><div><h4>{metric.name} <span className="fine">v{metric.version}</span></h4><p>{metric.type.replaceAll("_", " ")} · full-conversation score</p></div><div className="metric-controls"><button className="button tiny" onClick={() => setOpen(!open)}>{open ? "Collapse" : "Expand"}</button><button className="button tiny danger" onClick={onRemove}>Remove</button></div>{open && <div className="metric-expanded"><div className="field"><label>Evaluation prompt</label><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} /></div><button className="button tiny" onClick={save}>Save metric version</button></div>}</div>;
}

type MetricFailure = { conversationId: string; why: string };
type MetricAggregate = { key: string; name: string; totalCalls: number; scoredCalls: number; passedCalls: number; partialCalls: number; failedCalls: number; notRunCalls: number; scoreTotal: number; averageScore: number | null; failureDetails: MetricFailure[]; failedConversationIds: string[] };

function failureDetail(run: Doc, metric: Doc): MetricFailure {
  const conversationId = run.conversationId ?? run.id?.slice(0, 8) ?? "Unknown conversation";
  const why = metric.reason?.trim() ?? "No evaluation rationale was recorded.";
  return { conversationId, why };
}

function aggregateMetricResults(runs: Doc[]): MetricAggregate[] {
  const aggregates = new Map<string, MetricAggregate>();
  runs.forEach((run) => (run.metricResults ?? []).forEach((metric: Doc) => {
    const key = metric.metric_definition_id ?? metric.definition_id ?? metric.metric_id ?? metric.name;
    const current: MetricAggregate = aggregates.get(key) ?? { key, name: metric.name ?? "Unnamed metric", totalCalls: 0, scoredCalls: 0, passedCalls: 0, partialCalls: 0, failedCalls: 0, notRunCalls: 0, scoreTotal: 0, averageScore: null, failureDetails: [], failedConversationIds: [] };
    current.totalCalls += 1;
    if (typeof metric.score === "number") { const status = scoreStatus(metric.score).label; current.scoredCalls += 1; current.scoreTotal += metric.score; if (status === "PASS") current.passedCalls += 1; else if (status === "PARTIAL PASS") { current.partialCalls += 1; current.failureDetails.push(failureDetail(run, metric)); } else { current.failedCalls += 1; const detail = failureDetail(run, metric); current.failureDetails.push(detail); if (!current.failedConversationIds.includes(detail.conversationId)) current.failedConversationIds.push(detail.conversationId); } } else current.notRunCalls += 1;
    aggregates.set(key, current);
  }));
  return [...aggregates.values()].map((metric) => ({ ...metric, averageScore: metric.scoredCalls ? metric.scoreTotal / metric.scoredCalls : null })).sort((left, right) => (left.averageScore ?? 2) - (right.averageScore ?? 2) || left.name.localeCompare(right.name));
}

function EvaluationAnalysis({ failures }: { failures: MetricFailure[] }) {
  if (!failures.length) return <span className="fine">No failed conversations</span>;
  return <div className="evaluation-analysis">{failures.slice(0, 3).map((failure) => <p key={`${failure.conversationId}-${failure.why}`}><strong>{failure.conversationId}</strong> — {failure.why}</p>)}{failures.length > 3 && <span className="fine">+{failures.length - 3} more</span>}</div>;
}

type PotentialFixData = { exactFix: string };

function fallbackRunPotentialFix(runs: Doc[]): PotentialFixData | null {
  const failures = runs.flatMap((run) => (run.metricResults ?? []).filter((metric: Doc) => typeof metric.score === "number" && metric.score < .5).map((metric: Doc) => ({ metric: metric.name ?? "this metric", reason: metric.reason?.trim() ?? "the expected behavior was not met" })));
  if (!failures.length) return null;
  const metrics = [...new Set(failures.map((failure) => failure.metric))].slice(0, 3).join(", ");
  const reasons = [...new Set(failures.map((failure) => failure.reason))].slice(0, 2).join("; ");
  return {
    exactFix: [
      `Focus the active prompt on the recurring gaps in ${metrics}.`,
      `The main observed issues were: ${reasons}.`,
      "State the required agent behavior and ordering in direct, testable language.",
      "Reconcile or remove instructions that could leave the behavior ambiguous or conflicting.",
      "Rerun the complete dataset after updating the prompt to confirm the improvement.",
    ].join("\n"),
  };
}

function RunPotentialFix({ fix }: { fix?: PotentialFixData | null }) {
  if (!fix) return null;
  const lines = fix.exactFix.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 5);
  return <section className="section card panel run-potential-fix"><h2 className="section-title">Potential Fix</h2><p className="section-desc">One prompt-focused view across the complete analysis run.</p><div className="potential-fix-box exact-fix"><h3>What is the exact fix which needs to be fixed</h3><div className="potential-fix-lines">{lines.map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}</div></div></section>;
}

function MetricPerformanceSummary({ metrics, totalCalls }: { metrics: MetricAggregate[]; totalCalls: number }) {
  const completed = metrics.filter((metric) => metric.averageScore != null);
  const averageScore = completed.length ? completed.reduce((total, metric) => total + (metric.averageScore ?? 0), 0) / completed.length : null;
  return <><div className="grid stats results-stats"><Stat label="CALLS ANALYZED" value={String(totalCalls)} detail="complete conversations" /><Stat label="METRICS AGGREGATED" value={String(metrics.length)} detail="unique metric definitions" /><Stat label="AVERAGE SCORE" value={averageScore == null ? "—" : `${Math.round(averageScore * 100)}%`} detail="across completed metric scores" score={averageScore} /></div><section className="section card panel"><div className="section-header"><div><h2 className="section-title">Metric score overview</h2><p className="section-desc">Score colors are consistent everywhere: green above 80%, orange from 50% to 80%, and red below 50%.</p></div><span className="pill">{metrics.length} metrics</span></div>{metrics.length ? <div className="table-wrap"><table className="table aggregate-metric-table"><thead><tr><th>Metric</th><th>Average score</th><th>Score distribution</th><th>Evaluation Analysis</th></tr></thead><tbody>{metrics.map((metric) => { const failures = metric.failureDetails.filter((failure) => metric.failedConversationIds.includes(failure.conversationId)); return <tr key={metric.key}><td><strong>{metric.name}</strong><br /><span className="fine">{metric.scoredCalls} evaluated · {metric.notRunCalls} not run</span></td><td><ScoreMeter score={metric.averageScore} compact /></td><td><div className="score-distribution"><span className="pass">{metric.passedCalls} pass</span><span className="partial-pass">{metric.partialCalls} partial</span><span className="fail">{metric.failedCalls} fail</span></div></td><td><EvaluationAnalysis failures={failures} /></td></tr>; })}</tbody></table></div> : <div className="empty">No completed metric results are available yet.</div>}</section></>;
}

function Results({ runs }: { runs: Doc[] }) {
  const [activeId, setActiveId] = useState(runs[0]?.id ?? "");
  useEffect(() => { if (runs.length && !runs.some((item) => item.id === activeId)) setActiveId(runs[0].id); }, [runs, activeId]);
  const active = runs.find((item) => item.id === activeId) ?? runs[0];
  if (!active) return <><Header eyebrow="RESULTS" title="Conversation results" subtitle="Analyze a dataset in the workspace to see each attached conversation here." /><div className="card empty">No result records available yet.</div></>;
  const metricSummary = aggregateMetricResults(runs);
  const savedPotentialFix = runs.find((run) => run.analysisPotentialFix && typeof run.analysisPotentialFix.exactFix === "string")?.analysisPotentialFix as PotentialFixData | undefined;
  const runPotentialFix = savedPotentialFix ?? fallbackRunPotentialFix(runs);
  const downloadMetricSummary = () => downloadCsv("metric-score-summary.csv", ["Metric", "Average score", "Score status", "Passed", "Partial pass", "Failed", "Evaluation Analysis"], metricSummary.map((metric) => { const failures = metric.failureDetails.filter((failure) => metric.failedConversationIds.includes(failure.conversationId)); return [metric.name, metric.averageScore == null ? "—" : `${Math.round(metric.averageScore * 100)}%`, scoreStatus(metric.averageScore).label, metric.passedCalls, metric.partialCalls, metric.failedCalls, failures.map((failure) => `${failure.conversationId} - ${failure.why}`).join("\n")]; }));
  const downloadConversationDetails = () => downloadCsv("conversation-score-details.csv", ["Conversation ID", "Overall score", "Overall status", "Metric scores", "Turn", "Speaker", "Text"], runs.flatMap((run) => {
    const metricScores = (run.metricResults ?? []).map((metric: Doc) => `${metric.name}: ${typeof metric.score === "number" ? `${Math.round(metric.score * 100)}%` : "—"} (${scoreStatus(metric.score).label})`).join("; ");
    const turns = run.transcript ?? [];
    const shared = [run.conversationId ?? run.id?.slice(0, 8) ?? "Unknown conversation", typeof run.weightedScore === "number" ? `${Math.round(run.weightedScore * 100)}%` : "—", scoreStatus(run.weightedScore).label, metricScores];
    return turns.length ? turns.map((turn: Doc) => [...shared, turn.index + 1, turn.role === "caller" ? "Caller" : "Agent", turn.content]) : [[...shared, "", "", ""]];
  }));
  return <><Header eyebrow="RESULTS" title="Metric scores across conversations" subtitle="Use the score bars to spot strong, partial, and failing results at a glance."><div className="section-actions"><button className="button" onClick={downloadMetricSummary}>Download metric summary</button><button className="button primary" onClick={downloadConversationDetails}>Download conversation details</button></div></Header><MetricPerformanceSummary metrics={metricSummary} totalCalls={runs.length} /><RunPotentialFix fix={runPotentialFix} /><section className="section card panel"><div className="section-header"><div><h2 className="section-title">Conversation score details</h2><p className="section-desc">Select a conversation to review its overall score, metric scores, and recorded transcript. Download the complete turn-level view for every conversation above.</p></div><span className="pill">{runs.length} conversations</span></div><div className="results-picker">{runs.map((run) => <button key={run.id} className={`result-chip ${run.id === active.id ? "active" : ""}`} onClick={() => setActiveId(run.id)}><span className="score">{run.conversationId ?? run.id.slice(0, 8)}</span><Badge value={scoreStatus(run.weightedScore).label} /></button>)}</div><div className="result-report-header"><div><h3>{active.name}</h3><p className="section-desc">Conversation ID: <span className="score">{active.conversationId ?? "not supplied"}</span></p></div><ScoreMeter score={active.weightedScore} /></div><div className="metric-list">{(active.metricResults ?? []).map((metric: Doc) => <div className="metric score-result" key={metric.metric_id}><div><h4>{metric.name}</h4><p>{metric.reason ?? "No evaluation rationale was recorded."}{metric.break_turn == null ? "" : ` · Agent turn ${metric.break_turn}`}</p></div><ScoreMeter score={metric.score} compact /></div>)}</div><h3 style={{ marginTop: 20 }}>Recorded conversation</h3><div className="table-wrap results-table"><table className="table"><thead><tr><th>Turn</th><th>Speaker</th><th>Text</th></tr></thead><tbody>{(active.transcript ?? []).map((turn: Doc) => <tr key={turn.id ?? turn.index}><td>{turn.index + 1}</td><td>{turn.role === "caller" ? "Caller" : "Agent"}</td><td style={{ whiteSpace: "pre-wrap" }}>{turn.content}</td></tr>)}</tbody></table></div></section></>;
}

function Settings() {
  const [judgeStatus, setJudgeStatus] = useState<{ configured: boolean; keySuffix: string | null; model: string } | null>(null);
  const checkJudge = () => { void fetch("/api/judge", { cache: "no-store" }).then(async (response) => response.ok ? response.json() : null).then(setJudgeStatus).catch(() => setJudgeStatus(null)); };
  useEffect(checkJudge, []);
  return <><Header eyebrow="LOCAL SETUP" title="Settings" subtitle="The local Next server reads the LLM key from .env.local; it is never sent to the browser." /><div className="split"><div className="card panel"><h3>Local workspace</h3><div className="notice safe" style={{ marginTop: 12 }}>Prompts, metric criteria, datasets, and results are stored in this browser&apos;s IndexedDB workspace.</div><p className="section-desc" style={{ marginTop: 12 }}>IndexedDB provides substantially more room than local storage for larger datasets. The server-only OpenAI path evaluates selected metrics and records a concise score rationale.</p><div className={`notice ${judgeStatus?.configured ? "safe" : "info"}`} style={{ marginTop: 12 }}>{judgeStatus ? judgeStatus.configured ? `Local judge loaded · key ending ${judgeStatus.keySuffix} · ${judgeStatus.model}` : "No API key is loaded by this local server." : "Checking the local judge key…"}</div><button className="button tiny" style={{ marginTop: 8 }} onClick={checkJudge}>Refresh key status</button></div><div className="card panel"><h3>Score guide</h3><div className="notice info" style={{ marginTop: 12 }}>Scores above 80% pass, scores from 50% to 80% partially pass, and scores below 50% fail.</div></div></div></>;
}
