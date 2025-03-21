# Cosmic Bounce - Multiplayer Web Game

A real-time multiplayer 3D game built with Three.js and Socket.IO for the AI Game Jam.

## Features

- Instant multiplayer gameplay - no login required
- Real-time player movement and interactions
- Low-poly 3D graphics for fast loading
- Smooth controls and camera movement
- Player count tracking
- Custom usernames

## Controls

- WASD or Arrow Keys: Move your player
- Space: Jump
- Mouse: Control camera view
- Mouse wheel: Zoom in/out

## Running Locally

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

3. In a separate terminal, start the game server:
```bash
npm run server
```

4. Open your browser and navigate to `http://localhost:5173`

## Building for Production

1. Build the client:
```bash
npm run build
```

2. Start the production server:
```bash
npm run server
```

The game will be available at `http://localhost:3000`

## Technologies Used

- Three.js for 3D graphics
- Socket.IO for real-time multiplayer
- Vite for fast development and building
- Express for the game server # gamejam_levelsio
