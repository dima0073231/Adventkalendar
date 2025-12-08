// src/scripts/import_days.js
require('dotenv').config();
const connectDB = require('../db');
const Day = require('../models/Day');
const daysJson = require('../days.json');

async function importDays() {
  await connectDB();
  for (const k of Object.keys(daysJson)) {
    const d = daysJson[k];
    const doc = {
      day_number: Number(d.day_number || k),
      title: d.title,
      intro_text: d.intro_text,
      vocabulary: d.vocabulary || [],
      tasks: d.tasks || [],
      media: d.media || [],
      publish_date: d.publish_date ? new Date(d.publish_date) : undefined,
      draft: d.draft || false
    };
    await Day.updateOne({ day_number: doc.day_number }, { $set: doc }, { upsert: true });
    console.log('Imported day', doc.day_number);
  }
  process.exit(0);
}

importDays().catch(err => { console.error(err); process.exit(1); });
