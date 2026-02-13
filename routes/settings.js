const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');
const { protect, authorize } = require('../middleware/auth');

// Get settings (public - for home page)
router.get('/satisfaction-rate', async (req, res) => {
  try {
    let settings = await Settings.findOne();
    
    // Create default settings if they don't exist
    if (!settings) {
      settings = new Settings({
        satisfactionRate: 98,
        satisfactionNote: 'Based on early user feedback and ratings'
      });
      await settings.save();
    }

    res.json({ 
      success: true, 
      data: { 
        satisfactionRate: settings.satisfactionRate,
        satisfactionNote: settings.satisfactionNote
      } 
    });
  } catch (error) {
    console.error('Error fetching satisfaction rate:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch settings' });
  }
});

// Update satisfaction rate (admin only)
router.put('/satisfaction-rate', protect, authorize('admin'), async (req, res) => {
  try {
    const { satisfactionRate, satisfactionNote } = req.body;

    if (satisfactionRate !== undefined && (satisfactionRate < 0 || satisfactionRate > 100)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Satisfaction rate must be between 0 and 100' 
      });
    }

    let settings = await Settings.findOne();
    
    if (!settings) {
      settings = new Settings();
    }

    if (satisfactionRate !== undefined) {
      settings.satisfactionRate = satisfactionRate;
    }
    if (satisfactionNote !== undefined) {
      settings.satisfactionNote = satisfactionNote;
    }

    await settings.save();

    res.json({ 
      success: true, 
      message: 'Settings updated successfully',
      data: settings 
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ success: false, message: 'Failed to update settings' });
  }
});

module.exports = router;
