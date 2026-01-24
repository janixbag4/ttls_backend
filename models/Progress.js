const mongoose = require('mongoose');

const ProgressSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  lesson: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson' },
  activity: { type: mongoose.Schema.Types.ObjectId, ref: 'Activity' },
  status: { type: String, enum: ['not-started', 'in-progress', 'completed'], default: 'not-started' },
  score: { type: Number },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Progress', ProgressSchema);
