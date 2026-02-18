#!/usr/bin/env bash
# ============================================================
#  Bill Splitter ZAR – Setup Script
#  Tested on Rocky Linux 8 / RHEL 8
# ============================================================
set -euo pipefail

# ── Colours ─────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── Config (edit these) ──────────────────────────────────────
DB_NAME="${DB_NAME:-bill_splitter}"
DB_USER="${DB_USER:-bill_splitter}"
DB_PASS="${DB_PASS:-changeme_secure_password}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"

NGINX_SERVE_DIR="${NGINX_SERVE_DIR:-/var/www/bill-splitter}"
N8N_PORT="${N8N_PORT:-5678}"

echo ""
echo "============================================================"
echo " Bill Splitter ZAR – Setup"
echo "============================================================"
echo ""

# ── 1. PostgreSQL database ───────────────────────────────────
echo "Setting up PostgreSQL database…"

if ! command -v psql &>/dev/null; then
  warn "psql not found. Installing postgresql…"
  sudo dnf install -y postgresql-server postgresql-contrib
  sudo postgresql-setup --initdb
  sudo systemctl enable --now postgresql
fi

# Create user and database
sudo -u postgres psql <<SQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${DB_USER}') THEN
      CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
    END IF;
  END
  \$\$;
  SELECT 'Database exists' WHERE EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')
  UNION ALL
  SELECT format('CREATE DATABASE %I OWNER %I', '${DB_NAME}', '${DB_USER}')
   WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}');
SQL

# Actually create the DB (ignore if exists)
sudo -u postgres createdb --owner="${DB_USER}" "${DB_NAME}" 2>/dev/null || true

# Run schema
PGPASSWORD="${DB_PASS}" psql -h "${DB_HOST}" -p "${DB_PORT}" \
  -U "${DB_USER}" -d "${DB_NAME}" \
  -f "$(dirname "$0")/database/schema.sql"

ok "Database '${DB_NAME}' ready."

# ── 2. n8n ───────────────────────────────────────────────────
echo ""
echo "Checking n8n…"

if ! command -v n8n &>/dev/null; then
  warn "n8n not found. Installing via npm…"
  if ! command -v node &>/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
    sudo dnf install -y nodejs
  fi
  sudo npm install -g n8n
fi

ok "n8n is installed. Version: $(n8n --version 2>/dev/null || echo 'unknown')"

# Create n8n systemd service
N8N_ENV_FILE="/etc/n8n.env"
if [[ ! -f "${N8N_ENV_FILE}" ]]; then
  sudo tee "${N8N_ENV_FILE}" >/dev/null <<ENV
DB_TYPE=postgresdb
DB_POSTGRESDB_HOST=${DB_HOST}
DB_POSTGRESDB_PORT=${DB_PORT}
DB_POSTGRESDB_DATABASE=${DB_NAME}
DB_POSTGRESDB_USER=${DB_USER}
DB_POSTGRESDB_PASSWORD=${DB_PASS}
N8N_PORT=${N8N_PORT}
N8N_HOST=0.0.0.0
N8N_PROTOCOL=http
WEBHOOK_URL=http://YOUR_SERVER_IP:${N8N_PORT}/
N8N_ENCRYPTION_KEY=$(openssl rand -hex 32)
ENV
  ok "Created ${N8N_ENV_FILE} – edit WEBHOOK_URL before starting n8n."
fi

sudo tee /etc/systemd/system/n8n.service >/dev/null <<UNIT
[Unit]
Description=n8n workflow automation
After=network.target postgresql.service

[Service]
Type=simple
User=n8n
EnvironmentFile=/etc/n8n.env
ExecStart=/usr/bin/n8n start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

id -u n8n &>/dev/null || sudo useradd --system --no-create-home n8n
sudo mkdir -p /home/n8n/.n8n
sudo chown -R n8n:n8n /home/n8n

sudo systemctl daemon-reload
sudo systemctl enable n8n

ok "n8n service configured. Start with: sudo systemctl start n8n"

# ── 3. Import n8n Workflows ──────────────────────────────────
echo ""
echo "To import n8n workflows:"
echo "  1. Start n8n: sudo systemctl start n8n"
echo "  2. Open http://YOUR_SERVER_IP:${N8N_PORT}/"
echo "  3. Go to Workflows → Import"
echo "  4. Import each file from ./n8n-workflows/ one by one"
echo "  5. Set up a 'Bill Splitter Postgres' credential in n8n"
echo "     (Settings → Credentials → New → PostgreSQL)"
echo "  6. Activate all workflows"

# ── 4. Frontend / nginx ──────────────────────────────────────
echo ""
echo "Setting up nginx for the frontend…"

if ! command -v nginx &>/dev/null; then
  sudo dnf install -y nginx
  sudo systemctl enable nginx
fi

sudo mkdir -p "${NGINX_SERVE_DIR}"
sudo cp -r "$(dirname "$0")/frontend/"* "${NGINX_SERVE_DIR}/"
sudo chown -R nginx:nginx "${NGINX_SERVE_DIR}"

NGINX_CONF="/etc/nginx/conf.d/bill-splitter.conf"
sudo tee "${NGINX_CONF}" >/dev/null <<NGINX
server {
    listen 80;
    server_name _;

    root ${NGINX_SERVE_DIR};
    index index.html;

    # PWA – always serve index.html for unknown routes
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Proxy n8n webhooks (avoids CORS from browser)
    location /webhook/ {
        proxy_pass         http://localhost:${N8N_PORT}/webhook/;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }

    # Security headers
    add_header X-Frame-Options       DENY;
    add_header X-Content-Type-Options nosniff;
    add_header Referrer-Policy       strict-origin-when-cross-origin;
}
NGINX

sudo nginx -t && sudo systemctl restart nginx
ok "nginx configured. Frontend available on port 80."

# ── 5. Firewall ──────────────────────────────────────────────
if command -v firewall-cmd &>/dev/null; then
  sudo firewall-cmd --permanent --add-service=http  2>/dev/null || true
  sudo firewall-cmd --permanent --add-service=https 2>/dev/null || true
  sudo firewall-cmd --permanent --add-port="${N8N_PORT}/tcp" 2>/dev/null || true
  sudo firewall-cmd --reload 2>/dev/null || true
  ok "Firewall rules updated."
fi

echo ""
echo "============================================================"
echo " Setup complete! Next steps:"
echo "============================================================"
echo ""
echo " 1. Edit /etc/n8n.env – set WEBHOOK_URL to your server's IP"
echo " 2. Edit frontend/config.js – set N8N_URL, GOOGLE_CLIENT_ID,"
echo "    and GOOGLE_VISION_API_KEY, then re-copy to ${NGINX_SERVE_DIR}"
echo " 3. sudo systemctl start n8n"
echo " 4. Import all 10 workflows from ./n8n-workflows/ into n8n"
echo " 5. In n8n, create a PostgreSQL credential named:"
echo "    'Bill Splitter Postgres'"
echo " 6. Activate all workflows in n8n"
echo " 7. Visit http://YOUR_SERVER_IP/ in your browser"
echo ""
