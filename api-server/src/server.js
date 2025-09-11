import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Supabase + OpenAI clients
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Health check
app.get("/", (req, res) => {
  res.send({ status: "CareerWise API running ✅" });
});

// Career match endpoint
// --- replaced match route below ---
// --- Match (Hybrid: DB first, then AI to fill to 7–10) ---
app.post("/match", async (req, res) => {
  try {
    const { skills = "", interests = "", traits = {}, sections = {} } = req.body;

    // 1) Compute a simple user vector from traits (already 0..1 on your client)
    const userVec = traits;

    // 2) Try DB careers first
    const { data: careersDB, error } = await supabase
      .from("careers")
      .select("title, traits, description")
      .limit(50);

    if (error) console.warn("Supabase careers read error:", error?.message);
    const careers = Array.isArray(careersDB) ? careersDB : [];

    // 3) Score DB careers
    const cosine = (a, b) => {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      let dot = 0, na = 0, nb = 0;
      for (const k of keys) {
        const x = Number(a[k] || 0);
        const y = Number(b[k] || 0);
        dot += x * y; na += x * x; nb += y * y;
      }
      const denom = Math.sqrt(na) * Math.sqrt(nb) || 1;
      return dot / denom;
    };

    const skillWords = (skills || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
    const interestWords = (interests || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);

    const scoredFromDB = careers.map(c => {
      const cVec = Object.fromEntries(Object.entries(c.traits || {}).map(([k, v]) => [k, Number(v) || 0]));
      let base = Math.max(0, cosine(userVec, cVec));
      const corpus = `${c.title ?? ""} ${c.description ?? ""}`.toLowerCase();
      let boost = 0;
      for (const w of skillWords) if (corpus.includes(w)) boost += 0.03;
      for (const w of interestWords) if (corpus.includes(w)) boost += 0.03;
      return {
        title: c.title,
        description: c.description || "",
        why: "",
        score: Math.round(Math.min(1, base + boost) * 100)
      };
    });

    let ranked = scoredFromDB.sort((a, b) => b.score - a.score);

    // 4) If fewer than 7, ask AI to propose more that match the userVec + inputs
    if (ranked.length < 7) {
      const need = Math.max(7 - ranked.length, 5);
      const system = `You produce career suggestions for students.
Return STRICT JSON array of objects: 
[{"title":"...", "score": 0-100, "why":"one crisp line", "description":"one-line role summary"}]
- 7 to 10 items max.
- tailor to supplied skills, interests, and traits (0..1 floats).
- "score" must reflect fit; do not inflate numbers.`;

      const user = { skills, interests, traits: userVec, sections, request_count: need };

      const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const resp = await ai.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(user) }
        ],
        response_format: { type: "json_object" }
      });

      let aiList = []; 
      try {
        const raw = resp.choices?.[0]?.message?.content || "{}";
        const parsed = JSON.parse(raw);
        aiList = Array.isArray(parsed) ? parsed : (parsed.items || []);
      } catch (e) { console.warn("AI parse error:", e.message); }

      const haveTitle = new Set(ranked.map(r => (r.title || "").toLowerCase()));
      const aiClean = (aiList || []).filter(x => x && x.title && !haveTitle.has(String(x.title).toLowerCase())).map(x => ({
        title: String(x.title).trim(),
        description: String(x.description || "").trim(),
        why: String(x.why || "").trim(),
        score: Math.max(0, Math.min(100, Math.round(Number(x.score) || 0)))
      }));

      ranked = [...ranked, ...aiClean].sort((a, b) => b.score - a.score);
    }

    const maxOut = ranked.slice(0, Math.min(10, Math.max(7, ranked.length)));
    res.json({ matches: maxOut });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "match_failed" });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`✅ API running on http://localhost:${PORT}`));

/* --- Health check --- */
app.get('/health', (req, res) => {
  res.type('text/plain').send('ok');
});
