/**
 * /api/sync
 *
 * These endpoints are called by the frontend's remoteSyncService and tenantService.
 *
 * POST /upsert        — upsert a document into a collection
 * POST /delete        — delete a document from a collection
 * GET  /export-all    — export ALL collections as a snapshot
 * GET  /pull-whole-db — explicit full database snapshot route
 * GET  /export-state  — export per-user tenant hierarchy (owner → shops → products)
 */

const router = require('express').Router();
const { requireApiKey } = require('../middleware/auth');
const ALLOW_REMOTE_SYNC_DELETE = process.env.ENABLE_REMOTE_SYNC_DELETE !== 'false';

const User = require('../models/User');
const Product = require('../models/Product');
const Sale = require('../models/Sale');
const Expense = require('../models/Expense');
const Category = require('../models/Category');
const Shop = require('../models/Shop');
const Session = require('../models/Session');
const AuditLog = require('../models/AuditLog');
const Subscription = require('../models/Subscription');
const Settings = require('../models/Settings');
const License = require('../models/License');

// Map frontend collection names → Mongoose models
const MODEL_MAP = {
  products: Product,
  sales: Sale,
  expenses: Expense,
  categories: Category,
  shops: Shop,
  users: User,
  sessions: Session,
  auditLogs: AuditLog,
  subscriptions: Subscription,
  settings: Settings,
  license: License,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Sanitize an incoming sync document before writing to Mongo */
function sanitizeDoc(doc) {
  if (!doc || typeof doc !== 'object') return {};
  const clean = { ...doc };
  // Remove internal Mongo fields that could cause conflicts
  delete clean.__v;
  // Ensure _id is a string (frontend uses UUIDs)
  if (clean.id && !clean._id) {
    clean._id = String(clean.id);
    delete clean.id;
  }
  return clean;
}

function isDuplicateKeyError(err) {
  return Boolean(err && (err.code === 11000 || String(err.message || '').includes('E11000')));
}

async function buildFullSnapshot() {
  const [
    products,
    sales,
    expenses,
    license,
    settings,
    users,
    sessions,
    auditLogs,
    categories,
    shops,
    subscriptions,
  ] = await Promise.all([
    Product.find().lean(),
    Sale.find().lean(),
    Expense.find().lean(),
    License.find().lean(),
    Settings.find().lean(),
    User.find().select('-pin').lean(),
    Session.find().lean(),
    AuditLog.find().lean(),
    Category.find().lean(),
    Shop.find().lean(),
    Subscription.find().lean(),
  ]);

  const normalize = (arr) => arr.map(({ _id, ...rest }) => ({ id: String(_id), ...rest }));

  return {
    products: normalize(products),
    sales: normalize(sales),
    expenses: normalize(expenses),
    license: normalize(license),
    settings: normalize(settings),
    users: normalize(users),
    sessions: normalize(sessions),
    auditLogs: normalize(auditLogs),
    categories: normalize(categories),
    shops: normalize(shops),
    subscriptions: normalize(subscriptions),
  };
}
router.post('/batch', requireApiKey, async (req, res) => {
  const { operations } = req.body;

  if (!Array.isArray(operations) || operations.length === 0) {
    return res.status(400).json({ error: 'operations array is required' });
  }

  const results = [];
  const errors = [];

  for (const op of operations) {
    const { collection, id, doc } = op;

    if (!collection || !id || !doc) {
      errors.push({ op, error: 'Invalid operation format' });
      continue;
    }

    const Model = MODEL_MAP[collection];
    if (!Model) {
      errors.push({ op, error: `Unknown collection: ${collection}` });
      continue;
    }

    let cleaned = sanitizeDoc(doc);
    cleaned._id = String(id);

    // ✅ Remove null/undefined (CRITICAL)
    Object.keys(cleaned).forEach((key) => {
      if (cleaned[key] === undefined || cleaned[key] === null) {
        delete cleaned[key];
      }
    });

    try {
      const existing = await Model.findById(String(id)).lean();

      // ✅ Prevent stale overwrite
      if (
        existing &&
        cleaned.updatedAt &&
        existing.updatedAt &&
        new Date(existing.updatedAt) > new Date(cleaned.updatedAt)
      ) {
        results.push({ id, status: 'skipped', reason: 'stale' });
        continue;
      }

      // ✅ Protect critical fields
      if (existing) {
        if (collection === 'users') {
          cleaned.role = existing.role;
          cleaned.ownerAdminId = existing.ownerAdminId;
          cleaned.shopId = existing.shopId;
        }

        if (collection === 'products') {
          cleaned.ownerAdminId = existing.ownerAdminId;
        }
      }

      // ✅ Normalize username
      if (collection === 'users' && typeof cleaned.username === 'string') {
        cleaned.username = cleaned.username.toLowerCase().trim();
      }

      // ✅ SALES = append-only (IMPORTANT)
      if (collection === 'sales') {
        const exists = await Model.findById(String(id));
        if (exists) {
          results.push({ id, status: 'skipped', reason: 'exists' });
          continue;
        }

        await Model.create(cleaned);
        results.push({ id, status: 'created' });
        continue;
      }

      // ✅ Backup before update
      if (existing) {
        await AuditLog.create({
          action: 'backup-before-update',
          collection,
          docId: id,
          previous: existing,
          timestamp: new Date(),
        });
      }

      // ✅ Upsert safely
      await Model.findByIdAndUpdate(
        String(id),
        { $set: cleaned },
        { upsert: true, new: true }
      );

      results.push({ id, status: 'ok' });

    } catch (err) {
      console.error(`[sync/batch] ${collection}/${id}:`, err.message);

      errors.push({
        id,
        collection,
        error: err.message,
      });
    }
  }

  return res.json({
    ok: true,
    processed: results.length,
    failed: errors.length,
    results,
    errors,
  });
});
// ─── POST /upsert ─────────────────────────────────────────────────────────────
router.post('/upsert', requireApiKey, async (req, res) => {
  const { collection, id, doc } = req.body;

  if (!collection || !id || !doc) {
    return res.status(400).json({ error: 'collection, id, and doc are required' });
  }

  const Model = MODEL_MAP[collection];
  if (!Model) {
    return res.status(400).json({ error: `Unknown collection: ${collection}` });
  }

  let cleaned = sanitizeDoc(doc);
  cleaned._id = String(id);

  // ✅ 1. REMOVE null / undefined values (CRITICAL)
  Object.keys(cleaned).forEach((key) => {
    if (cleaned[key] === undefined || cleaned[key] === null) {
      delete cleaned[key];
    }
  });

  try {
    const existing = await Model.findById(String(id)).lean();

    // ✅ 2. Prevent stale data overwrite (VERY IMPORTANT)
    if (
      existing &&
      cleaned.updatedAt &&
      existing.updatedAt &&
      new Date(existing.updatedAt) > new Date(cleaned.updatedAt)
    ) {
      return res.json({ skipped: true, reason: 'stale update' });
    }

    // ✅ 3. Protect critical fields (especially USERS)
    if (existing) {
      if (collection === 'users') {
        cleaned.role = existing.role;
        cleaned.ownerAdminId = existing.ownerAdminId;
        cleaned.shopId = existing.shopId;
      }

      if (collection === 'products') {
        cleaned.ownerAdminId = existing.ownerAdminId;
      }
    }

    // ✅ 4. Normalize username safely
    if (collection === 'users' && typeof cleaned.username === 'string') {
      cleaned.username = cleaned.username.toLowerCase().trim();
    }

    // ✅ 5. Infer ownership safely (your original logic)
    if (collection === 'products' && !cleaned.ownerAdminId && cleaned.shopId) {
      try {
        const shop = await Shop.findById(String(cleaned.shopId))
          .select('ownerAdminId createdBy')
          .lean();

        const inferredOwner = shop?.ownerAdminId || shop?.createdBy;
        if (inferredOwner) {
          cleaned.ownerAdminId = String(inferredOwner);
        }
      } catch {
        // ignore safely
      }
    }

    // ✅ 6. Backup BEFORE update (LIFESAVER)
    if (existing) {
      await AuditLog.create({
        action: 'backup-before-update',
        collection,
        docId: id,
        previous: existing,
        timestamp: new Date(),
      });
    }

    // ✅ 7. SAFE UPDATE (no overwrite, only valid fields)
    await Model.findByIdAndUpdate(
      String(id),
      { $set: cleaned },
      { upsert: true, new: true }
    );

    return res.json({ ok: true });

  } catch (err) {
    // ✅ 8. Duplicate username fallback (your original logic improved)
    if (collection === 'users' && isDuplicateKeyError(err) && cleaned.username) {
      try {
        const { _id: _ignoredId, ...updatePayload } = cleaned;

        const updated = await Model.findOneAndUpdate(
          { username: cleaned.username },
          { $set: updatePayload },
          { new: true }
        );

        if (updated) {
          return res.json({ ok: true, resolvedBy: 'username' });
        }
      } catch (fallbackErr) {
        console.error(`[sync/upsert-fallback] users/${id}:`, fallbackErr.message);
      }
    }

    console.error(`[sync/upsert] ${collection}/${id}:`, err.message);
    return res.status(500).json({ error: 'Upsert failed' });
  }
});


// ─── GET /export-all ──────────────────────────────────────────────────────────
/**
 * Returns all documents from every collection as a flat snapshot object.
 * Shape: { data: { products: [...], sales: [...], ... } }
 */
router.get('/export-all', requireApiKey, async (req, res) => {
  try {
    const data = await buildFullSnapshot();
    return res.json({ data });
  } catch (err) {
    console.error('[sync/export-all]', err);
    return res.status(500).json({ error: 'Export failed' });
  }
});

// ─── GET /pull-whole-db ──────────────────────────────────────────────────────
/**
 * Explicit route to pull the whole database.
 * Shape: { data: { products: [...], sales: [...], ... } }
 */
router.get('/pull-whole-db', requireApiKey, async (req, res) => {
  try {
    const data = await buildFullSnapshot();
    return res.json({ data });
  } catch (err) {
    console.error('[sync/pull-whole-db]', err);
    return res.status(500).json({ error: 'Export failed' });
  }
});

// ─── GET /public-export-core (no API key) ───────────────────────────────────
/**
 * Debug endpoint to verify that core data is persisted on the backend.
 * Returns only users (without pin), products, and shops.
 */
router.get('/public-export-core', async (_req, res) => {
  try {
    const [users, products, shops] = await Promise.all([
      User.find().select('-pin').lean(),
      Product.find().lean(),
      Shop.find().lean(),
    ]);

    const normalize = (arr) => arr.map(({ _id, ...rest }) => ({ id: String(_id), ...rest }));

    return res.json({
      data: {
        users: normalize(users),
        products: normalize(products),
        shops: normalize(shops),
      },
    });
  } catch (err) {
    console.error('[sync/public-export-core]', err);
    return res.status(500).json({ error: 'Export failed' });
  }
});

// ─── GET /export-state ────────────────────────────────────────────────────────
/**
 * Returns a tenant-scoped hierarchy per admin user (owner).
 * Shape: { data: [ { tenantId, owner, additionalUsers, shops: [{ ...shop, users, products }] } ] }
 *
 * Query params:
 *   ?userId=<id>  — If requesting user is a cashier, filters to their assigned shop only
 *
 * The frontend's tenantService calls this endpoint.
 */
router.get('/export-state', requireApiKey, async (req, res) => {
  try {
    const requestingUserId = req.query.userId;
    let requestingUser = null;

    // If userId provided, fetch requesting user to check role/shop
    if (requestingUserId) {
      requestingUser = await User.findById(String(requestingUserId)).lean();
    }

    // If cashier, return only their shop; else return all admin tenants
    if (requestingUser && requestingUser.role === 'cashier') {
      if (!requestingUser.shopId) {
        // Cashier with no shop assignment can see nothing
        return res.json({ data: [] });
      }

      const shop = await Shop.findById(String(requestingUser.shopId)).lean();
      if (!shop) {
        return res.json({ data: [] });
      }

      const adminId = String(shop.ownerAdminId || shop.createdBy);
      const admin = await User.findById(adminId).lean();
      if (!admin) {
        return res.json({ data: [] });
      }

      // Get all data for cashier's shop only
      const shopUsers = await User.find({ shopId: String(requestingUser.shopId) }).select('-pin').lean();
      const shopProducts = await Product.find({ shopId: String(requestingUser.shopId) }).lean();
      const shopSales = await Sale.find({ shopId: String(requestingUser.shopId) }).lean();
      const shopExpenses = await Expense.find({ shopId: String(requestingUser.shopId) }).lean();
      const shopAuditLogs = await AuditLog.find({ }).lean(); // Filter below

      const normalize = ({ _id, ...rest }) => ({ id: String(_id), ...rest });

      // Filter audit logs to include only logs for the shop's users
      const shopUserIds = new Set(shopUsers.map((u) => String(u._id)));
      const filteredAuditLogs = shopAuditLogs.filter((log) => shopUserIds.has(String(log.userId)));

      return res.json({
        data: [
          {
            tenantId: adminId,
            owner: normalize(admin),
            additionalUsers: shopUsers.filter((u) => String(u._id) !== adminId).map(normalize),
            shops: [
              {
                ...normalize(shop),
                users: shopUsers.map(normalize),
                products: shopProducts.map(normalize),
              },
            ],
            products: shopProducts.map(normalize),
            sales: shopSales.map(normalize),
            expenses: shopExpenses.map(normalize),
            auditLogs: filteredAuditLogs.map(normalize),
            sessions: [],
          },
        ],
      });
    }

    // Admin or no userId: return all tenants
    const admins = await User.find({ role: 'admin', active: true }).lean();
    const allShops = await Shop.find().lean();
    const allUsers = await User.find().select('-pin').lean();
    const allProducts = await Product.find().lean();
    const allSales = await Sale.find().lean();
    const allExpenses = await Expense.find().lean();
    const allAuditLogs = await AuditLog.find().lean();
    const allSessions = await Session.find().lean();

    const normalize = ({ _id, ...rest }) => ({ id: String(_id), ...rest });

    const tenants = admins.map((admin) => {
      const adminId = String(admin._id);

      // Shops owned by this admin
      const ownerShops = allShops.filter((s) => {
        if (s.ownerAdminId) return String(s.ownerAdminId) === adminId;
        return String(s.createdBy) === adminId;
      });

      const enrichedShops = ownerShops.map((shop) => {
        const shopId = String(shop._id);
        const shopUsers = allUsers.filter((u) => String(u.shopId) === shopId);
        const shopProducts = allProducts.filter((p) => p.shopId && String(p.shopId) === shopId);

        return {
          ...normalize(shop),
          users: shopUsers.map(normalize),
          products: shopProducts.map(normalize),
        };
      });

      // Additional users under this admin tenant (including users without shop assignment)
      const shopIds = new Set(ownerShops.map((s) => String(s._id)));
      const additionalUsers = allUsers.filter(
        (u) => {
          if (u.role === 'admin') return false;
          if (u.ownerAdminId) return String(u.ownerAdminId) === adminId;
          if (u.createdBy) return String(u.createdBy) === adminId;
          return u.shopId && shopIds.has(String(u.shopId));
        },
      );
      const tenantProducts = allProducts.filter((product) => {
        if (product.ownerAdminId) return String(product.ownerAdminId) === adminId;
        return product.shopId && shopIds.has(String(product.shopId));
      });
      const tenantUsers = [admin, ...additionalUsers];
      const tenantUserIds = new Set(tenantUsers.map((u) => String(u._id)));
      const tenantSales = allSales.filter((sale) => {
        if (sale.ownerAdminId) return String(sale.ownerAdminId) === adminId;
        return sale.shopId && shopIds.has(String(sale.shopId));
      });
      const tenantExpenses = allExpenses.filter((expense) => {
        if (expense.ownerAdminId) return String(expense.ownerAdminId) === adminId;
        return expense.shopId && shopIds.has(String(expense.shopId));
      });
      const tenantAuditLogs = allAuditLogs.filter((log) => {
        if (log.ownerAdminId) return String(log.ownerAdminId) === adminId;
        return tenantUserIds.has(String(log.userId));
      });
      const tenantSessions = allSessions.filter((session) => {
        if (session.ownerAdminId) return String(session.ownerAdminId) === adminId;
        return tenantUserIds.has(String(session.userId));
      });

      return {
        tenantId: adminId,
        owner: normalize(admin),
        additionalUsers: additionalUsers.map(normalize),
        shops: enrichedShops,
        products: tenantProducts.map(normalize),
        sales: tenantSales.map(normalize),
        expenses: tenantExpenses.map(normalize),
        auditLogs: tenantAuditLogs.map(normalize),
        sessions: tenantSessions.map(normalize),
      };
    });

    return res.json({ data: tenants });
  } catch (err) {
    console.error('[sync/export-state]', err);
    return res.status(500).json({ error: 'Export failed' });
  }
});

// ─── GET /export-tenants (legacy alias) ───────────────────────────────────────
router.get('/export-tenants', requireApiKey, async (req, res) => {
  try {
    const admins = await User.find({ role: 'admin', active: true }).lean();
    const allShops = await Shop.find().lean();
    const allUsers = await User.find().select('-pin').lean();
    const allProducts = await Product.find().lean();
    const allSales = await Sale.find().lean();
    const allExpenses = await Expense.find().lean();
    const allAuditLogs = await AuditLog.find().lean();
    const allSessions = await Session.find().lean();

    const normalize = ({ _id, ...rest }) => ({ id: String(_id), ...rest });

    const tenants = admins.map((admin) => {
      const adminId = String(admin._id);
      const ownerShops = allShops.filter((s) => {
        if (s.ownerAdminId) return String(s.ownerAdminId) === adminId;
        return String(s.createdBy) === adminId;
      });

      const enrichedShops = ownerShops.map((shop) => {
        const shopId = String(shop._id);
        return {
          ...normalize(shop),
          users: allUsers.filter((u) => String(u.shopId) === shopId).map(normalize),
          products: allProducts.filter((p) => p.shopId && String(p.shopId) === shopId).map(normalize),
        };
      });

      const shopIds = new Set(ownerShops.map((s) => String(s._id)));
      const additionalUsers = allUsers.filter(
        (u) => {
          if (u.role === 'admin') return false;
          if (u.ownerAdminId) return String(u.ownerAdminId) === adminId;
          if (u.createdBy) return String(u.createdBy) === adminId;
          return u.shopId && shopIds.has(String(u.shopId));
        },
      );
      const tenantProducts = allProducts.filter((product) => {
        if (product.ownerAdminId) return String(product.ownerAdminId) === adminId;
        return product.shopId && shopIds.has(String(product.shopId));
      });
      const tenantUsers = [admin, ...additionalUsers];
      const tenantUserIds = new Set(tenantUsers.map((u) => String(u._id)));
      const tenantSales = allSales.filter((sale) => {
        if (sale.ownerAdminId) return String(sale.ownerAdminId) === adminId;
        return sale.shopId && shopIds.has(String(sale.shopId));
      });
      const tenantExpenses = allExpenses.filter((expense) => {
        if (expense.ownerAdminId) return String(expense.ownerAdminId) === adminId;
        return expense.shopId && shopIds.has(String(expense.shopId));
      });
      const tenantAuditLogs = allAuditLogs.filter((log) => {
        if (log.ownerAdminId) return String(log.ownerAdminId) === adminId;
        return tenantUserIds.has(String(log.userId));
      });
      const tenantSessions = allSessions.filter((session) => {
        if (session.ownerAdminId) return String(session.ownerAdminId) === adminId;
        return tenantUserIds.has(String(session.userId));
      });

      return {
        tenantId: adminId,
        owner: normalize(admin),
        additionalUsers: additionalUsers.map(normalize),
        shops: enrichedShops,
        products: tenantProducts.map(normalize),
        sales: tenantSales.map(normalize),
        expenses: tenantExpenses.map(normalize),
        auditLogs: tenantAuditLogs.map(normalize),
        sessions: tenantSessions.map(normalize),
      };
    });

    return res.json({ data: tenants });
  } catch (err) {
    console.error('[sync/export-tenants]', err);
    return res.status(500).json({ error: 'Export failed' });
  }
});

module.exports = router;