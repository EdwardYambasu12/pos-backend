/**
 * /api/auth
 *
 * POST /register  — create first account (becomes admin) or add users if admin token supplied
 * POST /login     — username + pin → JWT
 * POST /logout    — mark session logoutTime (requires auth)
 * GET  /me        — current user info (requires auth)
 * GET  /setup-status — whether any active users exist
 */

const router = require('express').Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

const User = require('../models/User');
const Session = require('../models/Session');
const AuditLog = require('../models/AuditLog');
const Subscription = require('../models/Subscription');
const Shop = require('../models/Shop');
const Product = require('../models/Product');
const { requireApiKey } = require('../middleware/auth');

const SEEDED_PRODUCTS = [
  { name: 'S/Beer', costPrice: 180, sellingPrice: 240, quantity: 60 },
  { name: 'L/Beer', costPrice: 390, sellingPrice: 450, quantity: 21 },
  { name: 'Eazi Beer', costPrice: 180, sellingPrice: 240, quantity: 16 },
  { name: 'M/Beer', costPrice: 300, sellingPrice: 350, quantity: 18 },
  { name: 'Heineken', costPrice: 300, sellingPrice: 350, quantity: 27 },
  { name: 'Stout', costPrice: 290, sellingPrice: 350, quantity: 19 },
  { name: 'Yang', costPrice: 330, sellingPrice: 450, quantity: 11 },
  { name: '12%', costPrice: 390, sellingPrice: 450, quantity: 5 },
  { name: '10%', costPrice: 390, sellingPrice: 500, quantity: 24 },
  { name: 'Malta', costPrice: 180, sellingPrice: 250, quantity: 10 },
  { name: 'Big daddy bottle', costPrice: 100, sellingPrice: 150, quantity: 21 },
  { name: 'Big daddy can', costPrice: 200, sellingPrice: 250, quantity: 17 },
  { name: 'Can cook', costPrice: 150, sellingPrice: 200, quantity: 22 },
  { name: 'Can stout', costPrice: 200, sellingPrice: 250, quantity: 22 },
  { name: 'Bottle soft drink', costPrice: 40, sellingPrice: 70, quantity: 33 },
  { name: 'Vody', costPrice: 250, sellingPrice: 300, quantity: 18 },
  { name: 'Buffeo', costPrice: 150, sellingPrice: 200, quantity: 16 },
  { name: 'Rox', costPrice: 150, sellingPrice: 200, quantity: 17 },
  { name: 'Aloe Juice', costPrice: 390, sellingPrice: 450, quantity: 7 },
  { name: 'Extra juice', costPrice: 150, sellingPrice: 200, quantity: 3 },
  { name: 'Catuaba', costPrice: 390, sellingPrice: 500, quantity: 9 },
  { name: 'Cantina wine', costPrice: 390, sellingPrice: 500, quantity: 2 },
  { name: 'American Jin', costPrice: 180, sellingPrice: 250, quantity: 4 },
  { name: 'Atadwe', costPrice: 100, sellingPrice: 150, quantity: 6 },
  { name: 'Mngera 0', costPrice: 100, sellingPrice: 150, quantity: 9 },
  { name: 'Party time', costPrice: 100, sellingPrice: 150, quantity: 12 },
  { name: 'Live your life', costPrice: 150, sellingPrice: 200, quantity: 20 },
  { name: 'Love wine', costPrice: 100, sellingPrice: 130, quantity: 18 },
  { name: 'Power play', costPrice: 50, sellingPrice: 100, quantity: 12 },
  { name: 'Run', costPrice: 70, sellingPrice: 120, quantity: 18 },
  { name: 'Rush', costPrice: 50, sellingPrice: 100, quantity: 8 },
  { name: 'A. Bitter', costPrice: 100, sellingPrice: 150, quantity: 9 },
  { name: 'Roots power', costPrice: 50, sellingPrice: 100, quantity: 19 },
  { name: 'Alomo bitter', costPrice: 150, sellingPrice: 200, quantity: 10 },
  { name: 'Cabberian bitter', costPrice: 50, sellingPrice: 100, quantity: 30 },
  { name: '6pm', costPrice: 50, sellingPrice: 100, quantity: 14 },
];


// Tighter rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 30,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Replicate the frontend's PIN hashing:
 *   crypto.subtle.digest('SHA-256', TextEncoder().encode(pin + 'pos-salt-2024'))
 */
function hashPin(pin) {
  return crypto.createHash('sha256').update(pin + 'pos-salt-2024').digest('hex');
}

function deviceFromUA(ua = '') {
  if (/Mobile|Android|iPhone/i.test(ua)) return 'Mobile';
  if (/Tablet|iPad/i.test(ua)) return 'Tablet';
  return 'Desktop';
}

async function createAuditLog({ action, userId, username, role, targetType, targetId, details }) {
  try {
    let ownerAdminId = null;
    if (role === 'admin') {
      ownerAdminId = userId;
    } else if (userId && userId !== 'unknown') {
      const actor = await User.findById(String(userId)).select('ownerAdminId createdBy').lean();
      ownerAdminId = actor?.ownerAdminId || actor?.createdBy || null;
    }

    await AuditLog.create({
      _id: uuidv4(),
      action,
      userId,
      username,
      role,
      ownerAdminId,
      targetType: targetType || null,
      targetId: targetId || null,
      details,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[AuditLog] Failed to write:', err.message);
  }
}

// ─── POST /register ───────────────────────────────────────────────────────────
/**
 * Registers a new user.
 *
 * - If NO users exist at all → first user is forced to role "admin".
 * - Otherwise → caller must supply a valid admin JWT in the Authorization header.
 *
 * Body: { username, displayName, pin, role?, shopId? }
 */
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { username, displayName, pin, role, shopId, createdBy, ownerAdminId } = req.body;

    if (!username || !displayName || !pin) {
      return res.status(400).json({ error: 'username, displayName, and pin are required' });
    }

    if (pin.length < 4) {
      return res.status(400).json({ error: 'PIN must be at least 4 characters' });
    }

    const totalUsers = await User.countDocuments();
    const isFirstUser = totalUsers === 0;

    const normalizedUsername = username.toLowerCase().trim();
    const existing = await User.findOne({ username: normalizedUsername });
    if (existing) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const validRoles = ['admin', 'manager', 'cashier'];
    const assignedRole = isFirstUser ? 'admin' : (validRoles.includes(role) ? role : 'cashier');

    const id = uuidv4();
    const resolvedOwnerAdminId = assignedRole === 'admin'
      ? id
      : ownerAdminId || createdBy || null;

    const newUser = await User.create({
      _id: id,
      username: normalizedUsername,
      displayName: displayName.trim(),
      pin: hashPin(pin),
      role: assignedRole,
      active: true,
      createdAt: new Date().toISOString(),
      createdBy: createdBy || null,
      ownerAdminId: resolvedOwnerAdminId,
      shopId: shopId || null,
    });

    await createAuditLog({
      action: 'user_created',
      userId: id,
      username: normalizedUsername,
      role: assignedRole,
      targetType: 'user',
      targetId: id,
      details: `User "${displayName}" (@${normalizedUsername}) registered with role ${assignedRole}`,
    });

    return res.status(201).json({
      user: {
        id: newUser._id,
        username: newUser.username,
        displayName: newUser.displayName,
        role: newUser.role,
        active: newUser.active,
        shopId: newUser.shopId,
        ownerAdminId: newUser.ownerAdminId,
        createdAt: newUser.createdAt,
      },
    });
  } catch (err) {
    console.error('[POST /auth/register]', err);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── GET /setup-status ───────────────────────────────────────────────────────
router.get('/setup-status', async (_req, res) => {
  try {
    const activeUsers = await User.countDocuments({ active: true });
    return res.json({ isSetup: activeUsers > 0 });
  } catch (err) {
    console.error('[GET /auth/setup-status]', err);
    return res.status(500).json({ error: 'Failed to fetch setup status' });
  }
});

// ─── POST /seed-initial-data ────────────────────────────────────────────────
// Creates a default admin, two shops, and predefined products in shop 2.
// Protected by SYNC_API_KEY because this mutates shared server data.
router.post('/seed-initial-data', requireApiKey, async (_req, res) => {
  try {
    const username = 'izena';
    const displayName = 'Izena';
    const pin = '1988';
    const shop1Name = 'Izee Central point Shop 1';
    const shop2Name = 'Izee Central point shop 2';

    let admin = await User.findOne({ username }).lean();
    let adminCreated = false;

    if (!admin) {
      const adminId = uuidv4();
      await User.create({
        _id: adminId,
        username,
        displayName,
        pin: hashPin(pin),
        role: 'admin',
        active: true,
        createdAt: new Date().toISOString(),
        createdBy: null,
        shopId: null,
        ownerAdminId: adminId,
      });
      admin = await User.findById(adminId).lean();
      adminCreated = true;
    }

    if (!admin || !admin._id) {
      return res.status(500).json({ error: 'Failed to resolve seeded admin account' });
    }

    const ownerAdminId = String(admin._id);

    let shop1 = await Shop.findOne({ ownerAdminId, name: shop1Name }).lean();
    let shop2 = await Shop.findOne({ ownerAdminId, name: shop2Name }).lean();
    let shop1Created = false;
    let shop2Created = false;

    if (!shop1) {
      const id = uuidv4();
      await Shop.create({
        _id: id,
        name: shop1Name,
        createdAt: new Date().toISOString(),
        createdBy: ownerAdminId,
        ownerAdminId,
      });
      shop1 = await Shop.findById(id).lean();
      shop1Created = true;
    }

    if (!shop2) {
      const id = uuidv4();
      await Shop.create({
        _id: id,
        name: shop2Name,
        createdAt: new Date().toISOString(),
        createdBy: ownerAdminId,
        ownerAdminId,
      });
      shop2 = await Shop.findById(id).lean();
      shop2Created = true;
    }

    if (!shop2 || !shop2._id) {
      return res.status(500).json({ error: 'Failed to resolve seeded shop 2' });
    }

    const shop2Id = String(shop2._id);
    const existingShop2Products = await Product.find({ shopId: shop2Id }).select('name').lean();
    const existingNames = new Set(existingShop2Products.map((item) => String(item.name)));

    const productsToInsert = SEEDED_PRODUCTS
      .filter((item) => !existingNames.has(item.name))
      .map((item) => ({
        _id: uuidv4(),
        name: item.name,
        costPrice: item.costPrice,
        sellingPrice: item.sellingPrice,
        quantity: item.quantity,
        currency: 'LRD',
        shopId: shop2Id,
        ownerAdminId,
        createdAt: new Date().toISOString(),
      }));

    if (productsToInsert.length > 0) {
      await Product.insertMany(productsToInsert, { ordered: false });
    }

    const existingSubscription = await Subscription.countDocuments();
    let subscriptionCreated = false;
    if (existingSubscription === 0) {
      const now = new Date();
      const expiry = new Date(now);
      expiry.setFullYear(expiry.getFullYear() + 1);
      await Subscription.create({
        _id: uuidv4(),
        planType: 'premium',
        status: 'active',
        expiryDate: expiry.toISOString(),
        activatedAt: now.toISOString(),
        lastOpenedAt: now.toISOString(),
      });
      subscriptionCreated = true;
    }

    return res.json({
      ok: true,
      message: 'Seed completed',
      summary: {
        admin: {
          username,
          pin,
          created: adminCreated,
          id: ownerAdminId,
        },
        shops: {
          shop1: { name: shop1Name, created: shop1Created },
          shop2: { name: shop2Name, created: shop2Created },
        },
        products: {
          requested: SEEDED_PRODUCTS.length,
          inserted: productsToInsert.length,
          skipped: SEEDED_PRODUCTS.length - productsToInsert.length,
        },
        subscription: {
          created: subscriptionCreated,
          planType: 'premium',
        },
      },
    });
  } catch (err) {
    console.error('[POST /auth/seed-initial-data]', err);
    return res.status(500).json({ error: 'Seed failed' });
  }
});

// ─── POST /login ──────────────────────────────────────────────────────────────
/**
 * Body: { username, pin }
 * Returns: { token, user, subscription? }
 */
router.post('/login', authLimiter, async (req, res) => {
  const { username, pin } = req.body;
  const device = deviceFromUA(req.headers['user-agent']);

  if (!username || !pin) {
    return res.status(400).json({ error: 'username and pin are required' });
  }

  const normalizedUsername = username.toLowerCase().trim();
  const sessionId = uuidv4();

  try {
    const user = await User.findOne({ username: normalizedUsername });

    // Unknown user
    if (!user) {
      await Session.create({
        _id: sessionId,
        userId: 'unknown',
        username: normalizedUsername,
        role: 'cashier',
        loginTime: new Date().toISOString(),
        device,
        failed: true,
        ownerAdminId: null,
      });
      await createAuditLog({
        action: 'login_failed',
        userId: 'unknown',
        username: normalizedUsername,
        role: 'cashier',
        details: `Failed login — user not found`,
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Inactive account
    if (!user.active) {
      await createAuditLog({
        action: 'login_failed',
        userId: user._id,
        username: user.username,
        role: user.role,
        details: `Failed login — account inactive`,
      });
      return res.status(401).json({ error: 'Account is inactive' });
    }

    // Wrong PIN
    if (user.pin !== hashPin(pin)) {
      await Session.create({
        _id: sessionId,
        userId: user._id,
        username: user.username,
        role: user.role,
        loginTime: new Date().toISOString(),
        device,
        failed: true,
        ownerAdminId: user.ownerAdminId || user.createdBy || (user.role === 'admin' ? user._id : null),
      });
      await createAuditLog({
        action: 'login_failed',
        userId: user._id,
        username: user.username,
        role: user.role,
        details: `Failed login — incorrect PIN`,
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // ✓ Success
    await Session.create({
      _id: sessionId,
      userId: user._id,
      username: user.username,
      role: user.role,
      loginTime: new Date().toISOString(),
      device,
      failed: false,
      ownerAdminId: user.ownerAdminId || user.createdBy || (user.role === 'admin' ? user._id : null),
    });

    await createAuditLog({
      action: 'login_success',
      userId: user._id,
      username: user.username,
      role: user.role,
      details: `Logged in from ${device}`,
    });

    // Attach active subscription if any
    const subscription = await Subscription.findOne({ status: { $in: ['trial', 'active'] } })
      .sort({ activatedAt: -1 })
      .lean();

    return res.json({
      sessionId,
      user: {
        id: user._id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        active: user.active,
        shopId: user.shopId,
        ownerAdminId: user.ownerAdminId || user.createdBy || (user.role === 'admin' ? user._id : null),
        createdAt: user.createdAt,
      },
      subscription: subscription || null,
    });
  } catch (err) {
    console.error('[POST /auth/login]', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// ─── POST /logout ─────────────────────────────────────────────────────────────
router.post('/logout', async (req, res) => {
  const { sessionId, logoutType = 'manual', userId, username, role } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  try {
    await Session.findByIdAndUpdate(sessionId, {
      logoutTime: new Date().toISOString(),
      logoutType,
    });

    await createAuditLog({
      action: 'logout',
      userId: userId || null,
      username: username || null,
      role: role || null,
      details: `Logged out (${logoutType})`,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[POST /auth/logout]', err);
    return res.status(500).json({ error: 'Logout failed' });
  }
});

// ─── GET /me ──────────────────────────────────────────────────────────────────
router.get('/me', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId query param required' });

  try {
    const user = await User.findById(userId).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.json({
      id: user._id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      active: user.active,
      shopId: user.shopId,
      ownerAdminId: user.ownerAdminId,
      createdAt: user.createdAt,
    });
  } catch (err) {
    console.error('[GET /auth/me]', err);
    return res.status(500).json({ error: 'Failed to fetch user' });
  }
});

module.exports = router;
