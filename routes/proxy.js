const express = require('express');
const router = express.Router();
const axios = require('axios');
let puppeteer = null;

// Try to load puppeteer if available
try {
  puppeteer = require('puppeteer');
} catch (e) {
  console.warn('Puppeteer not installed, falling back to axios');
}

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
// Uses headless browser to load websites (passes Cloudflare, executes JS, etc)
router.get('/frame-proxy', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, message: 'Missing url parameter' });

    const decodedUrl = decodeURIComponent(url);
    
    // Use Puppeteer if available for better compatibility
    if (puppeteer) {
      try {
        console.log('Using Puppeteer to load:', decodedUrl);
        const browser = await puppeteer.launch({ 
          headless: 'new',
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
        });
        const page = await browser.newPage();
        
        // Set viewport
        await page.setViewport({ width: 1366, height: 768 });
        
        // Navigate with timeout
        await page.goto(decodedUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Get rendered HTML
        let html = await page.content();

        await browser.close();

        // Prepare origin and rewrite root-relative URLs so resources resolve to original host
        try {
          const origin = new URL(decodedUrl).origin;

          // Inject <base> tag after <head> to help relative URLs resolve to the original site
          if (/\<head[^>]*>/i.test(html)) {
            html = html.replace(/<head([^>]*)>/i, (m, g1) => {
              return `<head${g1}>\n<base href="${origin}/">`;
            });
          } else {
            // If no head tag, prepend a base in case
            html = `<!DOCTYPE html><head><base href="${origin}/"></head>` + html;
          }

          // Rewrite root-relative attributes (src, href, action, poster, data-src, formaction)
          html = html.replace(/(src|href|action|poster|data-src|formaction)=["']\//gi, `$1="${origin}/`);

          // Rewrite protocol-relative URLs to https explicitly
          html = html.replace(/(src|href)=(["'])\/\//gi, `$1=$2https://`);

          // Rewrite occurrences inside srcset values (basic): replace ", /" patterns
          html = html.replace(/srcset=(['"])(.*?)\1/gi, (m, quote, val) => {
            const rewritten = val.split(',').map(part => {
              const p = part.trim();
              if (p.startsWith('/')) return `${origin}${p}`;
              if (p.startsWith('//')) return `https:${p}`;
              return p;
            }).join(', ');
            return `srcset=${quote}${rewritten}${quote}`;
          });
        } catch (e) {
          console.warn('Failed to rewrite URLs for proxied HTML:', e.message || e);
        }

        // Set headers (permissive for testing)
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('X-Frame-Options', 'ALLOWALL');
        res.setHeader('Content-Security-Policy', '');
        res.setHeader('Access-Control-Allow-Origin', '*');

        res.send(html);
        return;
      } catch (puppeteerErr) {
        console.error('Puppeteer failed:', puppeteerErr.message);
        // Fall back to axios
      }
    }
    
    // Fallback: try axios
    try {
      const resp = await axios.get(decodedUrl, { 
        timeout: 10000,
        validateStatus: () => true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
        }
      });
      
      // Set permissive headers
      res.setHeader('X-Frame-Options', 'ALLOWALL');
      res.setHeader('Content-Security-Policy', '');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', resp.headers['content-type'] || 'text/html; charset=utf-8');
      
      // Get content
      let content = resp.data;
      
      // If HTML, strip restrictive tags
      if (typeof content === 'string') {
        content = content.replace(/<meta[^>]*http-equiv="X-Frame-Options"[^>]*>/gi, '');
        content = content.replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');
      }
      
      res.send(content);
    } catch (axiosErr) {
      console.error('Axios fallback failed:', axiosErr.message);
      res.redirect(decodedUrl);
    }
  } catch (err) {
    console.error('Frame proxy error:', err.message || err);
    res.status(500).json({ success: false, message: 'Failed to proxy resource' });
  }
});

module.exports = router;
