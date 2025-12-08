// src/models/Day.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const DaySchema = new Schema({
  day_number: { type: Number, required: true, unique: true },
  title: String,
  intro_text: String,
  vocabulary: { type: Array, default: [] }, // [{de, ru}, ...]
  tasks: { type: Array, default: [] },
  media: { type: Array, default: [] }, // [{type, url, file_id}]
  publish_date: Date,
  draft: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Day', DaySchema);
