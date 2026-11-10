# Desktop-first account onboarding

The public signup flow now defaults to `/get-started`, with direct installer download and installation/account connection instructions. Sign-in defaults to `/account`. Explicit internal destinations survive email/phone, sign-in/signup and OAuth continuation; external destinations and recursive auth routes are rejected. The old browser Agent retains explicit `/app` destinations.

All public account routes and Desktop authorization pages share a single-column brand frame, the existing Minaco wordmark and the landing page font. Account creation, confirming the device and the local runtime saving the connection remain separate states. `/desktop/finish` retains its idempotent billing initialization and now provides branded failure recovery.

Desktop PKCE, API endpoints, Clerk credentials, account data and database schemas are unchanged. Legacy desktop-domain redirects already route to the main site. The local browser result page lives in the desktop installer and is updated separately in Desktop 0.13.11; old clients remain compatible.

Validation: Next production build, TypeScript, destination validation, Desktop callback/request validation and landing action tests. Rendered signup at desktop/mobile sizes, with no overflow. Browser sign-in on localhost cannot complete against the production Clerk domain; live provider authentication and new-account verification are not claimed by these checks.
