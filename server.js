// ============================================================
// WhatsApp News Widget Server
// Run in a separate terminal: node server.js
// Then open http://localhost:3000 to see the widget
// ============================================================

const http = require('http');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const MAX_MESSAGES = 50;
const DB_ENABLED = !!process.env.DATABASE_URL;

const pool = DB_ENABLED ? new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
}) : null;

let messages = [];
let sseClients = [];

async function initDb() {
    if (!DB_ENABLED) {
        console.log('No DATABASE_URL — running in memory-only mode.');
        return;
    }
    await pool.query(`
        CREATE TABLE IF NOT EXISTS messages (
            id          SERIAL PRIMARY KEY,
            message_id  TEXT UNIQUE NOT NULL,
            payload     JSONB NOT NULL,
            created_at  TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    const { rows } = await pool.query(
        `SELECT payload FROM messages ORDER BY created_at DESC LIMIT $1`,
        [MAX_MESSAGES]
    );
    messages = rows.map(r => r.payload).reverse();
    console.log(`Loaded ${messages.length} messages from database.`);
}

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

    .edited-label {
      font-size: 11px;
      color: #aaa;
      font-style: italic;
      margin-left: 4px;
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
      max-width: 100%;
      max-height: 180px;
      object-fit: contain;
      display: block;
      margin: 0 auto;
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

      const editedLabel = msg.is_edited ? '<span class="edited-label">(edited)</span>' : '';

      div.innerHTML =
        '<div class="card-meta">' +
          '<span class="sender">' + name + badge + '</span>' +
          '<span class="time">' + time + editedLabel + '</span>' +
        '</div>' +
        bodyHtml;

      return div;
    }

    function updateCard(cardEl, newText) {
      var textEl = cardEl.querySelector('.text');
      if (textEl) textEl.innerHTML = linkify(newText);
      var timeEl = cardEl.querySelector('.time');
      if (timeEl && !timeEl.querySelector('.edited-label')) {
        timeEl.insertAdjacentHTML('beforeend', '<span class="edited-label">(edited)</span>');
      }
    }

    function showMessage(msg, isNew) {
      empty.style.display = 'none';
      const card = buildCard(msg, isNew);
      feed.insertBefore(card, feed.firstChild);
      if (isNew) {
        setTimeout(() => {
          const b = card.querySelector('.new-badge');
          if (b) b.remove();
        }, 6000);
      }
      msgCount++;
      subtitle.textContent = msgCount + ' message' + (msgCount === 1 ? '' : 's');
      return card;
    }

    // Track displayed cards: message_id -> { text, is_edited, cardEl }
    const knownMessages = new Map();
    let initialLoadDone = false;
    let pollFailures = 0;

    function poll() {
      fetch('__BASE_URL__/messages')
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(msgs => {
          pollFailures = 0;
          dot.classList.add('live');
          if (msgCount === 0) subtitle.textContent = 'Live — waiting for messages';

          const serverIds = new Set(msgs.map(m => m.message_id));
          for (const [id, entry] of knownMessages) {
            if (!serverIds.has(id)) {
              entry.cardEl.remove();
              knownMessages.delete(id);
              msgCount--;
            }
          }
          if (msgCount <= 0) { msgCount = 0; empty.style.display = ''; }

          msgs.forEach(m => {
            if (!knownMessages.has(m.message_id)) {
              const card = showMessage(m, initialLoadDone);
              knownMessages.set(m.message_id, { text: m.text, is_edited: !!m.is_edited, cardEl: card });
            } else if (m.is_edited) {
              const entry = knownMessages.get(m.message_id);
              if (!entry.is_edited || m.text !== entry.text) {
                updateCard(entry.cardEl, m.text);
                entry.text = m.text;
                entry.is_edited = true;
              }
            }
          });
          if (msgCount > 0) subtitle.textContent = msgCount + ' message' + (msgCount === 1 ? '' : 's');
          initialLoadDone = true;

          setTimeout(poll, 4000);
        })
        .catch(() => {
          pollFailures++;
          if (pollFailures >= 2) {
            dot.classList.remove('live');
            subtitle.textContent = 'Reconnecting...';
          }
          setTimeout(poll, 5000);
        });
    }

    poll();

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
        req.on('end', async () => {
            try {
                const payload = JSON.parse(body);
                if (payload.event === 'group_message' && (payload.text || payload.thumbnail)) {
                    messages.push(payload);
                    if (messages.length > MAX_MESSAGES) messages.shift();

                    if (DB_ENABLED) {
                        await pool.query(
                            'INSERT INTO messages (message_id, payload) VALUES ($1, $2) ON CONFLICT (message_id) DO NOTHING',
                            [payload.message_id, payload]
                        );
                    }

                    // Push to all connected SSE clients
                    const data = `data: ${JSON.stringify(payload)}\n\n`;
                    sseClients.forEach(client => client.write(data));

                    const name = payload.push_name || payload.sender;
                    const preview = (payload.text || '[' + payload.message_type + ']').substring(0, 50);
                    console.log(`[${new Date().toLocaleTimeString()}] ${name}: ${preview}`);
                } else if (payload.event === 'message_edit' && payload.original_message_id) {
                    const idx = messages.findIndex(m => m.message_id === payload.original_message_id);
                    if (idx !== -1) {
                        messages[idx].text = payload.text;
                        messages[idx].is_edited = true;
                        if (DB_ENABLED) {
                            await pool.query(
                                `UPDATE messages SET payload = payload || jsonb_build_object('text', $1::text, 'is_edited', true) WHERE payload->>'message_id' = $2`,
                                [payload.text, payload.original_message_id]
                            );
                        }
                        const name = payload.push_name || payload.sender;
                        console.log(`[${new Date().toLocaleTimeString()}] EDIT ${name}: ${(payload.text || '').substring(0, 50)}`);
                    }
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
            'X-Accel-Buffering': 'no',
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

    // Delete a specific message by ID
    if (req.method === 'DELETE' && req.url.startsWith('/messages/')) {
        const id = decodeURIComponent(req.url.slice('/messages/'.length));
        const before = messages.length;
        messages = messages.filter(m => m.message_id !== id);
        if (messages.length < before) {
            console.log(`[ADMIN] Deleted message: ${id}`);
            if (DB_ENABLED) {
                pool.query('DELETE FROM messages WHERE message_id = $1', [id])
                    .catch(e => console.error('DB delete error:', e.message));
            }
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end('{"status":"deleted"}');
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end('{"status":"not_found"}');
        }
        return;
    }

    // Archive: GET /archive?month=YYYY-MM → messages for that month
    //          GET /archive               → list of available months
    if (req.method === 'GET' && req.url.startsWith('/archive')) {
        if (!DB_ENABLED) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end('{"error":"no database configured"}');
            return;
        }
        (async () => {
            try {
                const qs = new URL(req.url, 'http://localhost').searchParams;
                const month = qs.get('month');
                let data;
                if (month) {
                    const { rows } = await pool.query(
                        `SELECT payload FROM messages WHERE to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM') = $1 ORDER BY created_at ASC`,
                        [month]
                    );
                    data = rows.map(r => r.payload);
                } else {
                    const { rows } = await pool.query(
                        `SELECT DISTINCT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month FROM messages ORDER BY month DESC`
                    );
                    data = rows.map(r => r.month);
                }
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify(data));
            } catch (e) {
                console.error('Archive error:', e.message);
                res.writeHead(500);
                res.end('{"error":"database error"}');
            }
        })();
        return;
    }

    // JSON feed of all stored messages
    if (req.method === 'GET' && req.url === '/messages') {
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(messages));
        return;
    }

    // Serve widget page
    if (req.method === 'GET') {
        const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const baseUrl = proto + '://' + host;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(WIDGET_HTML.replace('__BASE_URL__', baseUrl));
        return;
    }

    res.writeHead(404);
    res.end('Not found');
});

initDb().then(() => {
    server.listen(PORT, () => {
        console.log('============================================================');
        console.log('  WhatsApp News Widget');
        console.log('============================================================');
        console.log('Widget: http://localhost:' + PORT);
        console.log('Waiting for messages from WhatsApp monitor...\n');
    });
}).catch(err => {
    console.error('Database initialization failed:', err.message);
    process.exit(1);
});
