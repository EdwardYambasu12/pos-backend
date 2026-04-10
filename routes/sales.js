const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');

const Sale = require('../models/Sale');
const Product = require('../models/Product');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');


async function audit(data) {
  try {
    await AuditLog.create({ _id: uuidv4(), ...data, timestamp: new Date().toISOString() });
  } catch (e) { console.error('[audit]', e.message); }
}

function normalize({ _id, ...rest }) { return { id: String(_id), ...rest }; }

/**
 * Helper: If userId is provided and user is cashier, verify they can access the requested shopId
 * Returns { allowed: boolean, restrictedShopId?: string } where restrictedShopId is the shop they can access
 */
async function checkCashierAccess(userId, requestedShopId) {
  if (!userId) return { allowed: true }; // No restriction if no userId

  const user = await User.findById(String(userId)).lean();
  if (!user || user.role !== 'cashier') return { allowed: true }; // Only restrict cashiers

  // Cashier must have a Shop assignment
  if (!user.shopId) return { allowed: false };

  // If specific shopId requested, verify it matches cashier's shop
  if (requestedShopId && String(requestedShopId) !== String(user.shopId)) {
    return { allowed: false };
  }

  return { allowed: true, restrictedShopId: String(user.shopId) };
}

// GET /
router.get('/', async (req, res) => {
  try {
    const { userId, ownerAdminId } = req.query;
    const access = await checkCashierAccess(userId, req.query.shopId);
    if (!access.allowed) {
      return res.status(403).json({ error: 'Access denied: cashiers can only access their assigned shop' });
    }

    const filter = {};
    if (req.query.shopId) {
      filter.shopId = req.query.shopId;
    } else if (access.restrictedShopId) {
      // Cashier without explicit shopId request: auto-restrict to their shop
      filter.shopId = access.restrictedShopId;
    }

    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = req.query.from;
      if (req.query.to) filter.date.$lte = req.query.to;
    }

    if (ownerAdminId) {
      filter.ownerAdminId = ownerAdminId;
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

    // Check if cashier can access this sale's shop
    const { userId } = req.query;
    const access = await checkCashierAccess(userId, sale.shopId);
    if (!access.allowed) {
      return res.status(403).json({ error: 'Access denied: cashiers can only access their assigned shop' });
    }

    return res.json(normalize(sale));
  } catch {
    return res.status(500).json({ error: 'Failed to fetch sale' });
  }
});

// POST / — record a sale
router.post('/', async (req, res) => {
  const { items, totalAmount, totalProfit, date, shopId, currency, ownerAdminId, userId } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items array is required and must not be empty' });
  }
  if (totalAmount == null || totalProfit == null) {
    return res.status(400).json({ error: 'totalAmount and totalProfit are required' });
  }

  try {
    // Verify cashier access if userId provided
    const access = await checkCashierAccess(userId, shopId);
    if (!access.allowed) {
      return res.status(403).json({ error: 'Access denied: cashiers can only create sales for their assigned shop' });
    }

    // If cashier and no shopId provided, use their shop
    const finalShopId = shopId || access.restrictedShopId || null;

    const id = uuidv4();
    const sale = await Sale.create({
      _id: id,
      items,
      totalAmount: Number(totalAmount),
      totalProfit: Number(totalProfit),
      date: date || new Date().toISOString(),
      shopId: finalShopId,
      ownerAdminId: ownerAdminId || null,
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
      userId: userId || null,
      username: null,
      role: null,
      targetType: 'sale',
      targetId: id,
      details: `Sale of ${items.length} item(s), total ${totalAmount}`,
    });

    return res.status(201).json(normalize(sale.toObject()));
  } catch (err) {
    console.error('[POST /sales]', err);
    return res.status(500).json({ error: 'Failed to record sale' });
  }
});

// PUT /:id — update sale and reconcile stock
router.put('/:id', async (req, res) => {
  const { items, totalAmount, totalProfit, userId } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items array is required and must not be empty' });
  }

  if (totalAmount == null || totalProfit == null) {
    return res.status(400).json({ error: 'totalAmount and totalProfit are required' });
  }

  try {
    const existingSale = await Sale.findById(req.params.id).lean();
    if (!existingSale) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    const access = await checkCashierAccess(userId, existingSale.shopId);
    if (!access.allowed) {
      return res.status(403).json({ error: 'Access denied: cashiers can only update sales in their assigned shop' });
    }

    for (const oldItem of existingSale.items || []) {
      if (oldItem.productId) {
        await Product.findByIdAndUpdate(oldItem.productId, {
          $inc: { quantity: Math.abs(oldItem.quantity || 0) },
        });
      }
    }

    for (const newItem of items) {
      if (newItem.productId) {
        await Product.findByIdAndUpdate(newItem.productId, {
          $inc: { quantity: -Math.abs(newItem.quantity || 0) },
        });
      }
    }

    const updated = await Sale.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          items,
          totalAmount: Number(totalAmount),
          totalProfit: Number(totalProfit),
        },
      },
      { new: true },
    ).lean();

    return res.json(normalize(updated));
  } catch (err) {
    console.error('[PUT /sales/:id]', err);
    return res.status(500).json({ error: 'Failed to update sale' });
  }
});

// DELETE /:id — void sale (admin only, or shop manager/cashier for their shop)
router.delete('/:id', async (req, res) => {
  try {
    const sale = await Sale.findByIdAndDelete(req.params.id);
    if (!sale) return res.status(404).json({ error: 'Sale not found' });

    // Check if cashier can delete this sale
    const { userId } = req.query;
    const access = await checkCashierAccess(userId, sale.shopId);
    if (!access.allowed) {
      // Re-insert the deleted record since we can't delete it
      await Sale.create(sale);
      return res.status(403).json({ error: 'Access denied: cashiers can only delete sales from their assigned shop' });
    }

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
      userId: userId || null,
      username: null,
      role: null,
      targetType: 'sale',
      targetId: req.params.id,
      details: `Voided sale`,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /sales/:id]', err);
    return res.status(500).json({ error: 'Failed to void sale' });
  }
});

// 🔥 DEBUG ROUTE — NO AUTH, NO FILTER
router.get('/debug/all-sales', async (req, res) => {
  try {
    const sales = await Sale.find().lean();

    return res.json({
      count: sales.length,
      sales: sales.map(s => ({
        id: s._id,
        shopId: s.shopId,
        ownerAdminId: s.ownerAdminId,
        totalAmount: s.totalAmount,
        date: s.date,
      })),
    });
  } catch (err) {
    console.error('[DEBUG SALES]', err);
    return res.status(500).json({ error: 'Failed to fetch all sales' });
  }
});

module.exports = router;
