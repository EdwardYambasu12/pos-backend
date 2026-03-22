/**
 * /api/expenses
 *
 * GET    /      — list expenses (filter by ?shopId= or ?from=&to=)  [admin, manager]
 * GET    /:id   — single expense                                     [admin, manager]
 * POST   /      — create expense                                     [admin, manager]
 * PUT    /:id   — update expense                                     [admin, manager]
 * DELETE /:id   — delete expense                                     [admin]
 */

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');

const Expense = require('../models/Expense');
const AuditLog = require('../models/AuditLog');


async function audit(data) {
  try {
    await AuditLog.create({ _id: uuidv4(), ...data, timestamp: new Date().toISOString() });
  } catch (e) { console.error('[audit]', e.message); }
}

function normalize({ _id, ...rest }) { return { id: String(_id), ...rest }; }

router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.shopId) filter.shopId = req.query.shopId;
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
    return res.json(normalize(e));
  } catch {
    return res.status(500).json({ error: 'Failed to fetch expense' });
  }
});

router.post('/', async (req, res) => {
  const { title, amount, date, shopId } = req.body;
  if (!title || amount == null) {
    return res.status(400).json({ error: 'title and amount are required' });
  }

  try {
    const id = uuidv4();
    const expense = await Expense.create({
      _id: id,
      title: title.trim(),
      amount: Number(amount),
      date: date || new Date().toISOString(),
      shopId: shopId || null,
    });

    await audit({
      action: 'expense_added',
      userId: null, username: null, role: null,
      targetType: 'expense', targetId: id,
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
    const expense = await Expense.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true });
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    return res.json(normalize(expense.toObject()));
  } catch (err) {
    console.error('[PUT /expenses/:id]', err);
    return res.status(500).json({ error: 'Failed to update expense' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const expense = await Expense.findByIdAndDelete(req.params.id);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });

    await audit({
      action: 'expense_deleted',
      userId: null, username: null, role: null,
      targetType: 'expense', targetId: req.params.id,
      details: `Deleted expense "${expense.title}"`,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /expenses/:id]', err);
    return res.status(500).json({ error: 'Failed to delete expense' });
  }
});

module.exports = router;
