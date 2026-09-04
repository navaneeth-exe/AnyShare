// transfer.js — Chunked P2P file transfer with speed tracking

const CHUNK_SIZE = 64 * 1024; // 64 KB

export class TransferEngine {
  constructor(room, onUpdate) {
    this.room = room;
    this.onUpdate = onUpdate;
    this.transfers = {};
    this.inbound = {};      // transferId -> { meta, chunks, received, startTime }
    this.pending = {};      // transferId -> { resolve }
  }

  async sendFile(file, peerId, peerAlias) {
    const id = `tx-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const meta = { transferId: id, name: file.name, size: file.size, type: file.type, fromAlias: this.room.alias };

    this.transfers[id] = { id, name: file.name, size: file.size, direction: 'sending', peer: peerAlias, progress: 0, status: 'waiting', speed: '' };
    this.onUpdate(this.transfers);

    this.room.sendFileTo(peerId, meta);

    const accepted = await new Promise(resolve => {
      this.pending[id] = { resolve };
      setTimeout(() => resolve(false), 30000);
    });

    if (!accepted) {
      this.transfers[id].status = 'declined';
      this.onUpdate(this.transfers);
      return;
    }

    const buf = await file.arrayBuffer();
    this.transfers[id].status = 'sending';
    const startTime = Date.now();
    let offset = 0, chunk = 0;

    while (offset < buf.byteLength) {
      const slice = buf.slice(offset, offset + CHUNK_SIZE);
      this.room.sendChunk(peerId, { transferId: id, chunkIndex: chunk, data: slice });
      offset += CHUNK_SIZE;
      chunk++;
      this.transfers[id].progress = Math.round((offset / buf.byteLength) * 100);
      const elapsed = (Date.now() - startTime) / 1000;
      if (elapsed > 0) this.transfers[id].speed = formatSpeed(offset / elapsed);
      this.onUpdate(this.transfers);
      await new Promise(r => setTimeout(r, 0));
    }

    this.room.sendDone(peerId, id);
    this.transfers[id].status = 'done';
    this.transfers[id].progress = 100;
    this.transfers[id].speed = '';
    this.onUpdate(this.transfers);
  }

  handleAccept(transferId) {
    if (this.pending[transferId]) { this.pending[transferId].resolve(true); delete this.pending[transferId]; }
  }

  handleDecline(transferId) {
    if (this.pending[transferId]) { this.pending[transferId].resolve(false); delete this.pending[transferId]; }
    if (this.transfers[transferId]) { this.transfers[transferId].status = 'declined'; this.onUpdate(this.transfers); }
  }

  acceptInbound(payload) {
    const { transferId, name, size, fromAlias } = payload;
    this.inbound[transferId] = { meta: payload, chunks: {}, received: 0, startTime: Date.now() };
    this.transfers[transferId] = { id: transferId, name, size, direction: 'receiving', peer: fromAlias, progress: 0, status: 'receiving', speed: '' };
    this.onUpdate(this.transfers);
  }

  handleChunk({ transferId, chunkIndex, data }) {
    const b = this.inbound[transferId];
    if (!b) return;
    b.chunks[chunkIndex] = data;
    b.received += data.byteLength;
    const progress = Math.round((b.received / b.meta.size) * 100);
    const elapsed = (Date.now() - b.startTime) / 1000;
    if (this.transfers[transferId]) {
      this.transfers[transferId].progress = progress;
      if (elapsed > 0) this.transfers[transferId].speed = formatSpeed(b.received / elapsed);
      this.onUpdate(this.transfers);
    }
  }

  handleDone(transferId) {
    const b = this.inbound[transferId];
    if (!b) return;
    const parts = Object.keys(b.chunks).sort((a, z) => +a - +z).map(k => b.chunks[k]);
    const blob = new Blob(parts, { type: b.meta.type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = b.meta.name || 'download';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    // Delay cleanup so the browser has time to initiate the download
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
    if (this.transfers[transferId]) {
      this.transfers[transferId].status = 'done';
      this.transfers[transferId].progress = 100;
      this.transfers[transferId].speed = '';
      this.onUpdate(this.transfers);
    }
    delete this.inbound[transferId];
  }

  getAll() { return Object.values(this.transfers).slice(-8); }
}

function formatSpeed(bps) {
  if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${Math.round(bps)} B/s`;
}
