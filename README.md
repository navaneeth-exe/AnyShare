# ChaosDrop - P2P Ephemeral File Drop & Shared Clipboard

A sleek, serverless, zero-cost peer-to-peer file transfer and shared clipboard application engineered with WebRTC, PeerJS, and modern vanilla web standards.

![License](https://img.shields.io/badge/license-MIT-green.svg)
![P2P](https://img.shields.io/badge/architecture-P2P%20WebRTC-00E599.svg)
![Zero Cost](https://img.shields.io/badge/cloud%20cost-$0.00-brightgreen.svg)

---

## ⚡ Features

- **Direct P2P File Streaming**: Zero intermediate cloud storage. Transfers go directly peer-to-peer using chunked ArrayBuffers over WebRTC data channels.
- **Shared Clipboard**: Instant, reactive sync for code snippets, commands, and text across connected peers.
- **Ephemeral Room Mesh**: Automatic mesh discovery with room codes and direct invite links.
- **Radar Proximity Map**: Dynamic visual topology of connected devices in the local mesh.
- **Impeccable Terminal Aesthetic**: High-contrast, hardware-accelerated dark ATC/terminal interface with live telemetry (transfer speed, ETA, connection state).
- **Zero Infrastructure Cost**: Powered completely in-browser with free public STUN signaling.

---

## 🛠️ Tech Stack

- **Frontend**: Vanilla JavaScript (ES Modules), HTML5, CSS3 Custom Properties
- **P2P Protocol**: [PeerJS](https://peerjs.com/) (WebRTC DataChannel mesh)
- **Icons**: Lucide Icons
- **Bundler / Dev Server**: [Vite](https://vitejs.dev/)

---

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) (v16 or newer recommended)
- [npm](https://www.npmjs.com/)

### Installation & Run

1. Clone the repository:
   ```bash
   git clone https://github.com/navaneeth-exe/FileShare.git
   cd FileShare
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start local development server:
   ```bash
   npm run dev
   ```

4. Open the displayed local URL (usually `http://localhost:5173`) in multiple browser tabs or across devices on the same network to test real-time P2P transfers.

---

## 🔒 Security & Privacy

All file transfers and clipboard payloads are transmitted strictly point-to-point between browser sessions. No files, logs, or user data ever touch an application database or central storage server.
