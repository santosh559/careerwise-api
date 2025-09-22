// Supabase Edge Function (Deno) — Free-text role -> JSON roadmap
// POST { "query": "data scientist" }  (also accepts { "role": "..." } for backward compat)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;
if (!OPENAI_KEY) console.error("Missing OPENAI_API_KEY");

type Req = { query?: string; role?: string };

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });

  try {
    const body = (await req.json().catch(() => ({}))) as Req;
    const roleText = (body.query || body.role || "").toString().trim();
    if (!roleText) {
      return json({ error: "Please provide a role, e.g., { \"query\": \"Data Scientist\" }" }, 400);
    }

    // Ask OpenAI to produce a structured learning path
    const plan = await generateRoadmapWithLLM(roleText);

    return json({
      role: roleText,
      generated_at: new Date().toISOString(),
      ...plan
    }, 200);
  } catch (e) {
    console.error("paths-generate error:", e);
    return json({ error: "Unexpected error" }, 500);
  }
});

async function generateRoadmapWithLLM(role: string) {
  const messages = [
    {
      role: "system",
      content:
        "You are a concise career path planner. Return a practical learning roadmap with 2–4 stages, outcomes, 3–6 core resources per stage (reputable links), and 1–2 small projects per stage. Keep it role-specific. Return VALID JSON only. Keys: timeline {fastTrackMonths, standardMonths}, stages[].name, stages[].outcomes[], stages[].core[{type,title,provider,url}], stages[].projects[{title,deliverable}]. Include stages[].recommended_now as an empty array for now."
    },
    {
      role: "user",
      content:
        `Create a learning path for the role: "${role}". Keep it focused. No fluff.`
    }
  ];

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      max_tokens: 1200,
      messages
    })
  });

  if (!res.ok) {
    const t = await res.text().catch(()=> "");
    console.error("OpenAI error:", res.status, t);
    // fallback minimal skeleton
    return {
      timeline: { fastTrackMonths: 6, standardMonths: 12 },
      stages: [
        {
          name: "Foundations",
          outcomes: ["Core concepts", "Key tools"],
          core: [],
          projects: [{ title: "Mini project", deliverable: "Notebook + README" }],
          recommended_now: []
        }
      ]
    };
  }

  const json = await res.json();
  try {
    const content = json.choices?.[0]?.message?.content ?? "{}";
    return JSON.parse(content);
  } catch {
    return {
      timeline: { fastTrackMonths: 6, standardMonths: 12 },
      stages: [
        { name: "Foundations", outcomes: [], core: [], projects: [], recommended_now: [] }
      ]
    };
  }
}

// helpers
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
  };
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors() }
  });
}
// redeploy Sun Sep 21 14:40:17 IST 2025
