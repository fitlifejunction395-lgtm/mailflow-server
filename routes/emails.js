const express = require('express');
const { body, query } = require('express-validator');
const mongoose = require('mongoose');
const Email = require('../models/Email');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { sendMail } = require('../services/emailTransport');

const router = express.Router();

// All email routes require authentication
router.use(auth);

// ──────────────────────────────────────────────
// POST /api/emails/send — Send a new email
// ──────────────────────────────────────────────
router.post(
    '/send',
    [
        body('to')
            .isArray({ min: 1 })
            .withMessage('At least one recipient is required'),
        body('to.*').isEmail().withMessage('Invalid recipient email'),
        body('subject').optional().trim(),
        body('body').optional(),
    ],
    validate,
    async (req, res) => {
        try {
            const { to, cc, bcc, subject, body: emailBody } = req.body;

            // Strip HTML tags for textBody
            const textBody = emailBody
                ? emailBody.replace(/<[^>]*>/g, '').trim()
                : '';

            // Generate thread ID for new conversations
            const threadId =
                req.body.threadId || new mongoose.Types.ObjectId().toString();

            // Send real email via SMTP
            try {
                await sendMail({
                    to,
                    cc,
                    bcc,
                    subject: subject || '(no subject)',
                    html: emailBody || '',
                    text: textBody,
                });
            } catch (smtpErr) {
                console.error('SMTP send failed, saving anyway:', smtpErr.message);
            }

            // Save to sender's Sent folder
            const sentEmail = await Email.create({
                from: req.user.email,
                fromName: req.user.name,
                to,
                cc: cc || [],
                bcc: bcc || [],
                subject: subject || '(no subject)',
                body: emailBody || '',
                textBody,
                folder: 'sent',
                owner: req.user._id,
                threadId,
                inReplyTo: req.body.inReplyTo || null,
                isRead: true,
                sentAt: new Date(),
            });

            // Also create an inbox copy for recipients who are users of our system
            const User = require('../models/User');
            const allRecipients = [
                ...to,
                ...(cc || []),
            ];

            for (const recipientEmail of allRecipients) {
                const recipientUser = await User.findOne({
                    email: recipientEmail.toLowerCase(),
                });
                if (recipientUser) {
                    await Email.create({
                        from: req.user.email,
                        fromName: req.user.name,
                        to,
                        cc: cc || [],
                        bcc: bcc || [],
                        subject: subject || '(no subject)',
                        body: emailBody || '',
                        textBody,
                        folder: 'inbox',
                        owner: recipientUser._id,
                        threadId,
                        inReplyTo: req.body.inReplyTo || null,
                        isRead: false,
                        sentAt: new Date(),
                    });
                }
            }

            res.status(201).json({
                success: true,
                message: 'Email sent successfully!',
                data: { email: sentEmail },
            });
        } catch (error) {
            console.error('Send email error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to send email.',
            });
        }
    }
);

// ──────────────────────────────────────────────
// POST /api/emails/draft — Save a draft
// ──────────────────────────────────────────────
router.post('/draft', async (req, res) => {
    try {
        const { to, cc, bcc, subject, body: emailBody, draftId } = req.body;

        const textBody = emailBody
            ? emailBody.replace(/<[^>]*>/g, '').trim()
            : '';

        // If updating existing draft
        if (draftId) {
            const draft = await Email.findOneAndUpdate(
                { _id: draftId, owner: req.user._id, isDraft: true },
                {
                    to: to || [],
                    cc: cc || [],
                    bcc: bcc || [],
                    subject: subject || '(no subject)',
                    body: emailBody || '',
                    textBody,
                },
                { new: true }
            );

            if (!draft) {
                return res.status(404).json({
                    success: false,
                    message: 'Draft not found.',
                });
            }

            return res.json({
                success: true,
                message: 'Draft updated.',
                data: { email: draft },
            });
        }

        // Create new draft
        const draft = await Email.create({
            from: req.user.email,
            fromName: req.user.name,
            to: to || [],
            cc: cc || [],
            bcc: bcc || [],
            subject: subject || '(no subject)',
            body: emailBody || '',
            textBody,
            folder: 'drafts',
            owner: req.user._id,
            isDraft: true,
            threadId: req.body.threadId || new mongoose.Types.ObjectId().toString(),
        });

        res.status(201).json({
            success: true,
            message: 'Draft saved.',
            data: { email: draft },
        });
    } catch (error) {
        console.error('Save draft error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save draft.',
        });
    }
});

// ──────────────────────────────────────────────
// GET /api/emails/folder/:folder — List emails by folder
// ──────────────────────────────────────────────
router.get('/folder/:folder', async (req, res) => {
    try {
        const { folder } = req.params;
        const validFolders = ['inbox', 'sent', 'drafts', 'trash', 'starred'];

        if (!validFolders.includes(folder)) {
            return res.status(400).json({
                success: false,
                message: `Invalid folder. Use: ${validFolders.join(', ')}`,
            });
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        // Build query
        let filter = { owner: req.user._id };

        if (folder === 'starred') {
            filter.isStarred = true;
            filter.isDeleted = false;
        } else if (folder === 'trash') {
            filter.isDeleted = true;
        } else if (folder === 'drafts') {
            filter.folder = 'drafts';
            filter.isDraft = true;
            filter.isDeleted = false;
        } else {
            filter.folder = folder;
            filter.isDeleted = false;
        }

        const [emails, total] = await Promise.all([
            Email.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Email.countDocuments(filter),
        ]);

        res.json({
            success: true,
            data: {
                emails,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit),
                    hasMore: page * limit < total,
                },
            },
        });
    } catch (error) {
        console.error('Get folder error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch emails.',
        });
    }
});

// ──────────────────────────────────────────────
// GET /api/emails/counts — Get unread counts per folder
// ──────────────────────────────────────────────
router.get('/counts', async (req, res) => {
    try {
        const userId = req.user._id;

        const [inbox, unread, sent, drafts, trash, starred] = await Promise.all([
            Email.countDocuments({
                owner: userId,
                folder: 'inbox',
                isDeleted: false,
            }),
            Email.countDocuments({
                owner: userId,
                folder: 'inbox',
                isDeleted: false,
                isRead: false,
            }),
            Email.countDocuments({
                owner: userId,
                folder: 'sent',
                isDeleted: false,
            }),
            Email.countDocuments({
                owner: userId,
                folder: 'drafts',
                isDraft: true,
                isDeleted: false,
            }),
            Email.countDocuments({ owner: userId, isDeleted: true }),
            Email.countDocuments({
                owner: userId,
                isStarred: true,
                isDeleted: false,
            }),
        ]);

        res.json({
            success: true,
            data: { inbox, unread, sent, drafts, trash, starred },
        });
    } catch (error) {
        console.error('Get counts error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get counts.',
        });
    }
});

// ──────────────────────────────────────────────
// GET /api/emails/search — Search emails
// ──────────────────────────────────────────────
router.get('/search', async (req, res) => {
    try {
        const { q, filter: filterType } = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        let searchFilter = { owner: req.user._id, isDeleted: false };

        // Text search
        if (q && q.trim()) {
            searchFilter.$text = { $search: q.trim() };
        }

        // Additional filters
        if (filterType === 'unread') {
            searchFilter.isRead = false;
        } else if (filterType === 'starred') {
            searchFilter.isStarred = true;
        }

        const [emails, total] = await Promise.all([
            Email.find(searchFilter)
                .sort(q ? { score: { $meta: 'textScore' } } : { createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Email.countDocuments(searchFilter),
        ]);

        res.json({
            success: true,
            data: {
                emails,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit),
                    hasMore: page * limit < total,
                },
            },
        });
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({
            success: false,
            message: 'Search failed.',
        });
    }
});

// ──────────────────────────────────────────────
// GET /api/emails/:id — Get single email
// ──────────────────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        const email = await Email.findOne({
            _id: req.params.id,
            owner: req.user._id,
        });

        if (!email) {
            return res.status(404).json({
                success: false,
                message: 'Email not found.',
            });
        }

        // Auto-mark as read
        if (!email.isRead) {
            email.isRead = true;
            await email.save();
        }

        res.json({
            success: true,
            data: { email },
        });
    } catch (error) {
        console.error('Get email error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch email.',
        });
    }
});

// ──────────────────────────────────────────────
// PUT /api/emails/:id/read — Toggle read status
// ──────────────────────────────────────────────
router.put('/:id/read', async (req, res) => {
    try {
        const email = await Email.findOne({
            _id: req.params.id,
            owner: req.user._id,
        });

        if (!email) {
            return res.status(404).json({
                success: false,
                message: 'Email not found.',
            });
        }

        email.isRead = req.body.isRead !== undefined ? req.body.isRead : !email.isRead;
        await email.save();

        res.json({
            success: true,
            data: { email },
        });
    } catch (error) {
        console.error('Toggle read error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update email.',
        });
    }
});

// ──────────────────────────────────────────────
// PUT /api/emails/:id/star — Toggle star
// ──────────────────────────────────────────────
router.put('/:id/star', async (req, res) => {
    try {
        const email = await Email.findOne({
            _id: req.params.id,
            owner: req.user._id,
        });

        if (!email) {
            return res.status(404).json({
                success: false,
                message: 'Email not found.',
            });
        }

        email.isStarred = !email.isStarred;
        await email.save();

        res.json({
            success: true,
            data: { email },
        });
    } catch (error) {
        console.error('Toggle star error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update email.',
        });
    }
});

// ──────────────────────────────────────────────
// PUT /api/emails/:id/trash — Move to trash (soft delete)
// ──────────────────────────────────────────────
router.put('/:id/trash', async (req, res) => {
    try {
        const email = await Email.findOne({
            _id: req.params.id,
            owner: req.user._id,
        });

        if (!email) {
            return res.status(404).json({
                success: false,
                message: 'Email not found.',
            });
        }

        email.isDeleted = !email.isDeleted;
        if (email.isDeleted) {
            email.folder = 'trash';
        } else {
            // Restore: put back to inbox or sent
            email.folder = email.sentAt && email.from === req.user.email ? 'sent' : 'inbox';
        }
        await email.save();

        res.json({
            success: true,
            message: email.isDeleted ? 'Moved to trash.' : 'Restored from trash.',
            data: { email },
        });
    } catch (error) {
        console.error('Trash email error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update email.',
        });
    }
});

// ──────────────────────────────────────────────
// DELETE /api/emails/:id — Permanent delete
// ──────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
    try {
        const email = await Email.findOneAndDelete({
            _id: req.params.id,
            owner: req.user._id,
        });

        if (!email) {
            return res.status(404).json({
                success: false,
                message: 'Email not found.',
            });
        }

        res.json({
            success: true,
            message: 'Email permanently deleted.',
        });
    } catch (error) {
        console.error('Delete email error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete email.',
        });
    }
});

// ──────────────────────────────────────────────
// POST /api/emails/:id/reply — Reply to email
// ──────────────────────────────────────────────
router.post('/:id/reply', async (req, res) => {
    try {
        const originalEmail = await Email.findOne({
            _id: req.params.id,
            owner: req.user._id,
        });

        if (!originalEmail) {
            return res.status(404).json({
                success: false,
                message: 'Email not found.',
            });
        }

        const { body: replyBody, replyAll } = req.body;

        // Determine recipients
        let to = [originalEmail.from];
        let cc = [];

        if (replyAll) {
            // Include all original recipients except self
            const allOriginalTo = originalEmail.to.filter(
                (e) => e !== req.user.email
            );
            const allOriginalCc = originalEmail.cc.filter(
                (e) => e !== req.user.email
            );
            to = [originalEmail.from, ...allOriginalTo];
            cc = allOriginalCc;
            // Remove duplicates
            to = [...new Set(to)];
            cc = [...new Set(cc)];
        }

        const subject = originalEmail.subject.startsWith('Re:')
            ? originalEmail.subject
            : `Re: ${originalEmail.subject}`;

        // Build reply body with quote
        const fullBody = `
      ${replyBody || ''}
      <br/><br/>
      <div style="border-left: 2px solid #ccc; padding-left: 12px; color: #666; margin-top: 16px;">
        <p><strong>On ${originalEmail.sentAt ? originalEmail.sentAt.toLocaleDateString() : 'unknown date'}, ${originalEmail.fromName || originalEmail.from} wrote:</strong></p>
        ${originalEmail.body}
      </div>
    `;

        const textBody = fullBody.replace(/<[^>]*>/g, '').trim();

        // Send via SMTP
        try {
            await sendMail({
                to,
                cc,
                subject,
                html: fullBody,
                text: textBody,
            });
        } catch (smtpErr) {
            console.error('SMTP reply failed:', smtpErr.message);
        }

        // Save to sender's sent folder
        const sentReply = await Email.create({
            from: req.user.email,
            fromName: req.user.name,
            to,
            cc,
            subject,
            body: fullBody,
            textBody,
            folder: 'sent',
            owner: req.user._id,
            threadId: originalEmail.threadId,
            inReplyTo: originalEmail._id,
            isRead: true,
            sentAt: new Date(),
        });

        // Deliver to recipients who are system users
        const User = require('../models/User');
        const allRecipients = [...to, ...cc];
        for (const recipientEmail of allRecipients) {
            const recipientUser = await User.findOne({
                email: recipientEmail.toLowerCase(),
            });
            if (recipientUser && recipientUser._id.toString() !== req.user._id.toString()) {
                await Email.create({
                    from: req.user.email,
                    fromName: req.user.name,
                    to,
                    cc,
                    subject,
                    body: fullBody,
                    textBody,
                    folder: 'inbox',
                    owner: recipientUser._id,
                    threadId: originalEmail.threadId,
                    inReplyTo: originalEmail._id,
                    isRead: false,
                    sentAt: new Date(),
                });
            }
        }

        res.status(201).json({
            success: true,
            message: 'Reply sent!',
            data: { email: sentReply },
        });
    } catch (error) {
        console.error('Reply error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send reply.',
        });
    }
});

// ──────────────────────────────────────────────
// POST /api/emails/:id/forward — Forward email
// ──────────────────────────────────────────────
router.post(
    '/:id/forward',
    [
        body('to')
            .isArray({ min: 1 })
            .withMessage('At least one recipient is required'),
        body('to.*').isEmail().withMessage('Invalid recipient email'),
    ],
    validate,
    async (req, res) => {
        try {
            const originalEmail = await Email.findOne({
                _id: req.params.id,
                owner: req.user._id,
            });

            if (!originalEmail) {
                return res.status(404).json({
                    success: false,
                    message: 'Email not found.',
                });
            }

            const { to, body: fwdNote } = req.body;

            const subject = originalEmail.subject.startsWith('Fwd:')
                ? originalEmail.subject
                : `Fwd: ${originalEmail.subject}`;

            const fullBody = `
        ${fwdNote || ''}
        <br/><br/>
        <div style="border-top: 1px solid #ccc; padding-top: 12px; margin-top: 16px;">
          <p><strong>---------- Forwarded message ----------</strong></p>
          <p><strong>From:</strong> ${originalEmail.fromName || originalEmail.from} &lt;${originalEmail.from}&gt;</p>
          <p><strong>Date:</strong> ${originalEmail.sentAt ? originalEmail.sentAt.toLocaleDateString() : 'unknown'}</p>
          <p><strong>Subject:</strong> ${originalEmail.subject}</p>
          <p><strong>To:</strong> ${originalEmail.to.join(', ')}</p>
          <br/>
          ${originalEmail.body}
        </div>
      `;

            const textBody = fullBody.replace(/<[^>]*>/g, '').trim();

            // Send via SMTP
            try {
                await sendMail({ to, subject, html: fullBody, text: textBody });
            } catch (smtpErr) {
                console.error('SMTP forward failed:', smtpErr.message);
            }

            // Save to sender's sent
            const fwdEmail = await Email.create({
                from: req.user.email,
                fromName: req.user.name,
                to,
                subject,
                body: fullBody,
                textBody,
                folder: 'sent',
                owner: req.user._id,
                threadId: new mongoose.Types.ObjectId().toString(),
                isRead: true,
                sentAt: new Date(),
            });

            // Deliver to system recipients
            const User = require('../models/User');
            for (const recipientEmail of to) {
                const recipientUser = await User.findOne({
                    email: recipientEmail.toLowerCase(),
                });
                if (recipientUser) {
                    await Email.create({
                        from: req.user.email,
                        fromName: req.user.name,
                        to,
                        subject,
                        body: fullBody,
                        textBody,
                        folder: 'inbox',
                        owner: recipientUser._id,
                        threadId: fwdEmail.threadId,
                        isRead: false,
                        sentAt: new Date(),
                    });
                }
            }

            res.status(201).json({
                success: true,
                message: 'Email forwarded!',
                data: { email: fwdEmail },
            });
        } catch (error) {
            console.error('Forward error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to forward email.',
            });
        }
    }
);

module.exports = router;
