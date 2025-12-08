// src/models/User.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const UserSchema = new Schema({
  telegram_id: { type: Number, required: true, unique: true },
  username: String,
  first_name: String,
  language: { type: String, default: 'de' },
  activated_at: Date,
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
