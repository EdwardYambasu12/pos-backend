const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    createdAt: { type: String, required: true },
  },
  { _id: false, versionKey: false },
);

categorySchema.virtual('id').get(function () { return this._id; });
categorySchema.set('toJSON', { virtuals: true, transform: (_d, r) => { delete r.__v; return r; } });

module.exports = mongoose.model('Category', categorySchema, 'categories');
