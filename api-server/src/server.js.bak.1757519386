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
app.post("/match", async (req, res) => {
  try {
    const { traits, skills, interests } = req.body;

    // Fetch career data from Supabase
    const { data: careers, error } = await supabase.from("careers").select("title, description, traits");
    if (error) throw error;

    // AI explanation for each match
    const results = await Promise.all(
      careers.map(async (c) => {
        const prompt = `
User traits: ${JSON.stringify(traits)}
User skills: ${skills}
User interests: ${interests}
Career: ${c.title}
Career traits: ${JSON.stringify(c.traits)}
Career description: ${c.description}

Q: Why is this career a good fit for the user? Give a 2-3 sentence explanation.
`;
        const aiResp = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 120,
        });

        return {
          title: c.title,
          description: c.description,
          score: Math.round(Math.random() * 30 + 70), // temp % fit until we wire scoring
          why: aiResp.choices[0].message.content.trim(),
        };
      })
    );

    res.json({ matches: results.slice(0, 10) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`✅ API running on http://localhost:${PORT}`));

/* --- Health check --- */
app.get('/health', (req, res) => {
  res.type('text/plain').send('ok');
});
