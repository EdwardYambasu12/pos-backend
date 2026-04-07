/**
 * /api/users  — user management (admin only for most operations)
 *
 * GET    /            — list all users          [admin]
 * GET    /:id         — get single user         [admin, manager]
 * POST   /            — create user             [admin]
 * PUT    /:id         — update user             [admin]
 * POST   /:id/reset-pin — reset user PIN        [admin]
 * DELETE /:id         — deactivate user         [admin]
 */

const router = require('express').Router();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const User = require('../models/User');
const AuditLog = require('../models/AuditLog');


function hashPin(pin) {
  return crypto.createHash('sha256').update(pin + 'pos-salt-2024').digest('hex');
}

async function audit({ action, userId, username, role, targetType, targetId, details }) {
  try {
    await AuditLog.create({
      _id: uuidv4(),
      action, userId, username, role,
      targetType: targetType || null,
      targetId: targetId || null,
      details,
      timestamp: new Date().toISOString(),
    });
  } catch (e) { console.error('[audit]', e.message); }
}

// GET / — list all users
router.get('/', async (req, res) => {
  try {
    const users = await User.find().select('-pin').lean();
    return res.json(users.map(({ _id, ...u }) => ({ id: String(_id), ...u })));
  } catch (err) {
    return res.status(500).json({ error: 'Failed to list users' });
  }
});

// GET /:id
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-pin').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { _id, ...rest } = user;
    return res.json({ id: String(_id), ...rest });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// POST / — create user
router.post('/', async (req, res) => {
  const { username, displayName, pin, role, shopId, createdBy, ownerAdminId } = req.body;
  if (!username || !displayName || !pin) {
    return res.status(400).json({ error: 'username, displayName, and pin are required' });
  }
  if (pin.length < 4) return res.status(400).json({ error: 'PIN must be at least 4 characters' });

  const validRoles = ['admin', 'manager', 'cashier'];
  if (role && !validRoles.includes(role)) {
    return res.status(400).json({ error: `Invalid role: ${role}` });
  }

  try {
    const existing = await User.findOne({ username: username.toLowerCase().trim() });
    if (existing) return res.status(409).json({ error: 'Username already taken' });

    const id = uuidv4();
    const resolvedOwnerAdminId = (role || 'cashier') === 'admin'
      ? id
      : ownerAdminId || createdBy || null;
    const newUser = await User.create({
      _id: id,
      username: username.toLowerCase().trim(),
      displayName: displayName.trim(),
      pin: hashPin(pin),
      role: role || 'cashier',
      active: true,
      createdAt: new Date().toISOString(),
      createdBy: createdBy || null,
      ownerAdminId: resolvedOwnerAdminId,
      shopId: shopId || null,
    });

    await audit({
      action: 'user_created',
      userId: null,
      username: null,
      role: null,
      targetType: 'user',
      targetId: id,
      details: `Created user "${displayName}" (@${username}) with role ${role || 'cashier'}`,
    });

    return res.status(201).json({ id: newUser._id, username: newUser.username, role: newUser.role });
  } catch (err) {
    console.error('[POST /users]', err);
    return res.status(500).json({ error: 'Failed to create user' });
  }
});

// PUT /:id — update user
router.put('/:id', async (req, res) => {
  const allowed = ['displayName', 'role', 'active', 'shopId'];
  const updates = {};
  allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  try {
    const user = await User.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true }).select('-pin');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const changes = Object.entries(updates).map(([k, v]) => `${k}=${v}`).join(', ');
    await audit({
      action: updates.active === false ? 'user_deactivated' : 'user_updated',
      userId: null,
      username: null,
      role: null,
      targetType: 'user',
      targetId: req.params.id,
      details: `Updated user "${user.displayName}": ${changes}`,
    });

    const { _id, ...rest } = user.toObject();
    return res.json({ id: String(_id), ...rest });
  } catch (err) {
    console.error('[PUT /users/:id]', err);
    return res.status(500).json({ error: 'Failed to update user' });
  }
});

// POST /:id/reset-pin
router.post('/:id/reset-pin', async (req, res) => {
  const { newPin } = req.body;
  if (!newPin || newPin.length < 4) {
    return res.status(400).json({ error: 'newPin must be at least 4 characters' });
  }

  try {
    const user = await User.findByIdAndUpdate(req.params.id, { $set: { pin: hashPin(newPin) } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    await audit({
      action: 'pin_reset',
      userId: null,
      username: null,
      role: null,
      targetType: 'user',
      targetId: req.params.id,
      details: `PIN reset for user "${user.displayName}"`,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[POST /users/:id/reset-pin]', err);
    return res.status(500).json({ error: 'Failed to reset PIN' });
  }
});

// DELETE /:id — soft deactivate
router.delete('/:id', async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await audit({
      action: 'user_deleted',
      userId: null,
      username: null,
      role: null,
      targetType: 'user',
      targetId: req.params.id,
      details: `Deleted user "${user.displayName}"`,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /users/:id]', err);
    return res.status(500).json({ error: 'Failed to delete user' });
  }
});

module.exports = router;
