const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const pty = require('node-pty');

const PORT = process.env.PORT || 8080;
const uname = "admin";
const pwd = "admin";

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.get('/', (req, res) => {
  //Embeded shell.html content here
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Web Terminal</title>
  <link rel="stylesheet" href="https://unpkg.com/xterm/css/xterm.css" />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #121212, #1f1f1f);
      color: #fff;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .login-container {
      flex: 1;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
      background: radial-gradient(circle at center, #2a2a2a, #121212);
    }
    .login-card {
      background-color: #222;
      padding: 40px 30px;
      border-radius: 12px;
      box-shadow: 0 0 20px rgba(0, 0, 0, 0.7);
      width: 100%;
      max-width: 400px;
      text-align: center;
    }
    .login-card h2 {
      margin-bottom: 20px;
      font-size: 24px;
    }
    .login-card input {
      width: 100%;
      padding: 14px;
      margin: 10px 0;
      border: none;
      border-radius: 8px;
      background-color: #333;
      color: #fff;
      font-size: 16px;
    }
    .login-card input::placeholder { color: #aaa; }
    .login-card button {
      width: 100%;
      padding: 14px;
      background-color: #04c4cc;
      color: #fff;
      font-size: 16px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      margin-top: 15px;
      transition: background 0.3s ease;
    }
    .login-card button:hover { background-color: #03b1b9; }
    #login-error {
      color: #ff4d4d;
      margin-top: 10px;
      font-size: 14px;
    }
    #terminal {
      display: none;
      flex: 1;
      height: 100vh;
      width: 100%;
      background: #000;
      overflow: hidden;
    }
    @media (max-width: 480px) {
      .login-card { padding: 30px 20px; }
      .login-card h2 { font-size: 20px; }
      .login-card input, .login-card button {
        font-size: 15px;
        padding: 12px;
      }
    }
  </style>
</head>
<body>

<div class="login-container" id="login-form">
  <div class="login-card">
    <h2>Web Terminal Login</h2>
    <input id="username" type="text" placeholder="Username" autocomplete="off" />
    <input id="password" type="password" placeholder="Password" />
    <button onclick="connect()">Login</button>
    <div id="login-error"></div>
  </div>
</div>

<div id="terminal"></div>

<script src="https://unpkg.com/xterm/lib/xterm.js"></script>
<script src="https://unpkg.com/xterm-addon-fit/lib/xterm-addon-fit.js"></script>

<script>
  let term;
  let socket;
  let resizeInterval;

  function connect() {
    const uname = document.getElementById("username").value.trim();
    const pwd = document.getElementById("password").value;
    document.getElementById("login-error").innerText = "";

    if (!uname || !pwd) {
      document.getElementById("login-error").innerText = "Username and password required.";
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.host;
    const socketUrl = \`\${protocol}://\${host}/\`;

    socket = new WebSocket(socketUrl);

    socket.onopen = () => {
      socket.send(JSON.stringify({ username: uname, password: pwd }));
    };

    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === 'auth') {
        if (msg.status === 'failure') {
          document.getElementById("login-error").innerText = "Invalid credentials.";
          socket.close();
        } else {
          document.getElementById("login-form").style.display = "none";
          document.getElementById("terminal").style.display = "flex";
          startTerminal(uname);
        }
      } else if (msg.type === 'output') {
        let text = msg.data;
        if (text.includes('\\x1b[2J') && text.includes('\\x1b[H')) {
          term.write('\\x1bc');
        }
        term.write(msg.data);
      }
    };

    socket.onerror = () => {
      document.getElementById("login-error").innerText = "⚠ Connection error.";
    };

    socket.onclose = () => {
      if (term) term.writeln("\\r\\n🔌 Disconnected.");
      clearInterval(resizeInterval);
    };
  }

  function startTerminal(username) {
    term = new Terminal({ cursorBlink: true });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);

    term.open(document.getElementById('terminal'));
    fitAddon.fit();

    term.onData(data => {
      socket.send(JSON.stringify({ type: 'input', data }));
    });

    function sendResize() {
      if (!socket || socket.readyState !== 1) return;
      fitAddon.fit();
      const cols = term.cols;
      const rows = term.rows;
      socket.send(JSON.stringify({ type: 'resize', data: { cols, rows } }));
    }

    window.addEventListener("resize", sendResize);
    resizeInterval = setInterval(sendResize, 20000);
    setTimeout(sendResize, 300);

    term.writeln("✅ Authenticated — welcome, " + username);
    term.writeln("©2025 Arif Chowdhury \\r\\nAll rights reserved.\\n\\r");
  }
</script>
</body>
</html>`);
});

class PersistentConsole {
  constructor(ws) {
    this.ws = ws;

    this.ptyProcess = pty.spawn('/bin/bash', ['-l'], {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd: process.env.HOME,
      env: { ...process.env, PS1: '[\\u@\\h \\W] $ ' }
    });

    this.ptyProcess.on('data', (data) => {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'output', data }));
      }
    });

    this.ptyProcess.onExit(() => {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
    });
  }

  executeCharacter(char) {
    this.ptyProcess.write(char);
  }

  resize(cols, rows) {
    this.ptyProcess.resize(cols, rows);
  }

  close() {
    this.ptyProcess.kill();
  }
}

wss.on('connection', (ws) => {
  let authenticated = false;
  let consoleSession = null;

  ws.on('message', (message) => {
    if (!authenticated) {
      try {
        const { username, password } = JSON.parse(message);
        if (username === uname && password === pwd) {
          authenticated = true;
          ws.send(JSON.stringify({ type: 'auth', status: 'success' }));
          consoleSession = new PersistentConsole(ws);
        } else {
          ws.send(JSON.stringify({ type: 'auth', status: 'failure' }));
          ws.close();
        }
      } catch {
        ws.send(JSON.stringify({ type: 'auth', status: 'failure' }));
        ws.close();
      }
    } else {
      const { type, data } = JSON.parse(message);
      if (type === 'input') {
        consoleSession.executeCharacter(data);
      } else if (type === 'resize') {
        consoleSession.resize(data.cols, data.rows);
      }
    }
  });

  ws.on('close', () => {
    if (consoleSession) consoleSession.close();
  });

  ws.on('error', () => {
    if (consoleSession) consoleSession.close();
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});