const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    action: { type: String, required: true },
    userId: { type: String, required: true },
    username: { type: String, required: true },
    role: { type: String, enum: ['admin', 'manager', 'cashier'], required: true },
    ownerAdminId: { type: String, default: null },
    targetType: { type: String, default: null },
    targetId: { type: String, default: null },
    details: { type: String, required: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
    timestamp: { type: String, required: true },
  },
  { _id: false, versionKey: false },
);

auditLogSchema.virtual('id').get(function () { return this._id; });
auditLogSchema.set('toJSON', { virtuals: true, transform: (_d, r) => { delete r.__v; return r; } });

module.exports = mongoose.model('AuditLog', auditLogSchema, 'auditLogs');
