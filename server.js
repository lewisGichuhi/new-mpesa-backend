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
// ===================== HTTPS AGENT =====================
// ============================================================

const agent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true,
    timeout: 90000,
    secureProtocol: 'TLSv1_2_method'
});

// ============================================================
// ===================== REQUEST HELPER =====================
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
                    'Accept': 'application/json',
                    'User-Agent': 'TenantPortal/2.0'
                },
                timeout: 90000,
                agent: agent,
                family: 4
            };

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
                        bodyJson
                    });
                });
            });

            req.on('error', (err) => {
                console.error(`[ATTEMPT ${attemptNumber} ERROR]`, err.message);
                
                if (attemptNumber < retries) {
                    const delay = attemptNumber * 2000;
                    console.log(`🔄 Retrying in ${delay/1000} seconds...`);
                    setTimeout(() => attempt(attemptNumber + 1), delay);
                } else {
                    reject(new Error(`Request failed: ${err.message}`));
                }
            });
            
            req.on('timeout', () => {
                console.error(`[ATTEMPT ${attemptNumber} TIMEOUT]`);
                req.destroy();
                if (attemptNumber < retries) {
                    setTimeout(() => attempt(attemptNumber + 1), attemptNumber * 2000);
                } else {
                    reject(new Error('Request timed out'));
                }
            });

            if (payload) {
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

    if (res.bodyJson.ResponseCode === '0') {
        console.log('✅ STK Push successful!');
        return {
            success: true,
            data: res.bodyJson,
            message: res.bodyJson.CustomerMessage || 'STK Push sent'
        };
    } else {
        throw new Error(res.bodyJson.ResponseDescription || 'STK Push failed');
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
// ===================== CREATE SERVER =====================
// ============================================================

const server = http.createServer(async (req, res) => {
    // Always set CORS headers first
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
        // ===== SERVE HTML =====
        if (req.method === 'GET' && url.pathname === '/') {
            const fs = require('fs');
            try {
                const html = fs.readFileSync('./index.html', 'utf8');
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(html);
            } catch (err) {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`<!DOCTYPE html><html><head><title>Server Running</title></head><body><h1>✅ Server is running!</h1><p>Visit /api/health to check status.</p></body></html>`);
            }
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

        // ===== STK PUSH =====
        if (req.method === 'POST' && url.pathname === '/api/stkpush') {
            let body;
            try {
                body = await readBody(req);
            } catch (err) {
                return sendJson(res, 400, { error: 'Invalid JSON body' });
            }
            
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

        // ===== 404 =====
        return sendJson(res, 404, { 
            error: 'Route not found',
            message: `No route found for ${req.method} ${url.pathname}`,
            available: {
                '/': 'HTML Page',
                '/api/health': 'Health Check',
                '/api/test-oauth': 'Test OAuth',
                '/api/stkpush': 'STK Push (POST)'
            }
        });

    } catch (err) {
        console.error('❌ Server error:', err.message);
        return sendJson(res, 500, { 
            error: 'Internal server error',
            message: err.message 
        });
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
