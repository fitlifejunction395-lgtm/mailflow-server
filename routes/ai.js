const express = require('express');
const router = express.Router();
const { summarizeEmail, generateSmartReplies, helpMeWrite } = require('../services/geminiService');
const auth = require('../middleware/auth');

// Protect all AI routes
router.use(auth);

// POST /api/ai/summarize
router.post('/summarize', async (req, res) => {
    try {
        const { content } = req.body;
        if (!content) return res.status(400).json({ message: 'Content required' });

        const summary = await summarizeEmail(content);
        res.json({ success: true, data: summary });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/ai/reply
router.post('/reply', async (req, res) => {
    try {
        const { content } = req.body;
        if (!content) return res.status(400).json({ message: 'Content required' });

        const replies = await generateSmartReplies(content);
        res.json({ success: true, data: replies });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/ai/draft
router.post('/draft', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ message: 'Prompt required' });

        const draft = await helpMeWrite(prompt);
        res.json({ success: true, data: draft });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
