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

  socket.on('createRoom', (data) => {
    const myRoom = Math.random().toString(36).substring(2, 6).toUpperCase();
    socket.join(myRoom);
    socket.myRoom = myRoom;
    socket.playerId = data.playerId; // We now use the Secret ID

    gameData[myRoom] = { 
        mode: data.mode, 
        playersReady: 0, 
        players: [data.playerId], 
        playerNames: { [data.playerId]: data.name || "Player 1" }, 
        turnIndex: 0, 
        playerDares: {}, 
        combinedDares: [],
        gameState: 'setup',
        disconnectTimer: null // Our 5-minute ghosting clock
    };
    socket.emit('roomCreated', myRoom);
  });

  socket.on('joinRoom', (data) => {
    const myRoom = data.roomCode; 
    socket.join(myRoom);
    socket.myRoom = myRoom;
    socket.playerId = data.playerId;

    if (gameData[myRoom]) {
        if(!gameData[myRoom].players.includes(data.playerId)) {
            gameData[myRoom].players.push(data.playerId);
            gameData[myRoom].playerNames[data.playerId] = data.name || "Player 2"; 
        }
    }
    io.to(myRoom).emit('gameReady', gameData[myRoom].playerNames); 
  });

  // --- THE 5-MINUTE GHOST DETECTOR ---
  socket.on('disconnect', () => {
      const myRoom = socket.myRoom;
      if (myRoom && gameData[myRoom]) {
          // Tell the other player their friend minimized the app
          io.to(myRoom).emit('friendDisconnected', gameData[myRoom].playerNames[socket.playerId]);
          
          // Start the 5-minute (300,000 ms) Doomsday Clock
          gameData[myRoom].disconnectTimer = setTimeout(() => {
              // If they don't return in 5 mins, nuke the room to save server memory
              io.to(myRoom).emit('gameAbandoned');
              delete gameData[myRoom]; 
              console.log(`Room ${myRoom} garbage collected.`);
          }, 300000); 
      }
  });

  // --- THE RECONNECTION ENGINE ---
  socket.on('reconnectPlayer', (data) => {
      const myRoom = data.roomCode;
      
      // If the room still exists (hasn't been deleted by the 5 min timer)
      if (gameData[myRoom] && gameData[myRoom].players.includes(data.playerId)) {
          socket.join(myRoom);
          socket.myRoom = myRoom;
          socket.playerId = data.playerId;

          // STOP THE CLOCK! They came back!
          if (gameData[myRoom].disconnectTimer) {
              clearTimeout(gameData[myRoom].disconnectTimer);
              gameData[myRoom].disconnectTimer = null;
          }

          // Welcome them back and wake up the friend's screen
          socket.emit('reconnectSuccess', {
              roomCode: myRoom,
              gameState: gameData[myRoom].gameState,
              playerNames: gameData[myRoom].playerNames
          });
          io.to(myRoom).emit('friendReconnected', gameData[myRoom].playerNames[socket.playerId]);

          if (gameData[myRoom].gameState === 'playing') {
              socket.emit('updateTurn', {
                  activePlayerId: gameData[myRoom].players[gameData[myRoom].turnIndex],
                  names: gameData[myRoom].playerNames
              });
          }
      } else {
          // The 5 minutes passed, or the room never existed
          socket.emit('reconnectFailed');
      }
  });

  socket.on('submitDares', (playerDares) => {
    const myRoom = socket.myRoom;
    if(!myRoom || !gameData[myRoom]) return;

    gameData[myRoom].playerDares[socket.playerId] = playerDares.sort(() => Math.random() - 0.5);
    gameData[myRoom].playersReady++;

    if (gameData[myRoom].playersReady >= 2) {
        gameData[myRoom].gameState = 'playing'; 
        
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
      const myRoom = socket.myRoom;
      if (!myRoom || !gameData[myRoom]) return;
      const room = gameData[myRoom];

      if (room.mode === 'combined') {
          room.combinedDares.push(newDare);
          room.combinedDares.sort(() => Math.random() - 0.5); 
      } else if (room.mode === 'opponent') {
          if (!room.playerDares[socket.playerId]) room.playerDares[socket.playerId] = [];
          room.playerDares[socket.playerId].push(newDare);
          room.playerDares[socket.playerId].sort(() => Math.random() - 0.5); 
      }
      io.to(myRoom).emit('deckRestocked', {
          activePlayerId: room.players[room.turnIndex],
          names: room.playerNames
      });
  });

  socket.on('getDare', () => {
    const myRoom = socket.myRoom;
    if (!myRoom || !gameData[myRoom]) return;
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
    const myRoom = socket.myRoom;
    if (!myRoom || !gameData[myRoom]) return;

    if (gameData[myRoom].turnIndex === 0) gameData[myRoom].turnIndex = 1;
    else gameData[myRoom].turnIndex = 0;
    
    io.to(myRoom).emit('updateTurn', {
        activePlayerId: gameData[myRoom].players[gameData[myRoom].turnIndex],
        names: gameData[myRoom].playerNames
    });
  });

  let lastReactionTime = {}; 
  socket.on('sendReaction', (emoji) => {
      const myRoom = socket.myRoom;
      if (!myRoom) return;

      const now = Date.now();
      const pId = socket.playerId;
      if (!lastReactionTime[pId]) lastReactionTime[pId] = 0;

      if (now - lastReactionTime[pId] < 500) return; 
      lastReactionTime[pId] = now; 

      io.to(myRoom).emit('showReaction', emoji);
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});