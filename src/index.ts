import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import claudeRouter from './routes/claude';
import sessionsRouter from './routes/sessions';

const app = express();
// Allow configured origin, localhost variants, and null (file:// local HTML)
const ALLOWED = new Set([
  process.env.FRONTEND_URL,
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:3000',
].filter(Boolean));
app.use(cors({
  origin: (origin, cb) => {
    // null = file:// or same-origin; always allow in addition to configured origins
    if (!origin || ALLOWED.has(origin) || process.env.FRONTEND_URL === '*') {
      cb(null, true);
    } else {
      cb(null, true); // permissive — frontend is a local file; tighten on production deploy
    }
  },
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/v1/claude', claudeRouter);
app.use('/api/v1/sessions', sessionsRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Career OS API on port ${PORT}`));
