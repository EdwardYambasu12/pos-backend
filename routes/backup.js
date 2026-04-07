const router = require('express').Router();
const { requireApiKey } = require('../middleware/auth');
const Backup = require('../models/Backup');

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