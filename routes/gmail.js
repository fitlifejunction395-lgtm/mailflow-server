const express = require('express');
const router = express.Router();
const User = require('../models/User');
const verifyToken = require('../middleware/auth');
const {
    createOAuth2Client,
    fetchGmailEmails,
    sendGmailEmail,
    getGmailProfile,
} = require('../services/gmailService');

/**
 * GET /api/gmail/profile
 * Get connected Gmail profile info.
 */
router.get('/profile', verifyToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('+googleTokens.accessToken +googleTokens.refreshToken +googleTokens.expiryDate');
        if (!user?.isGmailConnected) {
            return res.status(400).json({ success: false, message: 'Gmail not connected' });
        }

        const tokens = {
            access_token: user.googleTokens.accessToken,
            refresh_token: user.googleTokens.refreshToken,
            expiry_date: user.googleTokens.expiryDate,
        };

        const profile = await getGmailProfile(tokens);

        res.json({
            success: true,
            data: {
                email: profile.emailAddress,
                messagesTotal: profile.messagesTotal,
                threadsTotal: profile.threadsTotal,
            },
        });
    } catch (error) {
        console.error('[Gmail] Profile error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/gmail/messages?folder=inbox&maxResults=20&pageToken=xxx&q=search
 * Fetch emails from Gmail.
 */
router.get('/messages', verifyToken, async (req, res) => {
    try {
        const { folder = 'inbox', maxResults = 20, pageToken, q } = req.query;
        console.log(`[Gmail] Fetching messages for user ${req.user.id} folder=${folder}`);

        const user = await User.findById(req.user.id).select('+googleTokens.accessToken +googleTokens.refreshToken +googleTokens.expiryDate');

        if (!user?.isGmailConnected) {
            console.warn(`[Gmail] User ${req.user.id} not connected`);
            return res.status(400).json({ success: false, message: 'Gmail not connected' });
        }

        console.log(`[Gmail] User connected. Access token present: ${!!user.googleTokens.accessToken}`);

        const tokens = {
            access_token: user.googleTokens.accessToken,
            refresh_token: user.googleTokens.refreshToken,
            expiry_date: user.googleTokens.expiryDate,
        };

        // Map folders to Gmail label IDs
        const folderToLabels = {
            inbox: ['INBOX'],
            sent: ['SENT'],
            drafts: ['DRAFT'],
            trash: ['TRASH'],
            starred: ['STARRED'],
        };

        const labelIds = folderToLabels[folder] || ['INBOX'];

        const result = await fetchGmailEmails(tokens, {
            maxResults: parseInt(maxResults),
            labelIds,
            pageToken: pageToken || null,
            q: q || '',
        });

        // Refresh tokens if they were updated
        const oauth2Client = createOAuth2Client();
        oauth2Client.setCredentials(tokens);
        const newTokens = oauth2Client.credentials;
        if (newTokens.access_token !== tokens.access_token) {
            await User.findByIdAndUpdate(req.user.id, {
                'googleTokens.accessToken': newTokens.access_token,
                'googleTokens.expiryDate': newTokens.expiry_date,
            });
        }

        res.json({
            success: true,
            data: {
                emails: result.emails,
                nextPageToken: result.nextPageToken,
                folder,
            },
        });
    } catch (error) {
        console.error('[Gmail] Fetch error:', error);
        console.error('[Gmail] Error details:', error.response?.data || error.message);

        // If token expired, tell frontend to re-auth
        if (error.code === 401 || error.message?.includes('invalid_grant')) {
            console.log('[Gmail] Token expired, disconnecting user.');
            await User.findByIdAndUpdate(req.user.id, { isGmailConnected: false });
            return res.status(401).json({ success: false, message: 'Gmail auth expired. Please reconnect.' });
        }

        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/gmail/send
 * Send email via Gmail API.
 */
router.post('/send', verifyToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('+googleTokens.accessToken +googleTokens.refreshToken +googleTokens.expiryDate');
        if (!user?.isGmailConnected) {
            return res.status(400).json({ success: false, message: 'Gmail not connected' });
        }

        const tokens = {
            access_token: user.googleTokens.accessToken,
            refresh_token: user.googleTokens.refreshToken,
            expiry_date: user.googleTokens.expiryDate,
        };

        const { to, cc, bcc, subject, body, inReplyTo, threadId } = req.body;

        const result = await sendGmailEmail(tokens, {
            to, cc, bcc, subject, body, inReplyTo, threadId,
        });

        res.json({
            success: true,
            message: 'Email sent via Gmail!',
            data: { id: result.id, threadId: result.threadId },
        });
    } catch (error) {
        console.error('Gmail send error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
