/**
 * /api/expenses
 *
 * GET    /      — list expenses (filter by ?shopId= or ?from=&to=)  [admin, manager]
 * GET    /:id   — single expense                                     [admin, manager]
 * POST   /      — create expense                                     [admin, manager]
 * PUT    /:id   — update expense                                     [admin, manager]
 * DELETE /:id   — delete expense                                     [admin]
 *
 * Query param: ?userId=<id> enforces shop-level access for cashiers
 */

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');

const Expense = require('../models/Expense');
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

router.get('/', async (req, res) => {
  try {
    const { userId } = req.query;
    const access = await checkCashierAccess(userId, req.query.shopId);
    if (!access.allowed) {
      return res.status(403).json({ error: 'Access denied: cashiers can only access their assigned shop' });
    }

    const filter = {};
    if (req.query.shopId) {
      filter.shopId = req.query.shopId;
    } else if (access.restrictedShopId && !req.query.shopId) {
      // Cashier without explicit shopId: auto-restrict
      filter.shopId = access.restrictedShopId;
    }

    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = req.query.from;
      if (req.query.to) filter.date.$lte = req.query.to;
    }
    const expenses = await Expense.find(filter).sort({ date: -1 }).lean();
    return res.json(expenses.map(normalize));
  } catch {
    return res.status(500).json({ error: 'Failed to fetch expenses' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const e = await Expense.findById(req.params.id).lean();
    if (!e) return res.status(404).json({ error: 'Expense not found' });

    const { userId } = req.query;
    const access = await checkCashierAccess(userId, e.shopId);
    if (!access.allowed) {
      return res.status(403).json({ error: 'Access denied: cashiers can only access expenses from their assigned shop' });
    }

    return res.json(normalize(e));
  } catch {
    return res.status(500).json({ error: 'Failed to fetch expense' });
  }
});

router.post('/', async (req, res) => {
  const { title, amount, date, shopId, userId } = req.body;
  if (!title || amount == null) {
    return res.status(400).json({ error: 'title and amount are required' });
  }

  try {
    // Verify cashier access if userId provided
    const access = await checkCashierAccess(userId, shopId);
    if (!access.allowed) {
      return res.status(403).json({ error: 'Access denied: cashiers can only create expenses for their assigned shop' });
    }

    const finalShopId = shopId || access.restrictedShopId || null;

    const id = uuidv4();
    const expense = await Expense.create({
      _id: id,
      title: title.trim(),
      amount: Number(amount),
      date: date || new Date().toISOString(),
      shopId: finalShopId,
    });

    await audit({
      action: 'expense_added',
      userId: userId || null,
      username: null,
      role: null,
      targetType: 'expense',
      targetId: id,
      details: `Added expense "${title}" of ${amount}`,
    });

    return res.status(201).json(normalize(expense.toObject()));
  } catch (err) {
    console.error('[POST /expenses]', err);
    return res.status(500).json({ error: 'Failed to create expense' });
  }
});

router.put('/:id', async (req, res) => {
  const allowed = ['title', 'amount', 'date', 'shopId'];
  const updates = {};
  allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  try {
    // Get existing expense to check access
    const existingExpense = await Expense.findById(req.params.id).lean();
    if (!existingExpense) return res.status(404).json({ error: 'Expense not found' });

    // Check if cashier can update this expense
    const shopIdToCheck = updates.shopId || existingExpense.shopId;
    const { userId } = req.body;
    const access = await checkCashierAccess(userId, shopIdToCheck);
    if (!access.allowed) {
      return res.status(403).json({ error: 'Access denied: cashiers can only update expenses in their assigned shop' });
    }

    const expense = await Expense.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true });
    return res.json(normalize(expense.toObject()));
  } catch (err) {
    console.error('[PUT /expenses/:id]', err);
    return res.status(500).json({ error: 'Failed to update expense' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id).lean();
    if (!expense) return res.status(404).json({ error: 'Expense not found' });

    const { userId } = req.query;
    const access = await checkCashierAccess(userId, expense.shopId);
    if (!access.allowed) {
      return res.status(403).json({ error: 'Access denied: cashiers can only delete expenses from their assigned shop' });
    }

    await Expense.findByIdAndDelete(req.params.id);

    await audit({
      action: 'expense_deleted',
      userId: userId || null,
      username: null,
      role: null,
      targetType: 'expense',
      targetId: req.params.id,
      details: `Deleted expense "${expense.title}"`,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /expenses/:id]', err);
    return res.status(500).json({ error: 'Failed to delete expense' });
  }
});

module.exports = router;
