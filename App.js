/*
 * app.js - Epic7 Build Analyzer Discord Bot
 * All-in-one: Express server + SQLite + OCR + Epic7DB + Discord
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const Tesseract = require('tesseract.js');
const sqlite3 = require('sqlite3').verbose();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const FormData = require('form-data');

// ================== CONFIG ==================
const PORT = process.env.PORT || 3000;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN || null;
const EPIC7DB_API = process.env.EPIC7DB_API || 'https://api.epic7db.com';
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'db.sqlite');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ================== SQLITE INIT ==================
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('DB open error:', err.message);
});

db.exec(`
CREATE TABLE IF NOT EXISTS builds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hero_name TEXT NOT NULL,
  role TEXT,
  set_recomendado TEXT,
  substats TEXT,
  arma_recomendada TEXT,
  notas TEXT,
  UNIQUE(hero_name, set_recomendado)
);
`, () => {
  db.get('SELECT COUNT(*) AS c FROM builds', (err, row) => {
    if (!err && row.c === 0) {
      const insert = db.prepare(`INSERT INTO builds (hero_name, role, set_recomendado, substats, arma_recomendada, notas) VALUES (?,?,?,?,?,?)`);
      const seeds = [
        ['Arbiter Vildred', 'DPS', 'Speed / Crit dmg', 'Speed > Crit Rate > Crit Damage', "Kise's Blade", 'Meta DPS build focused on speed and crit.'],
        ['Angelica', 'Healer', 'Speed / Lifesteal', 'Speed > HP > RES', 'Staff of Healing', 'Support build with sustain.'],
        ['Seaside Bellona', 'DPS', 'ATK / Crit dmg', 'ATK > Crit Damage > Crit Rate', "Bellona's Spear", 'High ATK and Crit Damage DPS.']
      ];
      seeds.forEach(s => insert.run(s));
      insert.finalize();
      console.log('DB seeded.');
    }
  });
});

// ================== UTIL: EPIC7DB SEARCH ==================
async function searchHeroByName(name) {
  try {
    const res = await axios.get(`${EPIC7DB_API}/hero?name=${encodeURIComponent(name)}`, { timeout: 8000 });
    if (Array.isArray(res.data) && res.data.length) return res.data[0];
    if (res.data.results && res.data.results.length) return res.data.results[0];
    if (res.data.name) return res.data;
  } catch {}
  return null;
}

// ================== OCR ==================
async function runOCR(filePath) {
  try {
    const { data: { text } } = await Tesseract.recognize(filePath, 'eng', { logger: m => {} });
    return text || '';
  } catch (err) {
    console.error('OCR error:', err.message);
    return '';
  }
}

// ================== HEURISTICS ==================
function heuristicsExtract(ocrText) {
  const t = (ocrText || '').toUpperCase();
  const stats = {};
  const spd = t.match(/SPD[\s:]*([0-9]{2,3})/i);
  if (spd) stats.spd = parseInt(spd[1], 10);
  const atk = t.match(/ATK[\s:]*([0-9]{3,5})/i);
  if (atk) stats.atk = parseInt(atk[1], 10);
  const crit = t.match(/CRIT(?: RATE)?[\s:]*([0-9]{2,3})/i);
  if (crit) stats.crit = parseInt(crit[1], 10);
  const critd = t.match(/CRIT(?: DMG| DAMAGE)[\s:]*([0-9]{2,3})/i);
  if (critd) stats.critdmg = parseInt(critd[1], 10);

  const lines = ocrText.split('\n').map(l => l.trim()).filter(Boolean);
  let heroCandidates = lines.filter(l => l.length > 3 && l.split(' ').length <= 3 && !/\d/.test(l));
  const weaponCandidate = lines.find(l => /SWORD|BLADE|STAFF|SPEAR|DAGGER|HAMMER|BOW|KATANA/i.test(l)) || null;

  return { stats, heroCandidates, weaponCandidate };
}

// ================== BUILD EVALUATION ==================
function evaluateBuild(detected, heroMeta) {
  const result = { score: 0, reasons: [], suggestions: [] };
  const s = detected.stats || {};

  if (s.spd) s.spd >= 180 ? (result.score += 35, result.reasons.push(`High SPD: ${s.spd}`)) : s.spd >= 150 ? (result.score += 20, result.reasons.push(`Decent SPD: ${s.spd}`)) : result.reasons.push(`Low SPD: ${s.spd || 'N/A'}`);
  if (s.crit) s.crit >= 150 ? (result.score += 30, result.reasons.push(`High Crit Rate: ${s.crit}`)) : result.reasons.push(`Low Crit Rate: ${s.crit || 'N/A'}`);
  if (s.critdmg && s.critdmg >= 200) result.score += 20, result.reasons.push(`High Crit Damage: ${s.critdmg}`);
  if (s.atk && s.atk >= 3500) result.score += 15, result.reasons.push(`High ATK: ${s.atk}`);
  if (detected.weapon) result.reasons.push(`Detected weapon: ${detected.weapon}`);

  let score = Math.round((result.score / 100) * 10 * 10) / 10;
  score = Math.min(Math.max(score, 0), 10);
  result.score = score;

  if (heroMeta && heroMeta.role) result.suggestions.push(`Hero role: ${heroMeta.role}`);
  if ((s.spd || 0) < 150) result.suggestions.push('Increase SPD via substats or sets.');
  if ((s.crit || 0) < 150) result.suggestions.push('Increase Crit Rate for consistency.');

  return result;
}

// ================== EXPRESS APP ==================
const app = express();
const upload = multer({ dest: UPLOAD_DIR });
app.use(express.json());

app.post('/analyze-image', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  const filePath = req.file.path;

  try {
    const ocrText = await runOCR(filePath);
    const heur = heuristicsExtract(ocrText);

    let foundHero = null;
    for (const cand of heur.heroCandidates) {
      foundHero = await searchHeroByName(cand);
      if (foundHero) break;
    }

    if (!foundHero) {
      const tokens = Array.from(new Set(ocrText.split(/[^A-Za-z']/).filter(t => t.length >= 4))).slice(0, 50);
      for (const tk of tokens) {
        foundHero = await searchHeroByName(tk);
        if (foundHero) break;
      }
    }

    const detected = { heroName: foundHero ? foundHero.name : (heur.heroCandidates[0] || null), stats: heur.stats, weapon: heur.weaponCandidate };
    const evalResult = evaluateBuild(detected, foundHero);

    db.all('SELECT * FROM builds WHERE hero_name = ?', [detected.heroName], (err, rows) => {
      const builds = (!err && rows) ? rows : [];
      res.json({ detected, ocrText: ocrText.slice(0, 3000), evalResult, builds });
      try { fs.unlinkSync(filePath); } catch {}
    });
  } catch (err) {
    console.error(err);
    try { fs.unlinkSync(filePath); } catch {}
    res.status(500).json({ error: 'Internal error analyzing image' });
  }
});

app.get('/health', (_, res) => res.json({ ok: true }));
app.get('/', (_, res) => res.send('Epic7 Build Analyzer - ready'));

// ================== DISCORD BOT ==================
if (DISCORD_TOKEN) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

  client.once('ready', () => console.log('Discord bot ready:', client.user.tag));

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.toLowerCase().startsWith('!analizar')) return;

    const attachments = Array.from(message.attachments.values());
    if (!attachments.length) return message.reply('Attach a screenshot with the command.');

    const url = attachments[0].url;
    const tmpPath = path.join(UPLOAD_DIR, `discord_${Date.now()}_${Math.random().toString(36).slice(2,8)}.png`);
    const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
    fs.writeFileSync(tmpPath, resp.data);

    const fd = new FormData();
    fd.append('image', fs.createReadStream(tmpPath));
    const analyzeRes = await axios.post(`http://localhost:${PORT}/analyze-image`, fd, { headers: fd.getHeaders(), maxBodyLength: Infinity, timeout: 60000 });

    const { detected, evalResult, builds } = analyzeRes.data;

    const embed = new EmbedBuilder()
      .setTitle(detected.heroName || 'Hero not detected')
      .addFields(
        { name: 'Score', value: `${evalResult.score}/10`, inline: true },
        { name: 'Reasons', value: evalResult.reasons.length ? evalResult.reasons.join('\n') : '—', inline: false },
        { name: 'Suggestions', value: evalResult.suggestions.length ? evalResult.suggestions.join('\n') : '—', inline: false },
        { name: 'Recommended Builds', value: builds.length ? builds.map(b => `${b.set_recomendado} — ${b.substats}${b.arma_recomendada ? ' — ' + b.arma_recomendada : ''}`).join('\n') : 'No builds found.' }
      )
      .setTimestamp();

    await message.reply({ embeds: [embed] });
    try { fs.unlinkSync(tmpPath); } catch {}
  });

  client.login(DISCORD_TOKEN).catch(err => console.error('Discord login error:', err.message));
} else console.log('DISCORD_TOKEN not set; bot will not start.');

// ================== START SERVER ==================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`DB path: ${DB_PATH}`);
});