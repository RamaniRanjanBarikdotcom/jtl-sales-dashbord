# VPS Deployment Guide

Deploy the full JTL Analytics stack (dashboard + backend + sync engine support) on a VPS with a real domain and HTTPS.

---

## What you need before starting

- A VPS — [Hetzner CX22](https://hetzner.com) (~€4.5/month), Ubuntu 24.04
- A domain — e.g. `dashboard.yourcompany.de` (~€10/year at any registrar)
- Your GitHub repo with the code

---

## Step 1 — Point your domain to the VPS

1. Buy a VPS, note the **public IP** (e.g. `123.456.789.0`)
2. Go to your domain registrar DNS settings
3. Add an **A record**:
   ```
   Type: A
   Name: dashboard   (or @ for root domain)
   Value: 123.456.789.0
   TTL: 300
   ```
4. Wait 5–10 minutes for DNS to propagate
5. Verify: `ping dashboard.yourcompany.de` — should show your VPS IP

---

## Step 2 — Initial VPS setup

SSH into your VPS:
```bash
ssh root@123.456.789.0
```

Install Docker:
```bash
apt update && apt upgrade -y
apt install -y docker.io docker-compose-plugin git curl
systemctl enable docker
systemctl start docker
```

Create a non-root user (optional but recommended):
```bash
adduser jtl
usermod -aG docker jtl
su - jtl
```

---

## Step 3 — Upload your code to the VPS

**Option A — from GitHub (recommended):**
```bash
git clone https://github.com/RamaniRanjanBarikdotcom/jtl-sales-dashbord.git
cd jtl-sales-dashbord
```

**Option B — copy from your Mac:**
```bash
# Run this on your Mac, not the VPS
rsync -avz --exclude node_modules --exclude .git \
  "/Users/ramani/Documents/jtl sales dashbord/" \
  root@123.456.789.0:/opt/jtl-analytics/
```

---

## Step 4 — Create the production environment file

On the VPS, inside the project folder:
```bash
cp backend/.env.production.example backend/.env.production
nano backend/.env.production
```

Fill in real values — generate secrets with:
```bash
openssl rand -hex 64   # run twice, use one for JWT_ACCESS_SECRET, one for JWT_REFRESH_SECRET
```

Also create the root `.env` file (used by docker-compose.prod.yml):
```bash
cat > .env << EOF
PG_PASSWORD=same_password_as_in_env_production
REDIS_PASSWORD=same_redis_password_as_in_env_production
EOF
```

---

## Step 5 — Get the SSL certificate (Let's Encrypt)

### 5a — Start Apache with HTTP only first

Edit `apache/httpd.prod.conf` — make sure the HTTPS virtual host block is still **commented out** (it is by default). Then start just Apache:

```bash
docker compose -f docker-compose.prod.yml up -d apache
```

Check Apache is running:
```bash
curl http://dashboard.yourcompany.de
# Should return a redirect or 301 response
```

### 5b — Run certbot to get the certificate

Replace `YOUR_DOMAIN` and `YOUR_EMAIL` with real values:
```bash
docker compose -f docker-compose.prod.yml run --rm certbot \
  certonly --webroot \
  --webroot-path /var/www/certbot \
  --email YOUR_EMAIL \
  --agree-tos \
  --no-eff-email \
  -d YOUR_DOMAIN
```

You should see: `Successfully received certificate.`

### 5c — Enable HTTPS in Apache config

Edit `apache/httpd.prod.conf`:
```bash
nano apache/httpd.prod.conf
```

Replace `YOUR_DOMAIN` with your actual domain, then **uncomment the HTTPS virtual host block** (remove the `#` from every line inside the HTTPS section).

Reload Apache:
```bash
docker compose -f docker-compose.prod.yml restart apache
```

Test HTTPS works:
```bash
curl https://YOUR_DOMAIN/api/health -H "x-api-version: 1"
# Should return {"status":"ok",...}
```

---

## Step 6 — Start the full stack

```bash
docker compose -f docker-compose.prod.yml up -d
```

Check everything is running:
```bash
docker compose -f docker-compose.prod.yml ps
```

Expected output — all services should show `Up` or `healthy`:
```
NAME                    STATUS
jtl-nestjs-api-1        Up (healthy)
jtl-nextjs-frontend-1   Up
jtl-postgres-1          Up (healthy)
jtl-redis-1             Up (healthy)
jtl-apache-1            Up
jtl-certbot-1           Up
```

---

## Step 7 — Create your admin user

Run this once to create your login account:
```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U jtl_api -d jtl_analytics -c "
    INSERT INTO tenants (id, name, is_active) 
    VALUES ('4cb66e11-a89a-497a-afb5-46e44f7a4525', 'My Company', true)
    ON CONFLICT (id) DO NOTHING;
  "
```

Then generate a bcrypt password hash and insert the user:
```bash
# Generate hash for your password (change 'yourpassword' to your actual password)
docker compose -f docker-compose.prod.yml exec nestjs-api \
  node -e "const b=require('bcrypt'); b.hash('yourpassword',10).then(h=>console.log(h));"

# Copy the hash output, then insert user (replace HASH and your email):
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U jtl_api -d jtl_analytics -c "
    INSERT INTO users (email, password_hash, role, tenant_id, is_active)
    VALUES ('you@yourcompany.de', 'HASH_FROM_ABOVE', 'super_admin', '4cb66e11-a89a-497a-afb5-46e44f7a4525', true)
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash;
  "
```

---

## Step 8 — Configure the Sync Engine (Windows)

Open JTL Sync Engine settings and set:

| Field | Value |
|-------|-------|
| Backend URL | `https://YOUR_DOMAIN` |
| Tenant ID | `4cb66e11-a89a-497a-afb5-46e44f7a4525` |
| API Key | *(same key as before, or generate a new one — see below)* |

To generate a new API key on the VPS:
```bash
# Generate key
KEY=$(openssl rand -hex 32)
echo "Your API key: $KEY"

# Generate bcrypt hash
HASH=$(docker compose -f docker-compose.prod.yml exec nestjs-api \
  node -e "const b=require('bcrypt'); b.hash('$KEY',10).then(h=>process.stdout.write(h));")

# Store in database
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U jtl_api -d jtl_analytics -c "
    INSERT INTO tenant_connections (tenant_id, sync_api_key_hash, sync_api_key_prefix, is_active)
    VALUES ('4cb66e11-a89a-497a-afb5-46e44f7a4525', '$HASH', '${KEY:0:8}', true)
    ON CONFLICT (tenant_id) DO UPDATE 
      SET sync_api_key_hash = EXCLUDED.sync_api_key_hash,
          sync_api_key_prefix = EXCLUDED.sync_api_key_prefix;
  "
```

Click **Test API** in the sync engine — should show **API connected**.

---

## Step 9 — Open the dashboard

Go to `https://YOUR_DOMAIN` in your browser and log in.

---

## Useful commands on the VPS

```bash
# View logs
docker compose -f docker-compose.prod.yml logs -f nestjs-api
docker compose -f docker-compose.prod.yml logs -f apache

# Restart a service
docker compose -f docker-compose.prod.yml restart nestjs-api

# Stop everything
docker compose -f docker-compose.prod.yml down

# Update to latest code
git pull
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d

# Check SSL certificate expiry
docker compose -f docker-compose.prod.yml run --rm certbot certificates
```

---

## How it all connects

```
Browser / Sync Engine
        │
        ▼  HTTPS port 443
  https://YOUR_DOMAIN
        │
        ▼
      apache
        │
   ┌────┴────┐
   │         │
 /api/*    /*
   │         │
nestjs    nextjs
  api    frontend
   │
postgres + redis
```

- Dashboard: `https://YOUR_DOMAIN`
- Sync engine backend URL: `https://YOUR_DOMAIN`
- SSL renews automatically every 90 days via certbot

---

## Firewall (important)

On the VPS, only open ports 80 and 443:
```bash
ufw allow 22    # SSH
ufw allow 80    # HTTP (redirects to HTTPS)
ufw allow 443   # HTTPS
ufw enable
```

All other ports (3000, 3001, 5432, 6379) stay closed — only reachable inside Docker.
