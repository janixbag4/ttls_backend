const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema(
  {
    satisfactionRate: {
      type: Number,
      default: 98,
      min: 0,
      max: 100,
      description: 'Platform satisfaction rate - editable by admin'
    },
    satisfactionNote: {
      type: String,
      default: 'Based on early user feedback and ratings',
      description: 'Note about satisfaction rate for display on home page'
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Settings', SettingsSchema);
