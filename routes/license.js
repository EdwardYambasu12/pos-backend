const router = require('express').Router();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const License = require('../models/License');

function parseTier(key) {
  const upper = String(key || '').toUpperCase();
  if (upper.includes('PREM')) return 'premium';
  if (upper.includes('STD')) return 'standard';
  return 'basic';
}

function signLicense({ key, tier, expiryDate }) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ key, tier, exp: expiryDate }))
    .digest('base64');
}

router.get('/', async (_req, res) => {
  try {
    const license = await License.findOne().lean();
    if (!license) {
      return res.json(null);
    }

    return res.json({ id: String(license._id), ...license, _id: undefined });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch license' });
  }
});

router.post('/activate', async (req, res) => {
  const { key } = req.body;
  if (!key || !String(key).startsWith('POS-')) {
    return res.status(400).json({ success: false, message: 'Invalid license key format.' });
  }

  try {
    const tier = parseTier(key);
    const now = new Date();
    const expiry = new Date(now);
    expiry.setFullYear(expiry.getFullYear() + 1);

    await License.deleteMany({});

    const created = await License.create({
      _id: uuidv4(),
      key,
      tier,
      expiryDate: expiry.toISOString(),
      activatedAt: now.toISOString(),
      lastOpenedAt: now.toISOString(),
      signature: signLicense({ key, tier, expiryDate: expiry.toISOString() }),
    });

    const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
    return res.status(201).json({
      success: true,
      message: `License activated successfully! Plan: ${tierLabel}`,
      license: { id: String(created._id), ...created.toObject(), _id: undefined },
    });
  } catch {
    return res.status(500).json({ success: false, message: 'Activation failed. Please try again.' });
  }
});

router.get('/validate', async (_req, res) => {
  try {
    const license = await License.findOne().lean();
    if (!license) {
      return res.json({ valid: false, expired: false, daysLeft: 0, tampered: false });
    }

    const now = new Date();
    const expiry = new Date(license.expiryDate);
    const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const expired = daysLeft <= 0;

    await License.findByIdAndUpdate(String(license._id), {
      $set: { lastOpenedAt: now.toISOString() },
    });

    return res.json({
      valid: !expired,
      expired,
      daysLeft: Math.max(0, daysLeft),
      tampered: false,
    });
  } catch {
    return res.status(500).json({ error: 'Failed to validate license' });
  }
});

module.exports = router;
