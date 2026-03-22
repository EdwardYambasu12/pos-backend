const mongoose = require('mongoose');

const licenseSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    key: { type: String, required: true },
    tier: { type: String, enum: ['basic', 'standard', 'premium'], required: true },
    expiryDate: { type: String, required: true },
    activatedAt: { type: String, required: true },
    lastOpenedAt: { type: String, required: true },
    signature: { type: String, required: true },
  },
  { _id: false, versionKey: false },
);

licenseSchema.virtual('id').get(function () { return this._id; });
licenseSchema.set('toJSON', { virtuals: true, transform: (_d, r) => { delete r.__v; return r; } });

module.exports = mongoose.model('License', licenseSchema, 'license');
