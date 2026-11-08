# Contact-form email setup (Resend + Vercel)

Endpoint: `POST /api/contact` → Resend → `ABHILASH.20241CSE0600@presidencyuniversity.in`.
All three variables below are **required** and read server-side only.

## 1. Verify a sending domain in Resend (one-time, ~10 min)

`onboarding@resend.dev` is **test-only**: Resend delivers it only to your own
Resend account email (yours: `abhilashg869@gmail.com`) and returns 403 for
any other recipient such as your Presidency University address. That restriction
is why production delivery needs your own verified domain.

1. Go to https://resend.com/domains → **Add Domain** → enter your domain.
2. Add the DNS records shown (SPF/DKIM) at your DNS host.
3. Wait until it shows **Verified**.
4. Create a key at Resend → **API Keys** (copy the `re_...` value once).

## 2. Enter the variables in Vercel (exact location)

- Open your Vercel **Dashboard** → project **abhilash-r** (the one behind
  https://abhilash-r.vercel.app/).
- Click **Settings** (top tab) → **Environment Variables** (left sidebar).
- For each variable, click **Add Variable**, type name + value, check all
  three scopes (**Production, Preview, Development**), click **Save**:

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | `re_...` from step 1 |
| `CONTACT_EMAIL` | `ABHILASH.20241CSE0600@presidencyuniversity.in` |
| `RESEND_FROM` | `Abhilash <hello@yourdomain.com>` (verified domain from step 1) |

- Changing variables does **not** redeploy automatically. Click
  **Deployments** → `···` on the latest deployment → **Redeploy**.

> Do not add these to `index.html` or any frontend file, and never prefix them
> with `VITE_`. Never commit a real key. `.env.example` is values-free on purpose.

## 3. Verify it worked

1. Submit the live form once with a real message.
2. Check **Resend → Emails**: an entry with status **Accepted** + an email ID
   means Resend accepted it; delivery to the inbox follows after (see below).
3. Check the Presidency inbox (watch spam/promotions on first send).
4. If the form shows a configuration error instead, open **Vercel → Logs**
   and find the `[contact] ...` line (masked recipient, sender domain only —
   no key or message body is logged).

Note: **API acceptance ≠ inbox delivery.** Resend logs prove acceptance and
give you the email ID + delivery events to track (sent/delivered/bounced).

## 4. Behaviour (unchanged UI)

- Loading state + disabled button/inputs while sending; resubmits within
  60 s of the same message are suppressed as duplicates.
- Success shown **only** when Resend returns an email ID; fields reset only then.
- On failure, your text stays in the form and a plain-language error is shown.
- Server checks: POST-only, field/email validation, honeypot, 5/min/IP limit,
  missing/unverified-sender → clear configuration errors (no fake success).
