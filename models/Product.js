const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    barcode: { type: String, trim: true, default: null },
    costPrice: { type: Number, required: true },
    sellingPrice: { type: Number, required: true },
    discountPrice: { type: Number, default: null },
    quantity: { type: Number, required: true, default: 0 },
    category: { type: String, default: null },
    categoryId: { type: String, default: null },
    expiryDate: { type: String, default: null },
    currency: { type: String, enum: ['USD', 'LRD', null], default: null },
    shopId: { type: String, default: null },
    ownerAdminId: { type: String, default: null },
    createdAt: { type: String, required: true },
    imageUrl: { type: String, default: null },
  },
  { _id: false, versionKey: false },
);

// Enforce barcode uniqueness per shop when barcode is present.
productSchema.index(
  { shopId: 1, barcode: 1 },
  { unique: true, sparse: true, partialFilterExpression: { barcode: { $type: 'string' } } },
);

productSchema.virtual('id').get(function () { return this._id; });
productSchema.set('toJSON', { virtuals: true, transform: (_d, r) => { delete r.__v; return r; } });

module.exports = mongoose.model('Product', productSchema, 'products');
