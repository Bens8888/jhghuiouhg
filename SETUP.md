# Plug & Play — Order Tracking System
## Complete Setup & Installation Guide

---

## Quick Start (5 Minutes)

### Prerequisites
- Node.js 18+ installed
- A Shopify store (or use demo mode without one)
- A server or hosting (Railway, Render, DigitalOcean, VPS, etc.)

---

## 1. Installation

```bash
# Navigate to the project directory
cd plug-and-play-tracker

# Install dependencies
npm install

# Copy environment file
cp .env.example .env
```

Open `.env` and fill in your values (see Section 3 for details).

---

## 2. First Run

```bash
# Start the server
npm start

# Or for development with auto-reload
npm run dev
```

Open http://localhost:3000 — you'll see the tracking homepage.
Open http://localhost:3000/admin — admin panel login.

---

## 3. Environment Variables (.env)

### Required Settings

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `ADMIN_USERNAME` | Admin login username | `admin` |
| `ADMIN_PASSWORD` | Admin login password | `MySecurePass123!` |
| `JWT_SECRET` | Secret key (min 32 chars) | `a-very-long-random-string-here-123` |

### Shopify API Settings

1. **Log into your Shopify admin** → Settings → Apps → Develop apps
2. Create a new app called "Order Tracker"
3. Under **API credentials**, configure Admin API access with these scopes:
   - `read_orders`
   - `write_orders` (for adding notes/tags)
4. Install the app and copy the **Admin API access token**

| Variable | Value |
|----------|-------|
| `SHOPIFY_SHOP_DOMAIN` | `your-store.myshopify.com` |
| `SHOPIFY_ACCESS_TOKEN` | `shpat_xxxxxxxxxxxx` |
| `SHOPIFY_API_VERSION` | `2024-01` |
| `SHOPIFY_WEBHOOK_SECRET` | (set after creating webhooks) |

### Demo Mode (No Shopify)
Set `DEMO_MODE=true` in `.env` to use fake order data for testing.

### Google Maps (Optional)
1. Go to console.cloud.google.com
2. Enable **Maps Embed API**
3. Create an API key with HTTP referrer restrictions
4. Set `GOOGLE_MAPS_API_KEY=your_key`
5. Add to `public/tracking.html`: `<script>window.GOOGLE_MAPS_KEY = "YOUR_KEY";</script>`

---

## 4. Shopify Integration

### Option A: Custom App (Recommended — Full Features)

Your tracker runs as a **separate web app** that Shopify links to. This is the simplest and most powerful approach.

**Setup:**
1. Deploy this app to your server (see Section 5)
2. In your Shopify admin → Online Store → Themes → Customize
3. Add a link/button to `https://your-tracker-domain.com/?order={{ order.name }}&email={{ customer.email }}`

**Or add to Order Confirmation Email:**
```html
<a href="https://your-tracker-domain.com/?order={{ order.name }}&email={{ customer.email }}"
   style="background:#6366f1;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">
  Track My Order
</a>
```

### Option B: Shopify Theme Integration

Add to your Shopify theme's `layout/theme.liquid` or create a new page template:

```liquid
{% if page.handle == 'track-order' %}
  <script>
    // Auto-fill from URL params if customer is logged in
    window.shopifyCustomer = {
      email: "{{ customer.email }}",
      orderId: "{{ order.name }}"
    };
  </script>
  <iframe
    src="https://your-tracker-domain.com/?embedded=true"
    style="width:100%;min-height:800px;border:none"
    id="pnp-tracker">
  </iframe>
{% endif %}
```

### Option C: Shopify App (Advanced)

For full Shopify App Bridge integration, you'll need:
- Shopify Partner account
- OAuth setup
- See `/shopify/app-bridge-guide.md` (advanced)

---

## 5. Shopify Webhooks Setup

Webhooks allow real-time order updates (instant stage changes when orders ship).

**In Shopify Admin → Settings → Notifications → Webhooks:**

| Event | URL |
|-------|-----|
| Order creation | `https://your-domain.com/webhooks/order-created` |
| Order updated | `https://your-domain.com/webhooks/order-updated` |
| Order fulfilled | `https://your-domain.com/webhooks/order-fulfilled` |

**Get Webhook Secret:**
1. Create a webhook in Shopify
2. Copy the "Signing secret"
3. Set `SHOPIFY_WEBHOOK_SECRET=your_secret` in `.env`

---

## 6. Deployment

### Railway (Easiest — Free Tier Available)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

Set all your `.env` variables in Railway dashboard → Variables.

### Render.com

1. Connect your GitHub repo
2. Create a new Web Service
3. Build command: `npm install`
4. Start command: `npm start`
5. Add all environment variables

### DigitalOcean / VPS

```bash
# On your server
git clone your-repo
cd plug-and-play-tracker
npm install
cp .env.example .env
# Edit .env with your values
nano .env

# Install PM2 for process management
npm install -g pm2
pm2 start server.js --name pnp-tracker
pm2 startup
pm2 save

# Nginx config (optional - for port 80/443)
# Point your domain to the server, then:
# Set up SSL with: certbot --nginx -d your-domain.com
```

### Nginx Config Example

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 7. Admin Panel

**URL:** `https://your-domain.com/admin`
**Default login:** Set in `.env` (ADMIN_USERNAME / ADMIN_PASSWORD)

### Admin Features

| Feature | How to Use |
|---------|------------|
| **Production stats** | Admin → Production → Adjust numbers |
| **Global delay** | Admin → Production → Slide delay slider |
| **Override order stage** | Admin → Orders → Search order → Set stage 1-7 |
| **Close ticket instantly** | Admin → Tickets → Open ticket → "Close as Resolved" |
| **Add activity** | Admin → Activity Feed → Post new message |
| **View angry customers** | Admin → Dashboard → "Frequent Checkers" section |

---

## 8. Configuring Production Simulation

### Fake Activity Feed Numbers

In Admin Panel → Production Controls:
- **Orders Produced Today**: Set the base number (e.g., 173). The system auto-increments this hourly.
- **Orders Shipped This Week**: Display number for the stats row
- **Orders In Queue**: Shown in the queue section

### Realistic Spike Behavior

The system automatically:
- Adds 5–30 orders per hour during business hours (7am–10pm)
- Pauses overnight
- Posts new activity feed items every hour

### Confidence Score

- Default: 87%
- Varies ±5% based on time of day (higher during business hours)
- Set base score in Admin → Production Controls

### Global Delay

- Drag slider in Admin → Production Controls → "Global Production Delay"
- 0-10 days added to ALL estimated ship dates
- Use when experiencing genuine delays — customers see updated estimates automatically

---

## 9. Customization

### Logo

Replace the SVG logo in `public/index.html`, `public/tracking.html`, and `public/help.html`.

Or add an `<img>` tag:
```html
<img src="/images/logo.png" alt="Plug & Play" height="44" />
```

### Colors

Edit CSS variables in `public/css/styles.css`:
```css
:root {
  --accent: #6366f1;    /* Main purple */
  --accent-2: #06b6d4;  /* Cyan accent */
  --green: #22c55e;     /* Success/complete */
}
```

### FAQ Content

Edit `routes/api.js` → the `/faq` route. Update the 5 FAQ objects.

### WhatsApp Number

Update `WHATSAPP_NUMBER` in `.env`.

### Production Stage Durations

Edit `services/shopify.js` → `calculateProductionStage()` function.
Adjust the `orderAge` thresholds (in hours) to match your actual timelines.

---

## 10. Security Checklist

- [ ] Change `ADMIN_PASSWORD` to a strong password
- [ ] Set `JWT_SECRET` to 32+ random characters
- [ ] Restrict `SHOPIFY_ACCESS_TOKEN` permissions to minimum required
- [ ] Set `ALLOWED_ORIGINS` in `.env` to your domain
- [ ] Enable HTTPS (SSL) in production
- [ ] Set `NODE_ENV=production`
- [ ] Add rate limiting (already configured in `server.js`)
- [ ] Restrict `/uploads` directory in Nginx to image/video types only

---

## 11. Testing Without Shopify

1. Set `DEMO_MODE=true` in `.env`
2. Go to homepage
3. Enter any order number (e.g., `#1001`) and any email
4. You'll see a demo tracking page with simulated data

---

## 12. File Structure

```
plug-and-play-tracker/
├── server.js              # Main Express server + cron jobs
├── package.json
├── .env.example           # Copy to .env
├── database/
│   └── db.js              # SQLite database + schema
├── routes/
│   ├── api.js             # Public API (track, ticket, faq, stats)
│   ├── admin.js           # Admin API (auth-protected)
│   └── webhook.js         # Shopify webhook handlers
├── services/
│   └── shopify.js         # Shopify API integration + formatters
├── middleware/
│   └── auth.js            # JWT admin authentication
├── public/
│   ├── index.html         # Homepage (order tracking input)
│   ├── tracking.html      # Tracking page (full details)
│   ├── help.html          # Help / support ticket page
│   ├── admin/
│   │   └── index.html     # Admin panel
│   ├── css/
│   │   ├── styles.css     # Shared base styles
│   │   ├── tracking.css   # Tracking page styles
│   │   ├── help.css       # Help page styles
│   │   └── admin.css      # Admin panel styles
│   └── js/
│       ├── main.js        # Shared utilities
│       ├── simulation.js  # Production simulation engine
│       ├── tracking.js    # Tracking page logic
│       ├── help.js        # Help system logic
│       └── admin.js       # Admin panel logic
├── data/                  # Auto-created — SQLite DB stored here
├── uploads/               # Auto-created — proof uploads stored here
└── SETUP.md               # This file
```

---

## 13. API Reference

### Public Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/track` | Track an order (requires order number + email/phone) |
| `POST` | `/api/ticket` | Create support ticket (multipart/form-data) |
| `GET` | `/api/ticket/:id` | Get ticket status by ID or reference number |
| `GET` | `/api/stats` | Get public production stats |
| `GET` | `/api/faq` | Get FAQ list |

### Admin Endpoints (Bearer token required)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/admin/api/login` | Login, returns JWT token |
| `GET` | `/admin/api/dashboard` | Dashboard stats + recent tickets |
| `GET` | `/admin/api/tickets` | List tickets (filterable) |
| `PATCH` | `/admin/api/tickets/:id` | Update ticket status/notes |
| `POST` | `/admin/api/tickets/:id/close` | Close ticket instantly |
| `GET` | `/admin/api/orders/:orderNum` | Get order details + cache |
| `PATCH` | `/admin/api/orders/:orderNum` | Override order production stage |
| `GET` | `/admin/api/production` | Get production stats |
| `PATCH` | `/admin/api/production` | Update production stats + delay |
| `GET` | `/admin/api/behavior` | Customer behavior analytics |
| `GET` | `/admin/api/activity` | Get activity feed |
| `POST` | `/admin/api/activity` | Post new activity item |

### Webhook Endpoints

| Method | Path | Shopify Event |
|--------|------|---------------|
| `POST` | `/webhooks/order-created` | `orders/create` |
| `POST` | `/webhooks/order-updated` | `orders/updated` |
| `POST` | `/webhooks/order-fulfilled` | `orders/fulfilled` |

---

## 14. Troubleshooting

**"Order not found" error**
- Verify the Shopify API token has `read_orders` permission
- Check order number format (the system accepts `1001` or `#1001`)
- Ensure customer email matches exactly (case-insensitive comparison is applied)
- Enable `DEMO_MODE=true` to test without Shopify

**Admin panel shows blank**
- Open browser console for errors
- Check JWT_SECRET is set in `.env`
- Try clearing localStorage and logging in again

**Tracking number not showing**
- Shopify only provides tracking info after fulfillment
- The order must have a fulfillment with tracking added in Shopify admin

**Uploads failing**
- Check `UPLOAD_DIR` path exists and is writable
- Verify `MAX_FILE_SIZE` is not too low (default 10MB)

**Webhook not firing**
- Verify webhook URL is publicly accessible (not localhost)
- Check `SHOPIFY_WEBHOOK_SECRET` matches the secret in Shopify admin
- View webhook delivery logs in Shopify admin → Settings → Notifications → Webhooks
