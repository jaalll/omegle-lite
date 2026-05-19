const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const statusEl = document.getElementById('status');
const messagesEl = document.getElementById('messages');
const chatInput = document.getElementById('chat-input');
const chatForm = document.getElementById('chat-form');
const nextBtn = document.getElementById('next-btn');
const stopBtn = document.getElementById('stop-btn');
const sendBtn = document.getElementById('send-btn');

const ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let ws = null;
let pc = null;
let localStream = null;
let myRole = null; // 'caller' | 'callee'

// ── Helpers ──────────────────────────────────────────────────────────────────

function setStatus(text, color = '#aaa') {
  statusEl.textContent = text;
  statusEl.style.color = color;
}

function addMessage(text, type = 'system') {
  const div = document.createElement('div');
  div.className = `msg ${type}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setChatEnabled(enabled) {
  chatInput.disabled = !enabled;
  sendBtn.disabled = !enabled;
}

// ── Local media ───────────────────────────────────────────────────────────────

async function getLocalStream() {
  if (localStream) return localStream;
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;
  return localStream;
}

// ── WebRTC ────────────────────────────────────────────────────────────────────

function createPeerConnection() {
  if (pc) { pc.close(); pc = null; }

  pc = new RTCPeerConnection(ICE_SERVERS);

  // Add local tracks
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  // Receive remote stream
  pc.ontrack = (e) => {
    remoteVideo.srcObject = e.streams[0];
  };

  // Send ICE candidates to partner
  pc.onicecandidate = (e) => {
    if (e.candidate) wsSend({ type: 'ice', candidate: e.candidate });
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      setStatus('Conectado con un extraño', '#4caf50');
      setChatEnabled(true);
      stopBtn.disabled = false;
    }
    if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
      handlePartnerLeft();
    }
  };
}

async function startCall() {
  createPeerConnection();

  if (myRole === 'caller') {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    wsSend({ type: 'offer', sdp: pc.localDescription });
  }
}

// ── WebSocket ─────────────────────────────────────────────────────────────────

function wsSend(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function connect() {
  if (ws) { ws.onclose = null; ws.close(); }

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => setStatus('Buscando pareja...', '#ff6b35');

  ws.onmessage = async (e) => {
    const msg = JSON.parse(e.data);

    switch (msg.type) {
      case 'waiting':
        setStatus('Esperando a alguien...', '#ff6b35');
        break;

      case 'paired':
        myRole = msg.role;
        addMessage('¡Conectado! Di hola.');
        await startCall();
        break;

      case 'offer':
        createPeerConnection();
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        wsSend({ type: 'answer', sdp: pc.localDescription });
        break;

      case 'answer':
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        break;

      case 'ice':
        if (pc) await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        break;

      case 'chat':
        addMessage(msg.text, 'them');
        break;

      case 'partner_left':
        handlePartnerLeft();
        break;
    }
  };

  ws.onclose = () => {
    setStatus('Desconectado', '#f44336');
    setChatEnabled(false);
  };
}

function handlePartnerLeft() {
  addMessage('El extraño se desconectó.');
  setStatus('Desconectado', '#f44336');
  setChatEnabled(false);
  stopBtn.disabled = true;
  remoteVideo.srcObject = null;
  if (pc) { pc.close(); pc = null; }
}

// ── Controls ──────────────────────────────────────────────────────────────────

nextBtn.addEventListener('click', async () => {
  messagesEl.innerHTML = '';
  setChatEnabled(false);
  stopBtn.disabled = true;
  remoteVideo.srcObject = null;
  if (pc) { pc.close(); pc = null; }

  try {
    await getLocalStream();
    connect();
    nextBtn.disabled = true;
    setTimeout(() => nextBtn.disabled = false, 2000); // debounce
  } catch (err) {
    setStatus('Error: no se pudo acceder a la cámara/micrófono', '#f44336');
  }
});

stopBtn.addEventListener('click', () => {
  if (ws) { ws.onclose = null; ws.close(); }
  if (pc) { pc.close(); pc = null; }
  handlePartnerLeft();
});

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  wsSend({ type: 'chat', text });
  addMessage(text, 'me');
  chatInput.value = '';
});

// Init: get camera on load
getLocalStream().catch(() => {
  setStatus('Permite el acceso a cámara y micrófono para continuar', '#f44336');
});
