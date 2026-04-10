const router = require('express').Router();
const { requireApiKey } = require('../middleware/auth');
const Backup = require('../models/Backup');
const Product = require('../models/Product');
const Sale = require('../models/Sale');
const Expense = require('../models/Expense');
const Category = require('../models/Category');
const Shop = require('../models/Shop');
const User = require('../models/User');
const Session = require('../models/Session');
const AuditLog = require('../models/AuditLog');
const Subscription = require('../models/Subscription');
const Settings = require('../models/Settings');
const License = require('../models/License');

// ─── POST /upload ─────────────────────────────────────────────────────────────
router.post('/upload', requireApiKey, async (req, res) => {
  const { id, timestamp, data, version, size, userId, device, ownerAdminId } = req.body;

  if (!id || !timestamp || !data || !version || !size || !userId) {
    return res.status(400).json({
      error: 'id, timestamp, data, version, size, and userId are required'
    });
  }

  try {
    const backup = new Backup({
      _id: id,
      timestamp,
      data,
      version,
      size,
      userId,
      device: device || '',
      ownerAdminId: ownerAdminId || null,
    });

    await backup.save();
    return res.json({ ok: true, id: backup._id });
  } catch (err) {
    console.error('[backup/upload]', err.message);
    return res.status(500).json({ error: 'Failed to save backup' });
  }
});

// ─── GET /list ───────────────────────────────────────────────────────────────
router.get('/list', requireApiKey, async (req, res) => {
  const { userId, ownerAdminId, limit = 50 } = req.query;

  try {
    let query = {};
    if (ownerAdminId) {
      query.ownerAdminId = ownerAdminId;
    } else if (userId) {
      query.userId = userId;
    }

    const backups = await Backup.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .select('-data') // Don't include the large data field in list
      .lean();

    // Transform _id to id for frontend compatibility
    const transformed = backups.map(backup => ({
      id: backup._id,
      ...backup,
      _id: undefined,
    }));

    return res.json({ backups: transformed });
  } catch (err) {
    console.error('[backup/list]', err.message);
    return res.status(500).json({ error: 'Failed to list backups' });
  }
});

// ─── GET /download/:id ───────────────────────────────────────────────────────
router.get('/download/:id', requireApiKey, async (req, res) => {
  const { id } = req.params;

  try {
    const backup = await Backup.findById(id).lean();
    if (!backup) {
      return res.status(404).json({ error: 'Backup not found' });
    }

    // Transform _id to id for frontend compatibility
    const transformed = {
      id: backup._id,
      timestamp: backup.timestamp,
      data: backup.data,
      version: backup.version,
      size: backup.size,
      userId: backup.userId,
      device: backup.device,
      ownerAdminId: backup.ownerAdminId,
    };

    return res.json({ backup: transformed });
  } catch (err) {
    console.error('[backup/download]', err.message);
    return res.status(500).json({ error: 'Failed to download backup' });
  }
});

// ─── DELETE /delete/:id ──────────────────────────────────────────────────────
router.delete('/delete/:id', requireApiKey, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await Backup.findByIdAndDelete(id);
    if (!result) {
      return res.status(404).json({ error: 'Backup not found' });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[backup/delete]', err.message);
    return res.status(500).json({ error: 'Failed to delete backup' });
  }
});

router.post('/restore/:id', requireApiKey, async (req, res) => {
  const { id } = req.params;

  try {
    const backup = await Backup.findById(id).lean();
    if (!backup) {
      return res.status(404).json({ error: 'Backup not found' });
    }

    const data = JSON.parse(backup.data || '{}');

    await Promise.all([
      Product.deleteMany({}),
      Sale.deleteMany({}),
      Expense.deleteMany({}),
      Category.deleteMany({}),
      Shop.deleteMany({}),
      User.deleteMany({}),
      Session.deleteMany({}),
      AuditLog.deleteMany({}),
      Subscription.deleteMany({}),
      Settings.deleteMany({}),
      License.deleteMany({}),
    ]);

    const toDocs = (items = []) =>
      items.map((entry) => {
        const { id: entryId, ...rest } = entry || {};
        return {
          _id: String(entryId || rest._id),
          ...rest,
        };
      });

    if (Array.isArray(data.products) && data.products.length > 0) await Product.insertMany(toDocs(data.products));
    if (Array.isArray(data.sales) && data.sales.length > 0) await Sale.insertMany(toDocs(data.sales));
    if (Array.isArray(data.expenses) && data.expenses.length > 0) await Expense.insertMany(toDocs(data.expenses));
    if (Array.isArray(data.categories) && data.categories.length > 0) await Category.insertMany(toDocs(data.categories));
    if (Array.isArray(data.shops) && data.shops.length > 0) await Shop.insertMany(toDocs(data.shops));
    if (Array.isArray(data.users) && data.users.length > 0) await User.insertMany(toDocs(data.users));
    if (Array.isArray(data.sessions) && data.sessions.length > 0) await Session.insertMany(toDocs(data.sessions));
    if (Array.isArray(data.auditLogs) && data.auditLogs.length > 0) await AuditLog.insertMany(toDocs(data.auditLogs));
    if (Array.isArray(data.subscriptions) && data.subscriptions.length > 0) await Subscription.insertMany(toDocs(data.subscriptions));
    if (Array.isArray(data.settings) && data.settings.length > 0) await Settings.insertMany(toDocs(data.settings));
    if (Array.isArray(data.license) && data.license.length > 0) await License.insertMany(toDocs(data.license));

    return res.json({ ok: true });
  } catch (err) {
    console.error('[backup/restore]', err.message);
    return res.status(500).json({ error: 'Failed to restore backup' });
  }
});

// ─── GET /stats ──────────────────────────────────────────────────────────────
router.get('/stats', requireApiKey, async (req, res) => {
  const { userId, ownerAdminId } = req.query;

  try {
    let query = {};
    if (ownerAdminId) {
      query.ownerAdminId = ownerAdminId;
    } else if (userId) {
      query.userId = userId;
    }

    const stats = await Backup.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalBackups: { $sum: 1 },
          totalSize: { $sum: '$size' },
          oldestBackup: { $min: '$timestamp' },
          newestBackup: { $max: '$timestamp' },
        },
      },
    ]);

    const result = stats[0] || {
      totalBackups: 0,
      totalSize: 0,
      oldestBackup: null,
      newestBackup: null,
    };

    return res.json({ stats: result });
  } catch (err) {
    console.error('[backup/stats]', err.message);
    return res.status(500).json({ error: 'Failed to get backup stats' });
  }
});

module.exports = router;