import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type JudgeRequest = { criteria?: string; model?: string; policy?: string; transcript?: string };

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

  const { criteria, model, policy, transcript } = await request.json() as JudgeRequest;
  if (!criteria?.trim() || !transcript?.trim()) return NextResponse.json({ detail: "A metric prompt and transcript are required." }, { status: 400 });

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: model || "gpt-4.1-mini",
      store: false,
      instructions: "You are a strict conversation-quality evaluator. Apply the metric criteria to the supplied transcript. Score from 0 to 1, where 1 is fully compliant. Give one concise reason that explains the score. If the score is below 0.5, provide a one- or two-sentence potential_fix that starts with “You might need to” and identifies which active prompt instruction should be clarified or reconciled and why it may be unclear or conflicting. Use the policy only to create this potential fix; never quote or cite its wording. For scores of 0.5 or more, return an empty potential_fix. Return only the required JSON.",
      input: `Evaluation criteria:\n${criteria}\n\nActive policy context for a potential fix only:\n${policy?.trim() || "No active prompt was selected."}\n\nTranscript (turn numbers are authoritative):\n${transcript}`,
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
              potential_fix: { type: "string" },
            },
            required: ["score", "reason", "potential_fix"],
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
    const result = JSON.parse(output ?? "") as { score: number; reason: string; potential_fix: string };
    if (typeof result.score !== "number" || typeof result.reason !== "string" || typeof result.potential_fix !== "string") throw new Error("Invalid judge output.");
    return NextResponse.json({ score: Math.max(0, Math.min(1, result.score)), reason: result.reason, potential_fix: result.potential_fix });
  } catch {
    return NextResponse.json({ detail: "The LLM returned an unreadable evaluation." }, { status: 502 });
  }
}
