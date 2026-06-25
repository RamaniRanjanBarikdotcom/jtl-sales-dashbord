# Email System Plan

## Goals

- Send user invitation emails when an admin creates or resends an invite.
- Send temporary-password emails when an admin resets a password.
- Send inventory alert emails to company-level alert recipients.
- Keep local/dev safe: no email leaves the system unless `MAIL_ENABLED=true` and SMTP is configured.

## Configuration

Set these in `backend/.env` for Docker/dev or `backend/.env.production` for production:

```env
MAIL_ENABLED=true
MAIL_FROM="JTL Analytics <no-reply@example.com>"
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_STARTTLS=true
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
SMTP_HELO_NAME=example.com
```

Use `SMTP_SECURE=true` for implicit TLS providers on port `465`. Use `SMTP_STARTTLS=true` for port `587`.

## Implemented Flows

- `POST /api/admin/users` sends an invite email when a new user is created and a temporary password is generated.
- `POST /api/admin/users/:id/resend-invite` resets the password and sends the invite email template.
- `POST /api/admin/users/:id/reset-pwd` resets the password and sends a password-reset email template.
- `POST /api/inventory/alerts/email` sends current low/out-of-stock inventory alerts to Company Settings → Alert Recipients.

## Safety Rules

- Email failures are logged to audit events but do not block user creation or password reset.
- When email is disabled or missing SMTP config, the API returns/skips safely and still shows one-time passwords in the UI.
- Inventory alert emails require both `inventory.view` and `settings.manage` permissions.
