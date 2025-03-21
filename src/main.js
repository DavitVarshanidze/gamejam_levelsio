import * as THREE from 'three';
import { io } from 'socket.io-client';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

class Game {
    constructor() {
        this.players = new Map();
        this.playerData = null;
        this.socket = null;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.controls = null;
        this.clouds = [];
        this.sprintCooldown = 0;
        this.sprintActive = false;
        this.shieldActive = false;
        this.cameraRotation = 0;
        this.cameraPitch = 0;
        this.eyeHeight = 1.7; // Height of camera (player's eyes)
        this.movement = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            jumping: false
        };
        this.moveSpeed = 0.2;
        this.sprintSpeed = 0.4;
        this.acceleration = 0.1;
        this.deceleration = 0.15;
        this.currentVelocity = new THREE.Vector3();
        this.targetVelocity = new THREE.Vector3();
        this.collisionBoxes = [];
        this.playerRadius = 0.5; // Collision radius for player
        this.playerHeight = 1.7; // Player height for collision
        this.jumpForce = 0.3;
        this.gravity = 0.015;
        this.verticalVelocity = 0;
        this.mouseSensitivity = 0.001; // Reduced from 0.002 (50% reduction)
        this.handModel = null;
        this.handAnimationTime = 0;
        this.isHandAnimating = false;
        this.isGameOver = false;
        this.cinematicCamera = null;
        this.isCinematicView = false;
        this.cinematicStartTime = 0;
        this.cinematicDuration = 3000; // 3 seconds
        this.lastTaggedPlayer = null;
        this.lastTaggerPlayer = null;
        this.init();
    }

    init() {
        // Setup renderer
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x87CEEB); // Sky blue color
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.getElementById('game-container').appendChild(this.renderer.domElement);

        // Setup camera
        this.camera.position.set(0, 5, 8);
        this.camera.lookAt(0, 0, 0);

        // Add lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(100, 100, 50);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 500;
        this.scene.add(directionalLight);

        // Add ground (larger map)
        const groundGeometry = new THREE.PlaneGeometry(800, 800);
        const groundMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x90EE90,
            metalness: 0.1,
            roughness: 0.8
        });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);

        // Initialize collision boxes array
        this.collisionBoxes = [];

        // Add obstacles, buildings, and environment
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

        // Handle Tab key for leaderboard
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                document.getElementById('leaderboard').style.display = 'block';
                this.updateLeaderboard();
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                document.getElementById('leaderboard').style.display = 'none';
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

        // Add mouse click handler for tagging
        document.addEventListener('mousedown', (e) => {
            if (e.button === 0) { // Left click
                this.animateHand();
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
        // Create building materials
        const buildingMaterial = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            metalness: 0.2,
            roughness: 0.8
        });
        const roofMaterial = new THREE.MeshStandardMaterial({
            color: 0x8b4513,
            metalness: 0.1,
            roughness: 0.9
        });
        const windowMaterial = new THREE.MeshStandardMaterial({
            color: 0x87ceeb,
            metalness: 0.5,
            roughness: 0.2,
            transparent: true,
            opacity: 0.7
        });

        // Add houses and buildings
        const buildingPositions = [
            { x: -150, z: -150, type: 'house' },
            { x: 150, z: 150, type: 'house' },
            { x: -150, z: 150, type: 'building' },
            { x: 150, z: -150, type: 'building' },
            { x: 0, z: -100, type: 'house' },
            { x: 0, z: 100, type: 'building' },
            { x: -100, z: 0, type: 'house' },
            { x: 100, z: 0, type: 'building' }
        ];

        buildingPositions.forEach(pos => {
            if (pos.type === 'house') {
                this.addHouse(pos.x, pos.z, buildingMaterial, roofMaterial, windowMaterial);
            } else {
                this.addBuilding(pos.x, pos.z, buildingMaterial, windowMaterial);
            }
        });

        // Add trees and rocks for cover
        const smallObstacles = [];
        for (let i = 0; i < 50; i++) {
            const x = (Math.random() - 0.5) * 380;
            const z = (Math.random() - 0.5) * 380;
            // Check distance from buildings
            if (!buildingPositions.some(pos => 
                Math.sqrt((x - pos.x) ** 2 + (z - pos.z) ** 2) < 20)) {
                smallObstacles.push({ x, z });
            }
        }

        smallObstacles.forEach(pos => {
            if (Math.random() < 0.7) {
                this.addTree(pos.x, pos.z);
            } else {
                this.addRock(pos.x, pos.z);
            }
        });
    }

    addHouse(x, z, buildingMaterial, roofMaterial, windowMaterial) {
        const house = new THREE.Group();

        // Main structure
        const walls = new THREE.Mesh(
            new THREE.BoxGeometry(20, 15, 20),
            buildingMaterial
        );
        walls.position.y = 7.5;
        house.add(walls);

        // Roof (pyramid)
        const roofGeometry = new THREE.ConeGeometry(15, 10, 4);
        const roof = new THREE.Mesh(roofGeometry, roofMaterial);
        roof.position.y = 20;
        roof.rotation.y = Math.PI / 4;
        house.add(roof);

        // Door
        const door = new THREE.Mesh(
            new THREE.BoxGeometry(4, 8, 0.5),
            new THREE.MeshStandardMaterial({ color: 0x4a3520 })
        );
        door.position.set(0, 4, 10.1);
        house.add(door);

        // Windows
        const windowGeometry = new THREE.BoxGeometry(4, 4, 0.5);
        const windowPositions = [
            { x: -5, z: 10.1 }, { x: 5, z: 10.1 }, // Front
            { x: -5, z: -10.1 }, { x: 5, z: -10.1 }, // Back
            { x: 10.1, z: -5 }, { x: 10.1, z: 5 }, // Right
            { x: -10.1, z: -5 }, { x: -10.1, z: 5 } // Left
        ];

        windowPositions.forEach(pos => {
            const window = new THREE.Mesh(windowGeometry, windowMaterial);
            window.position.set(pos.x, 8, pos.z);
            if (Math.abs(pos.x) > 10) {
                window.rotation.y = Math.PI / 2;
            }
            house.add(window);
        });

        // Add collision box for the house
        const collisionBox = new THREE.Box3(
            new THREE.Vector3(x - 10, 0, z - 10),
            new THREE.Vector3(x + 10, 15, z + 10)
        );
        this.collisionBoxes.push(collisionBox);

        house.position.set(x, 0, z);
        this.scene.add(house);
    }

    addBuilding(x, z, buildingMaterial, windowMaterial) {
        const building = new THREE.Group();

        // Main structure (taller than houses)
        const structure = new THREE.Mesh(
            new THREE.BoxGeometry(25, 30, 25),
            buildingMaterial
        );
        structure.position.y = 15;
        building.add(structure);

        // Windows (grid pattern)
        const windowGeometry = new THREE.BoxGeometry(3, 3, 0.5);
        for (let floor = 0; floor < 5; floor++) {
            for (let column = 0; column < 3; column++) {
                // Front windows
                const frontWindow = new THREE.Mesh(windowGeometry, windowMaterial);
                frontWindow.position.set((column - 1) * 6, floor * 6 + 5, 12.6);
                building.add(frontWindow);

                // Back windows
                const backWindow = new THREE.Mesh(windowGeometry, windowMaterial);
                backWindow.position.set((column - 1) * 6, floor * 6 + 5, -12.6);
                building.add(backWindow);

                // Side windows
                const rightWindow = new THREE.Mesh(windowGeometry, windowMaterial);
                rightWindow.position.set(12.6, floor * 6 + 5, (column - 1) * 6);
                rightWindow.rotation.y = Math.PI / 2;
                building.add(rightWindow);

                const leftWindow = new THREE.Mesh(windowGeometry, windowMaterial);
                leftWindow.position.set(-12.6, floor * 6 + 5, (column - 1) * 6);
                leftWindow.rotation.y = Math.PI / 2;
                building.add(leftWindow);
            }
        }

        // Add collision box for the building
        const collisionBox = new THREE.Box3(
            new THREE.Vector3(x - 12.5, 0, z - 12.5),
            new THREE.Vector3(x + 12.5, 30, z + 12.5)
        );
        this.collisionBoxes.push(collisionBox);

        building.position.set(x, 0, z);
        this.scene.add(building);
    }

    addTree(x, z) {
        const tree = new THREE.Group();

        // Trunk
        const trunk = new THREE.Mesh(
            new THREE.CylinderGeometry(0.5, 0.8, 8, 8),
            new THREE.MeshStandardMaterial({ color: 0x4a3520 })
        );
        trunk.position.y = 4;
        tree.add(trunk);

        // Leaves (multiple layers for fuller look)
        const leafMaterial = new THREE.MeshStandardMaterial({ color: 0x2d5a27 });
        for (let i = 0; i < 3; i++) {
            const leaves = new THREE.Mesh(
                new THREE.ConeGeometry(3 - i * 0.5, 6, 8),
                leafMaterial
            );
            leaves.position.y = 8 + i * 2;
            tree.add(leaves);
        }

        // Add collision cylinder
        const collisionRadius = 2;
        const collisionBox = new THREE.Box3(
            new THREE.Vector3(x - collisionRadius, 0, z - collisionRadius),
            new THREE.Vector3(x + collisionRadius, 12, z + collisionRadius)
        );
        this.collisionBoxes.push(collisionBox);

        tree.position.set(x, 0, z);
        this.scene.add(tree);
    }

    addRock(x, z) {
        const rockGeometry = new THREE.DodecahedronGeometry(2 + Math.random() * 2);
        const rockMaterial = new THREE.MeshStandardMaterial({
            color: 0x808080,
            roughness: 0.9,
            metalness: 0.1
        });
        const rock = new THREE.Mesh(rockGeometry, rockMaterial);
        
        rock.position.set(x, 2, z);
        rock.rotation.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI,
            Math.random() * Math.PI
        );

        // Add collision box
        const collisionBox = new THREE.Box3(
            new THREE.Vector3(x - 2, 0, z - 2),
            new THREE.Vector3(x + 2, 4, z + 2)
        );
        this.collisionBoxes.push(collisionBox);

        this.scene.add(rock);
    }

    startGame(username) {
        // Connect to server
        this.socket = io('http://localhost:3000');
        
        // Create player with random spawn position
        const spawnPoint = this.getRandomSpawnPoint();
        this.playerData = {
            id: null,
            username,
            position: spawnPoint,
            rotation: 0,
            isTagger: false,
            isShielded: true,
            color: '#00FFFF',
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
            this.createHandModel(); // Add hand after connecting
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
                this.updateHandColor();
            }
            
            // Show cinematic view for final tag
            if (data.isLastTag) {
                console.log('Last tag detected, showing cinematic view');
                // Disable movement immediately
                this.movement = {
                    forward: false,
                    backward: false,
                    left: false,
                    right: false,
                    jumping: false
                };
                this.sprintActive = false;
                
                // Get tagger and tagged player data
                const taggerMesh = this.players.get(data.tagger.id);
                const taggedMesh = this.players.get(data.tagged.id);
                
                if (taggerMesh && taggedMesh) {
                    const tagger = {
                        ...data.tagger,
                        position: {
                            x: taggerMesh.position.x,
                            y: taggerMesh.position.y,
                            z: taggerMesh.position.z
                        }
                    };
                    
                    const tagged = {
                        ...data.tagged,
                        position: {
                            x: taggedMesh.position.x,
                            y: taggedMesh.position.y,
                            z: taggedMesh.position.z
                        }
                    };
                    
                    console.log('Starting cinematic with:', { tagger, tagged });
                    this.showCinematicView(tagger, tagged);
                }
            }
        });

        this.socket.on('game-over', (data) => {
            const gameOverModal = document.getElementById('game-over-modal');
            const gameResult = document.getElementById('game-result');
            const mvpName = document.getElementById('mvp-name');
            const mvpScore = document.getElementById('mvp-score');

            // Disable movement
            this.movement = {
                forward: false,
                backward: false,
                left: false,
                right: false,
                jumping: false
            };
            this.sprintActive = false;
            this.isGameOver = true;

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

            // Hide modal and reset game after 5 seconds
            setTimeout(() => {
                gameOverModal.style.display = 'none';
                this.isGameOver = false;
                this.respawnPlayer();
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
        if (this.sprintCooldown > 0 || this.sprintActive) return;

        this.sprintActive = true;
        const sprintStatus = document.getElementById('sprint-status');
        sprintStatus.textContent = 'Sprinting...';
        sprintStatus.className = 'hud sprint-active';

        // Sprint duration
        setTimeout(() => {
            this.sprintActive = false;
            this.sprintCooldown = 6;
            
            // Start cooldown timer
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
        if (!player) return;

        // Initialize lastPosition if it doesn't exist
        if (!player.lastPosition) {
            player.lastPosition = { x: playerData.position.x, y: playerData.position.y, z: playerData.position.z };
        }

        // Update position
        player.position.set(
            playerData.position.x,
            playerData.position.y,
            playerData.position.z
        );
        
        // Only rotate other players' models, not the local player
        if (playerData.id !== this.playerData.id) {
            // Calculate rotation based on movement
            const dx = playerData.position.x - player.lastPosition.x;
            const dz = playerData.position.z - player.lastPosition.z;
            if (dx !== 0 || dz !== 0) {
                const targetRotation = Math.atan2(dx, dz);
                player.rotation.y = targetRotation;
                if (player.headGroup) {
                    player.headGroup.rotation.y = 0;
                }
            }
            
            // Update running animation
            const isMoving = Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001;
            if (isMoving && player.leftArmGroup) {
                player.animationTime += 0.15;
                const swingAngle = Math.PI/4;
                
                player.leftArmGroup.rotation.x = Math.sin(player.animationTime) * swingAngle;
                player.rightArmGroup.rotation.x = -Math.sin(player.animationTime) * swingAngle;
                player.leftLegGroup.rotation.x = -Math.sin(player.animationTime) * swingAngle;
                player.rightLegGroup.rotation.x = Math.sin(player.animationTime) * swingAngle;
            } else if (player.leftArmGroup) {
                player.leftArmGroup.rotation.x = 0;
                player.rightArmGroup.rotation.x = 0;
                player.leftLegGroup.rotation.x = 0;
                player.rightLegGroup.rotation.x = 0;
                player.animationTime = 0;
            }
        } else {
            // Hide the local player's model in first person
            player.visible = false;
        }
        
        // Update last position
        player.lastPosition.x = playerData.position.x;
        player.lastPosition.y = playerData.position.y;
        player.lastPosition.z = playerData.position.z;
        
        // Update player appearance
        player.traverse((child) => {
            if (child.isMesh && child.material.color) {
                if (child.parent !== player.headGroup || child === player.headGroup.children[0]) {
                    child.material.color.setStyle(playerData.isTagger ? '#FF0000' : '#00FFFF');
                }
                child.material.transparent = playerData.isShielded;
                child.material.opacity = playerData.isShielded ? 0.5 : 1;
            }
        });
    }

    updateCameraPosition() {
        if (!this.playerData) return;

        // Set camera position to player's eye level
        this.camera.position.set(
            this.playerData.position.x,
            this.playerData.position.y + this.eyeHeight,
            this.playerData.position.z
        );

        // Calculate look direction
        const lookX = this.playerData.position.x - Math.sin(this.cameraRotation) * Math.cos(this.cameraPitch);
        const lookY = this.playerData.position.y + this.eyeHeight + Math.sin(this.cameraPitch);
        const lookZ = this.playerData.position.z - Math.cos(this.cameraRotation) * Math.cos(this.cameraPitch);

        this.camera.lookAt(lookX, lookY, lookZ);

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
        
        // Update camera rotation with reduced sensitivity
        this.cameraRotation -= movementX * this.mouseSensitivity;
        this.cameraPitch -= movementY * this.mouseSensitivity;
        
        // Limit vertical rotation to prevent flipping
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
        if (!this.playerData || this.isGameOver) return;

        const speed = this.sprintActive ? this.sprintSpeed : this.moveSpeed;
        
        // Calculate target velocity based on input
        this.targetVelocity.set(0, 0, 0);
        
        // Get movement direction relative to camera
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

        // Normalize vectors
        forward.normalize();
        right.normalize();

        // Apply movement inputs
        if (this.movement.forward) this.targetVelocity.add(forward);
        if (this.movement.backward) this.targetVelocity.sub(forward);
        if (this.movement.left) this.targetVelocity.sub(right);
        if (this.movement.right) this.targetVelocity.add(right);

        // Normalize and apply speed if moving
        if (this.targetVelocity.lengthSq() > 0) {
            this.targetVelocity.normalize().multiplyScalar(speed);
        }

        // Smoothly interpolate current velocity towards target velocity
        const acceleration = this.targetVelocity.lengthSq() > 0 ? this.acceleration : this.deceleration;
        this.currentVelocity.lerp(this.targetVelocity, acceleration);

        // Store current position for collision detection
        const currentPosition = new THREE.Vector3(
            this.playerData.position.x,
            this.playerData.position.y,
            this.playerData.position.z
        );

        // Apply vertical movement (jumping/falling)
        this.verticalVelocity -= this.gravity;
        this.playerData.position.y += this.verticalVelocity;

        // Ground collision
        if (this.playerData.position.y <= 1) {
            this.playerData.position.y = 1;
            this.verticalVelocity = 0;
            this.movement.jumping = false;
        }

        // Apply horizontal movement
        const newPosition = new THREE.Vector3(
            currentPosition.x + this.currentVelocity.x,
            this.playerData.position.y,
            currentPosition.z + this.currentVelocity.z
        );

        // Check for collisions with buildings and obstacles
        if (!this.checkCollisions(newPosition)) {
            this.playerData.position.x = newPosition.x;
            this.playerData.position.z = newPosition.z;
        } else {
            // Try sliding along walls
            const slideX = new THREE.Vector3(
                newPosition.x,
                this.playerData.position.y,
                currentPosition.z
            );
            const slideZ = new THREE.Vector3(
                currentPosition.x,
                this.playerData.position.y,
                newPosition.z
            );

            if (!this.checkCollisions(slideX)) {
                this.playerData.position.x = slideX.x;
            }
            if (!this.checkCollisions(slideZ)) {
                this.playerData.position.z = slideZ.z;
            }
        }

        // Keep player within map bounds
        const mapBounds = 390; // Slightly less than half the ground size
        this.playerData.position.x = Math.max(-mapBounds, Math.min(mapBounds, this.playerData.position.x));
        this.playerData.position.z = Math.max(-mapBounds, Math.min(mapBounds, this.playerData.position.z));

        // Update camera and emit position if moved
        if (!currentPosition.equals(this.playerData.position)) {
            this.updateCameraPosition();
            this.socket.emit('move', this.playerData);
        }
    }

    checkCollisions(position) {
        // Create player collision box
        const playerBox = new THREE.Box3(
            new THREE.Vector3(
                position.x - this.playerRadius,
                position.y,
                position.z - this.playerRadius
            ),
            new THREE.Vector3(
                position.x + this.playerRadius,
                position.y + this.playerHeight,
                position.z + this.playerRadius
            )
        );

        // Check collision with all obstacle boxes
        return this.collisionBoxes.some(box => playerBox.intersectsBox(box));
    }

    updateLeaderboard() {
        const tbody = document.getElementById('leaderboard-body');
        tbody.innerHTML = '';

        // Get all players and sort them
        const players = Object.values(this.socket.gameState.players)
            .sort((a, b) => {
                // Sort taggers by score (tags)
                if (a.isTagger && b.isTagger) {
                    return b.score - a.score;
                }
                // Sort runners by distance
                if (!a.isTagger && !b.isTagger) {
                    return b.distanceRun - a.distanceRun;
                }
                // Taggers come first
                return a.isTagger ? -1 : 1;
            });

        players.forEach((playerData, index) => {
            const row = document.createElement('tr');
            row.className = playerData.isTagger ? 'tagger-row' : 'runner-row';
            
            // Highlight the local player's row
            if (playerData.id === this.playerData.id) {
                row.style.fontWeight = 'bold';
                row.style.textShadow = '0 0 5px currentColor';
            }

            row.innerHTML = `
                <td class="rank-column">${index + 1}</td>
                <td>${playerData.username}${playerData.id === this.playerData.id ? ' (You)' : ''}</td>
                <td>${playerData.isTagger ? 'Tagger' : 'Runner'}</td>
                <td>${playerData.isTagger ? playerData.score + ' tags' : '-'}</td>
                <td>${Math.floor(playerData.distanceRun)} m</td>
            `;
            tbody.appendChild(row);
        });
    }

    createHandModel() {
        const hand = new THREE.Group();
        
        // Create arm part
        const armGeometry = new THREE.BoxGeometry(0.2, 0.6, 0.2);
        const armMaterial = new THREE.MeshStandardMaterial({ 
            color: this.playerData.isTagger ? '#FF0000' : '#00FFFF',
            metalness: 0.1,
            roughness: 0.5
        });
        const arm = new THREE.Mesh(armGeometry, armMaterial);
        arm.position.y = -0.3;
        hand.add(arm);

        // Create hand part
        const handGeometry = new THREE.BoxGeometry(0.25, 0.25, 0.25);
        const handMesh = new THREE.Mesh(handGeometry, armMaterial);
        handMesh.position.y = 0;
        hand.add(handMesh);

        // Position the hand in view (adjusted position)
        hand.position.set(0.4, -0.4, -0.6); // Moved hand closer to center and up
        hand.rotation.x = Math.PI / 8;
        hand.rotation.y = -Math.PI / 12;

        this.handModel = hand;
        this.scene.remove(this.handModel); // Remove if already exists
        this.camera.add(hand);

        // Make sure camera is added to scene
        if (!this.scene.getObjectById(this.camera.id)) {
            this.scene.add(this.camera);
        }
    }

    updateHandColor() {
        if (this.handModel) {
            this.handModel.traverse((child) => {
                if (child.isMesh) {
                    child.material.color.setStyle(this.playerData.isTagger ? '#FF0000' : '#00FFFF');
                }
            });
        }
    }

    animateHand() {
        if (!this.isHandAnimating) {
            this.isHandAnimating = true;
            this.handAnimationTime = 0;
            
            // Emit tag attempt if player is tagger
            if (this.playerData.isTagger) {
                this.socket.emit('tag-attempt', this.playerData);
            }
        }
    }

    updateHandAnimation() {
        if (this.isHandAnimating) {
            // Slower animation speed
            this.handAnimationTime += 0.1; // Reduced from 0.2
            
            if (this.handModel) {
                const swingAngle = Math.PI / 3;
                const progress = Math.min(1, this.handAnimationTime);
                
                // Smoother swing animation
                if (progress < 0.5) {
                    // Forward swing
                    const swingProgress = Math.sin(progress * Math.PI) * swingAngle;
                    this.handModel.rotation.x = Math.PI / 8 - swingProgress;
                    this.handModel.position.z = -0.6 - progress * 0.1; // Reduced forward movement
                } else {
                    // Return swing
                    const swingProgress = Math.sin((1 - progress) * Math.PI) * swingAngle;
                    this.handModel.rotation.x = Math.PI / 8 - swingProgress;
                    this.handModel.position.z = -0.6 - (1 - progress) * 0.1;
                }
                
                // Reset animation
                if (progress >= 1) {
                    this.isHandAnimating = false;
                    this.handModel.rotation.x = Math.PI / 8;
                    this.handModel.position.z = -0.6;
                }
            }
        }
    }

    showCinematicView(tagger, tagged) {
        console.log('Starting cinematic view');
        this.isCinematicView = true;
        this.cinematicStartTime = Date.now();
        this.lastTaggedPlayer = tagged;
        this.lastTaggerPlayer = tagger;

        // Create cinematic camera with wider FOV for dramatic effect
        this.cinematicCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        
        // Add black bars with dramatic fade
        const blackBars = document.createElement('div');
        blackBars.id = 'cinematic-bars';
        blackBars.innerHTML = `
            <div class="black-bar top"></div>
            <div class="player-info">
                <span class="tagger-name">${tagger.username}</span>
                <span class="tagged-name">ELIMINATED</span>
                <span class="victim-name">${tagged.username}</span>
            </div>
            <div class="black-bar bottom"></div>
        `;
        document.body.appendChild(blackBars);

        // Position cinematic camera for dramatic angle
        const taggerPos = new THREE.Vector3(
            tagger.position.x,
            tagger.position.y + this.eyeHeight,
            tagger.position.z
        );
        const taggedPos = new THREE.Vector3(
            tagged.position.x,
            tagged.position.y + this.eyeHeight,
            tagged.position.z
        );
        
        // Calculate camera position for dramatic shot
        const direction = new THREE.Vector3().subVectors(taggedPos, taggerPos).normalize();
        const sideOffset = new THREE.Vector3(direction.z, 0, -direction.x).multiplyScalar(3);
        const cameraPos = new THREE.Vector3()
            .copy(taggerPos)
            .add(sideOffset)
            .sub(direction.multiplyScalar(8));
        cameraPos.y += 3;
        
        this.cinematicCamera.position.copy(cameraPos);
        this.cinematicCamera.lookAt(taggedPos);

        // Disable all controls during cinematic
        document.removeEventListener('mousemove', this.handleMouseMove.bind(this));
        this.isGameOver = true;

        console.log('Cinematic view started');
        console.log('Camera position:', cameraPos);
        console.log('Looking at:', taggedPos);
    }

    updateCinematicView() {
        if (!this.isCinematicView) return;

        const elapsed = Date.now() - this.cinematicStartTime;
        const progress = Math.min(elapsed / this.cinematicDuration, 1);

        if (progress >= 1) {
            // End cinematic view
            this.isCinematicView = false;
            const bars = document.getElementById('cinematic-bars');
            if (bars) bars.remove();
            return;
        }

        // Slow motion effect
        const taggerPos = new THREE.Vector3(
            this.lastTaggerPlayer.position.x,
            this.lastTaggerPlayer.position.y + this.eyeHeight,
            this.lastTaggerPlayer.position.z
        );
        const taggedPos = new THREE.Vector3(
            this.lastTaggedPlayer.position.x,
            this.lastTaggedPlayer.position.y + this.eyeHeight,
            this.lastTaggedPlayer.position.z
        );

        // Create dramatic camera movement
        const direction = new THREE.Vector3().subVectors(taggedPos, taggerPos).normalize();
        const sideOffset = new THREE.Vector3(direction.z, 0, -direction.x).multiplyScalar(3 + Math.sin(progress * Math.PI) * 0.5);
        const cameraPos = new THREE.Vector3()
            .copy(taggerPos)
            .add(sideOffset)
            .sub(direction.multiplyScalar(8 - Math.sin(progress * Math.PI) * 2));
        
        // Add dramatic camera movement
        cameraPos.y += 3 + Math.sin(progress * Math.PI * 2) * 0.5;
        
        this.cinematicCamera.position.copy(cameraPos);
        this.cinematicCamera.lookAt(
            taggedPos.x,
            taggedPos.y + Math.sin(progress * Math.PI) * 0.5,
            taggedPos.z
        );
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        // Update cinematic view if active
        if (this.isCinematicView) {
            console.log('Rendering cinematic view');
            this.updateCinematicView();
            this.renderer.render(this.scene, this.cinematicCamera);
        } else {
            // Normal game rendering
            this.updateHandAnimation();
            this.clouds.forEach(cloud => {
                cloud.mesh.position.x += cloud.speed;
                if (cloud.mesh.position.x > 100) {
                    cloud.mesh.position.x = -100;
                }
            });
            this.updateCameraPosition();
            this.updatePlayerPosition();
            this.renderer.render(this.scene, this.camera);
        }
    }

    getRandomSpawnPoint() {
        // Create several spawn zones to prevent players spawning too close
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

    // Add this method to handle respawning
    respawnPlayer() {
        const spawnPoint = this.getRandomSpawnPoint();
        this.playerData.position = spawnPoint;
        this.playerData.isShielded = true;
        this.shieldActive = true;
        
        // Reset player state
        this.movement = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            jumping: false
        };
        this.sprintActive = false;
        this.sprintCooldown = 0;
        this.verticalVelocity = 0;
        
        // Reset shield timer
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

        // Update sprint status
        const sprintStatus = document.getElementById('sprint-status');
        sprintStatus.textContent = 'Sprint Ready';
        sprintStatus.className = 'hud sprint-ready';

        // Update position
        this.socket.emit('move', this.playerData);
        this.updateCameraPosition();
    }
}

// Start the game
new Game(); 