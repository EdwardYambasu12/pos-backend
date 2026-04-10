const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const Settings = require('../models/Settings');
const { emitDataChange } = require('../realtime');

router.get('/:key', async (req, res) => {
  try {
    const entry = await Settings.findOne({ key: req.params.key }).lean();
    if (!entry) {
      return res.json({ key: req.params.key, value: null });
    }

    return res.json({ id: String(entry._id), key: entry.key, value: entry.value });
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
    const existing = await Settings.findOne({ key: req.params.key }).lean();

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

      return res.json({ id: String(updated._id), key: updated.key, value: updated.value });
    }

    const created = await Settings.create({
      _id: uuidv4(),
      key: req.params.key,
      value,
    });

    emitDataChange({
      entity: 'settings',
      action: 'created',
      broadcast: true,
    });

    return res.status(201).json({ id: String(created._id), key: created.key, value: created.value });
  } catch {
    return res.status(500).json({ error: 'Failed to save setting' });
  }
});

module.exports = router;
