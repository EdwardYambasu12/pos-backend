const mongoose = require('mongoose');

const shopSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    logoUrl: { type: String, default: null },
    address: { type: String, default: null },
    phone: { type: String, default: null },
    createdAt: { type: String, required: true },
    createdBy: { type: String, required: true },
    ownerAdminId: { type: String, default: null },
  },
  { _id: false, versionKey: false },
);

shopSchema.virtual('id').get(function () { return this._id; });
shopSchema.set('toJSON', { virtuals: true, transform: (_d, r) => { delete r.__v; return r; } });

module.exports = mongoose.model('Shop', shopSchema, 'shops');
