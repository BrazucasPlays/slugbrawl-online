# SlugBrawl Online

## Overview
A multiplayer cooperative survival game where players join rooms, fight enemies, and try to reach the exit door together.

## Project Structure
- `server.js` - WebSocket + Express server handling game logic
- `public/index.html` - Game client with canvas rendering
- `package.json` - Node.js dependencies

## How to Play
1. Enter your name and room code (share with friends to play together)
2. Choose a class: Soldier (faster) or Tank (more HP)
3. Click "JOGAR" to join
4. Controls:
   - **PC**: WASD to move, mouse to aim, click/space to shoot
   - **Mobile**: Left stick moves, right stick aims/shoots
5. Survive enemies, collect health pickups, and reach the yellow exit door with your partner

## Technical Details
- Server runs on port 5000
- WebSocket for real-time multiplayer
- Room-based matchmaking
- 20Hz game tick rate
