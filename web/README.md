# JTL Analytics Web

Next.js management and reporting UI for the tenant-scoped JTL Analytics platform.

## Local development

```bash
npm ci
npm run dev
```

The application is served under `/jtl-app`. Set `NEXT_PUBLIC_API_URL=/api` and
use the repository Docker Compose proxy for the normal local stack.

## Verification

```bash
npm run test:run
npm run build
```

Inventory screens use server-side pagination and the canonical stock contract:

- `totalStock`: JTL “Bestand alle Lager”, used for visible stock.
- `availableStock`: stock remaining after reservations.
- `reservedStock`: reserved quantity.

Compatibility aliases remain in API transforms while older components are
migrated.

## Production

Build immutable images through GitHub Actions. Enable HSTS only when the public
endpoint is HTTPS by setting `PUBLIC_HTTPS=true`.
