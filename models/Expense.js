const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    title: { type: String, required: true, trim: true },
    amount: { type: Number, required: true },
    date: { type: String, required: true },
    shopId: { type: String, default: null },
    ownerAdminId: { type: String, default: null },
  },
  { _id: false, versionKey: false },
);

expenseSchema.virtual('id').get(function () { return this._id; });
expenseSchema.set('toJSON', { virtuals: true, transform: (_d, r) => { delete r.__v; return r; } });

module.exports = mongoose.model('Expense', expenseSchema, 'expenses');
