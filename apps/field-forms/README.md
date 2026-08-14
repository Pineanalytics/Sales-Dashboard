# Field Data Forms

A production data-collection app: public multi-section forms + an admin dashboard with CSV export, built on Next.js + Supabase.

## What's already done for you

- Supabase project **field-data-forms** is live (ref: `spbjmjmntfnjixdoczzw`), with the full schema applied:
  - `profiles` (role: user/admin, auto-created on signup)
  - `forms`, `form_sections`, `form_fields` (the form builder's data)
  - `submissions`, `submission_answers` (collected data)
  - Row Level Security enabled everywhere — users can only see their own submissions, only admins can manage forms or see everyone's data.
- `.env.local` is already filled in with your Supabase URL and anon key.
- The app builds cleanly and the auth gate (redirect-if-not-logged-in) is verified working.

## Deploy to Vercel (5 minutes)

1. Push this folder to a new GitHub repo (or drag-and-drop deploy — see option B).
2. Go to https://vercel.com/new, import the repo.
3. Add these two Environment Variables in the Vercel project settings (copy from `.env.local`):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy. Vercel auto-detects Next.js — no build config needed.

**Option B — no GitHub needed:** install the Vercel CLI (`npm i -g vercel`), run `vercel` inside this folder, follow the prompts, then `vercel --prod`. It will ask you to paste in the same two env vars.

## Making yourself an admin

Sign up for an account in the app first (anyone can sign up). Then run this in the Supabase SQL Editor for the `field-data-forms` project:

```sql
update public.profiles set role = 'admin' where email = 'your-email@example.com';
```

Once you're admin, you'll see an "Admin" link in the header to build forms and view submissions.

## Local development

```bash
npm install
npm run dev
```

## Project structure

- `app/login` — sign in / sign up
- `app/page.tsx` — form list for logged-in users
- `app/forms/[id]` — the public multi-section form + submit logic
- `app/admin` — form builder (create/edit forms with sections & fields) + submissions viewer with CSV export
- `proxy.ts` — auth-gating (Next.js 16's replacement for middleware.ts)
- `lib/supabase` — client/server/proxy Supabase helpers
