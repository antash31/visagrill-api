'use strict';

const supabase = require('../config/supabase.config');
const logger = require('../utils/logger.util');

function extractBearer(header) {
  if (!header || typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token.trim();
}

async function verifyToken(token) {
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data || !data.user) {
    throw new Error(error ? error.message : 'Invalid token');
  }
  return data.user;
}

async function authMiddleware(req, res, next) {
  try {
    const token = extractBearer(req.headers.authorization);
    if (!token) return res.status(401).json({ error: 'Missing or malformed Authorization header' });

    const user = await verifyToken(token);
    req.user = user;
    req.accessToken = token;
    return next();
  } catch (err) {
    logger.warn('Auth failed:', err.message);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = { authMiddleware, verifyToken, extractBearer };
