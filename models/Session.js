const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true },
    username: { type: String, required: true },
    role: { type: String, enum: ['admin', 'manager', 'cashier'], required: true },
    loginTime: { type: String, required: true },
    logoutTime: { type: String, default: null },
    logoutType: { type: String, enum: ['manual', 'forced', 'timeout', null], default: null },
    device: { type: String, default: 'Unknown' },
    failed: { type: Boolean, default: false },
    ownerAdminId: { type: String, default: null },
  },
  { _id: false, versionKey: false },
);

sessionSchema.virtual('id').get(function () { return this._id; });
sessionSchema.set('toJSON', { virtuals: true, transform: (_d, r) => { delete r.__v; return r; } });

module.exports = mongoose.model('Session', sessionSchema, 'sessions');
