require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: process.env.NODE_ENV === 'production' 
            ? 'https://tagrun.io' 
            : ['http://localhost:8081', 'http://localhost:3000'],
        methods: ['GET', 'POST']
    }
});

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            connectSrc: ["'self'", "wss://tagrun.io", "ws://localhost:8081", "ws://localhost:3000"],
            imgSrc: ["'self'", "data:", "blob:"],
            fontSrc: ["'self'", "data:"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
        }
    }
}));

// Compression middleware
app.use(compression());

// Serve static files from the dist directory in production
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, '../dist')));
}

// Game state
const gameState = {
    players: {},
    playerCount: 0,
    taggerCount: 0,
    timeLeft: 300, // 5 minutes per round
    isGameActive: false
};

// Game constants
const ROUND_TIME = 300; // 5 minutes
const MIN_PLAYERS = 2;
const TAG_DISTANCE = 3;
const SHIELD_DURATION = 3000; // 3 seconds

// Socket.io event handlers
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    socket.on('join', (playerData) => {
        gameState.players[socket.id] = {
            ...playerData,
            id: socket.id,
            score: 0,
            distanceRun: 0
        };
        gameState.playerCount++;

        // Assign tagger if needed
        if (gameState.playerCount >= MIN_PLAYERS && gameState.taggerCount === 0) {
            const randomPlayer = Object.values(gameState.players)[Math.floor(Math.random() * gameState.playerCount)];
            randomPlayer.isTagger = true;
            randomPlayer.color = '#FF0000';
            gameState.taggerCount++;
        }

        // Start game if enough players
        if (gameState.playerCount >= MIN_PLAYERS && !gameState.isGameActive) {
            startGame();
        }

        io.emit('game-state', gameState);
    });

    socket.on('move', (playerData) => {
        if (gameState.players[socket.id]) {
            gameState.players[socket.id].position = playerData.position;
            gameState.players[socket.id].rotation = playerData.rotation;
            gameState.players[socket.id].distanceRun = playerData.distanceRun;
            io.emit('game-state', gameState);
        }
    });

    socket.on('tag-attempt', (taggerData) => {
        const tagger = gameState.players[socket.id];
        if (!tagger || !tagger.isTagger) return;

        // Check for nearby players to tag
        Object.values(gameState.players).forEach(player => {
            if (!player.isTagger && !player.isShielded) {
                const distance = Math.sqrt(
                    Math.pow(tagger.position.x - player.position.x, 2) +
                    Math.pow(tagger.position.z - player.position.z, 2)
                );

                if (distance <= TAG_DISTANCE) {
                    // Tag the player
                    player.isTagger = true;
                    player.color = '#FF0000';
                    gameState.taggerCount++;
                    tagger.score++;

                    // Check if this is the last runner
                    const isLastTag = Object.values(gameState.players).every(p => 
                        p.isTagger || p.id === player.id
                    );

                    // Emit tagged event
                    io.emit('tagged', {
                        id: player.id,
                        tagger: tagger,
                        tagged: player,
                        isLastTag
                    });

                    // If last runner tagged, end the game
                    if (isLastTag) {
                        endGame(false); // Taggers win
                    }
                }
            }
        });

        io.emit('game-state', gameState);
    });

    socket.on('shield-expired', (playerId) => {
        if (gameState.players[playerId]) {
            gameState.players[playerId].isShielded = false;
            io.emit('game-state', gameState);
        }
    });

    socket.on('disconnect', () => {
        if (gameState.players[socket.id]) {
            if (gameState.players[socket.id].isTagger) {
                gameState.taggerCount--;
            }
            delete gameState.players[socket.id];
            gameState.playerCount--;

            // End game if not enough players
            if (gameState.playerCount < MIN_PLAYERS && gameState.isGameActive) {
                endGame(true); // Runners win by default
            }

            io.emit('game-state', gameState);
        }
    });
});

function startGame() {
    gameState.isGameActive = true;
    gameState.timeLeft = ROUND_TIME;

    // Start round timer
    const timer = setInterval(() => {
        gameState.timeLeft--;
        io.emit('game-state', gameState);

        if (gameState.timeLeft <= 0) {
            clearInterval(timer);
            endGame(true); // Runners win if time runs out
        }
    }, 1000);
}

function endGame(runnersWon) {
    gameState.isGameActive = false;

    // Find MVP
    let mvp = null;
    let maxScore = -1;

    Object.values(gameState.players).forEach(player => {
        const score = player.isTagger ? player.score : player.distanceRun;
        if (score > maxScore) {
            maxScore = score;
            mvp = player;
        }
    });

    io.emit('game-over', {
        runnersWon,
        mvp: {
            username: mvp.username,
            score: mvp.isTagger ? mvp.score : Math.floor(mvp.distanceRun),
            isRunner: !mvp.isTagger
        }
    });

    // Reset game state after delay
    setTimeout(() => {
        Object.values(gameState.players).forEach(player => {
            player.isTagger = false;
            player.color = '#00FFFF';
            player.score = 0;
            player.distanceRun = 0;
            player.isShielded = true;
        });
        gameState.taggerCount = 0;
        startGame();
    }, 5000);
}

// Start server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 