import { io } from 'socket.io-client';

export class ServerRoom {
  constructor({ alias, onEvent }) {
    this.alias = alias;
    this.onEvent = onEvent;
    this.roomId = null;
    this.myId = null;
    this.socket = null;
    this.peers = [];
    this.files = [];
  }

  async createRoom() {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: this.alias })
    });
    if (!res.ok) throw new Error('Failed to create room');
    const { roomId } = await res.json();
    return this.joinRoom(roomId);
  }

  joinRoom(roomId) {
    return new Promise((resolve, reject) => {
      this.roomId = roomId;
      this.socket = io({ transports: ['websocket', 'polling'] });
      
      this.socket.on('connect', () => {
        this.myId = this.socket.id;
        this.socket.emit('join_room', { roomId, username: this.alias }, (res) => {
          if (res.error) {
            reject(new Error(res.error));
            this.destroy();
            return;
          }
          this.files = res.files || [];
          this.peers = res.users || [];
          this.onEvent('ready', { roomCode: roomId, myId: this.myId, files: this.files, peers: this.peers });
          resolve(this.myId);
        });
      });

      this.socket.on('connect_error', (err) => {
        reject(err);
      });

      this.socket.on('user_joined', (user) => {
        if (!this.peers.find(p => p.id === user.id)) this.peers.push(user);
        this.onEvent('peer-joined', { id: user.id, alias: user.username });
      });

      this.socket.on('user_left', (user) => {
        this.peers = this.peers.filter(p => p.id !== user.id);
        this.onEvent('peer-left', { id: user.id, alias: user.username });
      });

      this.socket.on('peers_updated', (peers) => {
        this.peers = peers;
        this.onEvent('peers-updated', this.peers.map(p => ({ id: p.id, alias: p.username })));
      });

      this.socket.on('chat_message', (msg) => {
        this.onEvent('chat', { text: msg.text, alias: msg.username, myId: msg.senderId, ts: msg.ts });
      });

      this.socket.on('clipboard_update', (data) => {
        this.onEvent('clipboard', { text: data.text, alias: data.username });
      });

      this.socket.on('file_added', (file) => {
        this.files.push(file);
        this.onEvent('file_added', file);
      });
    });
  }

  sendChat(text) {
    if (this.socket) {
      this.socket.emit('chat_message', { roomId: this.roomId, text });
    }
  }

  sendClipboard(text) {
    if (this.socket) {
      this.socket.emit('clipboard_update', { roomId: this.roomId, text });
    }
  }

  async sendFile(file, onProgress) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('username', this.alias);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/rooms/${this.roomId}/upload`, true);
      
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          const percent = Math.round((e.loaded / e.total) * 100);
          const bps = e.loaded / ((Date.now() - startTime) / 1000 || 1);
          onProgress(percent, bps);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          reject(new Error(`Upload failed: ${xhr.statusText}`));
        }
      };
      
      xhr.onerror = () => reject(new Error('Upload network error'));
      
      const startTime = Date.now();
      xhr.send(formData);
    });
  }

  getAllPeers() {
    return this.peers.map(p => ({ id: p.id, alias: p.username }));
  }

  getPeers() {
    return this.peers.filter(p => p.id !== this.myId).map(p => ({ id: p.id, alias: p.username }));
  }

  roulettePeer() {
    const peers = this.getPeers();
    if (peers.length === 0) return null;
    return peers[Math.floor(Math.random() * peers.length)].id;
  }

  destroy() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}
