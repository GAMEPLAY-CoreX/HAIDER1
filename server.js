const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const db = require('./db.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// API to create game
app.post('/api/game', async (req, res) => {
  try {
    const { players, initialMoney } = req.body;
    if (!players || players.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 players' });
    }
    const sessionId = await db.createSession(players, initialMoney || 1000);
    res.json({ sessionId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create game' });
  }
});

app.get('/api/leaderboard/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const players = await db.getSessionPlayers(sessionId);
    // Sort players by score descending
    players.sort((a, b) => (b.score || 0) - (a.score || 0));
    res.json({ players });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// Game state variables stored in memory for active sessions
const sessions = {};
const ARABIC_LETTERS = "ابتثجحخدذرزسشصضطظعغفقكلمنهوي".split('');

io.on('connection', (socket) => {
  socket.on('join', async ({ sessionId, playerName }) => {
    socket.join(sessionId);

    if (!sessions[sessionId]) {
      sessions[sessionId] = {
        owner: playerName,
        auctionCount: 0,
        currentAuction: null,
        wordPhase: false,
        timer: null
      };
    }

    try {
      const players = await db.getSessionPlayers(sessionId);
      const playerLetters = await db.getPlayerLetters(sessionId, playerName);
      const playerScore = await db.getPlayerScore(sessionId, playerName);

      socket.emit('gameState', {
        players,
        owner: sessions[sessionId].owner,
        currentAuction: sessions[sessionId].currentAuction,
        wordPhase: sessions[sessionId].wordPhase,
        playerLetters,
        playerScore
      });

      io.to(sessionId).emit('playerJoined', playerName);
    } catch (err) {
      console.error(err);
      socket.emit('error', 'Error fetching game state');
    }
  });

  socket.on('startAuction', async ({ sessionId }) => {
    if (!sessions[sessionId]) return;

    const letter = ARABIC_LETTERS[Math.floor(Math.random() * ARABIC_LETTERS.length)];
    sessions[sessionId].currentAuction = {
      letter,
      highestBid: 0,
      highestBidder: null,
      active: true
    };
    sessions[sessionId].auctionCount += 1;

    io.to(sessionId).emit('auctionStarted', { letter });

    if (sessions[sessionId].timer) clearTimeout(sessions[sessionId].timer);

    sessions[sessionId].timer = setTimeout(() => {
      endAuction(sessionId);
    }, 20000); // 20 seconds auto-end
  });

  socket.on('placeBid', async ({ sessionId, playerName, amount }) => {
    const session = sessions[sessionId];
    if (!session || !session.currentAuction || !session.currentAuction.active) return;
    if (amount <= session.currentAuction.highestBid) return;

    // Check player money
    try {
      const players = await db.getSessionPlayers(sessionId);
      const player = players.find(p => p.name === playerName);
      if (player && player.money >= amount) {
        session.currentAuction.highestBid = amount;
        session.currentAuction.highestBidder = playerName;
        io.to(sessionId).emit('bidPlaced', { player: playerName, amount });
      } else {
        socket.emit('error', 'Not enough money');
      }
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('endAuction', ({ sessionId }) => {
    endAuction(sessionId);
  });

  async function endAuction(sessionId) {
    const session = sessions[sessionId];
    if (!session || !session.currentAuction || !session.currentAuction.active) return;

    session.currentAuction.active = false;
    clearTimeout(session.timer);

    const auction = session.currentAuction;
    try {
      if (auction.highestBidder) {
        await db.updatePlayerMoney(sessionId, auction.highestBidder, -auction.highestBid);
        await db.recordAuction(sessionId, auction.letter, auction.highestBid, auction.highestBidder);
        await db.addLetterToPlayer(sessionId, auction.highestBidder, auction.letter);
      }

      const players = await db.getSessionPlayers(sessionId);

      const TOTAL_ROUNDS = 10;
      io.to(sessionId).emit('auctionEnded', {
        letter: auction.letter,
        price: auction.highestBid,
        winner: auction.highestBidder || 'None',
        auctionCount: session.auctionCount,
        totalRounds: TOTAL_ROUNDS
      });

      io.to(sessionId).emit('gameState', {
        players,
        owner: session.owner,
        currentAuction: null,
        wordPhase: session.wordPhase
      });

      session.currentAuction = null;
    } catch (err) {
      console.error(err);
    }
  }

  socket.on('startWordPhase', ({ sessionId }) => {
    if (sessions[sessionId]) {
      sessions[sessionId].wordPhase = true;
      io.to(sessionId).emit('startWordPhase');
    }
  });

  socket.on('formWord', async ({ sessionId, playerName, word }) => {
    try {
      const dbLetters = await db.getPlayerLetters(sessionId, playerName);
      // Ensure player has all letters required
      const wordLetters = word.split('');
      const canForm = wordLetters.every(l => {
        const countNeeded = wordLetters.filter(x => x === l).length;
        const countOwned = dbLetters.filter(x => x === l).length;
        return countOwned >= countNeeded;
      });

      if (!canForm) {
        return socket.emit('error', 'You do not have the required letters to form this word');
      }

      await db.consumeLetters(sessionId, playerName, word);
      await db.formWord(sessionId, playerName, word);

      const points = word.length;
      await db.updatePlayerScore(sessionId, playerName, points);

      const newScore = await db.getPlayerScore(sessionId, playerName);
      const remainingLetters = await db.getPlayerLetters(sessionId, playerName);
      const players = await db.getSessionPlayers(sessionId);

      io.to(sessionId).emit('wordFormed', { player: playerName, word, points, newScore, remainingLetters });
      io.to(sessionId).emit('gameState', {
        players,
        owner: sessions[sessionId] ? sessions[sessionId].owner : null,
        playerLetters: remainingLetters,
        playerScore: newScore
      });

      io.to(sessionId).emit('gameOver', { message: 'انتهت اللعبة! شكراً للجميع.' });

    } catch (err) {
      console.error(err);
      socket.emit('error', 'Failed to form word');
    }
  });

  socket.on('endGameRequest', async ({ sessionId }) => {
    if (sessions[sessionId] && sessions[sessionId].owner) {
      io.to(sessionId).emit('gameOver', { message: 'انتهت اللعبة! سيتم تحويلكم لنتائج اللعبة.' });
    }
  });
});

const PORT = process.env.PORT || 80;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
