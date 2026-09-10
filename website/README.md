# ArDali Browser — Official Promotional Website

Production-quality, privacy-focused, security-first static website for [ArDali Browser](https://github.com/Muhammed-Dali/ArDali-Browser).

---

## 1. Architectural Principles

This website is engineered according to a **Security-First Architecture** with a strictly minimized attack surface:

- **100% Pure Static Website:** Plain semantic HTML5, pure CSS3, and minimal progressive-enhancement vanilla JavaScript.
- **Zero Backend / Zero Attack Surface:** No PHP, Node.js server, CMS, WordPress, database, or server-side authentication.
- **Zero Tracking & Telemetry:** No Google Analytics, no tracking pixels, no advertising SDKs, no third-party cookies, and no visitor fingerprinting.
- **Zero External Dependencies:** No Google Fonts, no Font Awesome CDN, and no external CDN scripts (cdnjs, jsdelivr, unpkg). System font stack and local SVGs only.
- **Multilingual Support:** English (`/`), Türkçe (`/tr/`), and Arabic (`/ar/` with native RTL layout).
- **Strict Content Security Policy (CSP):** Disallows `unsafe-inline`, `unsafe-eval`, and external origin connections.

---

## 2. Directory Structure

```text
website/
├── index.html           # English landing page (default /)
├── tr/
│   └── index.html       # Türkçe landing page (/tr/)
├── ar/
│   └── index.html       # العربية landing page (/ar/ with dir="rtl")
├── assets/
│   ├── css/
│   │   └── main.css     # Production stylesheet (dark theme, responsive, RTL)
│   ├── js/
│   │   └── main.js      # Minimal vanilla JS (mobile menu, safe DOM copy button)
│   ├── images/          # Product screenshots & official logos
│   └── icons/           # Local SVG icons (shield, download, terminal, check)
├── favicon.svg          # Modern vector SVG favicon
├── favicon.png          # Fallback PNG favicon (32x32)
├── robots.txt           # Search engine crawling rules & sitemap pointer
├── sitemap.xml          # XML sitemap with multilingual hreflang links
├── _headers             # Cloudflare Pages security & caching headers
└── README.md            # Deployment and architecture documentation
```

---

## 3. Production Deployment: Cloudflare Pages (Recommended)

Cloudflare Pages is the recommended hosting platform because it provides native, edge-level support for custom security headers via the `_headers` file, unlimited bandwidth, and global Anycast CDN caching.

### Step-by-Step Cloudflare Pages Setup:

1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Navigate to **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.
3. Select the `Muhammed-Dali/ArDali-Browser` repository.
4. Configure Build settings:
   - **Framework preset:** `None`
   - **Build command:** *(leave empty)*
   - **Build output directory:** `website`
5. Click **Save and Deploy**.
6. Cloudflare will generate a free HTTPS URL such as `https://ardali-browser.pages.dev`.

### Custom Domain (Optional):
You can attach any custom domain (e.g. `ardalibrowser.com`) under **Custom Domains** tab without changing any code.

### Security Headers Configured (`_headers`):
- `Content-Security-Policy`: Restricts scripts, styles, and assets to `'self'`.
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy`: Shuts down camera, microphone, geolocation, usb, payments, etc.
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`

---

## 4. Fallback Deployment: GitHub Pages

ArDali Browser website is fully compatible with GitHub Pages as a fallback:

1. In GitHub, open **Settings** → **Pages**.
2. Under **Build and deployment** → **Source**, choose **Deploy from a branch**.
3. Select your deployment branch and target folder (e.g., `/website` or a dedicated `gh-pages` branch).
4. Save to deploy.

> **Technical Security Note on GitHub Pages:**  
> Unlike Cloudflare Pages, standard GitHub Pages does not evaluate the `_headers` file to emit custom HTTP response headers. To safeguard the site on GitHub Pages, equivalent `<meta http-equiv="Content-Security-Policy">` and `<meta name="referrer" content="no-referrer">` tags are already embedded directly within every HTML file.

---

## 5. GitHub Repository Website Configuration

Once deployed on Cloudflare Pages (e.g., `https://ardali-browser.pages.dev`), update your GitHub repository's **About** panel:

1. Navigate to `https://github.com/Muhammed-Dali/ArDali-Browser`.
2. Click the gear icon next to **About** in the right sidebar.
3. In the **Website** field, enter the production URL:
   ```text
   https://ardali-browser.pages.dev
   ```
4. Save changes.
