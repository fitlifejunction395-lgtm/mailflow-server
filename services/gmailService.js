const { google } = require('googleapis');

/**
 * Create an OAuth2 client with the configured credentials.
 */
const createOAuth2Client = () => {
    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
};

/**
 * Get a Gmail API client for a user with stored tokens.
 */
const getGmailClient = (tokens) => {
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials(tokens);
    return google.gmail({ version: 'v1', auth: oauth2Client });
};

/**
 * Parse a Gmail API message into our Email-like format.
 */
const parseGmailMessage = (msg) => {
    const headers = msg.payload?.headers || [];
    const getHeader = (name) =>
        headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    const from = getHeader('From');
    const to = getHeader('To');
    const cc = getHeader('Cc');
    const subject = getHeader('Subject');
    const date = getHeader('Date');
    const messageId = getHeader('Message-ID');
    const inReplyTo = getHeader('In-Reply-To');

    // Parse "Name <email>" format
    const parseAddress = (addr) => {
        if (!addr) return { name: '', email: '' };
        const match = addr.match(/^"?(.+?)"?\s*<(.+?)>$/);
        if (match) return { name: match[1].trim(), email: match[2].trim() };
        return { name: '', email: addr.trim() };
    };

    const parseAddressList = (str) => {
        if (!str) return [];
        return str.split(',').map((a) => a.trim()).filter(Boolean);
    };

    // Get body
    let body = '';
    let textBody = '';

    const getBody = (parts) => {
        if (!parts) return;
        for (const part of parts) {
            if (part.mimeType === 'text/html' && part.body?.data) {
                body = Buffer.from(part.body.data, 'base64').toString('utf-8');
            }
            if (part.mimeType === 'text/plain' && part.body?.data) {
                textBody = Buffer.from(part.body.data, 'base64').toString('utf-8');
            }
            if (part.parts) getBody(part.parts);
        }
    };

    if (msg.payload?.body?.data) {
        const decoded = Buffer.from(msg.payload.body.data, 'base64').toString('utf-8');
        if (msg.payload.mimeType === 'text/html') {
            body = decoded;
        } else {
            textBody = decoded;
        }
    }
    if (msg.payload?.parts) {
        getBody(msg.payload.parts);
    }
    if (!body && textBody) {
        body = `<pre style="white-space:pre-wrap;font-family:inherit;">${textBody}</pre>`;
    }

    const fromParsed = parseAddress(from);
    const labelIds = msg.labelIds || [];

    // Determine folder
    let folder = 'inbox';
    if (labelIds.includes('SENT')) folder = 'sent';
    else if (labelIds.includes('DRAFT')) folder = 'drafts';
    else if (labelIds.includes('TRASH')) folder = 'trash';
    else if (labelIds.includes('SPAM')) folder = 'trash';

    return {
        gmailId: msg.id,
        threadId: msg.threadId,
        from: fromParsed.email || from,
        fromName: fromParsed.name,
        to: parseAddressList(to),
        cc: parseAddressList(cc),
        subject: subject || '(no subject)',
        body,
        textBody,
        isRead: !labelIds.includes('UNREAD'),
        isStarred: labelIds.includes('STARRED'),
        isDraft: labelIds.includes('DRAFT'),
        isDeleted: labelIds.includes('TRASH'),
        folder,
        sentAt: date ? new Date(date) : new Date(),
        labels: labelIds,
        inReplyToHeader: inReplyTo,
        messageIdHeader: messageId,
    };
};

/**
 * Fetch emails from Gmail API.
 */
const fetchGmailEmails = async (tokens, options = {}) => {
    const gmail = getGmailClient(tokens);
    const {
        maxResults = 30,
        q = '',
        labelIds = ['INBOX'],
        pageToken = null,
    } = options;

    const params = {
        userId: 'me',
        maxResults,
    };

    if (q) params.q = q;
    if (labelIds && labelIds.length > 0) params.labelIds = labelIds;
    if (pageToken) params.pageToken = pageToken;

    const listRes = await gmail.users.messages.list(params);
    const messages = listRes.data.messages || [];
    const nextPageToken = listRes.data.nextPageToken || null;

    // Fetch full message details in parallel (batch of 10)
    const emails = [];
    for (let i = 0; i < messages.length; i += 10) {
        const batch = messages.slice(i, i + 10);
        const details = await Promise.all(
            batch.map((m) =>
                gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' })
            )
        );
        for (const detail of details) {
            emails.push(parseGmailMessage(detail.data));
        }
    }

    return { emails, nextPageToken };
};

/**
 * Send email via Gmail API.
 */
const sendGmailEmail = async (tokens, { to, cc, bcc, subject, body, inReplyTo, threadId }) => {
    const gmail = getGmailClient(tokens);

    // Build raw RFC 2822 message
    const toList = Array.isArray(to) ? to.join(', ') : to;
    let raw = `To: ${toList}\r\n`;
    if (cc) raw += `Cc: ${Array.isArray(cc) ? cc.join(', ') : cc}\r\n`;
    if (bcc) raw += `Bcc: ${Array.isArray(bcc) ? bcc.join(', ') : bcc}\r\n`;
    raw += `Subject: ${subject || '(no subject)'}\r\n`;
    raw += `Content-Type: text/html; charset=utf-8\r\n`;
    if (inReplyTo) raw += `In-Reply-To: ${inReplyTo}\r\n`;
    raw += `\r\n${body || ''}`;

    const encoded = Buffer.from(raw).toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    const params = {
        userId: 'me',
        requestBody: { raw: encoded },
    };
    if (threadId) params.requestBody.threadId = threadId;

    const result = await gmail.users.messages.send(params);
    return result.data;
};

/**
 * Get user's Gmail profile (email address).
 */
const getGmailProfile = async (tokens) => {
    const gmail = getGmailClient(tokens);
    const res = await gmail.users.getProfile({ userId: 'me' });
    return res.data;
};

module.exports = {
    createOAuth2Client,
    getGmailClient,
    fetchGmailEmails,
    sendGmailEmail,
    getGmailProfile,
    parseGmailMessage,
};
