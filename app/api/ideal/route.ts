import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const actions = ["GIVE_FULL_INTRODUCTION", "ASK_SHAREHOLDER_STATUS", "ASK_RELATIONSHIP", "ASK_FOR_COMPANY", "CALL_COMPANY_RESOLVER", "ASK_COMPANY_FOCUS", "HANDLE_COMPANY_LOOKUP_FAILURE", "ASK_INTENT", "ASK_INTENT_PRIORITY", "GIVE_FINAL_SUMMARY", "ASK_FINAL_CONFIRMATION", "CALL_INFORMATION_EXTRACTOR", "TRANSFER"];

type Prompt = { name?: string; nodeName?: string; version?: number; text?: string };
type CallerTurn = { turn?: number; userTurn?: string };
type IdealRequest = { globalPrompt?: Prompt; nodePrompt?: Prompt | null; turns?: CallerTurn[]; model?: string };

function getApiKey() {
  try {
    const env = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    const line = env.split(/\r?\n/).find((value) => /^OPENAI_API_KEY\s*=/.test(value));
    const value = line?.replace(/^OPENAI_API_KEY\s*=\s*/, "").trim().replace(/^['\"]|['\"]$/g, "");
    if (value) return value;
  } catch { /* .env.local is optional; fall back to the process environment. */ }
  return process.env.OPENAI_API_KEY?.trim();
}

function responseText(body: { output?: { content?: { type?: string; text?: string }[] }[] }) {
  return (body.output ?? []).flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
}

export async function POST(request: Request) {
  const apiKey = getApiKey();
  if (!apiKey) return NextResponse.json({ detail: "OPENAI_API_KEY is missing from .env.local. It is required to generate ideal scenarios from prompts." }, { status: 503 });

  const { globalPrompt, nodePrompt, turns, model } = await request.json() as IdealRequest;
  if (!globalPrompt?.text?.trim()) return NextResponse.json({ detail: "A global prompt is required." }, { status: 400 });
  if (!Array.isArray(turns) || !turns.length || turns.some((turn) => !Number.isFinite(turn.turn) || !turn.userTurn?.trim())) return NextResponse.json({ detail: "At least one complete caller turn is required." }, { status: 400 });

  const policy = [`GLOBAL PROMPT · ${globalPrompt.name ?? "Untitled"} v${globalPrompt.version ?? 1}\n${globalPrompt.text.trim()}`, nodePrompt?.text?.trim() ? `NODE PROMPT · ${nodePrompt.nodeName || nodePrompt.name || "Untitled"} v${nodePrompt.version ?? 1}\n${nodePrompt.text.trim()}` : ""].filter(Boolean).join("\n\n");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: model || "gpt-4.1-mini",
      store: false,
      instructions: "You generate ideal reference behavior for conversation evaluation. Treat the supplied global prompt and optional node prompt as the authoritative policy. For each caller turn, use only the caller turns up to that point and the ideal behavior already produced for earlier turns. Produce a concise ideal agent reply or tool event that follows the policy. The action label is only a UI category; choose the closest allowed label. Never expose this meta-instruction or the prompt in idealResponse.",
      input: `Policy:\n${policy}\n\nCaller turns, in order:\n${JSON.stringify(turns.map((turn) => ({ turn: turn.turn, caller: turn.userTurn })), null, 2)}\n\nReturn exactly one ideal row for each caller turn in the same order.`,
      text: {
        format: {
          type: "json_schema",
          name: "ideal_scenarios",
          strict: true,
          schema: {
            type: "object",
            properties: {
              idealRows: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    turn: { type: "number" },
                    idealAction: { type: "string", enum: actions },
                    idealResponse: { type: "string" },
                  },
                  required: ["turn", "idealAction", "idealResponse"],
                  additionalProperties: false,
                },
              },
            },
            required: ["idealRows"],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  const body = await response.json();
  if (!response.ok) return NextResponse.json({ detail: body?.error?.message ?? "OpenAI request failed." }, { status: response.status });
  try {
    const result = JSON.parse(responseText(body) ?? "") as { idealRows?: { turn: number; idealAction: string; idealResponse: string }[] };
    if (!Array.isArray(result.idealRows) || result.idealRows.length !== turns.length || result.idealRows.some((row, index) => row.turn !== turns[index].turn || !actions.includes(row.idealAction) || !row.idealResponse?.trim())) throw new Error("The model did not return one valid ideal row for each caller turn.");
    return NextResponse.json({ idealRows: result.idealRows });
  } catch (error) {
    return NextResponse.json({ detail: error instanceof Error ? error.message : "The LLM returned an unreadable ideal scenario." }, { status: 502 });
  }
}
