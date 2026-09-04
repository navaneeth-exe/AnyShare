// ── radar.js ──
// Canvas-based animated radar rendering
// Shows live peer blips with sweep animation, glows, and avatars

const COLORS = ['#00ff88', '#00d4ff', '#ff2d78', '#b44dff', '#ffe600', '#ff7a00'];
const PEER_RADIUS = 18;

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

export function initRadar(canvas, getPeers, getSelf, onPeerClick) {
  const ctx = canvas.getContext('2d');
  let sweepAngle = 0;
  let animFrame;
  let peerPositions = {}; // peerId -> {x, y}
  let colorMap = {};
  let colorIdx = 0;

  function getColor(id) {
    if (!colorMap[id]) colorMap[id] = COLORS[colorIdx++ % COLORS.length];
    return colorMap[id];
  }

  function resize() {
    const container = canvas.parentElement;
    const size = Math.min(container.clientWidth, container.clientHeight) - 24;
    canvas.width = size;
    canvas.height = size;
  }

  function getCenter() { return { x: canvas.width / 2, y: canvas.height / 2 }; }
  function getRadius() { return canvas.width / 2 - 12; }

  function assignPosition(id) {
    if (peerPositions[id]) return;
    const R = getRadius();
    const cx = getCenter().x, cy = getCenter().y;
    // Scatter peers in inner 70% of radar
    const r = (Math.random() * 0.55 + 0.15) * R;
    const a = Math.random() * Math.PI * 2;
    peerPositions[id] = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  }

  function drawFrame() {
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;
    const R = getRadius();
    ctx.clearRect(0, 0, W, H);

    // Background circle
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fill();

    // Range rings
    [0.25, 0.5, 0.75, 1].forEach(f => {
      ctx.beginPath();
      ctx.arc(cx, cy, R * f, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0,255,136,${0.06 + (1 - f) * 0.06})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // Cross-hairs
    ctx.strokeStyle = 'rgba(0,255,136,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();

    // Sweep gradient
    sweepAngle = (sweepAngle + 0.018) % (Math.PI * 2);
    const grad = ctx.createConicalGradient
      ? null // fallback below
      : null;
    // Manual sweep arc
    const sweepLength = Math.PI * 0.55;
    const gradient = ctx.createLinearGradient(cx, cy, cx + R, cy);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(sweepAngle);
    const sweep = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
    sweep.addColorStop(0, 'rgba(0,255,136,0.0)');
    sweep.addColorStop(0.5, 'rgba(0,255,136,0.07)');
    sweep.addColorStop(1, 'rgba(0,255,136,0.0)');
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, -sweepLength, 0);
    ctx.closePath();
    ctx.fillStyle = sweep;
    ctx.fill();
    ctx.restore();

    // Sweep tip
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(
      cx + Math.cos(sweepAngle) * R,
      cy + Math.sin(sweepAngle) * R
    );
    ctx.strokeStyle = 'rgba(0,255,136,0.9)';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#00ff88';
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Center dot (self)
    const self = getSelf();
    if (self) {
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#00ff88';
      ctx.shadowColor = '#00ff88';
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Self label
      ctx.font = 'bold 9px "JetBrains Mono"';
      ctx.fillStyle = '#00ff88';
      ctx.textAlign = 'center';
      ctx.fillText('YOU', cx, cy - 12);
    }

    // Peer blips
    const peers = getPeers();
    peers.forEach(peer => {
      assignPosition(peer.id);
      const pos = peerPositions[peer.id];
      const color = getColor(peer.id);
      const rgb = hexToRgb(color);

      // Blip outer ring (pulse)
      const pulseScale = 1 + 0.15 * Math.sin(Date.now() / 600 + peer.id.charCodeAt(0));
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, PEER_RADIUS * pulseScale, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${rgb}, 0.4)`;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Blip core
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, PEER_RADIUS - 4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb}, 0.2)`;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Blip border
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, PEER_RADIUS - 4, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Peer monogram / initial
      const initial = (peer.alias || 'P').trim().slice(0, 1).toUpperCase();
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(initial, pos.x, pos.y);

      // Alias label
      ctx.font = 'bold 9px "JetBrains Mono"';
      ctx.fillStyle = color;
      ctx.textBaseline = 'top';
      const label = peer.alias.length > 8 ? peer.alias.slice(0, 7) + '…' : peer.alias;
      ctx.fillText(label, pos.x, pos.y + PEER_RADIUS - 2);
    });

    // Cleanup removed peers
    const peerIds = new Set(peers.map(p => p.id));
    for (const id of Object.keys(peerPositions)) {
      if (!peerIds.has(id)) delete peerPositions[id];
    }

    animFrame = requestAnimationFrame(drawFrame);
  }

  // Click detection
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const peers = getPeers();
    for (const peer of peers) {
      const pos = peerPositions[peer.id];
      if (!pos) continue;
      const dx = mx - pos.x, dy = my - pos.y;
      if (Math.sqrt(dx * dx + dy * dy) < PEER_RADIUS + 4) {
        if (onPeerClick) onPeerClick(peer);
        break;
      }
    }
  });

  window.addEventListener('resize', () => {
    resize();
    peerPositions = {}; // Re-scatter on resize
  });

  resize();
  drawFrame();

  return {
    stop: () => cancelAnimationFrame(animFrame),
    resetPositions: () => { peerPositions = {}; }
  };
}
