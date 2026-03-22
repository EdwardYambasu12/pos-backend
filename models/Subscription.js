const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
  {
    // Using a string id for sync compatibility
    _id: { type: String, required: true },
    planType: { type: String, enum: ['basic', 'standard', 'premium'], required: true },
    status: { type: String, enum: ['trial', 'active', 'expired'], required: true },
    expiryDate: { type: String, required: true },
    trialStartDate: { type: String, default: null },
    activatedAt: { type: String, required: true },
    lastOpenedAt: { type: String, required: true },
  },
  { _id: false, versionKey: false },
);

subscriptionSchema.virtual('id').get(function () { return this._id; });
subscriptionSchema.set('toJSON', { virtuals: true, transform: (_d, r) => { delete r.__v; return r; } });

module.exports = mongoose.model('Subscription', subscriptionSchema, 'subscriptions');
