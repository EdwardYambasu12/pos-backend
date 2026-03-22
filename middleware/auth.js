const crypto = require('crypto');

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * Strict API-key guard for sync endpoints.
 * SYNC_API_KEY must be configured and every request must provide x-sync-api-key.
 */
function requireApiKey(req, res, next) {
  const configuredKey = (process.env.SYNC_API_KEY || '').trim();
  if (!configuredKey) {
    return res.status(503).json({ error: 'SYNC_API_KEY is not configured on server' });
  }

  const provided = req.headers['x-sync-api-key'];
  if (!provided || !constantTimeEqual(provided, configuredKey)) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  next();
}

module.exports = { requireApiKey };
