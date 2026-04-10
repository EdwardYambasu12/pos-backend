const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const Subscription = require('../models/Subscription');

const TRIAL_DAYS = 7;
const SUBSCRIPTION_DAYS = 30;

function computeStatus(sub) {
  const now = new Date();
  const expiry = new Date(sub.expiryDate);
  const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const expired = daysLeft <= 0;

  return {
    hasSubscription: true,
    planType: sub.planType,
    status: expired ? 'expired' : sub.status,
    daysLeft: Math.max(0, daysLeft),
    expired,
    isTrial: sub.status === 'trial' && !expired,
  };
}

router.get('/', async (_req, res) => {
  try {
    const sub = await Subscription.findOne().sort({ activatedAt: -1 }).lean();
    if (!sub) {
      return res.json(null);
    }

    return res.json({ id: String(sub._id), ...sub, _id: undefined });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch subscription' });
  }
});

router.get('/status', async (_req, res) => {
  try {
    const sub = await Subscription.findOne().sort({ activatedAt: -1 }).lean();
    if (!sub) {
      return res.json({ hasSubscription: false, planType: 'basic', status: 'expired', daysLeft: 0, expired: true, isTrial: false });
    }

    const nowIso = new Date().toISOString();
    const status = computeStatus(sub);

    await Subscription.findByIdAndUpdate(String(sub._id), {
      $set: {
        lastOpenedAt: nowIso,
        status: status.expired ? 'expired' : sub.status,
      },
    });

    return res.json(status);
  } catch {
    return res.status(500).json({ error: 'Failed to fetch subscription status' });
  }
});

router.post('/trial', async (req, res) => {
  const { planType } = req.body;
  if (!planType) {
    return res.status(400).json({ error: 'planType is required' });
  }

  try {
    const now = new Date();
    const expiry = new Date(now);
    expiry.setDate(expiry.getDate() + TRIAL_DAYS);

    await Subscription.deleteMany({});

    const created = await Subscription.create({
      _id: uuidv4(),
      planType,
      status: 'trial',
      expiryDate: expiry.toISOString(),
      trialStartDate: now.toISOString(),
      activatedAt: now.toISOString(),
      lastOpenedAt: now.toISOString(),
    });

    return res.status(201).json({ id: String(created._id), ...created.toObject(), _id: undefined });
  } catch {
    return res.status(500).json({ error: 'Failed to start trial' });
  }
});

router.post('/activate', async (req, res) => {
  const { planType } = req.body;

  try {
    const current = await Subscription.findOne().sort({ activatedAt: -1 }).lean();
    const now = new Date();
    const expiry = new Date(now);
    expiry.setDate(expiry.getDate() + SUBSCRIPTION_DAYS);

    if (current) {
      const updated = await Subscription.findByIdAndUpdate(
        String(current._id),
        {
          $set: {
            planType: planType || current.planType,
            status: 'active',
            expiryDate: expiry.toISOString(),
            activatedAt: now.toISOString(),
            lastOpenedAt: now.toISOString(),
          },
        },
        { new: true },
      ).lean();

      return res.json({ id: String(updated._id), ...updated, _id: undefined });
    }

    const created = await Subscription.create({
      _id: uuidv4(),
      planType: planType || 'basic',
      status: 'active',
      expiryDate: expiry.toISOString(),
      activatedAt: now.toISOString(),
      lastOpenedAt: now.toISOString(),
    });

    return res.status(201).json({ id: String(created._id), ...created.toObject(), _id: undefined });
  } catch {
    return res.status(500).json({ error: 'Failed to activate subscription' });
  }
});

router.put('/plan', async (req, res) => {
  const { planType } = req.body;
  if (!planType) {
    return res.status(400).json({ error: 'planType is required' });
  }

  try {
    const current = await Subscription.findOne().sort({ activatedAt: -1 }).lean();
    if (!current) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    const updated = await Subscription.findByIdAndUpdate(
      String(current._id),
      { $set: { planType } },
      { new: true },
    ).lean();

    return res.json({ id: String(updated._id), ...updated, _id: undefined });
  } catch {
    return res.status(500).json({ error: 'Failed to change plan' });
  }
});

module.exports = router;
