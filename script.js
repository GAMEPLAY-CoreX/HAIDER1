const socket = io();
let sessionId = null;
let playerName = null;
let currentPlayers = [];
let playerLetters = [];
let playerWords = [];
let playerScore = 0;
let isOwner = false;

// persist letters locally so the separate HTML page can read them
function loadMyLetters() {
  const stored = localStorage.getItem('myLetters');
  if (stored) {
    playerLetters = stored.split('');
  }
}

function saveMyLetters() {
  localStorage.setItem('myLetters', playerLetters.join(''));
}

// initialize storage
loadMyLetters();

// UI Elements
const mainMenu = document.getElementById('main-menu');
const gameCreated = document.getElementById('game-created');
const setupDiv = document.getElementById('setup');
const setupCreateDiv = document.getElementById('setup-create');
const auctionPhaseDiv = document.getElementById('auction-phase');
const wordPhaseDiv = document.getElementById('word-phase');
const gameOverDiv = document.getElementById('game-over');

const showJoinBtn = document.getElementById('show-join-btn');
const showCreateBtn = document.getElementById('show-create-btn');
const joinBtn = document.getElementById('join-btn');
const createBtn = document.getElementById('create-btn');
const placeBidBtn = document.getElementById('place-bid-btn');
const endAuctionBtn = document.getElementById('end-auction-btn');
const formWordBtn = document.getElementById('form-word-btn');
const newGameBtn = document.getElementById('new-game-btn');
const backBtn = document.getElementById('back-btn');
const backBtn2 = document.getElementById('back-btn2');
const copyBtn = document.getElementById('copy-btn');
const showMenuBtn = document.getElementById('show-menu-btn');
const startAuctionBtn = document.getElementById('start-auction-btn');
const sessionDisplay = document.getElementById('session-display');

const sessionInput = document.getElementById('sessionInput');
const playerNameInput = document.getElementById('player-name');
const playersInput = document.getElementById('players-input');
const bidAmountInput = document.getElementById('bid-amount');
const wordInput = document.getElementById('word-input');

const currentLetterDiv = document.getElementById('current-letter');
const currentPriceDiv = document.getElementById('current-price');
const highestBidderDiv = document.getElementById('highest-bidder');
const playersListDiv = document.getElementById('players-list');
const auctionLogDiv = document.getElementById('auction-log');
const auctionTimerDiv = document.getElementById('auction-timer');
const playerStatusDiv = document.getElementById('player-status');
const myWordsDiv = document.getElementById('my-words');
const wordsLogDiv = document.getElementById('words-log');
const winnerMessageDiv = document.getElementById('winner-message');

let countdownInterval = null;

// Main Menu Events
showJoinBtn.addEventListener('click', () => {
  mainMenu.classList.add('hidden');
  setupDiv.classList.remove('hidden');
});

showCreateBtn.addEventListener('click', () => {
  mainMenu.classList.add('hidden');
  setupCreateDiv.classList.remove('hidden');
});

backBtn.addEventListener('click', () => {
  setupDiv.classList.add('hidden');
  mainMenu.classList.remove('hidden');
});

backBtn2.addEventListener('click', () => {
  setupCreateDiv.classList.add('hidden');
  mainMenu.classList.remove('hidden');
});

showMenuBtn.addEventListener('click', () => {
  gameCreated.classList.add('hidden');
  setupCreateDiv.classList.add('hidden');
  // owner coming from creation should go directly to auction area
  if (isOwner) {
    showAuctionInterface();
  } else {
    mainMenu.classList.remove('hidden');
  }
});

copyBtn.addEventListener('click', () => {
  const text = sessionDisplay.textContent;
  navigator.clipboard.writeText(text).then(() => {
    copyBtn.textContent = '✅ تم النسخ!';
    setTimeout(() => {
      copyBtn.textContent = '📋 نسخ الرقم';
    }, 2000);
  });
});

// Create Game
createBtn.addEventListener('click', async () => {
  const text = playersInput.value.trim();
  if (!text) {
    alert('أدخل أسماء اللاعبين');
    return;
  }
  
  const players = text.split(/[،,]/).map(s => s.trim()).filter(s => s);
  if (players.length < 2 || players.length > 10) {
    alert('العدد يجب أن يكون بين 2 و 10');
    return;
  }
  const initialMoney = parseInt(document.getElementById('initial-money-input').value) || 1000;
  
  try {
    const res = await fetch('/api/game', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ players, initialMoney })
    });
    const data = await res.json();
    sessionId = data.sessionId;
    playerName = players[0];
    
    // Show session info
    sessionDisplay.textContent = sessionId.toString().padStart(4, '0');
    const moneyLimitDisplay = document.getElementById('money-limit-display');
    moneyLimitDisplay.textContent = `حد الفلوس لكل لاعب: ${initialMoney} د.ع`;
    setupCreateDiv.classList.add('hidden');
    mainMenu.classList.add('hidden');
    gameCreated.classList.remove('hidden');
    
    socket.emit('join', { sessionId, playerName });
  } catch (err) {
    console.error(err);
    alert('خطأ في إنشاء اللعبة');
  }
});

// Join Game
joinBtn.addEventListener('click', () => {
  const sessionId_ = sessionInput.value.trim();
  const name = playerNameInput.value.trim();
  
  if (!sessionId_ || !name) {
    alert('أدخل رقم الجلسة واسمك');
    return;
  }
  
  sessionId = sessionId_.includes('MESSI') ? sessionId_ : parseInt(sessionId_);
  playerName = name;
  
  mainMenu.classList.add('hidden');
  setupDiv.classList.add('hidden');
  
  socket.emit('join', { sessionId, playerName });
  showAuctionInterface();
});

function startAuctionPhase() {
  if (gameCreated) { gameCreated.classList.add('hidden'); }
  auctionPhaseDiv.classList.remove('hidden');
  socket.emit('startAuction', { sessionId });
}

function showAuctionInterface() {
  if (gameCreated) { gameCreated.classList.add('hidden'); }
  auctionPhaseDiv.classList.remove('hidden');
  // owner should see start button if not already in auction
  if (isOwner && startAuctionBtn) {
    startAuctionBtn.classList.remove('hidden');
  }
}

// Socket events
socket.on('auctionStarted', (data) => {
  // hide start button once auction is underway
  if (startAuctionBtn) startAuctionBtn.classList.add('hidden');

  currentLetterDiv.textContent = data.letter;
  currentPriceDiv.textContent = '0 د.ع';
  highestBidderDiv.textContent = '';
  bidAmountInput.value = '';
  auctionLogDiv.innerHTML = '<p>بدأت المزادة! ارفع السعر بالدينار العراقي...</p>';

  // start 20-second timer
  if (countdownInterval) clearInterval(countdownInterval);
  let remaining = 20;
  auctionTimerDiv.textContent = remaining;
  countdownInterval = setInterval(() => {
    remaining--;
    auctionTimerDiv.textContent = remaining;
    if (remaining <= 0) {
      clearInterval(countdownInterval);
    }
  }, 1000);
});

socket.on('bidPlaced', (data) => {
  currentPriceDiv.textContent = data.amount + ' د.ع';
  highestBidderDiv.textContent = `الأعلى: ${data.player} - ${data.amount} د.ع`;
  
  const log = auctionLogDiv.innerHTML;
  auctionLogDiv.innerHTML = log + `<p>📢 ${data.player} رفع السعر إلى ${data.amount} د.ع</p>`;
});

socket.on('auctionEnded', async (data) => {
  // stop timer
  if (countdownInterval) clearInterval(countdownInterval);
  auctionTimerDiv.textContent = '';

  auctionLogDiv.innerHTML += `<p style="color: #0f0;">✓ انتهت المزادة! الحرف '${data.letter}' ذهب إلى ${data.winner} بـ ${data.price}</p>`;
  
  if (data.winner === playerName) {
    playerLetters.push(data.letter);
    saveMyLetters();
    updatePlayerStatus();
  }

  const limit = data.totalRounds || 10;
  if (data.auctionCount >= limit) {
    startWordPhase();
  } else {
    // show start button again if owner
    if (isOwner && startAuctionBtn) {
      startAuctionBtn.classList.remove('hidden');
      auctionLogDiv.innerHTML += `<p>🔔 انتظر لبدء المزاد التالي من قبل مالك الجلسة</p>`;
    }
  }
});

socket.on('playerJoined', (name) => {
  auctionLogDiv.innerHTML += `<p>🎉 ${name} انضم إلى اللعبة</p>`;
});

socket.on('gameState', (data) => {
  currentPlayers = data.players;
  isOwner = data.owner === playerName;
  if (data.playerLetters) {
    playerLetters = data.playerLetters;
  }
  if (data.playerScore !== undefined) {
    playerScore = data.playerScore;
  }
  updatePlayersDisplay();
  updatePlayerStatus();
  // decide whether to show start button
  if (isOwner && !data.currentAuction && !data.wordPhase) {
    if (startAuctionBtn) startAuctionBtn.classList.remove('hidden');
  }
});

socket.on('startWordPhase', () => {
  if (startAuctionBtn) startAuctionBtn.classList.add('hidden');
  auctionPhaseDiv.classList.add('hidden');
  wordPhaseDiv.classList.remove('hidden');
  updatePlayerStatus();
});

socket.on('wordFormed', (data) => {
  let msg = `✓ ${data.player} شكل كلمة: <strong>${data.word}</strong>`;
  if (data.points) {
    msg += ` (+${data.points} نقطة)`;
  }
  wordsLogDiv.innerHTML += `<p>${msg}</p>`;
  
  if (data.player === playerName) {
    playerWords.push(data.word);
    if (data.newScore !== undefined) {
      playerScore = data.newScore;
    }
    if (data.remainingLetters) {
      playerLetters = data.remainingLetters;
    }
    updatePlayerStatus();
  }
});

socket.on('gameOver', (data) => {
  wordPhaseDiv.classList.add('hidden');
  gameOverDiv.classList.remove('hidden');
  winnerMessageDiv.textContent = data.message;
});

socket.on('error', (msg) => {
  alert(msg);
});

// Bid
placeBidBtn.addEventListener('click', () => {
  const amount = parseInt(bidAmountInput.value);
  if (!amount || amount <= 0) {
    alert('أدخل مبلغ صحيح بالدينار العراقي');
    return;
  }
  socket.emit('placeBid', { sessionId, playerName, amount });
});

// End Auction
endAuctionBtn.addEventListener('click', () => {
  socket.emit('endAuction', { sessionId });
});

// Form Word
formWordBtn.addEventListener('click', () => {
  const word = wordInput.value.trim();
  if (!word) {
    alert('أدخل كلمة');
    return;
  }
  socket.emit('formWord', { sessionId, playerName, word });
  wordInput.value = '';
});

// New Game
newGameBtn.addEventListener('click', () => {
  location.reload();
});

// start auction button
if (startAuctionBtn) {
  startAuctionBtn.addEventListener('click', () => {
    if (!isOwner) return;
    startAuctionPhase();
  });
}

// show letters page buttons
const showLettersBtn = document.getElementById('show-letters-btn');
const showLettersBtn2 = document.getElementById('show-letters-btn-2');
if (showLettersBtn) {
  showLettersBtn.addEventListener('click', () => {
    window.open('letters.html', '_blank');
  });
}
if (showLettersBtn2) {
  showLettersBtn2.addEventListener('click', () => {
    window.open('letters.html', '_blank');
  });
}

function updatePlayersDisplay() {
  playersListDiv.innerHTML = '';
  currentPlayers.forEach(p => {
    const div = document.createElement('div');
    div.className = 'player-status';
    const scoreText = p.score !== undefined ? ` - ${p.score} نقطة` : '';
    div.innerHTML = `<strong>${p.name}</strong> - ${p.money} د.ع 💰${scoreText}`;
    playersListDiv.appendChild(div);
  });
}

function updatePlayerStatus() {
  playerStatusDiv.innerHTML = `
    <div class="status-box">
      <h3>${playerName}</h3>
      <p>النقاط: <strong>${playerScore}</strong></p>
      <p>الحروف المتبقية: <strong>${playerLetters.join('')}</strong></p>
    </div>
  `;
  
  myWordsDiv.innerHTML = playerWords.map(w => `<span class="word-chip">${w}</span>`).join('');
}

function startWordPhase() {
  auctionPhaseDiv.classList.add('hidden');
  wordPhaseDiv.classList.remove('hidden');
  socket.emit('startWordPhase', { sessionId });
  updatePlayerStatus();
}

