// src/models/UserProgress.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const UserProgressSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  day_number: { type: Number, required: true },
  opened_at: { type: Date, default: Date.now },
  completed: { type: Boolean, default: false },
  answers: { type: Object, default: {} }
});

// ensure unique per user & day
UserProgressSchema.index({ user: 1, day_number: 1 }, { unique: true });

module.exports = mongoose.model('UserProgress', UserProgressSchema);
