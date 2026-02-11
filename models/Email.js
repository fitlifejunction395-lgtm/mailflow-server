const mongoose = require('mongoose');

const emailSchema = new mongoose.Schema(
    {
        from: {
            type: String,
            required: true,
            trim: true,
        },
        fromName: {
            type: String,
            trim: true,
            default: '',
        },
        to: {
            type: [String],
            required: true,
        },
        cc: {
            type: [String],
            default: [],
        },
        bcc: {
            type: [String],
            default: [],
        },
        subject: {
            type: String,
            default: '(no subject)',
            trim: true,
        },
        body: {
            type: String,
            default: '',
        },
        textBody: {
            type: String,
            default: '',
        },
        isRead: {
            type: Boolean,
            default: false,
        },
        isStarred: {
            type: Boolean,
            default: false,
        },
        isDraft: {
            type: Boolean,
            default: false,
        },
        isDeleted: {
            type: Boolean,
            default: false,
        },
        folder: {
            type: String,
            enum: ['inbox', 'sent', 'drafts', 'trash', 'starred'],
            default: 'inbox',
        },
        owner: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        threadId: {
            type: String,
            default: null,
        },
        inReplyTo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Email',
            default: null,
        },
        labels: {
            type: [String],
            default: [],
        },
        sentAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

// Compound indexes for fast queries
emailSchema.index({ owner: 1, folder: 1, createdAt: -1 });
emailSchema.index({ owner: 1, isStarred: 1 });
emailSchema.index({ owner: 1, isDeleted: 1 });
emailSchema.index({ owner: 1, isRead: 1 });
emailSchema.index({ threadId: 1 });

// Text index for search
emailSchema.index({
    subject: 'text',
    body: 'text',
    textBody: 'text',
    from: 'text',
    fromName: 'text',
});

module.exports = mongoose.model('Email', emailSchema);
