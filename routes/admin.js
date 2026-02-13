const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// Public endpoint to create initial admin using ADMIN_API_KEY
// This helps when seeding fails due to network/DNS issues.
// POST /api/admin/init
// Headers: x-admin-api-key: <ADMIN_API_KEY>
// Body: { firstName, lastName, idNumber, email, password }
router.post('/init', async (req, res) => {
  try {
    const apiKey = req.headers['x-admin-api-key'] || req.body.adminApiKey;
    const expected = process.env.ADMIN_API_KEY || 'dev_admin_key_please_change';

    if (!apiKey || apiKey !== expected) {
      return res.status(401).json({ success: false, message: 'Invalid admin API key' });
    }

    // Only allow if no admin exists yet
    const adminCount = await User.countDocuments({ role: 'admin' });
    if (adminCount > 0) {
      return res.status(400).json({ success: false, message: 'Admin user(s) already exist' });
    }

    const { firstName, lastName, idNumber, email, password } = req.body;
    if (!firstName || !lastName || !idNumber || !email || !password) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(password, salt);

    const adminUser = new User({
      firstName,
      lastName,
      idNumber,
      email,
      password: hashed,
      role: 'admin',
      status: 'approved',
    });

    await adminUser.save();

    const out = adminUser.toObject();
    delete out.password;

    res.status(201).json({ success: true, message: 'Initial admin created', user: out });
  } catch (error) {
    console.error('Init admin error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/admin/users/pending
// @desc    Get all pending users
// @access  Private/Admin
router.get('/users/pending', protect, authorize('admin'), async (req, res) => {
  try {
    const pendingUsers = await User.find({ status: 'pending' }).select('-password');

    res.status(200).json({
      success: true,
      count: pendingUsers.length,
      users: pendingUsers,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/admin/users
// @desc    Get all users
// @access  Private/Admin
router.get('/users', protect, authorize('admin'), async (req, res) => {
  try {
    const users = await User.find().select('-password');

    res.status(200).json({
      success: true,
      count: users.length,
      users,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/admin/users/:id/approve
// @desc    Approve a user
// @access  Private/Admin
router.put('/users/:id/approve', protect, authorize('admin'), async (req, res) => {
  try {
    let user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.status = 'approved';
    await user.save();

    res.status(200).json({
      success: true,
      message: 'User approved successfully',
      user,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/admin/users/:id/reject
// @desc    Reject a user
// @access  Private/Admin
router.put('/users/:id/reject', protect, authorize('admin'), async (req, res) => {
  try {
    let user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.status = 'rejected';
    await user.save();

    res.status(200).json({
      success: true,
      message: 'User rejected',
      user,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/admin/users/:id/suspend
// @desc    Suspend a user
// @access  Private/Admin
router.put('/users/:id/suspend', protect, authorize('admin'), async (req, res) => {
  try {
    let user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.status = 'suspended';
    await user.save();

    res.status(200).json({
      success: true,
      message: 'User suspended successfully',
      user,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/admin/users/:id/unsuspend
// @desc    Unsuspend a user
// @access  Private/Admin
router.put('/users/:id/unsuspend', protect, authorize('admin'), async (req, res) => {
  try {
    let user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.status = 'approved';
    await user.save();

    res.status(200).json({
      success: true,
      message: 'User unsuspended successfully',
      user,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/admin/users/:id
// @desc    Edit a user
// @access  Private/Admin
router.put('/users/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const { firstName, lastName, idNumber, email, role, department, specialization, bio } = req.body;

    let user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Update fields
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (idNumber) user.idNumber = idNumber;
    if (email) user.email = email;
    if (role) user.role = role;
    if (department !== undefined) user.department = department;
    if (specialization !== undefined) user.specialization = specialization;
    if (bio !== undefined) user.bio = bio;

    await user.save();

    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      user,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/admin/users
// @desc    Create a new user
// @access  Private/Admin
router.post('/users', protect, authorize('admin'), async (req, res) => {
  try {
    const { firstName, lastName, idNumber, email, password, role, department, specialization } = req.body;

    if (!firstName || !lastName || !idNumber || !email || !password || !role) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ $or: [{ email }, { idNumber }] });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User with this email or ID number already exists' });
    }

    const user = new User({
      firstName,
      lastName,
      idNumber,
      email,
      password,
      role,
      department,
      specialization,
      status: 'approved', // Admin-created users are approved by default
    });

    await user.save();

    const out = user.toObject();
    delete out.password;

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: out,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Bulk actions: delete multiple users
// POST /api/admin/users/bulk-delete
// body: { userIds: [] }
router.post('/users/bulk-delete', protect, authorize('admin'), async (req, res) => {
  try {
    const { userIds } = req.body;
    if (!Array.isArray(userIds) || !userIds.length) return res.status(400).json({ success: false, message: 'userIds required' });

    const result = await User.deleteMany({ _id: { $in: userIds } });
    res.json({ success: true, message: 'Users deleted', deletedCount: result.deletedCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Bulk delete failed' });
  }
});

// @route   DELETE /api/admin/users/:id
// @desc    Delete a single user
// @access  Private/Admin
router.delete('/users/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, message: 'User deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to delete user' });
  }
});

// Send email to users (admin)
// POST /api/admin/users/email
// body: { userIds: [], subject, text, html }
const transporter = require('../config/mail');
router.post('/users/email', protect, authorize('admin'), async (req, res) => {
  try {
    const { userIds, subject, text, html } = req.body;
    if (!Array.isArray(userIds) || !userIds.length) return res.status(400).json({ success: false, message: 'userIds required' });
    if (!subject || (!text && !html)) return res.status(400).json({ success: false, message: 'subject and body required' });

    const users = await User.find({ _id: { $in: userIds } });
    const emailPromises = users.map((u) => {
      const mailOptions = {
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER || 'no-reply@ttls.local',
        to: u.email,
        subject,
        text,
        html,
      };
      return transporter.sendMail(mailOptions);
    });

    const results = await Promise.allSettled(emailPromises);
    res.json({ success: true, message: 'Emails sent (or queued)', results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to send emails' });
  }
});

module.exports = router;
