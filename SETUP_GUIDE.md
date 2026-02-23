# 🚀 GitHub Pages + Cloudflare Setup Guide

## Why This is Better Than InfinityFree

✅ **No ads** - GitHub Pages is completely ad-free
✅ **Faster** - GitHub's global CDN + Cloudflare = blazing fast
✅ **More reliable** - 99.9%+ uptime
✅ **Professional** - Used by millions of developers
✅ **Free HTTPS** - Automatic SSL certificate
✅ **No weird issues** - Just works!

---

## 📋 What You Need

1. **GitHub account** (free) - https://github.com
2. **Cloudflare account** (free) - https://cloudflare.com
3. **Optional: Custom domain** (e.g., pdftools.com)

---

## 🎯 PART 1: GitHub Pages Setup (5 Minutes)

### Step 1: Create GitHub Account
1. Go to https://github.com
2. Click "Sign up"
3. Choose a username (e.g., `yourname`)
4. Complete registration

### Step 2: Create New Repository
1. Click the **+** icon (top right) → "New repository"
2. **Repository name:** `pdf-workspace` (or any name you want)
3. **Description:** "Privacy-first PDF tools - 47+ tools, 100% client-side"
4. **Public** ✅ (must be public for free GitHub Pages)
5. **DO NOT** initialize with README
6. Click **"Create repository"**

### Step 3: Upload Your Files

**Option A: Web Interface (Easiest)**

1. On the repository page, click **"uploading an existing file"**
2. Drag ALL files from the `github-pages-deploy` folder:
   - index.html
   - app.js
   - styles.css
   - service-worker.js
   - manifest.json
   - .nojekyll
3. **Commit message:** "Initial deployment"
4. Click **"Commit changes"**

**Option B: Git Command Line (Advanced)**

```bash
# In the github-pages-deploy folder
git init
git add .
git commit -m "Initial deployment"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/pdf-workspace.git
git push -u origin main
```

### Step 4: Enable GitHub Pages

1. In your repository, click **Settings** (top menu)
2. Scroll down to **Pages** (left sidebar)
3. Under **Source**, select:
   - Branch: **main**
   - Folder: **/ (root)**
4. Click **Save**
5. Wait 1-2 minutes

### Step 5: Your Site is Live! 🎉

Your site will be at:
```
https://YOUR-USERNAME.github.io/pdf-workspace/
```

For example: `https://johnsmith.github.io/pdf-workspace/`

**Test it!** Visit the URL and verify it works!

---

## 🌐 PART 2: Cloudflare Setup (Optional but Recommended)

Cloudflare provides:
- ✅ Global CDN (faster worldwide)
- ✅ DDoS protection
- ✅ Analytics
- ✅ Custom domain support
- ✅ Additional caching

### Step 1: Sign Up for Cloudflare

1. Go to https://cloudflare.com
2. Click **"Sign Up"**
3. Create account (free plan is perfect)

### Step 2: Add Your Domain (If You Have One)

**If you DON'T have a custom domain:**
- You can skip to Part 3 and use the GitHub URL
- Or buy a domain from Namecheap, GoDaddy, etc. (~$10/year)

**If you HAVE a custom domain:**

1. In Cloudflare dashboard, click **"Add a site"**
2. Enter your domain: `pdftools.com`
3. Select **Free plan**
4. Click **Continue**
5. Cloudflare will scan your DNS records
6. Click **Continue**

### Step 3: Update Nameservers

Cloudflare will give you 2 nameservers like:
```
alex.ns.cloudflare.com
rena.ns.cloudflare.com
```

1. Go to your domain registrar (where you bought the domain)
2. Find "Nameservers" or "DNS" settings
3. Replace current nameservers with Cloudflare's
4. Save changes
5. Wait 1-24 hours for propagation (usually <1 hour)

### Step 4: Configure DNS for GitHub Pages

Once Cloudflare is active:

1. In Cloudflare dashboard, click **DNS** (left menu)
2. Add these DNS records:

**For root domain (pdftools.com):**
```
Type: A
Name: @
Content: 185.199.108.153
Proxy: ON (orange cloud)

Type: A
Name: @
Content: 185.199.109.153
Proxy: ON (orange cloud)

Type: A
Name: @
Content: 185.199.110.153
Proxy: ON (orange cloud)

Type: A
Name: @
Content: 185.199.111.153
Proxy: ON (orange cloud)
```

**For www subdomain:**
```
Type: CNAME
Name: www
Content: YOUR-USERNAME.github.io
Proxy: ON (orange cloud)
```

3. Click **Save**

### Step 5: Configure GitHub for Custom Domain

1. Go back to your GitHub repository
2. **Settings** → **Pages**
3. Under **Custom domain**, enter: `pdftools.com`
4. Click **Save**
5. Wait a few minutes, then check **"Enforce HTTPS"** ✅

### Step 6: Create CNAME File

1. In your repository, create a new file named `CNAME`
2. Content: `pdftools.com` (just the domain, nothing else)
3. Commit the file

---

## ⚡ PART 3: Optimize Cloudflare Settings (Optional)

Make your site even faster!

### Speed Settings

1. **Cloudflare dashboard** → **Speed** → **Optimization**
2. Enable:
   - ✅ Auto Minify (HTML, CSS, JavaScript)
   - ✅ Brotli compression
   - ✅ Rocket Loader (optional, may break some sites)

### Caching Settings

1. **Caching** → **Configuration**
2. **Browser Cache TTL:** 1 year
3. **Caching Level:** Standard

### Security Settings

1. **Security** → **Settings**
2. **Security Level:** Medium
3. **Challenge Passage:** 30 minutes
4. **Browser Integrity Check:** ON

---

## 🎯 Configuration Summary

### Without Custom Domain (Free Forever)
```
Your URL: https://YOUR-USERNAME.github.io/pdf-workspace/
HTTPS: ✅ Automatic
CDN: ✅ GitHub's CDN
Speed: ★★★★☆ Fast
Setup Time: 5 minutes
Cost: $0
```

### With Custom Domain + Cloudflare (Best)
```
Your URL: https://pdftools.com
HTTPS: ✅ Automatic (Cloudflare)
CDN: ✅ GitHub + Cloudflare (global)
Speed: ★★★★★ Blazing fast
Setup Time: 15-30 minutes
Cost: ~$10/year (domain only)
```

---

## 🔧 Updating Your Site

When you want to update files:

**Option 1: Web Interface**
1. Go to repository on GitHub
2. Click on the file (e.g., `index.html`)
3. Click pencil icon (edit)
4. Make changes
5. **Commit changes** at bottom
6. Wait 1-2 minutes → Site updated!

**Option 2: Upload New Files**
1. Go to repository
2. Click **Add file** → **Upload files**
3. Drag new files (will replace old ones)
4. Commit
5. Done!

**Option 3: Git (Advanced)**
```bash
# Make changes locally
git add .
git commit -m "Updated feature X"
git push
# Wait 1-2 minutes → Site updated!
```

---

## ✅ Verification Checklist

After setup, verify everything works:

### Basic Checks
- [ ] Site loads at GitHub Pages URL
- [ ] Layout looks correct (purple header, sidebar, etc.)
- [ ] Can upload PDF files
- [ ] Can process files (try merge)
- [ ] Can download results
- [ ] All 47 tools accessible

### HTTPS Checks
- [ ] URL starts with `https://` (not `http://`)
- [ ] Lock icon in browser address bar
- [ ] No security warnings

### Performance Checks
- [ ] Site loads in < 3 seconds
- [ ] Lighthouse score: 90+ (F12 → Lighthouse)
- [ ] Works on mobile
- [ ] Works offline (after first visit)

### Custom Domain (if configured)
- [ ] Domain resolves to site
- [ ] www subdomain works
- [ ] HTTPS works on custom domain
- [ ] No redirect loops

---

## 🐛 Troubleshooting

### Site Shows 404

**Problem:** GitHub Pages not enabled or files in wrong location

**Fix:**
1. Check Settings → Pages is enabled
2. Verify files are in root (not in a folder)
3. Wait 2-3 minutes after enabling
4. Hard refresh browser (Ctrl+Shift+R)

### Custom Domain Not Working

**Problem:** DNS not propagated or misconfigured

**Fix:**
1. Wait 1-24 hours for DNS propagation
2. Check DNS records are correct in Cloudflare
3. Verify CNAME file exists in repository
4. Check Cloudflare proxy is ON (orange cloud)

### SSL/HTTPS Issues

**Problem:** Certificate not issued yet

**Fix:**
1. Wait 10-15 minutes after domain configuration
2. In GitHub Settings → Pages, check "Enforce HTTPS"
3. Clear browser cache
4. Check Cloudflare SSL is set to "Full"

### Site Loads Slowly

**Problem:** Not using Cloudflare or caching not optimized

**Fix:**
1. Enable Cloudflare (huge speed boost)
2. Enable Auto Minify in Cloudflare
3. Set Browser Cache TTL to 1 year
4. Enable Brotli compression

### Layout Still Broken

**Problem:** Files didn't upload correctly

**Fix:**
1. Verify all 5 core files uploaded:
   - index.html (54 KB)
   - app.js (503 KB)
   - styles.css (8 KB)
   - service-worker.js (9 KB)
   - manifest.json (3 KB)
2. Check file sizes match
3. Re-upload if needed

---

## 💡 Pro Tips

### Tip 1: Use Short Repository Name
If you don't have a custom domain, use a short repo name:
- ✅ `pdf` → `username.github.io/pdf`
- ❌ `pdf-workspace-tools` → `username.github.io/pdf-workspace-tools`

### Tip 2: Enable GitHub Discussions
Let users report issues or request features:
1. Settings → Features → Discussions ✅

### Tip 3: Add README.md
Make your repo look professional:
```markdown
# PDF Workspace

47+ privacy-first PDF tools running entirely in your browser.

**Live Site:** https://yoursite.com

**Features:**
- Merge, split, compress PDFs
- Sign documents
- Extract pages
- And 40+ more tools!

**100% client-side processing** - your files never leave your device.
```

### Tip 4: Monitor with Cloudflare Analytics
Free analytics without tracking cookies:
- Cloudflare → Analytics
- See visitors, bandwidth, threats blocked

### Tip 5: Use Git for Version Control
- Each update is tracked
- Can roll back if something breaks
- See history of all changes

---

## 📊 Expected Performance

### With GitHub Pages Only
- **Load Time:** 2-3 seconds (first visit)
- **Speed:** Fast (GitHub CDN)
- **Uptime:** 99.9%
- **Global:** Good coverage

### With GitHub Pages + Cloudflare
- **Load Time:** 1-2 seconds (first visit)
- **Speed:** Very fast (dual CDN)
- **Uptime:** 99.99%
- **Global:** Excellent coverage
- **DDoS Protection:** ✅
- **Analytics:** ✅

---

## 🎉 You're Done!

Your site is now:
- ✅ Hosted on GitHub Pages (reliable, fast)
- ✅ Powered by Cloudflare (if configured)
- ✅ 100% free (except domain if you bought one)
- ✅ No ads, no issues, no limitations
- ✅ Professional and reliable

**This is how it should be!** 🚀

---

## 📞 Need Help?

- **GitHub Pages Docs:** https://docs.github.com/pages
- **Cloudflare Docs:** https://developers.cloudflare.com
- **DNS Checker:** https://dnschecker.org (check propagation)
- **SSL Checker:** https://www.ssllabs.com/ssltest

---

**Welcome to professional, reliable hosting!** 🎉

No more InfinityFree issues - just fast, stable, ad-free hosting!
