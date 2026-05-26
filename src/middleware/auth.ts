import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../db/client';

export interface AuthedRequest extends Request {
  user: { id: string; email: string };
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization header' }); return;
  }
  const { data, error } = await supabaseAdmin.auth.getUser(header.slice(7));
  if (error || !data.user) {
    res.status(401).json({ error: 'Invalid or expired token' }); return;
  }
  (req as AuthedRequest).user = { id: data.user.id, email: data.user.email ?? '' };
  next();
}
