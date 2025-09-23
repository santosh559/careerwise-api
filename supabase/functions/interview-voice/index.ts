// supabase/functions/interview-voice/index.ts
// Voice mock interview: step = "start" | "turn" (multipart with audio) | "report"
// Requires secret: OPENAI_API_KEY (and optionally OPENAI_BASE_URL)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const OPENAI_BASE = Deno.env.get("OPENAI_BASE_URL") || "https://api.openai.com/v1";
const LLM_MODEL = Deno.env.get("INTERVIEW_LLM_MODEL") || "gpt-4o-mini"; // fast & cheap
const STT_MODEL = Deno.env.get("INTERVIEW_STT_MODEL") || "whisper-1";

// ---------- helpers ----------
async function transcribeWebm(file: File): Promise<string> {
  const form = new FormData();
  form.append("model", STT_MODEL);
  form.append("file", file, "answer.webm");
  const r = await fetch(`${OPENAI_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  if (!r.ok) throw new Error(`STT failed: ${r.status} ${await r.text()}`);
  const data = await r.json();
  return (data.text ?? data.transcript ?? "").toString();
}

async function chatJSON(payload: unknown) {
  const r = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: LLM_MODEL,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a strict but fair interviewer. Respond ONLY as compact JSON. " +
            "Rubric keys: Structure, Relevance, Depth, Evidence, Communication (1-5). " +
            "Keep coaching/suggested_next concise and practical.",
        },
        { role: "user", content: JSON.stringify(payload) },
      ],
    }),
  });
  if (!r.ok) throw new Error(`LLM failed: ${r.status} ${await r.text()}`);
  const data = await r.json();
  const out = data.choices?.[0]?.message?.content || "{}";
  try { return JSON.parse(out); } catch { return {}; }
}

function firstQuestion(role: string) {
  return `Let's begin the ${role} interview. In ~90 seconds, describe a project where you had the biggest impact. Cover context → your actions → measurable results.`;
}

function packStart(role: string, count: number) {
  return {
    ok: true,
    step: "start",
    question: firstQuestion(role),
    maxQuestions: count,
    rubric: ["Structure", "Relevance", "Depth", "Evidence", "Communication"],
    summary: "",
  };
}

async function evaluateTurn(args: {
  role: string;
  question: string;
  transcript: string;
  running_summary: string;
  q_index: number;
  max_questions: number;
}) {
  const req = {
    task: "evaluate_turn",
    role: args.role,
    question: args.question,
    candidate_answer: args.transcript,
    running_summary: args.running_summary,
    rubric: ["Structure","Relevance","Depth","Evidence","Communication"],
    need_next: args.q_index + 1 < args.max_questions,
    schema_hint: {
      type: "object",
      properties: {
        eval: {
          type: "object",
          properties: {
            scores: { type: "object" },
            positives: { type: "array", items: { type: "string" } },
            gaps: { type: "array", items: { type: "string" } },
            coaching: { type: "string" },
            sample_answer: { type: "string" },
          },
          required: ["scores","coaching"]
        },
        next: { type: "object", properties: { question: { type: ["string","null"] } } },
        updated_summary: { type: "string" }
      },
      required: ["eval","updated_summary"]
    }
  };

  const j = await chatJSON(req);

  const evalBlock = j.eval ?? {
    scores: { Structure: 3, Relevance: 3, Depth: 3, Evidence: 3, Communication: 3 },
    positives: [],
    gaps: [],
    coaching: "Try the STAR pattern and quantify outcomes.",
    sample_answer: "",
  };

  const nextQ = j.next?.question ??
    (args.q_index + 1 < args.max_questions
      ? "Tell me about a time you disagreed with a teammate. What did you do and what was the outcome?"
      : null);

  const updated = j.updated_summary ??
    `${args.running_summary}\nQ${args.q_index + 1}: ${args.question}\nA: ${args.transcript}\n`;

  return {
    transcript: args.transcript,
    eval: evalBlock,
    next: { question: nextQ },
    updated_summary: updated,
  };
}

// ---------- handler ----------
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const ct = (req.headers.get("content-type") || "").toLowerCase();

    // JSON routes: start/report
    if (ct.includes("application/json")) {
      const body = await req.json();
      const step = (body.step || "start") as string;

      if (step === "start") {
        const role = (body.role || "Software Engineer").toString();
        const count = Number(body.count || 6);
        return Response.json(packStart(role, Math.min(Math.max(count, 3), 8)), { headers: CORS });
      }

      if (step === "report") {
        const role = (body.role || "Software Engineer").toString();
        const running_summary = (body.running_summary || "").toString();

        const j = await chatJSON({
          task: "final_report",
          role,
          running_summary,
          rubric: ["Structure","Relevance","Depth","Evidence","Communication"],
          schema_hint: {
            type: "object",
            properties: {
              report: {
                type: "object",
                properties: {
                  overall_signal: { type: "string" },
                  summary: { type: "string" },
                  strengths: { type: "array", items: { type: "string" } },
                  improvements: { type: "array", items: { type: "string" } },
                  next_steps: { type: "array", items: { type: "string" } }
                }
              }
            },
            required: ["report"]
          }
        });

        return Response.json({ ok: true, step, report: j.report ?? j }, { headers: CORS });
      }

      return Response.json({ ok: false, error: "Unknown step" }, { headers: CORS, status: 400 });
    }

    // Multipart route: turn (with audio)
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const step = (form.get("step") || "turn").toString();
      if (step !== "turn") return Response.json({ ok:false, error:"Invalid multipart step" }, { headers: CORS, status: 400 });

      const role = (form.get("role") || "Software Engineer").toString();
      const question = (form.get("question") || "").toString();
      const q_index = Number(form.get("q_index") || 0);
      const max_questions = Number(form.get("max_questions") || 6);
      const running_summary = (form.get("running_summary") || "").toString();
      const audio = form.get("audio") as File | null;
      if (!audio) return Response.json({ ok:false, error:"Missing audio" }, { headers: CORS, status: 400 });

      const transcript = await transcribeWebm(audio);
      const result = await evaluateTurn({
        role, question, transcript, running_summary, q_index, max_questions
      });

      return Response.json({ ok: true, step, ...result }, { headers: CORS });
    }

    return new Response("Unsupported content-type", { headers: CORS, status: 415 });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { headers: CORS, status: 500 });
  }
});
