const mongoose = require('mongoose');

const saleItemSchema = new mongoose.Schema(
  {
    productId: String,
    productName: String,
    quantity: Number,
    costPrice: Number,
    sellingPrice: Number,
    discounted: Boolean,
    originalCurrency: { type: String, enum: ['USD', 'LRD'], default: null },
    convertedSellingPrice: { type: Number, default: null },
    convertedCostPrice: { type: Number, default: null },
  },
  { _id: false },
);

const salePaymentSchema = new mongoose.Schema(
  {
    method: { type: String, enum: ['cash', 'card', 'mobile_money'], required: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const saleSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    items: [saleItemSchema],
    payments: { type: [salePaymentSchema], default: [] },
    changeDue: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },
    totalProfit: { type: Number, required: true },
    date: { type: String, required: true },
    shopId: { type: String, default: null },
    ownerAdminId: { type: String, default: null },
    currency: { type: String, default: null },
    idempotencyKey: { type: String, default: null },
  },
  { _id: false, versionKey: false },
);

// Sparse unique index so duplicate requests with the same key are rejected at the DB level
saleSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

saleSchema.virtual('id').get(function () { return this._id; });
saleSchema.set('toJSON', { virtuals: true, transform: (_d, r) => { delete r.__v; return r; } });

module.exports = mongoose.model('Sale', saleSchema, 'sales');
