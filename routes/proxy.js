const express = require('express');
const router = express.Router();
const axios = require('axios');

// GET /api/proxy?url=<encoded>&filename=<optional>
// Streams an external URL through the backend and forces download with Content-Disposition
router.get('/proxy', async (req, res) => {
  try {
    const { url, filename } = req.query;
    if (!url) return res.status(400).json({ success: false, message: 'Missing url parameter' });

    const resp = await axios.get(url, { responseType: 'stream' });
    const contentType = resp.headers['content-type'] || 'application/octet-stream';
    const name = filename || 'file';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    resp.data.pipe(res);
  } catch (err) {
    console.error('Proxy error', err.message || err);
    res.status(500).json({ success: false, message: 'Failed to proxy file' });
  }
});

// GET /api/frame-proxy?url=<encoded>
// Wraps external websites in a proxy to bypass CSP and X-Frame-Options restrictions
router.get('/frame-proxy', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, message: 'Missing url parameter' });

    const decodedUrl = decodeURIComponent(url);
    const resp = await axios.get(decodedUrl, { 
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    // Set headers to prevent X-Frame-Options and CSP from blocking
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Content-Security-Policy', "frame-ancestors *");
    res.setHeader('Content-Type', resp.headers['content-type'] || 'text/html');
    
    resp.data.pipe(res);
  } catch (err) {
    console.error('Frame proxy error', err.message || err);
    res.status(500).json({ success: false, message: 'Failed to proxy frame' });
  }
});

module.exports = router;
