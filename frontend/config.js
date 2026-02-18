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

  // Polling interval in milliseconds (2-3 seconds recommended)
  POLL_INTERVAL_MS: 2500
};
