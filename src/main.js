// main.js

import { ChaosRoom } from './peer.js';
import { initRadar } from './radar.js';
import { TransferEngine } from './transfer.js';
import { ServerRoom } from './server-room.js';
import QRCode from 'qrcode';
import { Html5Qrcode } from 'html5-qrcode';

let room = null;
let transfer = null;
let radar = null;
let selectedPeerId = null;
let myId = null;
let roomControlsInit = false;
let currentMode = 'p2p';

// ── Colors for peer avatars ───────────────────────
const PEER_COLORS = [
  { bg: 'rgba(60,255,160,.15)',  fg: '#3cffa0' },
  { bg: 'rgba(78,158,255,.15)', fg: '#4e9eff' },
  { bg: 'rgba(255,196,77,.12)', fg: '#ffc44d' },
  { bg: 'rgba(255,92,92,.12)',  fg: '#ff5c5c' },
  { bg: 'rgba(170,100,255,.15)',fg: '#aa64ff' },
];
const peerColorMap = {};
let peerColorIdx = 0;
function peerColor(id) {
  if (!peerColorMap[id]) peerColorMap[id] = PEER_COLORS[peerColorIdx++ % PEER_COLORS.length];
  return peerColorMap[id];
}

// ── Utilities ──────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  const c = document.getElementById('toast-container');
  c.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(6px)';
    setTimeout(() => el.remove(), 250);
  }, 3000);
}

function esc(s = '') {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b/1024).toFixed(1)} KB`;
  return `${(b/1048576).toFixed(1)} MB`;
}

function fmtTime(ts) {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}

function initials(name = '') {
  return name.trim().slice(0, 2).toUpperCase() || '??';
}

// ── Peer list (right column) ───────────────────────

function renderPeers() {
  if (!room) return;
  const peers = room.getPeers();
  const list = document.getElementById('peers-list');
  const empty = document.getElementById('peers-empty');
  const count = document.getElementById('peer-list-count');
  count.textContent = peers.length;
  const mobileBadge = document.getElementById('mobile-peer-badge');
  if (mobileBadge) mobileBadge.textContent = peers.length;

  if (peers.length === 0) {
    if (!empty) {
      list.innerHTML = `<div class="peers-empty" id="peers-empty">
        <div class="peers-empty-icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="6" r="3" stroke="currentColor" stroke-width="1.3"/>
            <path d="M2 13c0-2.5 2.7-4 6-4s6 1.5 6 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </div>
        <p class="peers-empty-text">Nobody here yet.<br>Share your room code:</p>
        <div class="peers-empty-code" id="peers-empty-code">${esc(room.roomCode)}</div>
      </div>`;
    } else {
      const codeEl = document.getElementById('peers-empty-code');
      if (codeEl) codeEl.textContent = room.roomCode || '—';
    }
    return;
  }

  list.innerHTML = peers.map(p => {
    const c = peerColor(p.id);
    const selected = p.id === selectedPeerId;
    return `<div class="peer-row${selected ? ' selected' : ''}" data-id="${esc(p.id)}" role="button" tabindex="0" aria-pressed="${selected}">
      <div class="peer-avatar" style="background:${c.bg};color:${c.fg}">${esc(initials(p.alias))}</div>
      <div class="peer-info">
        <div class="peer-name">${esc(p.alias)}</div>
        <div class="peer-status">${selected ? '← selected' : 'online'}</div>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.peer-row').forEach(row => {
    row.addEventListener('click', () => selectPeer(row.dataset.id));
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') selectPeer(row.dataset.id); });
  });
}

function selectPeer(id) {
  if (!room) return;
  selectedPeerId = id;
  const peer = room.getAllPeers().find(p => p.id === id);
  if (peer) toast(`→ ${peer.alias} selected`, 'info');
  renderPeers();
}

// ── Transfer UI ────────────────────────────────────

function renderTransfers(transfers) {
  const list = document.getElementById('transfer-list');
  const empty = document.getElementById('transfers-empty');
  const items = Object.values(transfers).slice(-6);

  if (!items.length) {
    empty.textContent = 'No transfers yet';
    empty.style.display = '';
    list.innerHTML = '';
    return;
  }
  empty.style.display = 'none';

  list.innerHTML = items.map(t => {
    const isSend = t.direction === 'sending';
    const chipClass = t.status === 'done' ? 'chip-done'
      : t.status === 'declined' ? 'chip-decline'
      : isSend ? 'chip-send' : 'chip-recv';
    const barClass = isSend ? 'bar-send' : 'bar-recv';
    const showBar = !['done','declined','waiting'].includes(t.status);

    return `<div class="transfer-row">
      <span class="transfer-icon">${isSend ? '↑' : '↓'}</span>
      <div class="transfer-info">
        <div class="transfer-name" title="${esc(t.name)}">${esc(t.name)}</div>
        ${showBar ? `<div class="transfer-bar-wrap"><div class="transfer-bar ${barClass}" style="transform:scaleX(${t.progress / 100})"></div></div>` : ''}
      </div>
      <div class="transfer-meta">
        ${t.speed ? `<span class="transfer-speed">${t.speed}</span>` : ''}
        <span class="chip ${chipClass}">${t.status}</span>
      </div>
    </div>`;
  }).join('');
}

// ── Clipboard ──────────────────────────────────────

let clipboardDebounce = null;

function initClipboard() {
  const ta = document.getElementById('clipboard-input');
  const author = document.getElementById('clipboard-author');

  ta.addEventListener('input', () => {
    clearTimeout(clipboardDebounce);
    clipboardDebounce = setTimeout(() => {
      if (room) room.sendClipboard(ta.value);
    }, 400);
  });

  document.getElementById('btn-copy-clipboard').addEventListener('click', () => {
    navigator.clipboard.writeText(ta.value)
      .then(() => toast('Copied to clipboard', 'info'))
      .catch(() => { ta.select(); document.execCommand('copy'); toast('Copied', 'info'); });
  });
}

function setClipboard(text, alias) {
  const ta = document.getElementById('clipboard-input');
  const author = document.getElementById('clipboard-author');
  ta.value = text;
  author.textContent = `Updated by ${alias}`;
  ta.classList.remove('clipboard-flash');
  void ta.offsetWidth;
  ta.classList.add('clipboard-flash');
}

// ── Chat ───────────────────────────────────────────

function appendChat({ text, alias, myId: senderId, ts }) {
  const box = document.getElementById('chat-messages');
  const own = senderId === myId;
  const el = document.createElement('div');
  el.className = 'chat-msg';
  el.innerHTML = `
    <div class="chat-msg-head">
      <span class="${own ? 'chat-name-own' : 'chat-name-peer'}">${esc(alias)}</span>
      <span class="chat-ts">${fmtTime(ts)}</span>
    </div>
    <div class="chat-text">${esc(text)}</div>`;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

// ── QR ─────────────────────────────────────────────

async function renderQR(roomCode) {
  const url = `${location.origin}${location.pathname}?join=${roomCode}`;
  const canvas = document.createElement('canvas');
  await QRCode.toCanvas(canvas, url, { width: 80, margin: 1, color: { dark: '#000', light: '#fff' } });
  const box = document.getElementById('qr-code');
  box.innerHTML = '';
  box.appendChild(canvas);
  document.getElementById('hud-room-code').textContent = roomCode;
  document.getElementById('hud-room-code-2').textContent = roomCode;
  // update empty state code if visible
  const ec = document.getElementById('peers-empty-code');
  if (ec) ec.textContent = roomCode;
}

// ── HUD ────────────────────────────────────────────

function updateHUD() {
  if (!room) return;
  const n = room.getPeers().length;
  const el = document.getElementById('hud-peer-count');
  el.innerHTML = `<span>${n}</span> connected`;
}

// ── Receive modal ──────────────────────────────────

function showReceiveModal(offer) {
  const modal = document.getElementById('receive-modal');
  document.getElementById('receive-sender').innerHTML = `From <strong>${esc(offer.fromAlias)}</strong>`;
  document.getElementById('receive-filename').textContent = offer.name;
  document.getElementById('receive-size').textContent = fmtBytes(offer.size);
  modal.classList.remove('hidden');

  document.getElementById('btn-accept').onclick = () => {
    modal.classList.add('hidden');
    transfer.acceptInbound(offer);
    room.acceptFile(offer.fromId, offer.transferId);
  };
  document.getElementById('btn-decline').onclick = () => {
    modal.classList.add('hidden');
    room.declineFile(offer.fromId, offer.transferId);
  };
}

// ── Room entry ─────────────────────────────────────

function enterRoom(roomCode) {
  showScreen('screen-room');
  // Push state so browser back button returns to lobby instead of leaving the site
  history.pushState({ screen: 'room', roomCode }, '', '?room=' + roomCode);
  renderQR(roomCode);
  
  if (currentMode === 'p2p') {
    document.getElementById('p2p-transfers-section').style.display = '';
    document.getElementById('server-files-section').style.display = 'none';
    transfer = new TransferEngine(room, renderTransfers);
  } else {
    document.getElementById('p2p-transfers-section').style.display = 'none';
    document.getElementById('server-files-section').style.display = '';
    renderServerFiles();
  }

  const canvas = document.getElementById('radar-canvas');
  radar = initRadar(
    canvas,
    () => room.getPeers(),
    () => ({ id: myId, alias: room.alias }),
    (peer) => selectPeer(peer.id)
  );

  initClipboard();
  bindRoomControls();
  renderPeers();
}

function renderServerFiles() {
  const list = document.getElementById('server-file-list');
  const empty = document.getElementById('server-files-empty');
  const files = room.files || [];

  if (!files.length) {
    empty.style.display = '';
    list.innerHTML = '';
    return;
  }
  empty.style.display = 'none';

  list.innerHTML = files.map(f => {
    return `<div class="transfer-row">
      <span class="transfer-icon" style="display:flex; align-items:center; justify-content:center;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
          <polyline points="10 9 9 9 8 9"></polyline>
        </svg>
      </span>
      <div class="transfer-info">
        <div class="transfer-name" title="${esc(f.name)}">${esc(f.name)}</div>
        <div style="font-size: 11px; color: var(--text-mut);">by ${esc(f.uploadedBy)} at ${fmtTime(f.uploadedAt)}</div>
      </div>
      <div class="transfer-meta">
        <span class="transfer-speed">${fmtBytes(f.size)}</span>
        <a href="/api/rooms/${room.roomId}/files/${f.id}" download="${esc(f.name)}" class="btn-download">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download</a>
      </div>
    </div>`;
  }).join('');
}

// ── Event handler ──────────────────────────────────

function onRoomEvent(event, data) {
  switch (event) {
    case 'ready':
      myId = data.myId;
      enterRoom(data.roomCode);
      break;

    case 'peer-joined':
      toast(`${data.alias} joined`, 'info');
      updateHUD(); renderPeers();
      break;

    case 'peer-left':
      toast(`${data.alias || 'Someone'} left`, 'info');
      if (selectedPeerId === data.id) selectedPeerId = null;
      updateHUD(); renderPeers();
      break;

    case 'peers-updated':
      updateHUD(); renderPeers();
      break;

    case 'chat':
      appendChat(data);
      break;

    case 'clipboard':
      setClipboard(data.text, data.alias);
      break;

    case 'file-offer':
      showReceiveModal(data);
      break;

    case 'file-accept':
      transfer.handleAccept(data.transferId);
      break;

    case 'file-decline':
      transfer.handleDecline(data.transferId);
      toast('Transfer declined', 'info');
      break;

    case 'file-chunk':
      transfer.handleChunk(data);
      break;

    case 'file-done':
      transfer.handleDone(data.transferId);
      toast('File received — downloading', 'info');
      break;

    case 'file_added':
      if (currentMode === 'server') {
        renderServerFiles();
      }
      break;
  }
}

// ── Room controls ──────────────────────────────────

function bindRoomControls() {
  if (roomControlsInit) return;
  roomControlsInit = true;

  const dropZone = document.getElementById('drop-zone');
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('drag-over');
    handleFiles([...e.dataTransfer.files]);
  });
  dropZone.addEventListener('click', (e) => {
    if (!e.target.closest('#btn-browse')) document.getElementById('file-input').click();
  });
  document.getElementById('btn-browse').addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('file-input').click();
  });
  document.getElementById('file-input').addEventListener('change', e => {
    handleFiles([...e.target.files]);
    e.target.value = '';
  });

  function handleFiles(files) {
    if (currentMode === 'server') {
      files.forEach(f => {
        toast(`Uploading ${f.name}...`, 'info');
        room.sendFile(f).then(() => {
          toast(`${f.name} uploaded`, 'info');
        }).catch(err => {
          toast(`Upload failed: ${err.message}`, 'error');
        });
      });
      return;
    }
    
    // P2P Mode
    if (!selectedPeerId) {
      if (!room || room.getPeers().length === 0) { toast('No peers in the room yet', 'info'); return; }
      toast('Select a peer first (click on the radar or the list)', 'info'); return;
    }
    const peer = room.getAllPeers().find(p => p.id === selectedPeerId);
    files.forEach(f => transfer.sendFile(f, selectedPeerId, peer?.alias || 'Peer'));
  }

  // Chat
  document.getElementById('btn-chat-send').addEventListener('click', sendChat);
  document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  function sendChat() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text || !room) return;
    room.sendChat(text);
    input.value = '';
  }
}

// ── Global controls ────────────────────────────────

function initGlobalControls() {
  // Leave Room button
  document.getElementById('btn-leave-room').addEventListener('click', () => {
    leaveRoom();
    // Replace the history state so we don't get stuck
    history.replaceState({ screen: 'lobby' }, '', location.pathname);
  });

  // Browser back button handling
  window.addEventListener('popstate', (e) => {
    if (document.getElementById('screen-room').classList.contains('active')) {
      leaveRoom();
    }
  });
  // Set initial history state
  history.replaceState({ screen: 'lobby' }, '', location.pathname);

  document.getElementById('btn-roulette').addEventListener('click', () => {
    if (!room || room.getPeers().length === 0) { toast('No peers to select', 'info'); return; }
    const id = room.roulettePeer();
    if (id) selectPeer(id);
  });

  const bossOverlay = document.getElementById('boss-key-overlay');
  document.getElementById('btn-boss-key').addEventListener('click', () => {
    const hidden = bossOverlay.classList.toggle('hidden');
    bossOverlay.setAttribute('aria-hidden', hidden);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('screen-room').classList.contains('active')) {
      const hidden = bossOverlay.classList.toggle('hidden');
      bossOverlay.setAttribute('aria-hidden', hidden);
    }
  });
  bossOverlay.addEventListener('click', () => {
    bossOverlay.classList.add('hidden');
    bossOverlay.setAttribute('aria-hidden', 'true');
  });

  // Mobile navigation tabs
  const mobileNavBtns = document.querySelectorAll('.mobile-nav-btn');
  const roomBody = document.querySelector('.room-body');
  mobileNavBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      mobileNavBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.view;
      if (roomBody) {
        roomBody.setAttribute('data-active-view', view);
        // If switching to radar, trigger window resize event so radar canvas calculates correct size
        if (view === 'radar') {
          setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
        }
      }
    });
  });
}

// ── Lobby ──────────────────────────────────────────

function initLobby() {
  // Store original button text so we can restore after leaving a room
  ['btn-create-p2p', 'btn-join-p2p', 'btn-create-server', 'btn-join-server'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.dataset.originalText = btn.textContent;
  });

  const params = new URLSearchParams(location.search);
  const joinCode = params.get('join');
  if (joinCode) {
    document.getElementById('tab-p2p').click();
    document.getElementById('room-code-p2p').value = joinCode;
  }

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}-content`).classList.add('active');
    });
  });

  // P2P Create
  document.getElementById('btn-create-p2p').addEventListener('click', async () => {
    currentMode = 'p2p';
    const alias = document.getElementById('alias-p2p').value.trim() || 'Anonymous';
    const btn = document.getElementById('btn-create-p2p');
    btn.textContent = 'Connecting…'; btn.disabled = true;
    room = new ChaosRoom({ alias, onEvent: onRoomEvent });
    try {
      await room.createRoom(ChaosRoom.generateRoomCode());
    } catch {
      toast('Connection failed. Try again.', 'error');
      btn.textContent = 'Create P2P Mesh'; btn.disabled = false;
      room = null;
    }
  });

  // P2P Join
  document.getElementById('btn-join-p2p').addEventListener('click', async () => {
    currentMode = 'p2p';
    const alias = document.getElementById('alias-p2p').value.trim() || 'Anonymous';
    const code = document.getElementById('room-code-p2p').value.trim().toUpperCase();
    if (!code) { toast('Enter a room code', 'error'); return; }
    const btn = document.getElementById('btn-join-p2p');
    btn.textContent = 'Joining…'; btn.disabled = true;
    room = new ChaosRoom({ alias, onEvent: onRoomEvent });
    try {
      await room.joinRoom(code);
    } catch {
      toast(`Room "${code}" not found`, 'error');
      btn.textContent = 'Join P2P Mesh'; btn.disabled = false;
      room.destroy(); room = null;
    }
  });

  // Server Create
  document.getElementById('btn-create-server').addEventListener('click', async () => {
    currentMode = 'server';
    const alias = document.getElementById('alias-server').value.trim() || 'Anonymous';
    const btn = document.getElementById('btn-create-server');
    btn.textContent = 'Connecting…'; btn.disabled = true;
    if (room) { room.destroy(); room = null; }
    room = new ServerRoom({ alias, onEvent: onRoomEvent });
    try {
      await room.createRoom();
    } catch (err) {
      toast('Server connection failed.', 'error');
      btn.textContent = 'Create Server Room'; btn.disabled = false;
      room = null;
    }
  });

  // Server Join
    // QR Scanner logic
  let html5QrCode;
  let activeScanTarget = null; // 'p2p' or 'server'

  const startScanner = (target) => {
    activeScanTarget = target;
    document.getElementById('scanner-modal').classList.remove('hidden');
    
    html5QrCode = new Html5Qrcode("qr-reader");
    html5QrCode.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      (decodedText, decodedResult) => {
        // Stop scanning
        stopScanner();
        
        // Parse result
        let roomCode = decodedText;
        if (decodedText.includes('?join=')) {
          roomCode = new URL(decodedText).searchParams.get('join');
        }
        
        if (roomCode) {
          toast('QR Code scanned successfully!', 'info');
          const inputId = activeScanTarget === 'p2p' ? 'room-code-p2p' : 'room-code-server';
          const btnId = activeScanTarget === 'p2p' ? 'btn-join-p2p' : 'btn-join-server';
          
          document.getElementById(inputId).value = roomCode;
          // Trigger the join click
          document.getElementById(btnId).click();
        } else {
          toast('Invalid QR code format', 'error');
        }
      },
      (errorMessage) => {
        // parse errors are frequent and normal while scanning, ignore
      }
    ).catch((err) => {
      toast(`Camera error: ${err.message}`, 'error');
      stopScanner();
    });
  };

  const stopScanner = () => {
    document.getElementById('scanner-modal').classList.add('hidden');
    if (html5QrCode) {
      html5QrCode.stop().then(() => {
        html5QrCode.clear();
      }).catch(err => {
        console.error("Failed to stop scanner", err);
      });
      html5QrCode = null;
    }
  };

  document.getElementById('btn-scan-p2p').addEventListener('click', () => startScanner('p2p'));
  document.getElementById('btn-scan-server').addEventListener('click', () => startScanner('server'));
  document.getElementById('btn-close-scanner').addEventListener('click', stopScanner);

  document.getElementById('btn-join-server').addEventListener('click', async () => {
    currentMode = 'server';
    const alias = document.getElementById('alias-server').value.trim() || 'Anonymous';
    const code = document.getElementById('room-code-server').value.trim().toUpperCase();
    if (!code) { toast('Enter a room code', 'error'); return; }
    const btn = document.getElementById('btn-join-server');
    btn.textContent = 'Joining…'; btn.disabled = true;
    if (room) { room.destroy(); room = null; }
    room = new ServerRoom({ alias, onEvent: onRoomEvent });
    try {
      await room.joinRoom(code);
    } catch (err) {
      toast(`Failed to join server room "${code}"`, 'error');
      btn.textContent = 'Join Server Room'; btn.disabled = false;
      if (room) { room.destroy(); room = null; }
    }
  });
}

// ── Boot ───────────────────────────────────────────
initLobby();
initGlobalControls();
