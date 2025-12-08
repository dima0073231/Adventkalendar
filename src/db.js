// src/db.js
require('dotenv').config();
const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.DATABASE_URL || process.env.MONGO_URI;
  if (!uri) {
    console.error('❌ No DATABASE_URL / MONGO_URI in .env');
    throw new Error('No DB URI');
  }
  try {
    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB Atlas');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message || err);
    throw err;
  }
}

module.exports = connectDB;
