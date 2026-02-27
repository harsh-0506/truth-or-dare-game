const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const gameData = {}; 

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
  let myRoom = ''; 

  socket.on('createRoom', () => {
    myRoom = Math.random().toString(36).substring(2, 6).toUpperCase();
    socket.join(myRoom);
    
    // Create the memory bank, and add Player 1's ID to the player list
    gameData[myRoom] = { 
        allDares: [], 
        playersReady: 0,
        players: [socket.id], // Stores the unique walkie-talkie IDs
        turnIndex: 0 // 0 means Player 1, 1 means Player 2
    };
    
    socket.emit('roomCreated', myRoom);
  });

  socket.on('joinRoom', (roomCode) => {
    myRoom = roomCode; 
    socket.join(myRoom);
    
    // Add Player 2's ID to the player list
    if (gameData[myRoom]) {
        gameData[myRoom].players.push(socket.id);
    }

    io.to(myRoom).emit('gameReady'); 
  });

  socket.on('submitDares', (playerDares) => {
    // Combine the arrays and mix them up
    gameData[myRoom].allDares.push(...playerDares);
    gameData[myRoom].allDares.sort(() => Math.random() - 0.5); // A simple trick to shuffle the dares!

    gameData[myRoom].playersReady++;

    if (gameData[myRoom].playersReady === 2) {
        // Start the game for both players
        io.to(myRoom).emit('startActualGame'); 
        
        // Announce that it is Player 1's turn using their ID
        io.to(myRoom).emit('updateTurn', gameData[myRoom].players[gameData[myRoom].turnIndex]);
    }
  });

  // --- NEW CODE: THE GAMEPLAY LOOP ---

  // When a player asks for a dare
  socket.on('getDare', () => {
    const daresArray = gameData[myRoom].allDares;
    
    // Check if the game is out of dares
    if (daresArray.length === 0) {
        io.to(myRoom).emit('gameOver');
        return;
    }

    // Pull the very first dare out of the shuffled array (and remove it so it doesn't repeat)
    const chosenDare = daresArray.shift(); 
    
    // Show it to both players
    io.to(myRoom).emit('showDare', chosenDare);
  });

  // When a player finishes a dare and clicks 'Next Turn'
  socket.on('nextTurn', () => {
    // Switch the turn index: If it's 0, make it 1. If it's 1, make it 0.
    if (gameData[myRoom].turnIndex === 0) {
        gameData[myRoom].turnIndex = 1;
    } else {
        gameData[myRoom].turnIndex = 0;
    }

    // Announce the new turn to both players!
    io.to(myRoom).emit('updateTurn', gameData[myRoom].players[gameData[myRoom].turnIndex]);
  });

});

// http.listen(3000, () => {
//   console.log('Server is running on http://localhost:3000');
// });

// The cloud will provide a port, OR it will use 3000 if you are testing on your computer
const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});