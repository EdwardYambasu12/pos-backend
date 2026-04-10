/**
 * /api/products
 *
 * GET    /         — list products (optionally filter by ?shopId=)   [any authenticated]
 * GET    /:id      — single product                                   [any authenticated]
 * POST   /         — create product                                   [admin, manager]
 * PUT    /:id      — update product                                   [admin, manager]
 * DELETE /:id      — delete product                                   [admin, manager]
 *
 * Query param: ?userId=<id> enforces shop-level access for cashiers
 */

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');

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
 */
async function checkCashierAccess(userId, requestedShopId) {
  if (!userId) return { allowed: true };

  const user = await User.findById(String(userId)).lean();
  if (!user || user.role !== 'cashier') return { allowed: true };

  if (!user.shopId) return { allowed: false };

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

    const filter = req.query.shopId ? { shopId: req.query.shopId } : {};

    if (ownerAdminId) {
      filter.ownerAdminId = ownerAdminId;
    }
    
    // If cashier without explicit shopId, auto-restrict
    if (access.restrictedShopId && !req.query.shopId) {
      filter.shopId = access.restrictedShopId;
    }

    const products = await Product.find(filter).lean();
    return res.json(products.map(normalize));
  } catch {
    return res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// GET /:id
router.get('/:id', async (req, res) => {
  try {
    const p = await Product.findById(req.params.id).lean();
    if (!p) return res.status(404).json({ error: 'Product not found' });

    const { userId } = req.query;
    const access = await checkCashierAccess(userId, p.shopId);
    if (!access.allowed) {
      return res.status(403).json({ error: 'Access denied: cashiers can only access products from their assigned shop' });
    }

    return res.json(normalize(p));
  } catch {
    return res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// POST /
router.post('/', async (req, res) => {
  const { name, costPrice, sellingPrice, quantity, shopId, ownerAdminId, userId, ...rest } = req.body;
  if (!name || costPrice == null || sellingPrice == null || quantity == null) {
    return res.status(400).json({ error: 'name, costPrice, sellingPrice, and quantity are required' });
  }

  try {
    // Verify cashier access if userId provided
    const access = await checkCashierAccess(userId, shopId);
    if (!access.allowed) {
      return res.status(403).json({ error: 'Access denied: cashiers can only create products for their assigned shop' });
    }

    const finalShopId = shopId || access.restrictedShopId || null;

    const id = uuidv4();
    const product = await Product.create({
      _id: id,
      name: name.trim(),
      costPrice: Number(costPrice),
      sellingPrice: Number(sellingPrice),
      quantity: Number(quantity),
      shopId: finalShopId,
      ownerAdminId: ownerAdminId || null,
      createdAt: new Date().toISOString(),
      ...rest,
    });

    await audit({
      action: 'product_added',
      userId: userId || null,
      username: null,
      role: null,
      targetType: 'product',
      targetId: id,
      details: `Added product "${name}"`,
    });

    return res.status(201).json(normalize(product.toObject()));
  } catch (err) {
    console.error('[POST /products]', err);
    return res.status(500).json({ error: 'Failed to create product' });
  }
});

// PUT /:id
router.put('/:id', async (req, res) => {
  const allowed = ['name', 'costPrice', 'sellingPrice', 'discountPrice', 'quantity',
    'category', 'categoryId', 'expiryDate', 'currency', 'shopId'];
  const updates = {};
  allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  try {
    // Get existing product to check access
    const existingProduct = await Product.findById(req.params.id).lean();
    if (!existingProduct) return res.status(404).json({ error: 'Product not found' });

    // Determine which shopId to check: updated shopId or existing shopId
    const shopIdToCheck = updates.shopId || existingProduct.shopId;
    const { userId } = req.body;
    const access = await checkCashierAccess(userId, shopIdToCheck);
    if (!access.allowed) {
      return res.status(403).json({ error: 'Access denied: cashiers can only update products in their assigned shop' });
    }

    const product = await Product.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true });

    const action = updates.sellingPrice !== undefined ? 'price_changed' :
                   updates.quantity !== undefined ? 'stock_adjusted' : 'product_updated';

    await audit({
      action,
      userId: userId || null,
      username: null,
      role: null,
      targetType: 'product',
      targetId: req.params.id,
      details: `Updated product "${product.name}"`,
    });

    return res.json(normalize(product.toObject()));
  } catch (err) {
    console.error('[PUT /products/:id]', err);
    return res.status(500).json({ error: 'Failed to update product' });
  }
});

// DELETE /:id
router.delete('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).lean();
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const { userId } = req.query;
    const access = await checkCashierAccess(userId, product.shopId);
    if (!access.allowed) {
      return res.status(403).json({ error: 'Access denied: cashiers can only delete products from their assigned shop' });
    }

    await Product.findByIdAndDelete(req.params.id);

    await audit({
      action: 'product_deleted',
      userId: userId || null,
      username: null,
      role: null,
      targetType: 'product',
      targetId: req.params.id,
      details: `Deleted product "${product.name}"`,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /products/:id]', err);
    return res.status(500).json({ error: 'Failed to delete product' });
  }
});

module.exports = router;
