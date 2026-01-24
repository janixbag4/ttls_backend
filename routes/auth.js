const express = require('express');
const { body, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Generate JWT Token
const generateToken = (id, role) => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  });
};

// @route   POST /api/auth/signup
// @desc    Register a new user
// @access  Public
router.post(
  '/signup',
  [
    body('firstName', 'First name is required').trim().notEmpty(),
    body('lastName', 'Last name is required').trim().notEmpty(),
    body('idNumber', 'ID Number is required').trim().notEmpty(),
    body('email', 'Please include a valid email').isEmail(),
    body('password', 'Password must be at least 6 characters').isLength({ min: 6 }),
    body('role', 'Role must be student, teacher, or admin').isIn(['student', 'teacher', 'admin']),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { firstName, lastName, idNumber, email, password, role, dateOfBirth, department } = req.body;

    try {
      // Check if user already exists
      let user = await User.findOne({ $or: [{ email }, { idNumber }] });

      if (user) {
        return res.status(400).json({
          success: false,
          message: 'User already exists with this email or ID number',
        });
      }

      // Determine initial status: if creating the first admin, auto-approve
      let initialStatus = 'pending';
      if (role === 'admin') {
        const adminCount = await User.countDocuments({ role: 'admin' });
        if (adminCount === 0) {
          initialStatus = 'approved';
        }
      }

      // Create new user
      user = new User({
        firstName,
        lastName,
        idNumber,
        email,
        password,
        role,
        dateOfBirth,
        department,
        status: initialStatus,
      });

      await user.save();

      const token = generateToken(user._id, user.role);

      res.status(201).json({
        success: true,
        message: 'User registered successfully. Awaiting admin approval.',
        token,
        user: {
          id: user._id,
          idNumber: user.idNumber,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          status: user.status,
          profilePicture: user.profilePicture || null,
          coverPhoto: user.coverPhoto || null,
          bio: user.bio || '',
        },
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post(
  '/login',
  [
    body('idNumber', 'ID Number is required').trim().notEmpty(),
    body('password', 'Password is required').notEmpty(),
    body('role', 'Role is required').isIn(['student', 'teacher', 'admin']),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { idNumber, password, role } = req.body;

    try {
      // Find user by ID number and role
      const user = await User.findOne({ idNumber, role });

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials. User not found.',
        });
      }

      // Check if user is approved
      if (user.status === 'pending') {
        return res.status(403).json({
          success: false,
          message: 'Your account is pending approval. Please wait for admin approval.',
        });
      }

      if (user.status === 'rejected') {
        return res.status(403).json({
          success: false,
          message: 'Your account has been rejected. Please contact admin.',
        });
      }

      if (user.status === 'suspended') {
        return res.status(403).json({
          success: false,
          message: 'Your account has been suspended. Please contact admin.',
        });
      }

      // Check password
      const isMatch = await user.matchPassword(password);

      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials. Password incorrect.',
        });
      }

      const token = generateToken(user._id, user.role);

      res.status(200).json({
        success: true,
        message: 'Login successful',
        token,
        user: {
          id: user._id,
          idNumber: user.idNumber,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          status: user.status,
          profilePicture: user.profilePicture || null,
          coverPhoto: user.coverPhoto || null,
          bio: user.bio || '',
        },
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

// @route   GET /api/auth/me
// @desc    Get current logged in user
// @access  Private
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
