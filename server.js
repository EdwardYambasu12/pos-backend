require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const https = require('https');
const authRoutes = require('./routes/auth');
const syncRoutes = require('./routes/sync');
const userRoutes = require('./routes/users');
const productRoutes = require('./routes/products');
const salesRoutes = require('./routes/sales');
const expenseRoutes = require('./routes/expenses');
const shopRoutes = require('./routes/shops');
const categoryRoutes = require('./routes/categories');
const auditRoutes = require('./routes/audit');

const app = express();

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet());

const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'https://swiftpos-iota.vercel.app')
  .split(',')
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow requests with no origin (e.g. mobile apps, curl) or whitelisted origins
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  }),
);

app.get('/ping', (req, res) => {
  res.json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    message: 'Server is awake'
  });
});

const KEEP_ALIVE_URL = 'https://pos-backend-1-fa4t.onrender.com/ping';
const KEEP_ALIVE_INTERVAL = 60 * 1000; // 1 minute

let keepAliveCount = 0;
let lastKeepAliveSuccess = null;

const keepAlive = () => {
  const startTime = Date.now();
  
  https.get(KEEP_ALIVE_URL, (res) => {
    const responseTime = Date.now() - startTime;
    keepAliveCount++;
    lastKeepAliveSuccess = new Date();
    
    if (res.statusCode === 200) {
      console.log(`Keep-alive #${keepAliveCount} | Status: ${res.statusCode} | Response: ${responseTime}ms`);
    } else {
      console.log(`Keep-alive #${keepAliveCount} | Status: ${res.statusCode}`);
    }
  }).on('error', (err) => {
    console.error(`Keep-alive #${keepAliveCount} failed:`, err.message);
  });
};

setTimeout(() => {
  console.log('Starting keep-alive system...');
  keepAlive();
  setInterval(keepAlive, KEEP_ALIVE_INTERVAL);
}, 30000);


// General rate limit – tighten for auth routes specifically (see auth.js)
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

app.use(express.json({ limit: '2mb' }));

if (!(process.env.SYNC_API_KEY || '').trim()) {
  console.warn('[Security] SYNC_API_KEY is empty; /api/sync endpoints will reject requests until configured.');
}

if (process.env.ENABLE_REMOTE_SYNC_DELETE === 'false') {
  console.warn('[Security] ENABLE_REMOTE_SYNC_DELETE=false; remote sync deletes are disabled.');
}

// ── MongoDB ───────────────────────────────────────────────────────────────────
const MONGODB_URI = (process.env.MONGODB_URI || 'mongodb://localhost:27017').trim();
const MONGODB_DB = (process.env.MONGODB_DB_NAME || 'shop_keeper').trim();

function buildMongoConnectionUri(baseUri, dbName) {
  const uri = (baseUri || '').trim();
  const db = (dbName || '').trim();

  if (!uri) {
    return `mongodb://localhost:27017/${db || 'shop_keeper'}`;
  }

  const hasQuery = uri.includes('?');
  const [withoutQuery, queryPart = ''] = uri.split('?');
  const normalizedBase = withoutQuery.replace(/\/$/, '');

  const pathParts = normalizedBase.split('/').filter(Boolean);
  const scheme = normalizedBase.startsWith('mongodb+srv://')
    ? 'mongodb+srv://'
    : normalizedBase.startsWith('mongodb://')
      ? 'mongodb://'
      : '';

  const hostAndMaybePath = scheme ? normalizedBase.slice(scheme.length) : normalizedBase;
  const firstSlashIndex = hostAndMaybePath.indexOf('/');

  let hostPart = hostAndMaybePath;
  let pathPart = '';
  if (firstSlashIndex >= 0) {
    hostPart = hostAndMaybePath.slice(0, firstSlashIndex);
    pathPart = hostAndMaybePath.slice(firstSlashIndex + 1);
  }

  const hasDbInPath = Boolean(pathPart && pathPart !== '');
  if (hasDbInPath || !db) {
    return hasQuery ? `${normalizedBase}?${queryPart}` : normalizedBase;
  }

  const withDb = `${scheme}${hostPart}/${db}`;
  return hasQuery ? `${withDb}?${queryPart}` : withDb;
}

const MONGODB_CONNECTION_URI = buildMongoConnectionUri(MONGODB_URI, MONGODB_DB);

mongoose
  .connect(MONGODB_CONNECTION_URI)
  .then(() => console.log(`[DB] Connected to MongoDB — ${MONGODB_DB}`))
  .catch((err) => {
    console.error('[DB] Connection failed:', err.message);
    process.exit(1);
  });

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/shops', shopRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/audit', auditRoutes);

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Error handler ─────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.BACKEND_PORT || '4000', 10);
app.listen(PORT, () => console.log(`[Server] Listening on port ${PORT}`));
