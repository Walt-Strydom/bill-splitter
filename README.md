# Bill Splitter ZAR

A mobile-first Progressive Web App for splitting restaurant bills in ZAR from a receipt photo.

## Architecture

| Layer     | Technology          | Purpose                              |
|-----------|---------------------|--------------------------------------|
| Frontend  | Vanilla JS PWA      | Mobile web app, offline-capable      |
| Backend   | n8n 2.9.0 webhooks  | Business logic, OCR, auth            |
| Database  | PostgreSQL 13+      | All party, item, selection & closure data |
| OCR       | Google Vision API   | Receipt text extraction              |
| Auth      | Google OAuth 2.0    | Optional persistent user accounts    |

## File Structure

```
bill-splitter/
├── Project.md
├── README.md
├── setup.sh                        # One-shot setup for Rocky Linux 8
├── database/
│   └── schema.sql                  # Full PostgreSQL schema + views + indexes
├── n8n-workflows/
│   ├── 01-google-login.json        # Verify Google ID token, upsert user
│   ├── 02-create-party.json        # Generate party code, insert host
│   ├── 03-join-party.json          # Validate code, create guest
│   ├── 04-upload-receipt.json      # OCR receipt → parse items
│   ├── 05-party-validation.json    # Poll endpoint: items/guests/totals
│   ├── 06-save-selections.json     # Upsert guest item claims
│   ├── 07-save-payment.json        # Record payment, validate amount
│   ├── 08-close-guest.json         # Lock guest tab, update analytics
│   ├── 09-close-party.json         # Lock entire party (host only)
│   └── 10-analytics.json           # User billing history & top lists
└── frontend/
    ├── index.html                  # Single-page app shell
    ├── styles.css                  # Mobile-first dark theme
    ├── app.js                      # All SPA logic (no framework)
    ├── config.js                   # Server URLs & API keys (edit me)
    ├── manifest.json               # PWA manifest
    └── sw.js                       # Service worker (offline shell)
```

## Quick Setup (Rocky Linux 8)

```bash
# Clone / copy the project to your server
git clone <repo> /opt/bill-splitter
cd /opt/bill-splitter

# Edit config before running
nano setup.sh          # set DB_PASS, DB_NAME, NGINX_SERVE_DIR
nano frontend/config.js # set N8N_URL, GOOGLE_CLIENT_ID, GOOGLE_VISION_API_KEY

# Run setup (creates DB, configures nginx, installs n8n service)
chmod +x setup.sh
./setup.sh

# Edit n8n environment (set WEBHOOK_URL to your server's public IP)
sudo nano /etc/n8n.env
sudo systemctl start n8n

# Import workflows (via n8n UI)
# Open http://YOUR_SERVER_IP:5678/
# Workflows → Import → upload each file in n8n-workflows/ one by one
# Create a PostgreSQL credential named "Bill Splitter Postgres"
# Activate all 10 workflows
```

## Required External Services

### 1. Google OAuth (for user accounts)
- Go to [Google Cloud Console](https://console.cloud.google.com/)
- APIs & Services → Credentials → Create OAuth 2.0 Client ID
- Application type: **Web application**
- Add your domain to Authorised JavaScript origins
- Copy the Client ID into `frontend/config.js`

### 2. Google Cloud Vision API (for receipt OCR)
- Enable the **Cloud Vision API** in Google Cloud Console
- APIs & Services → Credentials → Create API Key
- Copy the key into `frontend/config.js` (`GOOGLE_VISION_API_KEY`)
- The key is sent to the n8n server and used server-side only

### 3. n8n PostgreSQL Credential
In the n8n UI, create a credential:
- **Type:** PostgreSQL
- **Name:** `Bill Splitter Postgres` (must match exactly)
- **Host:** localhost (or your DB host)
- **Database:** bill_splitter
- **User / Password:** as configured in `setup.sh`

## n8n Webhook Endpoints

All endpoints are available at `http://YOUR_N8N_HOST:5678/webhook/<path>`

| Method | Path             | Description                           |
|--------|------------------|---------------------------------------|
| POST   | google-login     | Verify Google ID token, return user   |
| POST   | create-party     | Create party + host guest             |
| POST   | join-party       | Join existing party                   |
| POST   | upload-receipt   | OCR receipt image, populate items     |
| GET    | party-validate   | Poll party state (items/guests/totals)|
| POST   | save-selections  | Upsert guest's item quantity claims   |
| POST   | save-payment     | Record payment amount                 |
| POST   | close-guest      | Close guest tab (locks selections)    |
| POST   | close-party      | Close party (host only)               |
| GET    | analytics        | User billing history & top lists      |

## Business Rules (enforced server-side)

- Prices come **only** from OCR receipt — guests cannot modify them
- Every item must be fully claimed before payment is enabled
- `Σ(claimed quantities) = item.total_quantity` for every item
- `Σ(all guest subtotals) = party subtotal` before any payment is allowed
- Guest payment must be `≥ guest_total_due` (no underpayment)
- Host cannot close party until **all** guests have closed their tab
- Once a guest closes, their selections and payment are locked

## Tip Calculation

```
party_tip_cents    = round(party_subtotal_cents × tip_percent / 100)
guest_tip_cents    = round((guest_subtotal / party_subtotal) × party_tip_cents)
guest_total_due    = guest_subtotal + guest_tip
```

## Party Code Format

6-character uppercase code using unambiguous alphanumeric characters
(`A-Z` excluding `I`, `O` + digits `2-9`). Example: `T9K3WP`

## Analytics (logged-in users only)

- **Billing history**: restaurant, amount paid, date — for all parties where user closed a tab
- **Top 5 restaurants**: by visit count (updated on guest close)
- **Top 5 people**: users they've shared bills with (by shared party count)

## Security Notes

- All validation is server-side (n8n + PostgreSQL)
- `join_token` is a cryptographically random 32-hex-char string — treat it like a session token
- Google ID tokens are verified server-side via `oauth2.googleapis.com/tokeninfo`
- The Vision API key is sent from the browser to n8n only — never stored in the database
- In production, place the Vision API key in n8n environment variables instead of passing it from the client

## Anonymous Users

Anonymous guests can join and split bills without creating an account.
They will not receive billing history or analytics.
