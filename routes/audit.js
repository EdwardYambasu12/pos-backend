/**
 * /api/audit
 *
 * GET /        — paginated audit log          [admin]
 * GET /user/:userId — logs for a specific user [admin]
 */

const router = require('express').Router();
const AuditLog = require('../models/AuditLog');


function normalize({ _id, ...rest }) { return { id: String(_id), ...rest }; }

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const skip = parseInt(req.query.skip) || 0;
    const filter = {};
    if (req.query.action) filter.action = req.query.action;
    if (req.query.userId) filter.userId = req.query.userId;

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
