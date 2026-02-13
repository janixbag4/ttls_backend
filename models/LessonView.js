const mongoose = require('mongoose');

const LessonViewSchema = new mongoose.Schema({
  lesson: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  viewedAt: { type: Date, default: Date.now },
  openedAt: { type: Date }, // When student actually opened the lesson content
  lastViewedAt: { type: Date, default: Date.now },
  viewCount: { type: Number, default: 1 },
  completed: { type: Boolean, default: false }, // Track if lesson is marked complete
  completedAt: { type: Date }, // When the lesson was marked complete
}, {
  timestamps: true,
});

// Index for efficient queries
LessonViewSchema.index({ lesson: 1, student: 1 });
LessonViewSchema.index({ student: 1 });
LessonViewSchema.index({ student: 1, completed: 1 });

module.exports = mongoose.model('LessonView', LessonViewSchema);
