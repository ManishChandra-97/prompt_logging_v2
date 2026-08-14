export type Doc = Record<string, any>;

type Store = { flowVersion?: number; prompts: Doc[]; datasets: Doc[]; metrics: Doc[]; runs: Doc[] };
type Turn = { id: string; index: number; role: "caller" | "agent" | "tool" | "tool_result"; content: string };

const key = "cpu-evaluator-local-v2";
const flowVersion = 6;
const actions = ["ASK_SHAREHOLDER_STATUS", "ASK_RELATIONSHIP", "ASK_FOR_COMPANY", "CALL_COMPANY_RESOLVER", "ASK_COMPANY_FOCUS", "HANDLE_COMPANY_LOOKUP_FAILURE", "ASK_INTENT", "ASK_INTENT_PRIORITY", "GIVE_FINAL_SUMMARY", "ASK_FINAL_CONFIRMATION", "CALL_INFORMATION_EXTRACTOR", "TRANSFER"];
const globalText = `# GLOBAL GUARDRAILS
## Intake priority
Always collect F1, then F2, then F3 before the final summary unless an escalation exception applies.

## Relationship semantics
When a caller says they are calling on behalf of a relationship, capture the relationship as F1. Never treat a relationship as a company and never ask for the relationship again when it was already supplied.

## Tool safety
Only use information_extractor after an explicit confirmation of the final summary.`;
const nodeText = `# STATE & SWEEP
## Capturing F1 — Shareholder?
If a caller says they are calling for their grandmother, family member, executor, trustee or advisor, set non-shareholder status, derive the relationship, and continue to F2.

## COMPANY RESOLUTION
Resolve a supplied company through company_resolver and confirm its result before requesting intent.
company_resolver may be called a maximum of 2 times.
Do not escalate solely because company resolution failed; continue to clarify the company.

## FINAL HANDOFF
Give a summary containing relationship, resolved company and one prioritized intent. Ask for explicit confirmation, then call information_extractor.`;

const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const now = () => new Date().toISOString();
const make = (kind: string, payload: Doc, version: number, active = false): Doc => ({ id: uid(), kind, version, active, created_at: now(), updated_at: now(), ...payload });
const blocks = (source: string, text: string) => text.split(/\r?\n/).map((line, index) => ({ line, index: index + 1 })).filter(({ line }) => line.trim() && !line.startsWith("#")).map(({ line, index }, offset) => ({ id: `${source.toUpperCase()}.POLICY.${String(offset + 1).padStart(2, "0")}`, source, section: "POLICY", text: line.trim(), lineStart: index, lineEnd: index }));

function fresh(): Store {
  const global = make("prompt", { name: "CPU Global Prompt", source: "global", node_name: null, text: globalText, blocks: blocks("global", globalText) }, 1, true);
  const node = make("prompt", { name: "information_extractor intake node", source: "node", node_name: "information_extractor", text: nodeText, blocks: blocks("node", nodeText) }, 2, true);
  const metrics = [["CPU-01 — Workflow Order Adherence", "workflow_order", .8], ["CPU-02 — Context Preservation / No Repetition", "context_preservation", .85], ["CPU-03 — Relationship Handling", "relationship_handling", .9], ["CPU-04 — Company Resolution Correctness", "company_resolution", .85], ["CPU-05 — Intent Capture Accuracy", "intent_capture", .8], ["CPU-06 — Final Summary & Handoff Integrity", "final_handoff", .9], ["CPU-07 — Escalation Compliance", "escalation", .9]].map(([name, implementation_key, threshold], index) => make("metric", { name, type: "deterministic", description: "Local CPU trace check.", enabled: false, threshold, weight: 1, judge_model: null, criteria: null, implementation_key }, index + 1));
  return { flowVersion, prompts: [global, node], datasets: [], metrics, runs: [] };
}

function read(): Store {
  if (typeof window === "undefined") return fresh();
  try { const value = window.localStorage.getItem(key); if (value) { const saved = JSON.parse(value) as Store; if (saved.flowVersion !== flowVersion) { saved.datasets = saved.datasets.map(rebuildSuggestions); saved.flowVersion = flowVersion; write(saved); } return saved; } } catch { /* reset malformed local state */ }
  const initial = fresh(); write(initial); return initial;
}
function write(store: Store) { if (typeof window !== "undefined") window.localStorage.setItem(key, JSON.stringify(store)); }
export function bootstrap(): Doc { const store = read(); return { ...store, secrets: [], judgeConfigured: true, dashboard: { latestScore: store.runs[0]?.weightedScore ?? null } }; }
export const idealActions = actions;

function rowValues(csv: string): string[][] {
  const values: string[][] = []; let row: string[] = []; let field = ""; let quote = false;
  for (let index = 0; index < csv.length; index += 1) { const character = csv[index]; if (character === '"' && quote && csv[index + 1] === '"') { field += '"'; index += 1; } else if (character === '"') quote = !quote; else if (character === "," && !quote) { row.push(field.trim()); field = ""; } else if ((character === "\n" || character === "\r") && !quote) { if (character === "\r" && csv[index + 1] === "\n") index += 1; row.push(field.trim()); if (row.some(Boolean)) values.push(row); row = []; field = ""; } else field += character; }
  row.push(field.trim()); if (row.some(Boolean)) values.push(row); return values;
}
function header(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function csvGroups(csv: string, kind: "user" | "actual") {
  const values = rowValues(csv.replace(/^\uFEFF/, "")); if (values.length < 2) throw new Error("CSV needs a header row and at least one data row.");
  const headers = values[0].map(header); const at = (candidates: string[]) => headers.findIndex((value) => candidates.includes(value));
  const conversation = at(["conversationid", "callid", "sessionid", "id"]); const turn = at(["turn", "turnnumber", "turnid", "sequence", "index", "order"]); const user = at(["userturn", "callerturn", "caller", "customer", "user", "utterance", "input", "message"]); const actual = at(["actualagentturn", "agentturn", "agent", "assistant", "actual", "response", "agentresponse"]); const message = kind === "user" ? user : actual;
  if (message < 0) throw new Error(`No ${kind === "user" ? "user_turn" : "actual_agent_turn"} column was found.`);
  const grouped = new Map<string, Doc[]>(); values.slice(1).forEach((value, index) => { if (!value[message]) return; const id = conversation >= 0 && value[conversation] ? value[conversation] : "conversation-1"; const number = turn >= 0 ? Number(value[turn]) : index + 1; grouped.set(id, [...(grouped.get(id) ?? []), { turn: Number.isFinite(number) ? number : index + 1, content: value[message], userContent: user >= 0 ? value[user] : "" }]); });
  if (!grouped.size) throw new Error("The CSV has no usable turns."); grouped.forEach((value) => value.sort((left, right) => left.turn - right.turn)); return grouped;
}

const relationship = (value: string) => value.match(/\b(grandmother|grandfather|grandparent|mother|father|mom|dad|son|daughter|grandson|granddaughter|nephew|niece|wife|husband|spouse|sister|brother|aunt|uncle|family|executor|trustee|advisor|broker)\b/i)?.[1] ?? null;
const shareholderStatus = (value: string): "yes" | "no" | null => {
  if (/\b(no|not|isn't|am not|i'm not)\b[^.?!]{0,30}\bshareholder\b|\bcalling on behalf of\b/i.test(value)) return "no";
  // In response to the status question, callers often answer with just
  // "shareholder" rather than a complete sentence. That is an affirmative
  // status and should advance the flow to collecting the company (F2).
  if (/^\s*(?:yes[,.]?\s*)?(?:(?:i am|i'm|im)\s+)?(?:a\s+|the\s+)?shareholder\s*[.!?]*\s*$/i.test(value)) return "yes";
  return /\b(i am|i'm|the)\b[^.?!]{0,30}\bshareholder\b|\byes\b[^.?!]{0,30}\bshareholder\b/i.test(value) ? "yes" : null;
};
const negative = (value: string) => /^\s*(no|nope|nah)\W*\s*$/i.test(value);
const shareholderRefusal = (value: string) => /\b(refuse|won't|will not|don't want|do not want|rather not|none of your business|not telling|can't say)\b/i.test(value);
const companies = (value: string) => {
  if (relationship(value)) return [];
  const explicit = [...value.matchAll(/(?:company|regarding|about|with)\s+(?:is\s+)?([A-Z][A-Za-z& .,'-]{1,80}?)(?=(?:\s+(?:and|or)\s+)|[,.!?]|$)/g)].map((match) => match[1].trim().replace(/[. ]+$/, ""));
  const named = [...value.matchAll(/\b([A-Z][A-Za-z& .,'-]{2,80}?(?:Corporation|Corp\.?|Inc\.?|Ltd\.?|LLC|PLC|Company))\b/g)].map((match) => match[1].trim().replace(/^(?:no,?\s+)?(?:it is|it's)\s+/i, "").replace(/[. ]+$/, ""));
  return [...new Set([...explicit, ...named].filter((item) => item.length > 1))];
};
const simpleCompanyReply = (value: string) => {
  const candidate = value.trim().replace(/[.!?]+$/, "").replace(/^(?:it(?:'s| is)|the company (?:is|was)|company(?: name)? (?:is|was)|i think (?:it's|it is))\s+/i, "").trim();
  if (!candidate || candidate.length > 80 || !/^[A-Za-z0-9&.,' -]+$/.test(candidate) || /\b(no|yes|don't know|do not know|not sure|no idea|can't|cannot|help|shareholder|relationship)\b/i.test(candidate)) return [];
  const names = candidate.split(/\s+(?:and|or)\s+/i).map((item) => item.trim()).filter(Boolean);
  return names.length && names.every((item) => /^[A-Za-z0-9][A-Za-z0-9&.,' -]{1,80}$/.test(item)) ? names : [];
};
const companiesForTurn = (value: string, previousAction: string) => {
  const detected = companies(value);
  return detected.length || !["ASK_FOR_COMPANY", "ASK_COMPANY_FOCUS"].includes(previousAction) ? detected : simpleCompanyReply(value);
};
const companySearchFailure = (value: string) => /\b(don't know|do not know|not sure|no idea|can't find|cannot find|can't locate|cannot locate|unable to (?:find|locate)|trying to (?:find|locate))\b/i.test(value);
const company = (value: string) => companies(value)[0] ?? null;
const intents = (value: string) => { const found = [...new Set([...value.matchAll(/\b(transfer|sell|buy|dividend|certificate|address|tax|payment|shares?|proxy|vote|estate|inherit|account)\b/gi)].map((match) => match[1].toLowerCase()))]; const specific = found.filter((item) => !["share", "shares", "payment", "account"].includes(item)); return specific.length ? specific : found.filter((item) => !["share", "shares"].includes(item)); };
const intent = (value: string) => intents(value)[0] ?? null;
const nextAction = (state: Doc) => state.shareholderStatus === "unknown" ? state.shareholderRefusals >= 2 ? "TRANSFER" : "ASK_SHAREHOLDER_STATUS" : state.shareholderStatus === "no" && !state.relationship ? "ASK_RELATIONSHIP" : state.multipleCompanies ? "ASK_COMPANY_FOCUS" : state.companyTrouble && !state.companyBypassed ? "HANDLE_COMPANY_LOOKUP_FAILURE" : !state.company && !state.companyBypassed ? "ASK_FOR_COMPANY" : !state.companyConfirmed && !state.companyBypassed ? "CALL_COMPANY_RESOLVER" : state.multipleIntents ? "ASK_INTENT_PRIORITY" : !state.intent ? "ASK_INTENT" : !state.summary ? "GIVE_FINAL_SUMMARY" : !state.finalConfirmation ? "ASK_FINAL_CONFIRMATION" : "CALL_INFORMATION_EXTRACTOR";
function responseFor(action: string, state: Doc) {
  const companyName = state.company ?? "the company you mentioned"; const relationshipName = state.relationship ?? "the shareholder"; const intentName = state.intent ?? "your request";
  return ({ ASK_SHAREHOLDER_STATUS: state.shareholderRefusals === 1 ? "I understand. To help you, I need to confirm whether you are the shareholder. Are you the shareholder on the account?" : "Are you the shareholder on the account, or calling on behalf of someone else?", ASK_RELATIONSHIP: "What is your relationship to the shareholder?", ASK_FOR_COMPANY: "Which company are you calling about?", CALL_COMPANY_RESOLVER: `Tool: company_resolver('${companyName}')\nTool result: ${companyName}\nAgent: I found ${companyName}. Is that the company you are calling about?`, ASK_COMPANY_FOCUS: "I heard more than one company. Which company would you like to focus on first?", HANDLE_COMPANY_LOOKUP_FAILURE: "It seems like we are having trouble locating the company, but that is okay. What do you need help with today?", ASK_INTENT: "What do you need help with today?", ASK_INTENT_PRIORITY: "I heard multiple requests. Which one would you like to prioritize first?", GIVE_FINAL_SUMMARY: `Just to confirm, you are calling on behalf of ${relationshipName} regarding ${companyName} and need help with ${intentName}. Is that correct?`, ASK_FINAL_CONFIRMATION: "Please confirm that summary is correct before I continue.", CALL_INFORMATION_EXTRACTOR: `information_extractor({ intent: '${intentName}' })`, TRANSFER: "I will connect you with a senior agent so they can help further." } as Record<string, string>)[action] ?? "";
}
export function idealReplyTemplate(action: string) {
  return responseFor(action, {
    shareholderRefusals: 0,
    relationship: "the shareholder",
    company: "the company you mentioned",
    intent: "your request",
  });
}
function buildDataset(payload: Doc) {
  const users = csvGroups(payload.user_turn_csv, "user"); const actuals = payload.actual_turn_csv ? csvGroups(payload.actual_turn_csv, "actual") : new Map<string, Doc[]>();
  const conversations = [...users.entries()].map(([conversationId, userRows]) => {
    const state: Doc = { shareholderStatus: "unknown", shareholderRefusals: 0, relationship: null, company: null, companyMentions: 0, companyAttempts: 0, companySearchFailures: 0, companyConfirmed: false, companyTrouble: false, companyBypassed: false, multipleCompanies: false, intent: null, multipleIntents: false, summary: false, finalConfirmation: false };
    let previousIdealAction = "";
    const idealRows = userRows.map((row) => {
      let status = shareholderStatus(row.content);
      const suppliedRelationship = relationship(row.content);
      const suppliedCompanies = companiesForTurn(row.content, previousIdealAction);
      const suppliedIntents = intents(row.content);

      if (!status && (previousIdealAction === "ASK_SHAREHOLDER_STATUS" || state.shareholderStatus === "unknown") && affirmative(row.content)) status = "yes";
      if (!status && (previousIdealAction === "ASK_SHAREHOLDER_STATUS" || state.shareholderStatus === "unknown") && negative(row.content)) status = "no";
      if (status) { state.shareholderStatus = status; state.shareholderRefusals = 0; }
      if (suppliedRelationship) { state.shareholderStatus = "no"; state.relationship = suppliedRelationship; }
      if (state.shareholderStatus === "unknown" && shareholderRefusal(row.content)) state.shareholderRefusals += 1;
      if (affirmative(row.content) && previousIdealAction === "CALL_COMPANY_RESOLVER") state.companyConfirmed = true;
      if (negative(row.content) && previousIdealAction === "CALL_COMPANY_RESOLVER" && !suppliedCompanies.length) { state.company = null; state.companyConfirmed = false; }
      if (affirmative(row.content) && ["GIVE_FINAL_SUMMARY", "ASK_FINAL_CONFIRMATION"].includes(previousIdealAction)) state.finalConfirmation = true;
      if (["ASK_FOR_COMPANY", "ASK_COMPANY_FOCUS", "CALL_COMPANY_RESOLVER"].includes(previousIdealAction) && !suppliedCompanies.length && companySearchFailure(row.content)) {
        state.companySearchFailures += 1;
        if (state.companySearchFailures >= 3) state.companyTrouble = true;
      }

      if (suppliedCompanies.length > 1) { state.multipleCompanies = true; state.companyConfirmed = false; }
      if (suppliedCompanies.length === 1) {
        state.multipleCompanies = false;
        state.company = suppliedCompanies[0];
        state.companyConfirmed = false;
        state.companyMentions += 1;
        if (state.companyAttempts >= 2 || state.companyMentions >= 3) state.companyTrouble = true;
      }
      if (suppliedIntents.length > 1) { state.multipleIntents = true; state.intent = null; }
      if (suppliedIntents.length === 1) { state.multipleIntents = false; state.intent = suppliedIntents[0]; }

      const suggestedAction = nextAction(state);
      const idealResponse = responseFor(suggestedAction, state);
      if (suggestedAction === "CALL_COMPANY_RESOLVER") state.companyAttempts += 1;
      if (suggestedAction === "HANDLE_COMPANY_LOOKUP_FAILURE") { state.companyTrouble = true; state.companyBypassed = true; }
      if (suggestedAction === "GIVE_FINAL_SUMMARY") state.summary = true;
      previousIdealAction = suggestedAction;
      return { id: uid(), turn: row.turn, userTurn: row.content, suggestedAction, idealAction: suggestedAction, idealResponse, idealOverride: false };
    });
    const actualRows = actuals.get(conversationId) ?? [];
    const matching = new Map(actualRows.map((row) => [row.turn, row]));
    const actualTurns: Turn[] = [];
    userRows.forEach((row) => { const actual = matching.get(row.turn); actualTurns.push({ id: uid(), index: actualTurns.length, role: "caller", content: actual?.userContent || row.content }); if (actual) actualTurns.push({ id: uid(), index: actualTurns.length, role: "agent", content: actual.content }); });
    return { conversationId, userRows, actualRows, idealRows, actualTurns, actualAttached: Boolean(actualRows.length) };
  });
  return { name: payload.name, source: "CSV turn-wise import", conversations, conversationCount: conversations.length, actualConversationCount: conversations.filter((item) => item.actualAttached).length };
}

function csvCell(value: unknown) { const text = String(value ?? ""); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
function rebuildSuggestions(dataset: Doc): Doc {
  const userRows = ["conversation_id,turn,user_turn", ...dataset.conversations.flatMap((conversation: Doc) => conversation.userRows.map((row: Doc) => [conversation.conversationId, row.turn, row.content].map(csvCell).join(",")))].join("\n");
  const actualRows = ["conversation_id,turn,actual_agent_turn", ...dataset.conversations.flatMap((conversation: Doc) => conversation.actualRows.map((row: Doc) => [conversation.conversationId, row.turn, row.content].map(csvCell).join(",")))].join("\n");
  const rebuilt = buildDataset({ name: dataset.name, user_turn_csv: userRows, actual_turn_csv: dataset.conversations.some((conversation: Doc) => conversation.actualRows.length) ? actualRows : null });
  const priorRows = new Map<string, Doc>(dataset.conversations.flatMap((conversation: Doc) => conversation.idealRows.map((row: Doc) => [`${conversation.conversationId}:${row.turn}`, row] as [string, Doc])));
  rebuilt.conversations.forEach((conversation: Doc) => conversation.idealRows.forEach((row: Doc) => {
    const prior = priorRows.get(`${conversation.conversationId}:${row.turn}`);
    // Keep a deliberate user edit, but replace stale automatically generated
    // choices with the corrected next-step recommendation.
    const hasManualOverride = prior?.idealOverride === true || (prior?.idealAction && prior.idealAction !== prior.suggestedAction);
    if (hasManualOverride) {
      row.idealAction = prior.idealAction;
      row.idealResponse = prior.idealResponse;
      row.idealOverride = true;
    }
  }));
  return { ...dataset, ...rebuilt, updated_at: now() };
}

function actionFor(text: string) { const lower = text.toLowerCase(); if (lower.includes("company_resolver")) return "CALL_COMPANY_RESOLVER"; if (lower.includes("information_extractor")) return "CALL_INFORMATION_EXTRACTOR"; if (/(trouble locating|trouble finding|unable to locate).{0,100}(what do you need|help with|intent)/.test(lower)) return "HANDLE_COMPANY_LOOKUP_FAILURE"; if (/(representative|human agent|transfer you|connect you|senior agent|supervisor)/.test(lower)) return "TRANSFER"; if (/(shareholder.*(?:you|account)|are you.*shareholder)/.test(lower)) return "ASK_SHAREHOLDER_STATUS"; if (/(how.*related|relationship.*shareholder|what.*relationship)/.test(lower)) return "ASK_RELATIONSHIP"; if (/(multiple|more than one).{0,30}company|which company.{0,35}(focus|first)/.test(lower)) return "ASK_COMPANY_FOCUS"; if (/(which|what).{0,30}company|company.{0,30}(calling|about)/.test(lower)) return "ASK_FOR_COMPANY"; if (/(i found|is that the company|confirm.*company)/.test(lower)) return "CONFIRM_COMPANY"; if (/(multiple|more than one).{0,30}(request|intent)|which.{0,30}(prioriti[sz]e|first)/.test(lower)) return "ASK_INTENT_PRIORITY"; if (/(what do you need help|how can.*help|reason.*calling|what.*help with)/.test(lower)) return "ASK_INTENT"; if (/(just to confirm|to summarize|summary.*(?:correct|right))/.test(lower)) return "GIVE_FINAL_SUMMARY"; if (/(is that correct|does that sound right|confirm that)/.test(lower)) return "ASK_FINAL_CONFIRMATION"; return "ACKNOWLEDGE"; }
const affirmative = (value: string) => /^\s*(yes|yeah|yep|correct|that's right|that is correct|sure)\W*\s*$/i.test(value);
function score(keyName: string, turns: Turn[]): [number, string, number | null] {
  const caller = turns.filter((turn) => turn.role === "caller"); const agent = turns.filter((turn) => turn.role === "agent"); const hasRelationship = caller.some((turn) => Boolean(relationship(turn.content))); const hasCompany = caller.some((turn) => Boolean(company(turn.content))); const hasIntent = caller.some((turn) => Boolean(intent(turn.content))); const fail = (condition: (turn: Turn) => boolean, reason: string): [number, string, number | null] | null => { const turn = agent.find(condition); return turn ? [0, reason, turn.index + 1] : null; };
  if (keyName === "context_preservation" || keyName === "intent_capture") return fail((turn) => (hasRelationship && actionFor(turn.content) === "ASK_RELATIONSHIP") || (hasCompany && actionFor(turn.content) === "ASK_FOR_COMPANY") || (hasIntent && actionFor(turn.content) === "ASK_INTENT"), "The agent asked for information already supplied by the caller.") ?? [1, "No repeated supplied field was observed.", null];
  if (keyName === "relationship_handling") return fail((turn) => hasRelationship && actionFor(turn.content) === "ASK_RELATIONSHIP", "A supplied relationship was requested again.") ?? [1, "Relationship input was not re-requested.", null];
  if (keyName === "workflow_order") return fail((turn) => (!hasRelationship && ["ASK_FOR_COMPANY", "ASK_INTENT", "GIVE_FINAL_SUMMARY"].includes(actionFor(turn.content))) || (hasRelationship && !hasCompany && ["ASK_INTENT", "GIVE_FINAL_SUMMARY"].includes(actionFor(turn.content))), "The workflow advanced before an earlier field was resolved.") ?? [1, "Observed actions respect the CPU sequence.", null];
  if (keyName === "company_resolution") { const calls = turns.filter((turn) => turn.content.includes("company_resolver")); return calls.length > 2 ? [0, `company_resolver was called ${calls.length} times; the maximum is two.`, calls[2].index + 1] : [1, "Company resolver use is trace-compliant where observable.", null]; }
  if (keyName === "final_handoff") { const handoff = turns.find((turn) => turn.content.includes("information_extractor")); return handoff && !caller.some((turn) => affirmative(turn.content)) ? [0, "Final handoff occurred before explicit confirmation.", handoff.index + 1] : [1, "No premature final handoff was observed.", null]; }
  if (keyName === "escalation") return caller.some((turn) => /\b(human|representative|supervisor)\b/i.test(turn.content)) && !agent.some((turn) => actionFor(turn.content) === "TRANSFER") ? [0, "The caller asked for a human representative but no transfer response was observed.", null] : [1, "Escalation behavior is compliant.", null];
  return [1, "Deterministic check completed.", null];
}
function selectedAction(row: Doc) { return row.idealAction || row.suggestedAction; }
function idealTurns(conversation: Doc): Turn[] { const output: Turn[] = []; conversation.idealRows.forEach((row: Doc) => { output.push({ id: uid(), index: output.length, role: "caller", content: row.userTurn }); output.push({ id: uid(), index: output.length, role: selectedAction(row).startsWith("CALL_") ? "tool" : "agent", content: row.idealResponse }); }); return output; }
async function llmMetric(metric: Doc, turns: Turn[]) {
  const response = await fetch("/api/judge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ criteria: metric.criteria, model: metric.judge_model, transcript: turns.filter((turn) => turn.role !== "tool").map((turn) => `${turn.role === "caller" ? "Caller" : "Agent"}: ${turn.content}`).join("\n") }) });
  const body = await response.json(); if (!response.ok) throw new Error(body.detail ?? "LLM judge failed."); return body as { score: number; reason: string };
}

const actionKeywords: Record<string, string[]> = {
  ASK_SHAREHOLDER_STATUS: ["shareholder", "F1", "status"],
  ASK_RELATIONSHIP: ["relationship", "family", "grandmother", "non-shareholder", "F1"],
  ASK_FOR_COMPANY: ["company", "F2"],
  CALL_COMPANY_RESOLVER: ["company_resolver", "resolve", "company", "F2"],
  ASK_COMPANY_FOCUS: ["company", "focus", "multiple"],
  HANDLE_COMPANY_LOOKUP_FAILURE: ["company", "failed", "failure", "clarify"],
  ASK_INTENT: ["intent", "F3", "help"],
  ASK_INTENT_PRIORITY: ["intent", "prioritized", "multiple"],
  GIVE_FINAL_SUMMARY: ["summary", "relationship", "company", "intent"],
  ASK_FINAL_CONFIRMATION: ["confirmation", "confirm", "summary"],
  CALL_INFORMATION_EXTRACTOR: ["information_extractor", "confirmation", "summary"],
  TRANSFER: ["escalat", "transfer", "senior"],
};

function promptBlocks(prompts: Doc[]) {
  return prompts.flatMap((prompt) => (prompt.blocks ?? []).map((block: Doc) => ({
    ...block,
    promptName: prompt.name,
    promptVersion: prompt.version,
    sourceLabel: prompt.source === "global" ? "Global prompt" : `${prompt.node_name || "Node"} prompt`,
  })));
}

function blockForAction(action: string, blocks: Doc[]) {
  const keywords = actionKeywords[action] ?? [];
  return blocks.map((block) => ({ block, relevance: keywords.reduce((total, keyword) => total + (block.text.toLowerCase().includes(keyword.toLowerCase()) ? 1 : 0), 0) }))
    .sort((left, right) => right.relevance - left.relevance)[0]?.block ?? null;
}

function improvementFor(expectedAction: string, actualAction: string) {
  const preserve = {
    ASK_SHAREHOLDER_STATUS: "If shareholder status is already explicit in any earlier caller turn, preserve it and advance to the next unresolved field.",
    ASK_RELATIONSHIP: "If the caller already supplied a relationship, preserve F1 and continue to the next unresolved field without asking again.",
    ASK_FOR_COMPANY: "Before asking for a company, check the full conversation state. If one was supplied, resolve or confirm it instead of asking again.",
    ASK_INTENT: "Before asking for intent, check the full conversation state. If it was supplied, carry it forward to the summary instead of asking again.",
  } as Record<string, string>;
  return preserve[actualAction] ?? `Clarify the instruction so the agent follows ${expectedAction.replaceAll("_", " ").toLowerCase()} after reviewing the complete conversation state.`;
}

function traceFor(expectedAction: string, actualAction: string, blocks: Doc[]) {
  const promptLine = blockForAction(expectedAction, blocks);
  const problematicInstruction = blockForAction(actualAction === "ACKNOWLEDGE" ? expectedAction : actualAction, blocks);
  return {
    promptLine,
    problematicInstruction,
    improvement: expectedAction === actualAction || actualAction === "ACKNOWLEDGE" ? null : improvementFor(expectedAction, actualAction),
  };
}

function promptsForAnalysis(store: Store, payload: Doc) {
  const select = (source: "global" | "node", id?: string) => id
    ? store.prompts.filter((prompt) => prompt.id === id && prompt.source === source)
    : store.prompts.filter((prompt) => prompt.source === source && prompt.active);
  return [...select("global", payload.global_prompt_id), ...select("node", payload.node_prompt_id)];
}

async function analyze(store: Store, datasetId: string, payload: Doc) {
  const dataset = store.datasets.find((item) => item.id === datasetId); if (!dataset) throw new Error("Dataset not found."); const conversations = dataset.conversations.filter((item: Doc) => item.actualTurns?.length); if (!conversations.length) throw new Error("This dataset has no matching actual-agent turns.");
  const metrics = store.metrics.filter((metric) => (payload.metric_ids ?? []).includes(metric.id)); const prompts = promptsForAnalysis(store, payload); const evidenceBlocks = promptBlocks(prompts); const runs = await Promise.all(conversations.map(async (conversation: Doc) => { const ideal = idealTurns(conversation); let callerIndex = -1; const actions = conversation.actualTurns.filter((turn: Turn) => turn.role === "agent").map((turn: Turn) => { callerIndex += 1; const row = conversation.idealRows[callerIndex] ?? {}; const expectedAction = selectedAction(row); const actualAction = actionFor(turn.content); return { turn: turn.index + 1, callerInput: row.userTurn ?? "", agentResponse: turn.content, expectedAction, actualAction, decision: actualAction === expectedAction || actualAction === "ACKNOWLEDGE" ? "CORRECT" : "INCORRECT", promptTrace: traceFor(expectedAction, actualAction, evidenceBlocks) }; }); const results = await Promise.all(metrics.map(async (metric) => { if (metric.implementation_key) { const [value, reason, break_turn] = score(metric.implementation_key, conversation.actualTurns); return { metric_id: metric.id, name: metric.name, type: metric.type, evaluation_scope: "conversation", threshold: metric.threshold, weight: metric.weight, score: value, status: value >= metric.threshold ? "PASS" : "FAIL", reason, break_turn }; } try { const judged = await llmMetric(metric, conversation.actualTurns); return { metric_id: metric.id, name: metric.name, type: metric.type, evaluation_scope: "conversation", threshold: metric.threshold, weight: metric.weight, score: judged.score, status: judged.score >= metric.threshold ? "PASS" : "FAIL", reason: judged.reason }; } catch (error) { return { metric_id: metric.id, name: metric.name, type: metric.type, evaluation_scope: "conversation", threshold: metric.threshold, weight: metric.weight, score: null, status: "NOT_RUN", reason: error instanceof Error ? error.message : "LLM judge did not run." }; } })); const scored = results.filter((result) => result.score != null); const weightedScore = scored.length ? scored.reduce((total, result) => total + result.score * result.weight, 0) / scored.reduce((total, result) => total + result.weight, 0) : null; const report = make("evaluation", { name: `${dataset.name} · ${conversation.conversationId}`, conversationId: conversation.conversationId, outcome: weightedScore == null ? "NOT_RUN" : weightedScore >= .8 ? "PASS" : "FAIL", weightedScore: weightedScore == null ? null : Number(weightedScore.toFixed(2)), metricResults: results, transcript: conversation.actualTurns, idealTranscript: ideal, actionTrace: actions, breaks: actions.filter((item: Doc) => item.decision === "INCORRECT").map((item: Doc) => ({ turn: item.turn, expectedAction: item.expectedAction, actualAction: item.actualAction, severity: "HIGH", suggestedFix: `The selected ideal next action is ${String(item.expectedAction).replaceAll("_", " ").toLowerCase()}.` })), sources: { policy: prompts.map((item) => `${item.name} v${item.version}`) } }, store.runs.length + 1); store.runs.unshift(report); return report; })); return { datasetId, runs };
}

export async function localRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const store = read(); const payload = typeof options.body === "string" ? JSON.parse(options.body) as Doc : {}; let result: Doc;
  if (url === "/api/prompts" && options.method === "POST") { if (payload.set_active) store.prompts.forEach((item) => { if (item.source === payload.source) item.active = false; }); result = make("prompt", { ...payload, blocks: blocks(payload.source, payload.text) }, store.prompts.length + 1, Boolean(payload.set_active)); store.prompts.unshift(result); }
  else if (url === "/api/metrics" && options.method === "POST") { result = make("metric", payload, store.metrics.length + 1); store.metrics.unshift(result); }
  else if (/^\/api\/metrics\/[^/]+$/.test(url) && options.method === "PUT") { const old = store.metrics.find((item) => item.id === url.split("/").pop()); if (!old) throw new Error("Metric not found."); result = make("metric", { ...payload, definition_id: old.definition_id ?? old.id }, store.metrics.length + 1); store.metrics.unshift(result); }
  else if (url === "/api/datasets" && options.method === "POST") { result = make("dataset", buildDataset(payload), store.datasets.length + 1); store.datasets.unshift(result); }
  else if (/^\/api\/datasets\/[^/]+$/.test(url) && options.method === "PUT") { const index = store.datasets.findIndex((item) => item.id === url.split("/").pop()); if (index < 0) throw new Error("Dataset not found."); result = { ...store.datasets[index], ...payload, updated_at: now() }; store.datasets[index] = result; }
  else { const match = url.match(/^\/api\/datasets\/([^/]+)\/analyze$/); if (!match || options.method !== "POST") throw new Error("This action is not available locally."); result = await analyze(store, match[1], payload); }
  write(store); return result as T;
}
