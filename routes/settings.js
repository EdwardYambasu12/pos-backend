const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const Settings = require('../models/Settings');
const { emitDataChange } = require('../realtime');

function getShopId(req) {
  const value = req.query?.shopId;
  if (!value || value === 'all') return null;
  return String(value);
}

function buildStorageKey(key, shopId) {
  return shopId ? `${shopId}::${key}` : key;
}

router.get('/:key', async (req, res) => {
  try {
    const shopId = getShopId(req);
    const storageKey = buildStorageKey(req.params.key, shopId);

    let entry = await Settings.findOne({ key: storageKey }).lean();
    if (!entry && shopId) {
      // Backward compatibility: allow old global value until scoped value is saved.
      entry = await Settings.findOne({ key: req.params.key }).lean();
    }

    if (!entry) {
      return res.json({ key: req.params.key, value: null, shopId });
    }

    return res.json({ id: String(entry._id), key: req.params.key, value: entry.value, shopId });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch setting' });
  }
});

router.put('/:key', async (req, res) => {
  const { value } = req.body;
  if (typeof value !== 'string') {
    return res.status(400).json({ error: 'value must be a string' });
  }

  try {
    const shopId = getShopId(req);
    const storageKey = buildStorageKey(req.params.key, shopId);
    const existing = await Settings.findOne({ key: storageKey }).lean();

    if (existing) {
      const updated = await Settings.findByIdAndUpdate(
        String(existing._id),
        { $set: { value } },
        { new: true },
      ).lean();

      emitDataChange({
        entity: 'settings',
        action: 'updated',
        broadcast: true,
      });

      return res.json({ id: String(updated._id), key: req.params.key, value: updated.value, shopId });
    }

    const created = await Settings.create({
      _id: uuidv4(),
      key: storageKey,
      value,
    });

    emitDataChange({
      entity: 'settings',
      action: 'created',
      broadcast: true,
    });

    return res.status(201).json({ id: String(created._id), key: req.params.key, value: created.value, shopId });
  } catch {
    return res.status(500).json({ error: 'Failed to save setting' });
  }
});

module.exports = router;
