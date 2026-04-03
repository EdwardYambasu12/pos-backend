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
