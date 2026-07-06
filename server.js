/**
 * M-Pesa STK Push API - WITH PERMISSIVE HTTPS AGENT
 * Save this as server.js
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

// ============================================================
// ===================== CONFIGURATION =====================
// ============================================================

const SHORTCODE = '174379';
const PASSKEY = 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';

const CONSUMER_KEY = '8jAAnvNAIwiBXEbJsAsKNZQZTBOg7QGRIdQzvWN3abVuCMtQ';
const CONSUMER_SECRET = 'U3jAOtpJRDiOVj7w36Xa63EuuBT3fWGXXrWULxVBkBa22imOUrlA5l5CAuvvkPnn';

const CALLBACK_URL = 'https://new-mpesa-backend-1.onrender.com/api/mpesa-callback';
const PORT = process.env.PORT || 10000;

// ============================================================
// ===================== PERMISSIVE HTTPS AGENT =====================
// ============================================================

// This agent ignores SSL errors and uses older TLS versions
const agent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true,
    keepAliveMsecs: 1000,
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 120000,
    // Allow older TLS versions
    secureProtocol: 'TLSv1_method',
    // Allow all ciphers
    ciphers: 'ALL:!aNULL:!eNULL:!LOW:!EXPORT:!SSLv2',
    honorCipherOrder: false
});

// ============================================================
// ===================== REQUEST HELPER =====================
// ============================================================

function makeRequest(method, urlString, headers = {}, jsonBody = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlString);
        const payload = jsonBody ? JSON.stringify(jsonBody) : null;

        console.log(`\n[REQUEST] ${method} ${urlString}`);
        
        // Log headers (mask sensitive)
        const safeHeaders = { ...headers };
        if (safeHeaders.Authorization) {
            safeHeaders.Authorization = safeHeaders.Authorization.substring(0, 30) + '...';
        }
        console.log('[HEADERS]', JSON.stringify(safeHeaders, null, 2));

        const options = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname + url.search,
            method: method.toUpperCase(),
            headers: {
                ...headers,
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
                'Connection': 'keep-alive',
                'Accept': 'application/json'
            },
            timeout: 90000,
            agent: agent,
            family: 4 // Force IPv4
        };

        const req = https.request(options, (res) => {
            let chunks = [];
            let responseSize = 0;

            res.on('data', (chunk) => {
                chunks.push(chunk);
                responseSize += chunk.length;
            });

            res.on('end', () => {
                const bodyText = Buffer.concat(chunks).toString('utf8');
                let bodyJson = null;
                try { bodyJson = JSON.parse(bodyText); } catch (_) {}
                
                console.log(`[RESPONSE] Status: ${res.statusCode}`);
                console.log(`[RESPONSE] Size: ${responseSize} bytes`);
                if (bodyText && bodyText.length < 500) {
                    console.log(`[RESPONSE] Body: ${bodyText}`);
                } else if (bodyText) {
                    console.log(`[RESPONSE] Body: ${bodyText.substring(0, 300)}...`);
                }
                
                resolve({
                    statusCode: res.statusCode,
                    statusMessage: res.statusMessage,
                    bodyText,
                    bodyJson
                });
            });
        });

        req.on('error', (err) => {
            console.error('[REQUEST ERROR]', err.message);
            console.error('[ERROR CODE]', err.code);
            reject(new Error(`Request failed: ${err.message} (${err.code || 'unknown'})`));
        });
        
        req.on('timeout', () => {
            console.error('[REQUEST TIMEOUT]');
            req.destroy();
            reject(new Error('Request timed out after 90 seconds'));
        });

        // Add socket timeout
        req.on('socket', (socket) => {
            socket.setTimeout(90000);
            socket.on('timeout', () => {
                console.error('[SOCKET TIMEOUT]');
                req.destroy();
                reject(new Error('Socket timed out'));
            });
        });

        if (payload) {
            console.log(`[PAYLOAD] ${payload.substring(0, 200)}...`);
            req.write(payload);
        }
        req.end();
    });
}

// ============================================================
// ===================== OAUTH =====================
// ============================================================

async function getAccessToken() {
    console.log('\n🔑 Getting access token...');
    
    const auth = Buffer.from(`${CONSUMER_KEY.trim()}:${CONSUMER_SECRET.trim()}`).toString('base64');
    console.log(`[AUTH] Basic ${auth.substring(0, 20)}...`);

    const res = await makeRequest(
        'GET',
        'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
        {
            'Authorization': `Basic ${auth}`,
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (compatible; TenantPortal/1.0)'
        }
    );

    if (res.statusCode === 400 || res.statusCode === 401) {
        throw new Error(`Authentication failed (${res.statusCode}): ${res.bodyText}`);
    }

    if (res.statusCode !== 200) {
        throw new Error(`OAuth failed (${res.statusCode}): ${res.bodyText}`);
    }

    if (!res.bodyJson || !res.bodyJson.access_token) {
        throw new Error('No access token in response');
    }

    console.log('✅ Access token obtained');
    return res.bodyJson.access_token;
}

// ============================================================
// ===================== HELPERS =====================
// ============================================================

function timestampNow() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function normalizePhone(rawPhone) {
    if (!rawPhone) return null;
    let digits = String(rawPhone).trim().replace(/[^0-9+]/g, '');
    digits = digits.replace(/^\+/, '');
    
    if (digits.startsWith('0')) digits = digits.substring(1);
    if (digits.length === 9 && digits.startsWith('7')) return `254${digits}`;
    if (digits.length === 10 && digits.startsWith('7')) return `254${digits}`;
    if (digits.startsWith('254')) return digits;
    
    return digits;
}

// ============================================================
// ===================== STK PUSH =====================
// ============================================================

async function stkPush({ phone, amount, accountReference }) {
    console.log('\n💳 Starting STK Push...');
    console.log(`📱 Phone: ${phone}`);
    console.log(`💰 Amount: ${amount}`);

    const numericAmount = Math.round(Number(amount));
    if (isNaN(numericAmount) || numericAmount < 1) {
        throw new Error('Invalid amount');
    }

    const formattedPhone = normalizePhone(phone);
    if (!formattedPhone || formattedPhone.length < 10) {
        throw new Error(`Invalid phone: ${phone}`);
    }
    console.log(`📱 Normalized: ${formattedPhone}`);

    const token = await getAccessToken();
    const timestamp = timestampNow();
    const password = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');

    const payload = {
        BusinessShortCode: SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: numericAmount,
        PartyA: formattedPhone,
        PartyB: SHORTCODE,
        PhoneNumber: formattedPhone,
        CallBackURL: CALLBACK_URL,
        AccountReference: accountReference || 'TenantPortal',
        TransactionDesc: 'Rent Payment'
    };

    console.log('📤 Sending STK Push to Safaricom...');
    
    const res = await makeRequest(
        'POST',
        'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
        {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (compatible; TenantPortal/1.0)'
        },
        payload
    );

    if (!res.bodyJson) {
        throw new Error('Invalid response from Safaricom');
    }

    console.log(`📊 Response Code: ${res.bodyJson.ResponseCode}`);
    console.log(`📝 Description: ${res.bodyJson.ResponseDescription}`);

    if (res.bodyJson.ResponseCode === '0') {
        console.log('✅ STK Push successful!');
        return {
            success: true,
            data: res.bodyJson,
            message: res.bodyJson.CustomerMessage || 'STK Push sent'
        };
    } else {
        const errorMsg = res.bodyJson.ResponseDescription || res.bodyJson.CustomerMessage || 'STK Push failed';
        throw new Error(errorMsg);
    }
}

// ============================================================
// ===================== SERVER FUNCTIONS =====================
// ============================================================

function sendJson(res, statusCode, obj) {
    res.writeHead(statusCode, { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(obj, null, 2));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', (chunk) => raw += chunk);
        req.on('end', () => {
            try { resolve(raw ? JSON.parse(raw) : {}); } 
            catch (e) { reject(new Error('Invalid JSON')); }
        });
        req.on('error', reject);
    });
}

// ============================================================
// ===================== BUILT-IN HTML =====================
// ============================================================

const HTML_PAGE = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tenant Payment Portal</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
            background: #0f172a;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
            color: white;
        }
        .card {
            background: #1e293b;
            padding: 32px 28px;
            border-radius: 24px;
            max-width: 420px;
            width: 100%;
            border: 1px solid #334155;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        }
        h1 { text-align: center; margin-bottom: 8px; font-size: 24px; }
        .subtitle { text-align: center; color: #94a3b8; font-size: 14px; margin-bottom: 20px; }
        .status-badge {
            text-align: center;
            padding: 8px;
            border-radius: 8px;
            margin-bottom: 16px;
            font-size: 13px;
            background: rgba(16,185,129,0.1);
            color: #34d399;
        }
        label { display: block; margin: 10px 0 5px; font-size: 13px; color: #94a3b8; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
        input {
            width: 100%;
            padding: 12px 14px;
            border: 1px solid #334155;
            border-radius: 12px;
            background: #0f172a;
            color: white;
            font-size: 16px;
            box-sizing: border-box;
            transition: border-color 0.2s;
        }
        input:focus {
            outline: none;
            border-color: #6366f1;
            box-shadow: 0 0 0 3px rgba(99,102,241,0.2);
        }
        button {
            width: 100%;
            padding: 14px;
            background: linear-gradient(135deg, #10b981, #059669);
            color: white;
            border: none;
            border-radius: 12px;
            font-size: 16px;
            font-weight: 700;
            cursor: pointer;
            margin-top: 16px;
            transition: transform 0.15s, box-shadow 0.15s;
            box-shadow: 0 4px 15px rgba(16,185,129,0.3);
        }
        button:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(16,185,129,0.4); }
        button:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        .status { margin-top: 12px; padding: 10px; border-radius: 8px; text-align: center; font-weight: 600; }
        .success { background: #065f46; color: #34d399; }
        .error { background: #7f1d1d; color: #fb7185; }
        .pending { background: #1e3a5f; color: #60a5fa; }
        .info { background: #1e293b; color: #94a3b8; }
        .debug {
            margin-top: 16px;
            padding: 10px;
            background: #0f172a;
            border-radius: 8px;
            font-size: 11px;
            color: #64748b;
            word-break: break-all;
            max-height: 150px;
            overflow-y: auto;
            font-family: monospace;
        }
        .note {
            font-size: 11px;
            color: #64748b;
            text-align: center;
            margin-top: 12px;
            border-top: 1px solid #1e293b;
            padding-top: 12px;
        }
    </style>
</head>
<body>
    <div class="card">
        <h1>🏢 Tenant Portal</h1>
        <p class="subtitle">M-Pesa Payment</p>
        
        <div class="status-badge" id="serverStatus">✅ Server Online</div>

        <label>Phone Number</label>
        <input type="tel" id="phoneInput" placeholder="0712345678">

        <label>Amount (KES)</label>
        <input type="number" id="amountInput" placeholder="10" min="1">

        <button id="payBtn" onclick="submitPayment()">💳 Pay Now</button>
        <div id="status" class="status info">Ready</div>

        <div class="debug" id="debugInfo">Server URL: <span id="serverUrl">Loading...</span></div>
        <div class="note">⏱️ If payment fails, the server retries automatically.</div>
    </div>

    <script>
        function getServerUrl() {
            const hostname = window.location.hostname;
            if (hostname === 'localhost' || hostname === '127.0.0.1') {
                return 'http://localhost:10000/api/stkpush';
            }
            return 'https://new-mpesa-backend-1.onrender.com/api/stkpush';
        }

        const SERVER_URL = getServerUrl();
        document.getElementById('serverUrl').textContent = SERVER_URL;

        async function submitPayment() {
            const phone = document.getElementById('phoneInput').value.trim();
            const amount = document.getElementById('amountInput').value.trim();
            const statusEl = document.getElementById('status');
            const btn = document.getElementById('payBtn');
            const debugEl = document.getElementById('debugInfo');

            if (!phone) {
                statusEl.textContent = 'Please enter your phone number.';
                statusEl.className = 'status error';
                return;
            }
            if (!amount || Number(amount) <= 0) {
                statusEl.textContent = 'Please enter a valid amount.';
                statusEl.className = 'status error';
                return;
            }

            btn.disabled = true;
            btn.textContent = 'Processing...';
            statusEl.textContent = 'Sending...';
            statusEl.className = 'status pending';
            debugEl.textContent = '📤 Sending to: ' + SERVER_URL;

            try {
                const payload = {
                    phone: phone,
                    amount: amount,
                    accountReference: 'TEST-001'
                };
                
                debugEl.textContent = '📤 Payload: ' + JSON.stringify(payload);

                const response = await fetch(SERVER_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const data = await response.json();
                debugEl.textContent = '📥 Response: ' + JSON.stringify(data);

                if (response.ok && data.success) {
                    statusEl.textContent = '✅ Payment sent! Check your phone.';
                    statusEl.className = 'status success';
                    document.getElementById('phoneInput').value = '';
                    document.getElementById('amountInput').value = '';
                } else {
                    statusEl.textContent = '❌ Failed: ' + (data.error || data.message || 'Unknown');
                    statusEl.className = 'status error';
                }
            } catch (error) {
                debugEl.textContent = '❌ Error: ' + error.message;
                statusEl.textContent = '❌ Error: ' + error.message;
                statusEl.className = 'status error';
            } finally {
                btn.disabled = false;
                btn.textContent = '💳 Pay Now';
            }
        }
    </script>
</body>
</html>`;

// ============================================================
// ===================== CREATE SERVER =====================
// ============================================================

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    console.log(`📥 ${req.method} ${url.pathname}`);

    try {
        if (req.method === 'GET' && url.pathname === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(HTML_PAGE);
            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/health') {
            return sendJson(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
        }

        if (req.method === 'GET' && url.pathname === '/api/test-oauth') {
            try {
                const token = await getAccessToken();
                return sendJson(res, 200, { success: true, token_preview: token.substring(0, 20) + '...' });
            } catch (err) {
                return sendJson(res, 502, { success: false, error: err.message });
            }
        }

        if (req.method === 'POST' && url.pathname === '/api/stkpush') {
            const body = await readBody(req);
            console.log('📥 STK Push request:', body);
            
            if (!body.phone) return sendJson(res, 400, { error: 'Phone number required' });
            if (!body.amount) return sendJson(res, 400, { error: 'Amount required' });

            try {
                const result = await stkPush({
                    phone: body.phone,
                    amount: body.amount,
                    accountReference: body.accountReference || 'TenantPortal'
                });
                return sendJson(res, 200, result);
            } catch (err) {
                console.error('❌ STK Push error:', err.message);
                return sendJson(res, 502, { success: false, error: err.message });
            }
        }

        if (req.method === 'GET' && url.pathname === '/api') {
            return sendJson(res, 200, {
                name: 'M-Pesa STK Push API',
                status: 'Running',
                endpoints: {
                    home: 'GET /',
                    health: 'GET /api/health',
                    test_oauth: 'GET /api/test-oauth',
                    stkpush: 'POST /api/stkpush'
                }
            });
        }

        return sendJson(res, 404, { error: 'Route not found' });

    } catch (err) {
        console.error('Server error:', err);
        return sendJson(res, 500, { error: 'Internal server error' });
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log('\n========================================');
    console.log('🚀 M-Pesa STK Push API');
    console.log('========================================');
    console.log(`✅ Server running on port: ${PORT}`);
    console.log(`📍 http://localhost:${PORT}/`);
    console.log(`📍 http://localhost:${PORT}/api/health`);
    console.log(`📍 http://localhost:${PORT}/api/test-oauth`);
    console.log('========================================\n');
});

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});
