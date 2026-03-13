const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'game.db');
const db = new sqlite3.Database(dbPath);

// initialize tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT DEFAULT 'waiting',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      name TEXT,
      money INTEGER DEFAULT 1000,
      words_count INTEGER DEFAULT 0,
      score INTEGER DEFAULT 0,
      socket_id TEXT,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    )
  `);
  // ensure columns exist for older databases (safe ALTERs; ignore errors)
  db.run(`ALTER TABLE players ADD COLUMN money INTEGER DEFAULT 1000`, err => { });
  db.run(`ALTER TABLE players ADD COLUMN words_count INTEGER DEFAULT 0`, err => { });
  db.run(`ALTER TABLE players ADD COLUMN score INTEGER DEFAULT 0`, err => { });
  db.run(`
    CREATE TABLE IF NOT EXISTS auctions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      letter TEXT,
      final_price INTEGER,
      winner TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS player_letters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      player TEXT,
      letter TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS formed_words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      player TEXT,
      word TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    )
  `);
});

function createSession(playerNames, initialMoney = 1000) {
  return new Promise((resolve, reject) => {
    db.run(`INSERT INTO sessions DEFAULT VALUES`, function (err) {
      if (err) return reject(err);
      const sessionId = this.lastID;
      const stmt = db.prepare(`INSERT INTO players (session_id, name, money) VALUES (?, ?, ?)`);
      playerNames.forEach(name => stmt.run(sessionId, name, initialMoney));
      stmt.finalize(err2 => {
        if (err2) return reject(err2);
        resolve(sessionId);
      });
    });
  });
}

function getSessionPlayers(sessionId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM players WHERE session_id = ?`,
      [sessionId],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      }
    );
  });
}

function updatePlayerMoney(sessionId, player, amount) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE players SET money = money + ? WHERE session_id = ? AND name = ?`,
      [amount, sessionId, player],
      function (err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}

function recordAuction(sessionId, letter, finalPrice, winner) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO auctions (session_id, letter, final_price, winner) VALUES (?, ?, ?, ?)`,
      [sessionId, letter, finalPrice, winner],
      function (err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}

function addLetterToPlayer(sessionId, player, letter) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO player_letters (session_id, player, letter) VALUES (?, ?, ?)`,
      [sessionId, player, letter],
      function (err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}

function getPlayerLetters(sessionId, player) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT letter FROM player_letters WHERE session_id = ? AND player = ? ORDER BY id`,
      [sessionId, player],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows.map(r => r.letter));
      }
    );
  });
}

function formWord(sessionId, player, word) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO formed_words (session_id, player, word) VALUES (?, ?, ?)`,
      [sessionId, player, word],
      function (err) {
        if (err) return reject(err);

        // Increment word count
        db.run(
          `UPDATE players SET words_count = words_count + 1 WHERE session_id = ? AND name = ?`,
          [sessionId, player],
          function (err2) {
            if (err2) return reject(err2);
            resolve(this.lastID);
          }
        );
      }
    );
  });
}

function getWordCount(sessionId, player) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT words_count FROM players WHERE session_id = ? AND name = ?`,
      [sessionId, player],
      (err, row) => {
        if (err) return reject(err);
        resolve(row ? row.words_count : 0);
      }
    );
  });
}

function updatePlayerScore(sessionId, player, amount) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE players SET score = score + ? WHERE session_id = ? AND name = ?`,
      [amount, sessionId, player],
      function (err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}

function getPlayerScore(sessionId, player) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT score FROM players WHERE session_id = ? AND name = ?`,
      [sessionId, player],
      (err, row) => {
        if (err) return reject(err);
        resolve(row ? row.score : 0);
      }
    );
  });
}

function consumeLetters(sessionId, player, word) {
  // remove one instance of each letter in word from player_letters
  return new Promise((resolve, reject) => {
    const letters = word.split('');
    db.serialize(() => {
      const stmt = db.prepare(`DELETE FROM player_letters WHERE id = (
          SELECT id FROM player_letters
          WHERE session_id = ? AND player = ? AND letter = ?
          ORDER BY id LIMIT 1)`);
      letters.forEach(letter => stmt.run(sessionId, player, letter));
      stmt.finalize(err => {
        if (err) return reject(err);
        resolve();
      });
    });
  });
}

// returns array of {player, count} for each player in session
function getLetterCounts(sessionId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT player, COUNT(*) as cnt FROM player_letters WHERE session_id = ? GROUP BY player`,
      [sessionId],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      }
    );
  });
}

function getResults(sessionId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT name, words_count, money, score FROM players WHERE session_id = ? ORDER BY score DESC, words_count DESC, money DESC`,
      [sessionId],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      }
    );
  });
}

function getSessionWords(sessionId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT player, word FROM formed_words WHERE session_id = ? ORDER BY timestamp ASC`,
      [sessionId],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      }
    );
  });
}

module.exports = {
  createSession,
  getSessionPlayers,
  updatePlayerMoney,
  recordAuction,
  addLetterToPlayer,
  getPlayerLetters,
  formWord,
  getWordCount,
  updatePlayerScore,
  getPlayerScore,
  consumeLetters,
  getLetterCounts,
  getResults,
  getSessionWords
};
