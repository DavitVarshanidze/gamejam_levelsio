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
    const players = Object.values(gameState.players);
    let mvp = players[0];
    
    // If there are still runners, MVP is based on distance
    const hasRunners = players.some(p => !p.isTagger);
    if (hasRunners) {
        mvp = players.reduce((prev, curr) => {
            return (!curr.isTagger && curr.distanceRun > prev.distanceRun) ? curr : prev;
        });
    } else {
        // If all are taggers, MVP is based on score (tags)
        mvp = players.reduce((prev, curr) => {
            return curr.score > prev.score ? curr : prev;
        });
    }
    
    return {
        username: mvp.username,
        score: mvp.isTagger ? mvp.score : Math.floor(mvp.distanceRun),
        isRunner: !mvp.isTagger
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

    socket.on('tag-attempt', (taggerData) => {
        const tagger = gameState.players[taggerData.id];
        if (!tagger || !tagger.isTagger) return;

        // Check for collisions with runners
        const runners = Object.values(gameState.players).filter(p => !p.isTagger && !p.isShielded);
        for (const runner of runners) {
            const dx = tagger.position.x - runner.position.x;
            const dz = tagger.position.z - runner.position.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            if (distance < 2) { // Tag range
                runner.isTagger = true;
                runner.color = '#FF0000';
                tagger.score++;

                // Check if this is the last runner
                const remainingRunners = Object.values(gameState.players).filter(p => !p.isTagger).length;
                const isLastTag = remainingRunners === 0;

                // Emit tagged event with last tag information
                io.emit('tagged', {
                    id: runner.id,
                    tagger: tagger,
                    tagged: runner,
                    isLastTag: isLastTag
                });

                // If this was the last runner, emit game over after a delay
                if (isLastTag) {
                    setTimeout(() => {
                        const mvp = getMVP();
                        io.emit('game-over', {
                            runnersWon: false,
                            mvp: mvp
                        });
                        
                        // Reset game after 5 seconds
                        setTimeout(() => {
                            resetGame();
                        }, 5000);
                    }, 3000); // Wait for cinematic to finish
                }
            }
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

function resetGame() {
    // Reset all players to runners except one random tagger
    const playerIds = Object.keys(gameState.players);
    const newTaggerId = playerIds[Math.floor(Math.random() * playerIds.length)];
    
    for (const id of playerIds) {
        const player = gameState.players[id];
        player.isTagger = id === newTaggerId;
        player.color = player.isTagger ? '#FF0000' : '#00FFFF';
        player.score = 0;
        player.distanceRun = 0;
        player.isShielded = true;
        
        // Random spawn position
        const spawnPoint = getRandomSpawnPoint();
        player.position = spawnPoint;
    }
    
    // Update game state
    gameState.roundEnded = false;
    updateGameState();
    
    // Emit new game state to all clients
    io.emit('game-state', gameState);
}

function getRandomSpawnPoint() {
    const spawnZones = [
        { x: [-180, -120], z: [-180, -120] },
        { x: [-180, -120], z: [120, 180] },
        { x: [120, 180], z: [-180, -120] },
        { x: [120, 180], z: [120, 180] },
        { x: [-30, 30], z: [-180, -120] },
        { x: [-30, 30], z: [120, 180] },
        { x: [-180, -120], z: [-30, 30] },
        { x: [120, 180], z: [-30, 30] }
    ];

    const zone = spawnZones[Math.floor(Math.random() * spawnZones.length)];
    return {
        x: zone.x[0] + Math.random() * (zone.x[1] - zone.x[0]),
        y: 1,
        z: zone.z[0] + Math.random() * (zone.z[1] - zone.z[0])
    };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 