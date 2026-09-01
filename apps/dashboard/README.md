# Depowar Dashboard

The dashboard is the developer control center for project settings, API keys,
recipient destinations, and settlement analytics.

```bash
VITE_API_URL=http://localhost:4000 \
VITE_API_KEY=your_management_key \
pnpm --filter @paymesh/dashboard dev
```

Open `http://localhost:5174`. The key must have the `management` scope. LI.FI
credentials are never entered into this app; they remain on the Depowar API.

`POST /v1/api-keys` returns a newly created integration key once. Store it in
the developer's server or application secret manager.
