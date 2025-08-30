import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(morgan('dev'));

app.get('/', (req, res) => res.json({ ok: true, at: '/', ts: Date.now() }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, msg: 'Health endpoint working!' });
});

app.get('/api/psychometrics/questions', (req, res) => {
  res.json({
    questions: [
      { id: 'q1', text: 'I enjoy solving complex problems.' },
      { id: 'q2', text: 'I communicate my ideas clearly.' }
    ]
  });
});

app.post('/api/matching/careers', (req, res) => {
  res.json({
    results: [
      { careerId: 'c1', title: 'Data Analyst', score: 85 },
      { careerId: 'c2', title: 'Software Dev', score: 78 }
    ]
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
