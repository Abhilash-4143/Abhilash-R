# Contact-form email setup (Resend + Vercel)

The form POSTs to `api/contact.js`, which sends via Resend to
`ABHILASH.20241CSE0600@presidencyuniversity.in`.

## Critical: `onboarding@resend.dev` only reaches YOUR OWN email

Resend's shared test sender can deliver **only** to the email address of the
Resend account. Any other recipient returns HTTP 403:

> "You can only send testing emails to your own email address... verify a
> domain at resend.com/domains"

So with the default `RESEND_FROM=... <onboarding@resend.dev>` you will only
receive mail if `CONTACT_EMAIL` exactly matches your Resend account email.
Since your inbox is a Presidency University address, **verify a domain** —
this is the real fix, not a code change.

## Recommended one-time setup (verified domain, ~10 min)

1. In Resend Dashboard → **Domains** → **Add Domain** → enter your domain
   (e.g. a domain you own / a `.vercel.app`-style domain you control DNS for).
2. Add the DNS records shown (usually SPF/DKIM TXT records) at your DNS host.
3. Wait until the domain shows **Verified** in Resend.
4. Create a key at Resend → **API Keys** and copy it (starts with `re_`).
5. In Vercel → your project → **Settings → Environment Variables**, set:

   | Variable | Value |
   |---|---|
   | `RESEND_API_KEY` | `re_...` (from step 4) |
   | `CONTACT_EMAIL` | `ABHILASH.20241CSE0600@presidencyuniversity.in` |
   | `RESEND_FROM` | `Abhilash <hello@yourdomain.com>` (verified domain) |

6. Redeploy, then submit the form and check Resend → **Emails** for an
   accepted send (it shows the email ID).

Until step 2 is verified, keep the form honest: success is shown only when
Resend accepts the send, and the 403 hint above appears instead of fake success.

## Deploy (the code must be pushed!)

Vercel builds from GitHub `main`. The API only exists after the new files are
committed and pushed:

```bash
git add index.html startups.html api package.json package-lock.json .env.example CONTACT_SETUP.md .gitignore
git commit -m "Add Resend contact API + neumorphism design"
git push origin main
```

Then confirm the deployment in Vercel (Deployments tab) and test live.

## Local test

```bash
npm install
npx vercel dev        # http://localhost:3000 with /api/contact
```

## Debugging without leaking secrets

- Open the live form, submit, then open **browser DevTools → Console**:
  `[contact] submission failed { status, error, detail }`.
- In Vercel → **Logs**, look for `[contact] send attempt` (shows only masked
  recipient + `testingMode`) and `[contact] Resend rejected the email`
  (Resend error name/message/status). No API key or message body is logged.
