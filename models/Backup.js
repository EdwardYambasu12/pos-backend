const mongoose = require('mongoose');

const backupSchema = new mongoose.Schema(
  {
    // Use timestamp-based ID for backups
    _id: { type: String, required: true },
    timestamp: { type: String, required: true },
    data: { type: String, required: true }, // JSON string containing all database data
    version: { type: String, required: true }, // App version or schema version
    size: { type: Number, required: true }, // Size of the JSON data in bytes
    userId: { type: String, required: true }, // User who created the backup
    device: { type: String, default: '' }, // Device/browser info
    ownerAdminId: { type: String, default: null },
  },
  { _id: false, versionKey: false },
);

// Virtual "id" field that returns the _id so frontend compatibility is maintained
backupSchema.virtual('id').get(function () {
  return this._id;
});

backupSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

// Index for efficient queries
backupSchema.index({ ownerAdminId: 1, timestamp: -1 });
backupSchema.index({ userId: 1, timestamp: -1 });

module.exports = mongoose.model('Backup', backupSchema, 'backups');