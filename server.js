/**
 * M-Pesa STK Push API - FIXED FOR RENDER
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

const agent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true,
    keepAliveMsecs: 1000,
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 120000,
    // Force TLS 1.2
    secureProtocol: 'TLSv1_2_method',
    // Allow older ciphers
    ciphers: 'ALL:!aNULL:!eNULL:!LOW:!EXPORT:!SSLv2',
    honorCipherOrder: false
});

// ============================================================
// ===================== REQUEST WITH RETRY =====================
// ============================================================

function requestWithRetry(method, urlString, headers = {}, jsonBody = null, retries = 3) {
    return new Promise((resolve, reject) => {
        const attempt = (attemptNumber) => {
            console.log(`\n[ATTEMPT ${attemptNumber}/${retries}] ${method} ${urlString}`);
            
            const url = new URL(urlString);
            const payload = jsonBody ? JSON.stringify(jsonBody) : null;

            const options = {
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname + url.search,
                method: method.toUpperCase(),
                headers: {
                    ...headers,
                    ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
                    'Connection': 'keep-alive',
                    'Accept': '*/*',
                    'User-Agent': 'Mozilla/5.0 (compatible; TenantPortal/2.0)'
                },
                timeout: 90000,
                agent: agent,
                family: 4, // Force IPv4
                lookup: (hostname, options, callback) => {
                    // Try to resolve to a specific IP if needed
                    callback(null, null, 4);
                }
            };

            console.log(`[OPTIONS] Host: ${options.hostname}, Path: ${options.path}`);

            const req = https.request(options, (res) => {
                let chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const bodyText = Buffer.concat(chunks).toString('utf8');
                    let bodyJson = null;
                    try { bodyJson = JSON.parse(bodyText); } catch (_) {}
                    
                    console.log(`[RESPONSE] Status: ${res.statusCode}`);
                    if (bodyText && bodyText.length < 500) {
                        console.log(`[RESPONSE] Body: ${bodyText}`);
                    }
                    
                    resolve({
                        statusCode: res.statusCode,
                        statusMessage: res.statusMessage,
                        bodyText,
                        bodyJson,
                        attempt: attemptNumber
                    });
                });
            });

            req.on('error', (err) => {
                console.error(`[ATTEMPT ${attemptNumber} ERROR]`, err.message);
                console.error(`[ERROR CODE]`, err.code);
                
                if (attemptNumber < retries) {
                    const delay = attemptNumber * 2000;
                    console.log(`🔄 Retrying in ${delay/1000} seconds...`);
                    setTimeout(() => attempt(attemptNumber + 1), delay);
                } else {
                    reject(new Error(`Request failed after ${retries} attempts: ${err.message} (${err.code || 'unknown'})`));
                }
            });
            
            req.on('timeout', () => {
                console.error(`[ATTEMPT ${attemptNumber} TIMEOUT]`);
                req.destroy();
                
                if (attemptNumber < retries) {
                    const delay = attemptNumber * 2000;
                    console.log(`🔄 Retrying in ${delay/1000} seconds...`);
                    setTimeout(() => attempt(attemptNumber + 1), delay);
                } else {
                    reject(new Error(`Request timed out after ${retries} attempts`));
                }
            });

            if (payload) {
                console.log(`[PAYLOAD] ${payload.substring(0, 200)}...`);
                req.write(payload);
            }
            req.end();
        };

        attempt(1);
    });
}

// ============================================================
// ===================== OAUTH =====================
// ============================================================

async function getAccessToken() {
    console.log('\n🔑 Getting access token...');
    
    const auth = Buffer.from(`${CONSUMER_KEY.trim()}:${CONSUMER_SECRET.trim()}`).toString('base64');

    const res = await requestWithRetry(
        'GET',
        'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
        {
            'Authorization': `Basic ${auth}`,
            'Accept': 'application/json'
        }
    );

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
    
    const res = await requestWithRetry(
        'POST',
        'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
        {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        payload,
        3
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
// ===================== TEST HTML =====================
// ============================================================

const HTML_PAGE = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Payment Test</title>
    <style>
        body {
            font-family: Arial, sans-serif;
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
            padding: 30px;
            border-radius: 16px;
            max-width: 400px;
            width: 100%;
            border: 1px solid #334155;
        }
        h1 { text-align: center; }
        label { display: block; margin: 10px 0 5px; font-size: 14px; color: #94a3b8; }
        input {
            width: 100%;
            padding: 12px;
            border: 1px solid #334155;
            border-radius: 8px;
            background: #0f172a;
            color: white;
            font-size: 16px;
            box-sizing: border-box;
        }
        button {
            width: 100%;
            padding: 14px;
            background: #10b981;
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            margin-top: 10px;
        }
        button:hover { background: #059669; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        .status { margin-top: 10px; padding: 10px; border-radius: 8px; text-align: center; }
        .success { background: #065f46; color: #34d399; }
        .error { background: #7f1d1d; color: #fb7185; }
        .pending { background: #1e3a5f; color: #60a5fa; }
        .debug {
            margin-top: 15px;
            padding: 10px;
            background: #0f172a;
            border-radius: 8px;
            font-size: 12px;
            color: #64748b;
            word-break: break-all;
            max-height: 200px;
            overflow-y: auto;
        }
        .server-status {
            text-align: center;
            padding: 8px;
            border-radius: 8px;
            margin-bottom: 10px;
            font-size: 13px;
        }
        .server-status.online { background: rgba(16,185,129,0.1); color: #34d399; }
        .server-status.offline { background: rgba(244,63,94,0.1); color: #fb7185; }
        .server-status.checking { background: rgba(99,102,241,0.1); color: #a5b4fc; }
        .note {
            font-size: 11px;
            color: #64748b;
            text-align: center;
            margin-top: 8px;
        }
    </style>
</head>
<body>
    <div class="card">
        <h1>🏢 Payment Test</h1>
        
        <div id="serverStatus" class="server-status checking">⏳ Checking server...</div>

        <label>Phone Number</label>
        <input type="tel" id="phoneInput" placeholder="0712345678">

        <label>Amount (KES)</label>
        <input type="number" id="amountInput" placeholder="10">

        <button id="payBtn" onclick="submitPayment()">💳 Pay Now</button>
        <div id="status" class="status" style="background:#1e293b;color:#94a3b8;">Ready</div>

        <div class="debug" id="debugInfo">Server URL: <span id="serverUrl">Loading...</span></div>
        <div class="note">⏱️ If payment fails, the server will retry automatically up to 3 times.</div>
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

        async function checkServer() {
            const statusEl = document.getElementById('serverStatus');
            statusEl.textContent = '⏳ Checking server...';
            statusEl.className = 'server-status checking';
            
            try {
                const healthUrl = SERVER_URL.replace('/api/stkpush', '/api/health');
                const response = await fetch(healthUrl);
                const data = await response.json();
                
                if (response.ok) {
                    statusEl.textContent = '✅ Server Online';
                    statusEl.className = 'server-status online';
                } else {
                    statusEl.textContent = '❌ Server Error: ' + response.status;
                    statusEl.className = 'server-status offline';
                }
            } catch (error) {
                statusEl.textContent = '❌ Cannot reach server: ' + error.message;
                statusEl.className = 'server-status offline';
            }
        }

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

        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(checkServer, 500);
        });
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

    try {
        // ===== SERVE HTML =====
        if (req.method === 'GET' && url.pathname === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(HTML_PAGE);
            return;
        }

        // ===== HEALTH =====
        if (req.method === 'GET' && url.pathname === '/api/health') {
            return sendJson(res, 200, { 
                status: 'ok', 
                timestamp: new Date().toISOString(),
                message: 'Server is running'
            });
        }

        // ===== TEST OAUTH =====
        if (req.method === 'GET' && url.pathname === '/api/test-oauth') {
            try {
                const token = await getAccessToken();
                return sendJson(res, 200, { 
                    success: true, 
                    token_preview: token.substring(0, 20) + '...' 
                });
            } catch (err) {
                return sendJson(res, 502, { 
                    success: false, 
                    error: err.message 
                });
            }
        }

        // ===== STK PUSH =====
        if (req.method === 'POST' && url.pathname === '/api/stkpush') {
            const body = await readBody(req);
            console.log('📥 STK Push request:', body);
            
            if (!body.phone) {
                return sendJson(res, 400, { error: 'Phone number required' });
            }
            if (!body.amount) {
                return sendJson(res, 400, { error: 'Amount required' });
            }

            try {
                const result = await stkPush({
                    phone: body.phone,
                    amount: body.amount,
                    accountReference: body.accountReference || 'TenantPortal'
                });
                return sendJson(res, 200, result);
            } catch (err) {
                console.error('❌ STK Push error:', err.message);
                return sendJson(res, 502, { 
                    success: false, 
                    error: err.message 
                });
            }
        }

        // ===== API INFO =====
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

// ============================================================
// ===================== START =====================
// ============================================================

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
