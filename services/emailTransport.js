const nodemailer = require('nodemailer');

let transporter = null;

const createTransporter = () => {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
        console.warn('⚠️  SMTP not configured. Emails will be logged but not sent.');
        return null;
    }

    transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: parseInt(SMTP_PORT) || 587,
        secure: false, // true for 465, false for 587
        auth: {
            user: SMTP_USER,
            pass: SMTP_PASS,
        },
    });

    // Verify the transporter
    transporter.verify((error) => {
        if (error) {
            console.error('❌ SMTP verification failed:', error.message);
        } else {
            console.log('✅ SMTP transport ready');
        }
    });

    return transporter;
};

const sendMail = async ({ to, cc, bcc, subject, html, text }) => {
    const mailOptions = {
        from: `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_FROM_EMAIL}>`,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject: subject || '(no subject)',
        html: html || '',
        text: text || '',
    };

    if (cc && cc.length > 0) {
        mailOptions.cc = Array.isArray(cc) ? cc.join(', ') : cc;
    }
    if (bcc && bcc.length > 0) {
        mailOptions.bcc = Array.isArray(bcc) ? bcc.join(', ') : bcc;
    }

    // If no transporter, just log
    if (!transporter) {
        console.log('📧 [Mock Send] Email would be sent:', {
            to: mailOptions.to,
            subject: mailOptions.subject,
        });
        return { messageId: `mock-${Date.now()}`, mock: true };
    }

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`📧 Email sent: ${info.messageId}`);
        return info;
    } catch (error) {
        console.error('❌ Email send failed:', error.message);
        throw error;
    }
};

module.exports = { createTransporter, sendMail };
