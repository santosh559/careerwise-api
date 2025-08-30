import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

const app = express();

// CORS: allow everything (demo)
app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type'] }));
// Extra headers for any proxy oddities + handle preflight fast
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());
app.use(morgan('dev'));

app.get('/', (req, res) => res.json({ ok: true, at: '/', ts: Date.now() }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, msg: 'Health endpoint working!' });
});

app.get('/api/psychometrics/questions', (req, res) => {
  res.json({
    questions: [
      { id: 'q1', text: 'I enjoy solving complex problems.', dimension: 'Analytical Thinking' },
      { id: 'q2', text: 'I communicate my ideas clearly.', dimension: 'Communication' }
    ]
  });
});

app.post('/api/psychometrics/analyze', (req, res) => {
  const { answers = [], skills = [], interests = [] } = req.body || {};
  const traits = [
    { name: 'Analytical Thinking', score: 72, rationale: 'Consistent problem-solving preference.' },
    { name: 'Communication',       score: 65, rationale: 'Clear expression in responses.' },
    { name: 'Creativity',          score: 63, rationale: 'Shows exploratory tendencies.' },
    { name: 'Persistence',         score: 70, rationale: 'Keeps going on harder items.' },
    { name: 'Collaboration',       score: 68, rationale: 'Comfortable in team settings.' },
  ];
  res.json({
    summary: 'Demo profile (mock).',
    traits,
    cautions: ['Demo-only'],
    tokens: { in: 0, out: 0 },
    echo: { answers, skills, interests }
  });
});

app.post('/api/matching/careers', (req, res) => {
  const { skills = [], interests = [], topK = 5 } = req.body || {};
  const has = (arr = [], kw) => arr.map(s=>String(s).toLowerCase()).some(s=>s.includes(kw));

  const base = [
    { careerId: 'c1', title: 'Data Analyst',    why: 'Strong analytical orientation; uses SQL/Excel.' },
    { careerId: 'c2', title: 'Software Dev',    why: 'Problem solving + building systems.' },
    { careerId: 'c3', title: 'UX Designer',     why: 'Creativity + collaboration.' },
    { careerId: 'c4', title: 'Product Manager', why: 'Communication + prioritization.' },
    { careerId: 'c5', title: 'Business Analyst',why: 'Bridges data and decisions.' },
  ];

  const results = base.map(c => {
    let score = 60;
    if (c.title.includes('Data') && (has(skills,'sql')||has(skills,'excel')||has(interests,'data'))) score += 20;
    if (c.title.includes('Software') && (has(skills,'js')||has(skills,'python')||has(interests,'code'))) score += 18;
    if (c.title.includes('Designer') && has(interests,'design')) score += 15;
    if (c.title.includes('Product') && has(interests,'product')) score += 12;
    if (c.title.includes('Analyst') && has(interests,'analytics')) score += 10;
    return { ...c, score: Math.min(100, score), nextSteps: ['Explore a day-in-the-life', 'Draft a 30–60–90 plan'] };
  }).sort((a,b)=>b.score-a.score);

  res.json({ results: results.slice(0, topK) });
});

// Fallback 404
app.use((_req, res) => res.status(404).send('Not Found'));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
