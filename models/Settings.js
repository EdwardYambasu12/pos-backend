const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    key: { type: String, required: true, unique: true, trim: true },
    value: { type: String, required: true },
  },
  { _id: false, versionKey: false },
);

settingsSchema.virtual('id').get(function () { return this._id; });
settingsSchema.set('toJSON', { virtuals: true, transform: (_d, r) => { delete r.__v; return r; } });

module.exports = mongoose.model('Settings', settingsSchema, 'settings');
