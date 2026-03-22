/**
 * /api/shops
 *
 * GET    /      — list all shops       [any authenticated]
 * GET    /:id   — single shop          [any authenticated]
 * POST   /      — create shop          [admin]
 * PUT    /:id   — update shop          [admin]
 * DELETE /:id   — delete shop          [admin]
 */

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');

const Shop = require('../models/Shop');


function normalize({ _id, ...rest }) { return { id: String(_id), ...rest }; }

router.get('/', async (req, res) => {
  try {
    const shops = await Shop.find().lean();
    return res.json(shops.map(normalize));
  } catch {
    return res.status(500).json({ error: 'Failed to fetch shops' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const shop = await Shop.findById(req.params.id).lean();
    if (!shop) return res.status(404).json({ error: 'Shop not found' });
    return res.json(normalize(shop));
  } catch {
    return res.status(500).json({ error: 'Failed to fetch shop' });
  }
});

router.post('/', async (req, res) => {
  const { name, address, phone, logoUrl } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  try {
    const id = uuidv4();
    const shop = await Shop.create({
      _id: id,
      name: name.trim(),
      address: address || null,
      phone: phone || null,
      logoUrl: logoUrl || null,
      createdAt: new Date().toISOString(),
      createdBy: null,
    });
    return res.status(201).json(normalize(shop.toObject()));
  } catch (err) {
    console.error('[POST /shops]', err);
    return res.status(500).json({ error: 'Failed to create shop' });
  }
});

router.put('/:id', async (req, res) => {
  const allowed = ['name', 'address', 'phone', 'logoUrl'];
  const updates = {};
  allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  try {
    const shop = await Shop.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true });
    if (!shop) return res.status(404).json({ error: 'Shop not found' });
    return res.json(normalize(shop.toObject()));
  } catch (err) {
    console.error('[PUT /shops/:id]', err);
    return res.status(500).json({ error: 'Failed to update shop' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const shop = await Shop.findByIdAndDelete(req.params.id);
    if (!shop) return res.status(404).json({ error: 'Shop not found' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /shops/:id]', err);
    return res.status(500).json({ error: 'Failed to delete shop' });
  }
});

module.exports = router;
