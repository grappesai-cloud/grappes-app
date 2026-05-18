# Social Auth Setup (Google + Apple)

Both providers are wired into Better-Auth and the sign-in/sign-up pages, but the buttons only render when their env vars are populated. So you can ship one at a time.

---

## Google Sign In

### 1. Google Cloud Console
1. console.cloud.google.com → APIs & Services → **Credentials**
2. **Create credentials → OAuth client ID**
3. Application type: **Web application**
4. Name: "Grappes Sign-In"
5. **Authorized redirect URIs**:
   - `https://grappes.dev/api/auth/callback/google`
   - `https://www.grappes.dev/api/auth/callback/google`
   - `http://localhost:4321/api/auth/callback/google` (for dev)
6. Save → copy **Client ID** + **Client Secret**

### 2. Vercel env vars
```bash
# Production + Preview + Development
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
```

Redeploy → Continue with Google button appears.

---

## Apple Sign In

### 1. Apple Developer Portal
You need a paid Apple Developer account (€99/year).

#### a. App ID
1. developer.apple.com → Certificates, Identifiers & Profiles → **Identifiers**
2. **+** → App IDs → App → continue
3. Description: "Grappes Web Auth"
4. Bundle ID (explicit): `com.grappes.web` (or your choice)
5. **Capabilities**: tick **Sign In with Apple**
6. Continue → Register

#### b. Services ID (this is what becomes `APPLE_CLIENT_ID`)
1. Identifiers → **+** → Services IDs → continue
2. Description: "Grappes Sign In"
3. Identifier: `com.grappes.signin` ← this is your **Services ID**, e.g. `APPLE_CLIENT_ID`
4. Register → click on the new Services ID → tick **Sign In with Apple** → Configure
   - Primary App ID: the one you just created
   - Domains: `grappes.dev`
   - Return URLs:
     - `https://grappes.dev/api/auth/callback/apple`
     - `https://www.grappes.dev/api/auth/callback/apple`
5. Save → Continue → Save

#### c. Sign-In Key (.p8 file)
1. Certificates, Identifiers & Profiles → **Keys** → **+**
2. Name: "Grappes Sign-In Key"
3. Tick **Sign In with Apple**, click Configure, pick the App ID, save
4. Continue → Register → **Download .p8 file** (single download — store it safely)
5. Note the **Key ID** (10 chars, e.g. `AB12CD34EF`)
6. Note your **Team ID** (top-right corner of the Apple Developer portal, 10 chars)

### 2. Generate the JWT used as APPLE_CLIENT_SECRET

Apple requires a signed JWT, not a plain client secret. Max lifetime is 6 months.

```bash
cd ~/grappes-app
APPLE_TEAM_ID=ABC1234567 \
APPLE_KEY_ID=AB12CD34EF \
APPLE_CLIENT_ID=com.grappes.signin \
APPLE_PRIVATE_KEY_FILE=~/Downloads/AuthKey_AB12CD34EF.p8 \
  node scripts/generate-apple-jwt.mjs
```

Output is the JWT. Pipe it to Vercel:

### 3. Vercel env vars
```bash
APPLE_CLIENT_ID=com.grappes.signin     # the Services ID
APPLE_CLIENT_SECRET=<jwt from script>  # rotate every 6 months
APPLE_APP_BUNDLE_ID=com.grappes.web    # optional, only for native iOS
```

Redeploy → Continue with Apple button appears.

### 4. Rotation reminder

The JWT expires after 180 days. Set a calendar reminder for ~150 days from generation to regenerate and update `APPLE_CLIENT_SECRET` on Vercel. The same .p8 + key id + team id keep working — just re-run the script.

---

## Verification

After setting env vars + redeploying:

```bash
# Both endpoints should return 200 with a redirect URL
curl -i -X POST https://www.grappes.dev/api/auth/sign-in/social \
  -H "content-type: application/json" \
  -d '{"provider":"google","callbackURL":"/dashboard"}'

curl -i -X POST https://www.grappes.dev/api/auth/sign-in/social \
  -H "content-type: application/json" \
  -d '{"provider":"apple","callbackURL":"/dashboard"}'
```

On the live site, refresh /sign-in — the social buttons should render.

---

## Code

- Better-Auth config: `src/lib/auth.ts` (conditional `socialProviders` block)
- UI buttons: `src/pages/sign-in.astro` + `src/pages/sign-up.astro` (conditional render)
- JWT helper: `scripts/generate-apple-jwt.mjs`
