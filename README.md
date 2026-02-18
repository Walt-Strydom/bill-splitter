# Bill Splitter ZAR

A mobile-first Progressive Web App for splitting restaurant bills in ZAR from a receipt photo.

## Architecture

```
Internet (HTTPS)
     │
     ▼
Cloudflare (TLS termination + CDN)
     │  HTTP on port 80
     ▼
nginx container  ──→  /webhook/*  ──→  n8n container (port 5678)
     │                                        │
     ▼                                        ▼
frontend PWA                         PostgreSQL container
(static files)
```

| Layer      | Technology          | Purpose                               |
|------------|---------------------|---------------------------------------|
| Proxy/CDN  | Cloudflare          | TLS, DDoS protection, caching         |
| Web server | nginx 1.25          | Serve PWA, proxy /webhook/ to n8n     |
| Backend    | n8n 2.9.0           | Business logic, OCR, auth workflows   |
| Database   | PostgreSQL 16       | All party, item, selection & closure data |
| OCR        | Google Vision API   | Receipt text extraction               |
| Auth       | Google OAuth 2.0    | Optional persistent user accounts     |
| Runtime    | Docker Compose      | All services in one stack             |

## File Structure

```
bill-splitter/
├── Project.md
├── README.md
├── docker-compose.yml              # Full stack: postgres + n8n + nginx
├── .env.example                    # Copy to .env and fill in values
├── .gitignore
├── setup.sh                        # Alternative: bare-metal Rocky Linux 8 setup
├── nginx/
│   └── default.conf                # nginx: PWA serve + /webhook/ proxy + Cloudflare IPs
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

## Docker Deployment (Recommended)

### Prerequisites
- Docker + Docker Compose installed on your Rocky Linux 8 server
- A domain pointed to your server in Cloudflare (orange-cloud enabled)
- Google Cloud project with Vision API and OAuth credentials

### Steps

```bash
# 1. Clone the repo
git clone <repo> /opt/bill-splitter
cd /opt/bill-splitter

# 2. Create your environment file
cp .env.example .env
nano .env
# Fill in: POSTGRES_PASSWORD, WEBHOOK_URL (your https domain),
#           N8N_ENCRYPTION_KEY (run: openssl rand -hex 32)

# 3. Edit frontend config
nano frontend/config.js
# Set: GOOGLE_CLIENT_ID, GOOGLE_VISION_API_KEY
# Leave N8N_URL as '' (empty) – nginx proxies /webhook/ to n8n

# 4. Start all containers
docker compose up -d

# 5. Check everything is running
docker compose ps
docker compose logs -f

# 6. Import n8n workflows
#    Open http://YOUR_SERVER_IP:5678/ (direct, not via Cloudflare)
#    a. Complete n8n setup wizard
#    b. Credentials → New → PostgreSQL → name it "Bill Splitter Postgres"
#       Host: postgres  Port: 5432  DB/User/Pass: from your .env
#    c. Workflows → Import → upload each file in n8n-workflows/ (01–10)
#    d. Activate all 10 workflows

# 7. Visit your domain → https://YOUR_DOMAIN/
```

### Cloudflare Setup
1. Add your domain to Cloudflare with the DNS A record pointing to your server IP
2. Set the proxy status to **Proxied** (orange cloud) — this gives you HTTPS
3. In Cloudflare SSL/TLS settings, set mode to **Flexible** (Cloudflare → nginx is HTTP)
4. Optional: add a Page Rule to cache static assets (`*.js`, `*.css`)

### Alternative: Bare-metal Rocky Linux 8

```bash
chmod +x setup.sh
./setup.sh
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
