const express = require('express');
const { body } = require('express-validator');
const User = require('../models/User');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const {
    generateAccessToken,
    generateRefreshToken,
    verifyRefreshToken,
} = require('../utils/tokens');

const router = express.Router();

// ──────────────────────────────────────────────
// POST /api/auth/signup
// ──────────────────────────────────────────────
router.post(
    '/signup',
    [
        body('name').trim().notEmpty().withMessage('Name is required'),
        body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
        body('password')
            .isLength({ min: 6 })
            .withMessage('Password must be at least 6 characters'),
    ],
    validate,
    async (req, res) => {
        try {
            const { name, email, password } = req.body;

            // Check if user already exists
            const existingUser = await User.findOne({ email });
            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    message: 'An account with this email already exists.',
                });
            }

            // Create user
            const user = await User.create({ name, email, password });

            // Generate tokens
            const accessToken = generateAccessToken(user);
            const refreshToken = generateRefreshToken(user);

            // Save refresh token
            await User.findByIdAndUpdate(user._id, {
                $push: { refreshTokens: refreshToken },
            });

            // Set httpOnly cookie
            res.cookie('refreshToken', refreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            });

            res.status(201).json({
                success: true,
                message: 'Account created successfully!',
                data: {
                    user: user.toJSON(),
                    accessToken,
                },
            });
        } catch (error) {
            console.error('Signup error:', error);
            res.status(500).json({
                success: false,
                message: 'Server error during signup.',
            });
        }
    }
);

// ──────────────────────────────────────────────
// POST /api/auth/login
// ──────────────────────────────────────────────
router.post(
    '/login',
    [
        body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
        body('password').notEmpty().withMessage('Password is required'),
    ],
    validate,
    async (req, res) => {
        try {
            const { email, password } = req.body;

            // Find user with password field
            const user = await User.findOne({ email }).select('+password');
            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid email or password.',
                });
            }

            // Check password
            const isMatch = await user.comparePassword(password);
            if (!isMatch) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid email or password.',
                });
            }

            // Generate tokens
            const accessToken = generateAccessToken(user);
            const refreshToken = generateRefreshToken(user);

            // Save refresh token
            await User.findByIdAndUpdate(user._id, {
                $push: { refreshTokens: refreshToken },
            });

            // Set httpOnly cookie
            res.cookie('refreshToken', refreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000,
            });

            res.json({
                success: true,
                message: 'Logged in successfully!',
                data: {
                    user: user.toJSON(),
                    accessToken,
                },
            });
        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({
                success: false,
                message: 'Server error during login.',
            });
        }
    }
);

// ──────────────────────────────────────────────
// POST /api/auth/logout
// ──────────────────────────────────────────────
router.post('/logout', auth, async (req, res) => {
    try {
        const refreshToken = req.cookies?.refreshToken;

        if (refreshToken) {
            // Remove refresh token from user's stored tokens
            await User.findByIdAndUpdate(req.user._id, {
                $pull: { refreshTokens: refreshToken },
            });
        }

        // Clear cookie
        res.clearCookie('refreshToken');

        res.json({
            success: true,
            message: 'Logged out successfully.',
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during logout.',
        });
    }
});

// ──────────────────────────────────────────────
// POST /api/auth/refresh
// ──────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
    try {
        const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;

        if (!refreshToken) {
            return res.status(401).json({
                success: false,
                message: 'No refresh token provided.',
            });
        }

        // Verify refresh token
        const decoded = verifyRefreshToken(refreshToken);

        // Check if token is in user's stored tokens
        const user = await User.findById(decoded.id).select('+refreshTokens');
        if (!user || !user.refreshTokens.includes(refreshToken)) {
            return res.status(401).json({
                success: false,
                message: 'Invalid refresh token.',
            });
        }

        // Generate new tokens
        const newAccessToken = generateAccessToken(user);
        const newRefreshToken = generateRefreshToken(user);

        // Rotate refresh token (remove old, add new)
        await User.findByIdAndUpdate(user._id, {
            $pull: { refreshTokens: refreshToken },
            $push: { refreshTokens: newRefreshToken },
        });

        // Set new cookie
        res.cookie('refreshToken', newRefreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        res.json({
            success: true,
            data: {
                accessToken: newAccessToken,
            },
        });
    } catch (error) {
        console.error('Token refresh error:', error);
        res.status(401).json({
            success: false,
            message: 'Invalid or expired refresh token.',
        });
    }
});

// ──────────────────────────────────────────────
// GET /api/auth/me
// ──────────────────────────────────────────────
router.get('/me', auth, async (req, res) => {
    res.json({
        success: true,
        data: { user: req.user.toJSON() },
    });
});

module.exports = router;
