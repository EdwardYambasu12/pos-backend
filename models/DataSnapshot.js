const mongoose = require('mongoose');

const dataSnapshotSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    timestamp: { type: String, required: true },
    version: { type: String, required: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { _id: false, versionKey: false },
);

// Virtual `id` field for compatibility with frontend conventions.
dataSnapshotSchema.virtual('id').get(function () {
  return this._id;
});

dataSnapshotSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

dataSnapshotSchema.index({ timestamp: -1 });

module.exports = mongoose.model('DataSnapshot', dataSnapshotSchema, 'data_snapshots');
