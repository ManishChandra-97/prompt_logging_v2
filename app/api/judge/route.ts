import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type JudgeRequest = { task?: "run_summary"; criteria?: string; model?: string; policy?: string; transcript?: string; failures?: { metric?: string; reason?: string }[] };

function getApiKey() {
  try {
    const env = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    const line = env.split(/\r?\n/).find((value) => /^OPENAI_API_KEY\s*=/.test(value));
    const value = line?.replace(/^OPENAI_API_KEY\s*=\s*/, "").trim().replace(/^['\"]|['\"]$/g, "");
    if (value) return value;
  } catch { /* .env.local is optional; fall back to the process environment. */ }
  return process.env.OPENAI_API_KEY?.trim();
}

export async function GET() {
  const apiKey = getApiKey();
  return NextResponse.json({
    configured: Boolean(apiKey),
    keySuffix: apiKey ? apiKey.slice(-4) : null,
    model: "gpt-4.1-mini",
  });
}

export async function POST(request: Request) {
  const apiKey = getApiKey();
  if (!apiKey) return NextResponse.json({ detail: "OPENAI_API_KEY is missing from .env.local." }, { status: 503 });

  const { task, criteria, model, policy, transcript, failures } = await request.json() as JudgeRequest;
  if (task === "run_summary") {
    const failureSummary = (failures ?? []).filter((failure) => failure.metric?.trim() && failure.reason?.trim()).slice(0, 12);
    if (!failureSummary.length) return NextResponse.json({ detail: "At least one failed metric is required." }, { status: 400 });
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: model || "gpt-4.1-mini",
        store: false,
        instructions: "You improve agent prompts from an analysis run. Return an exact_fix with exactly five concise newline-separated lines that synthesize every supplied failed metric into actionable prompt changes. Explain the recurring failure patterns, the behaviors to make explicit, and any likely ambiguity or conflict in the active prompt. Do not mention individual turns, and do not add bullets or headings. Return only the required JSON.",
        input: `Active prompt context:\n${policy?.trim() || "No active prompt was selected."}\n\nFailed metric findings:\n${failureSummary.map((failure) => `${failure.metric}: ${failure.reason}`).join("\n")}`,
        text: {
          format: {
            type: "json_schema",
            name: "analysis_run_potential_fix",
            strict: true,
            schema: {
              type: "object",
              properties: { exact_fix: { type: "string" } },
              required: ["exact_fix"],
              additionalProperties: false,
            },
          },
        },
      }),
    });
    const body = await response.json();
    if (!response.ok) return NextResponse.json({ detail: body?.error?.message ?? "OpenAI request failed." }, { status: response.status });
    const output = (body.output ?? []).flatMap((item: { content?: { type?: string; text?: string }[] }) => item.content ?? []).find((item: { type?: string }) => item.type === "output_text")?.text;
    try {
      const result = JSON.parse(output ?? "") as { exact_fix: string };
      if (typeof result.exact_fix !== "string") throw new Error("Invalid potential fix output.");
      return NextResponse.json({ exact_fix: result.exact_fix });
    } catch {
      return NextResponse.json({ detail: "The LLM returned an unreadable potential fix." }, { status: 502 });
    }
  }
  if (!criteria?.trim() || !transcript?.trim()) return NextResponse.json({ detail: "A metric prompt and transcript are required." }, { status: 400 });

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: model || "gpt-4.1-mini",
      store: false,
      instructions: "You are a strict conversation-quality evaluator. Apply the metric criteria to the supplied transcript. Score from 0 to 1, where 1 is fully compliant. Give one concise reason that explains the score. Return only the required JSON.",
      input: `Evaluation criteria:\n${criteria}\n\nTranscript (turn numbers are authoritative):\n${transcript}`,
      text: {
        format: {
          type: "json_schema",
          name: "conversation_evaluation",
          strict: true,
          schema: {
            type: "object",
            properties: {
              score: { type: "number", minimum: 0, maximum: 1 },
              reason: { type: "string" },
            },
            required: ["score", "reason"],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  const body = await response.json();
  if (!response.ok) return NextResponse.json({ detail: body?.error?.message ?? "OpenAI request failed." }, { status: response.status });
  const output = (body.output ?? []).flatMap((item: { content?: { type?: string; text?: string }[] }) => item.content ?? []).find((item: { type?: string }) => item.type === "output_text")?.text;
  try {
    const result = JSON.parse(output ?? "") as { score: number; reason: string };
    if (typeof result.score !== "number" || typeof result.reason !== "string") throw new Error("Invalid judge output.");
    return NextResponse.json({ score: Math.max(0, Math.min(1, result.score)), reason: result.reason });
  } catch {
    return NextResponse.json({ detail: "The LLM returned an unreadable evaluation." }, { status: 502 });
  }
}
