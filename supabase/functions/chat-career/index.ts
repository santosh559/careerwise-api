// Supabase Edge Function: Career-only Chatbot
// POST { message: string, history?: {role:"user"|"assistant", content:string}[] }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
if (!OPENAI_KEY) console.error("Missing OPENAI_API_KEY");

type Turn = { role: "user" | "assistant"; content: string };
type Body = { message?: string; history?: Turn[] };

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });

  try {
    const { message = "", history = [] } = (await req.json().catch(() => ({}))) as Body;
    const userMsg = String(message || "").trim();
    if (!userMsg) return json({ error: "message is required" }, 400);

    // 1) Cheap intent gate (career-only)
    const gate = await classify(userMsg);
    if (!gate.in_scope) {
      const refusal =
        "I can’t help with that topic. I’m your CareerWise assistant—ask me anything about careers: choosing roles, skills to learn, roadmaps, resumes, interview prep, or growth at work.";
      return json({ reply: refusal, in_scope: false });
    }

    // 2) Answer within strict career scope
    const system =
      [
        "You are CareerWise, a helpful career assistant.",
        "Stay STRICTLY within career topics: role exploration, skills, learning paths, resumes/portfolios, interview prep, job search, compensation bands, workplace growth.",
        "If the user veers off-topic, DO NOT answer—politely steer them back to career topics.",
        "Be concise, concrete, and step-by-step. Prefer bullet points and links to reputable resources.",
      ].join(" ");

    // trim history to last 10 turns
    const shortHistory = history.slice(-10).map(h => ({
      role: h.role,
      content: h.content
    }));

    const messages = [
      { role: "system", content: system },
      ...shortHistory,
      { role: "user", content: userMsg }
    ];

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        max_tokens: 800,
        messages
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("OpenAI error:", res.status, txt);
      return json({
        reply:
          "I’m having trouble reaching the model right now. Ask me career questions like: “Which skills for cloud engineer?”, “Short roadmap to data analyst?”, or “Improve my resume summary for QA role”.",
        in_scope: true,
        error: "llm_unavailable"
      }, 200);
    }

    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content ?? "…";
    return json({ reply, in_scope: true }, 200);
  } catch (e) {
    console.error("chat-career error:", e);
    return json({ error: "unexpected_error" }, 500);
  }
});

// ---------- helpers ----------
async function classify(text: string): Promise<{ in_scope: boolean; reason: string }> {
  const sys =
    "You are an intent classifier. Output JSON with keys {in_scope:boolean, reason:string}. "+
    "IN_SCOPE if the user asks about careers, jobs, roles, skills, courses, roadmaps, resumes/portfolios, interview prep, job search, compensation, workplace growth. "+
    "OUT_OF_SCOPE for unrelated topics (news, politics, entertainment, personal life, finance advice, medical, coding help not tied to careers, etc.).";
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      max_tokens: 120,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: text }
      ]
    })
  });
  if (!resp.ok) return { in_scope: true, reason: "fallback_on_error" }; // fail open to main guard in system prompt
  const json = await resp.json();
  try {
    const content = json?.choices?.[0]?.message?.content ?? "{}";
    const result = JSON.parse(content);
    return { in_scope: !!result.in_scope, reason: String(result.reason || "") };
  } catch {
    return { in_scope: true, reason: "parse_error" };
  }
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...cors() } });
}
