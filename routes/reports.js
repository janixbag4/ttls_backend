

const express = require('express');
const router = express.Router();
const Report = require('../models/Report');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');

// Get reports for the logged-in user
router.get('/my', protect, async (req, res) => {
  try {
    const reports = await Report.find({ reporter: req.user.id }).sort({ createdAt: -1 });
    res.json({ reports });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});
// Create a report
router.post('/', protect, async (req, res) => {
  try {
    const { subject, message, type } = req.body;

    if (!subject || !message || !type) {
      return res.status(400).json({ message: 'Subject, message, and type are required' });
    }

    // Generate a unique ticket number (e.g., RPT-YYYYMMDD-HHMMSS-XXXX)
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    const dateStr = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const randomStr = Math.floor(1000 + Math.random() * 9000);
    const ticketNumber = `RPT-${dateStr}-${randomStr}`;

    const report = new Report({
      reporter: req.user.id,
      subject,
      message,
      type,
      ticketNumber,
    });

    await report.save();

    res.status(201).json({ message: 'Report submitted successfully', report, ticketNumber });
  } catch (error) {
    console.error('Error creating report:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all reports (admin only)
router.get('/', protect, authorize('admin'), async (req, res) => {
  try {
    const reports = await Report.find()
      .populate('reporter', 'firstName lastName email idNumber')
      .sort({ createdAt: -1 });

    res.json({ reports });
  } catch (error) {
    console.error('Error fetching reports:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update report status (admin only)
router.put('/:id/status', protect, authorize('admin'), async (req, res) => {
  try {
    const { status } = req.body;

    if (!['pending', 'reviewed', 'resolved'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const report = await Report.findByIdAndUpdate(
      req.params.id,
      { status, updatedAt: new Date() },
      { new: true }
    ).populate('reporter', 'firstName lastName email idNumber');

    if (!report) {
      return res.status(404).json({ message: 'Report not found' });
    }

    res.json({ message: 'Report status updated', report });
  } catch (error) {
    console.error('Error updating report status:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete report (admin only)
router.delete('/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const report = await Report.findByIdAndDelete(req.params.id);

    if (!report) {
      return res.status(404).json({ message: 'Report not found' });
    }

    res.json({ message: 'Report deleted successfully' });
  } catch (error) {
    console.error('Error deleting report:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;