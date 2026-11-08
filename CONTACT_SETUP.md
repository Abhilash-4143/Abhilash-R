# Contact-form email setup (EmailJS)

The form uses the official `@emailjs/browser` SDK. The recipient
(`ABHILASH.20241CSE0600@presidencyuniversity.in`) is fixed by your EmailJS
**template** (To field), and the visitor's address is set as the template's
**Reply-To** field (`{{from_email}}`), so replies go to the visitor.

## 1. Create the EmailJS service, template and key

1. Go to https://www.emailjs.com/ → sign in → **Email Services** → **Add New Service**.
   - Provider: **Gmail** (or another connected provider). Connect the account
     you use to send (this is the "from" mailbox, not the recipient).
   - Note the **Service ID** (e.g. `service_xxxxxxx`).
2. **Email Templates** → **Create New Template** → name it (e.g. `Portfolio Contact`).
   - **To:** `ABHILASH.20241CSE0600@presidencyuniversity.in` (type it literally).
   - **Reply To:** `{{from_email}}` (so replies go to the visitor).
   - **Subject:** `[Portfolio] {{subject}}`
   - **Content:**
     ```
     From: {{from_name}} <{{from_email}}>
     Subject: {{subject}}

     {{message}}
     ```
   - Save → note the **Template ID** (e.g. `template_xxxxxxx`).
3. **Account → General** (or Settings → General) → copy the **Public Key**
   (e.g. `user_...`). EmailJS has no private key in the browser flow — don't
   share anything labelled private.

## 2. Restrict origins (security)

EmailJS Dashboard → **Settings** → **Allowed Origins** → add:
- `https://abhilash-r.vercel.app`
- `http://localhost:3000` (or your local dev port, e.g. `http://localhost:5173`)

Leave default origins off. This stops other sites from using your keys.

## 3. Enter the variables in Vercel (exact location)

- Vercel Dashboard → project **abhilash-r** → **Settings** →
  **Environment Variables** → **Add Variable** for each (check Production,
  Preview, Development) → **Save**:

| Variable | Value |
|---|---|
| `VITE_EMAILJS_SERVICE_ID` | `service_xxxxxxx` |
| `VITE_EMAILJS_TEMPLATE_ID` | `template_xxxxxxx` |
| `VITE_EMAILJS_PUBLIC_KEY` | `user_...` |

- Then **Deployments** → `···` → **Redeploy** (env changes never auto-redeploy).
- The `VITE_` names are read server-side by `api/emailjs-config.js` and
  delivered to the browser at runtime, so no build step is required.

## 4. Verify

1. Open the live site → submit the form → success appears only when EmailJS
   returns OK; your text is kept on failure and cleared on success.
2. Check **EmailJS Dashboard → Email Logs** for the accepted send and the
   Presidency inbox (watch spam on first send).
3. If it errors, open DevTools Console → `[contact] ...` and check
   EmailJS Logs for the reason (usually: wrong IDs, template variables
   mismatch, or origin not allowed).

Form protections: same fields/UI, loading state, duplicate guard, honeypot,
5-second minimum gap and 5/hour client-side cap (pure client SDKs cannot do
server-side throttling — origins + template To field are the real controls).
