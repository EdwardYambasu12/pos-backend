const router = require('express').Router();
const { requireApiKey } = require('../middleware/auth');
const DataSnapshot = require('../models/DataSnapshot');

// GET /api/snapshot
router.get('/', async (req, res) => {
  return res.json({ message: 'Snapshot API endpoints: /list, /stats, /download/:id' });
});

// GET /api/snapshot/list
router.get('/list', async (req, res) => {
  const { limit = 50, skip = 0 } = req.query;
  try {
    const snapshots = await DataSnapshot.find()
      .sort({ timestamp: -1 })
      .skip(parseInt(skip, 10) || 0)
      .limit(Math.min(parseInt(limit, 10) || 50, 200))
      .select('-data')
      .lean();

    const transformed = snapshots.map((snapshot) => ({
      id: snapshot._id,
      ...snapshot,
      _id: undefined,
    }));

    return res.json({ snapshots: transformed });
  } catch (err) {
    console.error('[snapshot/list]', err.message);
    return res.status(500).json({ error: 'Failed to list snapshots' });
  }
});

// GET /api/snapshot/download/:id
router.get('/download/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const snapshot = await DataSnapshot.findById(id).lean();
    if (!snapshot) {
      return res.status(404).json({ error: 'Snapshot not found' });
    }

    return res.json({
      snapshot: {
        id: snapshot._id,
        timestamp: snapshot.timestamp,
        version: snapshot.version,
        data: snapshot.data,
      },
    });
  } catch (err) {
    console.error('[snapshot/download]', err.message);
    return res.status(500).json({ error: 'Failed to download snapshot' });
  }
});

// GET /api/snapshot/stats
router.get('/stats', async (req, res) => {
  try {
    const stats = await DataSnapshot.aggregate([
      {
        $group: {
          _id: null,
          totalSnapshots: { $sum: 1 },
          oldestSnapshot: { $min: '$timestamp' },
          newestSnapshot: { $max: '$timestamp' },
        },
      },
    ]);

    const result = stats[0] || {
      totalSnapshots: 0,
      oldestSnapshot: null,
      newestSnapshot: null,
    };

    return res.json({ stats: result });
  } catch (err) {
    console.error('[snapshot/stats]', err.message);
    return res.status(500).json({ error: 'Failed to get snapshot stats' });
  }
});

module.exports = router;
