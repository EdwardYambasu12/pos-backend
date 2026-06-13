const mongoose = require('mongoose');

const chatReadStateSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true },
    conversationId: { type: String, required: true },
    lastReadAt: { type: String, required: true },
    ownerAdminId: { type: String, default: null },
    shopId: { type: String, default: null },
  },
  { _id: false, versionKey: false },
);

chatReadStateSchema.index({ userId: 1, conversationId: 1 }, { unique: true });
chatReadStateSchema.index({ ownerAdminId: 1, shopId: 1, userId: 1 });

chatReadStateSchema.virtual('id').get(function () {
  return this._id;
});

chatReadStateSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('ChatReadState', chatReadStateSchema, 'chat_read_states');
