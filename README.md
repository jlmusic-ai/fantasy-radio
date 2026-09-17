# Fantasy Radio — working starter application

A fan-made fantasy game for a Pittsburgh morning radio show. This is source code, **not a deployed website**. You must configure Supabase and deploy to Vercel before real users can sign up.

## Setup
1. Install Node.js 20+ and run `npm install` in this folder.
2. Create a Supabase project. Run `supabase/schema.sql` in its SQL editor. Review the illustrative categories and replace them with precise, agreed definitions before launch. Supabase Auth email confirmation is recommended.
3. Copy `.env.example` to `.env.local` and insert your project's URL and publishable/anon key. Never put a Supabase service-role key in `NEXT_PUBLIC_` variables.
4. Run `npm run dev`, then visit http://localhost:3000. Register your own account.
5. In Supabase SQL Editor, promote only your own account using `update public.profiles set is_commissioner=true where id=(select id from auth.users where email='YOUR_EMAIL');`.
6. Sign in, open `/commissioner`, and create the Monday week before players begin submitting lineups. The commissioner can record and delete events. The scoreboard recalculates from the event ledger.
7. Deploy the repository to Vercel and configure the same two environment variables in the Vercel project. Set the Supabase Auth Site URL and redirect URLs to your deployed domain. Use a domain you control.

## Rules and limitations
- Exactly 100 points per lineup; 0–25 points for every active category; every occurrence earns the allocated points.
- All users share one public weekly and quarterly-season leaderboard. Seasons are calendar quarters (Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec). Week belongs to the quarter in which its Monday falls.
- Monday lock is configurable by the commissioner. Weeks must be created manually; the app does not automatically create the next week.
- Categories are fixed in the initial game; commissioner can change them in Supabase before launch. Changing active categories midseason would invalidate the fixed-lineup design and must be avoided.
- The homepage uses current Pittsburgh week. Public scores and picks are readable only by logged-in users under the provided database policies. The demo homepage is visible to visitors but queries require sign-in.
- The commissioner should establish precise category definitions and document each occurrence. The app has no audio ingestion, automatic transcription, notifications, password-reset UI, or payment features.
- Before public launch, test authentication, email confirmation, DST lock times, category definitions, accessibility, and load. Protect against duplicate event entry; deletion is supported.

## Privacy and affiliation
Use a distinctive brand and original graphics. Do not imply endorsement by the radio show or station. Add a privacy policy, terms, moderation process, and contact email before accepting public registrations.
