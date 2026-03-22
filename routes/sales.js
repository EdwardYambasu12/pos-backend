/**
 * /api/sales
 *
 * GET  /        — list sales  (filter by ?shopId= or ?from=&to= ISO dates)  [admin, manager]
 * GET  /:id     — single sale                                                [admin, manager]
 * POST /        — record a sale (also deducts product stock)                 [any authenticated]
 * DELETE /:id   — void/delete a sale                                         [admin]
 */

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');

const Sale = require('../models/Sale');
const Product = require('../models/Product');
const AuditLog = require('../models/AuditLog');


async function audit(data) {
  try {
    await AuditLog.create({ _id: uuidv4(), ...data, timestamp: new Date().toISOString() });
  } catch (e) { console.error('[audit]', e.message); }
}

function normalize({ _id, ...rest }) { return { id: String(_id), ...rest }; }

// GET /
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.shopId) filter.shopId = req.query.shopId;
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = req.query.from;
      if (req.query.to) filter.date.$lte = req.query.to;
    }
    const sales = await Sale.find(filter).sort({ date: -1 }).lean();
    return res.json(sales.map(normalize));
  } catch {
    return res.status(500).json({ error: 'Failed to fetch sales' });
  }
});

// GET /:id
router.get('/:id', async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.id).lean();
    if (!sale) return res.status(404).json({ error: 'Sale not found' });
    return res.json(normalize(sale));
  } catch {
    return res.status(500).json({ error: 'Failed to fetch sale' });
  }
});

// POST / — record a sale
router.post('/', async (req, res) => {
  const { items, totalAmount, totalProfit, date, shopId, currency } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items array is required and must not be empty' });
  }
  if (totalAmount == null || totalProfit == null) {
    return res.status(400).json({ error: 'totalAmount and totalProfit are required' });
  }

  try {
    const id = uuidv4();
    const sale = await Sale.create({
      _id: id,
      items,
      totalAmount: Number(totalAmount),
      totalProfit: Number(totalProfit),
      date: date || new Date().toISOString(),
      shopId: shopId || null,
      currency: currency || null,
    });

    // Deduct stock from Products
    for (const item of items) {
      if (item.productId) {
        await Product.findByIdAndUpdate(item.productId, {
          $inc: { quantity: -Math.abs(item.quantity) },
        });
      }
    }

    await audit({
      action: 'sale_completed',
      userId: null, username: null, role: null,
      targetType: 'sale', targetId: id,
      details: `Sale of ${items.length} item(s), total ${totalAmount}`,
    });

    return res.status(201).json(normalize(sale.toObject()));
  } catch (err) {
    console.error('[POST /sales]', err);
    return res.status(500).json({ error: 'Failed to record sale' });
  }
});

// DELETE /:id — void sale (admin only)
router.delete('/:id', async (req, res) => {
  try {
    const sale = await Sale.findByIdAndDelete(req.params.id);
    if (!sale) return res.status(404).json({ error: 'Sale not found' });

    // Restore stock
    for (const item of sale.items) {
      if (item.productId) {
        await Product.findByIdAndUpdate(item.productId, {
          $inc: { quantity: Math.abs(item.quantity) },
        });
      }
    }

    await audit({
      action: 'sale_voided',
      userId: null, username: null, role: null,
      targetType: 'sale', targetId: req.params.id,
      details: `Voided sale`,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /sales/:id]', err);
    return res.status(500).json({ error: 'Failed to void sale' });
  }
});

module.exports = router;
