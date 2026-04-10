/**
 * /api/audit
 *
 * GET /        — paginated audit log          [admin]
 * GET /user/:userId — logs for a specific user [admin]
 */

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const AuditLog = require('../models/AuditLog');


function normalize({ _id, ...rest }) { return { id: String(_id), ...rest }; }

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const skip = parseInt(req.query.skip) || 0;
    const filter = {};
    if (req.query.action) filter.action = req.query.action;
    if (req.query.userId) filter.userId = req.query.userId;
    if (req.query.ownerAdminId) filter.ownerAdminId = req.query.ownerAdminId;
    if (req.query.targetType) filter.targetType = req.query.targetType;
    if (req.query.targetId) filter.targetId = req.query.targetId;

    if (req.query.from || req.query.to) {
      filter.timestamp = {};
      if (req.query.from) filter.timestamp.$gte = req.query.from;
      if (req.query.to) filter.timestamp.$lte = req.query.to;
    }

    const logs = await AuditLog.find(filter)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await AuditLog.countDocuments(filter);
    return res.json({ total, logs: logs.map(normalize) });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

router.post('/', async (req, res) => {
  const {
    action,
    userId,
    username,
    role,
    ownerAdminId,
    targetType,
    targetId,
    details,
    metadata,
  } = req.body;

  if (!action || !userId || !username || !role || !details) {
    return res.status(400).json({ error: 'action, userId, username, role, and details are required' });
  }

  try {
    const id = uuidv4();
    const created = await AuditLog.create({
      _id: id,
      action,
      userId,
      username,
      role,
      ownerAdminId: ownerAdminId || null,
      targetType: targetType || null,
      targetId: targetId || null,
      details,
      metadata: metadata || null,
      timestamp: new Date().toISOString(),
    });

    return res.status(201).json(normalize(created.toObject()));
  } catch {
    return res.status(500).json({ error: 'Failed to create audit log' });
  }
});

router.get('/user/:userId', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const logs = await AuditLog.find({ userId: req.params.userId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    return res.json(logs.map(normalize));
  } catch {
    return res.status(500).json({ error: 'Failed to fetch user audit logs' });
  }
});

module.exports = router;
