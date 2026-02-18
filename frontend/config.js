// ============================================================
//  Bill Splitter ZAR – Configuration
//  Edit this file to match your deployment environment.
// ============================================================

window.CONFIG = {
  // When running via Docker + nginx, nginx proxies /webhook/ to n8n.
  // Set N8N_URL to empty string ('') to use the same origin (recommended).
  // For direct n8n access without nginx: 'http://your-server-ip:5678'
  N8N_URL: '',

  // Google OAuth Client ID
  // Create at https://console.cloud.google.com/ → APIs & Services → Credentials
  GOOGLE_CLIENT_ID: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',

  // Google Cloud Vision API key (used server-side in n8n for OCR)
  // This key is sent to the n8n upload-receipt webhook, NOT stored in the browser.
  // n8n uses it to call the Vision API. Keep it server-side in production.
  GOOGLE_VISION_API_KEY: 'YOUR_GOOGLE_VISION_API_KEY',

  // Polling interval in milliseconds (2-3 seconds recommended)
  POLL_INTERVAL_MS: 2500
};
