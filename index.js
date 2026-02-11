require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/db');
const { createTransporter } = require('./services/emailTransport');

const app = express();

// ── Security Middleware ──────────────────────
app.use(helmet());

// ── CORS ─────────────────────────────────────
app.use(
    cors({
        origin: process.env.CLIENT_URL || 'http://localhost:5173',
        credentials: true,
    })
);

// ── Rate Limiting ────────────────────────────
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per window per IP
    message: {
        success: false,
        message: 'Too many requests. Please try again later.',
    },
});
app.use('/api/', limiter);

// Stricter limit for auth routes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: {
        success: false,
        message: 'Too many login attempts. Please try again later.',
    },
});

// ── Body Parsing ─────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Connect to DB & init transport on first request (for Vercel) ──
let isInitialized = false;
app.use(async (req, res, next) => {
    if (!isInitialized) {
        try {
            await connectDB();
            createTransporter();
            isInitialized = true;
        } catch (error) {
            console.error('Initialization error:', error);
            return res.status(500).json({ success: false, message: 'Server initialization failed' });
        }
    }
    next();
});

// ── Routes ───────────────────────────────────
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/emails', require('./routes/emails'));
app.use('/api/auth', require('./routes/googleAuth'));
app.use('/api/gmail', require('./routes/gmail'));

// ── Health Check ─────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ── Error Handler ────────────────────────────
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        success: false,
        message:
            process.env.NODE_ENV === 'production'
                ? 'Internal server error'
                : err.message,
    });
});



// ── Start Server (local only) ────────────────
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 5000;
    const startServer = async () => {
        try {
            await connectDB();
            createTransporter();
            isInitialized = true;
            app.listen(PORT, () => {
                console.log(`\n🚀 MailFlow server running on http://localhost:${PORT}`);
                console.log(`📧 Environment: ${process.env.NODE_ENV || 'development'}\n`);
            });
        } catch (error) {
            console.error('Failed to start server:', error);
            process.exit(1);
        }
    };
    startServer();
}

// ── Export for Vercel ────────────────────────
module.exports = app;
