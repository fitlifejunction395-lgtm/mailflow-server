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

module.exports = router;
