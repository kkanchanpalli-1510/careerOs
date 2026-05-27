import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import claudeRouter from './routes/claude';

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/v1/claude', claudeRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Career OS API on port ${PORT}`));
