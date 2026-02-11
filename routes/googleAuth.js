const express = require('express');
const router = express.Router();
const User = require('../models/User');
const verifyToken = require('../middleware/auth');
const {
    createOAuth2Client,
    getGmailProfile,
} = require('../services/gmailService');

/**
 * GET /api/auth/google
 * Redirect user to Google OAuth consent page.
 */
router.get('/google', verifyToken, (req, res) => {
    const oauth2Client = createOAuth2Client();
    const scopes = [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/userinfo.email',
    ];

    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: scopes,
        state: req.user.id, // Pass user ID through state
    });

    res.json({ url });
});

/**
 * GET /api/auth/google/callback
 * Handle Google OAuth callback — exchange code for tokens.
 */
router.get('/google/callback', async (req, res) => {
    try {
        const { code, state: userId } = req.query;

        if (!code || !userId) {
            return res.redirect(`${process.env.CLIENT_URL}/mail/inbox?error=missing_code`);
        }

        const oauth2Client = createOAuth2Client();
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        // Get users Gmail address
        const profile = await getGmailProfile(tokens);

        // Save tokens to user
        await User.findByIdAndUpdate(userId, {
            googleTokens: {
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                expiryDate: tokens.expiry_date,
            },
            googleEmail: profile.emailAddress,
            isGmailConnected: true,
        });

        res.redirect(`${process.env.CLIENT_URL}/mail/inbox?gmail=connected`);
    } catch (error) {
        console.error('Google OAuth callback error:', error.message);
        res.redirect(`${process.env.CLIENT_URL}/mail/inbox?error=oauth_failed`);
    }
});

/**
 * POST /api/auth/google/disconnect
 * Disconnect Gmail from account.
 */
router.post('/google/disconnect', verifyToken, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.user.id, {
            googleTokens: { accessToken: null, refreshToken: null, expiryDate: null },
            googleEmail: null,
            isGmailConnected: false,
        });
        res.json({ success: true, message: 'Gmail disconnected' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

const crypto = require('crypto');
const {
    generateAccessToken,
    generateRefreshToken
} = require('../utils/tokens');

/**
 * GET /api/auth/google/login
 * Redirect user to Google OAuth consent page for LOGIN (Public).
 */
router.get('/google/login', (req, res) => {
    const oauth2Client = createOAuth2Client();
    const scopes = [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile', // Added profile for name
    ];

    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: scopes,
        state: 'login', // Marker for login flow
    });

    res.json({ url });
});

/**
 * GET /api/auth/google/login/callback
 * Handle Google OAuth callback for LOGIN.
 */
router.get('/google/login/callback', async (req, res) => {
    try {
        const { code } = req.query;

        if (!code) {
            return res.redirect(`${process.env.CLIENT_URL}/login?error=missing_code`);
        }

        const oauth2Client = createOAuth2Client();
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        // Get users Gmail address
        const profile = await getGmailProfile(tokens);
        const email = profile.emailAddress;

        // Find or create user
        let user = await User.findOne({ email });

        if (!user) {
            // Create new user
            const randomPassword = crypto.randomBytes(16).toString('hex');
            const name = email.split('@')[0]; // simple name derivation

            user = await User.create({
                name,
                email,
                password: randomPassword,
                googleEmail: email,
                isGmailConnected: true,
                googleTokens: {
                    accessToken: tokens.access_token,
                    refreshToken: tokens.refresh_token,
                    expiryDate: tokens.expiry_date,
                },
            });
        } else {
            // Update existing user with Google tokens if not connected
            if (!user.isGmailConnected) {
                user.isGmailConnected = true;
                user.googleEmail = email;
                user.googleTokens = {
                    accessToken: tokens.access_token,
                    refreshToken: tokens.refresh_token,
                    expiryDate: tokens.expiry_date,
                };
                await user.save();
            }
        }

        // Generate App Tokens
        const accessToken = generateAccessToken(user);
        const refreshToken = generateRefreshToken(user);

        // Set refresh token cookie
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // Use 'none' for cross-site if needed, but 'lax' usually safer
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        // Update user refresh tokens in DB (if you are tracking them, though User model has `refreshTokens` array, currently unused in this snippet but good practice)
        // user.refreshTokens.push(refreshToken); await user.save();

        // Redirect to client with access token
        res.redirect(`${process.env.CLIENT_URL}/mail/inbox?token=${accessToken}`);

    } catch (error) {
        console.error('Google Login callback error:', error.message);
        res.redirect(`${process.env.CLIENT_URL}/login?error=oauth_failed`);
    }
});

module.exports = router;
