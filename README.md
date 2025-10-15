# Epic7 Build Analyzer Discord Bot

![Node.js](https://img.shields.io/badge/Node.js-v18+-brightgreen)
![Discord](https://img.shields.io/badge/Discord-Bot-blue)
![SQLite](https://img.shields.io/badge/Database-SQLite-orange)

A Discord bot and backend service that analyzes **Epic Seven** character builds from screenshots.  
The bot uses **OCR (Tesseract.js)** to read stats, queries the **Epic7DB API** for hero data, and evaluates builds against a **SQLite database**. It also provides recommended builds and feedback directly in Discord.

---

## Features

- Analyze screenshots of Epic Seven characters (stats, weapon, artifacts).
- Identify hero using OCR and Epic7DB.
- Evaluate build quality (simple scoring system, 0-10).
- Suggest builds stored in SQLite database.
- Responds in Discord with embeds showing evaluation and recommended builds.

---

## Requirements

- Node.js v18+
- Discord Bot Token
- SQLite (included via npm package)
- Optional: Improve OCR using OpenAI Vision or Google Vision API

---

## Installation

### Clone the repository:

```bash
git clone https://github.com/YOUR_USERNAME/epic7-build-analyzer.git
cd epic7-build-analyzer
```
### Install dependencies:

```bash
npm install
```
### Configure environment variables (create a .env or set in Render):

```env
DISCORD_TOKEN=your_discord_bot_token
EPIC7DB_API=https://api.epic7db.com   # optional, defaults to this
DATABASE_PATH=./db.sqlite            # optional
PORT=3000                             # optional
```

### Start the server and bot:

```bash
npm start
```
### Usage Discord Commands
!analizar

Upload a screenshot of your Epic Seven hero with stats, artifacts, and weapon.
The bot will respond with:

Detected hero

Build score (0-10)

Reasons and suggestions

Recommended builds from database

Example:

```csharp
!analizar
[Attach screenshot here]
```
### API Endpoint
You can also use the backend directly via HTTP:

POST /analyze-image
Form field: image (file)
Response JSON:

```json
{
  "detected": {
    "heroName": "Arbiter Vildred",
    "stats": { "spd": 210, "crit": 180, "critdmg": 230, "atk": 4000 },
    "weapon": "Kise's Blade"
  },
  "ocrText": "Full OCR text truncated...",
  "evalResult": {
    "score": 9.5,
    "reasons": ["High SPD", "High Crit Rate", "High Crit Damage"],
    "suggestions": ["Increase ATK for optimal DPS"]
  },
  "builds": [
    {
      "hero_name": "Arbiter Vildred",
      "role": "DPS",
      "set_recommendado": "Speed / Crit dmg",
      "substats": "Speed > Crit Rate > Crit Damage",
      "arma_recomendada": "Kise's Blade",
      "notas": "Meta DPS build focused on speed and crit."
    }
  ]
}
```
GET /health – simple health check (returns { ok: true })

### SQLite Database
Stored in db.sqlite (or custom path via DATABASE_PATH env variable)

Table: builds

hero_name TEXT

role TEXT

set_recommendado TEXT

substats TEXT

arma_recomendada TEXT

notas TEXT

Seeded with example builds for common heroes. Add more builds by modifying the database or extending the code.

### OCR and Limitations
Uses Tesseract.js for text recognition from screenshots.

Accuracy depends on screenshot clarity and font style.

Future improvements:

Replace OCR with OpenAI Vision or Google Vision API.

Train visual classifiers to detect hero and artifacts automatically.

### Deployment on Render
Push the repository to GitHub.

Create a Web Service in Render:

Connect GitHub repository

Branch: main

Build Command: npm install

Start Command: npm start

Set environment variables (DISCORD_TOKEN, EPIC7DB_API, DATABASE_PATH)

Render will assign a public URL and start your bot + server.

If using SQLite in /tmp, data may not persist between container restarts. Use Postgres for persistent storage if needed.

### Contributing
Fork the repo and submit pull requests.

Add more builds in SQLite builds table for additional heroes.

Improve OCR or scoring logic as needed.

### License
MIT License
