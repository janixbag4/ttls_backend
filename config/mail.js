const nodemailer = require('nodemailer');

// Create transporter using env vars. Supports Gmail (less secure or app password)
// Expected env vars: EMAIL_HOST (optional), EMAIL_PORT, EMAIL_USER, EMAIL_PASS
let transporter;

if (process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT ? parseInt(process.env.EMAIL_PORT, 10) : 587,
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
} else if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  // shorthand for Gmail
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
} else {
  // fallback: a no-op transporter that logs messages
  transporter = {
    sendMail: async (mailOptions) => {
      console.log('No mail transporter configured. Email would be:', mailOptions);
      return Promise.resolve({ accepted: [], response: 'noop' });
    },
  };
}

module.exports = transporter;
