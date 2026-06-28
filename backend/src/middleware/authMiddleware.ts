import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjarviskey123_stark_industries_99';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  email?: string;
}

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  let token = req.headers.authorization?.split(' ')[1];

  // Also check cookies
  if (!token && req.headers.cookie) {
    const cookies = req.headers.cookie.split(';').reduce((acc: any, c: string) => {
      const parts = c.split('=');
      acc[parts[0].trim()] = (parts[1] || '').trim();
      return acc;
    }, {});
    token = cookies.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized. No authorization token found.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string };
    req.userId = decoded.userId;
    req.email = decoded.email;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized. Invalid or expired token.' });
  }
}
