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

const saleSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    items: [saleItemSchema],
    totalAmount: { type: Number, required: true },
    totalProfit: { type: Number, required: true },
    date: { type: String, required: true },
    shopId: { type: String, default: null },
    ownerAdminId: { type: String, default: null },
    currency: { type: String, default: null },
  },
  { _id: false, versionKey: false },
);

saleSchema.virtual('id').get(function () { return this._id; });
saleSchema.set('toJSON', { virtuals: true, transform: (_d, r) => { delete r.__v; return r; } });

module.exports = mongoose.model('Sale', saleSchema, 'sales');
