// ============================================================
// WhatsApp Group Monitor → Webhook Forwarder
// ============================================================
// Usage:
//   First run:   node index.js --list-groups
//   Then run:    node index.js
//
// Make sure to edit the CONFIG section below before running.
// ============================================================

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// ============================================================
// ██████  CONFIG — EDIT THESE VALUES ██████
// ============================================================

const CONFIG = {
    // Your webhook URL (your ngrok endpoint)
    WEBHOOK_URL: 'https://win-news-widget-production.up.railway.app/webhooks',

    // Group IDs to monitor. Leave empty [] to monitor ALL groups.
    // After running with --list-groups, paste the group IDs here.
    // Example: ['120363012345678901@g.us', '120363098765432101@g.us']
    GROUP_IDS: ['120363424655751252@g.us'],

    // Set to true to also forward media message metadata (images, videos, docs)
    FORWARD_MEDIA_INFO: true,

    // Set to true to print all messages to console
    VERBOSE: true,

    // Retry webhook delivery this many times on failure
    MAX_RETRIES: 3,

    // Seconds between retry attempts
    RETRY_DELAY_SECONDS: 2,

    // Port for the local QR code web page
    QR_PORT: 3001,
};

// ============================================================
// END CONFIG
// ============================================================

const AUTH_FOLDER = path.join(__dirname, 'auth_session');
const GROUPS_FILE = path.join(__dirname, 'groups.txt');
const isListMode = process.argv.includes('--list-groups');

// ----------------------------------------------------------
// QR Code web server
// ----------------------------------------------------------
let currentQR = null;
let qrServer = null;
let connectAttempts = 0;
let browserOpened = false;
const MAX_CONNECT_ATTEMPTS = 8;

const QR_PAGE = `<!DOCTYPE html>
<html>
<head>
  <title>WhatsApp QR Code</title>
  <style>
    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f0f2f5; margin: 0; }
    h1 { color: #25D366; margin-bottom: 5px; }
    #box { display: inline-block; background: white; padding: 30px 40px; border-radius: 16px;
           box-shadow: 0 4px 20px rgba(0,0,0,0.12); margin-top: 20px; }
    #qrcode { margin: 20px auto; }
    #msg { color: #555; margin-top: 10px; font-size: 14px; }
    #steps { color: #888; font-size: 13px; margin-top: 8px; }
  </style>
</head>
<body>
  <h1>WhatsApp QR Code</h1>
  <p style="color:#888">Scan with your phone to link this device</p>
  <div id="box">
    <div id="qrcode"></div>
    <p id="msg">Loading QR code...</p>
    <p id="steps">WhatsApp &rarr; Settings &rarr; Linked Devices &rarr; Link a Device</p>
  </div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
  <script>
    var lastQR = null;
    function refresh() {
      fetch('/qr').then(function(r){ return r.text(); }).then(function(data) {
        if (data && data !== lastQR) {
          lastQR = data;
          document.getElementById('qrcode').innerHTML = '';
          new QRCode(document.getElementById('qrcode'), { text: data, width: 280, height: 280 });
          document.getElementById('msg').textContent = 'Scan the code above with your phone';
        } else if (!data) {
          document.getElementById('msg').textContent = 'Waiting for QR code from WhatsApp...';
        }
      });
    }
    refresh();
    setInterval(refresh, 3000);
  </script>
</body>
</html>`;

function startQRServer() {
    qrServer = http.createServer((req, res) => {
        if (req.url === '/qr') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end(currentQR || '');
        } else {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(QR_PAGE);
        }
    });

    qrServer.listen(CONFIG.QR_PORT);
}

function stopQRServer() {
    if (qrServer) {
        qrServer.close();
        qrServer = null;
    }
}

// ----------------------------------------------------------
// Utility: Send data to webhook with retries
// ----------------------------------------------------------
async function sendToWebhook(payload) {
    for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(CONFIG.WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (response.ok) {
                if (CONFIG.VERBOSE) {
                    console.log(`  Webhook delivered (HTTP ${response.status})`);
                }
                return true;
            } else {
                console.log(`  Webhook returned HTTP ${response.status} (attempt ${attempt}/${CONFIG.MAX_RETRIES})`);
            }
        } catch (err) {
            console.log(`  Webhook error (attempt ${attempt}/${CONFIG.MAX_RETRIES}): ${err.message}`);
        }

        if (attempt < CONFIG.MAX_RETRIES) {
            await new Promise(r => setTimeout(r, CONFIG.RETRY_DELAY_SECONDS * 1000));
        }
    }
    console.log('  Webhook delivery failed after all retries.');
    return false;
}

// ----------------------------------------------------------
// Utility: Extract readable message content
// ----------------------------------------------------------
function extractMessageContent(message) {
    if (!message) return { type: 'unknown', content: null };

    if (message.conversation) {
        return { type: 'text', content: message.conversation };
    }
    if (message.extendedTextMessage?.text) {
        const ext = message.extendedTextMessage;
        const thumb = ext.jpegThumbnail;
        return {
            type: 'text',
            content: ext.text,
            linkTitle: ext.title || null,
            linkDescription: ext.description || null,
            linkUrl: ext.matchedText || null,
            thumbnail: thumb ? Buffer.from(thumb).toString('base64') : null,
        };
    }
    if (message.imageMessage) {
        const thumb = message.imageMessage.jpegThumbnail;
        return {
            type: 'image',
            content: message.imageMessage.caption || '',
            mimetype: message.imageMessage.mimetype,
            thumbnail: thumb ? Buffer.from(thumb).toString('base64') : null,
        };
    }
    if (message.videoMessage) {
        const thumb = message.videoMessage.jpegThumbnail;
        return {
            type: 'video',
            content: message.videoMessage.caption || '',
            mimetype: message.videoMessage.mimetype,
            thumbnail: thumb ? Buffer.from(thumb).toString('base64') : null,
        };
    }
    if (message.audioMessage) {
        return { type: message.audioMessage.ptt ? 'voice_note' : 'audio', content: '[Audio]', mimetype: message.audioMessage.mimetype, seconds: message.audioMessage.seconds };
    }
    if (message.documentMessage) {
        return { type: 'document', content: message.documentMessage.fileName || '[Document]', mimetype: message.documentMessage.mimetype };
    }
    if (message.stickerMessage) {
        return { type: 'sticker', content: '[Sticker]' };
    }
    if (message.locationMessage) {
        return { type: 'location', content: `${message.locationMessage.degreesLatitude}, ${message.locationMessage.degreesLongitude}`, name: message.locationMessage.name || null };
    }
    if (message.contactMessage) {
        return { type: 'contact', content: message.contactMessage.displayName || '[Contact]' };
    }
    if (message.pollCreationMessage || message.pollCreationMessageV3) {
        const poll = message.pollCreationMessage || message.pollCreationMessageV3;
        return { type: 'poll', content: poll.name, options: poll.options?.map(o => o.optionName) || [] };
    }
    if (message.reactionMessage) {
        return { type: 'reaction', content: message.reactionMessage.text || '[Reaction removed]', reactedTo: message.reactionMessage.key?.id };
    }
    if (message.protocolMessage) {
        return { type: 'protocol', content: null };
    }
    if (message.editedMessage) {
        const inner = message.editedMessage?.message;
        if (inner) {
            const extracted = extractMessageContent(inner);
            return { ...extracted, isEdited: true };
        }
        return { type: 'protocol', content: null };
    }

    const knownTypes = Object.keys(message).filter(k => k !== 'messageContextInfo');
    return { type: knownTypes[0] || 'unknown', content: `[${knownTypes[0] || 'Unknown message type'}]` };
}

// ----------------------------------------------------------
// Mode: List all groups — saves to groups.txt and opens it
// ----------------------------------------------------------
async function listGroups(sock) {
    console.log('Fetching all groups...');

    try {
        const groups = await sock.groupFetchAllParticipating();
        const groupList = Object.values(groups).sort((a, b) =>
            (a.subject || '').localeCompare(b.subject || '')
        );

        if (groupList.length === 0) {
            console.log('You are not in any groups.');
            return;
        }

        const sep = '='.repeat(80);
        const dash = '-'.repeat(80);
        const lines = [
            sep,
            'WHATSAPP GROUP LIST',
            `Generated: ${new Date().toLocaleString()}`,
            `Total groups: ${groupList.length}`,
            sep,
            '',
            'GROUP NAME'.padEnd(45) + 'MEMBERS'.padEnd(10) + 'GROUP ID',
            dash,
            ...groupList.map(g =>
                (g.subject || 'Unnamed').substring(0, 43).padEnd(45) +
                String(g.participants?.length || '?').padEnd(10) +
                g.id
            ),
            '',
            sep,
            'HOW TO USE:',
            '  1. Find the group you want to monitor above',
            '  2. Copy its GROUP ID (e.g. 120363012345678901@g.us)',
            '  3. Open index.js and paste it into CONFIG.GROUP_IDS:',
            "     GROUP_IDS: ['120363012345678901@g.us']",
            '  4. Save index.js and run:  node index.js',
            sep,
        ];

        fs.writeFileSync(GROUPS_FILE, lines.join('\r\n'), 'utf-8');
        console.log(`\nGroup list saved to: ${GROUPS_FILE}`);
        console.log('Opening file...\n');
        exec(`start "" "${GROUPS_FILE}"`);

    } catch (err) {
        console.error('Error fetching groups:', err.message);
    }
}

// ----------------------------------------------------------
// Mode: Monitor groups
// ----------------------------------------------------------
function setupGroupMonitor(sock) {
    const monitorAll = CONFIG.GROUP_IDS.length === 0;

    if (monitorAll) {
        console.log('Monitoring ALL groups (no specific group IDs configured)');
    } else {
        console.log(`Monitoring ${CONFIG.GROUP_IDS.length} group(s):`);
        CONFIG.GROUP_IDS.forEach(id => console.log(`  - ${id}`));
    }

    console.log(`Forwarding to: ${CONFIG.WEBHOOK_URL}`);
    console.log('Listening for messages... (Ctrl+C to stop)\n');

    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
            if (!msg.key.remoteJid?.endsWith('@g.us')) continue;
            if (!monitorAll && !CONFIG.GROUP_IDS.includes(msg.key.remoteJid)) continue;
            if (msg.key.remoteJid === 'status@broadcast') continue;
            if (msg.key.fromMe) continue;

            const content = extractMessageContent(msg.message);

            // Skip protocol/system messages (deletions, key exchanges, etc.)
            if (content.type === 'protocol') continue;

            // Download full-resolution image (replaces low-quality thumbnail)
            if (content.type === 'image' && CONFIG.FORWARD_MEDIA_INFO) {
                try {
                    const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
                        logger: pino({ level: 'silent' }),
                        reuploadRequest: sock.updateMediaMessage,
                    });
                    content.thumbnail = buffer.toString('base64');
                } catch (e) {
                    console.log('  Image download failed:', e.message);
                }
            }

            const payload = {
                event: content.isEdited ? 'message_edit' : 'group_message',
                timestamp: msg.messageTimestamp
                    ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
                    : new Date().toISOString(),
                group_id: msg.key.remoteJid,
                sender: msg.key.participant || msg.key.remoteJid,
                message_id: msg.key.id,
                push_name: msg.pushName || null,
                message_type: content.type,
                text: content.content,
            };

            if (content.isEdited) {
                payload.original_message_id = msg.message?.editedMessage?.key?.id || null;
            }

            if (CONFIG.FORWARD_MEDIA_INFO) {
                if (content.mimetype) payload.mimetype = content.mimetype;
                if (content.seconds) payload.duration_seconds = content.seconds;
                if (content.name) payload.location_name = content.name;
                if (content.options) payload.poll_options = content.options;
                if (content.reactedTo) payload.reacted_to_message_id = content.reactedTo;
                if (content.thumbnail) payload.thumbnail = content.thumbnail;
                if (content.linkTitle) payload.link_title = content.linkTitle;
                if (content.linkDescription) payload.link_description = content.linkDescription;
                if (content.linkUrl) payload.link_url = content.linkUrl;
            }

            if (CONFIG.VERBOSE) {
                const time = payload.timestamp.substring(11, 19);
                const name = msg.pushName || payload.sender;
                const preview = (content.content || '').substring(0, 60);
                console.log(`[${time}] ${name}: ${preview}`);
            }

            await sendToWebhook(payload);
        }
    });

    sock.ev.on('group-participants.update', async (update) => {
        if (!monitorAll && !CONFIG.GROUP_IDS.includes(update.id)) return;

        const payload = {
            event: 'group_membership_change',
            timestamp: new Date().toISOString(),
            group_id: update.id,
            action: update.action,
            participants: update.participants,
        };

        if (CONFIG.VERBOSE) {
            console.log(`[GROUP UPDATE] ${update.action}: ${update.participants.join(', ')} in ${update.id}`);
        }

        await sendToWebhook(payload);
    });
}

// ----------------------------------------------------------
// Connect to WhatsApp (called on start and reconnect)
// ----------------------------------------------------------
async function connect() {
    connectAttempts++;

    if (connectAttempts > MAX_CONNECT_ATTEMPTS) {
        console.error(`\nFailed to connect after ${MAX_CONNECT_ATTEMPTS} attempts.`);
        console.error('WhatsApp may be rate-limiting your IP. Wait 15 minutes and try again.\n');
        process.exit(1);
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    const { version } = await fetchLatestBaileysVersion();
    console.log(`Using WhatsApp Web version: ${version.join('.')}`);

    const sock = makeWASocket({
        auth: state,
        version,
        browser: Browsers.ubuntu('Chrome'),
        logger: pino({ level: 'silent' }),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            currentQR = qr;
            connectAttempts = 0;
            if (!browserOpened) {
                browserOpened = true;
                const url = `http://localhost:${CONFIG.QR_PORT}`;
                console.log(`\nQR Code page: ${url}`);
                console.log('Opening in browser — scan the QR code with WhatsApp.\n');
                exec(`start ${url}`);
            }
        }

        if (connection === 'open') {
            connectAttempts = 0;
            stopQRServer();
            console.log('\nConnected to WhatsApp!\n');

            if (isListMode) {
                await listGroups(sock);
                console.log('Done. You can close this window.');
                process.exit(0);
            } else {
                setupGroupMonitor(sock);
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;

            if (statusCode === DisconnectReason.loggedOut) {
                console.log('\nLogged out. Deleting session...');
                fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
                console.log('Run the script again to scan a new QR code.\n');
                process.exit(0);
            } else {
                console.log(`Connection lost (code: ${statusCode}). Retrying in 5 seconds... (attempt ${connectAttempts}/${MAX_CONNECT_ATTEMPTS})`);
                setTimeout(connect, 5000);
            }
        }
    });
}

// ----------------------------------------------------------
// Main
// ----------------------------------------------------------
async function main() {
    console.log('============================================================');
    console.log('  WhatsApp Group Monitor - Webhook Forwarder');
    console.log('============================================================');

    if (isListMode) {
        console.log('Mode: LIST GROUPS\n');
    } else {
        console.log('Mode: MONITOR GROUPS\n');
        if (CONFIG.WEBHOOK_URL.includes('YOUR-NGROK-URL')) {
            console.error('ERROR: Set your WEBHOOK_URL in the CONFIG section of index.js\n');
            process.exit(1);
        }
    }

    startQRServer();
    await connect();
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
