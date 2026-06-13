const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    threadType: { type: String, enum: ['cashier', 'cashier_group', 'cashier_dm'], required: true },
    conversationId: { type: String, default: null },
    text: { type: String, required: true, trim: true },
    senderUserId: { type: String, required: true },
    senderName: { type: String, required: true },
    senderRole: { type: String, enum: ['admin', 'manager', 'cashier'], required: true },
    recipientUserId: { type: String, default: null },
    ownerAdminId: { type: String, default: null },
    shopId: { type: String, default: null },
    createdAt: { type: String, required: true },
  },
  { _id: false, versionKey: false },
);

chatMessageSchema.index({ ownerAdminId: 1, shopId: 1, threadType: 1, createdAt: -1 });
chatMessageSchema.index({ conversationId: 1, createdAt: 1 });

chatMessageSchema.virtual('id').get(function () {
  return this._id;
});

chatMessageSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('ChatMessage', chatMessageSchema, 'chat_messages');
