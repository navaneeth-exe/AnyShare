// peer.js — P2P mesh manager
// Handles room creation/joining, peer discovery, and all message types

import Peer from 'peerjs';

export class ChaosRoom {
  constructor({ alias, onEvent }) {
    this.alias = alias;
    this.onEvent = onEvent;
    this.peer = null;
    this.myId = null;
    this.roomCode = null;
    this.isHost = false;
    this.connections = {};  // peerId -> DataConnection
    this.peers = {};        // peerId -> { id, alias }
  }

  static generateRoomCode() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let c = 'CD-';
    for (let i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)];
    return c;
  }

  _initPeer(customId = null) {
    return new Promise((resolve, reject) => {
      const opts = {
        debug: 0,
        config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
      };
      this.peer = customId ? new Peer(customId, opts) : new Peer(opts);
      this.peer.on('open', id => { this.myId = id; resolve(id); });
      this.peer.on('error', err => {
        if (err.type === 'unavailable-id') reject(new Error('Room code taken'));
        else reject(err);
      });
      this.peer.on('connection', conn => {
        conn.on('open', () => this._register(conn));
      });
    });
  }

  async createRoom(code) {
    this.isHost = true;
    this.roomCode = code;
    await this._initPeer(code);
    this.peers[this.myId] = { id: this.myId, alias: this.alias };
    this.onEvent('ready', { roomCode: code, myId: this.myId });
  }

  async joinRoom(code) {
    this.isHost = false;
    this.roomCode = code;
    await this._initPeer();
    this.peers[this.myId] = { id: this.myId, alias: this.alias };
    await this._connect(code);
    this.onEvent('ready', { roomCode: code, myId: this.myId });
  }

  _connect(peerId) {
    return new Promise((resolve, reject) => {
      if (this.connections[peerId] || peerId === this.myId) { resolve(); return; }
      const conn = this.peer.connect(peerId, { reliable: true });
      conn.on('open', () => {
        this._register(conn);
        this._send(conn, { type: 'HELLO', payload: { id: this.myId, alias: this.alias } });
        resolve();
      });
      conn.on('error', reject);
    });
  }

  _register(conn) {
    const pid = conn.peer;
    this.connections[pid] = conn;
    conn.on('data', data => this._onMessage(pid, data));
    conn.on('close', () => {
      delete this.connections[pid];
      const alias = this.peers[pid]?.alias;
      delete this.peers[pid];
      this.onEvent('peer-left', { id: pid, alias });
      if (this.isHost) this._broadcastPeerList();
    });
  }

  _send(conn, msg) { try { conn.send(msg); } catch (_) {} }

  broadcast(msg, excludeId = null) {
    for (const [id, conn] of Object.entries(this.connections)) {
      if (id !== excludeId) this._send(conn, msg);
    }
  }

  _broadcastPeerList() {
    this.broadcast({ type: 'PEER_LIST', payload: Object.values(this.peers) });
  }

  _onMessage(fromId, msg) {
    switch (msg.type) {

      case 'HELLO': {
        const { id, alias } = msg.payload;
        this.peers[id] = { id, alias };
        if (this.isHost) {
          this._broadcastPeerList();
          // Tell new peer who else to connect to (mesh)
          const others = Object.keys(this.connections).filter(p => p !== fromId);
          if (others.length > 0) {
            this._send(this.connections[fromId], { type: 'MESH_PEERS', payload: others });
          }
        }
        this.onEvent('peer-joined', { id, alias });
        break;
      }

      case 'PEER_LIST':
        msg.payload.forEach(p => { if (p.id !== this.myId) this.peers[p.id] = p; });
        this.onEvent('peers-updated', Object.values(this.peers));
        break;

      case 'MESH_PEERS':
        msg.payload.forEach(id => {
          if (!this.connections[id] && id !== this.myId) this._connect(id);
        });
        break;

      case 'CHAT':
        this.onEvent('chat', msg.payload);
        break;

      case 'CLIPBOARD':
        this.onEvent('clipboard', msg.payload);
        break;

      case 'FILE_OFFER':
        this.onEvent('file-offer', { ...msg.payload, fromId });
        break;

      case 'FILE_ACCEPT':
        this.onEvent('file-accept', { transferId: msg.payload.transferId, fromId });
        break;

      case 'FILE_DECLINE':
        this.onEvent('file-decline', { transferId: msg.payload.transferId });
        break;

      case 'FILE_CHUNK':
        this.onEvent('file-chunk', { ...msg.payload, fromId });
        break;

      case 'FILE_DONE':
        this.onEvent('file-done', { transferId: msg.payload.transferId, fromId });
        break;
    }
  }

  // ── Public API ──

  sendChat(text) {
    const payload = { text, alias: this.alias, myId: this.myId, ts: Date.now() };
    this.onEvent('chat', payload); // local echo
    this.broadcast({ type: 'CHAT', payload });
  }

  sendClipboard(text) {
    const payload = { text, alias: this.alias, ts: Date.now() };
    this.broadcast({ type: 'CLIPBOARD', payload });
  }

  sendFileTo(peerId, meta) {
    const conn = this.connections[peerId];
    if (conn) this._send(conn, { type: 'FILE_OFFER', payload: meta });
  }

  sendChunk(peerId, data) {
    const conn = this.connections[peerId];
    if (conn) this._send(conn, { type: 'FILE_CHUNK', payload: data });
  }

  sendDone(peerId, transferId) {
    const conn = this.connections[peerId];
    if (conn) this._send(conn, { type: 'FILE_DONE', payload: { transferId } });
  }

  acceptFile(peerId, transferId) {
    const conn = this.connections[peerId];
    if (conn) this._send(conn, { type: 'FILE_ACCEPT', payload: { transferId } });
  }

  declineFile(peerId, transferId) {
    const conn = this.connections[peerId];
    if (conn) this._send(conn, { type: 'FILE_DECLINE', payload: { transferId } });
  }

  roulettePeer() {
    const ids = Object.keys(this.connections);
    if (ids.length === 0) return null;
    return ids[Math.floor(Math.random() * ids.length)];
  }

  getPeers() { return Object.values(this.peers).filter(p => p.id !== this.myId); }
  getAllPeers() { return Object.values(this.peers); }
  destroy() { if (this.peer) this.peer.destroy(); }
}
