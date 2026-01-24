// models/Module.js
const mongoose = require('mongoose');

const ModuleSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    category: {
      type: String,
      enum: ['e-module', 'advanced-ttl'],
      default: 'e-module',
      required: true,
    },
    moduleNumber: {
      type: Number,
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    iframeUrl: {
      type: String,
      default: '',
    },
    iframeTitle: {
      type: String,
      default: '',
    },
    coverPhoto: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
ModuleSchema.index({ category: 1, moduleNumber: 1 });
ModuleSchema.index({ createdBy: 1 });

module.exports = mongoose.model('Module', ModuleSchema);

