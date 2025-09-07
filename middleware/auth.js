const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authenticateToken = async (req, res, next) => {
    try {
        // Get token from cookie or Authorization header
        let token = req.cookies?.token || null;
        if (!token && req.headers.authorization) {
            const authHeader = req.headers.authorization;
            if (authHeader.startsWith('Bearer ')) {
                token = authHeader.split(' ')[1];
            }
        }
        console.log('Final token:', token);
        if (!token) {
            return res.status(401).json({ message: 'Access denied. No token provided.' });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ message: 'Token is invalid or expired.' });
        }

        const user = await User.findById(decoded.id);
        if (!user) {
            return res.status(401).json({ message: 'User not found. Invalid token.' });
        }

        req.user = user;
        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        res.status(500).json({ message: 'Server error in authentication.' });
    }
};

const authorizeRoles = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ message: 'Authentication required.' });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
        }

        next();
    };
};

module.exports = { authenticateToken, authorizeRoles };
