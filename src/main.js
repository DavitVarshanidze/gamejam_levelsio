import * as THREE from 'three';
import { io } from 'socket.io-client';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

class Game {
    constructor() {
        this.players = new Map();
        this.playerData = null;
        this.socket = null;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.controls = null;
        this.clouds = [];
        this.sprintCooldown = 0;
        this.sprintActive = false;
        this.shieldActive = false;
        this.cameraRotation = 0;
        this.cameraPitch = 0;
        this.headRotation = 0;
        this.maxHeadRotation = Math.PI / 2;
        this.movement = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            jumping: false
        };
        this.moveSpeed = 0.15;
        this.jumpForce = 0.3;
        this.gravity = 0.015;
        this.verticalVelocity = 0;
        this.init();
    }

    init() {
        // Setup renderer
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x87CEEB); // Sky blue color
        document.getElementById('game-container').appendChild(this.renderer.domElement);

        // Setup camera
        this.camera.position.set(0, 5, 8);
        this.camera.lookAt(0, 0, 0);

        // Add lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(50, 50, 50);
        directionalLight.castShadow = true;
        this.scene.add(directionalLight);

        // Add ground (larger map)
        const groundGeometry = new THREE.PlaneGeometry(400, 400);
        const groundMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x90EE90,
            metalness: 0.1,
            roughness: 0.8
        });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        this.scene.add(ground);

        // Add obstacles and clouds
        this.addObstacles();
        this.addClouds();

        // Handle window resize
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });

        // Add pointer lock
        const gameContainer = document.getElementById('game-container');
        gameContainer.addEventListener('click', () => {
            gameContainer.requestPointerLock();
        });

        document.addEventListener('pointerlockchange', () => {
            if (document.pointerLockElement === gameContainer) {
                document.addEventListener('mousemove', this.handleMouseMove.bind(this));
            } else {
                document.removeEventListener('mousemove', this.handleMouseMove.bind(this));
            }
        });

        // Handle movement keys
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        document.addEventListener('keyup', (e) => this.handleKeyUp(e));

        // Handle Tab key for scoreboard
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                document.getElementById('scoreboard').style.display = 'block';
                this.updateScoreboard();
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                document.getElementById('scoreboard').style.display = 'none';
            }
        });

        // Setup username modal
        const usernameModal = document.getElementById('username-modal');
        const usernameInput = document.getElementById('username-input');
        const startButton = document.getElementById('start-button');

        startButton.addEventListener('click', () => {
            const username = usernameInput.value.trim();
            if (username) {
                this.startGame(username);
                usernameModal.style.display = 'none';
            }
        });

        // Start animation loop
        this.animate();
    }

    addClouds() {
        const cloudGeometry = new THREE.SphereGeometry(4, 8, 8);
        const cloudMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.8
        });

        for (let i = 0; i < 20; i++) {
            const cloud = new THREE.Group();
            
            // Create cloud parts
            for (let j = 0; j < 5; j++) {
                const part = new THREE.Mesh(cloudGeometry, cloudMaterial);
                part.position.x = (Math.random() - 0.5) * 5;
                part.position.y = (Math.random() - 0.5) * 2;
                part.position.z = (Math.random() - 0.5) * 5;
                part.scale.setScalar(0.5 + Math.random() * 0.5);
                cloud.add(part);
            }

            cloud.position.set(
                (Math.random() - 0.5) * 180,
                30 + Math.random() * 20,
                (Math.random() - 0.5) * 180
            );

            this.clouds.push({
                mesh: cloud,
                speed: 0.02 + Math.random() * 0.05
            });

            this.scene.add(cloud);
        }
    }

    addObstacles() {
        // Add various obstacles around the map
        const obstacleGeometry = new THREE.BoxGeometry(8, 16, 8);
        const obstacleMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xFFFFF0, // Ivory color
            metalness: 0.2,
            roughness: 0.7
        });
        
        // Create more obstacle positions in a grid pattern
        const obstaclePositions = [];
        const gridSize = 6; // 6x6 grid of obstacles
        const spacing = 50; // Space between obstacles

        for (let i = -gridSize/2; i < gridSize/2; i++) {
            for (let j = -gridSize/2; j < gridSize/2; j++) {
                // Add some randomness to positions
                const offsetX = (Math.random() - 0.5) * 20;
                const offsetZ = (Math.random() - 0.5) * 20;
                obstaclePositions.push({
                    x: i * spacing + offsetX,
                    z: j * spacing + offsetZ
                });
            }
        }

        // Add some random smaller obstacles
        const smallObstacleGeometry = new THREE.BoxGeometry(4, 8, 4);
        for (let i = 0; i < 20; i++) {
            const x = (Math.random() - 0.5) * 350;
            const z = (Math.random() - 0.5) * 350;
            const obstacle = new THREE.Mesh(smallObstacleGeometry, obstacleMaterial);
            obstacle.position.set(x, 4, z);
            this.scene.add(obstacle);
        }

        // Add main obstacles
        obstaclePositions.forEach(pos => {
            const obstacle = new THREE.Mesh(obstacleGeometry, obstacleMaterial);
            obstacle.position.set(pos.x, 8, pos.z);
            this.scene.add(obstacle);
        });
    }

    startGame(username) {
        // Connect to server
        this.socket = io('http://localhost:3000');
        
        // Create player
        this.playerData = {
            id: null,
            username,
            position: { x: (Math.random() - 0.5) * 360, y: 1, z: (Math.random() - 0.5) * 360 },
            rotation: 0,
            isTagger: false,
            isShielded: true,
            color: '#00FFFF', // Cyan color for runners
            score: 0,
            distanceRun: 0,
            lastPosition: null
        };

        // Initial shield protection (3 seconds)
        this.shieldActive = true;
        const shieldStatus = document.getElementById('game-status');
        shieldStatus.textContent = 'Shield Active (3s)';
        shieldStatus.classList.add('shield-active');

        setTimeout(() => {
            this.shieldActive = false;
            this.playerData.isShielded = false;
            this.socket.emit('shield-expired', this.playerData.id);
            this.updateGameStatus();
            shieldStatus.classList.remove('shield-active');
        }, 3000);

        // Socket events
        this.socket.on('connect', () => {
            this.playerData.id = this.socket.id;
            this.socket.emit('join', this.playerData);
        });

        this.socket.on('game-state', (gameState) => {
            document.getElementById('player-count').textContent = 
                `Players: ${gameState.playerCount} | Taggers: ${gameState.taggerCount} | Time: ${gameState.timeLeft}s`;
            
            // Update local player state from server
            if (gameState.players[this.playerData.id]) {
                this.playerData.isTagger = gameState.players[this.playerData.id].isTagger;
                this.playerData.color = gameState.players[this.playerData.id].color;
                this.playerData.score = gameState.players[this.playerData.id].score;
            }

            // Update game status
            if (!this.shieldActive) {
                this.updateGameStatus();
            }
            
            // Update players
            for (const id in gameState.players) {
                if (!this.players.has(id)) {
                    this.addPlayer(gameState.players[id]);
                } else {
                    this.updatePlayer(gameState.players[id]);
                }
            }

            // Remove disconnected players
            for (const [id, mesh] of this.players) {
                if (!gameState.players[id]) {
                    this.scene.remove(mesh);
                    this.players.delete(id);
                }
            }
        });

        this.socket.on('tagged', (data) => {
            if (data.id === this.playerData.id) {
                this.playerData.isTagger = true;
                this.playerData.color = '#FF0000';
                this.updateGameStatus();
            }
        });

        this.socket.on('game-over', (data) => {
            const gameOverModal = document.getElementById('game-over-modal');
            const gameResult = document.getElementById('game-result');
            const mvpName = document.getElementById('mvp-name');
            const mvpScore = document.getElementById('mvp-score');

            // Show game over modal
            gameOverModal.style.display = 'block';

            // Update result text
            if (data.runnersWon) {
                gameResult.textContent = 'Runners Win!';
                gameResult.className = 'game-result winner';
            } else {
                gameResult.textContent = 'Taggers Win!';
                gameResult.className = 'game-result loser';
            }

            // Update MVP info
            mvpName.textContent = data.mvp.username;
            mvpScore.textContent = data.mvp.isRunner ? 
                `Distance: ${data.mvp.score}` :
                `Tags: ${data.mvp.score}`;

            // Hide modal after 5 seconds
            setTimeout(() => {
                gameOverModal.style.display = 'none';
            }, 5000);
        });

        // Handle movement and sprint
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Shift' && !this.sprintActive && this.sprintCooldown <= 0) {
                this.startSprint();
            }
        });

        document.addEventListener('keydown', (e) => {
            const baseSpeed = 0.2;
            const speed = this.sprintActive ? baseSpeed * 2 : baseSpeed;
            let moved = false;

            switch(e.key) {
                case 'ArrowUp':
                case 'w':
                    this.playerData.position.z -= speed;
                    moved = true;
                    break;
                case 'ArrowDown':
                case 's':
                    this.playerData.position.z += speed;
                    moved = true;
                    break;
                case 'ArrowLeft':
                case 'a':
                    this.playerData.position.x -= speed;
                    moved = true;
                    break;
                case 'ArrowRight':
                case 'd':
                    this.playerData.position.x += speed;
                    moved = true;
                    break;
            }

            if (moved && this.socket) {
                // Keep player within bounds
                this.playerData.position.x = Math.max(-100, Math.min(100, this.playerData.position.x));
                this.playerData.position.z = Math.max(-100, Math.min(100, this.playerData.position.z));
                
                this.socket.emit('move', this.playerData);
                this.updateCameraPosition();
            }
        });
    }

    updateGameStatus() {
        const gameStatus = document.getElementById('game-status');
        if (this.playerData.isTagger) {
            gameStatus.textContent = 'Tag!';
            gameStatus.style.color = '#FF0000';
        } else {
            gameStatus.textContent = 'Run!';
            gameStatus.style.color = '#00FFFF';
        }
    }

    startSprint() {
        this.sprintActive = true;
        const sprintStatus = document.getElementById('sprint-status');
        sprintStatus.textContent = 'Sprinting...';
        sprintStatus.className = 'hud';

        setTimeout(() => {
            this.sprintActive = false;
            this.sprintCooldown = 6;
            
            // Cooldown timer
            const cooldownInterval = setInterval(() => {
                this.sprintCooldown--;
                sprintStatus.textContent = `Sprint Cooldown: ${this.sprintCooldown}s`;
                sprintStatus.className = 'hud sprint-cooldown';
                
                if (this.sprintCooldown <= 0) {
                    clearInterval(cooldownInterval);
                    sprintStatus.textContent = 'Sprint Ready';
                    sprintStatus.className = 'hud sprint-ready';
                }
            }, 1000);
        }, 3000);
    }

    createPlayerModel(color) {
        const player = new THREE.Group();

        // Body
        const bodyGeometry = new THREE.BoxGeometry(1, 1.5, 0.5);
        const bodyMaterial = new THREE.MeshStandardMaterial({ color: color });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = 0.75;
        player.add(body);

        // Head (as a group to rotate independently)
        const headGroup = new THREE.Group();
        const headGeometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
        const headMaterial = new THREE.MeshStandardMaterial({ color: color });
        const head = new THREE.Mesh(headGeometry, headMaterial);
        headGroup.add(head);

        // Eyes (added to head group)
        const eyeGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
        const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 });
        
        const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        leftEye.position.set(-0.15, 0, 0.3);
        headGroup.add(leftEye);
        
        const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        rightEye.position.set(0.15, 0, 0.3);
        headGroup.add(rightEye);

        headGroup.position.y = 1.75;
        player.add(headGroup);

        // Arms (as groups for animation)
        const armGeometry = new THREE.BoxGeometry(0.25, 0.75, 0.25);
        
        const leftArmGroup = new THREE.Group();
        const leftArm = new THREE.Mesh(armGeometry, bodyMaterial);
        leftArm.position.y = -0.375; // Center the rotation point
        leftArmGroup.add(leftArm);
        leftArmGroup.position.set(-0.625, 1.375, 0);
        player.add(leftArmGroup);

        const rightArmGroup = new THREE.Group();
        const rightArm = new THREE.Mesh(armGeometry, bodyMaterial);
        rightArm.position.y = -0.375; // Center the rotation point
        rightArmGroup.add(rightArm);
        rightArmGroup.position.set(0.625, 1.375, 0);
        player.add(rightArmGroup);

        // Legs (as groups for animation)
        const legGeometry = new THREE.BoxGeometry(0.25, 0.75, 0.25);
        
        const leftLegGroup = new THREE.Group();
        const leftLeg = new THREE.Mesh(legGeometry, bodyMaterial);
        leftLeg.position.y = -0.375; // Center the rotation point
        leftLegGroup.add(leftLeg);
        leftLegGroup.position.set(-0.25, 0.75, 0);
        player.add(leftLegGroup);

        const rightLegGroup = new THREE.Group();
        const rightLeg = new THREE.Mesh(legGeometry, bodyMaterial);
        rightLeg.position.y = -0.375; // Center the rotation point
        rightLegGroup.add(rightLeg);
        rightLegGroup.position.set(0.25, 0.75, 0);
        player.add(rightLegGroup);

        // Store references for animation
        player.headGroup = headGroup;
        player.leftArmGroup = leftArmGroup;
        player.rightArmGroup = rightArmGroup;
        player.leftLegGroup = leftLegGroup;
        player.rightLegGroup = rightLegGroup;
        player.animationTime = 0;

        return player;
    }

    addPlayer(playerData) {
        const player = this.createPlayerModel(playerData.isTagger ? '#FF0000' : '#00FFFF');
        
        player.position.set(
            playerData.position.x,
            playerData.position.y,
            playerData.position.z
        );

        if (playerData.isShielded) {
            player.traverse((child) => {
                if (child.isMesh) {
                    child.material.transparent = true;
                    child.material.opacity = 0.5;
                }
            });
        }

        this.scene.add(player);
        this.players.set(playerData.id, player);
    }

    updatePlayer(playerData) {
        const player = this.players.get(playerData.id);
        if (player) {
            // Update position
            player.position.set(
                playerData.position.x,
                playerData.position.y,
                playerData.position.z
            );
            
            // Update head rotation for all players
            if (playerData.id === this.playerData.id) {
                // For local player, use camera rotation and limited head turn
                player.rotation.y = this.cameraRotation;
                player.headGroup.rotation.y = this.headRotation;

                // If head rotation is at max, start turning the body
                if (Math.abs(this.headRotation) >= this.maxHeadRotation * 0.8) {
                    const turnSpeed = 0.05;
                    if (this.headRotation > 0) {
                        // Turn body right, reset head
                        player.rotation.y += turnSpeed;
                        this.cameraRotation += turnSpeed;
                        this.headRotation -= turnSpeed;
                    } else {
                        // Turn body left, reset head
                        player.rotation.y -= turnSpeed;
                        this.cameraRotation -= turnSpeed;
                        this.headRotation += turnSpeed;
                    }
                }
            } else {
                // For other players, calculate rotation based on movement
                if (player.lastPosition) {
                    const dx = playerData.position.x - player.lastPosition.x;
                    const dz = playerData.position.z - player.lastPosition.z;
                    if (dx !== 0 || dz !== 0) {
                        const targetRotation = Math.atan2(dx, dz);
                        player.rotation.y = targetRotation;
                        player.headGroup.rotation.y = 0; // Reset head rotation for other players
                    }
                }
            }
            player.lastPosition = { ...playerData.position };

            // Update running animation
            const isMoving = 
                (playerData.position.x !== player.lastPosition.x) ||
                (playerData.position.z !== player.lastPosition.z);

            if (isMoving) {
                player.animationTime += 0.15;
                const swingAngle = Math.PI/4;
                
                // Animate arms and legs in opposite phases
                player.leftArmGroup.rotation.x = Math.sin(player.animationTime) * swingAngle;
                player.rightArmGroup.rotation.x = -Math.sin(player.animationTime) * swingAngle;
                player.leftLegGroup.rotation.x = -Math.sin(player.animationTime) * swingAngle;
                player.rightLegGroup.rotation.x = Math.sin(player.animationTime) * swingAngle;
            } else {
                // Reset animation when not moving
                player.leftArmGroup.rotation.x = 0;
                player.rightArmGroup.rotation.x = 0;
                player.leftLegGroup.rotation.x = 0;
                player.rightLegGroup.rotation.x = 0;
                player.animationTime = 0;
            }
            
            // Update player appearance
            player.traverse((child) => {
                if (child.isMesh && child.material.color) {
                    // Don't change color of eyes
                    if (child.parent !== player.headGroup || child === player.headGroup.children[0]) {
                        child.material.color.setStyle(playerData.isTagger ? '#FF0000' : '#00FFFF');
                    }
                    child.material.transparent = playerData.isShielded;
                    child.material.opacity = playerData.isShielded ? 0.5 : 1;
                }
            });
        }
    }

    updateCameraPosition() {
        if (!this.playerData) return;

        const distance = 8;
        const baseHeight = 5;
        
        // Calculate camera position using spherical coordinates
        const horizontalDistance = distance * Math.cos(this.cameraPitch);
        const verticalDistance = distance * Math.sin(this.cameraPitch);
        
        // Calculate camera position
        const cameraX = this.playerData.position.x + Math.sin(this.cameraRotation) * horizontalDistance;
        const cameraY = this.playerData.position.y + baseHeight + verticalDistance;
        const cameraZ = this.playerData.position.z + Math.cos(this.cameraRotation) * horizontalDistance;
        
        this.camera.position.set(cameraX, cameraY, cameraZ);

        // Look at player
        this.camera.lookAt(
            this.playerData.position.x,
            this.playerData.position.y + 1, // Look at player's head level
            this.playerData.position.z
        );

        // Update player's last position for distance calculation
        if (!this.playerData.lastPosition) {
            this.playerData.lastPosition = { ...this.playerData.position };
        } else {
            const dx = this.playerData.position.x - this.playerData.lastPosition.x;
            const dz = this.playerData.position.z - this.playerData.lastPosition.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            this.playerData.distanceRun += distance;
            this.playerData.lastPosition = { ...this.playerData.position };
        }
    }

    handleMouseMove(e) {
        const movementX = e.movementX || 0;
        const movementY = e.movementY || 0;
        
        // Back to original movement (negative for right turn)
        this.cameraRotation -= movementX * 0.002;
        // Back to original vertical movement
        this.cameraPitch -= movementY * 0.002;
        
        // Calculate head rotation relative to body
        this.headRotation = Math.max(-this.maxHeadRotation, 
            Math.min(this.maxHeadRotation, this.headRotation - movementX * 0.002));
        
        // Limit vertical rotation to prevent camera flipping
        this.cameraPitch = Math.max(-Math.PI/2 + 0.1, Math.min(Math.PI/2 - 0.1, this.cameraPitch));
        
        this.updateCameraPosition();
    }

    handleKeyDown(e) {
        if (e.key === 'Shift' && !this.sprintActive && this.sprintCooldown <= 0) {
            this.startSprint();
            return;
        }

        switch(e.key.toLowerCase()) {
            case 'w':
            case 'arrowup':
                this.movement.forward = true;
                break;
            case 's':
            case 'arrowdown':
                this.movement.backward = true;
                break;
            case 'a':
            case 'arrowleft':
                this.movement.left = true;
                break;
            case 'd':
            case 'arrowright':
                this.movement.right = true;
                break;
            case ' ':
                if (!this.movement.jumping && this.playerData.position.y <= 1) {
                    this.movement.jumping = true;
                    this.verticalVelocity = this.jumpForce;
                }
                break;
        }
    }

    handleKeyUp(e) {
        switch(e.key.toLowerCase()) {
            case 'w':
            case 'arrowup':
                this.movement.forward = false;
                break;
            case 's':
            case 'arrowdown':
                this.movement.backward = false;
                break;
            case 'a':
            case 'arrowleft':
                this.movement.left = false;
                break;
            case 'd':
            case 'arrowright':
                this.movement.right = false;
                break;
        }
    }

    updatePlayerPosition() {
        if (!this.playerData) return;

        const speed = this.sprintActive ? this.moveSpeed * 2 : this.moveSpeed;
        let moveX = 0;
        let moveZ = 0;

        // Calculate movement relative to camera view
        const forward = new THREE.Vector3(
            -Math.sin(this.cameraRotation),
            0,
            -Math.cos(this.cameraRotation)
        );
        const right = new THREE.Vector3(
            Math.sin(this.cameraRotation + Math.PI/2),
            0,
            Math.cos(this.cameraRotation + Math.PI/2)
        );

        // Normalize movement vectors for consistent speed in all directions
        forward.normalize();
        right.normalize();

        if (this.movement.forward) {
            moveX += forward.x * speed;
            moveZ += forward.z * speed;
        }
        if (this.movement.backward) {
            moveX -= forward.x * speed;
            moveZ -= forward.z * speed;
        }
        if (this.movement.left) {
            moveX -= right.x * speed;
            moveZ -= right.z * speed;
        }
        if (this.movement.right) {
            moveX += right.x * speed;
            moveZ += right.z * speed;
        }

        // Normalize diagonal movement to maintain consistent speed
        if (moveX !== 0 && moveZ !== 0) {
            const length = Math.sqrt(moveX * moveX + moveZ * moveZ);
            moveX = (moveX / length) * speed;
            moveZ = (moveZ / length) * speed;
        }

        // Apply jumping and gravity
        this.verticalVelocity -= this.gravity;
        this.playerData.position.y += this.verticalVelocity;

        // Ground collision
        if (this.playerData.position.y <= 1) {
            this.playerData.position.y = 1;
            this.verticalVelocity = 0;
            this.movement.jumping = false;
        }

        // Apply horizontal movement
        if (moveX !== 0 || moveZ !== 0) {
            this.playerData.position.x += moveX;
            this.playerData.position.z += moveZ;

            // Keep player within bounds
            this.playerData.position.x = Math.max(-200, Math.min(200, this.playerData.position.x));
            this.playerData.position.z = Math.max(-200, Math.min(200, this.playerData.position.z));
        }

        // Emit position update if there was any movement
        if (moveX !== 0 || moveZ !== 0 || this.verticalVelocity !== 0) {
            this.socket.emit('move', this.playerData);
        }
    }

    updateScoreboard() {
        const tbody = document.getElementById('scoreboard-body');
        tbody.innerHTML = '';

        Object.values(this.players).forEach((player, index) => {
            const playerData = Object.values(this.socket.gameState.players).find(p => p.id === Array.from(this.players.keys())[index]);
            if (playerData) {
                const row = document.createElement('tr');
                row.className = playerData.isTagger ? 'tagger-row' : 'runner-row';
                row.innerHTML = `
                    <td>${playerData.username}</td>
                    <td>${playerData.isTagger ? 'Tagger' : 'Runner'}</td>
                    <td>${playerData.score}</td>
                    <td>${Math.floor(playerData.distanceRun)}</td>
                `;
                tbody.appendChild(row);
            }
        });
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        // Animate clouds
        this.clouds.forEach(cloud => {
            cloud.mesh.position.x += cloud.speed;
            
            // Wrap clouds around the map
            if (cloud.mesh.position.x > 100) {
                cloud.mesh.position.x = -100;
            }
        });

        // Update camera position every frame to ensure smooth camera movement
        this.updateCameraPosition();
        
        // Update player position based on movement state
        this.updatePlayerPosition();

        this.renderer.render(this.scene, this.camera);
    }
}

// Start the game
new Game(); 