const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

// Simple static file server
const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
  };

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

// Queue of users waiting for a partner
let waitingUser = null;

// Map: ws -> { partner, id }
const clients = new Map();
let nextId = 1;

function send(ws, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

wss.on('connection', (ws) => {
  const id = nextId++;
  clients.set(ws, { id, partner: null });

  send(ws, { type: 'connected', id });

  // Try to pair with waiting user
  if (waitingUser && waitingUser.readyState === waitingUser.OPEN) {
    const partnerWs = waitingUser;
    waitingUser = null;

    clients.get(ws).partner = partnerWs;
    clients.get(partnerWs).partner = ws;

    // The first user (partnerWs) is the WebRTC "caller"
    send(partnerWs, { type: 'paired', role: 'caller' });
    send(ws, { type: 'paired', role: 'callee' });
  } else {
    waitingUser = ws;
    send(ws, { type: 'waiting' });
  }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const client = clients.get(ws);
    const partner = client?.partner;

    if (!partner || partner.readyState !== partner.OPEN) return;

    // Forward signaling and chat messages to partner
    if (['offer', 'answer', 'ice', 'chat'].includes(msg.type)) {
      send(partner, msg);
    }
  });

  ws.on('close', () => {
    const client = clients.get(ws);

    if (waitingUser === ws) waitingUser = null;

    if (client?.partner) {
      send(client.partner, { type: 'partner_left' });
      const partnerClient = clients.get(client.partner);
      if (partnerClient) partnerClient.partner = null;
    }

    clients.delete(ws);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
