# AnyDrop - AI Agent Context & Knowledge Base

This document provides a comprehensive overview of the **AnyDrop** application (formerly known as FileShare/ChaosDrop). It is intended to serve as a high-fidelity context file for AI agents working on this codebase.

## 1. App Overview
AnyDrop is a real-time, cross-platform file sharing, chat, and shared clipboard web application. It is designed with a premium, weightless glassmorphism UI (macOS inspired) and works entirely in the browser. 

The app features **two distinct networking modes** to ensure users can share files regardless of their network conditions:

1. **Connect with a Person (P2P Mode)**
   - **Technology:** WebRTC (via PeerJS).
   - **How it works:** Establishes a direct peer-to-peer mesh network between browsers.
   - **Best for:** Devices on the same Wi-Fi network. It is incredibly fast and transfers files directly from device to device in chunks.
   - **Limitation:** Often fails when crossing strict firewalls or Mobile Data (symmetric NATs) due to unreliable free TURN servers. 

2. **Create / Join Room (Server Mode)**
   - **Technology:** WebSockets (Socket.IO) and HTTP (Express/Multer).
   - **How it works:** Bounces all chat, clipboard, and file data through a central Node.js backend server.
   - **Best for:** Devices on entirely different networks (e.g., one on Mobile Data, one on Corporate Wi-Fi). It effortlessly bypasses strict NATs and firewalls.

---

## 2. Tech Stack
- **Frontend:** Vanilla JavaScript, HTML5, CSS3, Canvas API (for UI), Vite (Bundler).
- **Backend:** Node.js, Express (v5), Socket.IO, Multer (for file handling).
- **Deployment:** The app is deployed on **Render** using a single web service. The Node.js server serves the production Vite build (`dist/`) statically.

---

## 3. Directory Structure & File Index

### 📁 Root Configuration
* `package.json` & `package-lock.json`: Project dependencies (Express, Socket.io, PeerJS, etc.).
* `vite.config.js`: Vite configuration. It includes a proxy for `/api` and `/socket.io` to route local development requests to the backend (`localhost:3001`).
* `index.html`: The monolithic HTML structure. It contains the Lobby (tabs for P2P vs Server), the Radar canvas, the Drag-and-Drop zone, the peer list, the transfer queue, the shared clipboard, and the chat UI.
* `style.css`: All application styling. Heavy use of CSS variables (design tokens), flexbox, grid, glassmorphism (`backdrop-filter`), and responsive media queries (mobile tab-bar navigation).

### 📁 Frontend Logic (`/src/`)
* `src/main.js`: **The UI Controller.** Manages DOM events, state, tab switching, and binds UI actions to the active Room class (either P2P or Server). It handles the `onRoomEvent` switch-case to update the UI when networking events occur.
* `src/peer.js`: **The P2P Engine (`ChaosRoom`).** Manages PeerJS connections, ICE server configuration (STUN/TURN), and direct WebRTC DataConnections. It broadcasts chats and signals to all connected peers in a mesh topography.
* `src/server-room.js`: **The Server Engine (`ServerRoom`).** Manages Socket.IO connections for the Server Room mode. It listens for server broadcasts (chats, clipboards, new users) and handles file uploads via `XMLHttpRequest` and `FormData` to the backend REST API.
* `src/transfer.js`: **P2P File Transfer Logic.** Handles slicing standard `File` objects into small chunks (ArrayBuffers) and sending them over WebRTC. Also reassembles chunks on the receiving end and triggers browser downloads via Blob URLs.
* `src/radar.js`: **UI Animation.** A lightweight Canvas API script that draws the pulsing radar animation seen on the left column of the UI.
* `src/counter.ts` / `src/main.ts`: Vestigial Vite boilerplate files (can be ignored or deleted).

### 📁 Backend Logic (`/server/`)
* `server/server.js`: **The Express Server.** 
  - Mounts REST APIs (`/api/rooms`, `/api/rooms/:roomId/upload`, `/api/rooms/:roomId/files/:fileId`).
  - Configures `multer` to save uploaded files into `server/uploads/<roomId>/<fileId>`.
  - Handles Socket.IO connections, broadcasting `chat_message`, `clipboard_update`, and user presence events.
  - Serves the frontend `dist/` directory in production using a wildcard route (`app.get('{*splat}')` - Note: Express 5 syntax).
  - Contains a `/health` endpoint for cron-job keep-alives.
* `server/store.js`: **In-Memory Database.** A simple Map-based store managing active rooms, connected socket IDs, usernames, and file metadata. 

---

## 4. Historical Context & Recent Fixes
If you are an AI agent picking up this codebase, be aware of these recent critical fixes we implemented:

1. **Responsive Mobile UI (`style.css`):**
   - We implemented a mobile tab bar at the bottom for small screens (Transfer, Radar, Peers). 
   - `display: none` is dynamically applied via `[data-active-view]` attributes to switch between the main working columns on mobile devices, preventing layout overflow.

2. **Server Mode State Crash (`server/server.js`):**
   - Previously, the `users` Map wasn't imported into `server.js` from `store.js`. This caused the Node process to crash entirely whenever a user sent a chat message in Server Mode. This is now fixed.
   - We also added `room.destroy()` logic in `main.js` to ensure users don't spawn duplicate Socket.IO or PeerJS connections if they click "Join" multiple times.

3. **P2P Timeout Logic (`src/peer.js`):**
   - Added a 10-second timeout wrapper around PeerJS `connect()` promises. Before this, if a user tried connecting to a P2P mesh across a strict firewall, the WebRTC connection would silently fail, and the UI button would say "Joining..." forever.

4. **Express v5 Routing (`server.js`):**
   - The project uses Express v5. Standard wildcard routes like `app.get('*')` throw errors in v5. We successfully updated the static asset catch-all route to use `app.get('{*splat}')`.

5. **Render Server Sleep Management:**
   - Render spins down free-tier servers after inactivity. We created a `/health` endpoint and instructed the user to set up a cron job (via cron-job.org) to ping it every 14 minutes, EXCEPT between 02:00 and 06:00, allowing the server to sleep during off-hours to save on Render's 750-hour free tier limit.

## 5. Known Limitations
- Server files are currently stored on disk (`server/uploads/`). Render free-tier uses ephemeral storage, meaning if the server restarts or deploys, uploaded files are lost. This is acceptable for a temporary "transfer" room paradigm.
- P2P TURN servers rely on a free metered.ca credential. If this quota is exceeded, P2P cross-network sharing will fail, requiring users to fall back to the Server Room tab.
