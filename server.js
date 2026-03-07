// ============================================================
// WhatsApp News Widget Server
// Run in a separate terminal: node server.js
// Then open http://localhost:3000 to see the widget
// ============================================================

const http = require('http');

const PORT = process.env.PORT || 3000;
const MAX_MESSAGES = 50;

let messages = [];
let sseClients = [];

// ============================================================
// Widget HTML
// ============================================================
const WIDGET_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Official WIN PC App NEWS</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f0f2f5;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      padding: 20px;
    }

    .widget {
      width: 100%;
      max-width: 480px;
      background: white;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 2px 16px rgba(0,0,0,0.1);
      display: flex;
      flex-direction: column;
      height: calc(100vh - 40px);
    }

    .header {
      background: #075E54;
      color: white;
      padding: 14px 16px;
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }

    .header-icon {
      width: 32px;
      height: 32px;
      background: #25D366;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
    }

    .header-text h1 {
      font-size: 16px;
      font-weight: 600;
    }

    .header-text p {
      font-size: 12px;
      opacity: 0.75;
      margin-top: 1px;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #ccc;
      margin-left: auto;
      flex-shrink: 0;
      transition: background 0.3s;
    }

    .status-dot.live { background: #25D366; }

    .feed {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
    }

    .empty {
      text-align: center;
      padding: 60px 20px;
      color: #aaa;
    }

    .empty-icon { font-size: 40px; margin-bottom: 12px; }
    .empty p { font-size: 14px; line-height: 1.6; }

    .card {
      padding: 12px 16px;
      border-bottom: 1px solid #f0f0f0;
      animation: slideIn 0.3s ease;
    }

    @keyframes slideIn {
      from { opacity: 0; transform: translateY(-8px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .card:last-child { border-bottom: none; }

    .card-meta {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 6px;
    }

    .sender {
      font-weight: 600;
      font-size: 13px;
      color: #075E54;
    }

    .time {
      font-size: 11px;
      color: #aaa;
      flex-shrink: 0;
      margin-left: 8px;
    }

    .new-badge {
      display: inline-block;
      background: #25D366;
      color: white;
      font-size: 10px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 8px;
      margin-left: 6px;
      vertical-align: middle;
    }

    .text {
      font-size: 14px;
      line-height: 1.55;
      color: #222;
      word-break: break-word;
    }

    .text a {
      color: #075E54;
      text-decoration: none;
    }

    .text a:hover { text-decoration: underline; }

    .media-thumb {
      width: 100%;
      max-height: 320px;
      object-fit: contain;
      border-radius: 8px;
      margin-top: 8px;
      display: block;
      background: #f0f0f0;
      cursor: zoom-in;
    }

    .video-wrap {
      position: relative;
      margin-top: 8px;
      border-radius: 8px;
      overflow: hidden;
      cursor: pointer;
    }

    .video-wrap img {
      width: 100%;
      max-height: 220px;
      object-fit: cover;
      display: block;
    }

    .play-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.3);
    }

    .play-btn {
      width: 52px;
      height: 52px;
      background: rgba(255,255,255,0.9);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      padding-left: 4px;
    }

    .media-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: #f5f5f5;
      border-radius: 6px;
      padding: 4px 10px;
      font-size: 13px;
      color: #555;
      margin-top: 6px;
    }

    .link-preview {
      border-left: 3px solid #25D366;
      background: #f9f9f9;
      border-radius: 0 6px 6px 0;
      margin-top: 8px;
      overflow: hidden;
    }

    .link-preview-img {
      width: 100%;
      max-height: 180px;
      object-fit: cover;
      display: block;
    }

    .link-preview-body {
      padding: 8px 10px;
      font-size: 13px;
      color: #555;
    }

    .link-preview-title {
      font-weight: 600;
      color: #222;
      font-size: 13px;
      margin-bottom: 2px;
    }

    .link-preview-desc {
      font-size: 12px;
      color: #777;
      margin-bottom: 4px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .link-preview-url {
      font-size: 11px;
      color: #25D366;
      word-break: break-all;
    }

    /* Lightbox */
    #lightbox {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.92);
      z-index: 9999;
      cursor: zoom-out;
      align-items: center;
      justify-content: center;
    }
    #lightbox.open { display: flex; }
    #lightbox img {
      max-width: 95vw;
      max-height: 95vh;
      object-fit: contain;
      border-radius: 4px;
    }

    /* Scrollbar */
    .feed::-webkit-scrollbar { width: 4px; }
    .feed::-webkit-scrollbar-track { background: transparent; }
    .feed::-webkit-scrollbar-thumb { background: #ddd; border-radius: 2px; }
  </style>
</head>
<body>
  <div class="widget">
    <div class="header">
      <div class="header-icon">📢</div>
      <div class="header-text">
        <h1>Official WIN PC App NEWS</h1>
        <p id="subtitle">Connecting...</p>
      </div>
      <div class="status-dot" id="dot"></div>
    </div>
    <div class="feed" id="feed">
      <div class="empty" id="empty">
        <div class="empty-icon">💬</div>
        <p>No messages yet.<br>Send a message to the WhatsApp group.</p>
      </div>
    </div>
  </div>
  <div id="lightbox"><img id="lb-img" src="" alt="Full image"></div>

  <script>
    const feed = document.getElementById('feed');
    const empty = document.getElementById('empty');
    const dot = document.getElementById('dot');
    const subtitle = document.getElementById('subtitle');
    let msgCount = 0;

    function timeAgo(iso) {
      const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
      if (diff < 5)    return 'just now';
      if (diff < 60)   return diff + 's ago';
      if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
      if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
      return new Date(iso).toLocaleDateString();
    }

    function escapeHtml(s) {
      return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function linkify(text) {
      const escaped = escapeHtml(text);
      return escaped.replace(/(https?:\\/\\/[^\\s&]+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
      );
    }

    function hasUrl(text) {
      return /https?:\\/\\/[^\\s]+/.test(text || '');
    }

    function extractUrls(text) {
      return (text || '').match(/https?:\\/\\/[^\\s]+/g) || [];
    }

    function buildCard(msg, isNew) {
      const div = document.createElement('div');
      div.className = 'card';

      const name = escapeHtml(msg.push_name || msg.sender || 'Unknown');
      const badge = isNew ? '<span class="new-badge">NEW</span>' : '';
      const time = timeAgo(msg.timestamp);
      const type = msg.message_type;
      const text = msg.text || '';

      let bodyHtml = '';

      if (type === 'text') {
        bodyHtml = '<div class="text">' + linkify(text) + '</div>';
        if (msg.thumbnail || msg.link_title) {
          // Rich link preview with image, title, description
          let p = '<div class="link-preview">';
          if (msg.thumbnail) p += '<img class="link-preview-img" src="data:image/jpeg;base64,' + msg.thumbnail + '" alt="">';
          p += '<div class="link-preview-body">';
          if (msg.link_title) p += '<div class="link-preview-title">' + escapeHtml(msg.link_title) + '</div>';
          if (msg.link_description) p += '<div class="link-preview-desc">' + escapeHtml(msg.link_description) + '</div>';
          const url = msg.link_url || extractUrls(text)[0] || '';
          if (url) p += '<div class="link-preview-url">🔗 ' + escapeHtml(url) + '</div>';
          p += '</div></div>';
          bodyHtml += p;
        } else if (hasUrl(text)) {
          const urls = extractUrls(text);
          bodyHtml += '<div class="link-preview"><div class="link-preview-body"><div class="link-preview-url">🔗 ' + escapeHtml(urls[0]) + '</div></div></div>';
        }

      } else if (type === 'image') {
        if (text) bodyHtml += '<div class="text">' + linkify(text) + '</div>';
        if (msg.thumbnail) {
          const mime = msg.mimetype || 'image/jpeg';
          bodyHtml += '<img class="media-thumb" src="data:' + mime + ';base64,' + msg.thumbnail + '" alt="Photo">';
        } else {
          bodyHtml += '<span class="media-badge">📷 Photo</span>';
        }

      } else if (type === 'video') {
        if (text) bodyHtml += '<div class="text">' + linkify(text) + '</div>';
        if (msg.thumbnail) {
          bodyHtml += '<div class="video-wrap"><img src="data:image/jpeg;base64,' + msg.thumbnail + '" alt="Video"><div class="play-overlay"><div class="play-btn">▶</div></div></div>';
        } else {
          bodyHtml += '<span class="media-badge">🎥 Video</span>';
        }

      } else if (type === 'voice_note') {
        bodyHtml = '<span class="media-badge">🎤 Voice note' + (msg.duration_seconds ? ' · ' + msg.duration_seconds + 's' : '') + '</span>';

      } else if (type === 'audio') {
        bodyHtml = '<span class="media-badge">🎵 Audio</span>';

      } else if (type === 'document') {
        bodyHtml = '<span class="media-badge">📄 ' + escapeHtml(text || 'Document') + '</span>';

      } else if (type === 'sticker') {
        bodyHtml = '<span class="media-badge">🎭 Sticker</span>';

      } else {
        if (text) bodyHtml = '<div class="text">' + linkify(text) + '</div>';
      }

      div.innerHTML =
        '<div class="card-meta">' +
          '<span class="sender">' + name + badge + '</span>' +
          '<span class="time">' + time + '</span>' +
        '</div>' +
        bodyHtml;

      return div;
    }

    function showMessage(msg, prepend) {
      empty.style.display = 'none';
      const card = buildCard(msg, prepend);
      if (prepend) {
        feed.insertBefore(card, feed.firstChild);
        setTimeout(() => {
          const b = card.querySelector('.new-badge');
          if (b) b.remove();
        }, 6000);
      } else {
        feed.appendChild(card);
      }
      msgCount++;
      subtitle.textContent = msgCount + ' message' + (msgCount === 1 ? '' : 's');
    }

    // Load existing messages on page load
    fetch('/messages')
      .then(r => r.json())
      .then(msgs => msgs.forEach(m => showMessage(m, false)))
      .catch(() => {});

    // Real-time updates via SSE
    const es = new EventSource('/events');
    let errorTimer = null;
    es.onopen = () => {
      clearTimeout(errorTimer);
      dot.classList.add('live');
      if (msgCount === 0) subtitle.textContent = 'Live — waiting for messages';
    };
    es.onerror = () => {
      errorTimer = setTimeout(() => {
        dot.classList.remove('live');
        subtitle.textContent = 'Reconnecting...';
      }, 5000);
    };
    es.onmessage = e => {
      clearTimeout(errorTimer);
      dot.classList.add('live');
      showMessage(JSON.parse(e.data), true);
    };

    // Lightbox
    const lightbox = document.getElementById('lightbox');
    const lbImg = document.getElementById('lb-img');
    feed.addEventListener('click', e => {
      const img = e.target.closest('.media-thumb');
      if (img) { lbImg.src = img.src; lightbox.classList.add('open'); }
    });
    lightbox.addEventListener('click', () => lightbox.classList.remove('open'));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') lightbox.classList.remove('open');
    });
  </script>
</body>
</html>`;

// ============================================================
// HTTP Server
// ============================================================
const server = http.createServer((req, res) => {

    // Receive webhook from index.js
    if (req.method === 'POST' && req.url === '/webhooks') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const payload = JSON.parse(body);
                if (payload.event === 'group_message') {
                    messages.unshift(payload);
                    if (messages.length > MAX_MESSAGES) messages.pop();

                    // Push to all connected SSE clients
                    const data = `data: ${JSON.stringify(payload)}\n\n`;
                    sseClients.forEach(client => client.write(data));

                    const name = payload.push_name || payload.sender;
                    const preview = (payload.text || '[' + payload.message_type + ']').substring(0, 50);
                    console.log(`[${new Date().toLocaleTimeString()}] ${name}: ${preview}`);
                }
            } catch (e) {
                console.error('Bad payload:', e.message);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"status":"ok"}');
        });
        return;
    }

    // SSE stream for real-time browser updates
    if (req.method === 'GET' && req.url === '/events') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        res.write(': connected\n\n');
        sseClients.push(res);
        const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
        req.on('close', () => {
            clearInterval(heartbeat);
            sseClients = sseClients.filter(c => c !== res);
        });
        return;
    }

    // JSON feed of all stored messages
    if (req.method === 'GET' && req.url === '/messages') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(messages));
        return;
    }

    // Serve widget page
    if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(WIDGET_HTML);
        return;
    }

    res.writeHead(404);
    res.end('Not found');
});

server.listen(PORT, () => {
    console.log('============================================================');
    console.log('  WhatsApp News Widget');
    console.log('============================================================');
    console.log('Widget: http://localhost:' + PORT);
    console.log('Waiting for messages from WhatsApp monitor...\n');
});
