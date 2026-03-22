/**
 * /api/categories
 *
 * GET    /      — list all categories      [any authenticated]
 * POST   /      — create category          [admin, manager]
 * PUT    /:id   — update category          [admin, manager]
 * DELETE /:id   — delete category          [admin]
 */

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');

const Category = require('../models/Category');


function normalize({ _id, ...rest }) { return { id: String(_id), ...rest }; }

router.get('/', async (req, res) => {
  try {
    const cats = await Category.find().lean();
    return res.json(cats.map(normalize));
  } catch {
    return res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  try {
    const id = uuidv4();
    const cat = await Category.create({
      _id: id,
      name: name.trim(),
      createdAt: new Date().toISOString(),
    });
    return res.status(201).json(normalize(cat.toObject()));
  } catch (err) {
    console.error('[POST /categories]', err);
    return res.status(500).json({ error: 'Failed to create category' });
  }
});

router.put('/:id', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  try {
    const cat = await Category.findByIdAndUpdate(req.params.id, { $set: { name: name.trim() } }, { new: true });
    if (!cat) return res.status(404).json({ error: 'Category not found' });
    return res.json(normalize(cat.toObject()));
  } catch (err) {
    console.error('[PUT /categories/:id]', err);
    return res.status(500).json({ error: 'Failed to update category' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const cat = await Category.findByIdAndDelete(req.params.id);
    if (!cat) return res.status(404).json({ error: 'Category not found' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /categories/:id]', err);
    return res.status(500).json({ error: 'Failed to delete category' });
  }
});

module.exports = router;
