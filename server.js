const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));

const gameData = {}; 

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
  let myRoom = ''; 
  let lastReactionTime = 0; // NEW: The server's built-in stopwatch for this player

  socket.on('createRoom', (data) => {
    myRoom = Math.random().toString(36).substring(2, 6).toUpperCase();
    socket.join(myRoom);
    gameData[myRoom] = { 
        mode: data.mode, playersReady: 0, players: [socket.id], 
        playerNames: { [socket.id]: data.name || "Player 1" }, 
        turnIndex: 0, playerDares: {}, combinedDares: [] 
    };
    socket.emit('roomCreated', myRoom);
  });

  socket.on('joinRoom', (data) => {
    myRoom = data.roomCode; 
    socket.join(myRoom);
    if (gameData[myRoom]) {
        gameData[myRoom].players.push(socket.id);
        gameData[myRoom].playerNames[socket.id] = data.name || "Player 2"; 
    }
    io.to(myRoom).emit('gameReady', gameData[myRoom].playerNames); 
  });

  socket.on('submitDares', (playerDares) => {
    gameData[myRoom].playerDares[socket.id] = playerDares.sort(() => Math.random() - 0.5);
    gameData[myRoom].playersReady++;

    if (gameData[myRoom].playersReady === 2) {
        if (gameData[myRoom].mode === 'combined') {
            const all = [];
            for (let id in gameData[myRoom].playerDares) {
                all.push(...gameData[myRoom].playerDares[id]);
            }
            gameData[myRoom].combinedDares = all.sort(() => Math.random() - 0.5);
        }
        io.to(myRoom).emit('startActualGame'); 
        io.to(myRoom).emit('updateTurn', {
            activePlayerId: gameData[myRoom].players[gameData[myRoom].turnIndex],
            names: gameData[myRoom].playerNames
        });
    }
  });

  socket.on('addExtraDare', (newDare) => {
      if (!gameData[myRoom]) return;
      const room = gameData[myRoom];
      if (room.mode === 'combined') {
          room.combinedDares.push(newDare);
          room.combinedDares.sort(() => Math.random() - 0.5); 
      } else if (room.mode === 'opponent') {
          if (!room.playerDares[socket.id]) room.playerDares[socket.id] = [];
          room.playerDares[socket.id].push(newDare);
          room.playerDares[socket.id].sort(() => Math.random() - 0.5); 
      }
      io.to(myRoom).emit('deckRestocked', {
          activePlayerId: room.players[room.turnIndex], names: room.playerNames
      });
  });

  socket.on('getDare', () => {
    const room = gameData[myRoom];
    let chosenDare = null;

    if (room.mode === 'combined') {
        if (room.combinedDares.length === 0) return io.to(myRoom).emit('gameOver');
        chosenDare = room.combinedDares.shift();
    } else if (room.mode === 'opponent') {
        const activePlayer = room.players[room.turnIndex];
        const opponentId = room.players.find(id => id !== activePlayer);
        if (!room.playerDares[opponentId] || room.playerDares[opponentId].length === 0) {
            return io.to(myRoom).emit('gameOver');
        }
        chosenDare = room.playerDares[opponentId].shift();
    }
    io.to(myRoom).emit('showDare', chosenDare);
  });

  socket.on('nextTurn', () => {
    if (gameData[myRoom].turnIndex === 0) gameData[myRoom].turnIndex = 1;
    else gameData[myRoom].turnIndex = 0;
    
    io.to(myRoom).emit('updateTurn', {
        activePlayerId: gameData[myRoom].players[gameData[myRoom].turnIndex],
        names: gameData[myRoom].playerNames
    });
  });

  // --- NEW: RATE-LIMITED REACTION LOGIC ---
  socket.on('sendReaction', (emoji) => {
      const now = Date.now();
      // If less than 500 milliseconds have passed since their last emoji, ignore it!
      if (now - lastReactionTime < 500) return; 
      
      lastReactionTime = now; // Update the stopwatch

      if(myRoom) {
          io.to(myRoom).emit('showReaction', emoji);
      }
  });

});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});