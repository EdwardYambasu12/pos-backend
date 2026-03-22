const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    // Use the frontend's UUID as _id so sync IDs match
    _id: { type: String, required: true },
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    displayName: { type: String, required: true, trim: true },
    pin: { type: String, required: true }, // SHA-256 hex
    role: { type: String, enum: ['admin', 'manager', 'cashier'], required: true },
    active: { type: Boolean, default: true },
    createdBy: { type: String, default: null },
    shopId: { type: String, default: null },
    ownerAdminId: { type: String, default: null },
    createdAt: { type: String, required: true },
  },
  { _id: false, versionKey: false },
);

// Virtual "id" field that returns the _id so frontend compatibility is maintained
userSchema.virtual('id').get(function () {
  return this._id;
});

userSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema, 'clients');
