# PDF Workspace - Privacy-First PDF Tools

<div align="center">

![PDF Workspace](https://img.shields.io/badge/Tools-47-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Client Side](https://img.shields.io/badge/processing-100%25%20client--side-orange)
![No Tracking](https://img.shields.io/badge/tracking-none-brightgreen)

**47 professional PDF tools running entirely in your browser**

[Live Demo](#) | [Features](#features) | [Privacy](#privacy) | [Tools](#available-tools)

</div>

---

## 🎯 What is PDF Workspace?

A complete suite of PDF tools that runs **100% in your browser**. No uploads, no servers, complete privacy.

- ✅ **No file uploads** - Everything processes locally
- ✅ **No tracking** - Zero analytics or cookies
- ✅ **No limits** - Process files of any size
- ✅ **Completely free** - No premium features, no paywalls
- ✅ **Works offline** - Use without internet (after first load)
- ✅ **Mobile friendly** - Works on phones and tablets

---

## ✨ Features

### 🔒 Privacy-First
- All processing happens in your browser
- Files never leave your device
- No server uploads
- No tracking or analytics
- Open source

### ⚡ Fast & Efficient
- Client-side processing (no server delays)
- Works offline after first visit
- Progressive Web App (installable)
- Lightweight (~500 KB total)

### 🛠️ Professional Tools
- 47 tools covering all PDF needs
- No watermarks
- No quality loss
- Batch processing
- Multiple file support

---

## 📋 Available Tools

### Basic Operations
- **Merge PDFs** - Combine multiple PDFs into one
- **Split PDF** - Split into separate files
- **Extract Pages** - Pull specific pages
- **Rotate Pages** - Fix page orientation
- **Reverse Pages** - Flip page order
- **Reorder Pages** - Custom page arrangement
- **Remove Blank Pages** - Clean up scans

### Editing & Annotation
- **Edit PDF** - Add text boxes, images, shapes
- **PDF Text Editor** - Edit existing text in PDFs
- **Annotate PDF** - Add comments, highlights, drawings
- **Sign PDF** - Add digital signatures
- **Fill Forms** - Complete PDF forms
- **Flatten PDF** - Make forms non-editable

### Security
- **Protect PDF** - Add password protection
- **Unlock PDF** - Remove passwords
- **Redact Text** - Permanently remove sensitive info
- **PII Scanner** - Find personal information
- **Clean Slate** - Remove all metadata

### Conversion
- **PDF to Images** - Convert to PNG/JPEG
- **Images to PDF** - Create PDF from images
- **HTML to PDF** - Convert web pages
- **Office to PDF** - Word, Excel, PowerPoint
- **PDF to Office** - Extract to editable formats
- **OCR** - Make scanned PDFs searchable

### Advanced
- **Compress PDF** - Reduce file size
- **Add Watermark** - Protect your documents
- **Number Pages** - Add page numbers
- **Edit Metadata** - Update PDF properties
- **Bates Numbering** - Legal document numbering
- **Split Odd/Even** - Separate pages
- **Interleave PDFs** - Combine alternating pages
- **Auto Categorize** - Smart document organization
- **Invoice Splitter** - Extract invoice data
- **Batch Slicer** - Process multiple files
- **Validate PDF** - Check PDF integrity
- **Repair PDF** - Fix corrupted PDFs
- **PDF Audit** - Detailed file analysis

[See all 47 tools →](#)

---

## 🚀 Usage

Simply visit the site and start processing PDFs:

1. **Select a tool** from the sidebar
2. **Upload your files** (drag & drop or browse)
3. **Process** - Everything happens in your browser
4. **Download** your result

No account needed. No sign-up. No tracking.

---

## 🔒 Privacy

### Your Data is Safe

- ✅ **No uploads** - Your files never leave your browser
- ✅ **No storage** - Nothing saved on our servers (we don't have any)
- ✅ **No tracking** - No analytics, no cookies, no fingerprinting
- ✅ **No accounts** - No sign-up, no email required
- ✅ **No logs** - We can't log what we never see

### A Note on Honesty

To be transparent: PDF Workspace itself is purely static and processes your files entirely client-side. However, the JavaScript libraries (PDF.js, PDF-Lib, JSZip, etc.) are loaded from public CDNs (cdnjs, jsDelivr, unpkg) on first visit. After the first load, the service worker caches them locally and the app works fully offline. Your PDFs themselves are never sent to any server.

If you want a fully self-contained deployment with no CDN dependencies, you can mirror the libraries to your own hosting and update the script paths in `index.html`.

### How It Works

All PDF processing uses client-side JavaScript libraries:
- [PDF.js](https://mozilla.github.io/pdf.js/) (Mozilla) - PDF rendering
- [PDF-Lib](https://pdf-lib.js.org/) - PDF manipulation
- [JSZip](https://stuk.github.io/jszip/) - ZIP handling
- [Tesseract.js](https://tesseract.projectnaptha.com/) - OCR

Everything runs in your browser. Your files are yours.

---

## 💻 Technical Details

### Built With
- Pure JavaScript (no frameworks)
- Client-side PDF processing
- Progressive Web App (PWA)
- Service Worker for offline use
- Responsive design

### Browser Support
- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+
- ✅ Mobile browsers

### Performance
- Initial load: ~2-3 seconds
- Cached load: < 1 second
- Processes large PDFs (100+ MB)
- Works offline after first visit

---

## 🌐 Deployment

### GitHub Pages (Current)
This site is hosted on GitHub Pages with Cloudflare CDN.

- **Free hosting** forever
- **Global CDN** for fast loading
- **Automatic HTTPS**
- **99.9% uptime**

### Self-Hosting
Clone and host on any static hosting (GitHub Pages, Netlify, Vercel, Cloudflare Pages, etc.):

```bash
git clone https://github.com/YOUR-USERNAME/pdf-workspace.git
cd pdf-workspace
```

To run locally for development, **serve the files with any local web server** (don't open `index.html` directly — service workers, PDF.js workers, and CDN libraries require an HTTP context):

```bash
# Option 1: Python (built-in on most systems)
python3 -m http.server 8000

# Option 2: Node.js (if you have it)
npx serve

# Then open http://localhost:8000 in your browser
```

No build process needed!

---

## 📊 Stats

- **Tools:** 47
- **File Size:** ~500 KB (entire app)
- **Dependencies:** 0 npm packages (uses CDN libraries)
- **Tracking:** 0% (none)
- **Privacy:** 100% (complete)

---

## 🤝 Contributing

This is a personal project, but suggestions are welcome!

- 🐛 Found a bug? [Open an issue](#)
- 💡 Have an idea? [Start a discussion](#)
- 📖 Improve docs? Submit a PR

---

## 📄 License

MIT License - Free to use, modify, and distribute.

See [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

Built with these amazing open-source libraries:
- [PDF.js](https://mozilla.github.io/pdf.js/) by Mozilla
- [PDF-Lib](https://pdf-lib.js.org/) by Andrew Dillon
- [Tesseract.js](https://tesseract.projectnaptha.com/)
- [JSZip](https://stuk.github.io/jszip/)
- [FileSaver.js](https://github.com/eligrey/FileSaver.js/)
- [Mammoth.js](https://github.com/mwilliamson/mammoth.js/)
- [SheetJS](https://sheetjs.com/)

---

## 📞 Support

- **Documentation:** See [SETUP_GUIDE.md](SETUP_GUIDE.md)
- **Issues:** [GitHub Issues](#)
- **Discussions:** [GitHub Discussions](#)

---

<div align="center">

**Made with ❤️ for privacy and simplicity**

[⬆ Back to Top](#pdf-workspace---privacy-first-pdf-tools)

</div>
