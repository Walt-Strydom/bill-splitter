// ============================================================
//  Bill Splitter ZAR – Configuration
//  Edit this file to match your deployment environment.
// ============================================================

window.CONFIG = {
  // Base URL of your n8n instance (no trailing slash)
  // Example: 'http://your-server-ip:5678'
  N8N_URL: 'http://localhost:5678',

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
