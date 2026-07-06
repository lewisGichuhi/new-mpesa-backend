/**
 * M-Pesa STK Push API - Complete Working Version
 * Deployed on: https://new-mpesa-backend-1.onrender.com
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

// ===================== CONFIGURATION =====================
const SHORTCODE = '174379';
const PASSKEY = 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';

// YOUR CREDENTIALS
const CONSUMER_KEY = '8jAAnvNAIwiBXEbJsAsKNZQZTBOg7QGRIdQzvWN3abVuCMtQ';
const CONSUMER_SECRET = 'U3jAOtpJRDiOVj7w36Xa63EuuBT3fWGXXrWULxVBkBa22imOUrlA5l5CAuvvkPnn';

const CALLBACK_URL = 'https://your-domain.com/callback';
const PORT = process.env.PORT || 10000;

// SSL Agent
const agent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true
});

// ===================== REQUEST HELPER =====================
function request(method, urlString, headers = {}, jsonBody = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlString);
        const payload = jsonBody ? JSON.stringify(jsonBody) : null;

        console.log(`\n[REQUEST] ${method} ${urlString}`);
        
        const options = {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: method.toUpperCase(),
            headers: {
                ...headers,
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
            },
            timeout: 30000,
            agent: agent
        };

        const req = https.request(options, (res) => {
            let chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const bodyText = Buffer.concat(chunks).toString('utf8');
                let bodyJson = null;
                try { bodyJson = JSON.parse(bodyText); } catch (_) {}
                
                console.log(`[RESPONSE] Status: ${res.statusCode}`);
                if (bodyText) {
                    console.log(`[RESPONSE] Body: ${bodyText.substring(0, 300)}`);
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
            reject(err);
        });
        
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timed out'));
        });
        
        if (payload) req.write(payload);
        req.end();
    });
}

// ===================== OAUTH =====================
async function getAccessToken() {
    console.log('\n🔑 Getting access token...');
    
    const auth = Buffer.from(`${CONSUMER_KEY.trim()}:${CONSUMER_SECRET.trim()}`).toString('base64');

    const res = await request(
        'GET',
        'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
        {
            'Authorization': `Basic ${auth}`,
            'Accept': 'application/json'
        }
    );

    if (res.statusCode === 400) {
        throw new Error('Authentication failed: Invalid credentials.');
    }

    if (res.statusCode !== 200) {
        throw new Error(`HTTP ${res.statusCode}: ${res.bodyText}`);
    }

    if (!res.bodyJson || !res.bodyJson.access_token) {
        throw new Error('No access token in response');
    }

    console.log('✅ Access token obtained');
    return res.bodyJson.access_token;
}

// ===================== HELPERS =====================
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

// ===================== STK PUSH =====================
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

    console.log('📤 Sending STK Push request...');
    
    const res = await request(
        'POST',
        'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
        {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        payload
    );

    if (!res.bodyJson) {
        throw new Error('Invalid response from Safaricom');
    }

    console.log(`📊 Response Code: ${res.bodyJson.ResponseCode}`);

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

// ===================== SERVER =====================
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
// HTML PAGE (built-in - with Render URL)
// ============================================================
const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tenant Portal - M-Pesa Payment</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
            background: #0f172a;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            color: #f8fafc;
            line-height: 1.6;
        }
        .container { width: 100%; max-width: 440px; }
        .card {
            background: rgba(30, 41, 59, 0.85);
            backdrop-filter: blur(16px);
            padding: 32px 28px;
            border-radius: 24px;
            border: 1px solid rgba(255, 255, 255, 0.06);
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        }
        .header { text-align: center; margin-bottom: 24px; }
        .header .logo { font-size: 42px; margin-bottom: 4px; display: block; }
        .header h1 { font-size: 20px; font-weight: 700; color: #f8fafc; }
        .header .sub { color: #94a3b8; font-size: 12px; margin-top: 2px; }
        label {
            display: block;
            margin-bottom: 5px;
            font-weight: 600;
            font-size: 11px;
            color: #94a3b8;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        input {
            width: 100%;
            padding: 14px 16px;
            margin-bottom: 14px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            font-size: 16px;
            background: rgba(15, 23, 42, 0.6);
            color: #f8fafc;
            transition: all 0.3s;
            box-sizing: border-box;
        }
        input:focus {
            outline: none;
            border-color: #6366f1;
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
            background: rgba(15, 23, 42, 0.8);
        }
        input::placeholder { color: #64748b; }
        .btn-primary {
            width: 100%;
            padding: 16px;
            background: linear-gradient(135deg, #10b981, #059669);
            color: white;
            border: none;
            border-radius: 12px;
            cursor: pointer;
            font-weight: 700;
            font-size: 16px;
            transition: all 0.3s;
            box-shadow: 0 4px 20px rgba(16, 185, 129, 0.25);
        }
        .btn-primary:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 6px 25px rgba(16, 185, 129, 0.35); }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        .status {
            font-size: 13px;
            text-align: center;
            margin-top: 12px;
            min-height: 20px;
            font-weight: 600;
        }
        .status.success { color: #34d399; }
        .status.error { color: #fb7185; }
        .status.pending { color: #a5b4fc; }
        .footer {
            text-align: center;
            margin-top: 16px;
            font-size: 10px;
            color: #475569;
        }
        .server-info {
            background: rgba(15, 23, 42, 0.5);
            border-radius: 8px;
            padding: 8px 12px;
            margin-bottom: 16px;
            font-size: 11px;
            color: #64748b;
            text-align: center;
        }
        .server-info strong { color: #34d399; }
    </style>
</head>
<body>
<div class="container">
    <div class="card">
        <div class="header">
            <span class="logo">🏢</span>
            <h1>Tenant Portal</h1>
            <p class="sub">M-Pesa Payment</p>
        </div>
        <div class="server-info">
            ✅ Server: <strong>Connected</strong> | 
            URL: <span id="serverUrl">Loading...</span>
        </div>
        <label for="phoneInput">M-Pesa Phone Number</label>
        <input type="tel" id="phoneInput" placeholder="0712345678" pattern="[0-9]*" inputmode="numeric">
        <label for="amountInput">Amount (KES)</label>
        <input type="number" id="amountInput" placeholder="Enter amount" min="1">
        <button class="btn-primary" id="actionBtn" onclick="submitPayment()">💳 Pay Now</button>
        <div class="status" id="actionStatus"></div>
        <div class="footer">&copy; 2024 Your Property Management Ltd</div>
    </div>
</div>
<script>
// ============================================================
// SERVER URL - FIXED for Render
// ============================================================
function getServerUrl() {
    const hostname = window.location.hostname;
    // If on localhost, use localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'http://localhost:10000/api/stkpush';
    }
    // For Render deployment
    return 'https://new-mpesa-backend-1.onrender.com/api/stkpush';
}

const PAYMENT_SERVER_URL = getServerUrl();
document.getElementById('serverUrl').textContent = PAYMENT_SERVER_URL;

// ============================================================
// SUBMIT PAYMENT
// ============================================================
async function submitPayment() {
    const phone = document.getElementById('phoneInput').value.trim();
    const amount = document.getElementById('amountInput').value.trim();
    const statusEl = document.getElementById('actionStatus');
    const btn = document.getElementById('actionBtn');

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
    statusEl.textContent = 'Sending payment request...';
    statusEl.className = 'status pending';

    try {
        const response = await fetch(PAYMENT_SERVER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone: phone,
                amount: amount,
                houseId: 'TENANT-001',
                accountReference: 'RENT-PAYMENT'
            })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            statusEl.textContent = '✅ Payment sent! Check your phone for the M-Pesa prompt.';
            statusEl.className = 'status success';
            document.getElementById('phoneInput').value = '';
            document.getElementById('amountInput').value = '';
        } else {
            statusEl.textContent = '❌ Payment failed: ' + (data.error || data.message || 'Unknown error');
            statusEl.className = 'status error';
        }
    } catch (error) {
        console.error('Error:', error);
        statusEl.textContent = '❌ Could not connect. Please try again.';
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
// SERVER
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
                timestamp: new Date().toISOString() 
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

        // ===== TEST STK =====
        if (req.method === 'POST' && url.pathname === '/api/test-stk') {
            try {
                const result = await stkPush({
                    phone: '254712345678',
                    amount: '10',
                    accountReference: 'TEST-001'
                });
                return sendJson(res, 200, result);
            } catch (err) {
                return sendJson(res, 502, { 
                    success: false, 
                    error: err.message 
                });
            }
        }

        // ===== PRODUCTION STK =====
        if (req.method === 'POST' && url.pathname === '/api/stkpush') {
            const body = await readBody(req);
            
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
                return sendJson(res, 502, { 
                    success: false, 
                    error: err.message 
                });
            }
        }

        // ===== ROOT API =====
        if (req.method === 'GET' && url.pathname === '/api') {
            return sendJson(res, 200, {
                name: 'M-Pesa STK Push API',
                status: 'Running',
                endpoints: {
                    health: 'GET /api/health',
                    test_oauth: 'GET /api/test-oauth',
                    test_stk: 'POST /api/test-stk',
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

// ===================== START =====================
server.listen(PORT, '0.0.0.0', () => {
    console.log('\n========================================');
    console.log('🚀 M-Pesa STK Push API');
    console.log('========================================');
    console.log(`✅ Server running on port: ${PORT}`);
    console.log(`📍 http://localhost:${PORT}/ - HTML Page`);
    console.log(`📍 http://localhost:${PORT}/api/health`);
    console.log(`📍 http://localhost:${PORT}/api/test-oauth`);
    console.log('========================================\n');
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
});
