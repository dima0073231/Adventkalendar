require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Telegraf, Markup } = require('telegraf');
const connectDB = require('./db');
const User = require('./models/User');
const Day = require('./models/Day');
const UserProgress = require('./models/UserProgress');
const daysJson = require('./days.json');

const bot = new Telegraf(process.env.BOT_TOKEN);

// ==================== ACCESS CONTROL ====================
const ALLOWED_FILE = path.join(__dirname, 'allowed.json');

if (!fs.existsSync(ALLOWED_FILE)) {
  fs.writeFileSync(ALLOWED_FILE, JSON.stringify({ allowed: [] }, null, 2), 'utf8');
}

function loadAllowed() {
  try {
    const data = JSON.parse(fs.readFileSync(ALLOWED_FILE, 'utf8'));
    return data.allowed.map(u => u.toLowerCase());
  } catch {
    return [];
  }
}

function saveAllowed(list) {
  fs.writeFileSync(ALLOWED_FILE, JSON.stringify({ allowed: list }, null, 2), 'utf8');
}

const adminIds = (process.env.ADMIN_IDS || '')
  .split(',')
  .map(id => parseInt(id.trim(), 10))
  .filter(Boolean);

bot.use(async (ctx, next) => {
  const user = ctx.from;
  if (!user) return;

  const username = user.username ? user.username.toLowerCase() : null;
  const isAdmin = adminIds.includes(user.id);
  const allowedUsernames = loadAllowed();
  const isAllowed = username && allowedUsernames.includes(username);

  if (isAdmin || isAllowed) {
    return next();
  }

  try {
    await ctx.reply('🚫 У вас немає доступу до цього бота. Зверніться до адміністратора.');
  } catch (err) {
    console.error('Access deny error:', err);
  }
});

// ==================== CONNECT TO DB ====================
connectDB().catch(err => {
  console.error('DB connection failed, exiting', err);
  process.exit(1);
});

// ==================== HELPERS ====================
async function ensureUser(ctx) {
  const tg = ctx.from;
  let user = await User.findOne({ telegram_id: tg.id });
  if (!user) {
    user = await User.create({
      telegram_id: tg.id,
      username: tg.username,
      first_name: tg.first_name,
      language: tg.language_code || 'de'
    });
  }
  return user;
}

async function canOpenDay(userDoc, dayNumber) {
  if (dayNumber === 1) return true;

  const prev = await UserProgress.findOne({
    user: userDoc._id,
    day_number: dayNumber - 1
  });
  if (prev) return true;

  const dayDoc = await Day.findOne({ day_number: dayNumber });
  if (dayDoc && dayDoc.publish_date) {
    return new Date(dayDoc.publish_date) <= new Date();
  }

  return false;
}

// ==================== ADMIN COMMANDS ====================
bot.command('adduser', async (ctx) => {
  const user = ctx.from;
  if (!adminIds.includes(user.id)) {
    return ctx.reply('❌ Тільки адміністратор може додавати користувачів.');
  }

  const args = ctx.message.text.split(' ').slice(1);
  if (!args.length) {
    return ctx.reply('📝 Використання: /adduser @username');
  }

  const username = args[0].replace('@', '').toLowerCase();
  if (!username) {
    return ctx.reply('❌ Невірний username.');
  }

  const allowed = loadAllowed();
  if (allowed.includes(username)) {
    return ctx.reply(`⚠️ @${username} вже у списку.`);
  }

  allowed.push(username);
  saveAllowed(allowed);
  await ctx.reply(`✅ Користувач @${username} доданий.`);
});

// ==================== START ====================
bot.start(async (ctx) => {
  await ensureUser(ctx);

  const welcomeText = `🎄 Willkommen beim Adventskalender Deutsch! 🎅
24 Tage voller Wörter, Aufgaben und Weihnachtsfreude!

👇 Drück auf den Knopf, um Tag 1 zu öffnen!`;

  const dayButtons = [];
  for (let i = 1; i <= 24; i++) {
    if ((i - 1) % 4 === 0) dayButtons.push([]);
    dayButtons[dayButtons.length - 1].push(
      Markup.button.callback(`🚪 Tag ${i}`, `open_${i}`)
    );
  }

  await ctx.replyWithMarkdown(
    welcomeText,
    Markup.inlineKeyboard(dayButtons)
  );
});

// ==================== OPEN DAY ====================
bot.action(/open_(\d+)/, async (ctx) => {
  const dayNumber = Number(ctx.match[1]);
  await ctx.answerCbQuery().catch(() => {});

  const user = await ensureUser(ctx);
  const existingProgress = await UserProgress.findOne({
    user: user._id,
    day_number: dayNumber
  });

  const allowed = existingProgress || await canOpenDay(user, dayNumber);
  if (!allowed) {
    return ctx.reply('Dieser Tag ist noch gesperrt.');
  }

  if (!existingProgress) {
    await UserProgress.create({
      user: user._id,
      day_number: dayNumber
    });
  }

  const day = daysJson[String(dayNumber)];
  if (!day) {
    return ctx.reply('Контент не знайдено.');
  }

  const sections = day.sections || {};

  // ---------- SPECIAL DAY 1 ----------
  if (dayNumber === 1) {
    if (day.image_path) {
      const imgPath = path.join(__dirname, day.image_path);
      if (fs.existsSync(imgPath)) {
        await ctx.replyWithPhoto({ source: imgPath }).catch(console.error);
      }
    }

    const main = sections.main;
    if (main) {
      await ctx.replyWithMarkdown(`*${main.title}*\n\n${main.text}`);
    }

    await ctx.reply(
      '👇 Wähle weiter:',
      Markup.inlineKeyboard([
        [Markup.button.callback('💡 Vokabeln', 'day_1_vocab')],
        [Markup.button.callback('📘 Leseverstehen', 'day_1_reading')],
        [Markup.button.callback('👉 Weiter zu Tag 2', 'open_2')]
      ])
    );

    return;
  }

  // ---------- SPECIAL DAY 2 ----------
  if (dayNumber === 2) {
    const main = sections.main;
    if (main) {
      await ctx.replyWithMarkdown(`*${main.title}*\n\n${main.text}`);
    }

    await ctx.reply(
      '👇 Wähle weiter:',
      Markup.inlineKeyboard([
        [Markup.button.callback('Übersetzungen', 'day_2_vocab')],
        [Markup.button.callback('💡 Empfohlene Lösungen', 'day_2_reading')],
        [Markup.button.callback('👉 Weiter zu Tag 3', 'open_3')]
      ])
    );

    return;
  }
// SPECIAL DAY 3 — два видео подряд
if (dayNumber === 3) {
  const main = day.sections.main;

  // 1️⃣ Видео №1
  if (day.video_path) {
    const video1 = path.join(__dirname, day.video_path);
    if (fs.existsSync(video1)) {
      await ctx.replyWithVideo({ source: video1 });
    }
  }

  // 2️⃣ Видео №2
  if (day.video_path_2) {
    const video2 = path.join(__dirname, day.video_path_2);
    if (fs.existsSync(video2)) {
      await ctx.replyWithVideo({ source: video2 });
    }
  }

  // 3️⃣ Основной текст после двух видео
  await ctx.replyWithMarkdown(`*${main.title}*\n\n${main.text}`);

  // 4️⃣ Кнопки
  await ctx.reply(
    '👇 Zur Übung:',
    Markup.inlineKeyboard([
      [Markup.button.callback('🧩 Übung', 'day_3_exercise')],
      [Markup.button.callback('👉 Weiter zu Tag 4', 'open_4')]
    ])
  );

  return;
}




  // ---------- SPECIAL DAY 4 ----------
  if (dayNumber === 4) {
    const main = sections.main;

    if (main) {
      await ctx.replyWithMarkdown(
        `*🎄 TAG 4*\n\n*${main.title}*\n\n${main.text}`
      );
    }

    await ctx.reply(
      '👇 Wähle Vokabeln:',
      Markup.inlineKeyboard([
        [Markup.button.callback('🪵 Teile des Baumes', 'day_4_vocab_parts')],
        [Markup.button.callback('🛍️ Beim Kauf', 'day_4_vocab_buy')],
        [Markup.button.callback('💡 Verben', 'day_4_vocab_verbs')],
        [Markup.button.callback('👉 Weiter zu Tag 5', 'open_5')]
      ])
    );

    return;
  }

  // ---------- SPECIAL DAY 5 ----------
  if (dayNumber === 5) {
    const main = sections.main;

    if (main) {
      await ctx.replyWithMarkdown(
        `*🎄 TAG 5*\n\n*${main.title}*\n\n${main.text}`
      );
    }

    await ctx.reply(
      '👇 Wähle weiter:',
      Markup.inlineKeyboard([
        [Markup.button.callback('📚 Vokabeln', 'day_5_vocab')],
        [Markup.button.callback('👉 Weiter zu Tag 6', 'open_6')]
      ])
    );

    return;
  }

  // ---------- SPECIAL DAY 6 ----------
  if (dayNumber === 6) {
    const main = sections.main;

    if (main) {
      await ctx.replyWithMarkdown(
        `*🎄 TAG 6*\n\n*${main.title}*\n\n${main.text}`
      );
    }

    await ctx.reply(
      '👇 Wähle weiter:',
      Markup.inlineKeyboard([
        [Markup.button.callback('🎅🏼 Text', 'day_6_text')],
        [Markup.button.callback('📚 Wortschatz', 'day_6_vocab')],
        [Markup.button.callback('📖 Leseverstehen', 'day_6_reading')],
        [Markup.button.callback('👉 Weiter zu Tag 7', 'open_7')]
      ])
    );

    return;
  }

  // ---------- SPECIAL DAY 7 ----------
  if (dayNumber === 7) {
    const main = sections.main;

    if (main) {
      await ctx.replyWithMarkdown(
        `*🎄 TAG 7*\n\n*${main.title}*\n\n${main.text}`
      );
    }

    await ctx.reply(
      '👇 Wähle weiter:',
      Markup.inlineKeyboard([
        [Markup.button.callback('📝 Übung', 'day_7_vocab')],
        [Markup.button.callback('💡 Empfohlene Übersetzungen', 'day_7_reading')],
        [Markup.button.callback('👉 Weiter zu Tag 8', 'open_8')]
      ])
    );

    return;
  }

  // ---------- SPECIAL DAY 8 ----------
  if (dayNumber === 8) {
    const main = sections.main;

    if (main) {
      await ctx.replyWithMarkdown(
        `*🎄 TAG 8*\n\n*${main.title}*\n\n${main.text}`
      );
    }

    await ctx.reply(
      '👇 Wähle weiter:',
      Markup.inlineKeyboard([
        [Markup.button.callback('📝 Übung', 'day_8_vocab')],
        [Markup.button.callback('👉 Weiter zu Tag 9', 'open_9')]
      ])
    );

    return;
  }

  // ---------- SPECIAL DAY 10 ----------
  if (dayNumber === 10) {
    const main = sections.main;

    if (main) {
      await ctx.replyWithMarkdown(
        `*🎄 TAG 10*\n\n*${main.title}*\n\n${main.text}`
      );
    }

    await ctx.reply(
      '👇 Wähle weiter:',
      Markup.inlineKeyboard([
        [Markup.button.callback('📝 Übung', 'day_10_vocab')],
        [Markup.button.callback('💡 Lösungen', 'day_10_reading')],
        [Markup.button.callback('👉 Weiter zu Tag 11', 'open_11')]
      ])
    );

    return;
  }

  // ---------- SPECIAL DAY 11 ----------
  if (dayNumber === 11) {
    const main = sections.main;

    if (main) {
      await ctx.replyWithMarkdown(
        `*🎄 TAG 11*\n\n*${main.title}*\n\n${main.text}`
      );
    }

    await ctx.reply(
      '👇 Wähle weiter:',
      Markup.inlineKeyboard([
        [Markup.button.callback('📝 Bucket-Liste', 'day_11_vocab')],
        [Markup.button.callback('👉 Weiter zu Tag 12', 'open_12')]
      ])
    );

    return;
  }

  // ---------- DEFAULT FOR OTHER DAYS ----------
  const main = sections.main;
  if (main) {
    await ctx.replyWithMarkdown(
      `*TAG ${dayNumber} – ${main.title || day.title || ''}*\n\n${main.text || ''}`
    );
  } else if (day.title) {
    await ctx.replyWithMarkdown(`*TAG ${dayNumber}*\n\n${day.title}`);
  }

  const buttons = [];

  if (sections.main && sections.main.text) {
    buttons.push([Markup.button.callback('📜 Text des Tages', `day_${dayNumber}_main`)]);
  }
  if (sections.vocab) {
    buttons.push([Markup.button.callback('💡 Vokabeln', `day_${dayNumber}_vocab`)]);
  }
  if (sections.reading) {
    buttons.push([Markup.button.callback('📘 Leseverstehen', `day_${dayNumber}_reading`)]);
  }
  if (dayNumber < 24) {
    buttons.push([
      Markup.button.callback(`👉 Weiter zu Tag ${dayNumber + 1}`, `open_${dayNumber + 1}`)
    ]);
  }

  if (buttons.length) {
    await ctx.reply('👇 Wähle weiter:', Markup.inlineKeyboard(buttons));
  }
});

// ==================== DAY 1 HANDLERS ====================
bot.action('day_1_vocab', async (ctx) => {
  const sec = daysJson["1"].sections.vocab;
  await ctx.answerCbQuery().catch(() => {});
  await ctx.replyWithMarkdown(`*${sec.title}*\n\n${sec.text}`);
});

bot.action('day_1_reading', async (ctx) => {
  const reading = daysJson["1"].sections.reading;

  await ctx.answerCbQuery().catch(() => {});

  await ctx.reply(
    `📘 *Leseverstehen – Tag 1*\n\n${reading.intro}`,
    { parse_mode: 'Markdown' }
  );

  for (let i = 0; i < reading.questions.length; i++) {
    const q = reading.questions[i];

    await ctx.reply(
      `*${i + 1}. ${q.q}*`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: q.options.map((opt, idx) => [
            { text: opt, callback_data: `q1_${i}_${idx}` }
          ])
        }
      }
    );
  }
});

bot.action(/q1_(\d+)_(\d+)/, async (ctx) => {
  const qIndex = Number(ctx.match[1]);
  const optionIndex = Number(ctx.match[2]);

  const questions = daysJson["1"].sections.reading.questions;
  const question = questions[qIndex];

  if (!question) {
    return ctx.answerCbQuery('Fehler.', { show_alert: true }).catch(() => {});
  }

  if (optionIndex === question.correct) {
    return ctx.answerCbQuery('✅ Правильно!', { show_alert: true }).catch(() => {});
  }

  const explanation = question.explanation || '';
  return ctx.answerCbQuery(
    `❌ Неправильно!\n${explanation}`,
    { show_alert: true }
  ).catch(() => {});
});

// ==================== DAY 2 HANDLERS ====================
bot.action('day_2_vocab', async (ctx) => {
  const sec = daysJson["2"].sections.vocab;
  await ctx.answerCbQuery().catch(() => {});
  await ctx.replyWithMarkdown(`*${sec.title}*\n\n${sec.text}`);
});

bot.action('day_2_reading', async (ctx) => {
  const sec = daysJson["2"].sections.reading;
  await ctx.answerCbQuery().catch(() => {});
  await ctx.replyWithMarkdown(`*${sec.title}*\n\n${sec.text}`);
});

// ==================== DAY 3 HANDLERS ====================
bot.action('day_3_exercise', async (ctx) => {
  const sec = daysJson["3"].sections.exercise;

  await ctx.answerCbQuery().catch(() => {});
  await ctx.replyWithMarkdown(`*${sec.title}*\n\n${sec.intro}`);

  // Генерация вопросов
  for (let i = 0; i < sec.items.length; i++) {
    const item = sec.items[i];

    await ctx.reply(
      `*${i + 1}. ${item}*`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: "auf", callback_data: `q3_${i}_auf` },
              { text: "über", callback_data: `q3_${i}_über` }
            ]
          ]
        }
      }
    );
  }
});

bot.action(/q3_(\d+)_(auf|über)/, async (ctx) => {
  const qIndex = Number(ctx.match[1]);
  const userAnswer = ctx.match[2]; // 'auf' или 'über'

  const correct = daysJson["3"].sections.exercise.solutions[qIndex];

  if (!correct) {
    return ctx.answerCbQuery("Ошибка данных.", { show_alert: true });
  }

  if (userAnswer === correct) {
    return ctx.answerCbQuery("✅ Правильно!", { show_alert: true });
  }

  return ctx.answerCbQuery(
    `❌ Неправильно!\nПравильный ответ: *${correct}*`,
    { show_alert: true }
  );
});


// ==================== DAY 4 HANDLERS ====================
bot.action('day_4_vocab_parts', async (ctx) => {
  const sec = daysJson["4"].sections.vocab_parts;
  await ctx.answerCbQuery().catch(() => {});
  await ctx.replyWithMarkdown(`*${sec.title}*\n\n${sec.text}`);
});

bot.action('day_4_vocab_buy', async (ctx) => {
  const sec = daysJson["4"].sections.vocab_buy;
  await ctx.answerCbQuery().catch(() => {});
  await ctx.replyWithMarkdown(`*${sec.title}*\n\n${sec.text}`);
});

bot.action('day_4_vocab_verbs', async (ctx) => {
  const sec = daysJson["4"].sections.vocab_verbs;
  await ctx.answerCbQuery().catch(() => {});
  await ctx.replyWithMarkdown(`*${sec.title}*\n\n${sec.text}`);
});

// ==================== DAY 5 HANDLERS ====================
bot.action('day_5_vocab', async (ctx) => {
  const sec = daysJson["5"].sections.vocab;
  await ctx.answerCbQuery().catch(() => {});
  await ctx.replyWithMarkdown(`*${sec.title}*\n\n${sec.text}`);
});

// ==================== DAY 6 HANDLERS ====================
bot.action('day_6_text', async (ctx) => {
  const sec = daysJson["6"].sections.text;
  await ctx.answerCbQuery().catch(() => {});
  await ctx.replyWithMarkdown(`*${sec.title}*\n\n${sec.text}`);
});

bot.action('day_6_vocab', async (ctx) => {
  const sec = daysJson["6"].sections.vocab;
  await ctx.answerCbQuery().catch(() => {});
  await ctx.replyWithMarkdown(`*${sec.title}*\n\n${sec.text}`);
});

bot.action('day_6_reading', async (ctx) => {
  const sec = daysJson["6"].sections.reading;

  await ctx.answerCbQuery().catch(() => {});

  await ctx.replyWithMarkdown(`*${sec.title}*\n\n${sec.intro}`);

  for (let i = 0; i < sec.questions.length; i++) {
    const q = sec.questions[i];
    const buttons = q.options.map((opt, idx) =>
      Markup.button.callback(opt, `q6_${i}_${idx}`)
    );

    await ctx.reply(
      `*${i + 1}. ${q.q}*`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([buttons])
      }
    );
  }
});

bot.action(/q6_(\d+)_(\d+)/, async (ctx) => {
  const qIndex = Number(ctx.match[1]);
  const optionIndex = Number(ctx.match[2]);
  const questions = daysJson["6"].sections.reading.questions;
  const question = questions[qIndex];

  if (!question) {
    return ctx.answerCbQuery('Fehler.', { show_alert: true }).catch(() => {});
  }

  if (optionIndex === question.correct) {
    await ctx.answerCbQuery('✅ Richtig!', { show_alert: true }).catch(() => {});
  } else {
    await ctx.answerCbQuery('❌ Falsch! Versuch es nochmal!', { show_alert: true }).catch(() => {});
  }
});

// ==================== DAY 7 HANDLERS ====================
bot.action('day_7_vocab', async (ctx) => {
  const sec = daysJson["7"].sections.vocab;
  await ctx.answerCbQuery().catch(() => {});
  await ctx.replyWithMarkdown(`*${sec.title}*\n\n${sec.text}`);
});

bot.action('day_7_reading', async (ctx) => {
  const sec = daysJson["7"].sections.reading;
  await ctx.answerCbQuery().catch(() => {});
  await ctx.replyWithMarkdown(`*${sec.title}*\n\n${sec.text}`);
});

// ==================== DAY 8 HANDLERS (TEST) ====================
bot.action('day_8_vocab', async (ctx) => {
  const sec = daysJson["8"].sections.vocab;

  await ctx.answerCbQuery().catch(() => {});

  await ctx.replyWithMarkdown(`*${sec.title}*\n\n${sec.intro}`);

  for (let i = 0; i < sec.questions.length; i++) {
    const q = sec.questions[i];

    const buttons = q.options.map((opt, idx) =>
      Markup.button.callback(opt, `q8_${i}_${idx}`)
    );

    await ctx.reply(
      `*${i + 1}. ${q.q}*`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([buttons])
      }
    );
  }
});

bot.action(/q8_(\d+)_(\d+)/, async (ctx) => {
  const qIndex = Number(ctx.match[1]);
  const optionIndex = Number(ctx.match[2]);

  const questions = daysJson["8"].sections.vocab.questions;
  const question = questions[qIndex];

  if (!question) {
    return ctx.answerCbQuery('Fehler.', { show_alert: true }).catch(() => {});
  }

  if (optionIndex === question.correct) {
    return ctx.answerCbQuery('✅ Правильно!', { show_alert: true }).catch(() => {});
  }

  const explanation = question.explanation || '';
  return ctx.answerCbQuery(
    `❌ Неправильно!\n${explanation}`,
    { show_alert: true }
  ).catch(() => {});
});

// ==================== DAY 10 HANDLERS ====================
bot.action('day_10_vocab', async (ctx) => {
  const sec = daysJson["10"].sections.vocab;
  await ctx.answerCbQuery().catch(() => {});
  await ctx.replyWithMarkdown(`*${sec.title}*\n\n${sec.text}`);
});

bot.action('day_10_reading', async (ctx) => {
  const sec = daysJson["10"].sections.reading;
  await ctx.answerCbQuery().catch(() => {});
  await ctx.replyWithMarkdown(`*${sec.title}*\n\n${sec.text}`);
});

// ==================== DAY 11 HANDLERS ====================
bot.action('day_11_vocab', async (ctx) => {
  const sec = daysJson["11"].sections.vocab;
  await ctx.answerCbQuery().catch(() => {});

  await ctx.replyWithMarkdown(`*${sec.title}*\n\n${sec.text}`);

  const filePath = path.join(__dirname, sec.file_path);
  if (fs.existsSync(filePath)) {
    await ctx.replyWithPhoto({ source: filePath }).catch(console.error);
  } else {
    await ctx.reply('⚠️ Fehler: Datei nicht gefunden.');
  }
});

// ==================== GENERIC SECTIONS (FALLBACK) ====================
bot.action(/day_(\d+)_(main|vocab)$/, async (ctx) => {
  const dayNumber = Number(ctx.match[1]);
  const section = ctx.match[2];

  // НЕ ловимо exercise
  if (section === "exercise") return;

  const day = daysJson[String(dayNumber)];
  const sec = day.sections[section];

  let msg = "";

  if (section === "main") {
    msg = sec.text;
  } else if (section === "vocab") {
    msg = `*${sec.title}*\n\n${sec.text}`;
  }

  await ctx.replyWithMarkdown(msg);
  await ctx.answerCbQuery();
});


// ==================== PROGRESS ====================
bot.action('progress', async (ctx) => {
  const user = await User.findOne({ telegram_id: ctx.from.id });
  if (!user) {
    await ctx.answerCbQuery().catch(() => {});
    return;
  }

  const progress = await UserProgress.find({ user: user._id }).sort('day_number');
  const opened = new Set(progress.map(p => p.day_number));

  let text = '📘 Dein Fortschritt:\n\n';
  for (let i = 1; i <= 24; i++) {
    text += opened.has(i) ? `✅ Tag ${i}\n` : `❌ Tag ${i}\n`;
  }

  await ctx.reply(text);
  await ctx.answerCbQuery().catch(() => {});
});

// ==================== HELP ====================
bot.action('help', async (ctx) => {
  await ctx.reply('📋 Hilfe:\n\nBei Fragen: @your_support_username');
  await ctx.answerCbQuery().catch(() => {});
});

// ==================== LAUNCH ====================
if (require.main === module) {
  bot.launch()
    .then(() => console.log('Bot launched'))
    .catch(console.error);
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
