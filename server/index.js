import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files from the dist directory after building
app.use(express.static(join(__dirname, '../dist')));

// Game state
const GAME_DURATION = 600; // 10 minutes in seconds
const TAG_COOLDOWN = 1; // 1 second cooldown between tags
let gameState = {
    players: {},
    playerCount: 0,
    taggerCount: 0,
    timeLeft: GAME_DURATION,
    isGameActive: false,
    roundEnded: false
};

// Game timer
let gameInterval = null;

function getMVP() {
    let mvp = null;
    let maxScore = -1;
    let maxDistance = -1;

    // If there are still runners, find the one who ran the most
    const hasRunners = Object.values(gameState.players).some(p => !p.isTagger);
    
    Object.values(gameState.players).forEach(player => {
        if (hasRunners) {
            // Runners won, MVP is the one who ran the most
            if (!player.isTagger && player.distanceRun > maxDistance) {
                maxDistance = player.distanceRun;
                mvp = player;
            }
        } else {
            // All tagged, MVP is the one with most tags
            if (player.score > maxScore) {
                maxScore = player.score;
                mvp = player;
            }
        }
    });

    return {
        username: mvp ? mvp.username : 'None',
        score: hasRunners ? Math.floor(maxDistance) : maxScore,
        isRunner: hasRunners
    };
}

function checkGameOver() {
    // Check if all players except one are taggers
    const runners = Object.values(gameState.players).filter(p => !p.isTagger);
    const allTagged = runners.length === 0;
    
    if (allTagged && !gameState.roundEnded && gameState.playerCount > 1) {
        gameState.roundEnded = true;
        const mvp = getMVP();
        io.emit('game-over', {
            runnersWon: false,
            mvp: mvp
        });
        setTimeout(startNewRound, 5000);
        return true;
    }
    return false;
}

function startNewRound() {
    gameState.timeLeft = GAME_DURATION;
    gameState.isGameActive = true;
    gameState.taggerCount = 0;
    gameState.roundEnded = false;

    // Reset all players to runners
    Object.keys(gameState.players).forEach(id => {
        gameState.players[id].isTagger = false;
        gameState.players[id].color = '#00FFFF'; // Cyan for runners
        gameState.players[id].lastTagTime = 0;
        gameState.players[id].score = 0;
        gameState.players[id].distanceRun = 0;
    });

    // If we have 2 or more players, select one random tagger
    if (gameState.playerCount >= 2) {
        const playerIds = Object.keys(gameState.players);
        const randomTaggerId = playerIds[Math.floor(Math.random() * playerIds.length)];
        gameState.players[randomTaggerId].isTagger = true;
        gameState.players[randomTaggerId].color = '#FF0000';
        gameState.taggerCount = 1;
    }

    // Start or restart game timer
    if (gameInterval) {
        clearInterval(gameInterval);
    }

    gameInterval = setInterval(() => {
        gameState.timeLeft--;
        
        if (gameState.timeLeft <= 0) {
            // Time's up, runners win!
            if (!gameState.roundEnded) {
                gameState.roundEnded = true;
                const mvp = getMVP();
                io.emit('game-over', {
                    runnersWon: true,
                    mvp: mvp
                });
            }
            setTimeout(startNewRound, 5000);
        }

        // Emit game state every second
        io.emit('game-state', gameState);
    }, 1000);

    // Emit initial state
    io.emit('game-state', gameState);
}

function checkCollisions(player) {
    if (!player.isTagger || player.isShielded) return;

    const currentTime = Date.now();
    if (player.lastTagTime && currentTime - player.lastTagTime < TAG_COOLDOWN * 1000) {
        return; // Still in cooldown
    }

    const tagRange = 2.5; // Slightly larger tag range
    Object.values(gameState.players).forEach(target => {
        if (target.id !== player.id && !target.isTagger && !target.isShielded) {
            const dx = player.position.x - target.position.x;
            const dz = player.position.z - target.position.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            if (distance < tagRange) {
                // Tag the player
                target.isTagger = true;
                target.color = '#FF0000';
                target.lastTagTime = currentTime;
                gameState.taggerCount++;
                player.score++; // Increment tagger's score

                io.emit('tagged', { 
                    id: target.id,
                    taggerId: player.id,
                    position: target.position
                });

                // Check if game is over (all players tagged)
                checkGameOver();
            }
        }
    });

    player.lastTagTime = currentTime;
}

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    socket.on('join', (playerData) => {
        console.log('Player joined:', playerData.username);
        playerData.lastTagTime = 0;
        playerData.color = '#00FFFF'; // Set initial color to cyan
        playerData.score = 0;
        playerData.distanceRun = 0;
        gameState.players[socket.id] = playerData;
        gameState.playerCount++;

        // If this is the second player joining, start a new round
        if (gameState.playerCount === 2) {
            startNewRound();
        } else if (gameState.playerCount === 1) {
            // First player just starts the game timer
            if (!gameState.isGameActive) {
                startNewRound();
            }
        } else {
            // For players joining mid-game, they start as runners with shield
            gameState.players[socket.id].isTagger = false;
            gameState.players[socket.id].color = '#00FFFF';
            gameState.players[socket.id].isShielded = true;
        }

        io.emit('game-state', gameState);
    });

    socket.on('move', (playerData) => {
        if (gameState.players[socket.id]) {
            // Preserve the player's state
            const currentPlayer = gameState.players[socket.id];
            playerData.isTagger = currentPlayer.isTagger;
            playerData.color = currentPlayer.isTagger ? '#FF0000' : '#00FFFF';
            playerData.lastTagTime = currentPlayer.lastTagTime;
            playerData.isShielded = currentPlayer.isShielded;
            playerData.score = currentPlayer.score;
            playerData.distanceRun = playerData.distanceRun || 0; // Preserve distance run
            
            gameState.players[socket.id] = playerData;
            checkCollisions(gameState.players[socket.id]);
            io.emit('game-state', gameState);
        }
    });

    socket.on('shield-expired', (playerId) => {
        if (gameState.players[playerId]) {
            gameState.players[playerId].isShielded = false;
        }
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        if (gameState.players[socket.id]) {
            if (gameState.players[socket.id].isTagger) {
                gameState.taggerCount--;
            }
            delete gameState.players[socket.id];
            gameState.playerCount--;

            // If we're down to 1 player, make them a runner
            if (gameState.playerCount === 1) {
                const remainingPlayerId = Object.keys(gameState.players)[0];
                if (remainingPlayerId) {
                    gameState.players[remainingPlayerId].isTagger = false;
                    gameState.players[remainingPlayerId].color = '#00FFFF';
                    gameState.taggerCount = 0;
                }
            }
        }
        io.emit('game-state', gameState);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 