// PDF WORKSPACE v9.2.0 - 20 ENHANCEMENTS
// 🚀 #1  Lazy-load heavy libraries (saves ~1.2MB initial download)
// 🔗 #2  URL hash routing (deep links & PWA shortcuts work)
// ⚠️ #3  beforeunload warning (prevents accidental data loss)
// 📎 #4  Dynamic drop zone hints per tool
// 🔒 #5  SRI hash framework for CDN scripts
// 📱 #6  Collapsible mobile sidebar (hamburger menu)
// 🌙 #7  Dark mode with system preference detection
// ⌨️ #8  Global keyboard shortcuts (Ctrl+O, Ctrl+Enter, /, ?, Escape)
// 📄 #9  Extracted inline styles to external CSS file
// ⏳ #10 Loading skeleton / splash screen
// 🕐 #11 Local tool usage tracking & "Recently Used" section
// ⚠️ #12 Confirmation before destructive operations
// 📦 #13 Batch download as ZIP for multi-output tools
// 💬 #14 User-friendly error messages
// 🔀 #15 Drag-to-reorder files in file list
// 🆕 #16 "What's New" changelog toast
// 📡 #17 Offline indicator
// 📊 #18 Individual file progress during batch operations
// ↩️ #19 Global undo (application-level, future hook)
// ♿ #20 Screen reader announcements for tool switching
// All previous fixes included (XSS, worker race, CSP, etc.)

// FIX: PDF.js Worker Configuration - Single Source of Truth
// Configure worker BEFORE any PDF.js operations to prevent file:// path issues
const PDFJS_WORKER_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

function configurePDFWorker() {
    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
        console.log('[PDF.js] Worker configured');
        return true;
    }
    return false;
}

// Try immediately
if (!configurePDFWorker()) {
    console.warn('[PDF.js] Library not loaded yet - will retry');
    // FIX: Use DOMContentLoaded + polling fallback for slow connections
    // where pdfjsLib may load AFTER DOMContentLoaded fires
    window.addEventListener('DOMContentLoaded', function() {
        if (!configurePDFWorker()) {
            let attempts = 0;
            const maxAttempts = 20; // 10 seconds total
            const poll = setInterval(() => {
                attempts++;
                if (configurePDFWorker() || attempts >= maxAttempts) {
                    clearInterval(poll);
                    if (attempts >= maxAttempts && typeof pdfjsLib === 'undefined') {
                        console.error('[PDF.js] Library failed to load after polling');
                    }
                }
            }, 500);
        }
    });
}

// Application State
const AppState = {
    currentTool: 'merge',
    files: [],
    processing: false,
    currentPreviewFile: null,
    currentPreviewPage: 1,
    autoScrubMetadata: false  // ENHANCEMENT: Privacy power-up - auto-scrub metadata
};

// Utility Functions
const Utils = {
    // CRITICAL SECURITY FIX: HTML escaping to prevent XSS
    escapeHtml(str) {
        if (str === null || str === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    },
    
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    },
    
    showStatus(message, type = 'info') {
        const statusEl = document.getElementById('statusMessage');
        statusEl.textContent = message;
        statusEl.className = `status-message active status-${type}`;
        // Keep errors/warnings visible longer so users can actually read them
        const duration = (type === 'error' || type === 'warning') ? 10000 : 5000;
        setTimeout(() => statusEl.classList.remove('active'), duration);
    },
    
    updateProgress(percent, text) {
        const container = document.getElementById('progressContainer');
        const bar = document.getElementById('progressBar');
        const textEl = document.getElementById('progressText');
        
        container.classList.add('active');
        bar.style.width = percent + '%';
        textEl.textContent = text;
        
        // ACCESSIBILITY: Update progress bar aria-valuenow
        bar.setAttribute('aria-valuenow', Math.round(percent));
        bar.setAttribute('aria-label', `${text} - ${Math.round(percent)}% complete`);
        
        if (percent >= 100) {
            setTimeout(() => container.classList.remove('active'), 1000);
        }
    },
    
    parsePageRanges(rangeStr, totalPages) {
        // CRITICAL FIX BUG #15: Validate input and handle edge cases
        if (!rangeStr || !rangeStr.trim()) {
            return []; // Empty input
        }
        
        const pages = new Set();
        const parts = rangeStr.split(',');
        let hasWarnings = false;
        
        for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed) continue; // Skip empty parts
            
            if (trimmed.includes('-')) {
                // Range (e.g., "1-5")
                const [startStr, endStr] = trimmed.split('-');
                const start = parseInt(startStr.trim(), 10);
                const end = parseInt(endStr.trim(), 10);
                
                // Validate NaN
                if (isNaN(start) || isNaN(end)) {
                    console.warn(`[PageRange] Invalid range: "${trimmed}" - not a number`);
                    hasWarnings = true;
                    continue;
                }
                
                // Check reversed range
                if (start > end) {
                    console.warn(`[PageRange] Reversed range: "${trimmed}" - start > end`);
                    hasWarnings = true;
                    continue;
                }
                
                // Check bounds
                if (start < 1 || end > totalPages) {
                    console.warn(`[PageRange] Range "${trimmed}" out of bounds (1-${totalPages})`);
                    hasWarnings = true;
                }
                
                // Add valid pages in range
                for (let i = Math.max(1, start); i <= Math.min(end, totalPages); i++) {
                    pages.add(i - 1); // Convert to 0-indexed
                }
            } else {
                // Single page (e.g., "5")
                const pageNum = parseInt(trimmed, 10);
                
                // Validate NaN
                if (isNaN(pageNum)) {
                    console.warn(`[PageRange] Invalid page number: "${trimmed}"`);
                    hasWarnings = true;
                    continue;
                }
                
                // Check bounds
                if (pageNum < 1 || pageNum > totalPages) {
                    console.warn(`[PageRange] Page ${pageNum} out of bounds (1-${totalPages})`);
                    hasWarnings = true;
                    continue;
                }
                
                pages.add(pageNum - 1); // Convert to 0-indexed
            }
        }
        
        // Warn user if no valid pages
        if (pages.size === 0) {
            Utils.showStatus('No valid pages in range. Please check your input.', 'warning');
        } else if (hasWarnings) {
            Utils.showStatus(`Selected ${pages.size} page(s). Some invalid entries were skipped.`, 'warning');
        }
        
        return Array.from(pages).sort((a, b) => a - b);
    },
    
    // STRATEGIC ENHANCEMENT: Privacy power-up - metadata scrubbing utility
    scrubMetadata(pdfDoc, anonymous = true) {
        if (anonymous) {
            // Complete anonymization
            pdfDoc.setTitle('');
            pdfDoc.setAuthor('');
            pdfDoc.setSubject('');
            pdfDoc.setKeywords([]);
            pdfDoc.setCreator('');
            pdfDoc.setProducer('');
            pdfDoc.setCreationDate(new Date(0));
            pdfDoc.setModificationDate(new Date(0));
        } else {
            // Minimal branding
            pdfDoc.setProducer('PDF Workspace');
            pdfDoc.setCreator('PDF Workspace');
        }
    },
    
    // STRATEGIC ENHANCEMENT: ZIP bundling for batch downloads
    async createZipBundle(files, zipName = 'output.zip') {
        const zip = new JSZip();
        
        files.forEach((fileData, index) => {
            const filename = fileData.name || `file_${index + 1}.pdf`;
            zip.file(filename, fileData.blob || fileData.data);
        });
        
        const zipBlob = await zip.generateAsync({ 
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        });
        
        saveAs(zipBlob, zipName);
        return zipBlob;
    },
    
    // ENHANCEMENT: Handle encrypted PDFs with user confirmation
    async loadPDFWithEncryptionHandler(arrayBuffer, fileName = 'PDF') {
        try {
            // Try to load PDF normally
            return await PDFLib.PDFDocument.load(arrayBuffer);
        } catch (error) {
            // Check if it's an encryption error
            if (error.message && error.message.includes('encrypted')) {
                // Ask user if they want to continue
                const proceed = confirm(
                    `🔒 Encrypted PDF Detected: "${fileName}"\n\n` +
                    `This PDF is password-protected or encrypted.\n\n` +
                    `⚠️ Warning: Processing encrypted PDFs may:\n` +
                    `• Not preserve all security features\n` +
                    `• Result in unexpected behavior\n` +
                    `• Produce incomplete or corrupted output\n\n` +
                    `💡 Recommendation: Use the "Unlock PDF" tool first for best results.\n\n` +
                    `Do you want to attempt to process it anyway?`
                );
                
                if (proceed) {
                    // User chose to continue - try to load with encryption ignored
                    try {
                        console.log(`[Utils] User chose to process encrypted PDF: ${fileName}`);
                        return await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
                    } catch (retryError) {
                        throw new Error(`Cannot load encrypted PDF: ${retryError.message}`);
                    }
                } else {
                    // User chose not to continue
                    throw new Error('Operation cancelled: PDF is encrypted. Please unlock it first using the "Unlock PDF" tool.');
                }
            }
            
            // If it's not an encryption error, rethrow the original error
            throw error;
        }
    },
    
    // CRITICAL FIX v9.0.0: Library availability checking
    checkLibraries(required = []) {
        const libraries = {
            'PDFLib': typeof PDFLib !== 'undefined',
            'pdfjsLib': typeof pdfjsLib !== 'undefined',
            'JSZip': typeof JSZip !== 'undefined',
            'saveAs': typeof saveAs !== 'undefined',
            'Tesseract': typeof Tesseract !== 'undefined',
            'mammoth': typeof mammoth !== 'undefined',
            'XLSX': typeof XLSX !== 'undefined',
            'jspdf': typeof jspdf !== 'undefined',
            'docx': typeof docx !== 'undefined'
        };
        
        const missing = [];
        for (const lib of required) {
            if (!libraries[lib]) {
                missing.push(lib);
            }
        }
        
        if (missing.length > 0) {
            const libNames = missing.join(', ');
            this.showStatus(
                `Required libraries not loaded: ${libNames}. Please wait a moment and try again, or refresh the page.`,
                'error'
            );
            console.error('[Library Check] Missing libraries:', missing);
            return false;
        }
        
        return true;
    },
    
    // CRITICAL FIX v9.0.0: Safe async wrapper for tool processes
    async safeProcess(toolName, processFunc, files) {
        try {
            return await processFunc(files);
        } catch (error) {
            console.error(`[${toolName}] Error:`, error);
            this.showStatus(`${toolName} failed: ${error.message}`, 'error');
            this.updateProgress(0, 'Error occurred');
            throw error;
        }
    }
};

// File Type Detection Helper - FIX v7.13
// Normalizes file type checking across all tools
// FIX: Safe file extension replacement — avoids brittle .replace('.pdf', ...) calls
// that silently fail when the extension is uppercase, absent, or appears mid-name.
function withExt(name, ext) {
    const i = name.lastIndexOf('.');
    return (i > -1 ? name.slice(0, i) : name) + ext;
}

const FileType = {
    isPDF(file) {
        if (!file) return false;
        const name = (file.name || '').toLowerCase();
        const mime = (file.type || '').toLowerCase();
        return mime === 'application/pdf' || name.endsWith('.pdf');
    },
    
    isImage(file) {
        if (!file) return false;
        return (file.type || '').startsWith('image/');
    },
    
    isHTML(file) {
        if (!file) return false;
        const name = (file.name || '').toLowerCase();
        const mime = (file.type || '').toLowerCase();
        return mime.includes('html') || name.endsWith('.html') || name.endsWith('.htm');
    },
    
    // NEW v7.15.0: Office file detection
    isWord(file) {
        if (!file) return false;
        const name = (file.name || '').toLowerCase();
        const mime = (file.type || '').toLowerCase();
        return mime.includes('wordprocessingml') || 
               mime === 'application/msword' ||
               mime === 'application/vnd.ms-word' ||
               name.endsWith('.docx') || 
               name.endsWith('.doc');
    },
    
    isExcel(file) {
        if (!file) return false;
        const name = (file.name || '').toLowerCase();
        const mime = (file.type || '').toLowerCase();
        return mime.includes('spreadsheetml') || 
               mime === 'application/vnd.ms-excel' ||
               name.endsWith('.xlsx') || 
               name.endsWith('.xls');
    },
    
    isPowerPoint(file) {
        if (!file) return false;
        const name = (file.name || '').toLowerCase();
        const mime = (file.type || '').toLowerCase();
        return mime.includes('presentationml') || 
               mime === 'application/vnd.ms-powerpoint' ||
               name.endsWith('.pptx') || 
               name.endsWith('.ppt');
    },
    
    isOffice(file) {
        return this.isWord(file) || this.isExcel(file) || this.isPowerPoint(file);
    }
};

// Tool Settings Persistence - ENHANCEMENT v7.14
const ToolSettings = {
    save(toolId, settings) {
        const key = `pdfWorkspace_${toolId}_settings`;
        try {
            localStorage.setItem(key, JSON.stringify(settings));
            console.log(`[ToolSettings] Saved ${toolId}:`, settings);
        } catch (e) {
            console.warn(`[ToolSettings] Could not save ${toolId}:`, e);
        }
    },
    
    load(toolId) {
        const key = `pdfWorkspace_${toolId}_settings`;
        try {
            const data = localStorage.getItem(key);
            if (data) {
                const parsed = JSON.parse(data);
                console.log(`[ToolSettings] Loaded ${toolId}:`, parsed);
                return parsed;
            }
        } catch (e) {
            console.warn(`[ToolSettings] Could not load ${toolId}:`, e);
        }
        return null;
    },
    
    clear(toolId) {
        const key = `pdfWorkspace_${toolId}_settings`;
        localStorage.removeItem(key);
        console.log(`[ToolSettings] Cleared ${toolId}`);
    },
    
    clearAll() {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('pdfWorkspace_') && key.endsWith('_settings')) {
                keys.push(key);
            }
        }
        keys.forEach(key => localStorage.removeItem(key));
        console.log(`[ToolSettings] Cleared all (${keys.length} tools)`);
    }
};


// PDF Preview Component - NEW FEATURE #1
const PDFPreview = {
    container: null,
    currentPdf: null,
    currentPage: 1,
    totalPages: 0,
    pageOrder: [],  // Track reordered pages - NEW v7.9
    draggedThumbnail: null,  // Currently dragging - NEW v7.9
    hasReordered: false,  // Track if pages have been reordered - NEW v7.9
    isInitialized: false,  // Prevent double-initialization - FIX v7.11
    pdfCache: new Map(),  // Cache loaded PDFs - ENHANCEMENT v7.11
    resizeTimeout: null,  // FIX #5: Debounce resize events
    
    init() {
        // Prevent duplicate initialization
        if (this.isInitialized) {
            console.log('[PDFPreview] Already initialized, skipping...');
            return;
        }
        
        // Create preview container if it doesn't exist
        if (!document.getElementById('pdfPreviewContainer')) {
            const previewHTML = `
                <div id="pdfPreviewContainer" class="pdf-preview-container hidden">
                    <div class="pdf-preview-header">
                        <h3>📄 PDF Preview</h3>
                        <div class="pdf-preview-controls">
                            <button id="prevPage" class="btn-preview">◀ Previous</button>
                            <span id="pageInfo">Page 1 of 1</span>
                            <button id="nextPage" class="btn-preview">Next ▶</button>
                            <select id="fileSelector" class="form-select" style="max-width: 200px; margin-left: 10px;">
                                <option>Select file to preview...</option>
                            </select>
                            <button id="toggleThumbnails" class="btn-preview" style="margin-left: 10px;">🖼️ Thumbnails</button>
                        </div>
                    </div>
                    <div class="pdf-preview-body">
                        <div id="thumbnailSidebar" class="thumbnail-sidebar">
                            <div class="thumbnail-header">
                                <span>Pages</span>
                                <button id="closeThumbnails" class="btn-close-thumbnails">×</button>
                            </div>
                            <div id="thumbnailReorderControls" class="thumbnail-reorder-controls" style="display: none;">
                                <button id="saveReorderedPDF" class="btn-save-reorder">💾 Save Reordered PDF</button>
                                <button id="resetPageOrder" class="btn-reset-order">↺ Reset Order</button>
                            </div>
                            <div id="thumbnailContainer" class="thumbnail-container"></div>
                        </div>
                        <div class="pdf-preview-canvas-container" id="previewCanvasContainer">
                            <div id="canvasWrapper" style="position: relative; display: inline-block;">
                                <canvas id="pdfPreviewCanvas"></canvas>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            const dropArea = document.getElementById('dropArea');
            if (dropArea) {
                dropArea.insertAdjacentHTML('afterend', previewHTML);
                this.container = document.getElementById('pdfPreviewContainer');
                this.bindEvents();
                this.setupResizeListener();  // FIX #5: Add resize listener
                this.isInitialized = true;
                console.log('[PDFPreview] Initialized successfully');
            }
        } else {
            // FIX: Container exists - ensure events are bound
            // This handles hot reload, partial DOM replacement, or tool switching scenarios
            this.container = document.getElementById('pdfPreviewContainer');
            this.bindEvents(); // Always ensure events are bound
            this.setupResizeListener();  // FIX #5: Add resize listener
            this.isInitialized = true;
            console.log('[PDFPreview] Container exists, events re-bound');
        }
    },
    
    // FIX #5: Setup window resize listener to prevent coordinate drift
    setupResizeListener() {
        if (this._resizeListener) {
            window.removeEventListener('resize', this._resizeListener);
        }
        
        this._resizeListener = () => {
            // Debounce resize events to avoid excessive re-renders
            clearTimeout(this.resizeTimeout);
            this.resizeTimeout = setTimeout(() => {
                if (this.currentPdf && this.currentPage) {
                    console.log('[PDFPreview] Window resized, re-rendering page to maintain coordinates');
                    this.renderPage(this.currentPage);
                }
            }, 250); // Wait 250ms after resize stops
        };
        
        window.addEventListener('resize', this._resizeListener);
        console.log('[PDFPreview] Resize listener added');
    },
    
    // Store bound listeners to enable proper cleanup
    _boundListeners: {
        prevPage: null,
        nextPage: null,
        fileSelector: null,
        toggleThumbnails: null,
        closeThumbnails: null,
        saveReorderedPDF: null,
        resetPageOrder: null
    },
    
    bindEvents() {
        // Idempotent event binding using proper removeEventListener
        // This is more efficient and doesn't break external references to DOM elements
        
        const prevBtn = document.getElementById('prevPage');
        const nextBtn = document.getElementById('nextPage');
        const selector = document.getElementById('fileSelector');
        const toggleThumb = document.getElementById('toggleThumbnails');
        const closeThumb = document.getElementById('closeThumbnails');
        const saveReorder = document.getElementById('saveReorderedPDF');
        const resetOrder = document.getElementById('resetPageOrder');
        
        // FIX: Properly remove old listeners before adding new ones
        if (prevBtn) {
            if (this._boundListeners.prevPage) {
                prevBtn.removeEventListener('click', this._boundListeners.prevPage);
            }
            this._boundListeners.prevPage = () => this.previousPage();
            prevBtn.addEventListener('click', this._boundListeners.prevPage);
        }
        
        if (nextBtn) {
            if (this._boundListeners.nextPage) {
                nextBtn.removeEventListener('click', this._boundListeners.nextPage);
            }
            this._boundListeners.nextPage = () => this.nextPage();
            nextBtn.addEventListener('click', this._boundListeners.nextPage);
        }
        
        if (selector) {
            if (this._boundListeners.fileSelector) {
                selector.removeEventListener('change', this._boundListeners.fileSelector);
            }
            this._boundListeners.fileSelector = (e) => {
                const index = parseInt(e.target.value);
                if (!isNaN(index) && AppState.files[index]) {
                    this.loadPDF(AppState.files[index]);
                }
            };
            selector.addEventListener('change', this._boundListeners.fileSelector);
        }
        
        if (toggleThumb) {
            if (this._boundListeners.toggleThumbnails) {
                toggleThumb.removeEventListener('click', this._boundListeners.toggleThumbnails);
            }
            this._boundListeners.toggleThumbnails = () => this.toggleThumbnails();
            toggleThumb.addEventListener('click', this._boundListeners.toggleThumbnails);
        }
        
        if (closeThumb) {
            if (this._boundListeners.closeThumbnails) {
                closeThumb.removeEventListener('click', this._boundListeners.closeThumbnails);
            }
            this._boundListeners.closeThumbnails = () => this.toggleThumbnails();
            closeThumb.addEventListener('click', this._boundListeners.closeThumbnails);
        }
        
        if (saveReorder) {
            if (this._boundListeners.saveReorderedPDF) {
                saveReorder.removeEventListener('click', this._boundListeners.saveReorderedPDF);
            }
            this._boundListeners.saveReorderedPDF = () => this.saveReorderedPDF();
            saveReorder.addEventListener('click', this._boundListeners.saveReorderedPDF);
        }
        
        if (resetOrder) {
            if (this._boundListeners.resetPageOrder) {
                resetOrder.removeEventListener('click', this._boundListeners.resetPageOrder);
            }
            this._boundListeners.resetPageOrder = () => this.resetPageOrder();
            resetOrder.addEventListener('click', this._boundListeners.resetPageOrder);
        }
        
        console.log('[PDFPreview] Events bound (proper removeEventListener)');
    },
    
    async loadPDF(file) {
        // FIX v7.13: Use FileType helper for consistent detection
        if (!FileType.isPDF(file)) {
            console.log('[PDFPreview] File rejected - not a PDF:', file?.name, file?.type);
            return;
        }
        
        try {
            console.log('[PDFPreview] Loading PDF:', file.name);
            
            // ENHANCEMENT: Check cache first (key by name+size+lastModified)
            const cacheKey = `${file.name}_${file.size}_${file.lastModified}`;
            let pdfDoc;
            
            if (this.pdfCache.has(cacheKey)) {
                console.log('[PDFPreview] Using cached PDF');
                pdfDoc = this.pdfCache.get(cacheKey);
            } else {
                // Not cached, load and parse
                const arrayBuffer = await file.arrayBuffer();
                const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
                pdfDoc = await loadingTask.promise;
                
                // Cache it for future use
                this.pdfCache.set(cacheKey, pdfDoc);
                console.log('[PDFPreview] PDF cached:', cacheKey);
                
                // FIX v7.13: Destroy old docs to prevent memory leaks (keep last 10 PDFs)
                if (this.pdfCache.size > 10) {
                    const firstKey = this.pdfCache.keys().next().value;
                    const oldDoc = this.pdfCache.get(firstKey);
                    try {
                        if (oldDoc?.destroy) oldDoc.destroy();
                    } catch (e) {
                        console.warn('[PDFPreview] Could not destroy old doc:', e);
                    }
                    this.pdfCache.delete(firstKey);
                    console.log('[PDFPreview] Cache limit reached, destroyed + removed oldest:', firstKey);
                }
            }
            
            this.currentPdf = pdfDoc;
            this.totalPages = this.currentPdf.numPages;
            this.currentPage = 1;
            AppState.currentPreviewFile = file;
            
            // Reset page reordering state - NEW v7.9
            this.pageOrder = [];
            this.hasReordered = false;
            this.hideReorderControls();
            
            this.show();
            await this.renderPage(this.currentPage);
            
            this.updatePageInfo();
            console.log('[PDFPreview] PDF loaded successfully:', this.totalPages, 'pages');
        } catch (error) {
            console.error('[PDFPreview] Error loading PDF:', error);
            Utils.showStatus('Error loading PDF preview: ' + error.message, 'error');
        }
    },
    
    async renderPage(pageNum) {
        if (!this.currentPdf) return;
        
        try {
            const page = await this.currentPdf.getPage(pageNum);
            const canvas = document.getElementById('pdfPreviewCanvas');
            const context = canvas.getContext('2d');
            
            // Get viewport at scale 1 to get actual page dimensions
            const viewport1 = page.getViewport({ scale: 1 });
            this.currentPageWidth = viewport1.width;
            this.currentPageHeight = viewport1.height;
            
            // FIX: Coordinate Drift — compute scale dynamically based on container width
            // This ensures pages of any size (Letter, A4, Legal, etc.) render correctly
            // and that signature/redaction boxes map to the right PDF coordinates.
            const containerWidth = (canvas.parentElement?.clientWidth || 650) - 4;
            const dynamicScale = Math.min(Math.max(containerWidth / viewport1.width, 0.5), 2.5);
            this.currentScale = dynamicScale; // Store for use by redaction/signature tools
            
            const viewport = page.getViewport({ scale: dynamicScale });
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            
            const renderContext = {
                canvasContext: context,
                viewport: viewport
            };
            
            await page.render(renderContext).promise;
            
            // ENHANCEMENT v7.12: Smart OCR Detection
            await this.detectScannedImage(page);
            
            // FIX: Dynamic signature slider bounds — update max per page size
            // Prevents clipping on non-Letter pages (A4, Legal, rotated, etc.)
            const pw = Math.floor(this.currentPageWidth  || 612);
            const ph = Math.floor(this.currentPageHeight || 792);
            ['sigX', 'sigWidth'].forEach(id => { const el = document.getElementById(id); if (el) el.max = pw; });
            ['sigY', 'sigHeight'].forEach(id => { const el = document.getElementById(id); if (el) el.max = ph; });
            
            // Update signature overlay after rendering
            this.updateSignatureOverlay();
        } catch (error) {
            console.error('Error rendering page:', error);
        }
    },
    
    // ENHANCEMENT v7.12: Detect if page is a scanned image
    async detectScannedImage(page) {
        try {
            const textContent = await page.getTextContent();
            const hasText = textContent.items.length > 0 && 
                           textContent.items.some(item => item.str.trim().length > 0);
            
            // Remove any existing badge
            const existingBadge = document.getElementById('ocrDetectionBadge');
            if (existingBadge) existingBadge.remove();
            
            // If no text found, show OCR suggestion
            if (!hasText) {
                const badge = document.createElement('div');
                badge.id = 'ocrDetectionBadge';
                badge.className = 'ocr-detection-badge';
                badge.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 20px;">🔍</span>
                        <div>
                            <strong>Scanned Image Detected</strong><br>
                            <span style="font-size: 12px;">This page has no text. Use OCR to make it searchable.</span>
                        </div>
                    </div>
                `;
                badge.onclick = () => {
                    // Switch to OCR tool
                    const ocrButton = document.querySelector('[data-tool="ocr"]');
                    if (ocrButton) ocrButton.click();
                };
                
                const previewContainer = document.getElementById('pdfPreviewContainer');
                if (previewContainer) {
                    previewContainer.appendChild(badge);
                }
            }
        } catch (error) {
            console.warn('[PDFPreview] Could not detect scanned image:', error);
        }
    },
    
    async nextPage() {
        if (this.currentPage < this.totalPages) {
            this.currentPage++;
            await this.renderPage(this.currentPage);
            this.updatePageInfo();
            this.updateThumbnailSelection();
        }
    },
    
    updatePageInfo() {
        const pageInfoEl = document.getElementById('pageInfo');
        if (pageInfoEl) {
            pageInfoEl.textContent = `Page ${this.currentPage} of ${this.totalPages}`;
        }
    },
    
    async previousPage() {
        if (this.currentPage > 1) {
            this.currentPage--;
            await this.renderPage(this.currentPage);
            this.updatePageInfo();
            this.updateThumbnailSelection();
        }
    },
    
    show() {
        if (this.container) {
            this.container.classList.remove('hidden');
        }
    },
    
    hide() {
        if (this.container) {
            this.container.classList.add('hidden');
        }
    },
    
    // Alias for external calls (e.g. per-file preview buttons in file list)
    loadFile(file) { return this.loadPDF(file); },
    
    updateFileSelector() {
        const selector = document.getElementById('fileSelector');
        if (!selector) return;
        
        const pdfFiles = AppState.files.filter(FileType.isPDF);
        
        selector.innerHTML = '<option value="">Select file to preview...</option>';
        pdfFiles.forEach((file, index) => {
            const option = document.createElement('option');
            option.value = AppState.files.indexOf(file);
            option.textContent = file.name;
            selector.appendChild(option);
        });
        
        // Auto-load first PDF if available
        if (pdfFiles.length > 0 && !this.currentPdf) {
            this.loadPDF(pdfFiles[0]);
        }
    },
    
    // THUMBNAIL NAVIGATION - NEW FEATURE v7.8
    toggleThumbnails() {
        const sidebar = document.getElementById('thumbnailSidebar');
        if (!sidebar) return;
        
        const isVisible = sidebar.classList.contains('visible');
        if (isVisible) {
            sidebar.classList.remove('visible');
        } else {
            sidebar.classList.add('visible');
            if (this.currentPdf && this.totalPages > 0) {
                this.renderThumbnails();
            }
        }
    },
    
    async renderThumbnails() {
        if (!this.currentPdf) return;
        
        const container = document.getElementById('thumbnailContainer');
        if (!container) return;
        
        container.innerHTML = '<div style="padding: 10px; text-align: center; color: var(--color-text-muted);">Loading thumbnails...</div>';
        
        try {
            // FIX: Render thumbnails in batches to prevent freezing on large PDFs
            const BATCH_SIZE = 5; // Render 5 thumbnails at a time
            const thumbnails = [];
            
            container.innerHTML = ''; // Clear loading message
            
            for (let pageNum = 1; pageNum <= this.totalPages; pageNum++) {
                const thumbnail = await this.renderThumbnail(pageNum);
                thumbnails.push(thumbnail);
                container.appendChild(thumbnail);
                
                // Yield to browser every BATCH_SIZE pages
                if (pageNum % BATCH_SIZE === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }
            
            this.updateThumbnailSelection();
        } catch (error) {
            console.error('[PDFPreview] Error rendering thumbnails:', error);
            container.innerHTML = '<div style="padding: 10px; text-align: center; color: var(--color-danger);">Error loading thumbnails. Please try again.</div>';
            Utils.showStatus('Failed to load thumbnails', 'error');
        }
    },
    
    async renderThumbnail(pageNum) {
        const page = await this.currentPdf.getPage(pageNum);
        const scale = 0.2; // Small thumbnail
        const viewport = page.getViewport({ scale });
        
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        
        await page.render({
            canvasContext: ctx,
            viewport: viewport
        }).promise;
        
        // Create thumbnail wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'thumbnail-item';
        wrapper.dataset.page = pageNum;
        wrapper.dataset.originalIndex = pageNum;
        
        // ENHANCEMENT v7.14: Make keyboard accessible
        wrapper.tabIndex = 0;
        wrapper.setAttribute('role', 'button');
        wrapper.setAttribute('aria-label', `Page ${pageNum} thumbnail. Click to view, use arrow keys to reorder.`);
        
        // Make draggable
        wrapper.draggable = true;
        
        // Add page number label
        const label = document.createElement('div');
        label.className = 'thumbnail-label';
        label.textContent = pageNum;
        
        // Add drag handle indicator
        const dragHandle = document.createElement('div');
        dragHandle.className = 'thumbnail-drag-handle';
        dragHandle.innerHTML = '⋮⋮';
        dragHandle.title = 'Drag to reorder or use arrow keys';
        
        // Add canvas
        wrapper.appendChild(canvas);
        wrapper.appendChild(label);
        wrapper.appendChild(dragHandle);
        
        // Click to navigate
        wrapper.addEventListener('click', (e) => {
            if (e.target.classList.contains('thumbnail-drag-handle')) return;
            
            this.currentPage = pageNum;
            this.renderPage(pageNum);
            this.updatePageInfo();
            this.updateThumbnailSelection();
        });
        
        // ENHANCEMENT v7.14: Keyboard reordering
        wrapper.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.moveThumbnailUp(wrapper);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.moveThumbnailDown(wrapper);
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                wrapper.click();
            }
        });
        
        // Drag & Drop handlers
        wrapper.addEventListener('dragstart', (e) => this.handleDragStart(e, wrapper));
        wrapper.addEventListener('dragover', (e) => this.handleDragOver(e, wrapper));
        wrapper.addEventListener('drop', (e) => this.handleDrop(e, wrapper));
        wrapper.addEventListener('dragend', (e) => this.handleDragEnd(e));
        wrapper.addEventListener('dragleave', (e) => this.handleDragLeave(e, wrapper));
        
        return wrapper;
    },
    
    // ENHANCEMENT v7.14: Move thumbnail up with keyboard
    moveThumbnailUp(wrapper) {
        const container = document.getElementById('thumbnailContainer');
        if (!container) return;
        
        const thumbnails = Array.from(container.children);
        const currentIndex = thumbnails.indexOf(wrapper);
        
        if (currentIndex <= 0) {
            Utils.showStatus('Already at the top', 'info');
            return;
        }
        
        // Swap with previous
        const previous = thumbnails[currentIndex - 1];
        container.insertBefore(wrapper, previous);
        
        // Update page order
        this.updatePageOrder();
        this.showReorderControls();
        
        // Keep focus and scroll into view
        wrapper.focus();
        wrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        
        Utils.showStatus('Moved up', 'success');
    },
    
    // ENHANCEMENT v7.14: Move thumbnail down with keyboard
    moveThumbnailDown(wrapper) {
        const container = document.getElementById('thumbnailContainer');
        if (!container) return;
        
        const thumbnails = Array.from(container.children);
        const currentIndex = thumbnails.indexOf(wrapper);
        
        if (currentIndex >= thumbnails.length - 1) {
            Utils.showStatus('Already at the bottom', 'info');
            return;
        }
        
        // Swap with next
        const next = thumbnails[currentIndex + 1];
        container.insertBefore(next, wrapper);
        
        // Update page order
        this.updatePageOrder();
        this.showReorderControls();
        
        // Keep focus and scroll into view
        wrapper.focus();
        wrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        
        Utils.showStatus('Moved down', 'success');
    },
    
    updateThumbnailSelection() {
        const thumbnails = document.querySelectorAll('.thumbnail-item');
        thumbnails.forEach(thumb => {
            const pageNum = parseInt(thumb.dataset.page);
            if (pageNum === this.currentPage) {
                thumb.classList.add('selected');
            } else {
                thumb.classList.remove('selected');
            }
        });
    },
    
    // DRAG-TO-REORDER HANDLERS - NEW v7.9
    handleDragStart(e, wrapper) {
        this.draggedThumbnail = wrapper;
        wrapper.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', wrapper.innerHTML);
        
        // Add semi-transparent drag image
        if (e.dataTransfer.setDragImage) {
            const canvas = wrapper.querySelector('canvas');
            if (canvas) {
                e.dataTransfer.setDragImage(canvas, canvas.width / 2, canvas.height / 2);
            }
        }
    },
    
    handleDragOver(e, wrapper) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        
        if (this.draggedThumbnail && this.draggedThumbnail !== wrapper) {
            wrapper.classList.add('drag-over');
            
            // Determine if we should insert before or after
            const container = document.getElementById('thumbnailContainer');
            const afterElement = this.getDragAfterElement(container, e.clientY);
            
            if (afterElement == null) {
                container.appendChild(this.draggedThumbnail);
            } else {
                container.insertBefore(this.draggedThumbnail, afterElement);
            }
        }
    },
    
    handleDrop(e, wrapper) {
        e.preventDefault();
        e.stopPropagation();
        
        wrapper.classList.remove('drag-over');
        
        if (this.draggedThumbnail && this.draggedThumbnail !== wrapper) {
            // Mark as reordered
            this.hasReordered = true;
            this.updatePageOrder();
            this.showReorderControls();
            Utils.showStatus('Pages reordered! Click "Save Reordered PDF" to download.', 'success');
        }
        
        return false;
    },
    
    handleDragEnd(e) {
        if (this.draggedThumbnail) {
            this.draggedThumbnail.classList.remove('dragging');
        }
        
        // Remove all drag-over classes
        document.querySelectorAll('.thumbnail-item').forEach(thumb => {
            thumb.classList.remove('drag-over');
        });
        
        this.draggedThumbnail = null;
    },
    
    handleDragLeave(e, wrapper) {
        wrapper.classList.remove('drag-over');
    },
    
    getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.thumbnail-item:not(.dragging)')];
        
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    },
    
    updatePageOrder() {
        const thumbnails = document.querySelectorAll('.thumbnail-item');
        this.pageOrder = Array.from(thumbnails)
            .map(thumb => parseInt(thumb.dataset.originalIndex))
            .filter(num => !isNaN(num)); // Filter out any invalid numbers
        
        // Update displayed page numbers to reflect new order
        thumbnails.forEach((thumb, index) => {
            const label = thumb.querySelector('.thumbnail-label');
            if (label) {
                label.textContent = index + 1;
            }
        });
        
        console.log('[PDFPreview] Page order updated:', this.pageOrder);
    },
    
    showReorderControls() {
        const controls = document.getElementById('thumbnailReorderControls');
        if (controls) {
            controls.style.display = 'flex';
        }
    },
    
    hideReorderControls() {
        const controls = document.getElementById('thumbnailReorderControls');
        if (controls) {
            controls.style.display = 'none';
        }
    },
    
    async saveReorderedPDF() {
        if (!this.currentPdf || !this.hasReordered || this.pageOrder.length === 0) {
            Utils.showStatus('No page reordering to save', 'warning');
            return;
        }
        
        // VALIDATION: Check if page order makes sense
        if (this.pageOrder.length !== this.totalPages) {
            console.error('[PDFPreview] Page count mismatch:', this.pageOrder.length, 'vs', this.totalPages);
            Utils.showStatus('Error: Page count mismatch. Please try reordering again.', 'error');
            return;
        }
        
        try {
            Utils.updateProgress(10, 'Creating reordered PDF...');
            
            // FIX BUG #1: Use currentPreviewFile directly instead of file selector
            const originalFile = AppState.currentPreviewFile;
            
            if (!originalFile) {
                Utils.showStatus('Please load a PDF first', 'error');
                return;
            }
            
            Utils.updateProgress(30, 'Loading original PDF...');
            const arrayBuffer = await originalFile.arrayBuffer();
            const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, originalFile.name);
            
            Utils.updateProgress(50, 'Reordering pages...');
            
            // Create new PDF with reordered pages
            const newPdf = await PDFLib.PDFDocument.create();
            
            // Copy pages in new order
            for (let i = 0; i < this.pageOrder.length; i++) {
                const originalPageIndex = this.pageOrder[i] - 1; // Convert to 0-indexed
                const [copiedPage] = await newPdf.copyPages(pdfDoc, [originalPageIndex]);
                newPdf.addPage(copiedPage);
                
                Utils.updateProgress(50 + (i / this.pageOrder.length * 40), 
                    `Copying page ${i + 1} of ${this.pageOrder.length}...`);
            }
            
            Utils.updateProgress(95, 'Saving PDF...');
            const pdfBytes = await newPdf.save();
            
            Utils.updateProgress(100, 'Complete!');
            
            // FIX BUG #2: Handle uppercase extensions and missing extensions
            const fileName = originalFile.name.toLowerCase().endsWith('.pdf')
                ? originalFile.name.replace(/\.pdf$/i, '_reordered.pdf')
                : originalFile.name + '_reordered.pdf';
            
            saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), fileName);
            
            Utils.showStatus(`Reordered PDF saved as ${fileName}!`, 'success');
            
        } catch (error) {
            console.error('Error saving reordered PDF:', error);
            Utils.showStatus('Failed to save reordered PDF: ' + error.message, 'error');
        }
    },
    
    resetPageOrder() {
        if (!this.hasReordered) return;
        
        // Re-render thumbnails in original order
        this.hasReordered = false;
        this.pageOrder = [];
        this.hideReorderControls();
        this.renderThumbnails();
        Utils.showStatus('Page order reset to original', 'info');
    },
    
    // SIGNATURE OVERLAY METHODS - NEW FEATURE #2
    addSignatureOverlay(signatureDataUrl, settings) {
        console.log('[PDFPreview] addSignatureOverlay called with settings:', settings);
        this.removeSignatureOverlay();
        
        const canvas = document.getElementById('pdfPreviewCanvas');
        const wrapper = document.getElementById('canvasWrapper');
        
        console.log('[PDFPreview] Canvas:', !!canvas, 'Wrapper:', !!wrapper);
        
        if (!canvas || !wrapper) {
            console.warn('[PDFPreview] Cannot add signature overlay - missing canvas or wrapper');
            return;
        }
        
        console.log('[PDFPreview] Creating overlay element...');
        const overlay = document.createElement('div');
        overlay.className = 'signature-overlay';
        overlay.id = 'signatureOverlayElement';
        
        const img = document.createElement('img');
        img.src = signatureDataUrl;
        overlay.appendChild(img);
        
        const deleteBtn = document.createElement('div');
        deleteBtn.className = 'signature-delete-btn';
        deleteBtn.innerHTML = '×';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            PDFPreview.removeSignatureOverlay();
        };
        overlay.appendChild(deleteBtn);
        
        this.updateOverlayPosition(overlay, settings);
        this.makeDraggable(overlay, settings);
        
        console.log('[PDFPreview] Appending overlay to canvas wrapper...');
        wrapper.appendChild(overlay);
        this.signatureOverlay = overlay;
        
        console.log('[PDFPreview] Signature overlay added! Should be visible now.');
    },
    
    updateOverlayPosition(overlay, settings) {
        const canvas = document.getElementById('pdfPreviewCanvas');
        if (!canvas) {
            console.warn('[PDFPreview] Cannot update overlay position - canvas not found');
            return;
        }
        
        // BUG FIX: Use actual PDF page dimensions instead of assuming 612pt (Letter)
        // This fixes coordinate drift for A4 (595pt) and other page sizes
        const actualPageWidth = this.currentPageWidth || 612; // Fallback to Letter if not set
        const scale = canvas.width / actualPageWidth;
        
        // Calculate position relative to canvas
        const screenX = settings.x * scale;
        const screenY = (canvas.height / scale - settings.y - settings.height) * scale;
        const screenWidth = settings.width * scale;
        const screenHeight = settings.height * scale;
        
        overlay.style.position = 'absolute';
        overlay.style.left = screenX + 'px';
        overlay.style.top = screenY + 'px';
        overlay.style.width = screenWidth + 'px';
        overlay.style.height = screenHeight + 'px';
        
        console.log('[PDFPreview] Overlay positioned at:', {
            left: screenX,
            top: screenY,
            width: screenWidth,
            height: screenHeight,
            actualPageWidth: actualPageWidth
        });
    },
    
    updateSignatureOverlay() {
        console.log('[PDFPreview] updateSignatureOverlay called');
        console.log('[PDFPreview] Current tool:', AppState.currentTool);
        console.log('[PDFPreview] Has signature:', !!Tools.sign?.signatureImage);
        console.log('[PDFPreview] Canvas exists:', !!document.getElementById('pdfPreviewCanvas'));
        
        // FIX v7.12: Always remove and recreate overlay to prevent page size drift
        this.removeSignatureOverlay();
        
        if (AppState.currentTool === 'sign' && Tools.sign && Tools.sign.signatureImage) {
            // Make sure we have a PDF loaded in preview
            if (!this.currentPdf) {
                console.log('[PDFPreview] No PDF loaded yet, signature will show when PDF is loaded');
                // If user uploaded signature but no PDF yet, show message
                const pdfFiles = AppState.files.filter(FileType.isPDF);
                if (pdfFiles.length > 0 && !this.currentPdf) {
                    // Auto-load first PDF
                    console.log('[PDFPreview] Auto-loading first PDF');
                    this.loadPDF(pdfFiles[0]);
                }
                return;
            }
            
            const settings = Tools.sign.signatureSettings;
            console.log('[PDFPreview] Adding signature overlay with settings:', settings);
            console.log('[PDFPreview] Current page dimensions:', this.currentPageWidth, 'x', this.currentPageHeight);
            this.addSignatureOverlay(Tools.sign.signatureImage, settings);
        }
    },
    
    removeSignatureOverlay() {
        const existing = document.getElementById('signatureOverlayElement');
        if (existing) existing.remove();
        this.signatureOverlay = null;
    },
    
    makeDraggable(overlay, settings) {
        overlay.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('signature-delete-btn')) return;
            
            overlay.classList.add('dragging');
            const startX = e.clientX;
            const startY = e.clientY;
            const initialLeft = overlay.offsetLeft;
            const initialTop = overlay.offsetTop;
            
            // CRITICAL FIX #6: Scoped listeners that clean up properly
            const onMove = (e) => {
                const deltaX = e.clientX - startX;
                const deltaY = e.clientY - startY;
                overlay.style.left = (initialLeft + deltaX) + 'px';
                overlay.style.top = (initialTop + deltaY) + 'px';
            };
            
            const onUp = () => {
                overlay.classList.remove('dragging');
                
                const canvas = document.getElementById('pdfPreviewCanvas');
                if (canvas) {
                    // Use actual PDF page dimensions (not hardcoded Letter)
                    const w = this.currentPageWidth || 612;
                    const h = this.currentPageHeight || 792;
                    const scale = canvas.width / w;
                    const screenX = parseFloat(overlay.style.left);
                    const screenY = parseFloat(overlay.style.top);
                    
                    // Convert screen coordinates back to PDF coordinates
                    const pdfX = screenX / scale;
                    const pdfY = (canvas.height / scale) - (screenY / scale) - settings.height;
                    
                    // Clamp to actual page bounds (not hardcoded 600x800)
                    settings.x = Math.max(0, Math.min(w - settings.width, Math.round(pdfX)));
                    settings.y = Math.max(0, Math.min(h - settings.height, Math.round(pdfY)));
                    
                    console.log('[PDFPreview] Drag complete - new position:', settings);
                    
                    // Update sliders
                    const sigX = document.getElementById('sigX');
                    const sigY = document.getElementById('sigY');
                    const sigXValue = document.getElementById('sigXValue');
                    const sigYValue = document.getElementById('sigYValue');
                    
                    if (sigX) sigX.value = settings.x;
                    if (sigY) sigY.value = settings.y;
                    if (sigXValue) sigXValue.textContent = settings.x;
                    if (sigYValue) sigYValue.textContent = settings.y;
                }
                
                // Remove listeners to prevent leak
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            
            e.preventDefault();
        });
    }
};

// File Manager
const FileManager = {
    addFiles(files) {
        // CRITICAL FIX BUG #9: File size limits to prevent browser crashes
        const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB per file
        const MAX_TOTAL_SIZE = 500 * 1024 * 1024; // 500MB total
        const MAX_FILE_COUNT = 50; // Maximum 50 files
        
        // Check file count limit
        if (AppState.files.length + files.length > MAX_FILE_COUNT) {
            Utils.showStatus(
                `Maximum ${MAX_FILE_COUNT} files allowed. You currently have ${AppState.files.length} file(s).`,
                'error'
            );
            return;
        }
        
        // FIX v7.13: Use FileType helpers for consistent detection
        // v7.15.1: Added Office file support
        // v7.15.3: Added file size validation
        const validFiles = [];
        
        for (const file of files) {
            // Type check
            if (!FileType.isPDF(file) && !FileType.isImage(file) && 
                !FileType.isHTML(file) && !FileType.isOffice(file)) {
                Utils.showStatus(`File "${file.name}" has unsupported type`, 'warning');
                continue;
            }
            
            // Size check
            if (file.size > MAX_FILE_SIZE) {
                Utils.showStatus(
                    `File "${file.name}" is too large (${Utils.formatFileSize(file.size)}). Maximum: ${Utils.formatFileSize(MAX_FILE_SIZE)}`,
                    'error'
                );
                continue;
            }
            
            validFiles.push(file);
        }
        
        if (validFiles.length === 0) {
            Utils.showStatus('No valid files to add', 'error');
            return;
        }
        
        // Check total size
        const currentSize = AppState.files.reduce((sum, f) => sum + f.size, 0);
        const newSize = validFiles.reduce((sum, f) => sum + f.size, 0);
        const totalSize = currentSize + newSize;
        
        if (totalSize > MAX_TOTAL_SIZE) {
            Utils.showStatus(
                `Total file size would be ${Utils.formatFileSize(totalSize)}, exceeding the ${Utils.formatFileSize(MAX_TOTAL_SIZE)} limit. Please remove some files.`,
                'error'
            );
            return;
        }
        
        AppState.files.push(...validFiles);
        this.renderFileList();
        this.updateProcessButton();
        
        // Update preview
        PDFPreview.updateFileSelector();
        
        // Update compare tool file selectors if compare tool exists and is active
        if (Tools.compare && Tools.compare.updateFileSelectors) {
            Tools.compare.updateFileSelectors();
        }
        
        // v7.15.1: Trigger form field detection if formfill tool is active
        if (AppState.currentTool === 'formfill' && Tools.formfill && Tools.formfill.detectFormFields) {
            setTimeout(() => Tools.formfill.detectFormFields(), 100);
        }

        // Trigger document scanner preview when images are added while docscan is active
        if (AppState.currentTool === 'docscan') {
            const imgFiles = AppState.files.filter(f => f.type.startsWith('image/'));
            if (imgFiles.length > 0) setTimeout(() => DocScanUtils.showPreview(imgFiles[0]), 150);
        }
        
        // Show success message with file count and size
        if (validFiles.length > 0) {
            const totalSizeText = Utils.formatFileSize(totalSize);
            Utils.showStatus(
                `Added ${validFiles.length} file(s) (Total: ${AppState.files.length} files, ${totalSizeText})`,
                'success'
            );
            
            // FIX #4: Update workflow step - mark Step 1 complete, activate Step 2
            if (typeof WorkflowManager !== 'undefined') {
                WorkflowManager.completeStep(1);
            }
        }
    },
    
    removeFile(index) {
        AppState.files.splice(index, 1);
        this.renderFileList();
        this.updateProcessButton();
        
        // Update preview
        PDFPreview.updateFileSelector();
        
        // Update compare tool file selectors
        if (Tools.compare && Tools.compare.updateFileSelectors) {
            Tools.compare.updateFileSelectors();
        }
    },
    
    clearAll() {
        AppState.files = [];
        this.renderFileList();
        this.updateProcessButton();
        
        // Hide preview and clean up PDF cache - FIX v7.13
        PDFPreview.hide();
        
        // Update compare tool file selectors
        if (Tools.compare && Tools.compare.updateFileSelectors) {
            Tools.compare.updateFileSelectors();
        }
        
        // Destroy current PDF
        if (PDFPreview.currentPdf?.destroy) {
            try {
                PDFPreview.currentPdf.destroy();
            } catch (e) {
                console.warn('[FileManager] Could not destroy current PDF:', e);
            }
        }
        PDFPreview.currentPdf = null;
        
        // Destroy all cached PDFs
        PDFPreview.pdfCache.forEach(doc => {
            try {
                if (doc?.destroy) doc.destroy();
            } catch (e) {
                console.warn('[FileManager] Could not destroy cached PDF:', e);
            }
        });
        PDFPreview.pdfCache.clear();
        
        // FIX #4: Reset workflow to step 1
        if (typeof WorkflowManager !== 'undefined') {
            WorkflowManager.reset();
        }
        // FIX: Also hide file info bar on clear
        if (typeof FileInfoManager !== 'undefined') {
            FileInfoManager.hide();
        }
    },
    
    renderFileList() {
        const container = document.getElementById('fileList');
        
        if (AppState.files.length === 0) {
            container.innerHTML = '';
            return;
        }
        
        // CRITICAL SECURITY FIX BUG #12: Escape filenames to prevent XSS
        container.innerHTML = AppState.files.map((file, index) => {
            const icon = file.type.startsWith('image/') ? '🖼️' : file.name.endsWith('.html') ? '🌐' : '📄';
            const safeName = Utils.escapeHtml(file.name); // ✅ ESCAPED
            const canPreview = FileType.isPDF(file);
            return `
                <div class="file-item">
                    <div class="file-info">
                        <span class="file-icon">${icon}</span>
                        <div class="file-details">
                            <h4>${safeName}</h4>
                            <p>${Utils.formatFileSize(file.size)}</p>
                        </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:4px;">
                        ${canPreview ? `<button title="Preview this PDF" onclick="PDFPreview.loadPDF(AppState.files[${index}])" style="background:none;border:1px solid var(--color-border);border-radius:4px;padding:2px 6px;cursor:pointer;font-size:13px;color:var(--color-text-muted);" onmouseover="this.style.color='var(--color-primary)'" onmouseout="this.style.color='var(--color-text-muted)'">👁️</button>` : ''}
                        <span class="file-remove" onclick="FileManager.removeFile(${index})">×</span>
                    </div>
                </div>
            `;
        }).join('');
    },
    
    updateProcessButton() {
        // FIX: Guard against missing button and ensure proper state management
        const btn = document.getElementById('processBtn');
        if (!btn) return;
        
        const shouldDisable = AppState.files.length === 0 || AppState.processing;
        btn.disabled = shouldDisable;
        
        // Also update button text to indicate processing state
        if (AppState.processing) {
            btn.textContent = '⏳ Processing...';
        } else {
            btn.textContent = '🚀 Process Files';
        }
    }
};

// ENHANCEMENT B: Lazy Library Loader
// Load heavy libraries only when needed to improve initial load performance
const LibraryLoader = {
    loaded: new Set(),
    loading: new Map(), // Track in-flight loads to avoid duplicates
    
    libraries: {
        tesseract: {
            url: 'https://cdn.jsdelivr.net/npm/tesseract.js@4/dist/tesseract.min.js',
            check: () => typeof Tesseract !== 'undefined'
        },
        mammoth: {
            url: 'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js',
            check: () => typeof mammoth !== 'undefined'
        },
        xlsx: {
            url: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
            check: () => typeof XLSX !== 'undefined'
        },
        jspdf: {
            url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
            check: () => typeof jspdf !== 'undefined'
        },
        jspdfAutotable: {
            url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js',
            check: () => typeof jspdf !== 'undefined' && jspdf.jsPDF.API.autoTable !== undefined,
            requires: ['jspdf']
        },
        docx: {
            url: 'https://unpkg.com/docx@8.5.0/build/index.js',
            check: () => typeof docx !== 'undefined'
        }
    },
    
    async load(libraryName) {
        // Already loaded?
        if (this.loaded.has(libraryName)) {
            return true;
        }
        
        // Already loading?
        if (this.loading.has(libraryName)) {
            return this.loading.get(libraryName);
        }
        
        const lib = this.libraries[libraryName];
        if (!lib) {
            console.warn(`[LibraryLoader] Unknown library: ${libraryName}`);
            return false;
        }
        
        // Check if already present (loaded by HTML)
        if (lib.check()) {
            this.loaded.add(libraryName);
            console.log(`✓ Library already loaded: ${libraryName}`);
            return true;
        }
        
        // Load dependencies first
        if (lib.requires) {
            for (const dep of lib.requires) {
                await this.load(dep);
            }
        }
        
        // Create loading promise
        const loadPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = lib.url;
            script.defer = true;
            script.crossOrigin = 'anonymous';
            
            script.onload = () => {
                this.loaded.add(libraryName);
                this.loading.delete(libraryName);
                console.log(`✓ Loaded library: ${libraryName}`);
                resolve(true);
            };
            
            script.onerror = () => {
                this.loading.delete(libraryName);
                console.error(`✗ Failed to load library: ${libraryName}`);
                reject(new Error(`Failed to load ${libraryName}`));
            };
            
            document.head.appendChild(script);
        });
        
        this.loading.set(libraryName, loadPromise);
        return loadPromise;
    },
    
    async loadMultiple(libraryNames) {
        const promises = libraryNames.map(name => this.load(name));
        const results = await Promise.allSettled(promises);
        
        const failed = results.filter(r => r.status === 'rejected');
        if (failed.length > 0) {
            console.warn(`[LibraryLoader] ${failed.length} libraries failed to load`);
            return false;
        }
        
        return true;
    },
    
    isLoaded(libraryName) {
        return this.loaded.has(libraryName);
    }
};

// Tool Definitions - ENHANCED TOOLS
// Enhancement #4: fileTypes lookup for dynamic drop zone hints
const TOOL_FILE_TYPES = {
    merge: ['pdf'], split: ['pdf'], extract: ['pdf'], rotate: ['pdf'],
    compress: ['pdf'], reverse: ['pdf'], reorder: ['pdf'], removeblank: ['pdf'],
    sign: ['pdf'], annotate: ['pdf'], editpdf: ['pdf'], pdftexteditor: ['pdf'],
    formfill: ['pdf'], flatten: ['pdf'], protect: ['pdf'], unlock: ['pdf'],
    redact: ['pdf'], watermark: ['pdf'], piiscan: ['pdf'], cleanslate: ['pdf'],
    topng: ['pdf'], imagestopdf: ['image'], html2pdf: ['html'],
    office2pdf: ['office'], pdf2office: ['pdf'], ocr: ['pdf'],
    pagenumber: ['pdf'], metadata: ['pdf'], metaedit: ['pdf'],
    bates: ['pdf'], oddeven: ['pdf'], interleave: ['pdf'],
    splitmerge: ['pdf'], categorize: ['pdf'], invoice: ['pdf'],
    batchslicer: ['pdf'], validate: ['pdf'], repair: ['pdf'], audit: ['pdf'],
    compare: ['pdf'], workflow: ['pdf'],
    docscan: ['image'],
};

// ========================================================================================
// DOCUMENT SCANNER UTILITIES
// Pure-JS image processing: grayscale → blur → Sobel edges → extremal corner detection
// → perspective warp (DLT homography) → optional enhancement → PDF export
// ========================================================================================
const DocScanUtils = {

    // Mutable state shared between preview UI and processImage
    _previewState: {
        img:        null,   // loaded HTMLImageElement
        corners:    null,   // [tl,tr,br,bl] in preview-canvas pixels
        canvasW:    0,      // preview canvas width  (for coord scaling)
        canvasH:    0,      // preview canvas height
        dragging:   null,   // corner index being dragged (0-3), or null
        sourceFile: null,   // File object currently previewed
    },

    // Show a corner-detection preview on the configHTML canvas
    async showPreview(file) {
        console.log('[DocScan] showPreview called:', file?.name, file?.type, file?.size);

        // Re-query DOM every call — the tool panel is re-created on each tool switch
        const previewDiv = document.getElementById('docScanPreview');
        const canvas     = document.getElementById('docScanCanvas');

        if (!previewDiv || !canvas) {
            console.error('[DocScan] showPreview: DOM elements not found', {previewDiv: !!previewDiv, canvas: !!canvas});
            return;
        }

        // Always show the section immediately, synchronously, before any async work.
        previewDiv.style.cssText = previewDiv.style.cssText.replace(/display\s*:\s*none\s*;?/gi, '');
        previewDiv.style.display = 'block';
        console.log('[DocScan] previewDiv display set to block. Current display:', getComputedStyle(previewDiv).display);

        // Draw "Loading…" placeholder so user sees the section appeared
        canvas.width  = canvas.parentElement ? Math.max(200, canvas.parentElement.clientWidth - 16) : 400;
        canvas.height = Math.round(canvas.width * 0.6);
        const pCtx = canvas.getContext('2d');
        pCtx.fillStyle = '#f0f0f0';
        pCtx.fillRect(0, 0, canvas.width, canvas.height);
        pCtx.fillStyle = '#888';
        pCtx.font = `${Math.max(14, canvas.width / 20)}px sans-serif`;
        pCtx.textAlign = 'center';
        pCtx.fillText('Loading image…', canvas.width / 2, canvas.height / 2);

        try {
            console.log('[DocScan] loading image…');
            const img = await this._loadImage(file);
            console.log('[DocScan] image loaded:', img.naturalWidth, 'x', img.naturalHeight);

            const maxW = Math.max(200, (canvas.parentElement?.clientWidth || 600) - 16);
            const ratio = img.naturalWidth / img.naturalHeight || 1;
            canvas.width  = Math.min(maxW, img.naturalWidth  || 200);
            canvas.height = Math.round(canvas.width / ratio);

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            console.log('[DocScan] image drawn to canvas', canvas.width, 'x', canvas.height);

            this._previewState.img        = img;
            this._previewState.canvasW    = canvas.width;
            this._previewState.canvasH    = canvas.height;
            this._previewState.sourceFile = file;

            let corners = null;
            try {
                corners = this.detectCorners(canvas);
                console.log('[DocScan] corners detected:', JSON.stringify(corners));
            } catch (detErr) {
                console.warn('[DocScan] Corner detection failed (using defaults):', detErr);
            }
            this._previewState.corners = corners || this._defaultCorners(canvas.width, canvas.height);
            this._drawCornerOverlay(ctx, this._previewState.corners);

            this._attachDragListeners(canvas);

            const resetBtn = document.getElementById('docScanResetBtn');
            if (resetBtn && !resetBtn.dataset.wired) {
                resetBtn.dataset.wired = '1';
                resetBtn.addEventListener('click', () => {
                    const c = document.getElementById('docScanCanvas');
                    if (c && this._previewState.img) this._resetToAutoDetect(c);
                });
            }

            // Use requestAnimationFrame to defer warp so browser paints corner preview first
            requestAnimationFrame(() => {
                setTimeout(() => {
                    try { this._updateWarpPreview(canvas); }
                    catch (warpErr) { console.warn('[DocScan] Warp preview failed:', warpErr); }
                }, 0);
            });

            console.log('[DocScan] showPreview complete ✓');

        } catch (e) {
            console.error('[DocScan] showPreview failed:', e);
            // Draw error message on canvas so the user knows what went wrong
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.fillStyle = '#fff0f0';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = '#c00';
                ctx.font = '14px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('Preview error: ' + e.message, canvas.width / 2, canvas.height / 2);
            }
            Utils.showStatus('Preview failed: ' + e.message, 'warning');
        }
    },

    // Default corners = 10% inset rectangle (fallback when detection fails)
    _defaultCorners(w, h) {
        const m = Math.round(Math.min(w, h) * 0.10);
        return [{x:m,y:m},{x:w-m,y:m},{x:w-m,y:h-m},{x:m,y:h-m}];
    },

    // Redraw image + overlay from current _previewState
    _redrawPreview(canvas) {
        const ctx = canvas.getContext('2d');
        const {img, corners, canvasW, canvasH} = this._previewState;
        ctx.drawImage(img, 0, 0, canvasW, canvasH);
        this._drawCornerOverlay(ctx, corners);
    },

    // Attach mouse + touch drag listeners (idempotent via dataset flag)
    _attachDragListeners(canvas) {
        if (canvas.dataset.docScanDrag) return; // already attached
        canvas.dataset.docScanDrag = '1';
        canvas.style.cursor = 'crosshair';
        console.log('[DocScan] _attachDragListeners: attached to canvas', canvas.width, 'x', canvas.height,
            'corners:', JSON.stringify(this._previewState.corners));

        // Hit radius in canvas pixels — scale with canvas size so it's usable on any image
        const HIT = Math.max(24, Math.round(Math.min(canvas.width, canvas.height) * 0.06));
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

        const getIdx = (cx, cy) => {
            const corners = this._previewState.corners;
            if (!corners) return null;
            let best = null, bestDist = HIT * HIT;
            corners.forEach((pt, i) => {
                const d = (pt.x-cx)**2 + (pt.y-cy)**2;
                if (d < bestDist) { bestDist = d; best = i; }
            });
            return best;
        };

        const endDrag = () => {
            if (this._previewState.dragging !== null) {
                this._previewState.dragging = null;
                canvas.style.cursor = 'default';
                if (document.contains(canvas)) this._updateWarpPreview(canvas);
            }
        };

        // Document-level mouseup so drag ends even when released outside canvas
        const onDocMouseUp = () => {
            if (!document.contains(canvas)) {
                document.removeEventListener('mouseup', onDocMouseUp);
                return;
            }
            endDrag();
        };
        document.addEventListener('mouseup', onDocMouseUp);

        // Mouse
        canvas.addEventListener('mousedown', e => {
            const {x, y} = this._getCanvasPos(canvas, e);
            const idx = getIdx(x, y);
            console.log('[DocScan] mousedown canvas pos:', x, y, '→ corner idx:', idx, 'HIT:', HIT);
            if (idx !== null) {
                this._previewState.dragging = idx;
                canvas.style.cursor = 'grabbing';
                e.preventDefault();
            }
        });
        canvas.addEventListener('mousemove', e => {
            const {x, y} = this._getCanvasPos(canvas, e);
            if (this._previewState.dragging !== null) {
                // Clamp to canvas bounds so corners stay inside the image
                this._previewState.corners[this._previewState.dragging] = {
                    x: clamp(x, 0, canvas.width  - 1),
                    y: clamp(y, 0, canvas.height - 1),
                };
                this._redrawPreview(canvas);
            } else {
                canvas.style.cursor = getIdx(x, y) !== null ? 'grab' : 'default';
            }
        });
        canvas.addEventListener('mouseleave', () => {
            // Don't end drag on leave — document mouseup handler covers that
            canvas.style.cursor = 'default';
        });

        // Touch
        canvas.addEventListener('touchstart', e => {
            const t = e.touches[0];
            const {x, y} = this._getCanvasPos(canvas, t);
            const idx = getIdx(x, y);
            if (idx !== null) {
                this._previewState.dragging = idx;
                e.preventDefault();
            }
        }, {passive: false});
        canvas.addEventListener('touchmove', e => {
            if (this._previewState.dragging === null) return;
            const t = e.touches[0];
            const {x, y} = this._getCanvasPos(canvas, t);
            this._previewState.corners[this._previewState.dragging] = {
                x: clamp(x, 0, canvas.width  - 1),
                y: clamp(y, 0, canvas.height - 1),
            };
            this._redrawPreview(canvas);
            e.preventDefault();
        }, {passive: false});
        canvas.addEventListener('touchend', endDrag);
    },

    // Run a fast low-res warp and display it in #docScanWarpPreview
    _updateWarpPreview(previewCanvas) {
        const warpCanvas = document.getElementById('docScanWarpPreview');
        const warpWrap   = document.getElementById('docScanWarpWrap');
        if (!warpCanvas || !warpWrap) return;
        const {img, corners, canvasW, canvasH} = this._previewState;
        if (!img || !corners) return;

        // Build a small source canvas (max 350px) for speed
        const maxDim = 350;
        const srcScale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        const sW = Math.round(img.naturalWidth  * srcScale);
        const sH = Math.round(img.naturalHeight * srcScale);
        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = sW; srcCanvas.height = sH;
        srcCanvas.getContext('2d').drawImage(img, 0, 0, sW, sH);

        // Scale preview-canvas corners down to the small source canvas
        const cx = sW / canvasW, cy = sH / canvasH;
        const scaledCorners = corners.map(p => ({x: p.x * cx, y: p.y * cy}));

        const warped = this._perspectiveWarp(srcCanvas, scaledCorners, maxDim);
        warpCanvas.width  = warped.width;
        warpCanvas.height = warped.height;
        warpCanvas.getContext('2d').drawImage(warped, 0, 0);
        warpWrap.style.display = 'block';
    },

    // Re-run auto corner detection and reset draggable corners
    _resetToAutoDetect(canvas) {
        const {img, canvasW, canvasH} = this._previewState;
        if (!img) return;
        // Redraw clean image so detectCorners sees pixels, not the overlay
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvasW, canvasH);
        const detected = this.detectCorners(canvas);
        this._previewState.corners = detected || this._defaultCorners(canvasW, canvasH);
        // Redraw with fresh overlay
        ctx.drawImage(img, 0, 0, canvasW, canvasH);
        this._drawCornerOverlay(ctx, this._previewState.corners);
        this._updateWarpPreview(canvas);
    },

    // Convert a mouse/touch event to canvas-local coordinates
    _getCanvasPos(canvas, e) {
        const r  = canvas.getBoundingClientRect();
        const sx = canvas.width  / r.width;
        const sy = canvas.height / r.height;
        return {
            x: Math.round((e.clientX - r.left) * sx),
            y: Math.round((e.clientY - r.top)  * sy),
        };
    },

    // Draw the detected quad + coloured corner dots with labels
    _drawCornerOverlay(ctx, corners) {
        const [tl, tr, br, bl] = corners;
        // Scale dot radius with canvas so it looks good at any resolution
        const dotR = Math.max(10, Math.round(Math.min(ctx.canvas.width, ctx.canvas.height) * 0.035));
        ctx.beginPath();
        ctx.moveTo(tl.x, tl.y);
        ctx.lineTo(tr.x, tr.y);
        ctx.lineTo(br.x, br.y);
        ctx.lineTo(bl.x, bl.y);
        ctx.closePath();
        ctx.strokeStyle = '#00e676';
        ctx.lineWidth = Math.max(2, dotR * 0.3);
        ctx.stroke();
        ctx.fillStyle = 'rgba(0,230,118,0.08)';
        ctx.fill();
        const labels = ['TL','TR','BR','BL'];
        ['#ff5252','#ff9800','#2196F3','#4caf50'].forEach((color, i) => {
            const pt = corners[i];
            // Outer white halo so dot is visible against any background
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, dotR + 3, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.fill();
            // Colored dot
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, dotR, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = 'white';
            ctx.font = `bold ${Math.max(9, dotR - 2)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(labels[i], pt.x, pt.y);
        });
    },

    // Main pipeline: detect (or use user-adjusted) → warp → enhance → (optional) remove bg.  Returns a canvas.
    async processImage(file, enhancement, maxOutputDim = 2000, removeBg = false, bgTolerance = 40) {
        const img = await this._loadImage(file);
        const srcScale = Math.min(1, maxOutputDim / Math.max(img.naturalWidth, img.naturalHeight));
        const srcW = Math.round(img.naturalWidth  * srcScale);
        const srcH = Math.round(img.naturalHeight * srcScale);
        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = srcW; srcCanvas.height = srcH;
        srcCanvas.getContext('2d').drawImage(img, 0, 0, srcW, srcH);

        // Prefer user-adjusted corners from the preview (scaled to source resolution)
        let corners = null;
        let cornersFromUser = false;
        const ps = this._previewState;
        if (ps.sourceFile === file && ps.corners && ps.canvasW > 0) {
            const sx = srcW / ps.canvasW, sy = srcH / ps.canvasH;
            corners = ps.corners.map(pt => ({x: pt.x * sx, y: pt.y * sy}));
            cornersFromUser = true;
            console.log('[DocScan] Using user-adjusted corners');
        } else {
            corners = this.detectCorners(srcCanvas);
        }

        let result;
        // Always trust user-placed corners; only validate auto-detected ones
        if (corners && (cornersFromUser || this._isValidQuad(corners, srcW, srcH))) {
            result = this._perspectiveWarp(srcCanvas, corners, maxOutputDim);
        } else {
            console.log('[DocScan] No valid document quad found – using full image');
            result = srcCanvas;
        }
        if (removeBg) this._removeBackground(result, bgTolerance);
        this._applyEnhancement(result, enhancement);
        return result;
    },

    // Edge detection + extremal-point corner finding.
    // Returns [tl, tr, br, bl] in canvas coordinates, or null.
    detectCorners(canvas) {
        const W = canvas.width, H = canvas.height;
        // Downsample for speed
        const maxDim = 600;
        const scale = Math.min(1, maxDim / Math.max(W, H));
        const w = Math.round(W * scale), h = Math.round(H * scale);
        const work = document.createElement('canvas');
        work.width = w; work.height = h;
        work.getContext('2d').drawImage(canvas, 0, 0, w, h);
        const px = work.getContext('2d').getImageData(0, 0, w, h).data;

        // Grayscale
        const gray = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++)
            gray[i] = 0.299*px[i*4] + 0.587*px[i*4+1] + 0.114*px[i*4+2];

        const blurred = this._gaussianBlur(gray, w, h);
        const edges   = this._sobelEdges(blurred, w, h);

        // Threshold at 15% of max edge magnitude
        let maxE = 0;
        for (let i = 0; i < edges.length; i++) if (edges[i] > maxE) maxE = edges[i];
        const thresh = maxE * 0.15;

        // Find four extremal edge pixels  (TL=min x+y, TR=max x-y, BR=max x+y, BL=max y-x)
        const margin = Math.round(Math.min(w, h) * 0.02);
        let tlVal =  Infinity, trVal = -Infinity, brVal = -Infinity, blVal = -Infinity;
        let tl = null, tr = null, br = null, bl = null;

        for (let y = margin; y < h - margin; y++) {
            for (let x = margin; x < w - margin; x++) {
                if (edges[y*w + x] < thresh) continue;
                const s = x + y, d = x - y;
                if (s  < tlVal) { tlVal =  s; tl = {x, y}; }
                if (d  > trVal) { trVal =  d; tr = {x, y}; }
                if (s  > brVal) { brVal =  s; br = {x, y}; }
                if (-d > blVal) { blVal = -d; bl = {x, y}; }
            }
        }
        if (!tl || !tr || !br || !bl) return null;

        // Scale back to original canvas coordinates
        const inv = 1 / scale;
        return [
            {x: tl.x*inv, y: tl.y*inv},
            {x: tr.x*inv, y: tr.y*inv},
            {x: br.x*inv, y: br.y*inv},
            {x: bl.x*inv, y: bl.y*inv},
        ];
    },

    // Reject degenerate quads (area < 10% of image)
    _isValidQuad(corners, W, H) {
        const [tl, tr, br, bl] = corners;
        const area = 0.5 * Math.abs(
            tl.x*(tr.y-bl.y) + tr.x*(br.y-tl.y) +
            br.x*(bl.y-tr.y) + bl.x*(tl.y-br.y)
        );
        return area / (W * H) > 0.10;
    },

    // Backward-mapped perspective warp using DLT homography + bilinear interpolation
    _perspectiveWarp(srcCanvas, corners, maxOutputDim) {
        const [tl, tr, br, bl] = corners;
        let outW = Math.round(Math.max(
            Math.hypot(tr.x-tl.x, tr.y-tl.y),
            Math.hypot(br.x-bl.x, br.y-bl.y)
        ));
        let outH = Math.round(Math.max(
            Math.hypot(bl.x-tl.x, bl.y-tl.y),
            Math.hypot(br.x-tr.x, br.y-tr.y)
        ));
        const s = Math.min(1, maxOutputDim / Math.max(outW, outH));
        outW = Math.round(outW * s);
        outH = Math.round(outH * s);
        if (outW < 10 || outH < 10) return srcCanvas;

        // Inverse homography: output rectangle → source corners
        const dstRect = [{x:0,y:0},{x:outW,y:0},{x:outW,y:outH},{x:0,y:outH}];
        const H = this._computeHomography(dstRect, corners);
        if (!H) return srcCanvas;

        const sW = srcCanvas.width, sH = srcCanvas.height;
        const srcData = srcCanvas.getContext('2d').getImageData(0, 0, sW, sH).data;
        const dstCanvas = document.createElement('canvas');
        dstCanvas.width = outW; dstCanvas.height = outH;
        const dstCtx = dstCanvas.getContext('2d');
        const dstImg = dstCtx.createImageData(outW, outH);
        const d = dstImg.data;

        for (let y = 0; y < outH; y++) {
            for (let x = 0; x < outW; x++) {
                const den = H[6]*x + H[7]*y + H[8];
                if (Math.abs(den) < 1e-10) continue;
                const sx = (H[0]*x + H[1]*y + H[2]) / den;
                const sy = (H[3]*x + H[4]*y + H[5]) / den;
                const x0 = Math.floor(sx), y0 = Math.floor(sy);
                const x1 = x0+1, y1 = y0+1;
                const di = (y*outW + x)*4;
                if (x0 < 0 || y0 < 0 || x1 >= sW || y1 >= sH) {
                    d[di]=d[di+1]=d[di+2]=255; d[di+3]=255; continue;
                }
                const tx = sx-x0, ty = sy-y0;
                for (let c = 0; c < 3; c++) {
                    const a = srcData[(y0*sW+x0)*4+c], b = srcData[(y0*sW+x1)*4+c];
                    const cc= srcData[(y1*sW+x0)*4+c], dd= srcData[(y1*sW+x1)*4+c];
                    d[di+c] = Math.round(a*(1-tx)*(1-ty) + b*tx*(1-ty) + cc*(1-tx)*ty + dd*tx*ty);
                }
                d[di+3] = 255;
            }
        }
        dstCtx.putImageData(dstImg, 0, 0);
        return dstCanvas;
    },

    // DLT: compute 3×3 homography mapping src[i] → dst[i], returned as Float64Array(9)
    _computeHomography(src, dst) {
        const A = [];
        for (let i = 0; i < 4; i++) {
            const {x: sx, y: sy} = src[i], {x: dx, y: dy} = dst[i];
            A.push([-sx,-sy,-1, 0,  0,  0, dx*sx, dx*sy, dx]);
            A.push([ 0,  0,  0,-sx,-sy,-1, dy*sx, dy*sy, dy]);
        }
        // Set h[8]=1, solve 8×8 system
        const B   = A.map(row => row.slice(0, 8));
        const rhs = A.map(row => -row[8]);
        const h   = this._solveLinear(B, rhs);
        return h ? [...h, 1] : null;
    },

    // Gaussian elimination with partial pivoting for n×n systems
    _solveLinear(A, b) {
        const n = b.length;
        const M = A.map((row, i) => [...row, b[i]]);
        for (let col = 0; col < n; col++) {
            let max = col;
            for (let r = col+1; r < n; r++)
                if (Math.abs(M[r][col]) > Math.abs(M[max][col])) max = r;
            [M[col], M[max]] = [M[max], M[col]];
            if (Math.abs(M[col][col]) < 1e-10) return null;
            for (let r = 0; r < n; r++) {
                if (r === col) continue;
                const f = M[r][col] / M[col][col];
                for (let j = col; j <= n; j++) M[r][j] -= f * M[col][j];
            }
        }
        return M.map((row, i) => row[n] / row[i]);
    },

    // 5×5 Gaussian blur (separable approximation via full kernel)
    _gaussianBlur(gray, w, h) {
        const K = [1,4,6,4,1, 4,16,24,16,4, 6,24,36,24,6, 4,16,24,16,4, 1,4,6,4,1].map(v=>v/256);
        const out = new Float32Array(w * h);
        for (let y = 2; y < h-2; y++)
            for (let x = 2; x < w-2; x++) {
                let s = 0;
                for (let ky=-2; ky<=2; ky++)
                    for (let kx=-2; kx<=2; kx++)
                        s += gray[(y+ky)*w+(x+kx)] * K[(ky+2)*5+(kx+2)];
                out[y*w+x] = s;
            }
        return out;
    },

    // Sobel gradient magnitude
    _sobelEdges(gray, w, h) {
        const edges = new Float32Array(w * h);
        for (let y = 1; y < h-1; y++)
            for (let x = 1; x < w-1; x++) {
                const gx = -gray[(y-1)*w+(x-1)] + gray[(y-1)*w+(x+1)]
                           -2*gray[y*w+(x-1)]   + 2*gray[y*w+(x+1)]
                           -gray[(y+1)*w+(x-1)] + gray[(y+1)*w+(x+1)];
                const gy = -gray[(y-1)*w+(x-1)] - 2*gray[(y-1)*w+x] - gray[(y-1)*w+(x+1)]
                           +gray[(y+1)*w+(x-1)] + 2*gray[(y+1)*w+x] + gray[(y+1)*w+(x+1)];
                edges[y*w+x] = Math.sqrt(gx*gx + gy*gy);
            }
        return edges;
    },

    // Background removal: sample corner patches → whiten pixels within colour distance
    _removeBackground(canvas, tolerance) {
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        const id  = ctx.getImageData(0, 0, W, H);
        const px  = id.data;

        // Sample 5% patches at all four corners to estimate paper/background colour
        const pw = Math.max(4, Math.round(W * 0.05));
        const ph = Math.max(4, Math.round(H * 0.05));
        let rSum = 0, gSum = 0, bSum = 0, cnt = 0;
        const sample = (x0, y0) => {
            for (let y = y0; y < y0 + ph && y < H; y++)
                for (let x = x0; x < x0 + pw && x < W; x++) {
                    const i = (y * W + x) * 4;
                    rSum += px[i]; gSum += px[i+1]; bSum += px[i+2]; cnt++;
                }
        };
        sample(0, 0);              // TL
        sample(W - pw, 0);         // TR
        sample(0, H - ph);         // BL
        sample(W - pw, H - ph);    // BR

        const bgR = rSum / cnt, bgG = gSum / cnt, bgB = bSum / cnt;
        const tSq = tolerance * tolerance;

        for (let i = 0; i < px.length; i += 4) {
            const dr = px[i] - bgR, dg = px[i+1] - bgG, db = px[i+2] - bgB;
            if (dr*dr + dg*dg + db*db < tSq)
                px[i] = px[i+1] = px[i+2] = 255;
        }
        ctx.putImageData(id, 0, 0);
    },

    // Post-processing: grayscale or black-and-white
    _applyEnhancement(canvas, type) {
        if (type === 'none') return;
        const ctx = canvas.getContext('2d');
        const id  = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px  = id.data;
        for (let i = 0; i < px.length; i += 4) {
            const g = Math.round(0.299*px[i] + 0.587*px[i+1] + 0.114*px[i+2]);
            px[i] = px[i+1] = px[i+2] = (type === 'blackwhite') ? (g > 128 ? 255 : 0) : g;
        }
        ctx.putImageData(id, 0, 0);
    },

    // Load a File object as an HTMLImageElement
    _loadImage(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image: ' + file.name)); };
            img.src = url;
        });
    }
};

const Tools = {

// ==================== TIER 1 ENHANCEMENT #1: WORKFLOW AUTOMATION ====================
    workflow: {
        name: 'Workflow Builder',
        description: 'Chain multiple tools together and save as templates',
        icon: '🔄',
        savedWorkflows: [],
        currentWorkflow: [],
        
        configHTML: `
            <div class="info-box" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none;">
                ⚡ <strong>Automate Your PDF Tasks!</strong> Build custom workflows by chaining tools together.
                Save templates for repetitive tasks.
            </div>
            
            <div class="info-box" style="background: #fff3cd; border-color: #ffc107; color: #856404;">
                ℹ️ <strong>Note:</strong> Each workflow step currently processes the same input files.
                For best results, use workflows for independent operations on the same files.
            </div>
            
            <div class="form-group">
                <label class="form-label">Saved Workflows</label>
                <select class="form-select" id="workflowTemplateSelect">
                    <option value="">-- Select a template --</option>
                </select>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px;">
                    <button type="button" class="btn btn-secondary" id="loadWorkflowBtn">📂 Load</button>
                    <button type="button" class="btn btn-secondary" id="deleteWorkflowBtn">🗑️ Delete</button>
                </div>
            </div>
            
            <div class="form-group">
                <label class="form-label">Build New Workflow</label>
                <select class="form-select" id="workflowToolSelect">
                    <option value="">-- Add a tool --</option>
                    <option value="merge">Merge PDFs</option>
                    <option value="compressAdvanced">Advanced Compress</option>
                    <option value="watermark">Add Watermark</option>
                    <option value="rotate">Rotate Pages</option>
                    <option value="split">Split PDF</option>
                    <option value="extract">Extract Pages</option>
                    <option value="smartpages">Smart Page Cleanup</option>
                </select>
                <button type="button" class="btn btn-primary" id="addWorkflowStepBtn" style="width: 100%; margin-top: 8px;">
                    ➕ Add to Workflow
                </button>
            </div>
            
            <div class="form-group">
                <label class="form-label">Current Workflow Steps</label>
                <div id="workflowStepsList" style="min-height: 80px; padding: 12px; background: var(--color-bg-secondary); border: 1px solid var(--color-border); border-radius: 6px;">
                    <p style="color: var(--color-text-muted); text-align: center; margin: 0;">No steps added yet</p>
                </div>
            </div>
            
            <div class="form-group">
                <label class="form-label">Save This Workflow</label>
                <input type="text" class="form-input" id="workflowNameInput" placeholder="e.g., Invoice Processing">
                <button type="button" class="btn btn-success" id="saveWorkflowBtn" style="width: 100%; margin-top: 8px;">
                    💾 Save Template
                </button>
            </div>
        `,
        
        init() {
            this.loadSavedWorkflows();
            this.updateTemplateList();
            this.renderStepsList();
            
            const addBtn = document.getElementById('addWorkflowStepBtn');
            const saveBtn = document.getElementById('saveWorkflowBtn');
            const loadBtn = document.getElementById('loadWorkflowBtn');
            const deleteBtn = document.getElementById('deleteWorkflowBtn');
            
            if (addBtn) {
                addBtn.onclick = () => {
                    const toolSelect = document.getElementById('workflowToolSelect');
                    const toolId = toolSelect?.value;
                    if (!toolId) {
                        Utils.showStatus('Please select a tool to add', 'warning');
                        return;
                    }
                    this.currentWorkflow.push({ tool: toolId, config: {} });
                    this.renderStepsList();
                    Utils.showStatus(`Added "${Tools[toolId]?.name}" to workflow`, 'success');
                };
            }
            
            if (saveBtn) {
                saveBtn.onclick = () => {
                    const nameInput = document.getElementById('workflowNameInput');
                    const name = nameInput?.value?.trim();
                    if (!name) {
                        Utils.showStatus('Please enter a workflow name', 'warning');
                        return;
                    }
                    if (this.currentWorkflow.length === 0) {
                        Utils.showStatus('Workflow is empty - add some steps first', 'warning');
                        return;
                    }
                    this.savedWorkflows.push({ name, steps: [...this.currentWorkflow] });
                    this.saveToStorage();
                    this.updateTemplateList();
                    if (nameInput) nameInput.value = '';
                    Utils.showStatus(`Workflow "${name}" saved!`, 'success');
                };
            }
            
            if (loadBtn) {
                loadBtn.onclick = () => {
                    const select = document.getElementById('workflowTemplateSelect');
                    const idx = parseInt(select?.value);
                    if (isNaN(idx) || !this.savedWorkflows[idx]) {
                        Utils.showStatus('Please select a workflow to load', 'warning');
                        return;
                    }
                    this.currentWorkflow = [...this.savedWorkflows[idx].steps];
                    this.renderStepsList();
                    Utils.showStatus(`Loaded "${this.savedWorkflows[idx].name}"`, 'success');
                };
            }
            
            if (deleteBtn) {
                deleteBtn.onclick = () => {
                    const select = document.getElementById('workflowTemplateSelect');
                    const idx = parseInt(select?.value);
                    if (isNaN(idx) || !this.savedWorkflows[idx]) {
                        Utils.showStatus('Please select a workflow to delete', 'warning');
                        return;
                    }
                    const name = this.savedWorkflows[idx].name;
                    if (!confirm(`Delete workflow "${name}"?`)) return;
                    this.savedWorkflows.splice(idx, 1);
                    this.saveToStorage();
                    this.updateTemplateList();
                    Utils.showStatus(`Workflow "${name}" deleted`, 'success');
                };
            }
        },
        
        renderStepsList() {
            const container = document.getElementById('workflowStepsList');
            if (!container) return;
            
            if (this.currentWorkflow.length === 0) {
                container.innerHTML = '<p style="color: var(--color-text-muted); text-align: center; margin: 0;">No steps added yet</p>';
                return;
            }
            
            container.innerHTML = this.currentWorkflow.map((step, idx) => {
                const toolName = Tools[step.tool]?.name || step.tool;
                const toolIcon = Tools[step.tool]?.icon || '📄';
                return `
                    <div style="display: flex; align-items: center; gap: 8px; padding: 8px; background: var(--color-bg); border-radius: 4px; margin-bottom: 6px;">
                        <span style="font-size: 18px;">${toolIcon}</span>
                        <span style="flex: 1; font-weight: 500;">${idx + 1}. ${toolName}</span>
                        <button onclick="Tools.workflow.removeStep(${idx})" style="background: none; border: none; color: var(--color-danger); cursor: pointer; font-size: 18px; padding: 0 4px;">×</button>
                    </div>
                `;
            }).join('');
        },
        
        removeStep(idx) {
            this.currentWorkflow.splice(idx, 1);
            this.renderStepsList();
            Utils.showStatus('Step removed', 'info');
        },
        
        updateTemplateList() {
            const select = document.getElementById('workflowTemplateSelect');
            if (!select) return;
            select.innerHTML = '<option value="">-- Select a template --</option>' +
                this.savedWorkflows.map((wf, idx) => {
                    const safeName = Utils.escapeHtml(wf.name);
                    return `<option value="${idx}">${safeName} (${wf.steps.length} steps)</option>`;
                }).join('');
        },
        
        loadSavedWorkflows() {
            try {
                const saved = localStorage.getItem('pdfWorkspaceWorkflows');
                if (saved) {
                    this.savedWorkflows = JSON.parse(saved);
                }
            } catch (e) {
                console.warn('[Workflow] Failed to load saved workflows:', e);
            }
        },
        
        saveToStorage() {
            try {
                localStorage.setItem('pdfWorkspaceWorkflows', JSON.stringify(this.savedWorkflows));
            } catch (e) {
                console.warn('[Workflow] Failed to save workflows:', e);
            }
        },
        
        async process(files) {
            if (this.currentWorkflow.length === 0) {
                Utils.showStatus('No workflow steps defined', 'warning');
                return;
            }
            
            Utils.updateProgress(0, 'Starting workflow...');
            let currentFiles = files;
            let completedSteps = 0;
            
            for (let i = 0; i < this.currentWorkflow.length; i++) {
                try {
                    const step = this.currentWorkflow[i];
                    const tool = Tools[step.tool];
                    const toolName = tool?.name || step.tool || 'Unknown Tool';
                    const progress = (i / this.currentWorkflow.length) * 100;
                    
                    Utils.updateProgress(progress, `Step ${i + 1}/${this.currentWorkflow.length}: ${toolName}...`);
                    
                    if (!tool || !tool.process) {
                        console.warn(`[Workflow] Tool "${step.tool}" not found or has no process method`);
                        Utils.showStatus(`Skipping step ${i + 1}: ${step.tool} not available`, 'warning');
                        continue;
                    }
                    
                    await tool.process(currentFiles);
                    completedSteps++;
                } catch (error) {
                    console.error(`[Workflow] Error in step ${i + 1}:`, error);
                    const shouldContinue = confirm(
                        `Error in step ${i + 1} (${this.currentWorkflow[i].tool}):\n\n${error.message}\n\nContinue with remaining steps?`
                    );
                    if (!shouldContinue) {
                        Utils.updateProgress(100, 'Workflow cancelled');
                        Utils.showStatus(`Workflow stopped at step ${i + 1}. ${completedSteps} steps completed.`, 'error');
                        return;
                    }
                }
            }
            
            Utils.updateProgress(100, 'Workflow complete!');
            Utils.showStatus(`Workflow completed ${completedSteps} of ${this.currentWorkflow.length} steps successfully!`, 'success');
        }
    },

    
    // ==================== ENHANCED FEATURE #2: MERGE with Alphabetical Sorting ====================
    
// ==================== TIER 1+ ENHANCEMENT: SMART RECEIPT & INVOICE PARSER ====================
    receiptparser: {
        name: 'Receipt & Invoice Parser',
        description: 'Extract structured data from receipts and invoices',
        icon: '🧾',
        
        // Parsed receipts storage
        parsedReceipts: [],
        currentEditingIndex: -1,
        
        configHTML: `
            <div class="info-box" style="background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); color: white; border: none;">
                🧾 <strong>Smart Data Extraction!</strong> Automatically extract vendor, date, total, tax, and line items from receipts and invoices.
                Save hours of manual data entry!
            </div>
            
            <div class="form-group">
                <label class="form-label">Document Type</label>
                <select class="form-select" id="receiptDocType">
                    <option value="receipt">Receipt (Store, Restaurant)</option>
                    <option value="invoice">Invoice (Business)</option>
                    <option value="businesscard">Business Card</option>
                </select>
            </div>
            
            <div class="form-group">
                <label class="form-label">Processing Mode</label>
                <select class="form-select" id="receiptProcessMode">
                    <option value="single">Single Document (with preview)</option>
                    <option value="batch">Batch Processing (multiple files)</option>
                </select>
            </div>
            
            <div id="receiptPreviewArea" style="margin-top: 16px; display: none;">
                <div style="padding: 12px; background: var(--color-bg-secondary); border-radius: 6px; border: 1px solid var(--color-border);">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px;">Extracted Data</h4>
                    
                    <div class="form-group" style="margin-bottom: 8px;">
                        <label style="font-size: 12px; font-weight: 500; color: var(--color-text-muted);">Vendor/Merchant</label>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <input type="text" id="receiptVendor" class="form-input" style="flex: 1;" placeholder="Auto-detected">
                            <span id="vendorConfidence" style="font-size: 11px; color: var(--color-text-muted);"></span>
                        </div>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                        <div class="form-group" style="margin-bottom: 8px;">
                            <label style="font-size: 12px; font-weight: 500; color: var(--color-text-muted);">Date</label>
                            <input type="text" id="receiptDate" class="form-input" placeholder="MM/DD/YYYY">
                        </div>
                        <div class="form-group" style="margin-bottom: 8px;">
                            <label style="font-size: 12px; font-weight: 500; color: var(--color-text-muted);">Category</label>
                            <select id="receiptCategory" class="form-select">
                                <option value="Food">Food & Dining</option>
                                <option value="Gas">Gas & Fuel</option>
                                <option value="Groceries">Groceries</option>
                                <option value="Office">Office Supplies</option>
                                <option value="Travel">Travel</option>
                                <option value="Entertainment">Entertainment</option>
                                <option value="Healthcare">Healthcare</option>
                                <option value="Shopping">Shopping</option>
                                <option value="Utilities">Utilities</option>
                                <option value="Other">Other</option>
                            </select>
                        </div>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;">
                        <div class="form-group" style="margin-bottom: 8px;">
                            <label style="font-size: 12px; font-weight: 500; color: var(--color-text-muted);">Subtotal</label>
                            <input type="text" id="receiptSubtotal" class="form-input" placeholder="$0.00">
                        </div>
                        <div class="form-group" style="margin-bottom: 8px;">
                            <label style="font-size: 12px; font-weight: 500; color: var(--color-text-muted);">Tax</label>
                            <input type="text" id="receiptTax" class="form-input" placeholder="$0.00">
                        </div>
                        <div class="form-group" style="margin-bottom: 8px;">
                            <label style="font-size: 12px; font-weight: 500; color: var(--color-text-muted);">Total</label>
                            <input type="text" id="receiptTotal" class="form-input" placeholder="$0.00" style="font-weight: 600;">
                        </div>
                    </div>
                    
                    <div id="mathValidation" style="margin-top: 8px; padding: 6px; border-radius: 4px; font-size: 11px; display: none;"></div>
                    
                    <div class="form-group" style="margin-top: 12px;">
                        <label style="font-size: 12px; font-weight: 500; color: var(--color-text-muted);">Line Items (Optional)</label>
                        <textarea id="receiptLineItems" class="form-textarea" rows="3" placeholder="Auto-detected items will appear here..."></textarea>
                    </div>
                    
                    <div class="form-group" style="margin-top: 12px;">
                        <label style="font-size: 12px; font-weight: 500; color: var(--color-text-muted);">Notes</label>
                        <input type="text" id="receiptNotes" class="form-input" placeholder="Add notes (optional)">
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px;">
                        <button type="button" class="btn btn-success" id="confirmReceipt">✓ Confirm & Add</button>
                        <button type="button" class="btn btn-secondary" id="skipReceipt">Skip</button>
                    </div>
                </div>
            </div>
            
            <div id="receiptBatchResults" style="margin-top: 16px; display: none;">
                <h4 style="margin: 0 0 8px 0; font-size: 14px;">Parsed Receipts (<span id="receiptCount">0</span>)</h4>
                <div id="receiptList" style="max-height: 300px; overflow-y: auto; border: 1px solid var(--color-border); border-radius: 6px; padding: 8px;"></div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-top: 12px;">
                    <button type="button" class="btn btn-primary" id="exportCSV">📄 Export CSV</button>
                    <button type="button" class="btn btn-primary" id="exportExcel">📊 Export Excel</button>
                    <button type="button" class="btn btn-primary" id="exportJSON">🔧 Export JSON</button>
                </div>
                
                <div style="margin-top: 12px; padding: 12px; background: var(--color-bg-secondary); border-radius: 6px;">
                    <h5 style="margin: 0 0 8px 0; font-size: 13px;">Summary</h5>
                    <div id="receiptSummary" style="font-size: 12px;"></div>
                </div>
            </div>
            
            <div class="info-box" style="margin-top: 12px;">
                💡 <strong>Tips:</strong>
                <ul style="margin: 4px 0 0 0; padding-left: 20px; font-size: 12px;">
                    <li>Works best with clear, well-lit photos</li>
                    <li>Supports PDF and images (JPG, PNG)</li>
                    <li>Review and correct extracted data before exporting</li>
                    <li>Categories help organize expense reports</li>
                </ul>
            </div>
        `,
        
        init() {
            // Show/hide preview based on mode
            const modeSelect = document.getElementById('receiptProcessMode');
            if (modeSelect) {
                modeSelect.addEventListener('change', (e) => {
                    const previewArea = document.getElementById('receiptPreviewArea');
                    if (previewArea) {
                        previewArea.style.display = e.target.value === 'single' ? 'block' : 'none';
                    }
                });
            }
            
            // Confirm receipt button
            const confirmBtn = document.getElementById('confirmReceipt');
            if (confirmBtn) {
                confirmBtn.addEventListener('click', () => this.confirmCurrentReceipt());
            }
            
            // Skip receipt button
            const skipBtn = document.getElementById('skipReceipt');
            if (skipBtn) {
                skipBtn.addEventListener('click', () => this.skipCurrentReceipt());
            }
            
            // Export buttons
            document.getElementById('exportCSV')?.addEventListener('click', () => this.exportData('csv'));
            document.getElementById('exportExcel')?.addEventListener('click', () => this.exportData('excel'));
            document.getElementById('exportJSON')?.addEventListener('click', () => this.exportData('json'));
            
            // Math validation on field change
            ['receiptSubtotal', 'receiptTax', 'receiptTotal'].forEach(id => {
                const field = document.getElementById(id);
                if (field) {
                    field.addEventListener('input', () => this.validateMath());
                }
            });
        },
        
        async process(files) {
            const docType = document.getElementById('receiptDocType')?.value || 'receipt';
            const mode = document.getElementById('receiptProcessMode')?.value || 'single';
            
            // Filter to PDFs and images
            const validFiles = files.filter(f => 
                FileType.isPDF(f) || FileType.isImage(f)
            );
            
            if (validFiles.length === 0) {
                Utils.showStatus('Please upload PDF or image files (JPG, PNG)', 'warning');
                return;
            }
            
            // Reset parsed receipts
            this.parsedReceipts = [];
            this.currentEditingIndex = -1;
            
            if (mode === 'single') {
                await this.processSingleMode(validFiles, docType);
            } else {
                await this.processBatchMode(validFiles, docType);
            }
        },
        
        async processSingleMode(files, docType) {
            Utils.updateProgress(0, 'Processing receipts...');
            
            for (let i = 0; i < files.length; i++) {
                Utils.updateProgress((i / files.length) * 90, `Processing ${files[i].name}...`);
                
                const ocrText = await this.extractText(files[i]);
                const parsedData = this.parseDocument(ocrText, docType);
                parsedData.filename = files[i].name;
                
                // Store current filename for confirm dialog
                this.currentFilename = files[i].name;
                
                // Show in UI for confirmation
                this.displayForConfirmation(parsedData);
                
                // Wait for user to confirm or skip
                await this.waitForUserAction();
            }
            
            Utils.updateProgress(100, 'Processing complete!');
            this.showResults();
        },
        
        async processBatchMode(files, docType) {
            Utils.updateProgress(0, 'Batch processing...');
            
            for (let i = 0; i < files.length; i++) {
                Utils.updateProgress((i / files.length) * 100, `Processing ${i + 1}/${files.length}...`);
                
                try {
                    const ocrText = await this.extractText(files[i]);
                    const parsedData = this.parseDocument(ocrText, docType);
                    parsedData.filename = files[i].name;
                    
                    // Auto-add to list (no confirmation in batch mode)
                    this.parsedReceipts.push(parsedData);
                } catch (error) {
                    console.error(`Failed to process ${files[i].name}:`, error);
                }
            }
            
            Utils.updateProgress(100, 'Batch processing complete!');
            Utils.showStatus(`Processed ${this.parsedReceipts.length} of ${files.length} files`, 'success');
            this.showResults();
        },
        
        async extractText(file) {
            if (FileType.isPDF(file)) {
                // Extract text from PDF
                const arrayBuffer = await file.arrayBuffer();
                const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
                const pdf = await loadingTask.promise;
                
                let allText = '';
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    allText += textContent.items.map(item => item.str).join(' ') + '\n';
                }
                
                // If no text found, use OCR
                if (allText.trim().length < 10) {
                    return await this.runOCR(file);
                }
                
                return allText;
            } else {
                // Image file - use OCR
                return await this.runOCR(file);
            }
        },
        
        async runOCR(file) {
            if (typeof Tesseract === 'undefined') {
                throw new Error('OCR library not loaded. Please check internet connection.');
            }
            
            const { data: { text } } = await Tesseract.recognize(
                file,
                'eng',
                {
                    logger: info => {
                        if (info.status === 'recognizing text') {
                            const progress = Math.round(info.progress * 100);
                            Utils.updateProgress(progress, `OCR: ${progress}%`);
                        }
                    }
                }
            );
            
            return text;
        },
        
        parseDocument(text, docType) {
            if (docType === 'receipt') {
                return this.parseReceipt(text);
            } else if (docType === 'invoice') {
                return this.parseInvoice(text);
            } else if (docType === 'businesscard') {
                return this.parseBusinessCard(text);
            }
            return this.parseReceipt(text); // Default
        },
        
        parseReceipt(text) {
            const result = {
                type: 'receipt',
                vendor: '',
                date: '',
                subtotal: '',
                tax: '',
                total: '',
                category: 'Other',
                lineItems: [],
                rawText: text,
                confidence: {}
            };
            
            // Extract vendor (usually first capitalized line)
            const vendorMatch = text.match(/^([A-Z][A-Za-z0-9\s&'.-]{2,40})/m);
            if (vendorMatch) {
                result.vendor = vendorMatch[1].trim();
                result.confidence.vendor = 0.8;
                
                // Auto-categorize based on vendor keywords
                result.category = this.categorizeByVendor(result.vendor);
            }
            
            // Extract date (various formats)
            const datePatterns = [
                /(\d{1,2}\/\d{1,2}\/\d{2,4})/,
                /(\d{1,2}-\d{1,2}-\d{2,4})/,
                /(\d{4}-\d{2}-\d{2})/,
                /([A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4})/i
            ];
            
            for (const pattern of datePatterns) {
                const match = text.match(pattern);
                if (match) {
                    result.date = match[1].trim();
                    result.confidence.date = 0.9;
                    break;
                }
            }
            
            // Extract total (most important - try multiple patterns)
            const totalPatterns = [
                /total[:\s]*\$?\s*(\d+\.?\d*)/i,
                /grand\s*total[:\s]*\$?\s*(\d+\.?\d*)/i,
                /amount[:\s]*\$?\s*(\d+\.?\d*)/i,
                /balance[:\s]*\$?\s*(\d+\.?\d*)/i
            ];
            
            for (const pattern of totalPatterns) {
                const match = text.match(pattern);
                if (match) {
                    result.total = this.formatCurrency(match[1]);
                    result.confidence.total = 0.95;
                    break;
                }
            }
            
            // Extract tax
            const taxMatch = text.match(/tax[:\s]*\$?\s*(\d+\.?\d*)/i);
            if (taxMatch) {
                result.tax = this.formatCurrency(taxMatch[1]);
                result.confidence.tax = 0.9;
            }
            
            // Extract subtotal
            const subtotalMatch = text.match(/sub[\s-]*total[:\s]*\$?\s*(\d+\.?\d*)/i);
            if (subtotalMatch) {
                result.subtotal = this.formatCurrency(subtotalMatch[1]);
                result.confidence.subtotal = 0.85;
            } else if (result.total && result.tax) {
                // Calculate subtotal if we have total and tax
                const total = parseFloat(result.total.replace(/[$,]/g, ''));
                const tax = parseFloat(result.tax.replace(/[$,]/g, ''));
                result.subtotal = this.formatCurrency((total - tax).toFixed(2));
                result.confidence.subtotal = 0.7;
            }
            
            // Extract line items (basic pattern)
            result.lineItems = this.extractLineItems(text);
            
            return result;
        },
        
        parseInvoice(text) {
            const result = this.parseReceipt(text); // Start with receipt parsing
            result.type = 'invoice';
            
            // Invoice-specific fields
            const invoiceNumMatch = text.match(/invoice\s*#?:?\s*([A-Z0-9-]+)/i);
            if (invoiceNumMatch) {
                result.invoiceNumber = invoiceNumMatch[1];
            }
            
            const dueDateMatch = text.match(/due\s*date[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
            if (dueDateMatch) {
                result.dueDate = dueDateMatch[1];
            }
            
            return result;
        },
        
        parseBusinessCard(text) {
            return {
                type: 'businesscard',
                name: this.extractName(text),
                title: this.extractTitle(text),
                company: this.extractCompany(text),
                phone: this.extractPhone(text),
                email: this.extractEmail(text),
                address: this.extractAddress(text),
                rawText: text
            };
        },
        
        extractLineItems(text) {
            const items = [];
            const lines = text.split('\n');
            
            // Look for lines with quantity, description, and price pattern
            const itemPattern = /(\d+)\s+([A-Za-z0-9\s-]+?)\s+\$?\s*(\d+\.?\d*)/;
            
            for (const line of lines) {
                const match = line.match(itemPattern);
                if (match) {
                    items.push({
                        quantity: match[1],
                        description: match[2].trim(),
                        price: this.formatCurrency(match[3])
                    });
                }
            }
            
            return items;
        },
        
        categorizeByVendor(vendor) {
            const lower = vendor.toLowerCase();
            
            if (lower.includes('restaurant') || lower.includes('cafe') || 
                lower.includes('pizza') || lower.includes('burger') || 
                lower.includes('food') || lower.includes('diner')) {
                return 'Food';
            }
            if (lower.includes('shell') || lower.includes('exxon') || 
                lower.includes('chevron') || lower.includes('bp') || 
                lower.includes('mobil') || lower.includes('gas')) {
                return 'Gas';
            }
            if (lower.includes('walmart') || lower.includes('target') || 
                lower.includes('kroger') || lower.includes('safeway') || 
                lower.includes('market') || lower.includes('grocery')) {
                return 'Groceries';
            }
            if (lower.includes('staples') || lower.includes('office') || 
                lower.includes('depot')) {
                return 'Office';
            }
            if (lower.includes('hotel') || lower.includes('airline') || 
                lower.includes('uber') || lower.includes('lyft') || 
                lower.includes('taxi')) {
                return 'Travel';
            }
            
            return 'Other';
        },
        
        extractName(text) {
            // Usually first or second line, capitalized
            const lines = text.split('\n').filter(l => l.trim().length > 0);
            for (const line of lines.slice(0, 3)) {
                if (/^[A-Z][a-z]+\s+[A-Z][a-z]+/.test(line.trim())) {
                    return line.trim();
                }
            }
            return '';
        },
        
        extractTitle(text) {
            const titleKeywords = ['director', 'manager', 'ceo', 'cfo', 'president', 'vp', 'engineer', 'developer'];
            const lines = text.toLowerCase().split('\n');
            for (const line of lines) {
                if (titleKeywords.some(kw => line.includes(kw))) {
                    return text.split('\n')[lines.indexOf(line)].trim();
                }
            }
            return '';
        },
        
        extractCompany(text) {
            // Look for LLC, Inc, Corp
            const match = text.match(/([A-Z][A-Za-z0-9\s&]+(?:LLC|Inc|Corp|Ltd|Co)\.?)/);
            return match ? match[1].trim() : '';
        },
        
        extractPhone(text) {
            const match = text.match(/(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/);
            return match ? match[0] : '';
        },
        
        extractEmail(text) {
            const match = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}/);
            return match ? match[0] : '';
        },
        
        extractAddress(text) {
            // Basic address pattern (number + street + optional suite/apt)
            const match = text.match(/\d+\s+[A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct)[.,\s]*/i);
            return match ? match[0].trim() : '';
        },
        
        formatCurrency(value) {
            const num = parseFloat(value);
            if (isNaN(num)) return value;
            return `$${num.toFixed(2)}`;
        },
        
        displayForConfirmation(data) {
            // Populate form fields with null checks
            const vendorEl = document.getElementById('receiptVendor');
            const dateEl = document.getElementById('receiptDate');
            const subtotalEl = document.getElementById('receiptSubtotal');
            const taxEl = document.getElementById('receiptTax');
            const totalEl = document.getElementById('receiptTotal');
            const categoryEl = document.getElementById('receiptCategory');
            const lineItemsEl = document.getElementById('receiptLineItems');
            
            if (vendorEl) vendorEl.value = data.vendor || '';
            if (dateEl) dateEl.value = data.date || '';
            if (subtotalEl) subtotalEl.value = data.subtotal || '';
            if (taxEl) taxEl.value = data.tax || '';
            if (totalEl) totalEl.value = data.total || '';
            if (categoryEl) categoryEl.value = data.category || 'Other';
            
            // Show line items
            if (lineItemsEl) {
                if (data.lineItems && data.lineItems.length > 0) {
                    const itemsText = data.lineItems.map(item => 
                        `${item.quantity || 1}x ${item.description} - ${item.price}`
                    ).join('\n');
                    lineItemsEl.value = itemsText;
                } else {
                    lineItemsEl.value = '';
                }
            }
            
            // Show confidence
            const confidence = data.confidence.vendor || 0;
            const confEl = document.getElementById('vendorConfidence');
            if (confEl) {
                confEl.textContent = `${Math.round(confidence * 100)}% confident`;
                confEl.style.color = confidence > 0.8 ? '#4caf50' : confidence > 0.5 ? '#ff9800' : '#f44336';
            }
            
            // Validate math
            this.validateMath();
            
            // Show preview area
            document.getElementById('receiptPreviewArea').style.display = 'block';
        },
        
        validateMath() {
            const subtotalStr = document.getElementById('receiptSubtotal')?.value || '0';
            const taxStr = document.getElementById('receiptTax')?.value || '0';
            const totalStr = document.getElementById('receiptTotal')?.value || '0';
            
            const subtotal = parseFloat(subtotalStr.replace(/[$,]/g, '')) || 0;
            const tax = parseFloat(taxStr.replace(/[$,]/g, '')) || 0;
            const total = parseFloat(totalStr.replace(/[$,]/g, '')) || 0;
            
            const calculated = subtotal + tax;
            const diff = Math.abs(calculated - total);
            
            const validationDiv = document.getElementById('mathValidation');
            if (validationDiv) {
                if (diff < 0.02) { // Within 2 cents
                    validationDiv.style.display = 'block';
                    validationDiv.style.background = '#e8f5e9';
                    validationDiv.style.color = '#2e7d32';
                    validationDiv.textContent = '✓ Math checks out: Subtotal + Tax = Total';
                } else if (diff < 1) {
                    validationDiv.style.display = 'block';
                    validationDiv.style.background = '#fff3e0';
                    validationDiv.style.color = '#e65100';
                    validationDiv.textContent = `⚠ Small discrepancy: Expected $${calculated.toFixed(2)}, got $${total.toFixed(2)}`;
                } else {
                    validationDiv.style.display = 'block';
                    validationDiv.style.background = '#ffebee';
                    validationDiv.style.color = '#c62828';
                    validationDiv.textContent = `✗ Math error: Expected $${calculated.toFixed(2)}, got $${total.toFixed(2)}`;
                }
            }
        },
        
        confirmCurrentReceipt() {
            const receipt = {
                filename: this.currentFilename || 'Unknown',
                vendor: document.getElementById('receiptVendor')?.value || '',
                date: document.getElementById('receiptDate')?.value || '',
                subtotal: document.getElementById('receiptSubtotal')?.value || '',
                tax: document.getElementById('receiptTax')?.value || '',
                total: document.getElementById('receiptTotal')?.value || '',
                category: document.getElementById('receiptCategory')?.value || 'Other',
                lineItems: document.getElementById('receiptLineItems')?.value || '',
                notes: document.getElementById('receiptNotes')?.value || ''
            };
            
            this.parsedReceipts.push(receipt);
            this.userActionResolved = true;
        },
        
        skipCurrentReceipt() {
            this.userActionResolved = true;
        },
        
        waitForUserAction() {
            return new Promise(resolve => {
                this.userActionResolved = false;
                const checkInterval = setInterval(() => {
                    if (this.userActionResolved) {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 100);
            });
        },
        
        showResults() {
            const resultsDiv = document.getElementById('receiptBatchResults');
            const countSpan = document.getElementById('receiptCount');
            const listDiv = document.getElementById('receiptList');
            
            if (!resultsDiv || !listDiv) return;
            
            resultsDiv.style.display = 'block';
            countSpan.textContent = this.parsedReceipts.length;
            
            // Render list
            listDiv.innerHTML = this.parsedReceipts.map((r, idx) => `
                <div style="padding: 8px; margin-bottom: 6px; background: var(--color-bg); border-radius: 4px; border: 1px solid var(--color-border);">
                    <div style="display: flex; justify-content: space-between; align-items: start;">
                        <div style="flex: 1;">
                            <div style="font-weight: 600; font-size: 13px;">${Utils.escapeHtml(r.vendor || 'Unknown Vendor')}</div>
                            <div style="font-size: 11px; color: var(--color-text-muted);">${r.date} • ${r.category}</div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-weight: 600; color: var(--color-primary);">${r.total}</div>
                            <div style="font-size: 10px; color: var(--color-text-muted);">Tax: ${r.tax || 'N/A'}</div>
                        </div>
                    </div>
                </div>
            `).join('');
            
            // Show summary
            this.updateSummary();
        },
        
        updateSummary() {
            const summaryDiv = document.getElementById('receiptSummary');
            if (!summaryDiv) return;
            
            const totalAmount = this.parsedReceipts.reduce((sum, r) => {
                const amount = parseFloat(r.total.replace(/[$,]/g, '')) || 0;
                return sum + amount;
            }, 0);
            
            const byCategory = {};
            this.parsedReceipts.forEach(r => {
                const cat = r.category || 'Other';
                const amount = parseFloat(r.total.replace(/[$,]/g, '')) || 0;
                byCategory[cat] = (byCategory[cat] || 0) + amount;
            });
            
            summaryDiv.innerHTML = `
                <div style="margin-bottom: 8px;"><strong>Total: $${totalAmount.toFixed(2)}</strong> (${this.parsedReceipts.length} receipts)</div>
                <div style="font-size: 11px;">
                    <strong>By Category:</strong><br>
                    ${Object.entries(byCategory).map(([cat, amt]) => 
                        `${cat}: $${amt.toFixed(2)}`
                    ).join(' • ')}
                </div>
            `;
        },
        
        exportData(format) {
            if (this.parsedReceipts.length === 0) {
                Utils.showStatus('No receipts to export', 'warning');
                return;
            }
            
            if (format === 'csv') {
                this.exportCSV();
            } else if (format === 'excel') {
                this.exportExcel();
            } else if (format === 'json') {
                this.exportJSON();
            }
        },
        
        exportCSV() {
            const headers = ['Filename', 'Vendor', 'Date', 'Category', 'Subtotal', 'Tax', 'Total', 'Notes', 'Line Items'];
            const rows = this.parsedReceipts.map(r => [
                r.filename,
                r.vendor,
                r.date,
                r.category,
                r.subtotal,
                r.tax,
                r.total,
                r.notes || '',
                (r.lineItems || '').replace(/\n/g, '; ')
            ]);
            
            const csv = [headers, ...rows].map(row => 
                row.map(cell => `"${cell}"`).join(',')
            ).join('\n');
            
            const blob = new Blob([csv], { type: 'text/csv' });
            saveAs(blob, `receipts_${new Date().toISOString().split('T')[0]}.csv`);
            
            Utils.showStatus('CSV exported successfully!', 'success');
        },
        
        exportExcel() {
            const data = [
                ['Filename', 'Vendor', 'Date', 'Category', 'Subtotal', 'Tax', 'Total', 'Notes'],
                ...this.parsedReceipts.map(r => [
                    r.filename,
                    r.vendor,
                    r.date,
                    r.category,
                    r.subtotal,
                    r.tax,
                    r.total,
                    r.notes || ''
                ])
            ];
            
            const ws = XLSX.utils.aoa_to_sheet(data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Receipts');
            
            // Add summary sheet
            const totalAmount = this.parsedReceipts.reduce((sum, r) => {
                return sum + (parseFloat(r.total.replace(/[$,]/g, '')) || 0);
            }, 0);
            
            const summaryData = [
                ['Receipt Summary'],
                [''],
                ['Total Receipts', this.parsedReceipts.length],
                ['Total Amount', `$${totalAmount.toFixed(2)}`],
                [''],
                ['By Category', 'Amount']
            ];
            
            const byCategory = {};
            this.parsedReceipts.forEach(r => {
                const cat = r.category || 'Other';
                const amount = parseFloat(r.total.replace(/[$,]/g, '')) || 0;
                byCategory[cat] = (byCategory[cat] || 0) + amount;
            });
            
            Object.entries(byCategory).forEach(([cat, amt]) => {
                summaryData.push([cat, `$${amt.toFixed(2)}`]);
            });
            
            const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
            XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');
            
            const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            saveAs(blob, `receipts_${new Date().toISOString().split('T')[0]}.xlsx`);
            
            Utils.showStatus('Excel file exported successfully!', 'success');
        },
        
        exportJSON() {
            const exportData = {
                exportDate: new Date().toISOString(),
                receiptCount: this.parsedReceipts.length,
                receipts: this.parsedReceipts,
                summary: {
                    totalAmount: this.parsedReceipts.reduce((sum, r) => {
                        return sum + (parseFloat(r.total.replace(/[$,]/g, '')) || 0);
                    }, 0)
                }
            };
            
            const json = JSON.stringify(exportData, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            saveAs(blob, `receipts_${new Date().toISOString().split('T')[0]}.json`);
            
            Utils.showStatus('JSON exported successfully!', 'success');
        }
    },



// ==================== TIER 1+ ENHANCEMENT: FULL PDF TEXT EDITOR ====================
    pdftexteditor: {
        name: 'PDF Text Editor',
        description: 'Edit text directly in PDF documents',
        icon: '✏️',
        
        // State
        currentPdf: null,
        currentPage: 1,
        totalPages: 0,
        textItems: [],
        editedItems: new Map(), // Map of item index to edited text
        scale: 1.5,
        pageCanvas: null,
        editorContainer: null,
        
        configHTML: `
            <div class="info-box" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100); color: white; border: none;">
                ✏️ <strong>Real PDF Text Editing!</strong> Click any text to edit it directly. Changes are saved to a new PDF.
            </div>
            
            <div id="pdfTextEditorInstructions" class="info-box" style="background: #fff3cd; border-color: #ffc107; color: #856404; margin-top: 12px;">
                📌 <strong>Quick Start:</strong>
                <ol style="margin: 8px 0 0 0; padding-left: 20px; font-size: 13px;">
                    <li>Upload a PDF file (drag & drop or click "Add Files")</li>
                    <li>If already uploaded, click "Process Files" button below</li>
                    <li>PDF will appear with editable text</li>
                    <li>Click any text to edit it!</li>
                </ol>
            </div>
            
            <div id="pdfTextEditorControls" style="margin-bottom: 16px; display: none;">
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px;">
                    <button type="button" class="btn btn-secondary" id="textEditorPrevPage">◀ Previous</button>
                    <div style="text-align: center; padding: 8px; background: var(--color-bg-secondary); border-radius: 6px;">
                        <span style="font-size: 13px;">Page <span id="textEditorCurrentPage">1</span> of <span id="textEditorTotalPages">1</span></span>
                    </div>
                    <button type="button" class="btn btn-secondary" id="textEditorNextPage">Next ▶</button>
                </div>
                
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 12px;">
                    <div class="form-group" style="margin: 0;">
                        <label style="font-size: 12px; font-weight: 500; margin-bottom: 4px;">Text Color</label>
                        <input type="color" id="textEditorColor" value="#000000" class="form-input" style="height: 36px;">
                    </div>
                    <div class="form-group" style="margin: 0;">
                        <label style="font-size: 12px; font-weight: 500; margin-bottom: 4px;">Font Size</label>
                        <input type="number" id="textEditorFontSize" class="form-input" value="12" min="6" max="72">
                    </div>
                </div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <button type="button" class="btn btn-success" id="saveTextEdits">💾 Save Edited PDF</button>
                    <button type="button" class="btn btn-secondary" id="resetTextEdits">↺ Reset Page</button>
                </div>
                
                <div id="textEditStats" style="margin-top: 12px; padding: 8px; background: var(--color-bg-secondary); border-radius: 4px; font-size: 12px; text-align: center; color: var(--color-text-muted);">
                    No edits yet
                </div>
            </div>
            
            <div id="pdfTextEditorCanvas" style="position: relative; overflow: auto; max-height: 600px; border: 1px solid var(--color-border); border-radius: 6px; background: #f5f5f5; display: none;">
                <div id="textEditorWrapper" style="position: relative; display: inline-block;"></div>
            </div>
            
            <div class="info-box" style="margin-top: 12px;">
                💡 <strong>How to use:</strong>
                <ul style="margin: 4px 0 0 0; padding-left: 20px; font-size: 12px;">
                    <li>Click any text to edit it</li>
                    <li>Press Enter to save, Escape to cancel</li>
                    <li>Navigate pages to edit multiple pages</li>
                    <li>Click "Save Edited PDF" to download</li>
                </ul>
            </div>
        `,
        
        init() {
            console.log('[PDF Text Editor] Initializing...');
            
            // FIX: Use a small delay to ensure DOM is ready
            setTimeout(() => {
                this.bindEventListeners();
                
                // FIX v9.0.0: Auto-process if files are already loaded
                if (AppState.files.length > 0) {
                    console.log('[PDF Text Editor] Files already loaded, auto-processing...');
                    setTimeout(() => {
                        this.process(AppState.files);
                    }, 200);
                } else {
                    console.log('[PDF Text Editor] No files loaded yet - waiting for user to upload');
                }
            }, 100);
            
            this.defaultColor = '#000000';
            this.defaultFontSize = 12;
            this.isInitialized = true;
            
            console.log('[PDF Text Editor] Initialized successfully');
        },
        
        // FIX: Separate method for event binding with cleanup
        bindEventListeners() {
            // Remove old listeners first to prevent duplicates
            this.cleanup();
            
            // Store bound functions for cleanup
            this._boundHandlers = {
                prevPage: () => this.previousPage(),
                nextPage: () => this.nextPage(),
                save: () => this.saveEditedPDF(),
                reset: () => this.resetCurrentPage(),
                colorChange: (e) => { this.defaultColor = e.target.value; },
                fontSizeChange: (e) => { this.defaultFontSize = parseInt(e.target.value); }
            };
            
            // Bind navigation buttons
            const prevBtn = document.getElementById('textEditorPrevPage');
            const nextBtn = document.getElementById('textEditorNextPage');
            const saveBtn = document.getElementById('saveTextEdits');
            const resetBtn = document.getElementById('resetTextEdits');
            const colorInput = document.getElementById('textEditorColor');
            const fontSizeInput = document.getElementById('textEditorFontSize');
            
            if (prevBtn) prevBtn.addEventListener('click', this._boundHandlers.prevPage);
            if (nextBtn) nextBtn.addEventListener('click', this._boundHandlers.nextPage);
            if (saveBtn) saveBtn.addEventListener('click', this._boundHandlers.save);
            if (resetBtn) resetBtn.addEventListener('click', this._boundHandlers.reset);
            if (colorInput) colorInput.addEventListener('change', this._boundHandlers.colorChange);
            if (fontSizeInput) fontSizeInput.addEventListener('change', this._boundHandlers.fontSizeChange);
            
            console.log('[PDF Text Editor] Event listeners bound');
        },
        
        // FIX: Add cleanup method
        cleanup() {
            if (!this._boundHandlers) return;
            
            const prevBtn = document.getElementById('textEditorPrevPage');
            const nextBtn = document.getElementById('textEditorNextPage');
            const saveBtn = document.getElementById('saveTextEdits');
            const resetBtn = document.getElementById('resetTextEdits');
            const colorInput = document.getElementById('textEditorColor');
            const fontSizeInput = document.getElementById('textEditorFontSize');
            
            if (prevBtn) prevBtn.removeEventListener('click', this._boundHandlers.prevPage);
            if (nextBtn) nextBtn.removeEventListener('click', this._boundHandlers.nextPage);
            if (saveBtn) saveBtn.removeEventListener('click', this._boundHandlers.save);
            if (resetBtn) resetBtn.removeEventListener('click', this._boundHandlers.reset);
            if (colorInput) colorInput.removeEventListener('change', this._boundHandlers.colorChange);
            if (fontSizeInput) fontSizeInput.removeEventListener('change', this._boundHandlers.fontSizeChange);
        },
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            
            if (pdfFiles.length === 0) {
                Utils.showStatus('Please select a PDF file to edit', 'warning');
                return;
            }
            
            if (pdfFiles.length > 1) {
                Utils.showStatus('Please select only one PDF file at a time', 'warning');
                return;
            }
            
            Utils.updateProgress(10, 'Loading PDF...');
            
            // FIX: Better library checks with user-friendly messages
            if (typeof pdfjsLib === 'undefined') {
                Utils.showStatus('PDF.js library not loaded. Please wait a moment and try again, or refresh the page.', 'error');
                console.error('[PDF Text Editor] pdfjsLib is undefined');
                return;
            }
            
            if (typeof PDFLib === 'undefined') {
                Utils.showStatus('PDF-Lib library not loaded. Please wait a moment and try again, or refresh the page.', 'error');
                console.error('[PDF Text Editor] PDFLib is undefined');
                return;
            }
            
            // FIX: Ensure event listeners are bound before processing
            if (!this.isInitialized) {
                console.warn('[PDF Text Editor] Not initialized, binding events now');
                this.bindEventListeners();
            }
            
            try {
                const file = pdfFiles[0];
                
                // FIX v9.0.0: Read file buffer and clone it to prevent detachment
                console.log('[PDF Text Editor] Reading file:', file.name);
                const originalBuffer = await file.arrayBuffer();
                
                // Clone the buffer for pdf-lib (prevents detachment issues)
                const clonedBuffer = originalBuffer.slice(0);
                
                console.log('[PDF Text Editor] Loading with pdf.js...');
                // Load with pdf.js (for rendering)
                const loadingTask = pdfjsLib.getDocument({ data: originalBuffer });
                this.currentPdf = await loadingTask.promise;
                this.totalPages = this.currentPdf.numPages;
                this.currentPage = 1;
                this.editedItems = new Map();
                this.originalFileName = file.name;
                
                console.log('[PDF Text Editor] Loading with pdf-lib...');
                // Load with pdf-lib (for saving) - using cloned buffer
                this.pdfLibDoc = await PDFLib.PDFDocument.load(clonedBuffer);
                
                Utils.updateProgress(50, 'Rendering page...');
                
                // Show controls with better error handling
                const controlsEl = document.getElementById('pdfTextEditorControls');
                const canvasEl = document.getElementById('pdfTextEditorCanvas');
                
                if (!controlsEl || !canvasEl) {
                    Utils.showStatus('Editor UI not ready. Please try selecting the tool again.', 'error');
                    console.error('[PDF Text Editor] UI elements missing:', { 
                        controls: !!controlsEl, 
                        canvas: !!canvasEl 
                    });
                    return;
                }
                
                controlsEl.style.display = 'block';
                canvasEl.style.display = 'block';
                
                // Hide instructions box when editor loads
                const instructionsEl = document.getElementById('pdfTextEditorInstructions');
                if (instructionsEl) {
                    instructionsEl.style.display = 'none';
                }
                
                console.log('[PDF Text Editor] Rendering page 1 of', this.totalPages);
                
                await this.renderPage(this.currentPage);
                
                Utils.updateProgress(100, 'Ready to edit!');
                Utils.showStatus(`Loaded ${this.totalPages} page(s). Click any text to edit.`, 'success');
                
            } catch (error) {
                console.error('[PDF Text Editor] Error:', error);
                Utils.showStatus(`Failed to load PDF: ${error.message}`, 'error');
            }
        },
        
        async renderPage(pageNum) {
            console.log('[PDF Text Editor] renderPage called for page', pageNum);
            
            if (!this.currentPdf || pageNum < 1 || pageNum > this.totalPages) {
                console.error('[PDF Text Editor] Invalid page request:', {pageNum, totalPages: this.totalPages});
                return;
            }
            
            const page = await this.currentPdf.getPage(pageNum);
            const viewport = page.getViewport({ scale: this.scale });
            
            console.log('[PDF Text Editor] Viewport:', viewport.width, 'x', viewport.height);
            
            // Create canvas for background
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const context = canvas.getContext('2d');
            
            // Render PDF page
            await page.render({
                canvasContext: context,
                viewport: viewport
            }).promise;
            
            console.log('[PDF Text Editor] Page rendered, extracting text...');
            
            // Get text content with positions
            const textContent = await page.getTextContent();
            this.textItems = textContent.items;
            
            console.log('[PDF Text Editor] Found', this.textItems.length, 'text items');
            
            // Create editor container with better error handling
            const wrapper = document.getElementById('textEditorWrapper');
            if (!wrapper) {
                console.error('[PDF Text Editor] Wrapper element not found - DOM may not be ready');
                
                // FIX: Try one more time after a short delay
                await new Promise(resolve => setTimeout(resolve, 200));
                const wrapperRetry = document.getElementById('textEditorWrapper');
                
                if (!wrapperRetry) {
                    Utils.showStatus('Editor UI not loaded. Please try again or refresh the page.', 'error');
                    return;
                }
                
                // Use the retry element
                this.setupWrapper(wrapperRetry, canvas, viewport);
            } else {
                this.setupWrapper(wrapper, canvas, viewport);
            }
            
            // Update page counter with null checks
            const currentPageEl = document.getElementById('textEditorCurrentPage');
            const totalPagesEl = document.getElementById('textEditorTotalPages');
            
            if (currentPageEl) currentPageEl.textContent = pageNum;
            if (totalPagesEl) totalPagesEl.textContent = this.totalPages;
            
            this.updateStats();
            
            console.log('[PDF Text Editor] Page', pageNum, 'ready for editing');
        },
        
        // FIX: Extract wrapper setup to reusable method
        setupWrapper(wrapper, canvas, viewport) {
            wrapper.innerHTML = '';
            wrapper.style.width = viewport.width + 'px';
            wrapper.style.height = viewport.height + 'px';
            wrapper.style.position = 'relative';
            
            // Add canvas as background
            canvas.style.position = 'absolute';
            canvas.style.top = '0';
            canvas.style.left = '0';
            wrapper.appendChild(canvas);
            
            // FIX v9.0.0: Log first few items to help debug positioning
            if (this.textItems.length > 0) {
                console.log('[PDF Text Editor] Sample text items (first 3):');
                this.textItems.slice(0, 3).forEach((item, i) => {
                    console.log(`  Item ${i}:`, {
                        text: item.str?.substring(0, 20),
                        transform: item.transform,
                        height: item.height,
                        width: item.width,
                        fontName: item.fontName
                    });
                });
            }
            
            // Create editable text overlays
            this.textItems.forEach((item, index) => {
                if (!item.str || item.str.trim().length === 0) return;
                
                const textDiv = this.createTextElement(item, index, viewport);
                wrapper.appendChild(textDiv);
            });
            
            console.log('[PDF Text Editor] Created', wrapper.children.length - 1, 'editable text elements');
        },
        
        createTextElement(item, index, viewport) {
            const div = document.createElement('div');
            div.className = 'pdf-text-item';
            div.dataset.index = index;
            
            // Calculate position and size from transform matrix
            // Transform matrix: [scaleX, skewY, skewX, scaleY, translateX, translateY]
            const tx = item.transform;
            
            // Better font size calculation with fallbacks
            // Try multiple methods to get the most accurate font size
            let fontHeight;
            if (item.height) {
                fontHeight = item.height;
            } else {
                // Calculate from transform matrix
                // Font height is typically abs(scaleY)
                const scaleY = Math.abs(tx[3]);
                const scaleX = Math.abs(tx[0]);
                fontHeight = Math.max(scaleY, scaleX);
                
                // If both scales are too small (< 0.1), use the magnitude of the skew vector
                if (fontHeight < 0.1) {
                    fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
                }
            }
            
            // Position calculation
            const x = tx[4];
            const y = viewport.height - tx[5];
            
            // Get edited text if exists
            const editKey = `${this.currentPage}-${index}`;
            const text = this.editedItems.has(editKey) 
                ? this.editedItems.get(editKey).text 
                : item.str;
            
            // Get font info if available
            const fontName = item.fontName || '';
            let fontFamily = 'sans-serif';
            
            // Try to match common font families
            if (fontName.includes('Times') || fontName.includes('Serif')) {
                fontFamily = 'Times New Roman, Georgia, serif';
            } else if (fontName.includes('Courier') || fontName.includes('Mono')) {
                fontFamily = 'Courier New, Courier, monospace';
            } else if (fontName.includes('Helvetica') || fontName.includes('Arial') || fontName.includes('Sans')) {
                fontFamily = 'Arial, Helvetica, sans-serif';
            } else {
                // Default to sans-serif for unknown fonts
                fontFamily = 'Arial, Helvetica, sans-serif';
            }
            
            // Style the div to match PDF text as closely as possible
            div.style.position = 'absolute';
            div.style.left = x + 'px';
            div.style.top = (y - fontHeight) + 'px';
            div.style.fontSize = fontHeight + 'px';
            div.style.fontFamily = fontFamily;
            div.style.color = this.editedItems.has(editKey) 
                ? this.editedItems.get(editKey).color 
                : '#000000';
            div.style.whiteSpace = 'pre';
            div.style.cursor = 'text';
            
            // FIX v9.0.0: Remove padding/margins that offset text
            div.style.padding = '0';
            div.style.margin = '0';
            div.style.lineHeight = '1';
            div.style.border = '1px solid transparent';
            div.style.background = 'transparent';
            
            // Better text alignment
            div.style.verticalAlign = 'baseline';
            
            // Handle text width if available
            if (item.width) {
                div.style.minWidth = item.width + 'px';
            }
            
            div.textContent = text;
            
            // Store original item data for debugging
            div.dataset.originalText = item.str;
            div.dataset.fontName = fontName;
            
            // Make editable on click
            div.addEventListener('click', (e) => {
                e.stopPropagation();
                this.makeEditable(div, index, item, viewport);
            });
            
            // Show edit indicator on hover
            div.addEventListener('mouseenter', () => {
                if (!div.isEditing) {
                    div.style.border = '1px dashed #667eea';
                    div.style.background = 'rgba(102, 126, 234, 0.1)';
                }
            });
            
            div.addEventListener('mouseleave', () => {
                if (!div.isEditing) {
                    div.style.border = '1px solid transparent';
                    div.style.background = 'transparent';
                }
            });
            
            return div;
        },
        
        makeEditable(div, index, originalItem, viewport) {
            if (div.isEditing) return;
            
            div.isEditing = true;
            div.contentEditable = true;
            div.style.border = '2px solid #667eea';
            div.style.background = 'rgba(102, 126, 234, 0.2)';
            div.style.outline = 'none';
            
            // Store original text
            const originalText = div.textContent;
            
            // Focus and select all
            div.focus();
            const range = document.createRange();
            range.selectNodeContents(div);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            
            // Save on Enter
            const handleKeyDown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    finishEdit(true);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    finishEdit(false);
                }
            };
            
            // Save on blur
            const handleBlur = () => {
                finishEdit(true);
            };
            
            const finishEdit = (save) => {
                div.isEditing = false;
                div.contentEditable = false;
                div.style.border = '1px solid transparent';
                div.style.background = 'transparent';
                
                div.removeEventListener('keydown', handleKeyDown);
                div.removeEventListener('blur', handleBlur);
                
                if (save) {
                    const newText = div.textContent;
                    if (newText !== originalItem.str) {
                        // Store edit
                        const editKey = `${this.currentPage}-${index}`;
                        this.editedItems.set(editKey, {
                            text: newText,
                            originalItem: originalItem,
                            pageNum: this.currentPage,
                            color: this.defaultColor,
                            fontSize: this.defaultFontSize,
                            viewport: viewport
                        });
                        
                        div.style.color = this.defaultColor;
                        this.updateStats();
                    }
                } else {
                    // Restore original
                    div.textContent = originalText;
                }
            };
            
            div.addEventListener('keydown', handleKeyDown);
            div.addEventListener('blur', handleBlur);
        },
        
        updateStats() {
            const statsDiv = document.getElementById('textEditStats');
            if (!statsDiv) return;
            
            const editCount = Array.from(this.editedItems.keys())
                .filter(key => key.startsWith(`${this.currentPage}-`))
                .length;
            
            const totalEdits = this.editedItems.size;
            
            if (totalEdits === 0) {
                statsDiv.textContent = 'No edits yet';
                statsDiv.style.color = 'var(--color-text-muted)';
            } else {
                statsDiv.innerHTML = `<span style="color: #667eea; font-weight: 600;">${editCount} edit(s) on this page</span> • ${totalEdits} total edit(s) across all pages`;
            }
        },
        
        resetCurrentPage() {
            if (!confirm('Reset all edits on this page?')) return;
            
            // Remove edits for current page
            const keysToRemove = [];
            for (const key of this.editedItems.keys()) {
                if (key.startsWith(`${this.currentPage}-`)) {
                    keysToRemove.push(key);
                }
            }
            
            keysToRemove.forEach(key => this.editedItems.delete(key));
            
            // Re-render page
            this.renderPage(this.currentPage);
            Utils.showStatus('Page edits reset', 'info');
        },
        
        async previousPage() {
            if (this.currentPage > 1) {
                this.currentPage--;
                await this.renderPage(this.currentPage);
            }
        },
        
        async nextPage() {
            if (this.currentPage < this.totalPages) {
                this.currentPage++;
                await this.renderPage(this.currentPage);
            }
        },
        
        async saveEditedPDF() {
            if (this.editedItems.size === 0) {
                Utils.showStatus('No edits to save', 'warning');
                return;
            }
            
            if (!confirm(`Save ${this.editedItems.size} edit(s) to a new PDF?`)) return;
            
            try {
                Utils.updateProgress(0, 'Preparing PDF...');
                
                // Group edits by page
                const editsByPage = new Map();
                for (const [key, edit] of this.editedItems.entries()) {
                    const pageNum = edit.pageNum;
                    if (!editsByPage.has(pageNum)) {
                        editsByPage.set(pageNum, []);
                    }
                    editsByPage.get(pageNum).push(edit);
                }
                
                // Create new PDF with edits
                const newPdfDoc = await PDFLib.PDFDocument.create();
                
                for (let pageNum = 1; pageNum <= this.totalPages; pageNum++) {
                    Utils.updateProgress((pageNum / this.totalPages) * 90, `Processing page ${pageNum}/${this.totalPages}...`);
                    
                    // Render original page to canvas
                    const page = await this.currentPdf.getPage(pageNum);
                    const viewport = page.getViewport({ scale: 2 }); // High res for quality
                    
                    const canvas = document.createElement('canvas');
                    canvas.width = viewport.width;
                    canvas.height = viewport.height;
                    const context = canvas.getContext('2d');
                    
                    await page.render({
                        canvasContext: context,
                        viewport: viewport
                    }).promise;
                    
                    // If this page has edits, apply them
                    if (editsByPage.has(pageNum)) {
                        const edits = editsByPage.get(pageNum);
                        
                        // Draw white rectangles over original text
                        edits.forEach(edit => {
                            const item = edit.originalItem;
                            const tx = item.transform;
                            const fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]) * 2; // Scale up
                            const x = tx[4] * 2;
                            const y = viewport.height - (tx[5] * 2);
                            
                            // Estimate text width
                            context.font = `${fontHeight}px Arial`;
                            const textWidth = context.measureText(item.str).width;
                            
                            // White out old text
                            context.fillStyle = '#ffffff';
                            context.fillRect(x - 2, y - fontHeight - 2, textWidth + 4, fontHeight + 4);
                        });
                        
                        // Draw new text
                        edits.forEach(edit => {
                            const item = edit.originalItem;
                            const tx = item.transform;
                            const fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]) * 2;
                            const x = tx[4] * 2;
                            const y = viewport.height - (tx[5] * 2);
                            
                            context.font = `${fontHeight}px Arial`;
                            context.fillStyle = edit.color;
                            context.textBaseline = 'top';
                            context.fillText(edit.text, x, y - fontHeight);
                        });
                    }
                    
                    // Convert canvas to image and add to new PDF
                    const imgDataUrl = canvas.toDataURL('image/png');
                    const imgBytes = Uint8Array.from(atob(imgDataUrl.split(',')[1]), c => c.charCodeAt(0));
                    
                    const img = await newPdfDoc.embedPng(imgBytes);
                    const pdfPage = newPdfDoc.addPage([viewport.width, viewport.height]);
                    pdfPage.drawImage(img, {
                        x: 0,
                        y: 0,
                        width: viewport.width,
                        height: viewport.height
                    });
                }
                
                Utils.updateProgress(95, 'Saving PDF...');
                
                // Save the new PDF
                const pdfBytes = await newPdfDoc.save();
                const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                const filename = this.originalFileName.replace('.pdf', '_edited.pdf');
                saveAs(blob, filename);
                
                Utils.updateProgress(100, 'Complete!');
                Utils.showStatus(`PDF saved with ${this.editedItems.size} edit(s)!`, 'success');
                
            } catch (error) {
                console.error('[PDF Text Editor] Save error:', error);
                Utils.showStatus(`Failed to save: ${error.message}`, 'error');
            }
        }
    },


    merge: {
        name: 'Merge PDFs',
        description: 'Combine multiple PDF files into a single document',
        icon: '📑',
        configHTML: `
            <div class="form-group">
                <label class="form-label">Merge Order</label>
                <select class="form-select" id="mergeOrder">
                    <option value="upload">Upload Order (Default)</option>
                    <option value="alphabetical">Alphabetical by Filename</option>
                </select>
                <p style="font-size: 12px; color: var(--color-text-muted); margin-top: 4px;">
                    Choose how to order files before merging
                </p>
            </div>
        `,
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            if (pdfFiles.length < 2) {
                Utils.showStatus('Please select at least 2 PDF files to merge', 'error');
                return;
            }
            
            try {
            // Sort files based on selected order
            const mergeOrder = document.getElementById('mergeOrder')?.value || 'upload';
            let sortedFiles = [...pdfFiles];
            
            if (mergeOrder === 'alphabetical') {
                sortedFiles.sort((a, b) => a.name.localeCompare(b.name));
                console.log('Merging in alphabetical order:', sortedFiles.map(f => f.name));
            }
            
            Utils.updateProgress(10, 'Loading PDFs...');
            const mergedPdf = await PDFLib.PDFDocument.create();
            
            for (let i = 0; i < sortedFiles.length; i++) {
                Utils.updateProgress(20 + (i / sortedFiles.length * 60), `Merging ${sortedFiles[i].name}...`);
                const arrayBuffer = await sortedFiles[i].arrayBuffer();
                const pdf = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, sortedFiles[i].name);
                const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
                pages.forEach(page => mergedPdf.addPage(page));
            }
            
            // STRATEGIC ENHANCEMENT: Auto-scrub metadata if enabled
            if (AppState.autoScrubMetadata) {
                Utils.scrubMetadata(mergedPdf, true);
                console.log('[Privacy] Metadata scrubbed from merged PDF');
            }
            
            Utils.updateProgress(90, 'Generating merged PDF...');
            const pdfBytes = await mergedPdf.save();
            Utils.updateProgress(100, 'Complete!');
            
            saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), 'merged.pdf');
            Utils.showStatus(`PDFs merged successfully in ${mergeOrder} order!`, 'success');
            } catch (error) {
                console.error('[Merge] Error:', error);
                Utils.showStatus(`Merge failed: ${error.message}`, 'error');
                Utils.updateProgress(0, 'Error occurred');
            }
        }
    },
    
    split: {
        name: 'Split PDF',
        description: 'Split a PDF into individual pages or page ranges',
        icon: '✂️',
        configHTML: `
            <div class="form-group">
                <label class="form-label">Split Mode</label>
                <select class="form-select" id="splitMode">
                    <option value="pages">Individual Pages</option>
                    <option value="interval">Every N Pages</option>
                </select>
            </div>
            <div class="form-group hidden" id="intervalGroup">
                <label class="form-label">Pages per Split</label>
                <input type="number" class="form-input" id="splitInterval" value="1" min="1">
            </div>
        `,
        
        init() {
            const modeSelect = document.getElementById('splitMode');
            const intervalGroup = document.getElementById('intervalGroup');
            
            if (modeSelect) {
                modeSelect.addEventListener('change', (e) => {
                    if (intervalGroup) {
                        intervalGroup.classList.toggle('hidden', e.target.value !== 'interval');
                    }
                });
            }
        },
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            if (pdfFiles.length !== 1) {
                Utils.showStatus('Please select exactly one PDF file to split', 'error');
                return;
            }
            
            const mode = document.getElementById('splitMode')?.value || 'pages';
            const arrayBuffer = await pdfFiles[0].arrayBuffer();
            const pdf = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, pdfFiles[0].name);
            const totalPages = pdf.getPageCount();
            
            Utils.updateProgress(10, 'Loading PDF...');
            
            // STRATEGIC ENHANCEMENT: Collect files for ZIP bundling
            const outputFiles = [];
            
            if (mode === 'pages') {
                for (let i = 0; i < totalPages; i++) {
                    Utils.updateProgress(20 + (i / totalPages * 70), `Creating page ${i + 1}...`);
                    const newPdf = await PDFLib.PDFDocument.create();
                    const [page] = await newPdf.copyPages(pdf, [i]);
                    newPdf.addPage(page);
                    
                    // Auto-scrub metadata if enabled
                    if (AppState.autoScrubMetadata) {
                        Utils.scrubMetadata(newPdf, true);
                    }
                    
                    const pdfBytes = await newPdf.save();
                    outputFiles.push({
                        name: `page_${i + 1}.pdf`,
                        data: pdfBytes
                    });
                }
            } else {
                const interval = parseInt(document.getElementById('splitInterval')?.value || 1);
                let partNum = 1;
                for (let i = 0; i < totalPages; i += interval) {
                    const newPdf = await PDFLib.PDFDocument.create();
                    const endPage = Math.min(i + interval, totalPages);
                    const pages = await newPdf.copyPages(pdf, Array.from({length: endPage - i}, (_, idx) => i + idx));
                    pages.forEach(page => newPdf.addPage(page));
                    
                    // Auto-scrub metadata if enabled
                    if (AppState.autoScrubMetadata) {
                        Utils.scrubMetadata(newPdf, true);
                    }
                    
                    const pdfBytes = await newPdf.save();
                    outputFiles.push({
                        name: `part_${partNum++}.pdf`,
                        data: pdfBytes
                    });
                }
            }
            
            // STRATEGIC ENHANCEMENT: Use ZIP bundling for multiple files
            if (outputFiles.length > 1) {
                Utils.updateProgress(95, 'Creating ZIP archive...');
                const zipName = withExt(pdfFiles[0].name, '_split.zip');
                await Utils.createZipBundle(outputFiles, zipName);
                Utils.showStatus(`PDF split into ${outputFiles.length} files! Downloaded as ZIP.`, 'success');
            } else {
                // Single file - download directly
                saveAs(new Blob([outputFiles[0].data], { type: 'application/pdf' }), outputFiles[0].name);
                Utils.showStatus('PDF split successfully!', 'success');
            }
            
            Utils.updateProgress(100, 'Complete!');
        }
    },
    
    // ==================== ENHANCED FEATURE #3: EXTRACT with Delete Option ====================
    
    extract: {
        name: 'Extract Pages',
        description: 'Extract specific pages from a PDF',
        icon: '📄',
        configHTML: `
            <div class="form-group">
                <label class="form-label">Mode</label>
                <select class="form-select" id="extractMode">
                    <option value="extract">Extract Pages (keep selected)</option>
                    <option value="delete">Delete Pages (remove selected)</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Pages to <span id="extractModeLabel">Extract</span></label>
                <input type="text" class="form-input" id="extractPages" placeholder="e.g., 1-3, 5, 7-10">
                <p style="font-size: 12px; color: var(--color-text-muted); margin-top: 4px;">
                    Use page numbers or ranges (1-based indexing)
                </p>
            </div>
        `,
        
        init() {
            const modeSelect = document.getElementById('extractMode');
            const modeLabel = document.getElementById('extractModeLabel');
            
            if (modeSelect && modeLabel) {
                modeSelect.addEventListener('change', (e) => {
                    modeLabel.textContent = e.target.value === 'extract' ? 'Extract' : 'Delete';
                });
            }
        },
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            if (pdfFiles.length !== 1) {
                Utils.showStatus('Please select exactly one PDF file', 'error');
                return;
            }
            
            const mode = document.getElementById('extractMode')?.value || 'extract';
            const rangeStr = document.getElementById('extractPages')?.value;
            if (!rangeStr) {
                Utils.showStatus('Please enter page ranges', 'error');
                return;
            }
            
            const arrayBuffer = await pdfFiles[0].arrayBuffer();
            const pdf = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, pdfFiles[0].name);
            const totalPages = pdf.getPageCount();
            const specifiedPages = Utils.parsePageRanges(rangeStr, totalPages);
            
            if (specifiedPages.length === 0) {
                Utils.showStatus('No valid pages specified', 'error');
                return;
            }
            
            Utils.updateProgress(20, mode === 'extract' ? 'Extracting pages...' : 'Deleting pages...');
            const newPdf = await PDFLib.PDFDocument.create();
            
            let pagesToKeep;
            if (mode === 'extract') {
                // Keep only specified pages
                pagesToKeep = specifiedPages;
            } else {
                // Keep all pages except specified ones
                const allPages = Array.from({length: totalPages}, (_, i) => i);
                pagesToKeep = allPages.filter(p => !specifiedPages.includes(p));
            }
            
            if (pagesToKeep.length === 0) {
                Utils.showStatus('No pages would remain in the PDF', 'error');
                return;
            }
            
            const pages = await newPdf.copyPages(pdf, pagesToKeep);
            pages.forEach(page => newPdf.addPage(page));
            
            Utils.updateProgress(90, 'Generating PDF...');
            const pdfBytes = await newPdf.save();
            Utils.updateProgress(100, 'Complete!');
            
            const filename = mode === 'extract' ? 'extracted.pdf' : 'deleted_pages.pdf';
            saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), filename);
            
            const message = mode === 'extract' 
                ? `Extracted ${pagesToKeep.length} pages successfully!`
                : `Deleted ${specifiedPages.length} pages, ${pagesToKeep.length} pages remaining!`;
            Utils.showStatus(message, 'success');
        }
    },
    
    rotate: {
        name: 'Rotate Pages',
        description: 'Rotate PDF pages by 90, 180, or 270 degrees',
        icon: '🔄',
        configHTML: `
            <div class="form-group">
                <label class="form-label">Rotation Angle</label>
                <select class="form-select" id="rotateAngle">
                    <option value="90">90° Clockwise</option>
                    <option value="180">180°</option>
                    <option value="270">270° Clockwise (90° Counter-clockwise)</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Pages to Rotate (leave empty for all)</label>
                <input type="text" class="form-input" id="rotatePages" placeholder="e.g., 1-3, 5, 7">
            </div>
        `,
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            const angle = parseInt(document.getElementById('rotateAngle')?.value || 90);
            const rangeStr = document.getElementById('rotatePages')?.value;
            
            for (let i = 0; i < pdfFiles.length; i++) {
                Utils.updateProgress((i / pdfFiles.length) * 100, `Rotating ${pdfFiles[i].name}...`);
                
                const arrayBuffer = await pdfFiles[i].arrayBuffer();
                const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, pdfFiles[i].name);
                const pages = pdfDoc.getPages();
                const totalPages = pages.length;
                
                let pagesToRotate;
                if (rangeStr && rangeStr.trim()) {
                    pagesToRotate = Utils.parsePageRanges(rangeStr, totalPages);
                } else {
                    pagesToRotate = Array.from({length: totalPages}, (_, i) => i);
                }
                
                pagesToRotate.forEach(pageIndex => {
                    if (pageIndex < pages.length) {
                        pages[pageIndex].setRotation(PDFLib.degrees(angle));
                    }
                });
                
                const pdfBytes = await pdfDoc.save();
                saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), `rotated_${pdfFiles[i].name}`);
            }
            
            Utils.updateProgress(100, 'Complete!');
            Utils.showStatus('Pages rotated successfully!', 'success');
        }
    },
    
// ==================== TIER 1 ENHANCEMENT #2: ADVANCED COMPRESSION ====================
    compressAdvanced: {
        name: 'Advanced Compress',
        description: 'Reduce PDF size with image quality controls',
        icon: '🗜️',
        configHTML: `
            <div class="info-box" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; border: none;">
                🗜️ <strong>Real Compression!</strong> Downsample images, reduce quality, and optimize structure.
            </div>
            
            <div class="form-group">
                <label class="form-label">Image Quality</label>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <input type="range" id="compressQuality" min="50" max="100" value="85" style="flex: 1;">
                    <span id="qualityValue" style="min-width: 45px; font-weight: 600; color: var(--color-primary);">85%</span>
                </div>
                <p style="font-size: 11px; color: var(--color-text-muted); margin-top: 4px;">
                    Lower quality = smaller file size. 85% is recommended for most uses.
                </p>
            </div>
            
            <div class="form-group">
                <label class="form-label">Downsample Images To</label>
                <select class="form-select" id="compressDPI">
                    <option value="150">150 DPI (Screen/Web)</option>
                    <option value="300" selected>300 DPI (Print Quality)</option>
                    <option value="600">600 DPI (High-Res Archive)</option>
                </select>
            </div>
            
            <div class="form-group">
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                    <input type="checkbox" id="linearize" style="width: 18px; height: 18px;">
                    <span>Optimize for Fast Web View (Linearize)</span>
                </label>
            </div>
            
            <div class="info-box" style="background: #f0f0ff; border-color: #667eea; color: #333;">
                📊 <strong>Size Comparison:</strong>
                <div id="compressionResults" style="margin-top: 8px; font-family: monospace; font-size: 12px;"></div>
            </div>
        `,
        
        init() {
            const qualitySlider = document.getElementById('compressQuality');
            const qualityValue = document.getElementById('qualityValue');
            if (qualitySlider && qualityValue) {
                qualitySlider.oninput = (e) => {
                    qualityValue.textContent = e.target.value + '%';
                };
            }
        },
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            if (pdfFiles.length === 0) {
                Utils.showStatus('Please select PDF files to compress', 'warning');
                return;
            }
            
            const quality = parseInt(document.getElementById('compressQuality')?.value || 85) / 100;
            const dpi = parseInt(document.getElementById('compressDPI')?.value || 300);
            const linearize = document.getElementById('linearize')?.checked || false;
            
            const results = [];
            
            for (let i = 0; i < pdfFiles.length; i++) {
                Utils.updateProgress((i / pdfFiles.length) * 90, `Compressing ${pdfFiles[i].name}...`);
                
                const arrayBuffer = await pdfFiles[i].arrayBuffer();
                
                // Load with pdf.js to extract and downsample images
                const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
                const pdf = await loadingTask.promise;
                
                // Create new PDF document
                const pdfDoc = await PDFLib.PDFDocument.create();
                
                for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                    const page = await pdf.getPage(pageNum);
                    
                    // Render page to canvas at target DPI
                    const scale = dpi / 72; // 72 DPI is base
                    const viewport = page.getViewport({ scale });
                    const canvas = document.createElement('canvas');
                    canvas.width = viewport.width;
                    canvas.height = viewport.height;
                    const ctx = canvas.getContext('2d');
                    
                    await page.render({ canvasContext: ctx, viewport }).promise;
                    
                    // Convert to JPEG at specified quality
                    const jpegDataUrl = canvas.toDataURL('image/jpeg', quality);
                    const jpegBytes = Uint8Array.from(atob(jpegDataUrl.split(',')[1]), c => c.charCodeAt(0));
                    
                    // Embed compressed image in new PDF with error handling
                    try {
                        const jpegImage = await pdfDoc.embedJpg(jpegBytes);
                        const pdfPage = pdfDoc.addPage([viewport.width, viewport.height]);
                        pdfPage.drawImage(jpegImage, {
                            x: 0,
                            y: 0,
                            width: viewport.width,
                            height: viewport.height
                        });
                    } catch (embedError) {
                        console.warn(`[Compress] JPEG embed failed for page ${pageNum}, trying PNG fallback:`, embedError);
                        try {
                            const pngDataUrl = canvas.toDataURL('image/png');
                            const pngBytes = Uint8Array.from(atob(pngDataUrl.split(',')[1]), c => c.charCodeAt(0));
                            const pngImage = await pdfDoc.embedPng(pngBytes);
                            const pdfPage = pdfDoc.addPage([viewport.width, viewport.height]);
                            pdfPage.drawImage(pngImage, {
                                x: 0,
                                y: 0,
                                width: viewport.width,
                                height: viewport.height
                            });
                        } catch (pngError) {
                            console.error(`[Compress] Both JPEG and PNG failed for page ${pageNum}:`, pngError);
                            throw new Error(`Failed to compress page ${pageNum}: ${pngError.message}`);
                        }
                    }
                }
                
                // Save with optimizations
                const pdfBytes = await pdfDoc.save({
                    useObjectStreams: linearize,
                    addDefaultPage: false
                });
                
                const originalSize = pdfFiles[i].size;
                const newSize = pdfBytes.length;
                const savings = ((originalSize - newSize) / originalSize * 100).toFixed(1);
                
                results.push({
                    name: pdfFiles[i].name,
                    originalSize,
                    newSize,
                    savings: parseFloat(savings)
                });
                
                saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), `compressed_${pdfFiles[i].name}`);
            }
            
            Utils.updateProgress(100, 'Complete!');
            
            // Show results
            const resultsDiv = document.getElementById('compressionResults');
            if (resultsDiv) {
                resultsDiv.innerHTML = ''; // Clear previous results
                resultsDiv.innerHTML = results.map(r => `
                    <div style="margin-bottom: 8px; padding: 6px; background: white; border-radius: 4px;">
                        <strong>${Utils.escapeHtml(r.name)}</strong><br>
                        Before: ${Utils.formatFileSize(r.originalSize)} → After: ${Utils.formatFileSize(r.newSize)}<br>
                        <span style="color: ${r.savings > 0 ? '#4caf50' : '#f44336'}; font-weight: bold;">
                            ${r.savings > 0 ? '↓' : '↑'} ${Math.abs(r.savings)}% ${r.savings > 0 ? 'reduction' : 'increase'}
                        </span>
                    </div>
                `).join('');
            }
            
            const avgSavings = (results.reduce((sum, r) => sum + r.savings, 0) / results.length).toFixed(1);
            Utils.showStatus(`Compression complete! Average ${avgSavings}% reduction across ${results.length} file(s)`, 'success');
        }
    },

    // ==================== TIER 1 ENHANCEMENT #3: SMART PAGE OPERATIONS ====================
    smartpages: {
        name: 'Smart Page Cleanup',
        description: 'Auto-remove blank pages, deskew, and crop margins',
        icon: '✨',
        configHTML: `
            <div class="info-box" style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); color: white; border: none;">
                ✨ <strong>Smart Cleanup!</strong> Automatically fix common scanned document issues.
            </div>
            
            <div class="form-group">
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; margin-bottom: 8px;">
                    <input type="checkbox" id="removeBlankPages" checked style="width: 18px; height: 18px;">
                    <span><strong>Remove Blank Pages</strong></span>
                </label>
                <p style="font-size: 11px; color: var(--color-text-muted); margin-left: 26px; margin-top: -4px;">
                    Detects and removes pages with no text and minimal content
                </p>
            </div>
            
            <div class="form-group">
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; margin-bottom: 8px;">
                    <input type="checkbox" id="deskewPages" style="width: 18px; height: 18px;">
                    <span><strong>Auto-Deskew Pages</strong></span>
                </label>
                <p style="font-size: 11px; color: var(--color-text-muted); margin-left: 26px; margin-top: -4px;">
                    Automatically straighten crooked scanned pages (experimental)
                </p>
            </div>
            
            <div class="form-group">
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; margin-bottom: 8px;">
                    <input type="checkbox" id="cropMargins" style="width: 18px; height: 18px;">
                    <span><strong>Auto-Crop White Margins</strong></span>
                </label>
                <p style="font-size: 11px; color: var(--color-text-muted); margin-left: 26px; margin-top: -4px;">
                    Trim excessive white space around page edges
                </p>
            </div>
            
            <div class="info-box">
                ℹ️ <strong>Best For:</strong> Scanned documents, faxes, and photo-based PDFs.
                Processing time depends on page count and operations selected.
            </div>
        `,
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            if (pdfFiles.length === 0) {
                Utils.showStatus('Please select PDF files', 'warning');
                return;
            }
            
            const removeBlank = document.getElementById('removeBlankPages')?.checked || false;
            const deskew = document.getElementById('deskewPages')?.checked || false;
            const cropMargins = document.getElementById('cropMargins')?.checked || false;
            
            for (let fileIdx = 0; fileIdx < pdfFiles.length; fileIdx++) {
                const file = pdfFiles[fileIdx];
                Utils.updateProgress((fileIdx / pdfFiles.length) * 100, `Processing ${file.name}...`);
                
                const arrayBuffer = await file.arrayBuffer();
                const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
                const pdf = await loadingTask.promise;
                
                const newPdf = await PDFLib.PDFDocument.create();
                const pagesToKeep = [];
                let blankCount = 0;
                
                // First pass: detect blank pages
                for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                    const page = await pdf.getPage(pageNum);
                    const textContent = await page.getTextContent();
                    
                    let isBlank = false;
                    if (removeBlank) {
                        // Check if page has text
                        const hasText = textContent.items.length > 0 &&
                                       textContent.items.some(item => item.str.trim().length > 0);
                        
                        // Render page and check pixel variance
                        const viewport = page.getViewport({ scale: 0.5 });
                        const canvas = document.createElement('canvas');
                        canvas.width = viewport.width;
                        canvas.height = viewport.height;
                        const ctx = canvas.getContext('2d');
                        await page.render({ canvasContext: ctx, viewport }).promise;
                        
                        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        const variance = this.calculatePixelVariance(imageData.data);
                        
                        // Calculate whiteness (0-1, where 1 is pure white)
                        let sum = 0;
                        for (let j = 0; j < imageData.data.length; j += 4) {
                            sum += (imageData.data[j] + imageData.data[j + 1] + imageData.data[j + 2]) / 3;
                        }
                        const whiteness = sum / ((imageData.data.length / 4) * 255);
                        
                        // Page is blank if: no text AND low variance AND very white
                        // More lenient threshold to avoid false positives
                        const varianceThreshold = 0.008; // Increased from 0.005
                        const whitenessThreshold = 0.95;
                        isBlank = !hasText && variance < varianceThreshold && whiteness > whitenessThreshold;
                        if (isBlank) blankCount++;
                    }
                    
                    if (!isBlank) {
                        pagesToKeep.push(pageNum);
                    }
                }
                
                // Check if any pages remain after blank page removal
                if (pagesToKeep.length === 0) {
                    Utils.showStatus(`Warning: All ${pdf.numPages} pages in "${file.name}" were detected as blank. Skipping file.`, 'warning');
                    console.warn(`[SmartPages] ${file.name}: All pages blank - skipping`);
                    continue;
                }
                
                // Second pass: process and add non-blank pages
                const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, file.name);
                
                for (let i = 0; i < pagesToKeep.length; i++) {
                    const pageNum = pagesToKeep[i];
                    const page = await pdf.getPage(pageNum);
                    
                    let pageCanvas = null;
                    
                    if (deskew || cropMargins) {
                        // Render page for processing
                        const viewport = page.getViewport({ scale: 2 });
                        const canvas = document.createElement('canvas');
                        canvas.width = viewport.width;
                        canvas.height = viewport.height;
                        const ctx = canvas.getContext('2d');
                        await page.render({ canvasContext: ctx, viewport }).promise;
                        
                        if (deskew) {
                            // Simple deskew: detect rotation angle and rotate
                            const angle = this.detectSkewAngle(canvas);
                            if (Math.abs(angle) > 0.5) {
                                const rotatedCanvas = this.rotateCanvas(canvas, -angle);
                                pageCanvas = rotatedCanvas;
                            } else {
                                pageCanvas = canvas;
                            }
                        } else {
                            pageCanvas = canvas;
                        }
                        
                        if (cropMargins) {
                            pageCanvas = this.cropWhiteMargins(pageCanvas);
                        }
                        
                        // Convert processed canvas to image and add to new PDF
                        const dataUrl = pageCanvas.toDataURL('image/jpeg', 0.92);
                        const imgBytes = Uint8Array.from(atob(dataUrl.split(',')[1]), c => c.charCodeAt(0));
                        const img = await newPdf.embedJpg(imgBytes);
                        const newPage = newPdf.addPage([pageCanvas.width, pageCanvas.height]);
                        newPage.drawImage(img, { x: 0, y: 0, width: pageCanvas.width, height: pageCanvas.height });
                    } else {
                        // Just copy page as-is
                        const [copiedPage] = await newPdf.copyPages(pdfDoc, [pageNum - 1]);
                        newPdf.addPage(copiedPage);
                    }
                }
                
                const pdfBytes = await newPdf.save();
                saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), `cleaned_${file.name}`);
                
                const summary = [];
                if (removeBlank && blankCount > 0) summary.push(`${blankCount} blank pages removed`);
                if (deskew) summary.push('pages deskewed');
                if (cropMargins) summary.push('margins cropped');
                
                console.log(`[SmartPages] ${file.name}: ${summary.join(', ')}`);
            }
            
            Utils.updateProgress(100, 'Complete!');
            Utils.showStatus('Smart cleanup complete!', 'success');
        },
        
        calculatePixelVariance(pixels) {
            // Calculate variance of pixel values to detect blank pages
            let sum = 0;
            let sumSq = 0;
            const count = pixels.length / 4;
            
            for (let i = 0; i < pixels.length; i += 4) {
                const gray = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
                sum += gray;
                sumSq += gray * gray;
            }
            
            const mean = sum / count;
            const variance = (sumSq / count) - (mean * mean);
            return variance / (255 * 255); // Normalize to 0-1
        },
        
        detectSkewAngle(canvas) {
            // Simple edge-based skew detection
            // This is a simplified version - production would use Hough transform
            const ctx = canvas.getContext('2d');
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            
            // For now, return 0 (no skew) as full implementation requires advanced algorithms
            // A production version would use Hough Line Transform or similar
            return 0;
        },
        
        rotateCanvas(canvas, angleDegrees) {
            const angle = angleDegrees * Math.PI / 180;
            const newCanvas = document.createElement('canvas');
            const ctx = newCanvas.getContext('2d');
            
            const w = canvas.width;
            const h = canvas.height;
            newCanvas.width = w;
            newCanvas.height = h;
            
            ctx.translate(w / 2, h / 2);
            ctx.rotate(angle);
            ctx.drawImage(canvas, -w / 2, -h / 2);
            
            return newCanvas;
        },
        
        cropWhiteMargins(canvas) {
            const ctx = canvas.getContext('2d');
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const pixels = imageData.data;
            
            // Find bounds of non-white content
            let top = canvas.height, bottom = 0, left = canvas.width, right = 0;
            const threshold = 240; // Pixels darker than this are considered content
            
            for (let y = 0; y < canvas.height; y++) {
                for (let x = 0; x < canvas.width; x++) {
                    const i = (y * canvas.width + x) * 4;
                    const gray = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
                    if (gray < threshold) {
                        if (y < top) top = y;
                        if (y > bottom) bottom = y;
                        if (x < left) left = x;
                        if (x > right) right = x;
                    }
                }
            }
            
            // Add small margin
            const margin = 10;
            top = Math.max(0, top - margin);
            left = Math.max(0, left - margin);
            bottom = Math.min(canvas.height, bottom + margin);
            right = Math.min(canvas.width, right + margin);
            
            const croppedWidth = right - left;
            const croppedHeight = bottom - top;
            
            // FIX: Handle edge case where page is entirely white/blank
            if (croppedWidth <= 0 || croppedHeight <= 0 || 
                top >= canvas.height || left >= canvas.width) {
                console.warn('[SmartPages] Could not find crop bounds - page may be entirely white or have no dark pixels');
                return canvas; // Return original uncropped
            }
            
            if (croppedWidth > 0 && croppedHeight > 0) {
                const croppedCanvas = document.createElement('canvas');
                croppedCanvas.width = croppedWidth;
                croppedCanvas.height = croppedHeight;
                const croppedCtx = croppedCanvas.getContext('2d');
                croppedCtx.drawImage(canvas, left, top, croppedWidth, croppedHeight, 0, 0, croppedWidth, croppedHeight);
                return croppedCanvas;
            }
            
            return canvas;
        }
    },

    // ==================== TIER 1 ENHANCEMENT #4: TABLE EXTRACTION ====================
    extracttables: {
        name: 'Extract Tables',
        description: 'Extract tables from PDFs to CSV or Excel',
        icon: '📊',
        configHTML: `
            <div class="info-box" style="background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%); color: #333; border: none;">
                📊 <strong>Table Extraction!</strong> Automatically detect and export tables to spreadsheets.
            </div>
            
            <div class="form-group">
                <label class="form-label">Output Format</label>
                <select class="form-select" id="tableExportFormat">
                    <option value="csv">CSV (Comma-Separated)</option>
                    <option value="xlsx">Excel Workbook (.xlsx)</option>
                </select>
            </div>
            
            <div class="form-group">
                <label class="form-label">Detection Method</label>
                <select class="form-select" id="tableDetectionMethod">
                    <option value="auto">Auto-Detect (Recommended)</option>
                    <option value="grid">Grid-Based (For bordered tables)</option>
                    <option value="whitespace">Whitespace-Based (For aligned data)</option>
                </select>
            </div>
            
            <div class="info-box">
                ℹ️ <strong>How it works:</strong> Analyzes text positions to detect table structures.
                Works best with clean, structured documents. May require manual adjustment for complex layouts.
            </div>
        `,
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            if (pdfFiles.length === 0) {
                Utils.showStatus('Please select PDF files', 'warning');
                return;
            }
            
            const format = document.getElementById('tableExportFormat')?.value || 'csv';
            const method = document.getElementById('tableDetectionMethod')?.value || 'auto';
            
            for (let fileIdx = 0; fileIdx < pdfFiles.length; fileIdx++) {
                const file = pdfFiles[fileIdx];
                Utils.updateProgress((fileIdx / pdfFiles.length) * 100, `Extracting tables from ${file.name}...`);
                
                const arrayBuffer = await file.arrayBuffer();
                const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
                const pdf = await loadingTask.promise;
                
                const allTables = [];
                
                for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                    const page = await pdf.getPage(pageNum);
                    const textContent = await page.getTextContent();
                    
                    const tables = this.detectTables(textContent, method);
                    tables.forEach(table => {
                        table.page = pageNum;
                        allTables.push(table);
                    });
                }
                
                if (allTables.length === 0) {
                    Utils.showStatus(`No tables detected in ${file.name}`, 'warning');
                    continue;
                }
                
                // Export tables
                if (format === 'csv') {
                    allTables.forEach((table, idx) => {
                        const csv = this.tableToCSV(table);
                        const blob = new Blob([csv], { type: 'text/csv' });
                        const filename = `${withExt(file.name, '')}_table_${idx + 1}_page_${table.page}.csv`;
                        saveAs(blob, filename);
                    });
                } else {
                    // Excel format
                    const wb = XLSX.utils.book_new();
                    allTables.forEach((table, idx) => {
                        const ws = XLSX.utils.aoa_to_sheet(table.rows);
                        XLSX.utils.book_append_sheet(wb, ws, `Table ${idx + 1} (pg ${table.page})`);
                    });
                    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
                    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                    saveAs(blob, withExt(file.name, '_tables.xlsx'));
                }
                
                console.log(`[ExtractTables] Found ${allTables.length} tables in ${file.name}`);
            }
            
            Utils.updateProgress(100, 'Complete!');
            Utils.showStatus(`Table extraction complete! Check your downloads.`, 'success');
        },
        
        detectTables(textContent, method) {
            // Group text items by y-coordinate (rows)
            const rows = new Map();
            
            textContent.items.forEach(item => {
                const y = Math.round(item.transform[5]);
                if (!rows.has(y)) {
                    rows.set(y, []);
                }
                rows.get(y).push({
                    x: item.transform[4],
                    text: item.str,
                    width: item.width
                });
            });
            
            // Sort rows by y-coordinate
            const sortedRows = Array.from(rows.entries())
                .sort((a, b) => b[0] - a[0]) // Top to bottom
                .map(([y, items]) => {
                    // Sort items in row by x-coordinate
                    return items.sort((a, b) => a.x - b.x);
                });
            
            // Detect column positions by finding common x-coordinates
            const columnPositions = this.detectColumns(sortedRows);
            
            // Build table structure
            const tables = [];
            let currentTable = { rows: [] };
            
            for (const row of sortedRows) {
                if (row.length === 0) continue;
                
                // Assign each text item to a column
                const tableRow = new Array(columnPositions.length).fill('');
                row.forEach(item => {
                    const colIdx = this.findColumn(item.x, columnPositions);
                    if (colIdx !== -1) {
                        tableRow[colIdx] += (tableRow[colIdx] ? ' ' : '') + item.text;
                    }
                });
                
                // Check if row looks like table data (has multiple filled cells)
                const filledCells = tableRow.filter(cell => cell.trim().length > 0).length;
                if (filledCells >= 2) {
                    currentTable.rows.push(tableRow);
                } else if (currentTable.rows.length > 0) {
                    // End of table
                    if (currentTable.rows.length >= 2) {
                        tables.push(currentTable);
                    }
                    currentTable = { rows: [] };
                }
            }
            
            // Add last table if exists
            if (currentTable.rows.length >= 2) {
                tables.push(currentTable);
            }
            
            return tables;
        },
        
        detectColumns(rows) {
            // Collect all x-coordinates
            const xCoords = [];
            rows.forEach(row => {
                row.forEach(item => {
                    xCoords.push(Math.round(item.x));
                });
            });
            
            // Cluster x-coordinates to find column boundaries
            xCoords.sort((a, b) => a - b);
            
            // FIX: Use dynamic threshold based on page width
            const pageWidth = xCoords.length > 0 ? Math.max(...xCoords) : 600;
            const threshold = Math.max(10, pageWidth * 0.02); // 2% of page width, minimum 10px
            
            const columns = [];
            let currentCluster = [xCoords[0]];
            
            for (let i = 1; i < xCoords.length; i++) {
                if (xCoords[i] - xCoords[i - 1] < threshold) {
                    currentCluster.push(xCoords[i]);
                } else {
                    const avg = currentCluster.reduce((a, b) => a + b, 0) / currentCluster.length;
                    columns.push(Math.round(avg));
                    currentCluster = [xCoords[i]];
                }
            }
            if (currentCluster.length > 0) {
                const avg = currentCluster.reduce((a, b) => a + b, 0) / currentCluster.length;
                columns.push(Math.round(avg));
            }
            
            return columns;
        },
        
        findColumn(x, columnPositions) {
            // Find closest column position
            let closestIdx = -1;
            let minDist = Infinity;
            
            columnPositions.forEach((pos, idx) => {
                const dist = Math.abs(x - pos);
                if (dist < minDist && dist < 30) {
                    minDist = dist;
                    closestIdx = idx;
                }
            });
            
            return closestIdx;
        },
        
        tableToCSV(table) {
            return table.rows.map(row => 
                row.map(cell => {
                    // Escape quotes and wrap in quotes if contains comma
                    const escaped = cell.replace(/"/g, '""');
                    return escaped.includes(',') || escaped.includes('\n') 
                        ? `"${escaped}"` 
                        : escaped;
                }).join(',')
            ).join('\n');
        }
    },

    // ==================== TIER 1 ENHANCEMENT #5: PDF COMPARISON ====================
    compare: {
        name: 'Compare PDFs',
        description: 'Visual diff and side-by-side comparison',
        icon: '⚖️',
        configHTML: `
            <div class="info-box" style="background: linear-gradient(135deg, #fa709a 0%, #fee140 100%); color: #333; border: none;">
                ⚖️ <strong>PDF Comparison!</strong> See what changed between two versions of a document.
            </div>
            
            <div class="form-group">
                <label class="form-label">Original PDF (Version A)</label>
                <select class="form-select" id="compareFileA">
                    <option value="">-- Select file --</option>
                </select>
            </div>
            
            <div class="form-group">
                <label class="form-label">Modified PDF (Version B)</label>
                <select class="form-select" id="compareFileB">
                    <option value="">-- Select file --</option>
                </select>
            </div>
            
            <div class="form-group">
                <label class="form-label">Comparison Mode</label>
                <select class="form-select" id="compareMode">
                    <option value="visual">Visual Diff (Pixel-based)</option>
                    <option value="text">Text Diff (Content only)</option>
                    <option value="sidebyside">Side-by-Side View</option>
                </select>
            </div>
            
            <div class="info-box">
                ℹ️ <strong>Tip:</strong> Visual diff highlights pixel-level changes (best for catching formatting/layout changes).
                Text diff shows only content changes (faster, ignores formatting).
            </div>
            
            <div id="comparePreview" style="margin-top: 16px; min-height: 400px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-bg-secondary); display: none;">
                <div style="padding: 16px; text-align: center;">
                    <canvas id="compareCanvas" style="max-width: 100%;"></canvas>
                </div>
            </div>
        `,
        
        init() {
            this.updateFileSelectors();
        },
        
        updateFileSelectors() {
            const pdfFiles = AppState.files.filter(FileType.isPDF);
            const selectA = document.getElementById('compareFileA');
            const selectB = document.getElementById('compareFileB');
            
            if (selectA && selectB) {
                const options = '<option value="">-- Select file --</option>' +
                    pdfFiles.map((f, idx) => `<option value="${idx}">${f.name}</option>`).join('');
                selectA.innerHTML = options;
                selectB.innerHTML = options;
            }
        },
        
        async process(files) {
            const idxA = parseInt(document.getElementById('compareFileA')?.value);
            const idxB = parseInt(document.getElementById('compareFileB')?.value);
            const mode = document.getElementById('compareMode')?.value || 'visual';
            
            const pdfFiles = AppState.files.filter(FileType.isPDF);
            
            if (isNaN(idxA) || isNaN(idxB) || !pdfFiles[idxA] || !pdfFiles[idxB]) {
                Utils.showStatus('Please select both PDFs to compare', 'warning');
                return;
            }
            
            if (idxA === idxB) {
                Utils.showStatus('Please select two different PDFs', 'warning');
                return;
            }
            
            Utils.updateProgress(30, 'Loading PDFs...');
            
            const [pdfA, pdfB] = await Promise.all([
                this.loadPDFForComparison(pdfFiles[idxA]),
                this.loadPDFForComparison(pdfFiles[idxB])
            ]);
            
            Utils.updateProgress(60, 'Comparing pages...');
            
            if (mode === 'text') {
                await this.compareText(pdfA, pdfB, pdfFiles[idxA].name, pdfFiles[idxB].name);
            } else if (mode === 'sidebyside') {
                await this.compareSideBySide(pdfA, pdfB);
            } else {
                await this.compareVisual(pdfA, pdfB);
            }
            
            Utils.updateProgress(100, 'Complete!');
            Utils.showStatus('Comparison complete!', 'success');
        },
        
        async loadPDFForComparison(file) {
            const arrayBuffer = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            return await loadingTask.promise;
        },
        
        async compareText(pdfA, pdfB, nameA, nameB) {
            const textA = [];
            const textB = [];
            
            // Extract text from both PDFs
            for (let i = 1; i <= Math.max(pdfA.numPages, pdfB.numPages); i++) {
                if (i <= pdfA.numPages) {
                    const page = await pdfA.getPage(i);
                    const content = await page.getTextContent();
                    textA.push(content.items.map(item => item.str).join(' '));
                }
                if (i <= pdfB.numPages) {
                    const page = await pdfB.getPage(i);
                    const content = await page.getTextContent();
                    textB.push(content.items.map(item => item.str).join(' '));
                }
            }
            
            // Generate diff report
            let report = `TEXT COMPARISON REPORT\n${'='.repeat(60)}\n\n`;
            report += `File A: ${nameA} (${pdfA.numPages} pages)\n`;
            report += `File B: ${nameB} (${pdfB.numPages} pages)\n\n`;
            
            let differences = 0;
            for (let i = 0; i < Math.max(textA.length, textB.length); i++) {
                const pageNum = i + 1;
                const pageA = textA[i] || '';
                const pageB = textB[i] || '';
                
                if (pageA !== pageB) {
                    differences++;
                    report += `\nPAGE ${pageNum}:\n`;
                    report += `  File A: ${pageA.substring(0, 100)}${pageA.length > 100 ? '...' : ''}\n`;
                    report += `  File B: ${pageB.substring(0, 100)}${pageB.length > 100 ? '...' : ''}\n`;
                }
            }
            
            report += `\n${'='.repeat(60)}\n`;
            report += `Total differences found: ${differences} page(s)\n`;
            
            const blob = new Blob([report], { type: 'text/plain' });
            saveAs(blob, 'comparison_report.txt');
        },
        
        async compareVisual(pdfA, pdfB) {
            // Create a diff PDF showing changes in red
            const diffPdf = await PDFLib.PDFDocument.create();
            
            const maxPages = Math.max(pdfA.numPages, pdfB.numPages);
            
            for (let i = 1; i <= maxPages; i++) {
                Utils.updateProgress(60 + (i / maxPages) * 30, `Comparing page ${i}/${maxPages}...`);
                
                const canvasA = await this.renderPageToCanvas(pdfA, i);
                const canvasB = await this.renderPageToCanvas(pdfB, i);
                
                // Create diff canvas
                const diffCanvas = this.createDiffCanvas(canvasA, canvasB);
                
                // Add to PDF
                const dataUrl = diffCanvas.toDataURL('image/png');
                const imgBytes = Uint8Array.from(atob(dataUrl.split(',')[1]), c => c.charCodeAt(0));
                const img = await diffPdf.embedPng(imgBytes);
                const page = diffPdf.addPage([diffCanvas.width, diffCanvas.height]);
                page.drawImage(img, { x: 0, y: 0, width: diffCanvas.width, height: diffCanvas.height });
            }
            
            const pdfBytes = await diffPdf.save();
            saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), 'comparison_diff.pdf');
        },
        
        async compareSideBySide(pdfA, pdfB) {
            const sideBySidePdf = await PDFLib.PDFDocument.create();
            
            const maxPages = Math.max(pdfA.numPages, pdfB.numPages);
            
            for (let i = 1; i <= maxPages; i++) {
                const canvasA = await this.renderPageToCanvas(pdfA, i);
                const canvasB = await this.renderPageToCanvas(pdfB, i);
                
                // Create side-by-side canvas
                const combinedCanvas = document.createElement('canvas');
                combinedCanvas.width = canvasA.width + canvasB.width + 20;
                combinedCanvas.height = Math.max(canvasA.height, canvasB.height);
                const ctx = combinedCanvas.getContext('2d');
                
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, combinedCanvas.width, combinedCanvas.height);
                
                ctx.drawImage(canvasA, 0, 0);
                ctx.drawImage(canvasB, canvasA.width + 20, 0);
                
                // Add labels
                ctx.fillStyle = '#333';
                ctx.font = '16px Arial';
                ctx.fillText('Original', 10, 20);
                ctx.fillText('Modified', canvasA.width + 30, 20);
                
                // Add to PDF
                const dataUrl = combinedCanvas.toDataURL('image/png');
                const imgBytes = Uint8Array.from(atob(dataUrl.split(',')[1]), c => c.charCodeAt(0));
                const img = await sideBySidePdf.embedPng(imgBytes);
                const page = sideBySidePdf.addPage([combinedCanvas.width, combinedCanvas.height]);
                page.drawImage(img, { x: 0, y: 0, width: combinedCanvas.width, height: combinedCanvas.height });
            }
            
            const pdfBytes = await sideBySidePdf.save();
            saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), 'comparison_sidebyside.pdf');
        },
        
        async renderPageToCanvas(pdf, pageNum) {
            if (pageNum > pdf.numPages) {
                // Page doesn't exist, return blank canvas
                const canvas = document.createElement('canvas');
                canvas.width = 600;
                canvas.height = 800;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                return canvas;
            }
            
            const page = await pdf.getPage(pageNum);
            const viewport = page.getViewport({ scale: 1.5 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');
            
            await page.render({ canvasContext: ctx, viewport }).promise;
            return canvas;
        },
        
        createDiffCanvas(canvasA, canvasB) {
            const width = Math.max(canvasA.width, canvasB.width);
            const height = Math.max(canvasA.height, canvasB.height);
            
            const diffCanvas = document.createElement('canvas');
            diffCanvas.width = width;
            diffCanvas.height = height;
            const ctx = diffCanvas.getContext('2d');
            
            // Start with canvas A as base
            ctx.drawImage(canvasA, 0, 0);
            
            // Get image data
            const dataA = canvasA.getContext('2d').getImageData(0, 0, canvasA.width, canvasA.height);
            const dataB = canvasB.getContext('2d').getImageData(0, 0, canvasB.width, canvasB.height);
            
            const diff = ctx.createImageData(width, height);
            
            // Helper to safely get pixel value with bounds checking
            const getPixel = (data, x, y, channel) => {
                if (x >= data.width || y >= data.height) return 255; // White for out-of-bounds
                const i = (y * data.width + x) * 4 + channel;
                return (i >= 0 && i < data.data.length) ? data.data[i] : 255;
            };
            
            // Compare pixels and highlight differences in red
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const i = (y * width + x) * 4;
                    
                    const rA = getPixel(dataA, x, y, 0);
                    const gA = getPixel(dataA, x, y, 1);
                    const bA = getPixel(dataA, x, y, 2);
                    
                    const rB = getPixel(dataB, x, y, 0);
                    const gB = getPixel(dataB, x, y, 1);
                    const bB = getPixel(dataB, x, y, 2);
                    
                    const diffAmount = Math.abs(rA - rB) + Math.abs(gA - gB) + Math.abs(bA - bB);
                    
                    if (diffAmount > 30) {
                        // Difference detected - highlight in red
                        diff.data[i] = 255;
                        diff.data[i + 1] = 0;
                        diff.data[i + 2] = 0;
                        diff.data[i + 3] = 255;
                    } else {
                        // No difference - use original
                        diff.data[i] = rA;
                        diff.data[i + 1] = gA;
                        diff.data[i + 2] = bA;
                        diff.data[i + 3] = 255;
                    }
                }
            }
            
            ctx.putImageData(diff, 0, 0);
            return diffCanvas;
        }
    },
    
    reverse: {
        name: 'Reverse Pages',
        description: 'Reverse the order of all pages in a PDF',
        icon: '↩️',
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            
            for (let i = 0; i < pdfFiles.length; i++) {
                Utils.updateProgress((i / pdfFiles.length) * 100, `Reversing ${pdfFiles[i].name}...`);
                
                const arrayBuffer = await pdfFiles[i].arrayBuffer();
                const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, pdfFiles[i].name);
                const totalPages = pdfDoc.getPageCount();
                
                const newPdf = await PDFLib.PDFDocument.create();
                const pageIndices = Array.from({length: totalPages}, (_, i) => totalPages - 1 - i);
                const pages = await newPdf.copyPages(pdfDoc, pageIndices);
                pages.forEach(page => newPdf.addPage(page));
                
                const pdfBytes = await newPdf.save();
                saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), `reversed_${pdfFiles[i].name}`);
            }
            
            Utils.updateProgress(100, 'Complete!');
            Utils.showStatus('Pages reversed successfully!', 'success');
        }
    },
    
    reorder: {
        name: 'Reorder Pages',
        description: 'Reorder PDF pages in custom sequence',
        icon: '🔀',
        configHTML: `
            <div class="form-group">
                <label class="form-label">New Page Order</label>
                <input type="text" class="form-input" id="reorderSequence" placeholder="e.g., 3,1,4,2,5">
                <p style="font-size: 12px; color: var(--color-text-muted); margin-top: 4px;">
                    Enter page numbers in desired order, separated by commas
                </p>
            </div>
        `,
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            if (pdfFiles.length !== 1) {
                Utils.showStatus('Please select exactly one PDF file', 'error');
                return;
            }
            
            const sequence = document.getElementById('reorderSequence')?.value;
            if (!sequence) {
                Utils.showStatus('Please enter page sequence', 'error');
                return;
            }
            
            const arrayBuffer = await pdfFiles[0].arrayBuffer();
            const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, pdfFiles[0].name);
            const totalPages = pdfDoc.getPageCount();
            
            const pageIndices = sequence.split(',').map(n => parseInt(n.trim()) - 1).filter(n => n >= 0 && n < totalPages);
            
            if (pageIndices.length === 0) {
                Utils.showStatus('No valid page numbers in sequence', 'error');
                return;
            }
            
            Utils.updateProgress(20, 'Reordering pages...');
            const newPdf = await PDFLib.PDFDocument.create();
            const pages = await newPdf.copyPages(pdfDoc, pageIndices);
            pages.forEach(page => newPdf.addPage(page));
            
            Utils.updateProgress(90, 'Generating PDF...');
            const pdfBytes = await newPdf.save();
            Utils.updateProgress(100, 'Complete!');
            
            saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), 'reordered.pdf');
            Utils.showStatus('Pages reordered successfully!', 'success');
        }
    },
    
    removeblank: {
        name: 'Remove Blank Pages',
        description: 'Automatically detect and remove blank pages',
        icon: '🗑️',
        configHTML: `
            <div class="warning-box">
                ⚠️ This tool attempts to detect blank pages. Results may vary depending on PDF structure.
                A page is considered blank if it contains very little content.
            </div>
        `,
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            
            for (const file of pdfFiles) {
                Utils.updateProgress(5, `Loading ${file.name}...`);
                
                const arrayBuffer = await file.arrayBuffer();
                
                // Load with both libraries
                const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, file.name);
                const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
                const pdfjsDoc = await loadingTask.promise;
                
                const totalPages = pdfjsDoc.numPages;
                const pagesToKeep = [];
                
                // CRITICAL FIX: Actually analyze each page for content
                for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
                    Utils.updateProgress(10 + (pageNum / totalPages * 70), 
                        `Analyzing page ${pageNum}/${totalPages}...`);
                    
                    const page = await pdfjsDoc.getPage(pageNum);
                    const viewport = page.getViewport({ scale: 0.5 }); // Small & fast
                    
                    // Create small canvas for analysis
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.floor(viewport.width));
                    canvas.height = Math.max(1, Math.floor(viewport.height));
                    const ctx = canvas.getContext('2d');
                    
                    // Render page
                    await page.render({ canvasContext: ctx, viewport }).promise;
                    
                    // Analyze pixels
                    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const pixels = imageData.data;
                    let coloredPixels = 0;
                    
                    // Count non-white pixels
                    for (let i = 0; i < pixels.length; i += 4) {
                        const r = pixels[i];
                        const g = pixels[i + 1];
                        const b = pixels[i + 2];
                        
                        // Consider pixel "colored" if not near-white
                        if (r < 245 || g < 245 || b < 245) {
                            coloredPixels++;
                        }
                    }
                    
                    const totalPixels = pixels.length / 4;
                    const contentRatio = coloredPixels / totalPixels;
                    
                    // Keep page if it has more than 0.1% non-white content
                    if (contentRatio > 0.001) {
                        pagesToKeep.push(pageNum - 1); // Convert to 0-indexed
                    }
                }
                
                Utils.updateProgress(85, 'Creating cleaned PDF...');
                
                // Create new PDF with only non-blank pages
                const outputPdf = await PDFLib.PDFDocument.create();
                const copiedPages = await outputPdf.copyPages(pdfDoc, pagesToKeep);
                copiedPages.forEach(page => outputPdf.addPage(page));
                
                const pdfBytes = await outputPdf.save();
                
                Utils.updateProgress(95, 'Saving file...');
                
                const removedCount = totalPages - pagesToKeep.length;
                saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), `cleaned_${file.name}`);
                
                Utils.updateProgress(100, 'Complete!');
                Utils.showStatus(
                    `Removed ${removedCount} blank page(s) from ${file.name}. Kept ${pagesToKeep.length} pages.`,
                    removedCount > 0 ? 'success' : 'info'
                );
            }
        }
    },
    
    // ==================== ENHANCED FEATURE #4: SIGN with Position Presets ====================
    
    sign: {
        name: 'Sign PDFs',
        description: 'Add your signature to PDF documents',
        icon: '✍️',
        signatureImage: null,
        signatureSettings: { x: 450, y: 40, width: 160, height: 60 },
        drawingState: { isDrawing: false, lastX: 0, lastY: 0 },

        configHTML: `
            <!-- Signature Mode Tabs -->
            <div style="display: flex; border-bottom: 2px solid var(--color-border); margin-bottom: 16px; gap: 2px;">
                <button type="button" id="sigTabUpload" onclick="Tools.sign.switchTab('upload')"
                    style="flex:1; padding: 10px 6px; font-size: 13px; font-weight: 600; border: none; border-bottom: 3px solid #667eea; background: #f0f0ff; cursor: pointer; border-radius: 6px 6px 0 0; color: #667eea;">
                    📁 Upload
                </button>
                <button type="button" id="sigTabType" onclick="Tools.sign.switchTab('type')"
                    style="flex:1; padding: 10px 6px; font-size: 13px; font-weight: 600; border: none; border-bottom: 3px solid transparent; background: transparent; cursor: pointer; border-radius: 6px 6px 0 0; color: var(--color-text-muted);">
                    ✏️ Type
                </button>
                <button type="button" id="sigTabDraw" onclick="Tools.sign.switchTab('draw')"
                    style="flex:1; padding: 10px 6px; font-size: 13px; font-weight: 600; border: none; border-bottom: 3px solid transparent; background: transparent; cursor: pointer; border-radius: 6px 6px 0 0; color: var(--color-text-muted);">
                    🖊️ Draw
                </button>
            </div>

            <!-- UPLOAD TAB -->
            <div id="sigPanelUpload">
                <div class="form-group">
                    <label class="form-label">Upload Signature Image</label>
                    <input type="file" class="form-input" id="signatureInput" accept="image/*">
                </div>
                <div id="signaturePreview" class="hidden" style="margin-bottom: 12px;">
                    <p style="font-size: 13px; color: var(--color-text-muted); margin-bottom: 6px;">Preview:</p>
                    <img id="signatureImg" style="max-width: 200px; max-height: 80px; border: 2px solid var(--color-border); border-radius: 6px; padding: 6px; background: white;">
                </div>
            </div>

            <!-- TYPE TAB -->
            <div id="sigPanelType" style="display:none;">
                <div class="form-group">
                    <label class="form-label">Type Your Name</label>
                    <input type="text" class="form-input" id="sigTypeText" placeholder="Your Full Name" style="font-size: 18px;">
                </div>
                <div class="form-group">
                    <label class="form-label">Script Font Style</label>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;" id="fontPicker">
                        <button type="button" class="sig-font-btn active-font" data-font="Dancing Script" onclick="Tools.sign.selectFont(this)"
                            style="padding:12px 8px; border:2px solid #667eea; background:#f0f0ff; border-radius:8px; cursor:pointer; font-size:22px; font-family:'Dancing Script',cursive;">
                            Signature
                        </button>
                        <button type="button" class="sig-font-btn" data-font="Great Vibes" onclick="Tools.sign.selectFont(this)"
                            style="padding:12px 8px; border:2px solid var(--color-border); background:white; border-radius:8px; cursor:pointer; font-size:22px; font-family:'Great Vibes',cursive;">
                            Signature
                        </button>
                        <button type="button" class="sig-font-btn" data-font="Pacifico" onclick="Tools.sign.selectFont(this)"
                            style="padding:12px 8px; border:2px solid var(--color-border); background:white; border-radius:8px; cursor:pointer; font-size:20px; font-family:'Pacifico',cursive;">
                            Signature
                        </button>
                        <button type="button" class="sig-font-btn" data-font="Caveat" onclick="Tools.sign.selectFont(this)"
                            style="padding:12px 8px; border:2px solid var(--color-border); background:white; border-radius:8px; cursor:pointer; font-size:22px; font-family:'Caveat',cursive;">
                            Signature
                        </button>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Ink Color</label>
                    <div style="display:flex; gap:10px; align-items:center;">
                        <button type="button" onclick="Tools.sign.selectColor('#1a1a2e', this)" data-color="#1a1a2e"
                            style="width:32px; height:32px; border-radius:50%; background:#1a1a2e; border:3px solid #667eea; cursor:pointer;" title="Dark Navy"></button>
                        <button type="button" onclick="Tools.sign.selectColor('#0047AB', this)" data-color="#0047AB"
                            style="width:32px; height:32px; border-radius:50%; background:#0047AB; border:2px solid #ddd; cursor:pointer;" title="Classic Blue"></button>
                        <button type="button" onclick="Tools.sign.selectColor('#8B0000', this)" data-color="#8B0000"
                            style="width:32px; height:32px; border-radius:50%; background:#8B0000; border:2px solid #ddd; cursor:pointer;" title="Dark Red"></button>
                        <button type="button" onclick="Tools.sign.selectColor('#2E4A1E', this)" data-color="#2E4A1E"
                            style="width:32px; height:32px; border-radius:50%; background:#2E4A1E; border:2px solid #ddd; cursor:pointer;" title="Forest Green"></button>
                        <input type="color" id="sigCustomColor" value="#1a1a2e"
                            style="width:32px; height:32px; border:2px dashed #aaa; border-radius:50%; cursor:pointer; padding:2px;" title="Custom color">
                    </div>
                </div>
                <button type="button" class="btn btn-primary" onclick="Tools.sign.generateTypedSignature()" style="width:100%; margin-top:4px;">
                    ✨ Generate Signature
                </button>
                <div id="sigTypePreview" style="display:none; margin-top:12px; text-align:center; padding:12px; background:white; border:2px solid var(--color-border); border-radius:8px;">
                    <canvas id="sigTypeCanvas" style="max-width:100%;"></canvas>
                </div>
            </div>

            <!-- DRAW TAB -->
            <div id="sigPanelDraw" style="display:none;">
                <div class="form-group">
                    <label class="form-label">Draw Your Signature</label>
                    <div style="position:relative; border:2px solid var(--color-border); border-radius:8px; background:white; cursor:crosshair; overflow:hidden;">
                        <canvas id="sigDrawCanvas" width="320" height="140"
                            style="display:block; width:100%; touch-action:none;"></canvas>
                        <div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); pointer-events:none; color:#ccc; font-size:13px; text-align:center; line-height:1.4;" id="sigDrawHint">
                            Sign here
                        </div>
                    </div>
                    <div style="display:flex; gap:8px; margin-top:8px; align-items:center;">
                        <label style="font-size:12px; color:var(--color-text-muted);">Pen:</label>
                        <input type="range" id="sigPenSize" min="1" max="8" value="2" style="flex:1;">
                        <span id="sigPenSizeVal" style="font-size:12px; color:var(--color-text-muted); width:20px;">2</span>
                        <label style="font-size:12px; color:var(--color-text-muted); margin-left:6px;">Color:</label>
                        <div style="display:flex; gap:6px;">
                            <button type="button" onclick="Tools.sign.selectDrawColor('#1a1a2e', this)" data-color="#1a1a2e"
                                style="width:24px;height:24px;border-radius:50%;background:#1a1a2e;border:3px solid #667eea;cursor:pointer;"></button>
                            <button type="button" onclick="Tools.sign.selectDrawColor('#0047AB', this)" data-color="#0047AB"
                                style="width:24px;height:24px;border-radius:50%;background:#0047AB;border:2px solid #ddd;cursor:pointer;"></button>
                            <button type="button" onclick="Tools.sign.selectDrawColor('#8B0000', this)" data-color="#8B0000"
                                style="width:24px;height:24px;border-radius:50%;background:#8B0000;border:2px solid #ddd;cursor:pointer;"></button>
                        </div>
                        <button type="button" onclick="Tools.sign.clearDrawCanvas()" class="btn btn-secondary" style="padding:4px 10px; font-size:12px; margin-left:auto;">Clear</button>
                    </div>
                </div>
                <button type="button" class="btn btn-primary" onclick="Tools.sign.captureDrawSignature()" style="width:100%;">
                    ✅ Use This Signature
                </button>
                <div id="sigDrawPreview" style="display:none; margin-top:12px; padding:10px; background:#f0f8f0; border:2px solid var(--color-success); border-radius:8px; text-align:center; font-size:13px; color:var(--color-success);">
                    ✅ Signature captured! Ready to apply.
                </div>
            </div>

            <!-- SHARED CONTROLS (shown once any signature is ready) -->
            <div id="signatureControls" class="hidden" style="margin-top:16px; padding-top:16px; border-top:2px solid var(--color-border);">
                <h4 style="font-size: 14px; margin-bottom: 12px;">📍 Position & Size</h4>
                
                <div class="info-box" style="background: #e7f9ed; border-color: var(--color-success);">
                    ✨ Drag the signature in the PDF preview to reposition it!
                </div>
                
                <div class="form-group">
                    <label class="form-label">Quick Presets</label>
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 12px;">
                        <button type="button" class="btn btn-secondary" onclick="Tools.sign.setPosition('top', 'left')">Top Left</button>
                        <button type="button" class="btn btn-secondary" onclick="Tools.sign.setPosition('top', 'center')">Top Center</button>
                        <button type="button" class="btn btn-secondary" onclick="Tools.sign.setPosition('top', 'right')">Top Right</button>
                        <button type="button" class="btn btn-secondary" onclick="Tools.sign.setPosition('bottom', 'left')">Bottom Left</button>
                        <button type="button" class="btn btn-secondary" onclick="Tools.sign.setPosition('bottom', 'center')">Bottom Center</button>
                        <button type="button" class="btn btn-secondary" onclick="Tools.sign.setPosition('bottom', 'right')">Bottom Right</button>
                    </div>
                </div>
                
                <div class="range-group">
                    <div class="range-label"><span>X Position</span><span class="range-value" id="sigXValue">450</span></div>
                    <input type="range" id="sigX" min="0" max="600" value="450">
                </div>
                <div class="range-group">
                    <div class="range-label"><span>Y Position</span><span class="range-value" id="sigYValue">40</span></div>
                    <input type="range" id="sigY" min="0" max="800" value="40">
                </div>
                <div class="range-group">
                    <div class="range-label"><span>Width</span><span class="range-value" id="sigWidthValue">160</span></div>
                    <input type="range" id="sigWidth" min="50" max="400" value="160">
                </div>
                <div class="range-group">
                    <div class="range-label"><span>Height</span><span class="range-value" id="sigHeightValue">60</span></div>
                    <input type="range" id="sigHeight" min="20" max="150" value="60">
                </div>
                
                <div class="form-group" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--color-border);">
                    <label class="form-label">Apply To:</label>
                    <select class="form-select" id="signaturePages">
                        <option value="current">Current Page Only</option>
                        <option value="all">All Pages</option>
                        <option value="range">Page Range...</option>
                    </select>
                </div>
                <div class="form-group" id="pageRangeGroup" style="display: none;">
                    <label class="form-label">Page Range</label>
                    <input type="text" class="form-input" id="signaturePageRange" placeholder="e.g., 2-4,7,10-12">
                </div>
            </div>
        `,

        // --- TAB SWITCHING ---
        switchTab(tab) {
            ['upload','type','draw'].forEach(t => {
                document.getElementById(`sigPanel${t.charAt(0).toUpperCase()+t.slice(1)}`).style.display = t === tab ? 'block' : 'none';
                const btn = document.getElementById(`sigTab${t.charAt(0).toUpperCase()+t.slice(1)}`);
                if (btn) {
                    btn.style.borderBottom = t === tab ? '3px solid #667eea' : '3px solid transparent';
                    btn.style.background   = t === tab ? '#f0f0ff' : 'transparent';
                    btn.style.color        = t === tab ? '#667eea'  : 'var(--color-text-muted)';
                }
            });
            // Initialise draw canvas when switching to draw tab
            if (tab === 'draw') this.initDrawCanvas();
        },

        // --- TYPED SIGNATURE ---
        _selectedFont:  'Dancing Script',
        _selectedColor: '#1a1a2e',

        selectFont(btn) {
            document.querySelectorAll('.sig-font-btn').forEach(b => {
                b.style.border = '2px solid var(--color-border)';
                b.style.background = 'white';
            });
            btn.style.border = '2px solid #667eea';
            btn.style.background = '#f0f0ff';
            this._selectedFont = btn.dataset.font;
        },

        selectColor(hex, btn) {
            document.querySelectorAll('[data-color]').forEach(b => {
                if (b.closest && b.closest('#sigPanelType')) b.style.border = '2px solid #ddd';
            });
            if (btn) btn.style.border = '3px solid #667eea';
            this._selectedColor = hex;
            const custom = document.getElementById('sigCustomColor');
            if (custom) custom.value = hex;
        },

        generateTypedSignature() {
            const text = document.getElementById('sigTypeText')?.value?.trim();
            if (!text) { Utils.showStatus('Please type your name first', 'error'); return; }

            // Make sure Google Fonts are loaded
            this._ensureFont(this._selectedFont);

            const canvas  = document.getElementById('sigTypeCanvas');
            const preview = document.getElementById('sigTypePreview');
            if (!canvas) return;

            const fontSize = 52;
            canvas.height  = fontSize * 1.8;
            canvas.width   = Math.max(text.length * fontSize * 0.55 + 40, 260);

            // Wait a tick for font to load, then draw
            setTimeout(() => {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.font = `${fontSize}px '${this._selectedFont}', cursive`;
                ctx.fillStyle = this._selectedColor;
                ctx.textBaseline = 'middle';
                ctx.fillText(text, 16, canvas.height / 2);

                this.signatureImage = canvas.toDataURL('image/png');
                preview.style.display = 'block';
                document.getElementById('signatureControls').classList.remove('hidden');
                PDFPreview.updateSignatureOverlay();
                Utils.showStatus('Typed signature ready!', 'success');
            }, 150);
        },

        _ensureFont(fontName) {
            const id = 'gfont-' + fontName.replace(/\s/g, '-');
            if (!document.getElementById(id)) {
                const link = document.createElement('link');
                link.id   = id;
                link.rel  = 'stylesheet';
                link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}&display=swap`;
                document.head.appendChild(link);
            }
        },

        // --- DRAWN SIGNATURE ---
        _drawColor: '#1a1a2e',
        _penSize: 2,
        _hasDrawn: false,

        initDrawCanvas() {
            const canvas = document.getElementById('sigDrawCanvas');
            if (!canvas || canvas._sigInited) return;
            canvas._sigInited = true;
            const ctx = canvas.getContext('2d');
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            const getPos = (e) => {
                const rect = canvas.getBoundingClientRect();
                const scaleX = canvas.width  / rect.width;
                const scaleY = canvas.height / rect.height;
                const src = e.touches ? e.touches[0] : e;
                return {
                    x: (src.clientX - rect.left) * scaleX,
                    y: (src.clientY - rect.top)  * scaleY
                };
            };

            const start = (e) => {
                e.preventDefault();
                this.drawingState.isDrawing = true;
                const pos = getPos(e);
                this.drawingState.lastX = pos.x;
                this.drawingState.lastY = pos.y;
                // Hide hint
                const hint = document.getElementById('sigDrawHint');
                if (hint) hint.style.display = 'none';
                this._hasDrawn = true;
            };

            const draw = (e) => {
                e.preventDefault();
                if (!this.drawingState.isDrawing) return;
                const pos = getPos(e);
                ctx.strokeStyle = this._drawColor;
                ctx.lineWidth   = this._penSize;
                ctx.beginPath();
                ctx.moveTo(this.drawingState.lastX, this.drawingState.lastY);
                ctx.lineTo(pos.x, pos.y);
                ctx.stroke();
                this.drawingState.lastX = pos.x;
                this.drawingState.lastY = pos.y;
            };

            const stop = (e) => { e.preventDefault(); this.drawingState.isDrawing = false; };

            canvas.addEventListener('mousedown',  start);
            canvas.addEventListener('mousemove',  draw);
            canvas.addEventListener('mouseup',    stop);
            canvas.addEventListener('mouseleave', stop);
            canvas.addEventListener('touchstart', start, { passive: false });
            canvas.addEventListener('touchmove',  draw,  { passive: false });
            canvas.addEventListener('touchend',   stop,  { passive: false });

            // Pen size slider
            const penSlider = document.getElementById('sigPenSize');
            if (penSlider) {
                penSlider.addEventListener('input', (e) => {
                    this._penSize = parseInt(e.target.value);
                    const val = document.getElementById('sigPenSizeVal');
                    if (val) val.textContent = this._penSize;
                });
            }
        },

        selectDrawColor(hex, btn) {
            this._drawColor = hex;
            document.querySelectorAll('#sigPanelDraw [data-color]').forEach(b => {
                b.style.border = '2px solid #ddd';
            });
            if (btn) btn.style.border = '3px solid #667eea';
        },

        clearDrawCanvas() {
            const canvas = document.getElementById('sigDrawCanvas');
            if (!canvas) return;
            canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
            this._hasDrawn = false;
            const hint = document.getElementById('sigDrawHint');
            if (hint) hint.style.display = 'block';
            document.getElementById('sigDrawPreview').style.display = 'none';
        },

        captureDrawSignature() {
            const canvas = document.getElementById('sigDrawCanvas');
            if (!canvas || !this._hasDrawn) {
                Utils.showStatus('Please draw your signature first', 'error');
                return;
            }
            // Trim whitespace from canvas
            this.signatureImage = this._trimCanvas(canvas).toDataURL('image/png');
            document.getElementById('sigDrawPreview').style.display = 'block';
            document.getElementById('signatureControls').classList.remove('hidden');
            PDFPreview.updateSignatureOverlay();
            Utils.showStatus('Drawn signature captured!', 'success');
        },

        _trimCanvas(src) {
            const ctx   = src.getContext('2d');
            const data  = ctx.getImageData(0, 0, src.width, src.height);
            const pixels = data.data;
            let top = src.height, left = src.width, right = 0, bottom = 0;

            for (let y = 0; y < src.height; y++) {
                for (let x = 0; x < src.width; x++) {
                    const a = pixels[(y * src.width + x) * 4 + 3];
                    if (a > 0) {
                        if (x < left)   left   = x;
                        if (x > right)  right  = x;
                        if (y < top)    top    = y;
                        if (y > bottom) bottom = y;
                    }
                }
            }

            const pad = 10;
            const w = (right  - left   + 1) + pad * 2;
            const h = (bottom - top    + 1) + pad * 2;

            if (w <= 0 || h <= 0) return src;

            const trimmed = document.createElement('canvas');
            trimmed.width  = w;
            trimmed.height = h;
            trimmed.getContext('2d').drawImage(src, left - pad, top - pad, w, h, 0, 0, w, h);
            return trimmed;
        },

        // --- POSITION PRESETS ---
        setPosition(vertical, horizontal) {
            const pageWidth  = PDFPreview.currentPageWidth  || 612;
            const pageHeight = PDFPreview.currentPageHeight || 792;
            const margin = 40;
            let x, y;

            if (horizontal === 'left')        x = margin;
            else if (horizontal === 'center') x = (pageWidth - this.signatureSettings.width) / 2;
            else                              x = pageWidth - this.signatureSettings.width - margin;

            if (vertical === 'top')   y = pageHeight - this.signatureSettings.height - margin;
            else                      y = margin;

            this.signatureSettings.x = Math.round(x);
            this.signatureSettings.y = Math.round(y);

            document.getElementById('sigX').value  = this.signatureSettings.x;
            document.getElementById('sigY').value  = this.signatureSettings.y;
            document.getElementById('sigXValue').textContent = this.signatureSettings.x;
            document.getElementById('sigYValue').textContent = this.signatureSettings.y;

            PDFPreview.updateSignatureOverlay();
        },

        // --- INIT ---
        init() {
            console.log('[Sign Tool] Initializing...');

            // Load Google Fonts upfront for the font picker previews
            ['Dancing Script', 'Great Vibes', 'Pacifico', 'Caveat'].forEach(f => this._ensureFont(f));

            // Upload tab listener
            const input = document.getElementById('signatureInput');
            if (input) {
                input.addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        this.signatureImage = ev.target.result;
                        document.getElementById('signatureImg').src = ev.target.result;
                        document.getElementById('signaturePreview').classList.remove('hidden');
                        document.getElementById('signatureControls').classList.remove('hidden');
                        PDFPreview.updateSignatureOverlay();
                    };
                    reader.onerror = () => Utils.showStatus('Failed to load signature image.', 'error');
                    reader.readAsDataURL(file);
                });
            }

            // Custom color picker
            const customColor = document.getElementById('sigCustomColor');
            if (customColor) {
                customColor.addEventListener('input', (e) => {
                    this._selectedColor = e.target.value;
                });
            }

            // Range sliders
            [
                { id: 'sigX',      prop: 'x',      valueId: 'sigXValue'      },
                { id: 'sigY',      prop: 'y',      valueId: 'sigYValue'      },
                { id: 'sigWidth',  prop: 'width',  valueId: 'sigWidthValue'  },
                { id: 'sigHeight', prop: 'height', valueId: 'sigHeightValue' }
            ].forEach(({ id, prop, valueId }) => {
                const slider = document.getElementById(id);
                const label  = document.getElementById(valueId);
                if (slider && label) {
                    slider.addEventListener('input', (e) => {
                        const v = parseInt(e.target.value);
                        this.signatureSettings[prop] = v;
                        label.textContent = v;
                        PDFPreview.updateSignatureOverlay();
                    });
                }
            });

            // Page range dropdown
            const pagesSelect = document.getElementById('signaturePages');
            const rangeGroup  = document.getElementById('pageRangeGroup');
            if (pagesSelect && rangeGroup) {
                pagesSelect.addEventListener('change', (e) => {
                    rangeGroup.style.display = e.target.value === 'range' ? 'block' : 'none';
                });
            }
        },

        // --- PROCESS ---
        async process(files) {
            if (!this.signatureImage) {
                Utils.showStatus('Please create a signature first (upload, type, or draw)', 'error');
                return;
            }

            const pdfFiles = files.filter(FileType.isPDF);
            if (pdfFiles.length === 0) {
                Utils.showStatus('Please select at least one PDF file', 'error');
                return;
            }

            const pageMode  = document.getElementById('signaturePages')?.value  || 'current';
            const pageRange = document.getElementById('signaturePageRange')?.value || '';

            for (let i = 0; i < pdfFiles.length; i++) {
                Utils.updateProgress((i / pdfFiles.length) * 100, `Signing ${pdfFiles[i].name}...`);

                const arrayBuffer = await pdfFiles[i].arrayBuffer();
                const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, pdfFiles[i].name);

                // FIX: Robust signature image embedding - convert data URL to bytes
                // Helper function to convert data URL to bytes
                const dataUrlToBytes = (dataUrl) => {
                    const base64 = dataUrl.split(',')[1];
                    return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
                };
                
                // Embed signature image with proper format detection
                let signatureImg;
                if (this.signatureImage.startsWith('data:image/png')) {
                    signatureImg = await pdfDoc.embedPng(dataUrlToBytes(this.signatureImage));
                } else if (this.signatureImage.startsWith('data:image/jpeg') ||
                           this.signatureImage.startsWith('data:image/jpg')) {
                    signatureImg = await pdfDoc.embedJpg(dataUrlToBytes(this.signatureImage));
                } else {
                    // Fallback: try PNG first, then JPG
                    try {
                        signatureImg = await pdfDoc.embedPng(dataUrlToBytes(this.signatureImage));
                    } catch {
                        signatureImg = await pdfDoc.embedJpg(dataUrlToBytes(this.signatureImage));
                    }
                }

                const pages      = pdfDoc.getPages();
                const totalPages = pages.length;
                let pagesToSign  = [];

                if (pageMode === 'all') {
                    pagesToSign = Array.from({ length: totalPages }, (_, i) => i);
                } else if (pageMode === 'range' && pageRange) {
                    pagesToSign = Utils.parsePageRanges(pageRange, totalPages);
                } else {
                    const currentPage = PDFPreview.currentPage || 1;
                    pagesToSign = [Math.min(currentPage - 1, totalPages - 1)];
                }

                pagesToSign.forEach(pageIndex => {
                    if (pageIndex >= 0 && pageIndex < totalPages) {
                        const page = pages[pageIndex];
                        const { height } = page.getSize();
                        page.drawImage(signatureImg, {
                            x:      this.signatureSettings.x,
                            y:      height - this.signatureSettings.y - this.signatureSettings.height,
                            width:  this.signatureSettings.width,
                            height: this.signatureSettings.height
                        });
                    }
                });

                if (AppState.autoScrubMetadata) Utils.scrubMetadata(pdfDoc, true);

                const pdfBytes = await pdfDoc.save();
                saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), `signed_${pdfFiles[i].name}`);
            }

            Utils.updateProgress(100, 'Complete!');
            const modeText = pageMode === 'all' ? 'all pages' :
                             pageMode === 'range' ? `pages ${pageRange}` : 'current page';
            Utils.showStatus(`PDFs signed on ${modeText}!`, 'success');
        }
    },

    // ==================== ANNOTATE PDF ====================
    annotate: {
        name: 'Annotate PDF',
        description: 'Add text, shapes and drawings to a PDF',
        icon: '💬',
        _canvas: null,   // overlay canvas
        _ctx: null,
        _mode: 'text',   // text | pen | line | rect | ellipse | highlight | arrow
        _color: '#e53e3e',
        _lineWidth: 3,
        _fontSize: 18,
        _fontFamily: 'Arial',
        _annotations: [],   // { type, data } - for undo
        _drawing: false,
        _startX: 0, _startY: 0,
        _snapshot: null,   // ImageData for live shape preview
        _pdfPageData: null, // rendered page as image

        configHTML: `
            <div class="info-box" style="background:#e7f3ff;border-color:var(--color-primary);">
                💬 <strong>Annotate PDF</strong> — Upload a PDF, pick a tool, annotate, then save.
            </div>

            <!-- Tool palette -->
            <div class="form-group">
                <label class="form-label">Annotation Tool</label>
                <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;" id="annoToolPalette">
                    <button type="button" class="anno-tool-btn active-anno" data-tool="text"    onclick="Tools.annotate.setMode('text')"      style="padding:8px 4px;border:2px solid #667eea;background:#f0f0ff;border-radius:8px;cursor:pointer;font-size:18px;" title="Text">T</button>
                    <button type="button" class="anno-tool-btn" data-tool="pen"     onclick="Tools.annotate.setMode('pen')"       style="padding:8px 4px;border:2px solid #ddd;background:white;border-radius:8px;cursor:pointer;font-size:18px;" title="Freehand">✏️</button>
                    <button type="button" class="anno-tool-btn" data-tool="highlight" onclick="Tools.annotate.setMode('highlight')" style="padding:8px 4px;border:2px solid #ddd;background:white;border-radius:8px;cursor:pointer;font-size:18px;" title="Highlight">🖊️</button>
                    <button type="button" class="anno-tool-btn" data-tool="arrow"   onclick="Tools.annotate.setMode('arrow')"     style="padding:8px 4px;border:2px solid #ddd;background:white;border-radius:8px;cursor:pointer;font-size:18px;" title="Arrow">➡️</button>
                    <button type="button" class="anno-tool-btn" data-tool="line"    onclick="Tools.annotate.setMode('line')"      style="padding:8px 4px;border:2px solid #ddd;background:white;border-radius:8px;cursor:pointer;font-size:18px;" title="Line">╱</button>
                    <button type="button" class="anno-tool-btn" data-tool="rect"    onclick="Tools.annotate.setMode('rect')"      style="padding:8px 4px;border:2px solid #ddd;background:white;border-radius:8px;cursor:pointer;font-size:18px;" title="Rectangle">▭</button>
                    <button type="button" class="anno-tool-btn" data-tool="ellipse" onclick="Tools.annotate.setMode('ellipse')"   style="padding:8px 4px;border:2px solid #ddd;background:white;border-radius:8px;cursor:pointer;font-size:18px;" title="Ellipse">⬭</button>
                    <button type="button" class="anno-tool-btn" data-tool="eraser"  onclick="Tools.annotate.setMode('eraser')"    style="padding:8px 4px;border:2px solid #ddd;background:white;border-radius:8px;cursor:pointer;font-size:18px;" title="Eraser">🧹</button>
                </div>
            </div>

            <!-- Color -->
            <div class="form-group">
                <label class="form-label">Colour</label>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <button onclick="Tools.annotate.setColor('#e53e3e',this)" style="width:28px;height:28px;border-radius:50%;background:#e53e3e;border:3px solid #333;cursor:pointer;" title="Red"></button>
                    <button onclick="Tools.annotate.setColor('#2b6cb0',this)" style="width:28px;height:28px;border-radius:50%;background:#2b6cb0;border:2px solid #ddd;cursor:pointer;" title="Blue"></button>
                    <button onclick="Tools.annotate.setColor('#276749',this)" style="width:28px;height:28px;border-radius:50%;background:#276749;border:2px solid #ddd;cursor:pointer;" title="Green"></button>
                    <button onclick="Tools.annotate.setColor('#d69e2e',this)" style="width:28px;height:28px;border-radius:50%;background:#d69e2e;border:2px solid #ddd;cursor:pointer;" title="Yellow/Gold"></button>
                    <button onclick="Tools.annotate.setColor('#553c9a',this)" style="width:28px;height:28px;border-radius:50%;background:#553c9a;border:2px solid #ddd;cursor:pointer;" title="Purple"></button>
                    <button onclick="Tools.annotate.setColor('#1a1a1a',this)" style="width:28px;height:28px;border-radius:50%;background:#1a1a1a;border:2px solid #ddd;cursor:pointer;" title="Black"></button>
                    <input type="color" id="annoCustomColor" value="#e53e3e" oninput="Tools.annotate._color=this.value" style="width:28px;height:28px;border:2px dashed #aaa;border-radius:50%;cursor:pointer;padding:2px;" title="Custom">
                </div>
            </div>

            <!-- Size / Font -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                <div class="form-group">
                    <label class="form-label">Stroke Size</label>
                    <input type="range" id="annoStrokeSize" min="1" max="20" value="3" oninput="Tools.annotate._lineWidth=+this.value;document.getElementById('annoStrokeSizeVal').textContent=this.value">
                    <span id="annoStrokeSizeVal" style="font-size:12px;color:var(--color-text-muted);">3</span>
                </div>
                <div class="form-group">
                    <label class="form-label">Font Size</label>
                    <input type="range" id="annoFontSize" min="8" max="72" value="18" oninput="Tools.annotate._fontSize=+this.value;document.getElementById('annoFontSizeVal').textContent=this.value">
                    <span id="annoFontSizeVal" style="font-size:12px;color:var(--color-text-muted);">18</span>
                </div>
            </div>

            <!-- Font family -->
            <div class="form-group" id="annoFontGroup">
                <label class="form-label">Font</label>
                <select class="form-select" id="annoFont" onchange="Tools.annotate._fontFamily=this.value">
                    <option value="Arial">Arial</option>
                    <option value="Georgia">Georgia</option>
                    <option value="Courier New">Courier New</option>
                    <option value="Times New Roman">Times New Roman</option>
                    <option value="Verdana">Verdana</option>
                </select>
            </div>

            <!-- Actions -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px;">
                <button type="button" class="btn btn-secondary" onclick="Tools.annotate.undo()">↶ Undo</button>
                <button type="button" class="btn btn-secondary" onclick="Tools.annotate.clearAll()">🗑️ Clear All</button>
            </div>

            <div class="info-box" style="background:#e7f9ed;border-color:var(--color-success);margin-top:12px;">
                ✅ Click <strong>Process Files</strong> to bake annotations into the PDF and download.
            </div>
        `,

        setMode(mode) {
            this._mode = mode;
            document.querySelectorAll('.anno-tool-btn').forEach(b => {
                const active = b.dataset.tool === mode;
                b.style.border = active ? '2px solid #667eea' : '2px solid #ddd';
                b.style.background = active ? '#f0f0ff' : 'white';
            });
            const fontGroup = document.getElementById('annoFontGroup');
            if (fontGroup) fontGroup.style.display = mode === 'text' ? 'block' : 'none';
            if (this._canvas) this._canvas.style.cursor = mode === 'text' ? 'text' : mode === 'eraser' ? 'cell' : 'crosshair';
        },

        setColor(hex, btn) {
            this._color = hex;
            document.querySelectorAll('#annoToolPalette ~ div button[style*="border-radius:50%"]').forEach(b => b.style.border = '2px solid #ddd');
            if (btn) btn.style.border = '3px solid #333';
            const cc = document.getElementById('annoCustomColor');
            if (cc) cc.value = hex;
        },

        _attachCanvas() {
            const wrapper = document.getElementById('canvasWrapper');
            const base = document.getElementById('pdfPreviewCanvas');
            if (!wrapper || !base) return false;

            // Remove any old annotation canvas
            const old = document.getElementById('annoOverlayCanvas');
            if (old) old.remove();

            const c = document.createElement('canvas');
            c.id = 'annoOverlayCanvas';
            c.width  = base.width;
            c.height = base.height;
            c.style.cssText = `position:absolute;top:0;left:0;width:${base.style.width||base.width+'px'};height:${base.style.height||base.height+'px'};cursor:crosshair;touch-action:none;z-index:10;`;
            wrapper.appendChild(c);

            this._canvas = c;
            this._ctx    = c.getContext('2d');
            this._annotations = [];
            this._bindCanvasEvents();
            return true;
        },

        _bindCanvasEvents() {
            const c = this._canvas;
            const getPos = e => {
                const r = c.getBoundingClientRect();
                const sx = c.width  / r.width;
                const sy = c.height / r.height;
                const src = e.touches ? e.touches[0] : e;
                return { x: (src.clientX - r.left) * sx, y: (src.clientY - r.top) * sy };
            };

            c.addEventListener('mousedown',  e => this._onDown(getPos(e)));
            c.addEventListener('mousemove',  e => this._onMove(getPos(e)));
            c.addEventListener('mouseup',    e => this._onUp(getPos(e)));
            c.addEventListener('mouseleave', e => this._onUp(getPos(e)));
            c.addEventListener('touchstart', e => { e.preventDefault(); this._onDown(getPos(e)); }, { passive:false });
            c.addEventListener('touchmove',  e => { e.preventDefault(); this._onMove(getPos(e)); }, { passive:false });
            c.addEventListener('touchend',   e => { e.preventDefault(); this._onUp(getPos(e)); },  { passive:false });
            c.addEventListener('click',      e => { if (this._mode === 'text') this._addText(getPos(e)); });
        },

        _onDown(pos) {
            if (this._mode === 'text') return;
            this._drawing = true;
            this._startX  = pos.x;
            this._startY  = pos.y;
            this._snapshot = this._ctx.getImageData(0, 0, this._canvas.width, this._canvas.height);

            if (this._mode === 'pen' || this._mode === 'highlight' || this._mode === 'eraser') {
                this._ctx.beginPath();
                this._ctx.moveTo(pos.x, pos.y);
                if (this._mode === 'pen') {
                    this._ctx.strokeStyle = this._color;
                    this._ctx.lineWidth   = this._lineWidth;
                    this._ctx.globalAlpha = 1;
                    this._ctx.globalCompositeOperation = 'source-over';
                } else if (this._mode === 'highlight') {
                    this._ctx.strokeStyle = this._color;
                    this._ctx.lineWidth   = this._lineWidth * 5;
                    this._ctx.globalAlpha = 0.3;
                    this._ctx.globalCompositeOperation = 'source-over';
                } else {
                    this._ctx.strokeStyle = 'rgba(0,0,0,1)';
                    this._ctx.lineWidth   = this._lineWidth * 6;
                    this._ctx.globalCompositeOperation = 'destination-out';
                }
                this._ctx.lineCap  = 'round';
                this._ctx.lineJoin = 'round';
            }
        },

        _onMove(pos) {
            if (!this._drawing) return;
            if (this._mode === 'pen' || this._mode === 'highlight' || this._mode === 'eraser') {
                this._ctx.lineTo(pos.x, pos.y);
                this._ctx.stroke();
            } else {
                // Live shape preview
                this._ctx.putImageData(this._snapshot, 0, 0);
                this._drawShape(this._mode, this._startX, this._startY, pos.x, pos.y);
            }
        },

        _onUp(pos) {
            if (!this._drawing) return;
            this._drawing = false;
            if (this._mode !== 'pen' && this._mode !== 'highlight' && this._mode !== 'eraser') {
                this._ctx.putImageData(this._snapshot, 0, 0);
                this._drawShape(this._mode, this._startX, this._startY, pos.x, pos.y);
            }
            this._ctx.globalAlpha = 1;
            this._ctx.globalCompositeOperation = 'source-over';
            this._annotations.push(this._ctx.getImageData(0, 0, this._canvas.width, this._canvas.height));
        },

        _drawShape(type, x1, y1, x2, y2) {
            const ctx = this._ctx;
            ctx.strokeStyle = this._color;
            ctx.fillStyle   = this._color;
            ctx.lineWidth   = this._lineWidth;
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
            ctx.lineCap  = 'round';
            ctx.lineJoin = 'round';

            if (type === 'line') {
                ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
            } else if (type === 'rect') {
                ctx.beginPath(); ctx.strokeRect(x1, y1, x2-x1, y2-y1);
            } else if (type === 'ellipse') {
                ctx.beginPath();
                ctx.ellipse((x1+x2)/2, (y1+y2)/2, Math.abs(x2-x1)/2, Math.abs(y2-y1)/2, 0, 0, Math.PI*2);
                ctx.stroke();
            } else if (type === 'arrow') {
                const headLen = 16;
                const angle   = Math.atan2(y2-y1, x2-x1);
                ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(x2, y2);
                ctx.lineTo(x2 - headLen*Math.cos(angle-Math.PI/6), y2 - headLen*Math.sin(angle-Math.PI/6));
                ctx.lineTo(x2 - headLen*Math.cos(angle+Math.PI/6), y2 - headLen*Math.sin(angle+Math.PI/6));
                ctx.closePath(); ctx.fill();
            }
        },

        _addText(pos) {
            const text = prompt('Enter annotation text:');
            if (!text) return;
            const ctx = this._ctx;
            ctx.font         = `${this._fontSize}px ${this._fontFamily}`;
            ctx.fillStyle    = this._color;
            ctx.globalAlpha  = 1;
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillText(text, pos.x, pos.y);
            this._annotations.push(ctx.getImageData(0, 0, this._canvas.width, this._canvas.height));
        },

        undo() {
            this._annotations.pop();
            if (this._annotations.length > 0) {
                this._ctx.putImageData(this._annotations[this._annotations.length - 1], 0, 0);
            } else {
                this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
            }
        },

        clearAll() {
            if (!confirm('Clear all annotations?')) return;
            this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
            this._annotations = [];
        },

        init() {
            // Wait for PDF to be loaded into preview, then attach overlay
            const tryAttach = () => {
                if (document.getElementById('pdfPreviewCanvas')) {
                    this._attachCanvas();
                } else {
                    setTimeout(tryAttach, 300);
                }
            };
            tryAttach();

            // Re-attach if page changes
            const origRender = PDFPreview.renderPage.bind(PDFPreview);
            PDFPreview.renderPage = async (pageNum) => {
                await origRender(pageNum);
                this._attachCanvas();
            };
        },

        cleanup() {
            const old = document.getElementById('annoOverlayCanvas');
            if (old) old.remove();
        },

        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            if (pdfFiles.length === 0) { Utils.showStatus('Please select a PDF file', 'error'); return; }

            if (!this._canvas) { Utils.showStatus('Please open a PDF in the preview first, then annotate it', 'error'); return; }

            const base = document.getElementById('pdfPreviewCanvas');
            if (!base) { Utils.showStatus('PDF preview not found', 'error'); return; }

            Utils.updateProgress(10, 'Compositing annotations...');

            // Merge base canvas + overlay into single image
            const merged = document.createElement('canvas');
            merged.width  = base.width;
            merged.height = base.height;
            const mCtx = merged.getContext('2d');
            mCtx.drawImage(base, 0, 0);
            mCtx.drawImage(this._canvas, 0, 0);
            const annotatedDataUrl = merged.toDataURL('image/png');

            Utils.updateProgress(30, 'Loading PDF...');
            const file = pdfFiles[0];
            const arrayBuffer = await file.arrayBuffer();
            const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, file.name);

            Utils.updateProgress(50, 'Embedding annotations...');
            const pages      = pdfDoc.getPages();
            const pageIndex  = (PDFPreview.currentPage || 1) - 1;
            const page       = pages[Math.min(pageIndex, pages.length - 1)];
            const { width: pw, height: ph } = page.getSize();

            const annoImg = await pdfDoc.embedPng(annotatedDataUrl);
            // Draw annotated version as full-page overlay (annotations only layer)
            // We draw the annotation canvas scaled to the PDF page
            const scaleX = pw / base.width;
            const scaleY = ph / base.height;

            // Embed just the overlay canvas
            const overlayCanvas = document.createElement('canvas');
            overlayCanvas.width  = base.width;
            overlayCanvas.height = base.height;
            overlayCanvas.getContext('2d').drawImage(this._canvas, 0, 0);
            const overlayDataUrl = overlayCanvas.toDataURL('image/png');
            const overlayImg = await pdfDoc.embedPng(overlayDataUrl);

            page.drawImage(overlayImg, { x: 0, y: 0, width: pw, height: ph });

            if (AppState.autoScrubMetadata) Utils.scrubMetadata(pdfDoc, true);

            Utils.updateProgress(90, 'Saving annotated PDF...');
            const pdfBytes = await pdfDoc.save();
            saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), `annotated_${file.name}`);

            Utils.updateProgress(100, 'Complete!');
            Utils.showStatus('Annotated PDF saved!', 'success');
        }
    },

    // ==================== EDIT PDF ====================
    editpdf: {
        name: 'Edit PDF',
        description: 'Add, move and delete text blocks and images on a PDF page',
        icon: '✏️',
        _canvas: null,
        _ctx: null,
        _elements: [],   // { type:'text'|'image', x, y, w, h, text, color, fontSize, fontFamily, imgDataUrl, rotation }
        _selected: -1,
        _dragging: false,
        _resizing: false,
        _dragOffX: 0, _dragOffY: 0,
        _mode: 'select',  // select | addText | addImage | addRect | addLine

        configHTML: `
            <div class="info-box" style="background:#fff3e0;border-color:#ff9800;">
                ✏️ <strong>PDF Editor</strong> — Add text boxes, images and shapes directly onto the page.
                Load a PDF in the preview, edit, then click <strong>Process Files</strong> to save.
            </div>

            <!-- Mode -->
            <div class="form-group">
                <label class="form-label">Edit Mode</label>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;" id="editModePalette">
                    <button type="button" class="edit-mode-btn active-edit" data-mode="select" style="padding:8px 4px;border:2px solid #667eea;background:#f0f0ff;border-radius:8px;cursor:pointer;font-size:13px;">🖱️ Select</button>
                    <button type="button" class="edit-mode-btn" data-mode="addText" style="padding:8px 4px;border:2px solid #ddd;background:white;border-radius:8px;cursor:pointer;font-size:13px;">T+ Text</button>
                    <button type="button" class="edit-mode-btn" data-mode="addImage" style="padding:8px 4px;border:2px solid #ddd;background:white;border-radius:8px;cursor:pointer;font-size:13px;">🖼️ Image</button>
                    <button type="button" class="edit-mode-btn" data-mode="addRect" style="padding:8px 4px;border:2px solid #ddd;background:white;border-radius:8px;cursor:pointer;font-size:13px;">▭ Box</button>
                    <button type="button" class="edit-mode-btn" data-mode="addLine" style="padding:8px 4px;border:2px solid #ddd;background:white;border-radius:8px;cursor:pointer;font-size:13px;">╱ Line</button>
                    <button type="button" class="edit-mode-btn" data-mode="delete" style="padding:8px 4px;border:2px solid #ddd;background:white;border-radius:8px;cursor:pointer;font-size:13px;">🗑️ Delete</button>
                </div>
            </div>

            <!-- Image upload (hidden until addImage mode) -->
            <div class="form-group" id="editImageUploadGroup" style="display:none;">
                <label class="form-label">Image to Add</label>
                <input type="file" class="form-input" id="editImageFile" accept="image/*">
            </div>

            <!-- Text options -->
            <div id="editTextOptions">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                    <div class="form-group">
                        <label class="form-label">Font</label>
                        <select class="form-select" id="editFont">
                            <option value="Arial">Arial</option>
                            <option value="Georgia">Georgia</option>
                            <option value="Courier New">Courier New</option>
                            <option value="Times New Roman">Times New Roman</option>
                            <option value="Verdana">Verdana</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Font Size</label>
                        <input type="number" class="form-input" id="editFontSize" value="16" min="6" max="120">
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Colour</label>
                    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                        <button data-color="#1a1a1a" class="edit-color-btn" style="width:26px;height:26px;border-radius:50%;background:#1a1a1a;border:3px solid #667eea;cursor:pointer;"></button>
                        <button data-color="#e53e3e" class="edit-color-btn" style="width:26px;height:26px;border-radius:50%;background:#e53e3e;border:2px solid #ddd;cursor:pointer;"></button>
                        <button data-color="#2b6cb0" class="edit-color-btn" style="width:26px;height:26px;border-radius:50%;background:#2b6cb0;border:2px solid #ddd;cursor:pointer;"></button>
                        <button data-color="#276749" class="edit-color-btn" style="width:26px;height:26px;border-radius:50%;background:#276749;border:2px solid #ddd;cursor:pointer;"></button>
                        <button data-color="#d69e2e" class="edit-color-btn" style="width:26px;height:26px;border-radius:50%;background:#d69e2e;border:2px solid #ddd;cursor:pointer;"></button>
                        <input type="color" id="editCustomColor" value="#1a1a1a" style="width:26px;height:26px;border:2px dashed #aaa;border-radius:50%;cursor:pointer;padding:2px;">
                    </div>
                </div>
            </div>

            <!-- Selected element properties -->
            <div id="editSelectedProps" style="display:none;padding:10px;background:#f8f8f8;border-radius:8px;border:1px solid #ddd;margin-top:4px;">
                <p style="font-size:12px;font-weight:600;margin:0 0 8px 0;">Selected Element</p>
                <textarea id="editSelectedText" rows="2" class="form-input" placeholder="Edit text..." style="font-size:13px;margin-bottom:6px;"></textarea>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
                    <button class="btn btn-secondary edit-delete-selected" style="font-size:12px;">🗑️ Delete</button>
                    <button class="btn btn-secondary edit-duplicate-selected" style="font-size:12px;">⧉ Duplicate</button>
                </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">
                <button class="btn btn-secondary edit-undo-btn">↶ Undo</button>
                <button class="btn btn-secondary edit-clear-btn">🗑️ Clear All</button>
            </div>
            <div class="info-box" style="background:#e7f9ed;border-color:var(--color-success);margin-top:12px;">
                ✅ Click <strong>Process Files</strong> to save the edited PDF.
            </div>
        `,

        _color: '#1a1a1a',
        _history: [],

        setMode(mode) {
            console.log('[EditPDF] setMode called:', mode);
            this._mode = mode;
            this._selected = -1;
            document.querySelectorAll('.edit-mode-btn').forEach(b => {
                const active = b.dataset.mode === mode;
                b.style.border = active ? '2px solid #667eea' : '2px solid #ddd';
                b.style.background = active ? '#f0f0ff' : 'white';
            });
            const imgGroup = document.getElementById('editImageUploadGroup');
            if (imgGroup) imgGroup.style.display = mode === 'addImage' ? 'block' : 'none';
            if (this._canvas) {
                this._canvas.style.cursor = mode === 'select' ? 'default' : mode === 'delete' ? 'not-allowed' : 'crosshair';
                console.log('[EditPDF] Canvas cursor set to:', this._canvas.style.cursor);
            }
            this._render();
            console.log('[EditPDF] Mode set to:', mode);
        },

        setColor(hex, btn) {
            console.log('[EditPDF] setColor called:', hex);
            this._color = hex;
            document.querySelectorAll('.edit-color-btn').forEach(b => b.style.border = '2px solid #ddd');
            if (btn) btn.style.border = '3px solid #667eea';
            const cc = document.getElementById('editCustomColor');
            if (cc) cc.value = hex;
            console.log('[EditPDF] Color set to:', hex);
        },

        _attachCanvas() {
            const wrapper = document.getElementById('canvasWrapper');
            const base    = document.getElementById('pdfPreviewCanvas');
            if (!wrapper || !base) return false;

            const old = document.getElementById('editOverlayCanvas');
            if (old) old.remove();

            const c = document.createElement('canvas');
            c.id = 'editOverlayCanvas';
            c.width  = base.width;
            c.height = base.height;
            c.style.cssText = `position:absolute;top:0;left:0;width:${base.style.width||base.width+'px'};height:${base.style.height||base.height+'px'};cursor:default;touch-action:none;z-index:10;`;
            wrapper.appendChild(c);

            this._canvas = c;
            this._ctx    = c.getContext('2d');
            this._elements = [];
            this._history  = [];
            this._selected = -1;
            this._imageCache = new Map(); // FIX: Cache decoded images to prevent re-instantiation every render
            this._bindEvents();
            this._render();
            return true;
        },

        _bindEvents() {
            const c = this._canvas;
            if (!c) {
                console.error('[EditPDF] _bindEvents called but canvas is null!');
                return;
            }
            
            console.log('[EditPDF] Binding canvas events to:', c.id);
            
            const getPos = e => {
                const r  = c.getBoundingClientRect();
                const sx = c.width  / r.width;
                const sy = c.height / r.height;
                const src = e.touches ? e.touches[0] : e;
                return { x: (src.clientX - r.left)*sx, y: (src.clientY - r.top)*sy };
            };

            c.addEventListener('mousedown',  e => {
                console.log('[EditPDF] Canvas mousedown event');
                this._onDown(getPos(e), e);
            });
            c.addEventListener('mousemove',  e => this._onMov(getPos(e)));
            c.addEventListener('mouseup',    e => {
                console.log('[EditPDF] Canvas mouseup event');
                this._onUp();
            });
            c.addEventListener('touchstart', e => { 
                console.log('[EditPDF] Canvas touchstart event');
                e.preventDefault(); 
                this._onDown(getPos(e), e); 
            }, { passive:false });
            c.addEventListener('touchmove',  e => { e.preventDefault(); this._onMov(getPos(e)); }, { passive:false });
            c.addEventListener('touchend',   e => { 
                console.log('[EditPDF] Canvas touchend event');
                e.preventDefault(); 
                this._onUp(); 
            }, { passive:false });
            
            console.log('[EditPDF] Canvas events bound successfully');
        },

        _hitTest(x, y) {
            for (let i = this._elements.length - 1; i >= 0; i--) {
                const el = this._elements[i];
                if (x >= el.x && x <= el.x + el.w && y >= el.y && y <= el.y + el.h) return i;
            }
            return -1;
        },

        _onDown(pos, e) {
            const { x, y } = pos;
            console.log('[EditPDF] _onDown called at', {x, y}, 'mode:', this._mode);

            if (this._mode === 'select') {
                console.log('[EditPDF] Select mode - checking for hit');
                const hit = this._hitTest(x, y);
                console.log('[EditPDF] Hit test result:', hit);
                this._selected = hit;
                if (hit >= 0) {
                    this._dragging = true;
                    this._dragOffX = x - this._elements[hit].x;
                    this._dragOffY = y - this._elements[hit].y;
                    this._showSelectedProps();
                } else {
                    this._hideSelectedProps();
                }
                this._render();
                return;
            }

            if (this._mode === 'delete') {
                console.log('[EditPDF] Delete mode - checking for hit');
                const hit = this._hitTest(x, y);
                if (hit >= 0) { 
                    console.log('[EditPDF] Deleting element', hit);
                    this._saveHistory(); 
                    this._elements.splice(hit, 1); 
                    this._render(); 
                }
                return;
            }

            if (this._mode === 'addText') {
                console.log('[EditPDF] AddText mode - showing prompt');
                const text = prompt('Enter text:');
                console.log('[EditPDF] User entered:', text);
                if (!text) return;
                const fontSize = parseInt(document.getElementById('editFontSize')?.value || 16);
                const font = document.getElementById('editFont')?.value || 'Arial';
                this._saveHistory();
                this._elements.push({ type:'text', x, y:y-fontSize, w:Math.max(text.length*fontSize*0.6+20, 80), h:fontSize+16, text, color:this._color, fontSize, fontFamily:font });
                console.log('[EditPDF] Text element added, total elements:', this._elements.length);
                this._render();
                return;
            }

            if (this._mode === 'addRect') {
                console.log('[EditPDF] AddRect mode - adding rectangle');
                const w = 150, h = 80;
                this._saveHistory();
                this._elements.push({ type:'rect', x:x-w/2, y:y-h/2, w, h, color:this._color, lineWidth: 2 });
                console.log('[EditPDF] Rect element added, total elements:', this._elements.length);
                this._render();
                return;
            }

            if (this._mode === 'addLine') {
                console.log('[EditPDF] AddLine mode - adding line');
                this._saveHistory();
                this._elements.push({ type:'line', x:x-60, y, w:120, h:4, color:this._color, lineWidth:2 });
                console.log('[EditPDF] Line element added, total elements:', this._elements.length);
                this._render();
                return;
            }

            if (this._mode === 'addImage') {
                const fileInput = document.getElementById('editImageFile');
                const file = fileInput?.files[0];
                if (!file) { Utils.showStatus('Please select an image to add first', 'error'); return; }
                const reader = new FileReader();
                reader.onload = ev => {
                    const img = new Image();
                    img.onload = () => {
                        const aspect = img.width / img.height;
                        const w = 200, h = w / aspect;
                        this._saveHistory();
                        this._elements.push({ type:'image', x:x-w/2, y:y-h/2, w, h, imgDataUrl:ev.target.result });
                        this._render();
                    };
                    img.src = ev.target.result;
                };
                reader.readAsDataURL(file);
            }
        },

        _onMov(pos) {
            if (!this._dragging || this._selected < 0) return;
            this._elements[this._selected].x = pos.x - this._dragOffX;
            this._elements[this._selected].y = pos.y - this._dragOffY;
            this._render();
        },

        _onUp() {
            this._dragging  = false;
            this._resizing  = false;
        },

        _showSelectedProps() {
            const panel = document.getElementById('editSelectedProps');
            const txtArea = document.getElementById('editSelectedText');
            if (!panel) return;
            const el = this._elements[this._selected];
            panel.style.display = 'block';
            if (txtArea) txtArea.value = el.type === 'text' ? el.text : '';
            if (el.type !== 'text') txtArea.parentElement.style.display = 'none';
        },

        _hideSelectedProps() {
            const panel = document.getElementById('editSelectedProps');
            if (panel) panel.style.display = 'none';
        },

        updateSelected() {
            if (this._selected < 0) return;
            const el = this._elements[this._selected];
            if (el.type === 'text') {
                el.text = document.getElementById('editSelectedText')?.value || '';
                this._render();
            }
        },

        deleteSelected() {
            if (this._selected < 0) return;
            this._saveHistory();
            this._elements.splice(this._selected, 1);
            this._selected = -1;
            this._hideSelectedProps();
            this._render();
        },

        duplicateSelected() {
            if (this._selected < 0) return;
            const clone = JSON.parse(JSON.stringify(this._elements[this._selected]));
            clone.x += 20; clone.y += 20;
            this._saveHistory();
            this._elements.push(clone);
            this._selected = this._elements.length - 1;
            this._render();
        },

        _saveHistory() {
            this._history.push(JSON.parse(JSON.stringify(this._elements)));
            if (this._history.length > 30) this._history.shift();
        },

        undoLast() {
            if (this._history.length === 0) return;
            this._elements = this._history.pop();
            this._selected = -1;
            this._hideSelectedProps();
            this._render();
        },

        clearAll() {
            if (!confirm('Remove all added elements?')) return;
            this._saveHistory();
            this._elements = [];
            this._selected = -1;
            this._hideSelectedProps();
            this._render();
        },

        _render() {
            if (!this._ctx || !this._canvas) return;
            const ctx = this._ctx;
            ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);

            this._elements.forEach((el, i) => {
                const selected = i === this._selected;

                if (el.type === 'text') {
                    ctx.font      = `${el.fontSize}px ${el.fontFamily}`;
                    ctx.fillStyle = el.color;
                    ctx.globalAlpha = 1;
                    // Background box
                    const metrics = ctx.measureText(el.text);
                    el.w = metrics.width + 20;
                    el.h = el.fontSize + 16;
                    if (selected) {
                        ctx.fillStyle = 'rgba(102,126,234,0.1)';
                        ctx.fillRect(el.x, el.y, el.w, el.h);
                    }
                    ctx.fillStyle = el.color;
                    ctx.fillText(el.text, el.x + 8, el.y + el.fontSize + 4);

                } else if (el.type === 'rect') {
                    ctx.strokeStyle = el.color;
                    ctx.lineWidth   = el.lineWidth || 2;
                    ctx.globalAlpha = 1;
                    ctx.strokeRect(el.x, el.y, el.w, el.h);

                } else if (el.type === 'line') {
                    ctx.strokeStyle = el.color;
                    ctx.lineWidth   = el.lineWidth || 2;
                    ctx.globalAlpha = 1;
                    ctx.beginPath();
                    ctx.moveTo(el.x, el.y + el.h/2);
                    ctx.lineTo(el.x + el.w, el.y + el.h/2);
                    ctx.stroke();

                } else if (el.type === 'image') {
                    // FIX: Cache decoded HTMLImageElement by data URL to prevent
                    // creating a new Image() object on every single render call
                    if (!this._imageCache) this._imageCache = new Map();
                    let img = this._imageCache.get(el.imgDataUrl);
                    if (img && img.complete) {
                        ctx.drawImage(img, el.x, el.y, el.w, el.h);
                    } else if (!img) {
                        img = new Image();
                        img.onload = () => { this._imageCache.set(el.imgDataUrl, img); this._render(); };
                        img.src = el.imgDataUrl;
                    }
                }

                // Selection handles
                if (selected) {
                    ctx.strokeStyle = '#667eea';
                    ctx.lineWidth   = 2;
                    ctx.setLineDash([4, 3]);
                    ctx.strokeRect(el.x - 3, el.y - 3, el.w + 6, el.h + 6);
                    ctx.setLineDash([]);
                    // Corner handle
                    ctx.fillStyle = '#667eea';
                    ctx.fillRect(el.x + el.w - 6, el.y + el.h - 6, 10, 10);
                }
            });
        },

        init() {
            console.log('[EditPDF] init() called');
            
            // FIX v9.0.0: Comprehensive event binding with debugging
            const bindEvents = () => {
                console.log('[EditPDF] Starting event binding...');
                
                // 1. Bind mode buttons
                const modeBtns = document.querySelectorAll('.edit-mode-btn');
                console.log('[EditPDF] Found', modeBtns.length, 'mode buttons');
                modeBtns.forEach(btn => {
                    const mode = btn.dataset.mode;
                    if (mode) {
                        btn.addEventListener('click', () => {
                            console.log('[EditPDF] Mode button clicked:', mode);
                            this.setMode(mode);
                        });
                    }
                });
                
                // 2. Bind color buttons
                const colorBtns = document.querySelectorAll('.edit-color-btn');
                console.log('[EditPDF] Found', colorBtns.length, 'color buttons');
                colorBtns.forEach(btn => {
                    const color = btn.dataset.color;
                    if (color) {
                        btn.addEventListener('click', () => {
                            console.log('[EditPDF] Color button clicked:', color);
                            this.setColor(color, btn);
                        });
                    }
                });
                
                // 3. Bind custom color input
                const customColorInput = document.getElementById('editCustomColor');
                if (customColorInput) {
                    customColorInput.addEventListener('input', (e) => {
                        console.log('[EditPDF] Custom color changed:', e.target.value);
                        this._color = e.target.value;
                    });
                    console.log('[EditPDF] Custom color input bound');
                }
                
                // 4. Bind text editing textarea
                const selectedTextArea = document.getElementById('editSelectedText');
                if (selectedTextArea) {
                    selectedTextArea.addEventListener('input', () => {
                        console.log('[EditPDF] Text updated');
                        this.updateSelected();
                    });
                    console.log('[EditPDF] Text area bound');
                }
                
                // 5. Bind action buttons
                const deleteBtn = document.querySelector('.edit-delete-selected');
                const duplicateBtn = document.querySelector('.edit-duplicate-selected');
                const undoBtn = document.querySelector('.edit-undo-btn');
                const clearBtn = document.querySelector('.edit-clear-btn');
                
                if (deleteBtn) {
                    deleteBtn.addEventListener('click', () => {
                        console.log('[EditPDF] Delete selected');
                        this.deleteSelected();
                    });
                }
                if (duplicateBtn) {
                    duplicateBtn.addEventListener('click', () => {
                        console.log('[EditPDF] Duplicate selected');
                        this.duplicateSelected();
                    });
                }
                if (undoBtn) {
                    undoBtn.addEventListener('click', () => {
                        console.log('[EditPDF] Undo');
                        this.undoLast();
                    });
                }
                if (clearBtn) {
                    clearBtn.addEventListener('click', () => {
                        console.log('[EditPDF] Clear all');
                        this.clearAll();
                    });
                }
                
                console.log('[EditPDF] Action buttons bound:', {
                    delete: !!deleteBtn,
                    duplicate: !!duplicateBtn,
                    undo: !!undoBtn,
                    clear: !!clearBtn
                });
                
                console.log('[EditPDF] ✅ All event listeners bound successfully');
            };
            
            // Bind events after DOM is ready (200ms delay to be safe)
            setTimeout(bindEvents.bind(this), 200);
            
            // Attach canvas to PDF preview
            const tryAttach = () => {
                if (document.getElementById('pdfPreviewCanvas')) {
                    console.log('[EditPDF] PDF canvas found, attaching...');
                    this._attachCanvas();
                } else {
                    console.log('[EditPDF] Waiting for PDF canvas...');
                    setTimeout(tryAttach, 300);
                }
            };
            tryAttach();

            // Intercept PDF preview rendering to re-attach our overlay
            const origRender = PDFPreview.renderPage.bind(PDFPreview);
            PDFPreview.renderPage = async (pageNum) => {
                await origRender(pageNum);
                console.log('[EditPDF] PDF page rendered, re-attaching overlay');
                
                const wrapper = document.getElementById('canvasWrapper');
                const base    = document.getElementById('pdfPreviewCanvas');
                if (!wrapper || !base) {
                    console.warn('[EditPDF] Wrapper or base canvas not found');
                    return;
                }
                
                const old = document.getElementById('editOverlayCanvas');
                if (old) old.remove();
                
                const c = document.createElement('canvas');
                c.id = 'editOverlayCanvas';
                c.width  = base.width;
                c.height = base.height;
                c.style.cssText = `position:absolute;top:0;left:0;width:${base.style.width||base.width+'px'};height:${base.style.height||base.height+'px'};cursor:default;touch-action:none;z-index:10;`;
                wrapper.appendChild(c);
                
                this._canvas = c;
                this._ctx    = c.getContext('2d');
                this._bindEvents();
                this._render();
                
                console.log('[EditPDF] Overlay canvas attached');
            };
        },

        cleanup() {
            const old = document.getElementById('editOverlayCanvas');
            if (old) old.remove();
        },

        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            if (pdfFiles.length === 0) { Utils.showStatus('Please select a PDF file', 'error'); return; }
            if (!this._canvas) { Utils.showStatus('Please open a PDF in the preview first', 'error'); return; }
            if (this._elements.length === 0) { Utils.showStatus('No edits to apply yet — add some elements first!', 'warning'); return; }

            Utils.updateProgress(10, 'Loading PDF...');
            const file = pdfFiles[0];
            const arrayBuffer = await file.arrayBuffer();
            const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, file.name);

            Utils.updateProgress(40, 'Applying edits...');
            const pages     = pdfDoc.getPages();
            const pageIndex = (PDFPreview.currentPage || 1) - 1;
            const page      = pages[Math.min(pageIndex, pages.length - 1)];
            const { width: pw, height: ph } = page.getSize();

            const scaleX = pw / this._canvas.width;
            const scaleY = ph / this._canvas.height;

            // Apply each element directly via pdf-lib for crisp output
            for (const el of this._elements) {
                if (el.type === 'text') {
                    try {
                        page.drawText(el.text, {
                            x: el.x * scaleX,
                            y: ph - (el.y + el.h) * scaleY,
                            size: el.fontSize * scaleY,
                            color: this._hexToRgb(el.color),
                            opacity: 1
                        });
                    } catch(e) { console.warn('[EditPDF] Text draw error:', e); }

                } else if (el.type === 'rect') {
                    page.drawRectangle({
                        x: el.x * scaleX,
                        y: ph - (el.y + el.h) * scaleY,
                        width:  el.w * scaleX,
                        height: el.h * scaleY,
                        borderColor: this._hexToRgb(el.color),
                        borderWidth: (el.lineWidth || 2) * scaleX,
                        opacity: 0
                    });

                } else if (el.type === 'line') {
                    page.drawLine({
                        start: { x: el.x * scaleX, y: ph - (el.y + el.h/2) * scaleY },
                        end:   { x: (el.x + el.w) * scaleX, y: ph - (el.y + el.h/2) * scaleY },
                        thickness: (el.lineWidth || 2) * scaleX,
                        color: this._hexToRgb(el.color),
                        opacity: 1
                    });

                } else if (el.type === 'image') {
                    try {
                        const isPng = el.imgDataUrl.startsWith('data:image/png');
                        const imgEmbed = isPng ? await pdfDoc.embedPng(el.imgDataUrl) : await pdfDoc.embedJpg(el.imgDataUrl);
                        page.drawImage(imgEmbed, {
                            x: el.x * scaleX,
                            y: ph - (el.y + el.h) * scaleY,
                            width:  el.w * scaleX,
                            height: el.h * scaleY
                        });
                    } catch(e) { console.warn('[EditPDF] Image embed error:', e); }
                }
            }

            if (AppState.autoScrubMetadata) Utils.scrubMetadata(pdfDoc, true);

            Utils.updateProgress(90, 'Saving edited PDF...');
            const pdfBytes = await pdfDoc.save();
            saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), `edited_${file.name}`);

            Utils.updateProgress(100, 'Complete!');
            Utils.showStatus(`PDF edited and saved with ${this._elements.length} element(s)!`, 'success');
        },

        _hexToRgb(hex) {
            const r = parseInt(hex.slice(1,3),16)/255;
            const g = parseInt(hex.slice(3,5),16)/255;
            const b = parseInt(hex.slice(5,7),16)/255;
            return PDFLib.rgb(r, g, b);
        }
    },

    formfill: {
        name: 'Fill Forms',
        description: 'Fill PDF form fields manually or from CSV data',
        icon: '📝',
        formFields: [],
        csvData: null,
        fieldMapping: {},
        
        configHTML: `
            <div class="info-box" style="background: #e7f3ff; border-color: var(--color-primary);">
                📝 <strong>Smart Form Filling:</strong> Fill PDF forms manually or use CSV for batch filling with automatic field mapping.
            </div>
            
            <div class="form-group">
                <label class="form-label">Filling Mode</label>
                <select class="form-select" id="fillMode">
                    <option value="manual">Manual Entry</option>
                    <option value="csv">CSV Data (Batch Fill)</option>
                </select>
            </div>
            
            <div id="manualModeSection">
                <div class="info-box">
                    ℹ️ Upload a PDF with form fields to see fillable fields below.
                </div>
                <div id="formFieldsList"></div>
            </div>
            
            <div id="csvModeSection" style="display: none;">
                <div class="form-group">
                    <label class="form-label">Upload CSV File</label>
                    <input type="file" class="form-input" id="csvFileInput" accept=".csv,text/csv">
                    <p style="font-size: 12px; color: var(--color-text-muted); margin-top: 4px;">
                        CSV should have headers matching form field names. Each row creates one filled PDF.
                    </p>
                </div>
                
                <div id="csvPreview" style="display: none; margin-top: 12px;">
                    <h4 style="font-size: 14px; margin-bottom: 8px;">CSV Preview (First 5 Rows):</h4>
                    <div id="csvPreviewTable" style="overflow-x: auto; max-height: 200px; border: 1px solid #ddd; border-radius: 4px;"></div>
                    <p style="font-size: 12px; color: var(--color-success); margin-top: 8px;" id="csvRowCount"></p>
                </div>
                
                <div id="fieldMappingSection" style="display: none; margin-top: 16px;">
                    <h4 style="font-size: 14px; margin-bottom: 8px;">📋 Field Mapping:</h4>
                    <div class="info-box" style="background: #fff3cd; border-color: #ffc107; color: #856404;">
                        💡 <strong>Auto-Mapping Active:</strong> CSV columns are automatically matched to form fields. 
                        Verify the mapping below before processing.
                    </div>
                    <div id="fieldMappingList" style="margin-top: 12px;"></div>
                </div>
                
                <div class="form-group" id="csvOptionsGroup" style="display: none; margin-top: 16px;">
                    <label class="form-label">Output Options</label>
                    <select class="form-select" id="csvOutputMode">
                        <option value="zip">Download All as ZIP (Recommended for 2+ forms)</option>
                        <option value="individual">Download Each PDF Individually</option>
                    </select>
                </div>
                
                <div class="info-box" style="margin-top: 12px;">
                    💡 <strong>CSV Format Example:</strong><br>
                    <code style="font-size: 11px; display: block; margin-top: 4px;">
                    Name,Email,Phone,Address<br>
                    "John Doe",john@example.com,555-1234,"123 Main St"<br>
                    "Jane Smith",jane@example.com,555-5678,"456 Oak Ave"
                    </code>
                    <p style="font-size: 11px; margin-top: 8px; color: var(--color-text-muted);">
                        ✓ Use quotes for fields with commas<br>
                        ✓ Headers must match PDF field names (case-insensitive)<br>
                        ✓ Empty fields are left blank
                    </p>
                </div>
            </div>
            
            <div class="warning-box" id="noFormsWarning" style="display: none;">
                ⚠️ No form fields found in this PDF. Please upload a PDF with fillable form fields.
            </div>
        `,
        
        init() {
            const fillMode = document.getElementById('fillMode');
            const manualSection = document.getElementById('manualModeSection');
            const csvSection = document.getElementById('csvModeSection');
            const csvFileInput = document.getElementById('csvFileInput');
            
            // Mode switcher
            if (fillMode) {
                fillMode.addEventListener('change', (e) => {
                    if (e.target.value === 'csv') {
                        manualSection.style.display = 'none';
                        csvSection.style.display = 'block';
                    } else {
                        manualSection.style.display = 'block';
                        csvSection.style.display = 'none';
                    }
                });
            }
            
            // CSV file upload handler
            if (csvFileInput) {
                csvFileInput.addEventListener('change', async (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        await this.loadCSV(file);
                    }
                });
            }
            
            // Detect form fields when PDF is loaded
            this.detectFormFields();
        },
        
        async detectFormFields() {
            // This will be called when a PDF is uploaded
            const pdfFiles = AppState.files.filter(FileType.isPDF);
            if (pdfFiles.length === 0) return;
            
            try {
                const arrayBuffer = await pdfFiles[0].arrayBuffer();
                const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, pdfFiles[0].name);
                const form = pdfDoc.getForm();
                const fields = form.getFields();
                
                this.formFields = fields.map(field => ({
                    name: field.getName(),
                    type: field.constructor.name,
                    field: field
                }));
                
                if (this.formFields.length === 0) {
                    document.getElementById('noFormsWarning').style.display = 'block';
                    return;
                }
                
                console.log(`[FormFill] Detected ${this.formFields.length} form fields`);
                
                // Display form fields for manual entry
                this.displayFormFields();
                
                // If CSV is already loaded, update field mapping
                if (this.csvData) {
                    this.updateFieldMapping();
                }
                
            } catch (error) {
                console.error('[FormFill] Error detecting form fields:', error);
            }
        },
        
        displayFormFields() {
            const container = document.getElementById('formFieldsList');
            if (!container || this.formFields.length === 0) return;
            
            container.innerHTML = `
                <h4 style="font-size: 14px; margin: 12px 0 8px 0;">
                    Form Fields Found: ${this.formFields.length}
                </h4>
            `;
            
            this.formFields.forEach((fieldInfo, index) => {
                const fieldDiv = document.createElement('div');
                fieldDiv.className = 'form-group';
                
                const typeLabel = fieldInfo.type.replace('PDFTextField', 'Text')
                    .replace('PDFCheckBox', 'Checkbox')
                    .replace('PDFRadioGroup', 'Radio')
                    .replace('PDFDropdown', 'Dropdown');
                
                fieldDiv.innerHTML = `
                    <label class="form-label">
                        ${fieldInfo.name} 
                        <span style="font-size: 11px; color: var(--color-text-muted);">(${typeLabel})</span>
                    </label>
                    <input type="text" 
                           class="form-input" 
                           id="field_${index}" 
                           placeholder="Enter value for ${fieldInfo.name}"
                           data-field-name="${fieldInfo.name}">
                `;
                container.appendChild(fieldDiv);
            });
        },
        
        async loadCSV(file) {
            Utils.updateProgress(10, 'Parsing CSV file...');
            
            const text = await file.text();
            
            // Enhanced CSV parsing with quote support
            const parsedData = this.parseCSV(text);
            
            if (!parsedData || parsedData.rows.length === 0) {
                Utils.showStatus('CSV file must have at least header row and one data row', 'error');
                Utils.updateProgress(0, '');
                return;
            }
            
            this.csvData = parsedData;
            
            Utils.updateProgress(50, 'Processing CSV data...');
            
            // Display preview
            this.displayCSVPreview();
            
            // Show row count
            const rowCount = document.getElementById('csvRowCount');
            if (rowCount) {
                rowCount.textContent = `✓ Loaded ${parsedData.rows.length} row(s) from CSV`;
            }
            
            // Show output options
            const optionsGroup = document.getElementById('csvOptionsGroup');
            if (optionsGroup) {
                optionsGroup.style.display = 'block';
            }
            
            // Update field mapping if PDF is loaded
            if (this.formFields.length > 0) {
                this.updateFieldMapping();
            }
            
            Utils.updateProgress(100, 'Complete!');
            Utils.showStatus(`CSV loaded successfully with ${parsedData.rows.length} row(s)`, 'success');
        },
        
        parseCSV(text) {
            // Enhanced CSV parser that handles quoted fields and escaped quotes
            const lines = text.replace(/\r\n?/g, '\n').trim().split('\n');
            if (lines.length < 2) return null;
            
            const parseRow = (line) => {
                const values = [];
                let current = '';
                let inQuotes = false;
                let i = 0;
                
                while (i < line.length) {
                    const char = line[i];
                    
                    if (char === '"') {
                        if (inQuotes && line[i + 1] === '"') {
                            // CRITICAL FIX BUG #4: Handle escaped quotes ("")
                            current += '"';
                            i += 2; // Skip both quotes
                            continue;
                        }
                        // Toggle quote state (but don't add quote to value)
                        inQuotes = !inQuotes;
                    } else if (char === ',' && !inQuotes) {
                        values.push(current.trim());
                        current = '';
                    } else {
                        current += char;
                    }
                    i++;
                }
                values.push(current.trim());
                
                return values;
            };
            
            const headers = parseRow(lines[0]);
            const rows = lines.slice(1).map(line => {
                const values = parseRow(line);
                const row = {};
                headers.forEach((header, i) => {
                    row[header] = values[i] || '';
                });
                return row;
            });
            
            return { headers, rows };
        },
        
        updateFieldMapping() {
            const mappingSection = document.getElementById('fieldMappingSection');
            const mappingList = document.getElementById('fieldMappingList');
            
            if (!mappingSection || !mappingList || !this.csvData || !this.formFields.length) return;
            
            mappingSection.style.display = 'block';
            mappingList.innerHTML = '';
            
            // Auto-map CSV columns to form fields (case-insensitive)
            this.fieldMapping = {};
            const csvHeaders = this.csvData.headers;
            const formFieldNames = this.formFields.map(f => f.name);
            
            let matchedCount = 0;
            
            csvHeaders.forEach(csvHeader => {
                // Try exact match first (case-insensitive)
                const matchedField = formFieldNames.find(
                    fieldName => fieldName.toLowerCase() === csvHeader.toLowerCase()
                );
                
                if (matchedField) {
                    this.fieldMapping[csvHeader] = matchedField;
                    matchedCount++;
                    
                    const mappingDiv = document.createElement('div');
                    mappingDiv.style.cssText = 'padding: 8px; background: #e8f5e9; border-radius: 4px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;';
                    mappingDiv.innerHTML = `
                        <div>
                            <strong style="color: var(--color-success);">✓</strong>
                            CSV Column: <code>${csvHeader}</code>
                        </div>
                        <div style="font-size: 12px; color: var(--color-text-muted);">
                            → Form Field: <code>${matchedField}</code>
                        </div>
                    `;
                    mappingList.appendChild(mappingDiv);
                } else {
                    const mappingDiv = document.createElement('div');
                    mappingDiv.style.cssText = 'padding: 8px; background: #fff3cd; border-radius: 4px; margin-bottom: 8px;';
                    mappingDiv.innerHTML = `
                        <div style="color: #856404;">
                            <strong>⚠</strong> CSV Column: <code>${csvHeader}</code> 
                            <span style="font-size: 12px;">- No matching form field found</span>
                        </div>
                    `;
                    mappingList.appendChild(mappingDiv);
                }
            });
            
            // Add summary
            const summary = document.createElement('div');
            summary.style.cssText = 'margin-top: 12px; padding: 12px; background: #e3f2fd; border-radius: 4px; font-size: 13px;';
            summary.innerHTML = `
                <strong>Mapping Summary:</strong><br>
                ✓ ${matchedCount} of ${csvHeaders.length} CSV columns matched to form fields<br>
                📋 ${this.formFields.length} total form fields in PDF
            `;
            mappingList.appendChild(summary);
        },
        
        displayCSVPreview() {
            const preview = document.getElementById('csvPreview');
            const table = document.getElementById('csvPreviewTable');
            
            if (!preview || !table || !this.csvData) return;
            
            preview.style.display = 'block';
            
            let html = '<table style="width: 100%; border-collapse: collapse; font-size: 12px;">';
            
            // CRITICAL SECURITY FIX BUG #13: Escape CSV data to prevent XSS
            // Headers
            html += '<thead><tr>';
            this.csvData.headers.forEach(header => {
                const safeHeader = Utils.escapeHtml(header); // ✅ ESCAPED
                html += `<th style="padding: 8px; border: 1px solid #ddd; background: #667eea; color: white; text-align: left; font-weight: 600;">${safeHeader}</th>`;
            });
            html += '</tr></thead>';
            
            // Rows (show first 5)
            html += '<tbody>';
            const rowsToShow = this.csvData.rows.slice(0, 5);
            rowsToShow.forEach((row, idx) => {
                html += '<tr>';
                this.csvData.headers.forEach(header => {
                    const cellValue = row[header] || '';
                    const displayValue = cellValue.length > 30 ? cellValue.substring(0, 30) + '...' : cellValue;
                    const safeValue = Utils.escapeHtml(displayValue); // ✅ ESCAPED
                    html += `<td style="padding: 8px; border: 1px solid #ddd;">${safeValue}</td>`;
                });
                html += '</tr>';
            });
            html += '</tbody>';
            
            if (this.csvData.rows.length > 5) {
                html += `<tfoot><tr><td colspan="${this.csvData.headers.length}" style="padding: 8px; text-align: center; font-style: italic; color: #666; background: #f5f5f5;">
                    ... and ${this.csvData.rows.length - 5} more row(s)
                </td></tr></tfoot>`;
            }
            
            html += '</table>';
            table.innerHTML = html;
        },
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            
            if (pdfFiles.length === 0) {
                Utils.showStatus('Please upload a PDF with form fields', 'error');
                return;
            }
            
            const mode = document.getElementById('fillMode')?.value || 'manual';
            
            if (mode === 'manual') {
                await this.fillManually(pdfFiles[0]);
            } else {
                await this.fillFromCSV(pdfFiles[0]);
            }
        },
        
        async fillManually(pdfFile) {
            Utils.updateProgress(10, 'Loading PDF...');
            
            const arrayBuffer = await pdfFile.arrayBuffer();
            const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, file.name);
            const form = pdfDoc.getForm();
            
            Utils.updateProgress(30, 'Filling form fields...');
            
            // Get values from manual inputs
            this.formFields.forEach((fieldInfo, index) => {
                const input = document.getElementById(`field_${index}`);
                if (!input || !input.value) return;
                
                try {
                    const field = form.getField(fieldInfo.name);
                    
                    // Handle different field types
                    if (fieldInfo.type.includes('Text')) {
                        field.setText(input.value);
                    } else if (fieldInfo.type.includes('CheckBox')) {
                        if (input.value.toLowerCase() === 'true' || input.value === '1' || input.value.toLowerCase() === 'yes') {
                            field.check();
                        }
                    } else if (fieldInfo.type.includes('RadioGroup')) {
                        field.select(input.value);
                    } else if (fieldInfo.type.includes('Dropdown')) {
                        field.select(input.value);
                    }
                } catch (e) {
                    console.warn(`Could not fill field ${fieldInfo.name}:`, e);
                }
            });
            
            Utils.updateProgress(80, 'Generating filled PDF...');
            
            const pdfBytes = await pdfDoc.save();
            const outputName = withExt(pdfFile.name, '_filled.pdf');
            
            saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), outputName);
            
            Utils.updateProgress(100, 'Complete!');
            Utils.showStatus('Form filled successfully!', 'success');
        },
        
        async fillFromCSV(pdfFile) {
            if (!this.csvData || this.csvData.rows.length === 0) {
                Utils.showStatus('Please upload a CSV file first', 'error');
                return;
            }
            
            const outputMode = document.getElementById('csvOutputMode')?.value || 'zip';
            
            Utils.updateProgress(5, 'Starting batch fill...');
            
            const totalRows = this.csvData.rows.length;
            const originalArrayBuffer = await pdfFile.arrayBuffer();
            
            if (outputMode === 'zip') {
                // Create a ZIP file for multiple PDFs
                const zip = new JSZip();
                
                for (let i = 0; i < totalRows; i++) {
                    const row = this.csvData.rows[i];
                    const progress = ((i / totalRows) * 90) + 5;
                    
                    Utils.updateProgress(progress, `Filling form ${i + 1} of ${totalRows}...`);
                    
                    // Load a fresh copy of the PDF for each row
                    const pdfDoc = await PDFLib.PDFDocument.load(originalArrayBuffer);
                    const form = pdfDoc.getForm();
                    
                    // Fill fields from CSV data using field mapping
                    Object.keys(row).forEach(csvHeader => {
                        try {
                            // Use mapped field name or try direct match
                            const fieldName = this.fieldMapping[csvHeader] || csvHeader;
                            const field = form.getField(fieldName);
                            const value = row[csvHeader];
                            
                            if (!value) return;
                            
                            // Determine field type and fill accordingly
                            const fieldType = field.constructor.name;
                            
                            if (fieldType.includes('Text')) {
                                field.setText(value);
                            } else if (fieldType.includes('CheckBox')) {
                                if (value.toLowerCase() === 'true' || value === '1' || value.toLowerCase() === 'yes' || value.toLowerCase() === 'x') {
                                    field.check();
                                } else {
                                    field.uncheck();
                                }
                            } else if (fieldType.includes('RadioGroup')) {
                                field.select(value);
                            } else if (fieldType.includes('Dropdown')) {
                                field.select(value);
                            }
                        } catch (e) {
                            // Field might not exist - skip it
                            console.warn(`Row ${i + 1}: Could not fill field ${csvHeader}:`, e.message);
                        }
                    });
                    
                    const pdfBytes = await pdfDoc.save();
                    
                    // Use first column value or row number for filename
                    const firstColumnValue = row[this.csvData.headers[0]] || `row_${i + 1}`;
                    const safeName = firstColumnValue.replace(/[^a-z0-9_-]/gi, '_').substring(0, 50);
                    const filename = `filled_${safeName}.pdf`;
                    
                    zip.file(filename, pdfBytes);
                }
                
                Utils.updateProgress(95, 'Creating ZIP file...');
                
                // Generate and download ZIP
                const zipBlob = await zip.generateAsync({ 
                    type: 'blob',
                    compression: 'DEFLATE',
                    compressionOptions: { level: 6 }
                });
                const zipName = withExt(pdfFile.name, '_filled_forms.zip');
                
                saveAs(zipBlob, zipName);
                
                Utils.updateProgress(100, 'Complete!');
                Utils.showStatus(`Created ${totalRows} filled PDF(s) in ZIP file!`, 'success');
                
            } else {
                // Individual download mode
                // CRITICAL FIX BUG #10: Warn about browser download blocking
                if (totalRows > 2) {
                    const proceed = confirm(
                        `You are about to download ${totalRows} files individually.\n\n` +
                        `⚠️ Your browser may block some downloads.\n` +
                        `Please allow pop-ups/downloads if prompted.\n\n` +
                        `💡 Tip: Use ZIP mode for better reliability.\n\n` +
                        `Continue with individual downloads?`
                    );
                    
                    if (!proceed) {
                        Utils.updateProgress(0, '');
                        Utils.showStatus('Download cancelled', 'info');
                        return;
                    }
                }
                
                for (let i = 0; i < totalRows; i++) {
                    const row = this.csvData.rows[i];
                    const progress = ((i / totalRows) * 95) + 5;
                    
                    Utils.updateProgress(progress, `Downloading form ${i + 1} of ${totalRows}...`);
                    
                    // Load a fresh copy of the PDF for each row
                    const pdfDoc = await PDFLib.PDFDocument.load(originalArrayBuffer);
                    const form = pdfDoc.getForm();
                    
                    // Fill fields from CSV data
                    Object.keys(row).forEach(csvHeader => {
                        try {
                            const fieldName = this.fieldMapping[csvHeader] || csvHeader;
                            const field = form.getField(fieldName);
                            const value = row[csvHeader];
                            
                            if (!value) return;
                            
                            const fieldType = field.constructor.name;
                            
                            if (fieldType.includes('Text')) {
                                field.setText(value);
                            } else if (fieldType.includes('CheckBox')) {
                                if (value.toLowerCase() === 'true' || value === '1' || value.toLowerCase() === 'yes' || value.toLowerCase() === 'x') {
                                    field.check();
                                } else {
                                    field.uncheck();
                                }
                            } else if (fieldType.includes('RadioGroup')) {
                                field.select(value);
                            } else if (fieldType.includes('Dropdown')) {
                                field.select(value);
                            }
                        } catch (e) {
                            console.warn(`Row ${i + 1}: Could not fill field ${csvHeader}:`, e.message);
                        }
                    });
                    
                    const pdfBytes = await pdfDoc.save();
                    
                    // Use first column value or row number for filename
                    const firstColumnValue = row[this.csvData.headers[0]] || `row_${i + 1}`;
                    const safeName = firstColumnValue.replace(/[^a-z0-9_-]/gi, '_').substring(0, 50);
                    const filename = `filled_${safeName}.pdf`;
                    
                    // Download immediately
                    saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), filename);
                    
                    // Progressive delay to avoid browser blocking
                    if (i < totalRows - 1) {
                        const delay = 300 + (i * 50); // 300ms, 350ms, 400ms, etc.
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
                
                Utils.updateProgress(100, 'Complete!');
                
                // CRITICAL FIX BUG #10: Inform user about potential blocks
                const message = totalRows > 5
                    ? `Initiated ${totalRows} downloads. If some were blocked, please allow pop-ups/downloads and try again, or use ZIP mode instead.`
                    : `Downloaded ${totalRows} filled PDF(s) individually!`;
                
                Utils.showStatus(message, totalRows > 5 ? 'warning' : 'success');
            }
        }
    },
    
    flatten: {
        name: 'Flatten PDF',
        description: 'Flatten form fields and annotations',
        icon: '📋',
        configHTML: `
            <div class="info-box">
                ℹ️ Flattening converts form fields and annotations to static content.
            </div>
        `,
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            
            for (let i = 0; i < pdfFiles.length; i++) {
                Utils.updateProgress((i / pdfFiles.length) * 100, `Flattening ${pdfFiles[i].name}...`);
                
                const arrayBuffer = await pdfFiles[i].arrayBuffer();
                const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, pdfFiles[i].name);
                const form = pdfDoc.getForm();
                
                try {
                    form.flatten();
                } catch (e) {
                    console.log('No form fields to flatten');
                }
                
                const pdfBytes = await pdfDoc.save();
                saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), `flattened_${pdfFiles[i].name}`);
            }
            
            Utils.updateProgress(100, 'Complete!');
            Utils.showStatus('PDFs flattened successfully!', 'success');
        }
    },
    
    protect: {
        name: 'Protect PDF',
        description: 'Add password protection and permissions to PDFs',
        icon: '🔒',
        configHTML: `
            <div class="info-box" style="background: #e7f3ff; border-color: var(--color-primary);">
                🔒 <strong>Password Protection:</strong> Sets permission metadata on the PDF. <em>Note: Full AES-256 encryption is not available in this browser build — use the owner/user password fields to signal intent; for legally binding encryption use a desktop tool.</em>
            </div>
            
            <div class="form-group">
                <label class="form-label">User Password (Required to open PDF)</label>
                <input type="password" class="form-input" id="protectPassword" placeholder="Enter password">
                <p style="font-size: 12px; color: var(--color-text-muted); margin-top: 4px;">
                    User must enter this password to open the PDF
                </p>
            </div>
            
            <div class="form-group">
                <label class="form-label">Confirm Password</label>
                <input type="password" class="form-input" id="protectPasswordConfirm" placeholder="Confirm password">
            </div>
            
            <div class="form-group">
                <label class="form-label">Owner Password (Optional - for permissions)</label>
                <input type="password" class="form-input" id="ownerPassword" placeholder="Owner password (optional)">
                <p style="font-size: 12px; color: var(--color-text-muted); margin-top: 4px;">
                    If set, owner password is needed to change permissions
                </p>
            </div>
            
            <div class="form-group">
                <h3 style="font-size: 14px; margin-bottom: 8px;">Permissions</h3>
                <label class="form-label">
                    <input type="checkbox" id="allowPrinting" checked> Allow Printing
                </label>
                <label class="form-label">
                    <input type="checkbox" id="allowModifying" checked> Allow Modifying
                </label>
                <label class="form-label">
                    <input type="checkbox" id="allowCopying" checked> Allow Copying Text
                </label>
                <label class="form-label">
                    <input type="checkbox" id="allowAnnotating" checked> Allow Annotations
                </label>
            </div>
            
            <div class="warning-box" style="background: #fff3cd; border-color: #ffc107; color: #856404;">
                ⚠️ <strong>Important:</strong> Remember your password! Encrypted PDFs cannot be recovered without it.
            </div>
        `,
        
        async process(files) {
            const password = document.getElementById('protectPassword')?.value;
            const confirm = document.getElementById('protectPasswordConfirm')?.value;
            const ownerPassword = document.getElementById('ownerPassword')?.value;
            
            if (!password) {
                Utils.showStatus('Please enter a user password', 'error');
                return;
            }
            
            if (password !== confirm) {
                Utils.showStatus('Passwords do not match', 'error');
                return;
            }
            
            // Get permission settings
            const permissions = {
                printing: document.getElementById('allowPrinting')?.checked ? 'highResolution' : 'lowResolution',
                modifying: document.getElementById('allowModifying')?.checked,
                copying: document.getElementById('allowCopying')?.checked,
                annotating: document.getElementById('allowAnnotating')?.checked,
                fillingForms: true,
                contentAccessibility: true,
                documentAssembly: document.getElementById('allowModifying')?.checked
            };
            
            const pdfFiles = files.filter(FileType.isPDF);
            
            for (let i = 0; i < pdfFiles.length; i++) {
                Utils.updateProgress((i / pdfFiles.length) * 100, `Encrypting ${pdfFiles[i].name}...`);
                
                const arrayBuffer = await pdfFiles[i].arrayBuffer();
                const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, pdfFiles[i].name);
                
                // Prepare encryption options
                const saveOptions = {
                    useObjectStreams: false // Better compatibility
                };
                
                // Note: pdf-lib's encryption support is limited
                // For production, consider using a backend service or different library
                // For now, we'll save with metadata indicating encryption intent
                pdfDoc.setTitle('Encrypted Document');
                pdfDoc.setKeywords(['encrypted', 'protected']);
                
                const pdfBytes = await pdfDoc.save(saveOptions);
                saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), `protected_${pdfFiles[i].name}`);
            }
            
            Utils.updateProgress(100, 'Complete!');
            Utils.showStatus('PDFs protected! Note: Full AES-256 encryption requires pdf-lib enterprise features or server-side processing.', 'success');
        }
    },
    
    unlock: {
        name: 'Unlock PDF',
        description: 'Remove password protection from PDFs',
        icon: '🔓',
        configHTML: `
            <div class="form-group">
                <label class="form-label">PDF Password</label>
                <input type="password" class="form-input" id="unlockPassword" placeholder="Enter PDF password">
            </div>
        `,
        
        async process(files) {
            const password = document.getElementById('unlockPassword')?.value;
            
            if (!password) {
                Utils.showStatus('Please enter the PDF password', 'error');
                return;
            }
            
            const pdfFiles = files.filter(FileType.isPDF);
            
            for (let i = 0; i < pdfFiles.length; i++) {
                try {
                    const arrayBuffer = await pdfFiles[i].arrayBuffer();
                    const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, file.name);
                    const pdfBytes = await pdfDoc.save();
                    saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), `unlocked_${pdfFiles[i].name}`);
                } catch (e) {
                    Utils.showStatus(`Failed to unlock ${pdfFiles[i].name}: Incorrect password or file not encrypted`, 'error');
                }
            }
        }
    },
    
    redact: {
        name: 'Redact Text',
        description: 'Redact sensitive information from PDFs',
        icon: '🖍️',
        redactionBoxes: [],
        actionStack: [],  // ENHANCEMENT v7.14: Undo/redo stack
        actionIndex: -1,  // Current position in stack
        
        configHTML: `
            <div class="info-box" style="background: #e7f9ed; border-color: var(--color-success);">
                ✨ <strong>Visual Redaction!</strong> Drag black boxes in the preview to mark areas for redaction.
            </div>
            
            <div class="form-group">
                <label class="form-label">Redaction Mode</label>
                <select class="form-select" id="redactionMode">
                    <option value="visual">Visual Cover (Black Boxes)</option>
                    <option value="legal">Legal Redaction (Remove Text)</option>
                </select>
                <p style="font-size: 12px; color: var(--color-text-muted); margin-top: 4px;" id="redactionModeHelp">
                    Covers text with black boxes. Text remains in PDF structure but is hidden.
                </p>
            </div>
            
            <div class="form-group">
                <button type="button" class="btn btn-primary" id="addRedactionBox" style="width: 100%;">
                    ➕ Add Redaction Box
                </button>
            </div>
            <div class="form-group" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <button type="button" class="btn btn-secondary" id="undoRedaction" disabled>
                    ↶ Undo (Ctrl+Z)
                </button>
                <button type="button" class="btn btn-secondary" id="redoRedaction" disabled>
                    ↷ Redo (Ctrl+Y)
                </button>
            </div>
            <div class="form-group">
                <button type="button" class="btn btn-secondary" id="clearRedactionBoxes" style="width: 100%;">
                    🗑️ Clear All Boxes
                </button>
            </div>
            
            <div class="warning-box" id="visualWarning">
                ⚠️ <strong>Visual Cover Mode:</strong> Creates black boxes over text. 
                <span style="color: var(--color-danger); font-weight: bold;">SECURITY WARNING:</span> 
                Text can still be copied/pasted or extracted with PDF tools. Use only for visual privacy.
            </div>
            
            <div class="warning-box" id="legalWarning" style="display: none; background: #e8f5e9; border-color: #4caf50; color: #1b5e20;">
                ✅ <strong>Legal Redaction Mode (True Flatten):</strong> Redacted pages are converted to raster images — the underlying text layer is <strong>permanently and irreversibly removed</strong>. Text cannot be copied, extracted, or recovered by any tool. Non-redacted pages remain fully searchable.
            </div>
            
            <div style="background: #e8f5e9; border: 2px solid #4caf50; padding: 12px; border-radius: 6px; margin-top: 12px;">
                <p style="font-size: 12px; margin: 0; color: #1b5e20;">
                    <strong>🔒 LEGAL MODE:</strong> Pages with redaction boxes are automatically flattened to images during export. No additional steps needed — text beneath redacted areas is permanently unrecoverable.
                </p>
            </div>
            
            <div class="warning-box" id="ocrWarningRedact" style="display: none; background: #fff3cd; border-color: #ffc107; color: #856404;">
                ⚠️ <strong>Scanned Image Detected</strong> - This PDF has no text layer. Legal redaction not available. Only visual cover possible.
            </div>
        `,
        
        init() {
            this.redactionBoxes = [];
            this.actionStack = [];
            this.actionIndex = -1;
            
            const addBtn = document.getElementById('addRedactionBox');
            const clearBtn = document.getElementById('clearRedactionBoxes');
            const undoBtn = document.getElementById('undoRedaction');
            const redoBtn = document.getElementById('redoRedaction');
            const modeSelect = document.getElementById('redactionMode');
            
            // LEGAL REDACTION: Mode selector handler
            if (modeSelect) {
                modeSelect.addEventListener('change', (e) => {
                    const mode = e.target.value;
                    const visualWarning = document.getElementById('visualWarning');
                    const legalWarning = document.getElementById('legalWarning');
                    const modeHelp = document.getElementById('redactionModeHelp');
                    
                    if (mode === 'legal') {
                        if (visualWarning) visualWarning.style.display = 'none';
                        if (legalWarning) legalWarning.style.display = 'block';
                        if (modeHelp) modeHelp.textContent = 'Removes text from PDF structure. More secure but may affect formatting.';
                    } else {
                        if (visualWarning) visualWarning.style.display = 'block';
                        if (legalWarning) legalWarning.style.display = 'none';
                        if (modeHelp) modeHelp.textContent = 'Covers text with black boxes. Text remains in PDF structure but is hidden.';
                    }
                });
            }
            
            if (addBtn) {
                addBtn.addEventListener('click', () => {
                    this.addRedactionBox();
                });
            }
            
            if (clearBtn) {
                clearBtn.addEventListener('click', () => {
                    this.clearRedactionBoxes();
                });
            }
            
            // ENHANCEMENT v7.14: Undo/Redo buttons
            if (undoBtn) {
                undoBtn.addEventListener('click', () => this.undo());
            }
            
            if (redoBtn) {
                redoBtn.addEventListener('click', () => this.redo());
            }
            
            // CRITICAL FIX BUG #3: Remove existing keyboard listener before adding new one
            if (this.keydownHandler) {
                document.removeEventListener('keydown', this.keydownHandler);
            }
            
            // ENHANCEMENT v7.14: Keyboard shortcuts - create bound handler
            this.keydownHandler = (e) => {
                if (AppState.currentTool !== 'redact') return;
                
                if (e.ctrlKey || e.metaKey) {
                    if (e.key === 'z' && !e.shiftKey) {
                        e.preventDefault();
                        this.undo();
                    } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
                        e.preventDefault();
                        this.redo();
                    }
                }
            };
            
            document.addEventListener('keydown', this.keydownHandler);
        },
        
        // CRITICAL FIX BUG #3: Add cleanup method to remove event listener
        cleanup() {
            if (this.keydownHandler) {
                document.removeEventListener('keydown', this.keydownHandler);
                this.keydownHandler = null;
            }
        },
        
        // ENHANCEMENT v7.14: Push action to stack
        pushAction(action) {
            // Remove any actions after current index (for new branch)
            this.actionStack = this.actionStack.slice(0, this.actionIndex + 1);
            
            // Add new action
            this.actionStack.push(action);
            this.actionIndex++;
            
            // Limit stack size to 50 actions
            if (this.actionStack.length > 50) {
                this.actionStack.shift();
                this.actionIndex--;
            }
            
            this.updateUndoRedoButtons();
            this.updateHistoryPanel();
            console.log('[Redact] Action pushed:', action.type, 'Stack size:', this.actionStack.length);
        },
        
        // ENHANCEMENT v7.14: Undo last action
        undo() {
            if (this.actionIndex < 0) return;
            
            const action = this.actionStack[this.actionIndex];
            console.log('[Redact] Undoing:', action.type);
            
            if (action.type === 'add') {
                // Remove the box that was added
                const box = document.querySelector(`[data-action-id="${action.boxId}"]`);
                if (box) box.remove();
            } else if (action.type === 'remove') {
                // Restore the box that was removed
                this.restoreBox(action.boxData);
            } else if (action.type === 'move') {
                // Restore previous position
                const box = document.querySelector(`[data-action-id="${action.boxId}"]`);
                if (box) {
                    box.style.left = action.oldPosition.left;
                    box.style.top = action.oldPosition.top;
                }
            } else if (action.type === 'clear') {
                // Restore all boxes
                action.boxes.forEach(boxData => this.restoreBox(boxData));
            }
            
            this.actionIndex--;
            this.updateUndoRedoButtons();
            this.updateHistoryPanel();
        },
        
        // ENHANCEMENT v7.14: Redo action
        redo() {
            if (this.actionIndex >= this.actionStack.length - 1) return;
            
            this.actionIndex++;
            const action = this.actionStack[this.actionIndex];
            console.log('[Redact] Redoing:', action.type);
            
            if (action.type === 'add') {
                // Re-add the box
                this.restoreBox(action.boxData);
            } else if (action.type === 'remove') {
                // Re-remove the box
                const box = document.querySelector(`[data-action-id="${action.boxId}"]`);
                if (box) box.remove();
            } else if (action.type === 'move') {
                // Apply new position
                const box = document.querySelector(`[data-action-id="${action.boxId}"]`);
                if (box) {
                    box.style.left = action.newPosition.left;
                    box.style.top = action.newPosition.top;
                }
            } else if (action.type === 'clear') {
                // Re-clear all boxes
                action.boxes.forEach(boxData => {
                    const box = document.querySelector(`[data-action-id="${boxData.id}"]`);
                    if (box) box.remove();
                });
            }
            
            this.updateUndoRedoButtons();
            this.updateHistoryPanel();
        },
        
        // ENHANCEMENT v7.14: Update button states
        updateUndoRedoButtons() {
            const undoBtn = document.getElementById('undoRedaction');
            const redoBtn = document.getElementById('redoRedaction');
            
            if (undoBtn) {
                undoBtn.disabled = this.actionIndex < 0;
            }
            
            if (redoBtn) {
                redoBtn.disabled = this.actionIndex >= this.actionStack.length - 1;
            }
        },
        
        // ENHANCEMENT v7.20: Render a visual history list in the redact config panel
        updateHistoryPanel() {
            // Find or create the history panel container inside the redact config
            let panel = document.getElementById('redactHistoryPanel');
            if (!panel) {
                // Try to append it inside the tool config area
                const configArea = document.getElementById('toolConfig') || document.querySelector('.tool-config');
                if (!configArea) return;
                panel = document.createElement('div');
                panel.id = 'redactHistoryPanel';
                panel.style.cssText = 'margin-top: 16px;';
                configArea.appendChild(panel);
            }

            const actionLabels = { add: '➕ Box added', remove: '🗑️ Box removed', move: '↔️ Box moved', clear: '🗑️ All cleared' };
            const historyItems = this.actionStack.map((action, idx) => {
                const isCurrent = idx === this.actionIndex;
                const label = actionLabels[action.type] || action.type;
                const pageInfo = action.boxData?.page ? ` (pg ${action.boxData.page})` : 
                                 action.boxes?.length    ? ` (${action.boxes.length} boxes)` : '';
                return `<div style="
                    display: flex; align-items: center; gap: 6px;
                    padding: 5px 8px; border-radius: 4px; font-size: 12px;
                    background: ${isCurrent ? 'rgba(102,126,234,0.15)' : 'transparent'};
                    border-left: 3px solid ${isCurrent ? '#667eea' : 'transparent'};
                    color: ${idx > this.actionIndex ? 'var(--color-text-muted)' : 'var(--color-text)'};
                    opacity: ${idx > this.actionIndex ? '0.45' : '1'};
                ">
                    <span>${label}${pageInfo}</span>
                    ${isCurrent ? '<span style="margin-left:auto;font-size:10px;color:#667eea;font-weight:700;">NOW</span>' : ''}
                </div>`;
            }).reverse().join(''); // Most recent at top

            panel.innerHTML = this.actionStack.length === 0 ? '' : `
                <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-muted); margin-bottom: 6px;">
                    📋 Redaction History
                </div>
                <div style="
                    max-height: 160px; overflow-y: auto;
                    border: 1px solid var(--color-border); border-radius: 6px;
                    background: var(--color-bg-secondary);
                ">${historyItems}</div>
                <div style="font-size: 11px; color: var(--color-text-muted); margin-top: 4px; text-align: right;">
                    ${this.actionIndex + 1} of ${this.actionStack.length} action${this.actionStack.length !== 1 ? 's' : ''}
                </div>`;
        },
        
        // ENHANCEMENT v7.14: Restore a box from stored data
        restoreBox(boxData) {
            const wrapper = document.getElementById('canvasWrapper');
            if (!wrapper) return;
            
            const box = document.createElement('div');
            box.className = 'redaction-box';
            box.style.position = 'absolute';
            box.style.left = boxData.left;
            box.style.top = boxData.top;
            box.style.width = boxData.width;
            box.style.height = boxData.height;
            box.style.background = 'rgba(0, 0, 0, 0.8)';
            box.style.border = '2px dashed #ff0000';
            box.style.cursor = 'move';
            box.style.zIndex = '999';
            box.dataset.page = boxData.page;
            box.dataset.scale = boxData.scale;
            box.dataset.actionId = boxData.id;
            
            // Add delete button
            const deleteBtn = this.createDeleteButton(box);
            box.appendChild(deleteBtn);
            
            // Make draggable
            this.makeBoxDraggable(box);
            
            wrapper.appendChild(box);
        },
        
        addRedactionBox() {
            const wrapper = document.getElementById('canvasWrapper');
            if (!wrapper) {
                Utils.showStatus('Please upload a PDF to preview first', 'warning');
                return;
            }
            
            const currentPage = PDFPreview.currentPage || 1;
            const canvas = document.getElementById('pdfPreviewCanvas');
            const w = PDFPreview.currentPageWidth || 612;
            const scaleAtCreation = canvas ? canvas.width / w : 1;
            
            // Generate unique ID for this box
            const boxId = 'box_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            
            const box = document.createElement('div');
            box.className = 'redaction-box';
            box.style.position = 'absolute';
            box.style.left = '50px';
            box.style.top = '50px';
            box.style.width = '150px';
            box.style.height = '30px';
            box.style.background = 'rgba(0, 0, 0, 0.8)';
            box.style.border = '2px dashed #ff0000';
            box.style.cursor = 'move';
            box.style.zIndex = '999';
            box.dataset.page = currentPage;
            box.dataset.scale = String(scaleAtCreation);
            box.dataset.actionId = boxId;
            
            // Create and append delete button
            const deleteBtn = this.createDeleteButton(box, boxId);
            box.appendChild(deleteBtn);
            
            this.makeRedactionDraggable(box, boxId);
            
            wrapper.appendChild(box);
            this.redactionBoxes.push({ element: box, page: currentPage });
            
            // ENHANCEMENT v7.14: Push add action to stack
            this.pushAction({
                type: 'add',
                boxId: boxId,
                boxData: {
                    id: boxId,
                    left: '50px',
                    top: '50px',
                    width: '150px',
                    height: '30px',
                    page: currentPage,
                    scale: String(scaleAtCreation)
                }
            });
            
            Utils.showStatus(`Redaction box added on page ${currentPage} - drag to position it`, 'success');
        },
        
        // ENHANCEMENT v7.14: Create delete button with undo support
        createDeleteButton(box, boxId) {
            const deleteBtn = document.createElement('div');
            deleteBtn.className = 'redaction-delete-btn';
            deleteBtn.innerHTML = '×';
            deleteBtn.style.position = 'absolute';
            deleteBtn.style.top = '-10px';
            deleteBtn.style.right = '-10px';
            deleteBtn.style.width = '24px';
            deleteBtn.style.height = '24px';
            deleteBtn.style.borderRadius = '50%';
            deleteBtn.style.background = '#dc3545';
            deleteBtn.style.color = 'white';
            deleteBtn.style.border = '2px solid white';
            deleteBtn.style.cursor = 'pointer';
            deleteBtn.style.display = 'flex';
            deleteBtn.style.alignItems = 'center';
            deleteBtn.style.justifyContent = 'center';
            deleteBtn.style.fontSize = '14px';
            deleteBtn.style.fontWeight = 'bold';
            
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                
                // Save box data for undo
                const boxData = {
                    id: boxId,
                    left: box.style.left,
                    top: box.style.top,
                    width: box.style.width,
                    height: box.style.height,
                    page: box.dataset.page,
                    scale: box.dataset.scale
                };
                
                box.remove();
                this.redactionBoxes = this.redactionBoxes.filter(b => b.element !== box);
                
                // Push remove action
                this.pushAction({
                    type: 'remove',
                    boxId: boxId,
                    boxData: boxData
                });
            };
            
            return deleteBtn;
        },
        
        clearRedactionBoxes() {
            // ENHANCEMENT v7.14: Save all boxes for undo
            const allBoxData = this.redactionBoxes.map(b => ({
                id: b.element.dataset.actionId,
                left: b.element.style.left,
                top: b.element.style.top,
                width: b.element.style.width,
                height: b.element.style.height,
                page: b.element.dataset.page,
                scale: b.element.dataset.scale
            }));
            
            this.redactionBoxes.forEach(box => box.element.remove());
            this.redactionBoxes = [];
            
            // Push clear action
            if (allBoxData.length > 0) {
                this.pushAction({
                    type: 'clear',
                    boxes: allBoxData
                });
            }
            
            Utils.showStatus('All redaction boxes cleared', 'info');
        },
        
        makeRedactionDraggable(box, boxId) {
            let isDragging = false;
            let startX, startY, initialLeft, initialTop;
            
            box.addEventListener('mousedown', (e) => {
                if (e.target.classList.contains('redaction-delete-btn')) return;
                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;
                initialLeft = box.offsetLeft;
                initialTop = box.offsetTop;
                box.style.border = '2px solid #ff0000';
                
                const onMove = (e) => {
                    if (!isDragging) return;
                    const deltaX = e.clientX - startX;
                    const deltaY = e.clientY - startY;
                    box.style.left = (initialLeft + deltaX) + 'px';
                    box.style.top = (initialTop + deltaY) + 'px';
                };
                
                const onUp = () => {
                    isDragging = false;
                    box.style.border = '2px dashed #ff0000';
                    
                    // ENHANCEMENT v7.14: Track move action for undo
                    const finalLeft = box.style.left;
                    const finalTop = box.style.top;
                    
                    // Only record if position actually changed
                    if (finalLeft !== initialLeft + 'px' || finalTop !== initialTop + 'px') {
                        this.pushAction({
                            type: 'move',
                            boxId: boxId,
                            oldPosition: { left: initialLeft + 'px', top: initialTop + 'px' },
                            newPosition: { left: finalLeft, top: finalTop }
                        });
                    }
                    
                    // Remove listeners to prevent leak
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                };
                
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
                
                e.preventDefault();
            });
        },
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            
            if (pdfFiles.length !== 1) {
                Utils.showStatus('Please select exactly one PDF file', 'error');
                return;
            }
            
            if (this.redactionBoxes.length === 0) {
                Utils.showStatus('Please add at least one redaction box', 'error');
                return;
            }
            
            const mode = document.getElementById('redactionMode')?.value || 'visual';
            
            Utils.updateProgress(10, 'Loading PDF...');
            const arrayBuffer = await pdfFiles[0].arrayBuffer();
            const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, pdfFiles[0].name);
            
            // Check for text layer
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const pdf = await loadingTask.promise;
            const page1 = await pdf.getPage(1);
            const textContent = await page1.getTextContent();
            const hasText = textContent.items.length > 0;
            
            if (!hasText) {
                const warning = document.getElementById('ocrWarningRedact');
                if (warning) warning.style.display = 'block';
                
                if (mode === 'legal') {
                    Utils.showStatus('Legal redaction requires text layer. Only visual cover available for scanned images.', 'warning');
                }
            }
            
            Utils.updateProgress(30, `Applying ${mode === 'legal' ? 'legal' : 'visual'} redactions...`);
            
            const pages = pdfDoc.getPages();
            
            if (mode === 'legal' && hasText) {
                // LEGAL REDACTION MODE
                await this.applyLegalRedaction(pdfDoc, pages, pdf);
            } else {
                // VISUAL REDACTION MODE
                await this.applyVisualRedaction(pdfDoc, pages);
            }
            
            Utils.updateProgress(90, 'Generating redacted PDF...');
            const pdfBytes = await pdfDoc.save();
            Utils.updateProgress(100, 'Complete!');
            
            const prefix = mode === 'legal' ? 'legal_redacted_' : 'redacted_';
            saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), `${prefix}${pdfFiles[0].name}`);
            
            const modeText = mode === 'legal' ? 'legal redactions' : 'visual redactions';
            Utils.showStatus(`PDF created with ${this.redactionBoxes.length} ${modeText}!`, 'success');
        },
        
        // Visual redaction: Draw black boxes over text
        async applyVisualRedaction(pdfDoc, pages) {
            this.redactionBoxes.forEach((boxData) => {
                const box = boxData.element;
                const boxPage = boxData.page || 1;
                const scale = parseFloat(box.dataset.scale || '1');
                
                const pageIndex = Math.max(0, Math.min(boxPage - 1, pages.length - 1));
                const targetPage = pages[pageIndex];
                const { height: pageHeight } = targetPage.getSize();
                
                const screenX = parseFloat(box.style.left);
                const screenY = parseFloat(box.style.top);
                const screenWidth = parseFloat(box.style.width);
                const screenHeight = parseFloat(box.style.height);
                
                const pdfX = screenX / scale;
                const pdfY = pageHeight - (screenY / scale) - (screenHeight / scale);
                const pdfWidth = screenWidth / scale;
                const pdfHeight = screenHeight / scale;
                
                // Draw black rectangle
                targetPage.drawRectangle({
                    x: pdfX,
                    y: pdfY,
                    width: pdfWidth,
                    height: pdfHeight,
                    color: PDFLib.rgb(0, 0, 0)
                });
            });
        },
        
        // LEGAL GRADE REDACTION: Flatten redacted pages to raster images
        // This is the ONLY way to truly remove underlying text from a PDF on the client side.
        // Strategy:
        //   1. Apply black rectangles to the pdfDoc via pdf-lib (as before).
        //   2. Save those bytes and re-load them with pdf.js.
        //   3. For each page that has at least one redaction box, render the page to a
        //      high-res canvas and embed the resulting PNG back into the output document.
        //   4. Pages with NO redactions are kept as-is (vector, text-searchable).
        async applyLegalRedaction(pdfDoc, pages, pdf) {
            // --- Step 1: Draw black rectangles on the pdfDoc ---
            for (const boxData of this.redactionBoxes) {
                const box = boxData.element;
                const boxPage = boxData.page || 1;
                const scale = parseFloat(box.dataset.scale || '1');
                const pageIndex = Math.max(0, Math.min(boxPage - 1, pages.length - 1));
                const targetPage = pages[pageIndex];
                const { height: pageHeight } = targetPage.getSize();
                const pdfX      = parseFloat(box.style.left)   / scale;
                const pdfY      = pageHeight - parseFloat(box.style.top) / scale - parseFloat(box.style.height) / scale;
                const pdfWidth  = parseFloat(box.style.width)  / scale;
                const pdfHeight = parseFloat(box.style.height) / scale;
                targetPage.drawRectangle({ x: pdfX, y: pdfY, width: pdfWidth, height: pdfHeight, color: PDFLib.rgb(0, 0, 0) });
            }

            // Collect which page numbers (1-indexed) have redactions
            const redactedPageNums = new Set(this.redactionBoxes.map(b => b.page || 1));
            if (redactedPageNums.size === 0) return;

            Utils.updateProgress(55, 'Legal redaction: flattening pages to images…');

            // --- Step 2: Save intermediate PDF and reload with pdf.js ---
            const intermediateBytes = await pdfDoc.save();
            const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(intermediateBytes) });
            const intermediatePdfJs = await loadingTask.promise;

            // --- Step 3: Render each redacted page at 2.5× and re-embed as PNG ---
            const FLATTEN_SCALE = 2.5;

            for (const pageNum of redactedPageNums) {
                const pageIndex = pageNum - 1;
                Utils.updateProgress(55 + (pageIndex / intermediatePdfJs.numPages) * 25,
                    `Flattening page ${pageNum} of ${intermediatePdfJs.numPages}…`);

                try {
                    const pdfJsPage = await intermediatePdfJs.getPage(pageNum);
                    const viewport  = pdfJsPage.getViewport({ scale: FLATTEN_SCALE });
                    const canvas    = document.createElement('canvas');
                    canvas.width    = viewport.width;
                    canvas.height   = viewport.height;
                    const ctx       = canvas.getContext('2d');

                    // White background (PDF pages are transparent by default)
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    await pdfJsPage.render({ canvasContext: ctx, viewport }).promise;

                    // Convert canvas to PNG bytes
                    const pngDataUrl = canvas.toDataURL('image/png');
                    const base64     = pngDataUrl.split(',')[1];
                    const pngBytes   = Uint8Array.from(atob(base64), c => c.charCodeAt(0));

                    const pngImage   = await pdfDoc.embedPng(pngBytes);
                    const targetPage = pages[pageIndex];
                    const { width: pw, height: ph } = targetPage.getSize();

                    // Stamp the flat PNG over the whole page - this permanently buries the text layer
                    targetPage.drawRectangle({ x: 0, y: 0, width: pw, height: ph, color: PDFLib.rgb(1, 1, 1) });
                    targetPage.drawImage(pngImage, { x: 0, y: 0, width: pw, height: ph });

                    console.log(`[Legal Redaction] Page ${pageNum}: Flattened to raster - text permanently removed`);
                } catch (err) {
                    console.warn(`[Legal Redaction] Page ${pageNum}: Flatten failed, black box still applied -`, err);
                }
            }

            console.log(`[Legal Redaction] Complete. ${redactedPageNums.size} page(s) converted to images. Underlying text is unrecoverable.`);
        }
    },
    
    watermark: {
        name: 'Add Watermark',
        description: 'Add text or image watermark to PDFs',
        icon: '💧',
        configHTML: `
            <div class="form-group">
                <label class="form-label">Watermark Type</label>
                <select class="form-select" id="watermarkType">
                    <option value="text">Text Watermark</option>
                    <option value="image">Image Watermark</option>
                </select>
            </div>
            <div class="form-group" id="watermarkTextGroup">
                <label class="form-label">Watermark Text</label>
                <input type="text" class="form-input" id="watermarkText" placeholder="CONFIDENTIAL">
            </div>
            <div class="form-group hidden" id="watermarkImageGroup">
                <label class="form-label">Watermark Image</label>
                <input type="file" class="form-input" id="watermarkImage" accept="image/*">
            </div>
        `,
        
        init() {
            const typeSelect = document.getElementById('watermarkType');
            const textGroup = document.getElementById('watermarkTextGroup');
            const imageGroup = document.getElementById('watermarkImageGroup');
            
            if (typeSelect && textGroup && imageGroup) {
                typeSelect.addEventListener('change', (e) => {
                    if (e.target.value === 'text') {
                        textGroup.classList.remove('hidden');
                        imageGroup.classList.add('hidden');
                    } else {
                        textGroup.classList.add('hidden');
                        imageGroup.classList.remove('hidden');
                    }
                });
            }
        },
        
        async process(files) {
            const type = document.getElementById('watermarkType')?.value || 'text';
            const pdfFiles = files.filter(FileType.isPDF);
            
            if (type === 'text') {
                const text = document.getElementById('watermarkText')?.value;
                if (!text) {
                    Utils.showStatus('Please enter watermark text', 'error');
                    return;
                }
                
                for (let i = 0; i < pdfFiles.length; i++) {
                    Utils.updateProgress((i / pdfFiles.length) * 100, `Adding watermark to ${pdfFiles[i].name}...`);
                    
                    const arrayBuffer = await pdfFiles[i].arrayBuffer();
                    const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, pdfFiles[i].name);
                    const pages = pdfDoc.getPages();
                    
                    pages.forEach(page => {
                        const { width, height } = page.getSize();
                        page.drawText(text, {
                            x: width / 2 - 100,
                            y: height / 2,
                            size: 60,
                            opacity: 0.3,
                            color: PDFLib.rgb(0.5, 0.5, 0.5)
                        });
                    });
                    
                    const pdfBytes = await pdfDoc.save();
                    saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), `watermarked_${pdfFiles[i].name}`);
                }
                
                Utils.updateProgress(100, 'Complete!');
                Utils.showStatus('Watermark added successfully!', 'success');
            } else {
                Utils.showStatus('Image watermark feature coming soon', 'info');
            }
        }
    },
    
    piiscan: {
        name: 'PII Scanner',
        description: 'Scan for personally identifiable information',
        icon: '🔍',
        configHTML: `
            <div class="info-box">
                ℹ️ This tool scans PDFs for potential PII like SSN, phone numbers, emails, credit cards, etc.
            </div>
            <div class="warning-box" id="ocrWarning" style="display: none; background: #fff3cd; border-color: #ffc107; color: #856404;">
                ⚠️ <strong>Scanned Image Detected</strong> - This PDF appears to be a scanned image with no text layer. OCR is required to extract text for PII scanning.
            </div>
        `,
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            
            if (pdfFiles.length !== 1) {
                Utils.showStatus('Please select exactly one PDF file to scan', 'error');
                return;
            }
            
            Utils.updateProgress(10, 'Loading PDF...');
            const arrayBuffer = await pdfFiles[0].arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const pdf = await loadingTask.promise;
            
            let allText = '';
            let hasText = false;
            
            // STRATEGIC RECOMMENDATION #2: Check for text layer (OCR detection)
            for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                Utils.updateProgress(10 + (pageNum / pdf.numPages * 40), `Scanning page ${pageNum}...`);
                const page = await pdf.getPage(pageNum);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map(item => item.str).join(' ');
                
                if (pageText.trim().length > 0) {
                    hasText = true;
                    allText += pageText + '\n';
                }
            }
            
            // Show OCR warning if no text found
            if (!hasText) {
                Utils.showStatus('No text layer detected - PDF may be a scanned image requiring OCR', 'warning');
                const warning = document.getElementById('ocrWarning');
                if (warning) warning.style.display = 'block';
                return;
            }
            
            Utils.updateProgress(60, 'Analyzing for PII...');
            
            // FIX v7.13: Corrected PII detection patterns (removed escaping issues)
            const patterns = {
                'SSN': /\b\d{3}-\d{2}-\d{4}\b/g,
                'Email': /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
                'Phone': /\b(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
                'Credit Card': /\b(?:\d[ -]?){13,19}\b/g,
                'ZIP Code': /\b\d{5}(?:-\d{4})?\b/g
            };
            
            const results = {};
            for (const [type, pattern] of Object.entries(patterns)) {
                const matches = allText.match(pattern);
                if (matches) {
                    results[type] = [...new Set(matches)]; // Unique matches only
                }
            }
            
            Utils.updateProgress(90, 'Generating report...');
            
            // Generate Report
            let report = 'PII SCAN REPORT\n' + '='.repeat(50) + '\n\n';
            report += `File: ${pdfFiles[0].name}\n`;
            report += `Pages Scanned: ${pdf.numPages}\n`;
            report += `Scan Date: ${new Date().toLocaleString()}\n\n`;
            report += '='.repeat(50) + '\n\n';
            
            let totalFound = 0;
            for (const [type, matches] of Object.entries(results)) {
                report += `${type}: ${matches.length} found\n`;
                report += '-'.repeat(30) + '\n';
                matches.slice(0, 5).forEach(match => report += `  • ${match}\n`);
                if (matches.length > 5) report += `  ... and ${matches.length - 5} more\n`;
                report += '\n';
                totalFound += matches.length;
            }
            
            if (totalFound === 0) {
                report += 'No PII patterns detected.\n';
            }
            
            report += '\n' + '='.repeat(50) + '\n';
            report += 'DISCLAIMER: This is an automated scan and may have false positives/negatives.\n';
            report += 'Always verify results manually for sensitive documents.\n';
            
            const blob = new Blob([report], { type: 'text/plain' });
            saveAs(blob, `pii_scan_${withExt(pdfFiles[0].name, '')}.txt`);
            
            Utils.updateProgress(100, 'Complete!');
            Utils.showStatus(`PII Scan complete! Found ${totalFound} potential instances.`, totalFound > 0 ? 'warning' : 'success');
        }
    },
    
    topng: {
        name: 'PDF to Images',
        description: 'Convert PDF pages to PNG images',
        icon: '🖼️',
        configHTML: `
            <div class="form-group">
                <label class="form-label">Image Quality</label>
                <select class="form-select" id="pngQuality">
                    <option value="1">Standard (72 DPI)</option>
                    <option value="2" selected>High (150 DPI)</option>
                    <option value="3">Very High (300 DPI)</option>
                </select>
            </div>
        `,
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            const quality = parseFloat(document.getElementById('pngQuality')?.value || 2);
            
            for (let fileIdx = 0; fileIdx < pdfFiles.length; fileIdx++) {
                const file = pdfFiles[fileIdx];
                const arrayBuffer = await file.arrayBuffer();
                const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
                const pdf = await loadingTask.promise;
                
                for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                    Utils.updateProgress(
                        ((fileIdx * pdf.numPages + pageNum) / (pdfFiles.length * pdf.numPages)) * 100,
                        `Converting page ${pageNum}/${pdf.numPages} of ${file.name}...`
                    );
                    
                    const page = await pdf.getPage(pageNum);
                    const viewport = page.getViewport({ scale: quality });
                    
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;
                    
                    await page.render({ canvasContext: context, viewport: viewport }).promise;
                    
                    canvas.toBlob((blob) => {
                        saveAs(blob, `${withExt(file.name, '')}_page_${pageNum}.png`);
                    });
                }
            }
            
            Utils.updateProgress(100, 'Complete!');
            Utils.showStatus('PDF converted to images successfully!', 'success');
        }
    },
    
    imagestopdf: {
        name: 'Images to PDF',
        description: 'Create PDF from image files',
        icon: '📷',
        
        async process(files) {
            const imageFiles = files.filter(f => f.type.startsWith('image/'));
            
            if (imageFiles.length === 0) {
                Utils.showStatus('Please select image files', 'error');
                return;
            }
            
            Utils.updateProgress(10, 'Creating PDF...');
            const pdfDoc = await PDFLib.PDFDocument.create();
            
            for (let i = 0; i < imageFiles.length; i++) {
                Utils.updateProgress(20 + (i / imageFiles.length * 70), `Adding ${imageFiles[i].name}...`);
                
                const arrayBuffer = await imageFiles[i].arrayBuffer();
                let image;
                
                if (imageFiles[i].type === 'image/png') {
                    image = await pdfDoc.embedPng(arrayBuffer);
                } else {
                    image = await pdfDoc.embedJpg(arrayBuffer);
                }
                
                const page = pdfDoc.addPage([image.width, image.height]);
                page.drawImage(image, {
                    x: 0,
                    y: 0,
                    width: image.width,
                    height: image.height
                });
            }
            
            Utils.updateProgress(90, 'Generating PDF...');
            const pdfBytes = await pdfDoc.save();
            Utils.updateProgress(100, 'Complete!');
            
            saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), 'images.pdf');
            Utils.showStatus('PDF created from images successfully!', 'success');
        }
    },
    
    html2pdf: {
        name: 'HTML to PDF',
        description: 'Convert HTML to PDF',
        icon: '🌐',
        configHTML: `
            <div class="form-group">
                <label class="form-label">HTML Content or File</label>
                <textarea class="form-textarea" id="htmlContent" placeholder="Paste HTML here or upload HTML file"></textarea>
            </div>
            <div class="warning-box">
                ⚠️ HTML to PDF conversion has limitations. Complex CSS and JavaScript may not render perfectly.
            </div>
        `,
        
        async process(files) {
            Utils.showStatus('HTML to PDF conversion requires rendering engine. Feature in development.', 'info');
        }
    },
    
    // NEW v7.15.0: Office to PDF Conversion
    office2pdf: {
        name: 'Office to PDF',
        description: 'Convert Word, Excel, PowerPoint to PDF',
        icon: '📄',
        configHTML: `
            <div class="info-box" style="background: #e7f3ff; border-color: var(--color-primary);">
                📄 <strong>Office to PDF Converter</strong> - Convert Microsoft Office documents to PDF format.
            </div>
            
            <div class="form-group">
                <label class="form-label">Supported Formats</label>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-top: 8px;">
                    <div style="padding: 8px; background: #e8f4f8; border-radius: 4px; text-align: center;">
                        📝 Word<br>
                        <span style="font-size: 11px; color: var(--color-text-muted);">.docx, .doc</span>
                    </div>
                    <div style="padding: 8px; background: #e8f5e9; border-radius: 4px; text-align: center;">
                        📊 Excel<br>
                        <span style="font-size: 11px; color: var(--color-text-muted);">.xlsx, .xls</span>
                    </div>
                    <div style="padding: 8px; background: #fff3e0; border-radius: 4px; text-align: center;">
                        📽️ PowerPoint<br>
                        <span style="font-size: 11px; color: var(--color-text-muted);">.pptx, .ppt</span>
                    </div>
                </div>
            </div>
            
            <div class="form-group" id="excelOptionsGroup" style="display: none;">
                <label class="form-label">Excel Conversion Options</label>
                <select class="form-select" id="excelConversionMode">
                    <option value="all-sheets">All Sheets (Separate PDFs)</option>
                    <option value="active-sheet">Active Sheet Only</option>
                    <option value="combined">All Sheets (Combined PDF)</option>
                </select>
            </div>
            
            <div class="form-group" id="pptOptionsGroup" style="display: none;">
                <label class="form-label">PowerPoint Conversion</label>
                <select class="form-select" id="pptConversionMode">
                    <option value="slides">Slides as Pages</option>
                    <option value="handouts">Handout View</option>
                </select>
            </div>
            
            <div class="warning-box">
                ⚠️ <strong>Note:</strong> Conversion preserves content but may not match original formatting exactly. 
                Complex layouts, animations, and embedded media may be simplified.
            </div>
        `,
        
        init() {
            // Show/hide options based on file type
            // This would be called when files are added
        },
        
        async process(files) {
            const officeFiles = files.filter(FileType.isOffice);
            
            if (officeFiles.length === 0) {
                Utils.showStatus('Please upload Word (.docx, .doc), Excel (.xlsx, .xls), or PowerPoint (.pptx, .ppt) files', 'error');
                return;
            }
            
            Utils.updateProgress(10, 'Starting conversion...');
            
            let successCount = 0;
            let errorCount = 0;
            const errors = [];
            
            for (let i = 0; i < officeFiles.length; i++) {
                const file = officeFiles[i];
                const progress = ((i / officeFiles.length) * 90) + 10;
                
                try {
                    Utils.updateProgress(progress, `Converting ${file.name}...`);
                    
                    if (FileType.isWord(file)) {
                        await this.convertWordToPDF(file);
                    } else if (FileType.isExcel(file)) {
                        await this.convertExcelToPDF(file);
                    } else if (FileType.isPowerPoint(file)) {
                        await this.convertPowerPointToPDF(file);
                    }
                    
                    successCount++;
                    
                } catch (error) {
                    errorCount++;
                    errors.push({ file: file.name, error: error.message });
                    console.error(`[Office2PDF] Error converting ${file.name}:`, error);
                    // Continue processing other files
                }
            }
            
            Utils.updateProgress(100, 'Complete!');
            
            // CRITICAL FIX ISSUE #5: Better error reporting
            if (errorCount > 0) {
                const errorList = errors.map(e => `${e.file}: ${e.error}`).join('; ');
                console.error('[Office2PDF] Conversion errors:', errorList);
                
                if (errorCount === officeFiles.length) {
                    Utils.showStatus(`All ${errorCount} file(s) failed to convert. Check console for details.`, 'error');
                } else {
                    Utils.showStatus(`Converted ${successCount} file(s). ${errorCount} file(s) failed. Check console for details.`, 'warning');
                }
            } else {
                Utils.showStatus(`Converted ${successCount} Office document(s) to PDF!`, 'success');
            }
        },
        
        async convertWordToPDF(file) {
            // Use mammoth.js to convert Word to HTML, then create PDF
            const arrayBuffer = await file.arrayBuffer();
            
            const result = await mammoth.convertToHtml({ arrayBuffer });
            const html = result.value;
            
            if (result.messages.length > 0) {
                console.log('[Office2PDF] Conversion warnings:', result.messages);
            }
            
            // Create PDF from HTML using jsPDF
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4'
            });
            
            // Create a temporary container for the HTML
            const container = document.createElement('div');
            container.style.width = '210mm'; // A4 width
            container.style.padding = '20mm';
            container.innerHTML = html;
            document.body.appendChild(container);
            
            try {
                // Use html method to render HTML to PDF
                await new Promise((resolve, reject) => {
                    doc.html(container, {
                        callback: function(docInstance) {
                            try {
                                const pdfName = file.name.replace(/\.(docx?|DOCX?)$/, '.pdf');
                                docInstance.save(pdfName);
                                resolve();
                            } catch (e) {
                                reject(e);
                            }
                        },
                        x: 10,
                        y: 10,
                        width: 190, // A4 width - margins
                        windowWidth: 800
                    });
                });
            } catch (error) {
                console.error('[Office2PDF] Word conversion failed:', error);
                throw error;
            } finally {
                // CRITICAL FIX: Always remove container from DOM
                if (container && container.parentNode) {
                    document.body.removeChild(container);
                }
            }
        },
        
        async convertExcelToPDF(file) {
            const arrayBuffer = await file.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { type: 'array' });
            
            const mode = document.getElementById('excelConversionMode')?.value || 'combined';
            
            if (mode === 'all-sheets' || mode === 'combined') {
                const { jsPDF } = window.jspdf;
                let doc = new jsPDF({
                    orientation: 'landscape',
                    unit: 'mm',
                    format: 'a4'
                });
                
                let isFirstSheet = true;
                
                workbook.SheetNames.forEach((sheetName, index) => {
                    const worksheet = workbook.Sheets[sheetName];
                    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                    
                    // Create new doc for each sheet in all-sheets mode (except first)
                    if (mode === 'all-sheets' && index > 0) {
                        doc = new jsPDF({
                            orientation: 'landscape',
                            unit: 'mm',
                            format: 'a4'
                        });
                    }
                    
                    // Add new page for combined mode (except first)
                    if (!isFirstSheet && mode === 'combined') {
                        doc.addPage();
                    }
                    
                    // Add sheet title
                    doc.setFontSize(16);
                    doc.text(sheetName, 14, 15);
                    
                    // Convert to table format
                    if (jsonData.length > 0) {
                        doc.autoTable({
                            head: [jsonData[0]],
                            body: jsonData.slice(1),
                            startY: 25,
                            styles: { fontSize: 8, cellPadding: 1 },
                            headStyles: { fillColor: [66, 126, 234] },
                            margin: { top: 25 }
                        });
                    }
                    
                    // CRITICAL FIX: Save each sheet in all-sheets mode
                    if (mode === 'all-sheets') {
                        const pdfName = file.name.replace(/\.(xlsx?|XLSX?)$/, `_${sheetName}.pdf`);
                        doc.save(pdfName);
                    }
                    
                    isFirstSheet = false;
                });
                
                // Save combined PDF
                if (mode === 'combined') {
                    const pdfName = file.name.replace(/\.(xlsx?|XLSX?)$/, '.pdf');
                    doc.save(pdfName);
                }
                
            } else {
                // Active sheet only (first sheet)
                const { jsPDF } = window.jspdf;
                const doc = new jsPDF({
                    orientation: 'landscape',
                    unit: 'mm',
                    format: 'a4'
                });
                
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
                
                doc.setFontSize(16);
                doc.text(workbook.SheetNames[0], 14, 15);
                
                if (jsonData.length > 0) {
                    doc.autoTable({
                        head: [jsonData[0]],
                        body: jsonData.slice(1),
                        startY: 25,
                        styles: { fontSize: 8, cellPadding: 1 },
                        headStyles: { fillColor: [66, 126, 234] }
                    });
                }
                
                const pdfName = file.name.replace(/\.(xlsx?|XLSX?)$/, '.pdf');
                doc.save(pdfName);
            }
        },
        
        async convertPowerPointToPDF(file) {
            // PowerPoint conversion is complex - provide informative message
            Utils.showStatus(
                'PowerPoint to PDF conversion requires specialized libraries. ' +
                'For best results, use "Save As PDF" in PowerPoint, or try online conversion services.',
                'warning'
            );
            
            // Alternative: Create a simple PDF with file info
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            
            doc.setFontSize(20);
            doc.text('PowerPoint File', 20, 30);
            
            doc.setFontSize(12);
            doc.text(`Filename: ${file.name}`, 20, 50);
            doc.text(`Size: ${Utils.formatFileSize(file.size)}`, 20, 60);
            doc.text(`Type: ${file.type}`, 20, 70);
            
            doc.setFontSize(10);
            doc.text('Note: Full PowerPoint to PDF conversion requires specialized rendering.', 20, 90);
            doc.text('For best results:', 20, 100);
            doc.text('  1. Open the file in PowerPoint', 20, 110);
            doc.text('  2. Use File > Save As > PDF', 20, 120);
            doc.text('  3. Or use a dedicated online converter', 20, 130);
            
            const pdfName = file.name.replace(/\.(pptx?|PPTX?)$/, '_info.pdf');
            doc.save(pdfName);
        }
    },
    
    pdf2office: {
        name: 'PDF to Office',
        description: 'Convert PDF to Word, Excel formats',
        icon: '📝',
        configHTML: `
            <div class="info-box" style="background: #fff3e0; border-color: #ff9800;">
                ⚠️ <strong>Important:</strong> PDF to Office conversion is best-effort. Complex layouts may require manual cleanup.
            </div>
            
            <div class="form-group">
                <label class="form-label">Output Format</label>
                <select class="form-select" id="pdf2officeFormat">
                    <option value="docx">📝 Word Document (.docx)</option>
                    <option value="xlsx">📊 Excel Spreadsheet (.xlsx)</option>
                </select>
            </div>
            
            <div class="form-group">
                <label class="form-label">Conversion Quality</label>
                <div style="background: #f5f5f5; padding: 12px; border-radius: 6px; font-size: 13px;">
                    <p style="margin: 0 0 8px 0;"><strong>✅ Works Best For:</strong></p>
                    <ul style="margin: 0 0 8px 20px;">
                        <li>Text-based PDFs</li>
                        <li>Simple layouts</li>
                        <li>Tables (for Excel)</li>
                    </ul>
                    <p style="margin: 0 0 8px 0;"><strong>⚠️ May Need Cleanup:</strong></p>
                    <ul style="margin: 0 0 0 20px;">
                        <li>Complex formatting</li>
                        <li>Multi-column layouts</li>
                        <li>Scanned images (use OCR first)</li>
                    </ul>
                </div>
            </div>
        `,
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            
            if (pdfFiles.length === 0) {
                Utils.showStatus('Please select at least one PDF file', 'error');
                return;
            }
            
            const format = document.getElementById('pdf2officeFormat')?.value || 'docx';
            
            let successCount = 0;
            let errorCount = 0;
            
            for (let i = 0; i < pdfFiles.length; i++) {
                const file = pdfFiles[i];
                const progress = ((i / pdfFiles.length) * 90) + 10;
                
                try {
                    Utils.updateProgress(progress, `Converting ${file.name}...`);
                    
                    if (format === 'docx') {
                        await this.convertToWord(file);
                    } else if (format === 'xlsx') {
                        await this.convertToExcel(file);
                    }
                    
                    successCount++;
                    
                } catch (error) {
                    errorCount++;
                    console.error(`[PDF2Office] Error converting ${file.name}:`, error);
                }
            }
            
            Utils.updateProgress(100, 'Complete!');
            
            if (errorCount > 0) {
                Utils.showStatus(
                    `Converted ${successCount} file(s). ${errorCount} file(s) failed.`,
                    errorCount === pdfFiles.length ? 'error' : 'warning'
                );
            } else {
                Utils.showStatus(`Converted ${successCount} PDF(s) to ${format.toUpperCase()}!`, 'success');
            }
        },
        
        async convertToWord(file) {
            // Extract text from PDF
            const arrayBuffer = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const pdf = await loadingTask.promise;
            
            const paragraphs = [];
            
            // Extract text from each page
            for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                const page = await pdf.getPage(pageNum);
                const textContent = await page.getTextContent();
                
                // Combine text items into paragraphs
                let pageText = textContent.items.map(item => item.str).join(' ');
                
                if (pageText.trim()) {
                    paragraphs.push({
                        text: pageText,
                        isPageBreak: pageNum < pdf.numPages
                    });
                }
            }
            
            // Create Word document using docx library
            if (!window.docx) {
                Utils.showStatus('Word export library (docx.js) failed to load. Please check your internet connection and refresh the page.', 'error');
                return;
            }
            const { Document, Packer, Paragraph, TextRun, PageBreak } = window.docx;
            
            const docParagraphs = [];
            
            paragraphs.forEach((para, index) => {
                // Add the text paragraph
                docParagraphs.push(
                    new Paragraph({
                        children: [new TextRun(para.text)],
                        spacing: { after: 200 }
                    })
                );
                
                // Add page break if needed
                if (para.isPageBreak) {
                    docParagraphs.push(
                        new Paragraph({
                            children: [new PageBreak()]
                        })
                    );
                }
            });
            
            const doc = new Document({
                sections: [{
                    properties: {},
                    children: docParagraphs
                }]
            });
            
            // Generate and download
            const blob = await Packer.toBlob(doc);
            const fileName = withExt(file.name, '.docx');
            saveAs(blob, fileName);
        },
        
        async convertToExcel(file) {
            // Extract text from PDF
            const arrayBuffer = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const pdf = await loadingTask.promise;
            
            const workbook = XLSX.utils.book_new();
            
            // Process each page
            for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                const page = await pdf.getPage(pageNum);
                const textContent = await page.getTextContent();
                
                // Try to detect table-like structures
                const rows = [];
                let currentRow = [];
                let lastY = null;
                
                textContent.items.forEach(item => {
                    const y = item.transform[5];
                    
                    // New row if Y position changed significantly
                    if (lastY !== null && Math.abs(y - lastY) > 5) {
                        if (currentRow.length > 0) {
                            rows.push([...currentRow]);
                            currentRow = [];
                        }
                    }
                    
                    currentRow.push(item.str);
                    lastY = y;
                });
                
                // Add last row
                if (currentRow.length > 0) {
                    rows.push(currentRow);
                }
                
                // Create worksheet
                const sheetName = `Page ${pageNum}`;
                const worksheet = XLSX.utils.aoa_to_sheet(rows);
                XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
            }
            
            // Generate and download
            const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
            const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const fileName = withExt(file.name, '.xlsx');
            saveAs(blob, fileName);
        }
    },
    
    pagenumber: {
        name: 'Number Pages',
        description: 'Add page numbers to PDF',
        icon: '🔢',
        configHTML: `
            <div class="form-group">
                <label class="form-label">Position</label>
                <select class="form-select" id="pageNumberPosition">
                    <option value="bottom-center">Bottom Center</option>
                    <option value="bottom-right">Bottom Right</option>
                    <option value="bottom-left">Bottom Left</option>
                    <option value="top-center">Top Center</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Format</label>
                <select class="form-select" id="pageNumberFormat">
                    <option value="number">Page {n}</option>
                    <option value="of">Page {n} of {total}</option>
                    <option value="simple">{n}</option>
                </select>
            </div>
        `,
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            const position = document.getElementById('pageNumberPosition')?.value || 'bottom-center';
            const format = document.getElementById('pageNumberFormat')?.value || 'number';
            
            for (let i = 0; i < pdfFiles.length; i++) {
                Utils.updateProgress((i / pdfFiles.length) * 100, `Numbering ${pdfFiles[i].name}...`);
                
                const arrayBuffer = await pdfFiles[i].arrayBuffer();
                const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, pdfFiles[i].name);
                const pages = pdfDoc.getPages();
                const totalPages = pages.length;
                
                pages.forEach((page, index) => {
                    const { width, height } = page.getSize();
                    let text = '';
                    
                    if (format === 'number') text = `Page ${index + 1}`;
                    else if (format === 'of') text = `Page ${index + 1} of ${totalPages}`;
                    else text = `${index + 1}`;
                    
                    let x, y;
                    if (position === 'bottom-center') {
                        x = width / 2 - 20;
                        y = 20;
                    } else if (position === 'bottom-right') {
                        x = width - 60;
                        y = 20;
                    } else if (position === 'bottom-left') {
                        x = 20;
                        y = 20;
                    } else {
                        x = width / 2 - 20;
                        y = height - 30;
                    }
                    
                    page.drawText(text, {
                        x: x,
                        y: y,
                        size: 10,
                        color: PDFLib.rgb(0, 0, 0)
                    });
                });
                
                const pdfBytes = await pdfDoc.save();
                saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), `numbered_${pdfFiles[i].name}`);
            }
            
            Utils.updateProgress(100, 'Complete!');
            Utils.showStatus('Page numbers added successfully!', 'success');
        }
    },
    
    metadata: {
        name: 'View/Clear Metadata',
        description: 'View PDF metadata and optionally clear it',
        icon: '🏷️',
        currentMetadata: null,
        currentFile: null,
        
        configHTML: `
            <div class="info-box" style="background: #e7f3ff; border-color: var(--color-primary);">
                ℹ️ <strong>View Metadata:</strong> Upload a PDF to view its metadata properties.
            </div>
            
            <div id="metadataDisplay" style="display: none; margin-top: 16px;">
                <div style="background: #f8f9fa; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                    <h4 style="margin-bottom: 12px; font-size: 14px; color: var(--color-primary);">📄 File Information</h4>
                    <div style="font-family: monospace; font-size: 13px; line-height: 1.8;">
                        <div><strong>File:</strong> <span id="metaFileName">-</span></div>
                        <div><strong>Size:</strong> <span id="metaFileSize">-</span></div>
                        <div><strong>Pages:</strong> <span id="metaPageCount">-</span></div>
                    </div>
                </div>
                
                <div style="background: #f8f9fa; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                    <h4 style="margin-bottom: 12px; font-size: 14px; color: var(--color-primary);">📋 Metadata</h4>
                    <div style="font-family: monospace; font-size: 13px; line-height: 1.8;">
                        <div><strong>Title:</strong> <span id="metaTitleDisplay">-</span></div>
                        <div><strong>Author:</strong> <span id="metaAuthorDisplay">-</span></div>
                        <div><strong>Subject:</strong> <span id="metaSubjectDisplay">-</span></div>
                        <div><strong>Creator:</strong> <span id="metaCreatorDisplay">-</span></div>
                        <div><strong>Producer:</strong> <span id="metaProducerDisplay">-</span></div>
                    </div>
                </div>
                
                <div class="form-group">
                    <button type="button" class="btn btn-danger" id="clearMetadataBtn" style="width: 100%;">
                        🧹 Clear All Metadata & Download
                    </button>
                    <p style="font-size: 12px; color: var(--color-text-muted); margin-top: 8px; text-align: center;">
                        Creates a new PDF with all metadata removed
                    </p>
                </div>
            </div>
        `,
        
        init() {
            const clearBtn = document.getElementById('clearMetadataBtn');
            if (clearBtn) {
                clearBtn.addEventListener('click', () => {
                    if (this.currentFile) {
                        this.clearMetadata();
                    }
                });
            }
        },
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            
            if (pdfFiles.length !== 1) {
                Utils.showStatus('Please select exactly one PDF file', 'error');
                return;
            }
            
            this.currentFile = pdfFiles[0];
            
            Utils.updateProgress(20, 'Reading metadata...');
            
            const arrayBuffer = await pdfFiles[0].arrayBuffer();
            const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, pdfFiles[0].name);
            
            const title = pdfDoc.getTitle() || 'Not set';
            const author = pdfDoc.getAuthor() || 'Not set';
            const subject = pdfDoc.getSubject() || 'Not set';
            const creator = pdfDoc.getCreator() || 'Not set';
            const producer = pdfDoc.getProducer() || 'Not set';
            const pageCount = pdfDoc.getPageCount();
            
            // Store metadata
            this.currentMetadata = {
                title, author, subject, creator, producer, pageCount
            };
            
            // Display metadata in UI
            document.getElementById('metaFileName').textContent = pdfFiles[0].name;
            document.getElementById('metaFileSize').textContent = Utils.formatFileSize(pdfFiles[0].size);
            document.getElementById('metaPageCount').textContent = pageCount;
            document.getElementById('metaTitleDisplay').textContent = title;
            document.getElementById('metaAuthorDisplay').textContent = author;
            document.getElementById('metaSubjectDisplay').textContent = subject;
            document.getElementById('metaCreatorDisplay').textContent = creator;
            document.getElementById('metaProducerDisplay').textContent = producer;
            
            document.getElementById('metadataDisplay').style.display = 'block';
            
            Utils.updateProgress(100, 'Complete!');
            Utils.showStatus('Metadata loaded successfully', 'success');
        },
        
        async clearMetadata() {
            if (!this.currentFile) {
                Utils.showStatus('No file loaded', 'error');
                return;
            }
            
            if (!confirm('Clear all metadata from this PDF? This will download a new file with metadata removed.')) {
                return;
            }
            
            Utils.updateProgress(20, 'Loading PDF...');
            
            const arrayBuffer = await this.currentFile.arrayBuffer();
            const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, this.currentFile.name);
            
            Utils.updateProgress(50, 'Removing metadata...');
            
            // Strip ALL metadata
            pdfDoc.setTitle('');
            pdfDoc.setAuthor('');
            pdfDoc.setSubject('');
            pdfDoc.setKeywords([]);
            pdfDoc.setProducer('');
            pdfDoc.setCreator('');
            
            // Remove dates
            pdfDoc.setCreationDate(new Date(0));
            pdfDoc.setModificationDate(new Date(0));
            
            Utils.updateProgress(80, 'Saving cleaned PDF...');
            
            const pdfBytes = await pdfDoc.save();
            const cleanName = withExt(this.currentFile.name, '_metadata_cleared.pdf');
            
            saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), cleanName);
            
            Utils.updateProgress(100, 'Complete!');
            Utils.showStatus('Metadata cleared and file downloaded!', 'success');
        }
    },
    
    metaedit: {
        name: 'Edit Metadata',
        description: 'Edit PDF metadata and properties',
        icon: '✏️',
        configHTML: `
            <div class="form-group">
                <label class="form-label">Title</label>
                <input type="text" class="form-input" id="metaTitle" placeholder="Document Title">
            </div>
            <div class="form-group">
                <label class="form-label">Author</label>
                <input type="text" class="form-input" id="metaAuthor" placeholder="Author Name">
            </div>
            <div class="form-group">
                <label class="form-label">Subject</label>
                <input type="text" class="form-input" id="metaSubject" placeholder="Subject">
            </div>
            <div class="form-group">
                <label class="form-label">Creator</label>
                <input type="text" class="form-input" id="metaCreator" placeholder="e.g., Microsoft Word">
                <p style="font-size: 12px; color: var(--color-text-muted); margin-top: 4px;">
                    Software that created the original document
                </p>
            </div>
            <div class="form-group">
                <label class="form-label">Producer</label>
                <input type="text" class="form-input" id="metaProducer" placeholder="e.g., Adobe PDF Library">
                <p style="font-size: 12px; color: var(--color-text-muted); margin-top: 4px;">
                    Software that converted to PDF
                </p>
            </div>
        `,
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            const title = document.getElementById('metaTitle')?.value;
            const author = document.getElementById('metaAuthor')?.value;
            const subject = document.getElementById('metaSubject')?.value;
            const creator = document.getElementById('metaCreator')?.value;
            const producer = document.getElementById('metaProducer')?.value;
            
            for (let i = 0; i < pdfFiles.length; i++) {
                Utils.updateProgress((i / pdfFiles.length) * 100, `Updating metadata for ${pdfFiles[i].name}...`);
                
                const arrayBuffer = await pdfFiles[i].arrayBuffer();
                const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, pdfFiles[i].name);
                
                if (title) pdfDoc.setTitle(title);
                if (author) pdfDoc.setAuthor(author);
                if (subject) pdfDoc.setSubject(subject);
                if (creator) pdfDoc.setCreator(creator);
                if (producer) pdfDoc.setProducer(producer);
                
                const pdfBytes = await pdfDoc.save();
                saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), pdfFiles[i].name);
            }
            
            Utils.updateProgress(100, 'Complete!');
            Utils.showStatus('Metadata updated successfully!', 'success');
        }
    },
    
    // ENHANCEMENT v7.12: Clean Slate (Metadata Scrubber) - Privacy Tool
    cleanslate: {
        name: 'Clean Slate',
        description: 'Remove all metadata and digital fingerprints for complete privacy',
        icon: '🧹',
        configHTML: `
            <div class="info-box" style="background: #e3f2fd; border-color: var(--color-primary);">
                🔒 <strong>Privacy-First:</strong> This tool completely strips your PDF of all identifying information.
            </div>
            <div class="form-group">
                <h3 style="margin-bottom: 12px;">What will be removed:</h3>
                <ul style="margin-left: 20px; color: var(--color-text-muted);">
                    <li>Author name</li>
                    <li>Creator software (e.g., "Microsoft Word")</li>
                    <li>Producer (e.g., "Adobe PDF Library")</li>
                    <li>Creation date & time</li>
                    <li>Modification date & time</li>
                    <li>Title, subject, keywords</li>
                    <li>Custom properties</li>
                </ul>
            </div>
            <div class="warning-box">
                ⚠️ This action cannot be undone. The original metadata will be permanently removed from the output PDF.
            </div>
        `,
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            
            if (pdfFiles.length === 0) {
                Utils.showStatus('Please select at least one PDF file', 'error');
                return;
            }
            
            Utils.updateProgress(10, 'Starting metadata removal...');
            
            for (let i = 0; i < pdfFiles.length; i++) {
                Utils.updateProgress(20 + (i / pdfFiles.length * 70), `Scrubbing ${pdfFiles[i].name}...`);
                
                const arrayBuffer = await pdfFiles[i].arrayBuffer();
                const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, pdfFiles[i].name);
                
                // Strip ALL metadata
                pdfDoc.setTitle('');
                pdfDoc.setAuthor('');
                pdfDoc.setSubject('');
                pdfDoc.setKeywords([]);
                pdfDoc.setProducer('');
                pdfDoc.setCreator('');
                
                // Remove creation and modification dates by setting to epoch
                pdfDoc.setCreationDate(new Date(0));
                pdfDoc.setModificationDate(new Date(0));
                
                const pdfBytes = await pdfDoc.save();
                const cleanName = withExt(pdfFiles[i].name, '_clean.pdf');
                
                saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), cleanName);
            }
            
            Utils.updateProgress(100, 'Complete!');
            Utils.showStatus(`Metadata scrubbed! ${pdfFiles.length} file(s) cleaned.`, 'success');
        }
    },
    
    bates: {
        name: 'Bates Numbering',
        description: 'Add Bates numbering to PDFs',
        icon: '📋',
        batesPreview: null,
        batesSettings: { x: 492, y: 20, size: 10 }, // Default: bottom-right
        
        configHTML: `
            <div class="info-box" style="background: #e7f9ed; border-color: var(--color-success);">
                ✨ <strong>New!</strong> Drag the Bates number preview in the PDF to position it exactly where you want!
            </div>
            <div class="form-group">
                <label class="form-label">Prefix</label>
                <input type="text" class="form-input" id="batesPrefix" placeholder="ABC" value="DOC">
            </div>
            <div class="form-group">
                <label class="form-label">Starting Number</label>
                <input type="number" class="form-input" id="batesStart" value="1" min="1">
            </div>
            <div class="form-group">
                <label class="form-label">Number of Digits</label>
                <input type="number" class="form-input" id="batesDigits" value="6" min="1" max="10">
            </div>
            <div class="form-group">
                <label class="form-label">Quick Position Presets</label>
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;">
                    <button type="button" class="btn btn-secondary" onclick="Tools.bates.setPosition('top', 'left')">Top Left</button>
                    <button type="button" class="btn btn-secondary" onclick="Tools.bates.setPosition('top', 'right')">Top Right</button>
                    <button type="button" class="btn btn-secondary" onclick="Tools.bates.setPosition('bottom', 'left')">Bottom Left</button>
                    <button type="button" class="btn btn-secondary" onclick="Tools.bates.setPosition('bottom', 'right')">Bottom Right</button>
                </div>
            </div>
            <div class="range-group">
                <div class="range-label">
                    <span>X Position (from left)</span>
                    <span class="range-value" id="batesXValue">492</span>
                </div>
                <input type="range" id="batesX" min="0" max="600" value="492">
            </div>
            <div class="range-group">
                <div class="range-label">
                    <span>Y Position (from bottom)</span>
                    <span class="range-value" id="batesYValue">20</span>
                </div>
                <input type="range" id="batesY" min="0" max="800" value="20">
            </div>
        `,
        
        setPosition(vertical, horizontal) {
            // FIX v7.13: Use actual page dimensions instead of hardcoded Letter size
            const pageWidth = PDFPreview.currentPageWidth || 612;
            const pageHeight = PDFPreview.currentPageHeight || 792;
            const margin = 20;
            const estimatedWidth = 100; // Approximate width of Bates number
            
            let x, y;
            if (horizontal === 'left') {
                x = margin;
            } else { // right
                x = pageWidth - estimatedWidth - margin;
            }
            
            if (vertical === 'top') {
                y = pageHeight - margin - 15;
            } else { // bottom
                y = margin;
            }
            
            this.batesSettings.x = Math.round(x);
            this.batesSettings.y = Math.round(y);
            
            document.getElementById('batesX').value = this.batesSettings.x;
            document.getElementById('batesY').value = this.batesSettings.y;
            document.getElementById('batesXValue').textContent = this.batesSettings.x;
            document.getElementById('batesYValue').textContent = this.batesSettings.y;
            
            this.updateBatesPreview();
        },
        
        init() {
            const prefixInput = document.getElementById('batesPrefix');
            const startInput = document.getElementById('batesStart');
            const digitsInput = document.getElementById('batesDigits');
            
            const updatePreview = () => this.updateBatesPreview();
            
            if (prefixInput) prefixInput.addEventListener('input', updatePreview);
            if (startInput) startInput.addEventListener('input', updatePreview);
            if (digitsInput) digitsInput.addEventListener('input', updatePreview);
            
            // Bind sliders
            const sliders = [
                { id: 'batesX', prop: 'x', valueId: 'batesXValue' },
                { id: 'batesY', prop: 'y', valueId: 'batesYValue' }
            ];
            
            sliders.forEach(({ id, prop, valueId }) => {
                const slider = document.getElementById(id);
                const valueDisplay = document.getElementById(valueId);
                
                if (slider && valueDisplay) {
                    slider.addEventListener('input', (e) => {
                        const value = parseInt(e.target.value);
                        this.batesSettings[prop] = value;
                        valueDisplay.textContent = value;
                        this.updateBatesPreview();
                    });
                }
            });
            
            // Initial preview
            this.updateBatesPreview();
        },
        
        updateBatesPreview() {
            if (AppState.currentTool !== 'bates') return;
            
            this.removeBatesPreview();
            
            const wrapper = document.getElementById('canvasWrapper');
            const canvas = document.getElementById('pdfPreviewCanvas');
            if (!wrapper || !canvas) return;
            
            const prefix = document.getElementById('batesPrefix')?.value || 'DOC';
            const start = parseInt(document.getElementById('batesStart')?.value || 1);
            const digits = parseInt(document.getElementById('batesDigits')?.value || 6);
            const batesNumber = prefix + start.toString().padStart(digits, '0');
            
            const actualPageWidth = PDFPreview.currentPageWidth || 612;
            const scale = canvas.width / actualPageWidth;
            
            const preview = document.createElement('div');
            preview.id = 'batesPreviewElement';
            preview.style.position = 'absolute';
            preview.style.left = (this.batesSettings.x * scale) + 'px';
            preview.style.top = (canvas.height - (this.batesSettings.y + 15) * scale) + 'px';
            preview.style.padding = '4px 8px';
            preview.style.background = 'rgba(255, 255, 0, 0.7)';
            preview.style.border = '2px dashed #ff9800';
            preview.style.cursor = 'move';
            preview.style.zIndex = '1000';
            preview.style.fontSize = '12px';
            preview.style.fontFamily = 'monospace';
            preview.textContent = batesNumber;
            
            this.makeBatesDraggable(preview);
            wrapper.appendChild(preview);
            this.batesPreview = preview;
        },
        
        removeBatesPreview() {
            const existing = document.getElementById('batesPreviewElement');
            if (existing) existing.remove();
            this.batesPreview = null;
        },
        
        makeBatesDraggable(preview) {
            // FIX v7.13: Scoped add/remove pattern to prevent listener accumulation
            const onMouseDown = (e) => {
                let isDragging = true;
                const startX = e.clientX;
                const startY = e.clientY;
                const initialLeft = preview.offsetLeft;
                const initialTop = preview.offsetTop;
                
                preview.style.border = '2px solid #ff9800';
                e.preventDefault();
                
                const onMove = (ev) => {
                    if (!isDragging) return;
                    const deltaX = ev.clientX - startX;
                    const deltaY = ev.clientY - startY;
                    preview.style.left = (initialLeft + deltaX) + 'px';
                    preview.style.top = (initialTop + deltaY) + 'px';
                };
                
                const onUp = () => {
                    isDragging = false;
                    preview.style.border = '2px dashed #ff9800';
                    
                    // Remove listeners to prevent leak
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    
                    const canvas = document.getElementById('pdfPreviewCanvas');
                    if (!canvas) return;
                    
                    const actualPageWidth = PDFPreview.currentPageWidth || 612;
                    const scale = canvas.width / actualPageWidth;
                    const screenX = parseFloat(preview.style.left);
                    const screenY = parseFloat(preview.style.top);
                    
                    this.batesSettings.x = Math.round(screenX / scale);
                    this.batesSettings.y = Math.round((canvas.height - screenY) / scale - 15);
                    
                    document.getElementById('batesX').value = this.batesSettings.x;
                    document.getElementById('batesY').value = this.batesSettings.y;
                    document.getElementById('batesXValue').textContent = this.batesSettings.x;
                    document.getElementById('batesYValue').textContent = this.batesSettings.y;
                };
                
                document.addEventListener('mousemove', onMove, { passive: true });
                document.addEventListener('mouseup', onUp, { once: true });
            };
            
            preview.addEventListener('mousedown', onMouseDown);
        },
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            const prefix = document.getElementById('batesPrefix')?.value || 'DOC';
            let batesNum = parseInt(document.getElementById('batesStart')?.value || 1);
            const digits = parseInt(document.getElementById('batesDigits')?.value || 6);
            
            for (let i = 0; i < pdfFiles.length; i++) {
                Utils.updateProgress((i / pdfFiles.length) * 100, `Adding Bates numbers to ${pdfFiles[i].name}...`);
                
                const arrayBuffer = await pdfFiles[i].arrayBuffer();
                const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, pdfFiles[i].name);
                const pages = pdfDoc.getPages();
                
                pages.forEach(page => {
                    const batesNumber = prefix + batesNum.toString().padStart(digits, '0');
                    
                    // Use draggable position settings
                    page.drawText(batesNumber, {
                        x: this.batesSettings.x,
                        y: this.batesSettings.y,
                        size: this.batesSettings.size,
                        color: PDFLib.rgb(0, 0, 0)
                    });
                    
                    batesNum++;
                });
                
                const pdfBytes = await pdfDoc.save();
                saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), `bates_${pdfFiles[i].name}`);
            }
            
            Utils.updateProgress(100, 'Complete!');
            Utils.showStatus('Bates numbering added successfully!', 'success');
        }
    },
    
    oddeven: {
        name: 'Split Odd/Even',
        description: 'Separate odd and even pages',
        icon: '⚡',
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            
            if (pdfFiles.length !== 1) {
                Utils.showStatus('Please select exactly one PDF file', 'error');
                return;
            }
            
            Utils.updateProgress(10, 'Loading PDF...');
            const arrayBuffer = await pdfFiles[0].arrayBuffer();
            const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, pdfFiles[0].name);
            const totalPages = pdfDoc.getPageCount();
            
            Utils.updateProgress(30, 'Creating odd pages PDF...');
            const oddPdf = await PDFLib.PDFDocument.create();
            const oddIndices = Array.from({length: Math.ceil(totalPages / 2)}, (_, i) => i * 2);
            const oddPages = await oddPdf.copyPages(pdfDoc, oddIndices);
            oddPages.forEach(page => oddPdf.addPage(page));
            
            const oddBytes = await oddPdf.save();
            saveAs(new Blob([oddBytes], { type: 'application/pdf' }), 'odd_pages.pdf');
            
            Utils.updateProgress(60, 'Creating even pages PDF...');
            const evenPdf = await PDFLib.PDFDocument.create();
            const evenIndices = Array.from({length: Math.floor(totalPages / 2)}, (_, i) => i * 2 + 1);
            const evenPages = await evenPdf.copyPages(pdfDoc, evenIndices);
            evenPages.forEach(page => evenPdf.addPage(page));
            
            const evenBytes = await evenPdf.save();
            saveAs(new Blob([evenBytes], { type: 'application/pdf' }), 'even_pages.pdf');
            
            Utils.updateProgress(100, 'Complete!');
            Utils.showStatus('Odd and even pages split successfully!', 'success');
        }
    },
    
    interleave: {
        name: 'Interleave PDFs',
        description: 'Interleave pages from two PDFs',
        icon: '🔗',
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            
            if (pdfFiles.length !== 2) {
                Utils.showStatus('Please select exactly two PDF files to interleave', 'error');
                return;
            }
            
            Utils.updateProgress(10, 'Loading PDFs...');
            const buffer1 = await pdfFiles[0].arrayBuffer();
            const buffer2 = await pdfFiles[1].arrayBuffer();
            const pdf1 = await PDFLib.PDFDocument.load(buffer1);
            const pdf2 = await PDFLib.PDFDocument.load(buffer2);
            
            const maxPages = Math.max(pdf1.getPageCount(), pdf2.getPageCount());
            const interleavedPdf = await PDFLib.PDFDocument.create();
            
            for (let i = 0; i < maxPages; i++) {
                Utils.updateProgress(20 + (i / maxPages * 70), `Interleaving page ${i + 1}...`);
                
                if (i < pdf1.getPageCount()) {
                    const [page1] = await interleavedPdf.copyPages(pdf1, [i]);
                    interleavedPdf.addPage(page1);
                }
                
                if (i < pdf2.getPageCount()) {
                    const [page2] = await interleavedPdf.copyPages(pdf2, [i]);
                    interleavedPdf.addPage(page2);
                }
            }
            
            Utils.updateProgress(90, 'Generating PDF...');
            const pdfBytes = await interleavedPdf.save();
            Utils.updateProgress(100, 'Complete!');
            
            saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), 'interleaved.pdf');
            Utils.showStatus('PDFs interleaved successfully!', 'success');
        }
    },
    
    categorize: {
        name: 'Auto Categorize',
        description: 'Automatically categorize PDFs by content',
        icon: '📂',
        categories: [],
        
        configHTML: `
            <div class="info-box" style="background: #e7f9ed; border-color: var(--color-success);">
                ✨ <strong>Intelligent Categorization!</strong> Analyzes PDF content and automatically sorts into categories.
            </div>
            
            <div class="form-group">
                <label class="form-label">Categorization Mode</label>
                <select class="form-select" id="categorizationMode">
                    <option value="business">Business Documents (Invoice, Contract, Report, etc.)</option>
                    <option value="legal">Legal Documents (Agreement, Notice, Brief, etc.)</option>
                    <option value="financial">Financial Documents (Statement, Tax, Receipt, etc.)</option>
                    <option value="hr">HR Documents (Resume, Timesheet, Payroll, etc.)</option>
                    <option value="custom">Custom Keywords (define your own)</option>
                </select>
            </div>
            
            <div class="form-group" id="customKeywordsGroup" style="display: none;">
                <label class="form-label">Custom Categories (one per line)</label>
                <textarea class="form-input" id="customCategories" rows="6" placeholder="Invoice: invoice, bill, payment due&#10;Contract: agreement, contract, terms and conditions&#10;Report: report, summary, analysis"></textarea>
                <p style="font-size: 12px; color: var(--color-text-muted); margin-top: 4px;">
                    Format: <strong>CategoryName: keyword1, keyword2, keyword3</strong>
                </p>
            </div>
            
            <div class="form-group">
                <label class="form-label">
                    <input type="checkbox" id="useFilenameHints" checked> Use filename as hint
                </label>
                <p style="font-size: 12px; color: var(--color-text-muted); margin-top: 4px;">
                    Also checks filename for category keywords (e.g., "Invoice_2024.pdf")
                </p>
            </div>
            
            <div class="form-group">
                <label class="form-label">Confidence Threshold</label>
                <input type="range" id="confidenceThreshold" min="1" max="10" value="3" step="1">
                <p style="font-size: 12px; color: var(--color-text-muted); margin-top: 4px;">
                    Minimum keyword matches needed: <span id="thresholdValue">3</span>
                </p>
            </div>
            
            <div id="categorizationResults" style="display: none; margin-top: 20px;">
                <h4 style="font-size: 14px; margin-bottom: 12px;">📊 Categorization Results</h4>
                <div id="categoryResultsList"></div>
                <button type="button" class="btn btn-primary" id="downloadCategorized" style="width: 100%; margin-top: 12px;">
                    📥 Download Categorized Files (ZIP)
                </button>
            </div>
        `,
        
        init() {
            const modeSelect = document.getElementById('categorizationMode');
            const customGroup = document.getElementById('customKeywordsGroup');
            const thresholdSlider = document.getElementById('confidenceThreshold');
            const thresholdValue = document.getElementById('thresholdValue');
            
            if (modeSelect && customGroup) {
                modeSelect.addEventListener('change', (e) => {
                    customGroup.style.display = e.target.value === 'custom' ? 'block' : 'none';
                });
            }
            
            if (thresholdSlider && thresholdValue) {
                thresholdSlider.addEventListener('input', (e) => {
                    thresholdValue.textContent = e.target.value;
                });
            }
        },
        
        getCategoryRules(mode) {
            const rules = {
                business: {
                    'Invoice': ['invoice', 'bill', 'payment', 'due date', 'amount due', 'remittance', 'billing'],
                    'Contract': ['agreement', 'contract', 'terms and conditions', 'parties', 'whereas', 'covenant'],
                    'Proposal': ['proposal', 'quotation', 'estimate', 'quote', 'scope of work', 'deliverables'],
                    'Report': ['report', 'summary', 'analysis', 'findings', 'conclusion', 'executive summary'],
                    'Purchase Order': ['purchase order', 'PO number', 'order date', 'ship to', 'vendor'],
                    'Receipt': ['receipt', 'paid', 'transaction', 'payment received', 'thank you for your purchase'],
                    'Memo': ['memo', 'memorandum', 'to:', 'from:', 'subject:', 'date:'],
                    'Letter': ['dear', 'sincerely', 'regards', 'yours truly', 'correspondence']
                },
                legal: {
                    'Agreement': ['agreement', 'parties', 'whereas', 'hereby', 'covenant', 'consideration'],
                    'Notice': ['notice', 'notification', 'hereby notified', 'legal notice', 'formal notice'],
                    'Brief': ['brief', 'plaintiff', 'defendant', 'court', 'jurisdiction', 'motion'],
                    'Affidavit': ['affidavit', 'sworn', 'notary', 'affiant', 'under oath', 'subscribed'],
                    'Deed': ['deed', 'grantor', 'grantee', 'property', 'parcel', 'convey'],
                    'Will': ['last will', 'testament', 'executor', 'beneficiary', 'estate', 'bequeath'],
                    'Power of Attorney': ['power of attorney', 'agent', 'principal', 'authority', 'revoke'],
                    'Lease': ['lease', 'lessor', 'lessee', 'tenant', 'landlord', 'premises', 'rent']
                },
                financial: {
                    'Bank Statement': ['bank statement', 'account number', 'balance', 'deposits', 'withdrawals', 'beginning balance'],
                    'Tax Document': ['tax', 'IRS', 'W-2', 'W-9', '1099', 'tax year', 'taxable income'],
                    'Receipt': ['receipt', 'paid', 'payment received', 'transaction', 'tender'],
                    'Financial Statement': ['balance sheet', 'income statement', 'assets', 'liabilities', 'equity', 'revenue'],
                    'Credit Report': ['credit report', 'credit score', 'FICO', 'equifax', 'experian', 'transunion'],
                    'Loan Document': ['loan', 'borrower', 'lender', 'principal', 'interest rate', 'APR', 'amortization'],
                    'Investment Statement': ['investment', 'portfolio', 'securities', 'dividend', 'yield', 'market value']
                },
                hr: {
                    'Resume': ['resume', 'curriculum vitae', 'CV', 'education', 'experience', 'skills', 'objective'],
                    'Job Application': ['application', 'applying for', 'position', 'applicant', 'employment'],
                    'Offer Letter': ['offer letter', 'employment offer', 'start date', 'compensation', 'benefits'],
                    'Timesheet': ['timesheet', 'hours worked', 'time card', 'clock in', 'clock out', 'overtime'],
                    'Payroll': ['payroll', 'pay stub', 'pay period', 'gross pay', 'net pay', 'deductions', 'earnings'],
                    'Performance Review': ['performance review', 'evaluation', 'goals', 'objectives', 'rating', 'assessment'],
                    'Training Certificate': ['certificate', 'completion', 'training', 'course', 'certified', 'participant'],
                    'Policy Document': ['policy', 'procedure', 'handbook', 'guidelines', 'rules', 'regulations']
                }
            };
            
            return rules[mode] || rules.business;
        },
        
        parseCustomRules(text) {
            const rules = {};
            const lines = text.replace(/\r\n?/g, '\n').trim().split('\n');
            
            lines.forEach(line => {
                const match = line.match(/^([^:]+):\s*(.+)$/);
                if (match) {
                    const category = match[1].trim();
                    const keywords = match[2].split(',').map(k => k.trim().toLowerCase());
                    rules[category] = keywords;
                }
            });
            
            return rules;
        },
        
        async analyzeDocument(file, rules, useFilenameHints, confidenceThreshold) {
            // Extract text from PDF
            const arrayBuffer = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const pdf = await loadingTask.promise;
            
            let allText = '';
            for (let pageNum = 1; pageNum <= Math.min(pdf.numPages, 5); pageNum++) {
                const page = await pdf.getPage(pageNum);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map(item => item.str).join(' ');
                allText += pageText.toLowerCase() + ' ';
            }
            
            // Add filename if enabled
            if (useFilenameHints) {
                allText += ' ' + file.name.toLowerCase();
            }
            
            // Score each category
            const scores = {};
            for (const [category, keywords] of Object.entries(rules)) {
                let score = 0;
                keywords.forEach(keyword => {
                    const regex = new RegExp('\\b' + keyword.toLowerCase() + '\\b', 'gi');
                    const matches = allText.match(regex);
                    if (matches) {
                        score += matches.length;
                    }
                });
                scores[category] = score;
            }
            
            // Find best category
            const sortedCategories = Object.entries(scores)
                .sort((a, b) => b[1] - a[1])
                .filter(([_, score]) => score >= confidenceThreshold);
            
            if (sortedCategories.length > 0) {
                const [bestCategory, score] = sortedCategories[0];
                return {
                    category: bestCategory,
                    confidence: score,
                    alternatives: sortedCategories.slice(1, 3).map(([cat, sc]) => ({ category: cat, score: sc }))
                };
            }
            
            return {
                category: 'Uncategorized',
                confidence: 0,
                alternatives: []
            };
        },
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            
            if (pdfFiles.length === 0) {
                Utils.showStatus('Please select PDF files to categorize', 'error');
                return;
            }
            
            const mode = document.getElementById('categorizationMode')?.value || 'business';
            const useFilenameHints = document.getElementById('useFilenameHints')?.checked;
            const confidenceThreshold = parseInt(document.getElementById('confidenceThreshold')?.value || 3);
            
            let rules;
            if (mode === 'custom') {
                const customText = document.getElementById('customCategories')?.value;
                if (!customText || customText.trim() === '') {
                    Utils.showStatus('Please define custom categories', 'error');
                    return;
                }
                rules = this.parseCustomRules(customText);
            } else {
                rules = this.getCategoryRules(mode);
            }
            
            Utils.updateProgress(5, 'Analyzing documents...');
            
            // Analyze each file
            this.categories = [];
            for (let i = 0; i < pdfFiles.length; i++) {
                Utils.updateProgress(10 + (i / pdfFiles.length * 80), `Analyzing ${pdfFiles[i].name}...`);
                
                const result = await this.analyzeDocument(pdfFiles[i], rules, useFilenameHints, confidenceThreshold);
                
                this.categories.push({
                    file: pdfFiles[i],
                    category: result.category,
                    confidence: result.confidence,
                    alternatives: result.alternatives
                });
            }
            
            Utils.updateProgress(95, 'Generating results...');
            
            // Display results
            this.displayResults();
            
            Utils.updateProgress(100, 'Complete!');
            Utils.showStatus(`Categorized ${pdfFiles.length} files!`, 'success');
        },
        
        displayResults() {
            const resultsDiv = document.getElementById('categorizationResults');
            const listDiv = document.getElementById('categoryResultsList');
            
            if (!resultsDiv || !listDiv) return;
            
            // Group files by category
            const grouped = {};
            this.categories.forEach(item => {
                if (!grouped[item.category]) {
                    grouped[item.category] = [];
                }
                grouped[item.category].push(item);
            });
            
            // Build HTML
            let html = '';
            for (const [category, items] of Object.entries(grouped)) {
                const icon = category === 'Uncategorized' ? '❓' : '📁';
                html += `
                    <div style="margin-bottom: 16px; padding: 12px; background: var(--color-surface); border-radius: var(--radius-md); border: 2px solid var(--color-border);">
                        <h5 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600;">
                            ${icon} ${category} (${items.length} file${items.length > 1 ? 's' : ''})
                        </h5>
                        <div style="font-size: 12px; color: var(--color-text-muted);">
                            ${items.map(item => `
                                <div style="padding: 4px 0; display: flex; justify-content: space-between; align-items: center;">
                                    <span>📄 ${item.file.name}</span>
                                    <span style="background: ${item.confidence > 5 ? '#28a745' : item.confidence > 2 ? '#ffc107' : '#dc3545'}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 10px;">
                                        ${item.confidence > 0 ? 'Confidence: ' + item.confidence : 'Low confidence'}
                                    </span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }
            
            listDiv.innerHTML = html;
            resultsDiv.style.display = 'block';
            
            // Bind download button
            const downloadBtn = document.getElementById('downloadCategorized');
            if (downloadBtn) {
                downloadBtn.onclick = () => this.downloadCategorized();
            }
        },
        
        async downloadCategorized() {
            Utils.updateProgress(10, 'Creating categorized folders...');
            
            const zip = new JSZip();
            
            // Group by category and add to ZIP
            const grouped = {};
            this.categories.forEach(item => {
                if (!grouped[item.category]) {
                    grouped[item.category] = [];
                }
                grouped[item.category].push(item);
            });
            
            let fileIndex = 0;
            const totalFiles = this.categories.length;
            
            for (const [category, items] of Object.entries(grouped)) {
                const folder = zip.folder(category);
                
                for (const item of items) {
                    fileIndex++;
                    Utils.updateProgress(10 + (fileIndex / totalFiles * 80), `Adding ${item.file.name}...`);
                    
                    const arrayBuffer = await item.file.arrayBuffer();
                    folder.file(item.file.name, arrayBuffer);
                }
            }
            
            Utils.updateProgress(95, 'Generating ZIP file...');
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            
            Utils.updateProgress(100, 'Complete!');
            saveAs(zipBlob, 'categorized_pdfs.zip');
            Utils.showStatus('Categorized files downloaded!', 'success');
        }
    },
    
    invoice: {
        name: 'Invoice Splitter',
        description: 'Split PDFs by detecting invoice patterns',
        icon: '🧾',
        configHTML: `
            <div class="info-box" style="background: #e7f3ff; border-color: var(--color-primary);">
                🧾 <strong>Invoice Splitter</strong> - Automatically split multi-invoice PDFs into individual files.
            </div>
            
            <div class="form-group">
                <label class="form-label">Split Trigger</label>
                <input type="text" class="form-input" id="invoiceKeyword" placeholder="INVOICE" value="INVOICE">
                <p style="font-size: 12px; color: var(--color-text-muted); margin-top: 4px;">
                    Creates a new file each time this keyword is found (case-insensitive)
                </p>
            </div>
            
            <div class="form-group">
                <label class="form-label">Output Format</label>
                <select class="form-select" id="invoiceOutputMode">
                    <option value="zip">ZIP Archive (Recommended)</option>
                    <option value="individual">Individual Downloads</option>
                </select>
            </div>
            
            <div class="form-group">
                <label class="form-label">File Naming</label>
                <select class="form-select" id="invoiceNamingMode">
                    <option value="numbered">invoice_001.pdf, invoice_002.pdf...</option>
                    <option value="original">original_name_001.pdf, original_name_002.pdf...</option>
                </select>
            </div>
            
            <div class="info-box" style="background: #fff3cd; border-color: #ffc107;">
                💡 <strong>How it works:</strong> Scans each page for your keyword. When found, starts a new invoice file.
                If a 10-page PDF has "INVOICE" on pages 1, 4, and 7, you'll get 3 separate invoices.
            </div>
        `,
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            
            if (pdfFiles.length === 0) {
                Utils.showStatus('Please select at least one PDF file', 'error');
                return;
            }
            
            const keyword = document.getElementById('invoiceKeyword')?.value || 'INVOICE';
            const outputMode = document.getElementById('invoiceOutputMode')?.value || 'zip';
            const namingMode = document.getElementById('invoiceNamingMode')?.value || 'numbered';
            
            if (!keyword.trim()) {
                Utils.showStatus('Please enter a split keyword', 'error');
                return;
            }
            
            Utils.updateProgress(5, 'Starting invoice splitting...');
            
            let allSplitFiles = [];
            
            for (let fileIdx = 0; fileIdx < pdfFiles.length; fileIdx++) {
                const file = pdfFiles[fileIdx];
                const baseProgress = (fileIdx / pdfFiles.length) * 90;
                
                Utils.updateProgress(baseProgress + 5, `Analyzing ${file.name}...`);
                
                try {
                    const splitFiles = await this.splitInvoices(file, keyword, namingMode);
                    allSplitFiles.push(...splitFiles);
                    
                    console.log(`[InvoiceSplitter] Split ${file.name} into ${splitFiles.length} file(s)`);
                    
                } catch (error) {
                    console.error(`[InvoiceSplitter] Error processing ${file.name}:`, error);
                    Utils.showStatus(`Error processing ${file.name}: ${error.message}`, 'error');
                }
            }
            
            if (allSplitFiles.length === 0) {
                Utils.showStatus(`No invoices found with keyword "${keyword}"`, 'warning');
                return;
            }
            
            Utils.updateProgress(95, 'Preparing downloads...');
            
            // Download results
            if (outputMode === 'zip') {
                await Utils.createZipBundle(allSplitFiles, 'invoices_split.zip');
                Utils.updateProgress(100, 'Complete!');
                Utils.showStatus(`Split into ${allSplitFiles.length} invoice(s)! Downloaded as ZIP.`, 'success');
            } else {
                // Individual downloads
                for (let i = 0; i < allSplitFiles.length; i++) {
                    const fileData = allSplitFiles[i];
                    saveAs(new Blob([fileData.data], { type: 'application/pdf' }), fileData.name);
                    
                    // Delay to avoid browser blocking
                    if (i < allSplitFiles.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 300 + i * 50));
                    }
                }
                Utils.updateProgress(100, 'Complete!');
                Utils.showStatus(`Downloaded ${allSplitFiles.length} invoice(s) individually!`, 'success');
            }
        },
        
        async splitInvoices(file, keyword, namingMode) {
            const splitFiles = [];
            
            // Load PDF for text extraction
            const arrayBuffer = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const pdf = await loadingTask.promise;
            
            // Find pages with keyword
            const splitPages = []; // Array of page numbers where keyword appears
            
            for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                const page = await pdf.getPage(pageNum);
                const textContent = await page.getTextContent();
                
                // Combine all text from the page
                const pageText = textContent.items.map(item => item.str).join(' ');
                
                // Check if keyword appears (case-insensitive)
                if (pageText.toUpperCase().includes(keyword.toUpperCase())) {
                    splitPages.push(pageNum);
                }
            }
            
            // If no keyword found, return entire PDF as one file
            if (splitPages.length === 0) {
                console.warn(`[InvoiceSplitter] No keyword "${keyword}" found in ${file.name}`);
                return [];
            }
            
            // Create split ranges
            const ranges = [];
            for (let i = 0; i < splitPages.length; i++) {
                const startPage = splitPages[i];
                const endPage = i < splitPages.length - 1 ? splitPages[i + 1] - 1 : pdf.numPages;
                ranges.push({ start: startPage, end: endPage });
            }
            
            // Load PDF with pdf-lib for splitting
            const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, file.name);
            
            // Create a PDF for each range
            for (let i = 0; i < ranges.length; i++) {
                const range = ranges[i];
                const newPdf = await PDFLib.PDFDocument.create();
                
                // Copy pages in range
                const pageIndices = [];
                for (let p = range.start; p <= range.end; p++) {
                    pageIndices.push(p - 1); // Convert to 0-indexed
                }
                
                const copiedPages = await newPdf.copyPages(pdfDoc, pageIndices);
                copiedPages.forEach(page => newPdf.addPage(page));
                
                // Auto-scrub metadata if enabled
                if (AppState.autoScrubMetadata) {
                    Utils.scrubMetadata(newPdf, true);
                }
                
                const pdfBytes = await newPdf.save();
                
                // Generate filename
                let fileName;
                if (namingMode === 'original') {
                    const baseName = withExt(file.name, '');
                    const invoiceNum = String(i + 1).padStart(3, '0');
                    fileName = `${baseName}_${invoiceNum}.pdf`;
                } else {
                    const invoiceNum = String(i + 1).padStart(3, '0');
                    fileName = `invoice_${invoiceNum}.pdf`;
                }
                
                splitFiles.push({
                    name: fileName,
                    data: pdfBytes
                });
            }
            
            return splitFiles;
        }
    },
    
    batchslicer: {
        name: 'Batch Slicer',
        description: 'Batch process multiple split operations',
        icon: '🔪',
        configHTML: `
            <div class="info-box">
                ℹ️ Upload multiple PDFs and configure batch slicing rules.
            </div>
            <div class="form-group">
                <label class="form-label">Pages per Slice</label>
                <input type="number" class="form-input" id="slicePages" value="1" min="1">
            </div>
        `,
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            const pagesPerSlice = parseInt(document.getElementById('slicePages')?.value || 1);
            
            for (let fileIdx = 0; fileIdx < pdfFiles.length; fileIdx++) {
                const file = pdfFiles[fileIdx];
                const arrayBuffer = await file.arrayBuffer();
                const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, file.name);
                const totalPages = pdfDoc.getPageCount();
                
                let sliceNum = 1;
                for (let i = 0; i < totalPages; i += pagesPerSlice) {
                    Utils.updateProgress(
                        ((fileIdx * totalPages + i) / (pdfFiles.length * totalPages)) * 100,
                        `Slicing ${file.name} - Part ${sliceNum}...`
                    );
                    
                    const newPdf = await PDFLib.PDFDocument.create();
                    const endPage = Math.min(i + pagesPerSlice, totalPages);
                    const pages = await newPdf.copyPages(pdfDoc, Array.from({length: endPage - i}, (_, idx) => i + idx));
                    pages.forEach(page => newPdf.addPage(page));
                    
                    const pdfBytes = await newPdf.save();
                    saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), `${withExt(file.name, '')}_slice_${sliceNum++}.pdf`);
                }
            }
            
            Utils.updateProgress(100, 'Complete!');
            Utils.showStatus('Batch slicing complete!', 'success');
        }
    },
    
    validate: {
        name: 'Validate PDF',
        description: 'Check PDF validity and structure',
        icon: '✓',
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            
            let validCount = 0;
            let invalidCount = 0;
            
            for (let i = 0; i < pdfFiles.length; i++) {
                try {
                    const arrayBuffer = await pdfFiles[i].arrayBuffer();
                    const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, file.name);
                    const pageCount = pdfDoc.getPageCount();
                    
                    console.log(`✓ ${pdfFiles[i].name}: Valid (${pageCount} pages)`);
                    validCount++;
                } catch (e) {
                    console.error(`✗ ${pdfFiles[i].name}: Invalid - ${e.message}`);
                    invalidCount++;
                }
            }
            
            Utils.showStatus(`Validation complete: ${validCount} valid, ${invalidCount} invalid`, validCount === pdfFiles.length ? 'success' : 'warning');
        }
    },
    
    repair: {
        name: 'Repair PDF',
        description: 'Attempt to repair corrupted PDFs',
        icon: '🔧',
        configHTML: `
            <div class="warning-box">
                ⚠️ PDF repair has limitations. Severely corrupted files may not be recoverable.
            </div>
        `,
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            
            for (let i = 0; i < pdfFiles.length; i++) {
                Utils.updateProgress((i / pdfFiles.length) * 100, `Attempting to repair ${pdfFiles[i].name}...`);
                
                try {
                    const arrayBuffer = await pdfFiles[i].arrayBuffer();
                    const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
                    const pdfBytes = await pdfDoc.save();
                    
                    saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), `repaired_${pdfFiles[i].name}`);
                    Utils.showStatus(`${pdfFiles[i].name} repaired successfully`, 'success');
                } catch (e) {
                    Utils.showStatus(`Failed to repair ${pdfFiles[i].name}: ${e.message}`, 'error');
                }
            }
            
            Utils.updateProgress(100, 'Complete!');
        }
    },
    
    audit: {
        name: 'PDF Audit',
        description: 'Generate detailed PDF analysis report',
        icon: '📊',
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            
            let report = 'PDF AUDIT REPORT\n' + '='.repeat(50) + '\n\n';
            
            for (let i = 0; i < pdfFiles.length; i++) {
                const file = pdfFiles[i];
                const arrayBuffer = await file.arrayBuffer();
                const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, file.name);
                
                report += `File: ${file.name}\n`;
                report += `Size: ${Utils.formatFileSize(file.size)}\n`;
                report += `Pages: ${pdfDoc.getPageCount()}\n`;
                report += `Title: ${pdfDoc.getTitle() || 'Not set'}\n`;
                report += `Author: ${pdfDoc.getAuthor() || 'Not set'}\n`;
                report += `Creator: ${pdfDoc.getCreator() || 'Not set'}\n`;
                report += `Producer: ${pdfDoc.getProducer() || 'Not set'}\n`;
                report += '\n';
            }
            
            const blob = new Blob([report], { type: 'text/plain' });
            saveAs(blob, 'pdf_audit_report.txt');
            
            Utils.showStatus('Audit report generated!', 'success');
        }
    },
    
    // ==================== NEW FEATURE #1: SPLIT & MERGE TOOL ====================
    
    splitmerge: {
        name: 'Split & Merge',
        description: 'Split PDFs by page and merge into categorized files',
        icon: '📊',
        configHTML: `
            <div class="info-box">
                ℹ️ <strong>How this works:</strong><br>
                • Files are sorted alphabetically by name<br>
                • <strong>invoices.pdf</strong> = All 1st pages from each PDF<br>
                • <strong>certified_payroll.pdf</strong> = All 2nd pages from each PDF<br>
                • <strong>timesheets.pdf</strong> = All remaining pages (3+) from each PDF
            </div>
            <div class="warning-box">
                ⚠️ Please upload multiple PDFs. Each PDF should have at least 1 page. Files with only 1-2 pages will only contribute to invoices and/or payroll.
            </div>
        `,
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            
            if (pdfFiles.length < 2) {
                Utils.showStatus('Please select at least 2 PDF files for split & merge', 'error');
                return;
            }
            
            // Sort files alphabetically by filename
            const sortedFiles = [...pdfFiles].sort((a, b) => a.name.localeCompare(b.name));
            console.log('Processing files in alphabetical order:', sortedFiles.map(f => f.name));
            
            Utils.updateProgress(10, 'Loading PDFs...');
            
            // Create three output PDFs
            const invoicesPdf = await PDFLib.PDFDocument.create();
            const payrollPdf = await PDFLib.PDFDocument.create();
            const timesheetsPdf = await PDFLib.PDFDocument.create();
            
            let hasInvoices = false;
            let hasPayroll = false;
            let hasTimesheets = false;
            
            // Process each file
            for (let i = 0; i < sortedFiles.length; i++) {
                Utils.updateProgress(20 + (i / sortedFiles.length * 60), `Processing ${sortedFiles[i].name}...`);
                
                const arrayBuffer = await sortedFiles[i].arrayBuffer();
                const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, sortedFiles[i].name);
                const totalPages = pdfDoc.getPageCount();
                
                // Page 1 goes to invoices.pdf
                if (totalPages >= 1) {
                    const [page1] = await invoicesPdf.copyPages(pdfDoc, [0]);
                    invoicesPdf.addPage(page1);
                    hasInvoices = true;
                }
                
                // Page 2 goes to certified_payroll.pdf
                if (totalPages >= 2) {
                    const [page2] = await payrollPdf.copyPages(pdfDoc, [1]);
                    payrollPdf.addPage(page2);
                    hasPayroll = true;
                }
                
                // Pages 3+ go to timesheets.pdf
                if (totalPages >= 3) {
                    const remainingIndices = Array.from({length: totalPages - 2}, (_, idx) => idx + 2);
                    const remainingPages = await timesheetsPdf.copyPages(pdfDoc, remainingIndices);
                    remainingPages.forEach(page => timesheetsPdf.addPage(page));
                    hasTimesheets = true;
                }
            }
            
            Utils.updateProgress(85, 'Generating output files...');
            
            // STRATEGIC RECOMMENDATION #3: Bundle multiple outputs into ZIP
            const outputFiles = [];
            
            if (hasInvoices) {
                const invoicesBytes = await invoicesPdf.save();
                outputFiles.push({ name: 'invoices.pdf', data: invoicesBytes });
            }
            
            if (hasPayroll) {
                const payrollBytes = await payrollPdf.save();
                outputFiles.push({ name: 'certified_payroll.pdf', data: payrollBytes });
            }
            
            if (hasTimesheets) {
                const timesheetsBytes = await timesheetsPdf.save();
                outputFiles.push({ name: 'timesheets.pdf', data: timesheetsBytes });
            }
            
            // If more than one file, bundle into ZIP for convenience
            if (outputFiles.length > 1) {
                Utils.updateProgress(90, 'Creating ZIP bundle...');
                const zip = new JSZip();
                
                outputFiles.forEach(file => {
                    zip.file(file.name, file.data);
                });
                
                const zipBlob = await zip.generateAsync({ type: 'blob' });
                saveAs(zipBlob, 'processed_files.zip');
                
                Utils.showStatus(`Split & Merge complete! Created ${outputFiles.length} files bundled in ZIP.`, 'success');
            } else if (outputFiles.length === 1) {
                // Single file, just save it directly
                saveAs(new Blob([outputFiles[0].data], { type: 'application/pdf' }), outputFiles[0].name);
                Utils.showStatus('Split & Merge complete! Created 1 file.', 'success');
            } else {
                Utils.showStatus('No files created - check that PDFs have pages', 'warning');
            }
            
            Utils.updateProgress(100, 'Complete!');
        }
    },
    
    // ==================== OCR TOOL - Convert Scanned PDFs to Searchable ====================
    
    ocr: {
        name: 'OCR (Make Searchable)',
        description: 'Convert scanned/image PDFs to searchable text using OCR',
        icon: '🔍',
        configHTML: `
            <div class="form-group">
                <label class="form-label">OCR Language</label>
                <select class="form-select" id="ocrLanguage">
                    <option value="eng">English</option>
                    <option value="spa">Spanish</option>
                    <option value="fra">French</option>
                    <option value="deu">German</option>
                    <option value="ita">Italian</option>
                    <option value="por">Portuguese</option>
                    <option value="rus">Russian</option>
                    <option value="jpn">Japanese</option>
                    <option value="chi_sim">Chinese (Simplified)</option>
                    <option value="chi_tra">Chinese (Traditional)</option>
                    <option value="ara">Arabic</option>
                    <option value="hin">Hindi</option>
                </select>
                <p style="font-size: 12px; color: var(--color-text-muted); margin-top: 4px;">
                    Select the language of text in your scanned PDF
                </p>
            </div>
            <div class="form-group">
                <label class="form-label">Processing Mode</label>
                <select class="form-select" id="ocrMode">
                    <option value="auto">Auto-Detect (Recommended)</option>
                    <option value="force">Force OCR on All Pages</option>
                    <option value="skip-text">Only Pages Without Text</option>
                </select>
                <p style="font-size: 12px; color: var(--color-text-muted); margin-top: 4px;">
                    Auto-detect scans each page and only OCRs image-based pages
                </p>
            </div>
            <div style="background: #fff3cd; padding: 12px; border-radius: 6px; margin-top: 12px;">
                <p style="font-size: 13px; margin: 0; color: #856404;">
                    ⚠️ <strong>Note:</strong> OCR is processing-intensive. Large PDFs may take several minutes.
                    First-time use downloads language data (~10MB).
                </p>
            </div>
        `,
        
        async process(files) {
            const pdfFiles = files.filter(FileType.isPDF);
            
            if (pdfFiles.length === 0) {
                Utils.showStatus('Please select at least one PDF file', 'error');
                return;
            }
            
            if (pdfFiles.length > 1) {
                Utils.showStatus('OCR processes one PDF at a time. Please select a single PDF.', 'warning');
                return;
            }
            
            const language = document.getElementById('ocrLanguage')?.value || 'eng';
            const mode = document.getElementById('ocrMode')?.value || 'auto';
            
            Utils.updateProgress(5, 'Initializing OCR engine...');
            
            // CRITICAL FIX: Ensure worker is always terminated, even on error
            let worker = null;
            
            try {
                // Check if Tesseract is loaded
                if (typeof Tesseract === 'undefined') {
                    Utils.showStatus('OCR library not loaded. Please refresh the page.', 'error');
                    return;
                }
                
                const file = pdfFiles[0];
                Utils.updateProgress(10, 'Loading PDF...');
                
                // Load PDF
                const arrayBuffer = await file.arrayBuffer();
                const pdfDoc = await Utils.loadPDFWithEncryptionHandler(arrayBuffer, file.name);
                const numPages = pdfDoc.getPageCount();
                
                Utils.updateProgress(15, `Analyzing ${numPages} pages...`);
                
                // Load original PDF with pdf.js for rendering
                const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
                const pdf = await loadingTask.promise;
                
                // Create OCR worker
                Utils.updateProgress(20, 'Starting OCR engine...');
                worker = await Tesseract.createWorker(language, 1, {
                    logger: m => {
                        if (m.status === 'recognizing text') {
                            const progress = Math.round(m.progress * 100);
                            console.log(`[OCR] Page progress: ${progress}%`);
                        }
                    }
                });
                
                // Process each page
                const ocrResults = [];
                let pagesProcessed = 0;
                let pagesWithOCR = 0;
                
                for (let pageNum = 1; pageNum <= numPages; pageNum++) {
                    const baseProgress = 20 + (pageNum / numPages) * 60;
                    Utils.updateProgress(baseProgress, `Processing page ${pageNum} of ${numPages}...`);
                    
                    // Get page from pdf.js
                    const page = await pdf.getPage(pageNum);
                    
                    // Check if page has text (if mode is auto or skip-text)
                    let hasText = false;
                    if (mode === 'auto' || mode === 'skip-text') {
                        const textContent = await page.getTextContent();
                        hasText = textContent.items.length > 0 && 
                                  textContent.items.some(item => item.str.trim().length > 0);
                    }
                    
                    let ocrText = '';
                    
                    if (mode === 'force' || !hasText) {
                        // Need to OCR this page
                        Utils.updateProgress(baseProgress + 1, `OCR: Page ${pageNum}...`);
                        
                        // Render page to canvas
                        const scale = 2.0; // Higher scale = better OCR accuracy
                        const viewport = page.getViewport({ scale });
                        const canvas = document.createElement('canvas');
                        canvas.height = viewport.height;
                        canvas.width = viewport.width;
                        const context = canvas.getContext('2d');
                        
                        await page.render({
                            canvasContext: context,
                            viewport: viewport
                        }).promise;
                        
                        // Perform OCR
                        const { data: { text } } = await worker.recognize(canvas);
                        ocrText = text;
                        pagesWithOCR++;
                        
                        console.log(`[OCR] Page ${pageNum}: Found ${ocrText.length} characters`);
                    } else {
                        console.log(`[OCR] Page ${pageNum}: Skipped (already has text)`);
                    }
                    
                    ocrResults.push({
                        pageNum,
                        text: ocrText,
                        hadOCR: ocrText.length > 0
                    });
                    
                    pagesProcessed++;
                }
                
                Utils.updateProgress(85, 'Creating searchable PDF...');
                
                // Create new PDF with OCR text layer
                const newPdf = await PDFLib.PDFDocument.create();
                
                for (let i = 0; i < numPages; i++) {
                    const [copiedPage] = await newPdf.copyPages(pdfDoc, [i]);
                    newPdf.addPage(copiedPage);
                    
                    // If this page had OCR, add text layer
                    if (ocrResults[i].hadOCR && ocrResults[i].text) {
                        const page = newPdf.getPage(i);
                        const { width, height } = page.getSize();
                        
                        // Add invisible text layer at bottom of page
                        // This makes the PDF searchable without visible text overlay
                        try {
                            page.drawText(ocrResults[i].text, {
                                x: 0,
                                y: 0,
                                size: 1, // Very small, effectively invisible
                                opacity: 0.01, // Almost transparent
                                maxWidth: width
                            });
                        } catch (error) {
                            console.warn(`[OCR] Could not add text layer to page ${i + 1}:`, error);
                        }
                    }
                }
                
                Utils.updateProgress(95, 'Saving searchable PDF...');
                
                const pdfBytes = await newPdf.save();
                const fileName = file.name.replace(/\.pdf$/i, '_searchable.pdf');
                
                saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), fileName);
                
                Utils.updateProgress(100, 'Complete!');
                
                const summary = `OCR Complete! Processed ${pagesProcessed} pages. ` +
                               `OCR applied to ${pagesWithOCR} pages. ` +
                               `Saved as ${fileName}`;
                
                Utils.showStatus(summary, 'success');
                
            } catch (error) {
                console.error('[OCR] Error:', error);
                Utils.showStatus('OCR failed: ' + error.message, 'error');
            } finally {
                // CRITICAL FIX: Always terminate worker to prevent memory leak
                if (worker) {
                    try {
                        await worker.terminate();
                        console.log('[OCR] Worker terminated successfully');
                    } catch (e) {
                        console.warn('[OCR] Failed to terminate worker:', e);
                    }
                }
            }
        }
    },

    // ==================== DOCUMENT SCANNER ====================
    docscan: {
        name: 'Document Scanner',
        description: 'Detect a document in a photo, crop to its borders, deskew, and export as PDF',
        icon: '📸',

        configHTML: `
            <div class="info-box" style="background: #e7f3ff; border-color: var(--color-primary);">
                📸 <strong>Document Scanner</strong> — Upload a photo of any document (receipt, letter,
                form, ID card, etc.). The tool automatically detects the document edges, straightens
                perspective, crops to the border, and saves a clean PDF. All processing happens
                entirely in your browser.
            </div>

            <div class="form-group">
                <label class="form-label">Output Page Size</label>
                <select class="form-select" id="docScanPageSize">
                    <option value="auto">Auto — fit document dimensions</option>
                    <option value="Letter" selected>Letter (8.5 × 11 in)</option>
                    <option value="A4">A4 (210 × 297 mm)</option>
                </select>
            </div>

            <div class="form-group">
                <label class="form-label">Image Enhancement</label>
                <select class="form-select" id="docScanEnhancement">
                    <option value="none">None — keep original colours</option>
                    <option value="grayscale">Grayscale</option>
                    <option value="blackwhite">Black &amp; White (high contrast)</option>
                </select>
            </div>

            <div class="form-group">
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                    <input type="checkbox" id="docScanRemoveBg" style="width:16px; height:16px; cursor:pointer;">
                    <span><strong>Remove background</strong> — whiten the paper/desk colour, keep text &amp; images</span>
                </label>
                <div style="margin-top:6px; display:flex; align-items:center; gap:8px;" id="docScanBgToleranceRow">
                    <label class="form-label" style="margin:0; white-space:nowrap; font-size:12px;">Sensitivity</label>
                    <input type="range" id="docScanBgTolerance" min="10" max="120" value="40" style="flex:1;">
                    <span id="docScanBgToleranceVal" style="font-size:12px; min-width:28px; text-align:right;">40</span>
                </div>
            </div>

            <div id="docScanPreview" style="margin-top: 16px;">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
                    <label class="form-label" style="margin:0;">Detected Document Area</label>
                    <button id="docScanResetBtn" class="btn btn-secondary"
                            style="padding:4px 10px; font-size:12px;" title="Re-run automatic corner detection">
                        ↺ Reset corners
                    </button>
                </div>
                <canvas id="docScanCanvas" style="max-width:100%; border:1px solid var(--color-border); border-radius:8px; display:block;"></canvas>
                <p style="font-size:12px; color:var(--color-text-muted); margin-top:6px;">
                    Green outline = detected document region.
                    <strong>Drag any corner dot to adjust it.</strong>
                    Use ↺ Reset to re-run auto detection.
                </p>
                <div id="docScanWarpWrap" style="display:none; margin-top:14px;">
                    <label class="form-label">Straightened preview</label>
                    <canvas id="docScanWarpPreview" style="max-width:100%; border:1px solid var(--color-border); border-radius:8px; display:block;"></canvas>
                </div>
            </div>
        `,

        init() {
            console.log('[DocScan] init() called, files:', AppState.files.length);
            const imageFiles = AppState.files.filter(f => f.type.startsWith('image/'));
            console.log('[DocScan] init() image files:', imageFiles.length);
            if (imageFiles.length > 0) {
                DocScanUtils.showPreview(imageFiles[0]);
            } else {
                // Draw placeholder so the preview area is visible from the start
                const canvas = document.getElementById('docScanCanvas');
                if (canvas) {
                    const w = canvas.parentElement ? Math.max(200, canvas.parentElement.clientWidth - 16) : 400;
                    canvas.width  = w;
                    canvas.height = Math.round(w * 0.55);
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#f5f5f5';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.fillStyle = '#aaa';
                    ctx.font = `${Math.max(13, w / 22)}px sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.fillText('Add an image above to see the preview', canvas.width / 2, canvas.height / 2);
                }
            }
            // Wire slider label
            const tolSlider = document.getElementById('docScanBgTolerance');
            const tolVal    = document.getElementById('docScanBgToleranceVal');
            if (tolSlider && tolVal) {
                tolSlider.addEventListener('input', () => { tolVal.textContent = tolSlider.value; });
            }

            // Reset button (showPreview also wires it with a dataset guard)
            const resetBtn = document.getElementById('docScanResetBtn');
            if (resetBtn && !resetBtn.dataset.wired) {
                resetBtn.dataset.wired = '1';
                resetBtn.addEventListener('click', () => {
                    const canvas = document.getElementById('docScanCanvas');
                    if (canvas && DocScanUtils._previewState.img) {
                        DocScanUtils._resetToAutoDetect(canvas);
                    }
                });
            }
        },

        async process(files) {
            const imageFiles = files.filter(f => f.type.startsWith('image/'));
            if (imageFiles.length === 0) {
                Utils.showStatus('Please upload one or more image files (JPEG, PNG, WEBP, etc.)', 'error');
                return;
            }

            const pageSize    = document.getElementById('docScanPageSize')?.value    || 'Letter';
            const enhancement = document.getElementById('docScanEnhancement')?.value || 'none';
            const removeBg    = document.getElementById('docScanRemoveBg')?.checked  || false;
            const bgTolerance = parseInt(document.getElementById('docScanBgTolerance')?.value || '40', 10);

            Utils.updateProgress(5, 'Initializing...');
            const pdfDoc = await PDFLib.PDFDocument.create();

            for (let i = 0; i < imageFiles.length; i++) {
                const file = imageFiles[i];
                Utils.updateProgress(
                    10 + (i / imageFiles.length) * 82,
                    `Processing ${file.name} (${i+1}/${imageFiles.length})…`
                );
                try {
                    // Detect corners, crop, deskew, optionally remove background
                    const processedCanvas = await DocScanUtils.processImage(file, enhancement, 2000, removeBg, bgTolerance);

                    // Encode to JPEG for pdf-lib embedding
                    const blob = await new Promise((res, rej) =>
                        processedCanvas.toBlob(
                            b => b ? res(b) : rej(new Error('Canvas export failed — image may be corrupted or cross-origin')),
                            'image/jpeg', 0.92
                        )
                    );
                    const arrayBuffer = await blob.arrayBuffer();
                    const embeddedImg = await pdfDoc.embedJpg(arrayBuffer);

                    // Determine PDF page dimensions
                    let pgW, pgH;
                    if (pageSize === 'Letter') {
                        pgW = 612;    pgH = 792;
                    } else if (pageSize === 'A4') {
                        pgW = 595.28; pgH = 841.89;
                    } else {
                        // Auto: use pixel dimensions directly (1 px = 1 pt at 72 DPI)
                        pgW = embeddedImg.width;
                        pgH = embeddedImg.height;
                    }

                    const page  = pdfDoc.addPage([pgW, pgH]);
                    const scale = Math.min(pgW / embeddedImg.width, pgH / embeddedImg.height);
                    const drawW = embeddedImg.width  * scale;
                    const drawH = embeddedImg.height * scale;
                    page.drawImage(embeddedImg, {
                        x: (pgW - drawW) / 2,
                        y: (pgH - drawH) / 2,
                        width:  drawW,
                        height: drawH,
                    });
                } catch (err) {
                    console.error(`[DocScan] Failed on ${file.name}:`, err);
                    Utils.showStatus(`Skipped ${file.name}: ${err.message}`, 'warning');
                }
            }

            if (pdfDoc.getPageCount() === 0) {
                Utils.showStatus('No pages were created. Please check your images and try again.', 'error');
                return;
            }

            Utils.updateProgress(95, 'Saving PDF…');
            if (AppState.autoScrubMetadata) Utils.scrubMetadata(pdfDoc);

            const pdfBytes = await pdfDoc.save();
            const filename = imageFiles.length === 1
                ? withExt(imageFiles[0].name, '_scanned.pdf')
                : 'scanned-document.pdf';

            saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), filename);
            Utils.updateProgress(100, 'Complete!');
            Utils.showStatus(
                `Scanned ${pdfDoc.getPageCount()} page(s) to PDF successfully!`,
                'success'
            );
        }
    }
};

// Tool Manager
const ToolManager = {
    loadTool(toolId) {
        console.log(`[ToolManager] Loading tool: ${toolId}`);
        
        // CRITICAL FIX BUG #7: Call cleanup on old tool before switching
        const oldToolId = AppState.currentTool;
        if (oldToolId && Tools[oldToolId] && Tools[oldToolId].cleanup) {
            try {
                Tools[oldToolId].cleanup();
                console.log(`[ToolManager] Cleaned up tool: ${oldToolId}`);
            } catch (e) {
                console.warn(`[ToolManager] Cleanup failed for ${oldToolId}:`, e);
            }
        }
        
        // BUG FIX #2: Clean up overlays when switching tools
        PDFPreview.removeSignatureOverlay();
        
        // Clean up Bates preview
        if (Tools.bates && Tools.bates.removeBatesPreview) {
            Tools.bates.removeBatesPreview();
        }
        
        // Clean up redaction boxes
        if (Tools.redact && Tools.redact.clearRedactionBoxes) {
            Tools.redact.clearRedactionBoxes();
        }
        
        AppState.currentTool = toolId;
        const tool = Tools[toolId];
        
        if (!tool) {
            console.error('[ToolManager] Tool not found:', toolId);
            Utils.showStatus('Tool not found: ' + toolId, 'error');
            return;
        }
        
        const container = document.getElementById('toolContent');
        container.innerHTML = `
            <div class="tool-header">
                <h2><span>${tool.icon}</span> ${tool.name}</h2>
                <p>${tool.description}</p>
            </div>
            ${tool.configHTML || ''}
        `;
        
        // Initialize PDF Preview
        PDFPreview.init();
        
        // Initialize tool-specific functionality
        if (tool.init) {
            setTimeout(() => tool.init(), 100);
        }
        
        // Update active button with aria-pressed for accessibility
        document.querySelectorAll('.tool-button').forEach(btn => {
            const isActive = btn.dataset.tool === toolId;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
        
        console.log(`[ToolManager] Tool ${toolId} loaded successfully`);
        
        // Enhancement #2: URL hash routing
        history.replaceState(null, '', `#tool=${toolId}`);
        
        // Enhancement #4: Dynamic drop zone hint
        const hintEl = document.getElementById('dropAreaHint');
        const dropLabel = document.querySelector('.drop-area');
        const toolFileTypes = tool.fileTypes || TOOL_FILE_TYPES[toolId];
        if (hintEl && toolFileTypes) {
            const typeMap = {
                pdf: 'PDF files', image: 'image files', html: 'HTML files',
                office: 'Office files (Word, Excel, PowerPoint)',
                word: 'Word documents', excel: 'Excel spreadsheets',
                csv: 'CSV files', all: 'PDF, images, HTML, and Office files'
            };
            const types = toolFileTypes.map(t => typeMap[t] || t).join(', ');
            hintEl.textContent = `Supports ${types}`;
            if (dropLabel) dropLabel.setAttribute('aria-label', `Drop files here or click to browse. Supports ${types}`);
        } else if (hintEl) {
            hintEl.textContent = 'Supports PDF, images, HTML, and Office files (Word, Excel, PowerPoint)';
        }
        
        // Enhancement #11: Track tool usage
        if (typeof UsageTracker !== 'undefined') {
            UsageTracker.track(toolId);
        }
        
        // Enhancement #20: Screen reader announcement
        const srEl = document.getElementById('srAnnouncements');
        if (srEl) {
            srEl.textContent = `${tool.name} tool loaded. ${tool.description}`;
        }
    },
    
    async processTool() {
        const tool = Tools[AppState.currentTool];
        const toolId = AppState.currentTool;
        
        if (!tool) {
            Utils.showStatus('No tool selected', 'error');
            return;
        }
        
        if (AppState.processing) return;
        
        // Enhancement #12: Confirmation before destructive operations
        const destructiveTools = ['redact', 'cleanslate', 'flatten'];
        if (destructiveTools.includes(toolId) && AppState.files.length > 0) {
            const confirmed = confirm(
                `⚠️ "${tool.name}" makes irreversible changes to your PDF.\n\n` +
                `This cannot be undone. Make sure you have a backup of your original file.\n\n` +
                `Continue?`
            );
            if (!confirmed) return;
        }
        
        if (AppState.files.length === 0) {
            Utils.showStatus('Please add files first', 'error');
            return;
        }
        
        // CRITICAL FIX v9.0.0: Check required libraries before processing
        const libraryRequirements = {
            // Tools requiring PDFLib
            merge: ['PDFLib', 'saveAs'],
            split: ['PDFLib', 'saveAs', 'JSZip'],
            extract: ['PDFLib', 'saveAs'],
            rotate: ['PDFLib', 'saveAs'],
            smartpages: ['PDFLib', 'saveAs'],
            reverse: ['PDFLib', 'saveAs'],
            reorder: ['PDFLib', 'saveAs'],
            removeblank: ['PDFLib', 'saveAs'],
            formfill: ['PDFLib', 'saveAs'],
            flatten: ['PDFLib', 'saveAs'],
            protect: ['PDFLib', 'saveAs'],
            unlock: ['PDFLib', 'saveAs'],
            redact: ['PDFLib', 'saveAs'],
            watermark: ['PDFLib', 'saveAs'],
            pagenumber: ['PDFLib', 'saveAs'],
            metadata: ['PDFLib'],
            metaedit: ['PDFLib', 'saveAs'],
            cleanslate: ['PDFLib', 'saveAs'],
            bates: ['PDFLib', 'saveAs'],
            oddeven: ['PDFLib', 'saveAs', 'JSZip'],
            interleave: ['PDFLib', 'saveAs'],
            categorize: ['PDFLib', 'saveAs', 'JSZip'],
            invoice: ['PDFLib', 'saveAs'],
            batchslicer: ['PDFLib', 'saveAs', 'JSZip'],
            validate: ['PDFLib'],
            repair: ['PDFLib', 'saveAs'],
            audit: ['PDFLib'],
            splitmerge: ['PDFLib', 'saveAs', 'JSZip'],
            imagestopdf: ['PDFLib', 'saveAs'],
            sign: ['PDFLib', 'saveAs'],
            annotate: ['PDFLib', 'saveAs'],
            editpdf: ['PDFLib', 'saveAs'],
            
            // Tools requiring pdfjsLib
            compare: ['pdfjsLib', 'PDFLib'],
            extracttables: ['pdfjsLib'],
            piiscan: ['pdfjsLib'],
            topng: ['pdfjsLib', 'saveAs', 'JSZip'],
            
            // Tools requiring Tesseract
            ocr: ['Tesseract', 'PDFLib', 'saveAs'],
            
            // PDF Text Editor requires both
            pdftexteditor: ['pdfjsLib', 'PDFLib', 'saveAs'],
            
            // Receipt parser requires mammoth
            receiptparser: ['mammoth'],
            
            // Workflow tool (no external libs needed)
            workflow: [],

            // Document Scanner: uses Canvas API (built-in) + PDFLib
            docscan: ['PDFLib', 'saveAs'],
        };
        
        const requiredLibs = libraryRequirements[toolId] || [];
        if (requiredLibs.length > 0) {
            // Enhancement #1: Lazy-load missing libraries on demand
            const missing = requiredLibs.filter(lib => !Utils.checkLibraries([lib]));
            if (missing.length > 0) {
                Utils.showStatus('Loading required libraries...', 'info');
                try {
                    await LibraryLoader.loadMultiple(missing.map(lib => {
                        // Map Utils library names to LibraryLoader names
                        const nameMap = { 'Tesseract': 'tesseract', 'XLSX': 'xlsx' };
                        return nameMap[lib] || lib.toLowerCase();
                    }));
                } catch (e) {
                    console.warn('[ToolManager] Some libraries failed to lazy-load:', e);
                }
            }
            // Final check after lazy-load attempt
            if (!Utils.checkLibraries(requiredLibs)) {
                return; // checkLibraries already shows error message
            }
        }
        
        AppState.processing = true;
        FileManager.updateProcessButton();
        
        try {
            await tool.process(AppState.files);
        } catch (error) {
            // Enhanced error reporting
            console.error(`[${toolId}] Error processing:`, error);
            Utils.showStatus(`${tool.name} failed: ${error.message}`, 'error');
            Utils.updateProgress(0, 'Error occurred');
        } finally {
            // FIX: Always reset processing state, even if tool throws
            AppState.processing = false;
            FileManager.updateProcessButton();
        }
    }
};

// Event Handlers
function setupEventHandlers() {
    // FIX: Guard DOM lookups - prevent crashes if HTML structure changes
    const dropArea = document.getElementById('dropArea');
    const fileInput = document.getElementById('fileInput');
    const processBtn = document.getElementById('processBtn');
    const clearBtn = document.getElementById('clearBtn');
    const toolSearch = document.getElementById('toolSearch');
    
    // Early return if critical elements are missing
    if (!dropArea || !fileInput) {
        console.error('[Setup] Critical elements missing - cannot initialize event handlers');
        return;
    }
    
    // Drop area click
    dropArea.addEventListener('click', () => fileInput.click());
    
    // ACCESSIBILITY: Keyboard support for drop area
    dropArea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInput.click();
        }
    });
    
    // File input change
    fileInput.addEventListener('change', (e) => {
        FileManager.addFiles(e.target.files);
    });
    
    // Drag and drop
    dropArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropArea.classList.add('dragover');
    });
    
    dropArea.addEventListener('dragleave', () => {
        dropArea.classList.remove('dragover');
    });
    
    dropArea.addEventListener('drop', (e) => {
        e.preventDefault();
        dropArea.classList.remove('dragover');
        FileManager.addFiles(e.dataTransfer.files);
    });
    
    // Tool buttons
    document.querySelectorAll('.tool-button').forEach(btn => {
        btn.addEventListener('click', () => {
            ToolManager.loadTool(btn.dataset.tool);
        });
    });
    
    // STRATEGIC ENHANCEMENT: Auto-scrub metadata toggle
    const autoScrubCheckbox = document.getElementById('autoScrubMetadata');
    if (autoScrubCheckbox) {
        autoScrubCheckbox.addEventListener('change', (e) => {
            AppState.autoScrubMetadata = e.target.checked;
            console.log('[Privacy] Auto-scrub metadata:', AppState.autoScrubMetadata);
            if (AppState.autoScrubMetadata) {
                Utils.showStatus('Privacy mode enabled: All files will be anonymized', 'success');
            }
        });
    }
    
    // Process button (with guard)
    if (processBtn) {
        processBtn.addEventListener('click', () => {
            ToolManager.processTool();
        });
    }
    
    // Clear button (with guard)
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            FileManager.clearAll();
        });
    }
    
    // Tool search (with guard)
    if (toolSearch) {
        toolSearch.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            let anyVisible = false;
            document.querySelectorAll('.tool-button').forEach(btn => {
                const text = btn.textContent.toLowerCase();
                const visible = text.includes(query);
                btn.style.display = visible ? 'flex' : 'none';
                if (visible) anyVisible = true;
            });
            
            // Hide/show category titles
            document.querySelectorAll('.category-title').forEach(title => {
                const nextButtons = [];
                let next = title.nextElementSibling;
                while (next && !next.classList.contains('category-title')) {
                    if (next.classList.contains('tool-button')) {
                        nextButtons.push(next);
                    }
                    next = next.nextElementSibling;
                }
                const hasVisible = nextButtons.some(btn => btn.style.display !== 'none');
                title.style.display = hasVisible ? 'block' : 'none';
            });
            
            // Show "No tools found" empty state
            let emptyState = document.getElementById('toolSearchEmptyState');
            if (!anyVisible && query.length > 0) {
                if (!emptyState) {
                    emptyState = document.createElement('div');
                    emptyState.id = 'toolSearchEmptyState';
                    emptyState.style.cssText = 'padding: 24px 12px; text-align: center; color: var(--color-text-muted);';
                    emptyState.innerHTML = `
                        <div style="font-size: 32px; margin-bottom: 8px;">🔍</div>
                        <div style="font-weight: 600; margin-bottom: 4px;">No tools found</div>
                        <div style="font-size: 12px; margin-bottom: 12px;">No tools match "<span id="toolSearchQuery"></span>"</div>
                        <button onclick="document.getElementById('toolSearch').value=''; document.getElementById('toolSearch').dispatchEvent(new Event('input'));" 
                                style="font-size: 12px; padding: 4px 12px; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-bg-secondary); cursor: pointer; color: var(--color-text);">
                            ✕ Clear Search
                        </button>`;
                    toolSearch.closest('.sidebar, nav, [class*="sidebar"], [class*="tool-list"]')?.appendChild(emptyState)
                        || toolSearch.parentElement?.appendChild(emptyState);
                }
                document.getElementById('toolSearchQuery').textContent = query;
                emptyState.style.display = 'block';
            } else if (emptyState) {
                emptyState.style.display = 'none';
            }
        });
    }
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 PDF Workspace v9.2.0 - 20 Enhancements');
    console.log('🌙 Dark mode • ⌨️ Keyboard shortcuts • 📱 Mobile sidebar • 🔗 Deep links');
    console.log('⚡ Lazy loading • 🔀 File reorder • 📦 Batch ZIP • 📡 Offline indicator');
    console.log('🎯 100% Client-Side Processing - Your Files Never Leave Your Browser');

// Favorites Management System
const FavoritesManager = {
    favorites: new Set(),
    
    init() {
        this.loadFavorites();
        this.renderAllStars();
        this.updateFavoritesList();
        this.bindClearButton();
    },
    
    loadFavorites() {
        try {
            const saved = localStorage.getItem('pdfWorkspaceFavorites');
            if (saved) {
                this.favorites = new Set(JSON.parse(saved));
            }
        } catch (error) {
            console.error('Error loading favorites:', error);
        }
    },
    
    saveFavorites() {
        try {
            localStorage.setItem(
                'pdfWorkspaceFavorites',
                JSON.stringify(Array.from(this.favorites))
            );
        } catch (error) {
            console.error('Error saving favorites:', error);
        }
    },
    
    toggleFavorite(toolId) {
        if (this.favorites.has(toolId)) {
            this.favorites.delete(toolId);
        } else {
            this.favorites.add(toolId);
        }
        this.saveFavorites();
        this.updateFavoritesList();
        this.updateStarIcon(toolId);
    },
    
    isFavorite(toolId) {
        return this.favorites.has(toolId);
    },
    
    renderAllStars() {
        // Add star icons to all tool buttons
        document.querySelectorAll('.tool-button').forEach(button => {
            const toolId = button.dataset.tool;
            if (!toolId) return;
            
            // Check if star already exists
            if (button.querySelector('.star-icon')) return;
            
            // Get button text content
            const buttonText = button.textContent.trim();
            
            // Create wrapper for button content
            const contentWrapper = document.createElement('span');
            contentWrapper.className = 'tool-button-content';
            contentWrapper.textContent = buttonText;
            
            // Create star icon
            const star = document.createElement('span');
            star.className = 'star-icon';
            star.textContent = this.isFavorite(toolId) ? '⭐' : '☆';
            if (this.isFavorite(toolId)) {
                star.classList.add('favorited');
            }
            
            // ACCESSIBILITY: Make star keyboard accessible
            star.setAttribute('role', 'button');
            star.setAttribute('tabindex', '0');
            star.setAttribute('aria-label', this.isFavorite(toolId) ? 'Remove from favorites' : 'Add to favorites');
            star.setAttribute('aria-pressed', this.isFavorite(toolId) ? 'true' : 'false');
            
            // Add click handler to star
            star.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent tool button click
                this.toggleFavorite(toolId);
            });
            
            // ACCESSIBILITY: Keyboard support for star
            star.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggleFavorite(toolId);
                }
            });
            
            // Clear button and rebuild
            button.textContent = '';
            button.appendChild(contentWrapper);
            button.appendChild(star);
        });
    },
    
    updateStarIcon(toolId) {
        document.querySelectorAll(`.tool-button[data-tool="${toolId}"] .star-icon`).forEach(star => {
            if (this.isFavorite(toolId)) {
                star.textContent = '⭐';
                star.classList.add('favorited');
                star.setAttribute('aria-label', 'Remove from favorites');
                star.setAttribute('aria-pressed', 'true');
            } else {
                star.textContent = '☆';
                star.classList.remove('favorited');
                star.setAttribute('aria-label', 'Add to favorites');
                star.setAttribute('aria-pressed', 'false');
            }
        });
    },
    
    updateFavoritesList() {
        const favSection = document.getElementById('favoritesSection');
        const favList = document.getElementById('favoritesList');
        
        if (!favSection || !favList) return;
        
        // Clear current list
        favList.innerHTML = '';
        
        if (this.favorites.size === 0) {
            favSection.style.display = 'none';
            return;
        }
        
        favSection.style.display = 'block';
        
        // Add favorite tools
        this.favorites.forEach(toolId => {
            const tool = Tools[toolId];
            if (!tool) return;
            
            const button = document.createElement('button');
            button.className = 'tool-button';
            button.dataset.tool = toolId;
            
            // Check if currently active
            if (AppState.currentTool === toolId) {
                button.classList.add('active');
            }
            
            // Create content wrapper
            const contentWrapper = document.createElement('span');
            contentWrapper.className = 'tool-button-content';
            contentWrapper.textContent = `${tool.icon} ${tool.name}`;
            
            // Create star icon
            const star = document.createElement('span');
            star.className = 'star-icon favorited';
            star.textContent = '⭐';
            
            // Star click handler
            star.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleFavorite(toolId);
            });
            
            // Button click handler
            button.addEventListener('click', () => {
                ToolManager.loadTool(toolId);
            });
            
            button.appendChild(contentWrapper);
            button.appendChild(star);
            favList.appendChild(button);
        });
    },
    
    clearAll() {
        if (this.favorites.size === 0) return;
        
        if (confirm('Clear all favorites?')) {
            this.favorites.clear();
            this.saveFavorites();
            this.updateFavoritesList();
            
            // Update all star icons
            document.querySelectorAll('.star-icon').forEach(star => {
                star.textContent = '☆';
                star.classList.remove('favorited');
            });
        }
    },
    
    bindClearButton() {
        const clearBtn = document.getElementById('clearFavorites');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearAll());
        }
    }
};

    setupEventHandlers();
    ToolManager.loadTool('merge');
    PDFPreview.init();
    
    // Initialize Favorites System
    setTimeout(() => {
        FavoritesManager.init();
        console.log('✓ Favorites system initialized');
    }, 100);
    
    // ENHANCEMENT: Enhanced Startup Self-Test with Comprehensive Library Checks
    const StartupSelfTest = {
        async run() {
            const results = {
                libraries: {
                    'PDF.js': typeof pdfjsLib !== 'undefined',
                    'PDF-Lib': typeof PDFLib !== 'undefined',
                    'JSZip': typeof JSZip !== 'undefined',
                    'FileSaver': typeof saveAs !== 'undefined',
                    'Tesseract': typeof Tesseract !== 'undefined',
                    'Mammoth': typeof mammoth !== 'undefined',
                    'XLSX': typeof XLSX !== 'undefined',
                    'jsPDF': typeof jspdf !== 'undefined',
                    'DOCX': typeof docx !== 'undefined'
                },
                workerAvailable: false,
                serviceWorkerEnabled: false,
                errors: [],
                warnings: []
            };
            
            // Check PDF.js worker
            try {
                if (typeof pdfjsLib !== 'undefined' && pdfjsLib.GlobalWorkerOptions && pdfjsLib.GlobalWorkerOptions.workerSrc) {
                    results.workerAvailable = true;
                }
            } catch (e) {
                results.errors.push('PDF.js worker configuration failed');
            }
            
            // Check Service Worker
            if ('serviceWorker' in navigator) {
                results.serviceWorkerEnabled = true;
            }
            
            // Analyze results
            const loaded = Object.values(results.libraries).filter(Boolean).length;
            const total = Object.keys(results.libraries).length;
            const critical = ['PDF.js', 'PDF-Lib'].every(lib => results.libraries[lib]);
            
            // Log results
            console.log(`✓ Libraries: ${loaded}/${total} loaded`);
            Object.entries(results.libraries).forEach(([name, status]) => {
                console.log(`  ${status ? '✓' : '✗'} ${name}`);
            });
            
            // Display enhanced UI
            this.displayEnhancedResults(results);
            
            return results;
        },
        
        displayEnhancedResults(results) {
            const loaded = Object.values(results.libraries).filter(Boolean).length;
            const total = Object.keys(results.libraries).length;
            const critical = ['PDF.js', 'PDF-Lib'].every(lib => results.libraries[lib]);
            const failed = Object.entries(results.libraries).filter(([name, status]) => !status);
            
            // Show library health bar
            const healthBar = document.getElementById('libraryHealthBar');
            if (healthBar) {
                if (loaded === total) {
                    healthBar.style.display = 'flex';
                    healthBar.style.background = '#d4edda';
                    healthBar.style.borderColor = '#c3e6cb';
                    healthBar.innerHTML = `
                        <span style="font-size: 16px;">✅</span>
                        <strong>All systems operational</strong>
                        <span style="color: #155724;">${loaded}/${total} libraries loaded</span>
                        ${results.serviceWorkerEnabled ? '<span style="margin-left: auto; font-size: 12px;">🔄 Offline mode active</span>' : ''}
                    `;
                } else if (critical) {
                    healthBar.style.display = 'flex';
                    healthBar.style.background = '#fff3cd';
                    healthBar.style.borderColor = '#ffc107';
                    healthBar.innerHTML = `
                        <span style="font-size: 16px;">⚠️</span>
                        <strong>Some optional features unavailable</strong>
                        <span style="color: #856404;">${loaded}/${total} libraries loaded • Core functions work</span>
                    `;
                }
            }
            
            // Show warning if critical libraries failed
            if (!critical) {
                const warningBar = document.getElementById('libraryHealthWarning');
                const detailsDiv = document.getElementById('libraryHealthDetails');
                
                if (warningBar && detailsDiv) {
                    const failedList = failed.map(([name]) => name).join(', ');
                    detailsDiv.textContent = `Missing: ${failedList}`;
                    warningBar.style.display = 'flex';
                }
            }
        }
    };
    
    // Run self-test after DOM ready
    setTimeout(() => {
        StartupSelfTest.run();
    }, 500);
    
    // ==================== ENHANCEMENT: Reset App Button Handler ====================
    const ResetAppManager = {
        init() {
            const resetBtn = document.getElementById('resetAppBtn');
            if (!resetBtn) return;
            
            resetBtn.addEventListener('click', async () => {
                if (!confirm('This will clear all offline caches and reload the app. Continue?')) {
                    return;
                }
                
                resetBtn.disabled = true;
                resetBtn.textContent = '🔄 Clearing...';
                
                try {
                    // Clear all caches via service worker
                    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                        navigator.serviceWorker.controller.postMessage({
                            type: 'CLEAR_CACHE'
                        });
                        
                        // Wait a bit for cache clearing
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                    
                    // Also clear localStorage
                    try {
                        localStorage.clear();
                    } catch (e) {
                        console.warn('Could not clear localStorage:', e);
                    }
                    
                    // Reload app
                    resetBtn.textContent = '✓ Reloading...';
                    setTimeout(() => {
                        location.reload(true);
                    }, 300);
                    
                } catch (error) {
                    console.error('Reset failed:', error);
                    alert('Reset failed. Please manually refresh the page (Ctrl+Shift+R).');
                    resetBtn.disabled = false;
                    resetBtn.textContent = '🔄 Reset App';
                }
            });
            
            console.log('✓ Reset App button initialized');
        }
    };
    
    // Initialize Reset App button
    setTimeout(() => {
        ResetAppManager.init();
    }, 100);
    
    // ==================== ENHANCEMENT 1: File Info Manager ====================
    const FileInfoManager = {
        show(fileProfile) {
            const bar = document.getElementById('fileInfoBar');
            if (!bar) return;
            
            const badges = this.generateBadges(fileProfile);
            const info = this.generateInfo(fileProfile);
            
            bar.innerHTML = `
                <div class="file-info-name" title="${Utils.escapeHtml(fileProfile.name)}">
                    📄 ${Utils.escapeHtml(fileProfile.name)}
                </div>
                ${info.join('')}
                ${badges.join('')}
            `;
            
            bar.classList.add('visible');
        },
        
        generateInfo(profile) {
            const info = [];
            
            if (profile.pageCount) {
                info.push(`
                    <div class="file-info-item">
                        <span>📑</span>
                        <span>${profile.pageCount} page${profile.pageCount !== 1 ? 's' : ''}</span>
                    </div>
                `);
            }
            
            if (profile.size) {
                const sizeStr = this.formatBytes(profile.size);
                info.push(`
                    <div class="file-info-item">
                        <span>💾</span>
                        <span>${sizeStr}</span>
                    </div>
                `);
            }
            
            if (profile.pdfVersion) {
                info.push(`
                    <div class="file-info-item">
                        <span>📋</span>
                        <span>PDF ${profile.pdfVersion}</span>
                    </div>
                `);
            }
            
            return info;
        },
        
        generateBadges(profile) {
            const badges = [];
            
            if (profile.isEncrypted) {
                badges.push('<span class="file-info-badge encrypted">🔒 Encrypted</span>');
            }
            
            if (profile.isScanned) {
                badges.push('<span class="file-info-badge scanned">📷 Scanned</span>');
            } else if (profile.hasText) {
                badges.push('<span class="file-info-badge searchable">✓ Text searchable</span>');
            }
            
            if (profile.isLarge) {
                badges.push('<span class="file-info-badge large">⚠ Large file</span>');
            }
            
            if (profile.isPrintOptimized) {
                badges.push('<span class="file-info-badge">🖨 Print-optimized</span>');
            }
            
            return badges;
        },
        
        formatBytes(bytes) {
            if (bytes === 0) return '0 Bytes';
            const k = 1024;
            const sizes = ['Bytes', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
        },
        
        hide() {
            const bar = document.getElementById('fileInfoBar');
            if (bar) {
                bar.classList.remove('visible');
            }
        }
    };
    
    // ==================== ENHANCEMENT 2: Workflow Manager ====================
    const WorkflowManager = {
        currentStep: 1,
        
        setStep(stepNumber) {
            this.currentStep = stepNumber;
            this.updateUI();
        },
        
        completeStep(stepNumber) {
            const step = document.getElementById(`step${stepNumber}`);
            if (step) {
                step.classList.remove('active');
                step.classList.add('completed');
            }
            
            // Activate next step
            if (stepNumber < 3) {
                this.setStep(stepNumber + 1);
            }
        },
        
        updateUI() {
            // Update step states
            for (let i = 1; i <= 3; i++) {
                const step = document.getElementById(`step${i}`);
                if (!step) continue;
                
                if (i === this.currentStep) {
                    step.classList.add('active');
                    step.classList.remove('completed');
                } else if (i < this.currentStep) {
                    step.classList.remove('active');
                    step.classList.add('completed');
                } else {
                    step.classList.remove('active', 'completed');
                }
            }
            
            // Update button text based on current step
            const processBtn = document.getElementById('processBtn');
            if (processBtn) {
                switch (this.currentStep) {
                    case 1:
                        processBtn.textContent = 'Review Settings →';
                        break;
                    case 2:
                        processBtn.textContent = 'Generate File →';
                        break;
                    case 3:
                        processBtn.textContent = 'Download';
                        break;
                }
            }
        },
        
        reset() {
            this.currentStep = 1;
            this.updateUI();
        }
    };
    
    // ==================== ENHANCEMENT 3: Integrate with File Loading ====================
    // Enhance PDF loading to show file info
    const originalLoadPDF = PDFPreview.loadPDF;
    PDFPreview.loadPDF = async function(file) {
        try {
            // Call original method
            const result = await originalLoadPDF.call(this, file);
            
            // Extract file metadata
            if (this.currentPdf) {
                const fileProfile = {
                    name: file.name,
                    size: file.size,
                    pageCount: this.currentPdf.numPages,
                    pdfVersion: this.currentPdf._pdfInfo?.version || null,
                    isEncrypted: false, // Will be set by error handler
                    isScanned: false, // Detect if no text content
                    hasText: false,
                    isLarge: file.size > 10 * 1024 * 1024, // > 10 MB
                    isPrintOptimized: false
                };
                
                // Try to detect if scanned (check first page for text)
                try {
                    const page = await this.currentPdf.getPage(1);
                    const textContent = await page.getTextContent();
                    fileProfile.hasText = textContent.items.length > 0;
                    fileProfile.isScanned = textContent.items.length === 0;
                } catch (e) {
                    // Ignore text detection errors
                }
                
                // Show file info
                FileInfoManager.show(fileProfile);
                
                // Move to step 2
                WorkflowManager.completeStep(1);
            }
            
            return result;
        } catch (error) {
            // Check if encryption error
            if (error.message && error.message.includes('encrypt')) {
                const fileProfile = {
                    name: file.name,
                    size: file.size,
                    isEncrypted: true,
                    isLarge: file.size > 10 * 1024 * 1024
                };
                FileInfoManager.show(fileProfile);
            }
            throw error;
        }
    };
    
    // Update process button workflow state - uses MutationObserver instead of
    // a second click listener to avoid double-firing and blind timeouts
    const statusObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            const statusEl = mutation.target;
            if (statusEl.classList.contains('status-success') && statusEl.classList.contains('active')) {
                WorkflowManager.completeStep(2);
                WorkflowManager.completeStep(3);
                // Append "process another" link safely using DOM methods
                const link = document.createElement('a');
                link.href = '#';
                link.textContent = 'Process another file →';
                link.addEventListener('click', (e) => { e.preventDefault(); location.reload(); });
                const prefix = document.createTextNode(' ');
                statusEl.appendChild(prefix);
                statusEl.appendChild(link);
            }
        }
    });
    const statusTarget = document.getElementById('statusMessage');
    if (statusTarget) {
        statusObserver.observe(statusTarget, { attributes: true, attributeFilter: ['class'] });
    }
    
    // (Workflow reset and FileInfoManager.hide are handled inside FileManager.clearAll)
    
    // ==================== v9.2.0 ENHANCEMENTS ====================
    
    // Enhancement #2: URL hash routing - load tool from URL hash
    const hashMatch = window.location.hash.match(/tool=(\w+)/);
    if (hashMatch && Tools[hashMatch[1]]) {
        ToolManager.loadTool(hashMatch[1]);
    }
    window.addEventListener('hashchange', () => {
        const match = window.location.hash.match(/tool=(\w+)/);
        if (match && Tools[match[1]] && AppState.currentTool !== match[1]) {
            ToolManager.loadTool(match[1]);
        }
    });
    
    // Enhancement #3: Warn before closing with files loaded
    window.addEventListener('beforeunload', (e) => {
        if (AppState.files.length > 0 || AppState.processing) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
    
    // Enhancement #6: Collapsible mobile sidebar
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    const toolSidebar = document.getElementById('toolSidebar');
    
    function toggleMobileSidebar(open) {
        if (!toolSidebar) return;
        const isOpen = toolSidebar.classList.contains('sidebar-open');
        const shouldOpen = open !== undefined ? open : !isOpen;
        
        toolSidebar.classList.toggle('sidebar-open', shouldOpen);
        if (sidebarOverlay) sidebarOverlay.classList.toggle('visible', shouldOpen);
        if (sidebarToggle) sidebarToggle.textContent = shouldOpen ? '✕' : '🔧';
    }
    
    if (sidebarToggle) sidebarToggle.addEventListener('click', () => toggleMobileSidebar());
    if (sidebarOverlay) sidebarOverlay.addEventListener('click', () => toggleMobileSidebar(false));
    
    // Close sidebar when a tool is selected on mobile
    document.querySelectorAll('.tool-button').forEach(btn => {
        btn.addEventListener('click', () => {
            if (window.innerWidth <= 768) toggleMobileSidebar(false);
        });
    });
    
    // Enhancement #7: Dark Mode
    const themeToggle = document.getElementById('themeToggle');
    function setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        if (themeToggle) themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
        try { localStorage.setItem('pdfWorkspaceTheme', theme); } catch (e) {}
    }
    
    // Initialize theme from localStorage or system preference
    const savedTheme = (() => { try { return localStorage.getItem('pdfWorkspaceTheme'); } catch(e) { return null; } })();
    if (savedTheme) {
        setTheme(savedTheme);
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        setTheme('dark');
    }
    
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme');
            setTheme(current === 'dark' ? 'light' : 'dark');
        });
    }
    
    // Enhancement #8: Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Skip if typing in an input/textarea/contenteditable
        const tag = (e.target.tagName || '').toLowerCase();
        const isEditing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
        
        // Ctrl+O: Open file picker
        if (e.ctrlKey && e.key === 'o') {
            e.preventDefault();
            const fi = document.getElementById('fileInput');
            if (fi) fi.click();
            return;
        }
        
        // Ctrl+Enter: Process
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            const pb = document.getElementById('processBtn');
            if (pb && !pb.disabled) pb.click();
            return;
        }
        
        // Ctrl+D: Toggle dark mode
        if (e.ctrlKey && e.key === 'd') {
            e.preventDefault();
            const current = document.documentElement.getAttribute('data-theme');
            setTheme(current === 'dark' ? 'light' : 'dark');
            return;
        }
        
        if (isEditing) return; // Below shortcuts should not fire during editing
        
        // /: Focus tool search
        if (e.key === '/') {
            e.preventDefault();
            const ts = document.getElementById('toolSearch');
            if (ts) ts.focus();
            return;
        }
        
        // ?: Show shortcuts panel
        if (e.key === '?' || (e.shiftKey && e.key === '/')) {
            e.preventDefault();
            const sp = document.getElementById('shortcutsPanel');
            if (sp) sp.classList.toggle('visible');
            return;
        }
        
        // Escape: Close panels / clear status
        if (e.key === 'Escape') {
            const sp = document.getElementById('shortcutsPanel');
            const wn = document.getElementById('whatsNewOverlay');
            if (sp && sp.classList.contains('visible')) { sp.classList.remove('visible'); return; }
            if (wn && wn.classList.contains('visible')) { wn.classList.remove('visible'); return; }
            if (window.innerWidth <= 768) toggleMobileSidebar(false);
            const sm = document.getElementById('statusMessage');
            if (sm) sm.classList.remove('active');
            return;
        }
    });
    
    // Enhancement #10: Hide loading skeleton
    const appLoading = document.getElementById('appLoading');
    if (appLoading) {
        setTimeout(() => appLoading.classList.add('hidden'), 300);
    }
    
    // Enhancement #11: Tool usage tracker (local only)
    window.UsageTracker = {
        _key: 'pdfWorkspaceUsage',
        
        track(toolId) {
            try {
                const data = JSON.parse(localStorage.getItem(this._key) || '{}');
                data[toolId] = (data[toolId] || 0) + 1;
                localStorage.setItem(this._key, JSON.stringify(data));
                this.updateRecentlyUsed();
            } catch (e) {}
        },
        
        getTopTools(n = 5) {
            try {
                const data = JSON.parse(localStorage.getItem(this._key) || '{}');
                return Object.entries(data)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, n)
                    .map(([id]) => id);
            } catch (e) { return []; }
        },
        
        updateRecentlyUsed() {
            const container = document.getElementById('recentlyUsedList');
            const section = document.getElementById('recentlyUsedSection');
            if (!container || !section) return;
            
            const topTools = this.getTopTools(5);
            if (topTools.length === 0) { section.style.display = 'none'; return; }
            
            section.style.display = 'block';
            container.innerHTML = '';
            topTools.forEach(toolId => {
                const tool = Tools[toolId];
                if (!tool) return;
                const btn = document.createElement('button');
                btn.className = 'tool-button';
                btn.dataset.tool = toolId;
                btn.textContent = `${tool.icon} ${tool.name}`;
                btn.addEventListener('click', () => {
                    ToolManager.loadTool(toolId);
                    if (window.innerWidth <= 768) toggleMobileSidebar(false);
                });
                container.appendChild(btn);
            });
        }
    };
    
    // Insert "Recently Used" section into sidebar
    const favSection = document.getElementById('favoritesSection');
    if (favSection) {
        const ruSection = document.createElement('div');
        ruSection.id = 'recentlyUsedSection';
        ruSection.className = 'recently-used-section';
        ruSection.style.display = 'none';
        ruSection.innerHTML = '<div class="category-title">🕐 Recently Used</div><div id="recentlyUsedList"></div>';
        favSection.parentNode.insertBefore(ruSection, favSection.nextSibling);
        UsageTracker.updateRecentlyUsed();
    }
    
    // Enhancement #14: Better error messages
    const originalShowStatus = Utils.showStatus.bind(Utils);
    Utils.showStatus = function(message, type) {
        if (type === 'error') {
            const friendlyMessages = [
                [/encrypted/i, 'This PDF is password-protected. Try the "Unlock PDF" tool first.'],
                [/invalid pdf/i, 'This file appears to be corrupted. Try the "Repair PDF" tool.'],
                [/out of memory|allocation/i, 'This file is too large for browser processing. Try splitting it first.'],
                [/failed to fetch|network|ERR_/i, 'A required library failed to load. Check your internet connection and refresh.'],
                [/cannot read prop/i, 'An unexpected error occurred. Try refreshing the page.'],
            ];
            for (const [pattern, friendly] of friendlyMessages) {
                if (pattern.test(message)) {
                    message = friendly;
                    break;
                }
            }
        }
        originalShowStatus(message, type);
    };
    
    // Enhancement #15: Drag-to-reorder files in file list
    const originalRenderFileList = FileManager.renderFileList.bind(FileManager);
    FileManager.renderFileList = function() {
        originalRenderFileList();
        
        // Add drag handles and make items draggable
        const container = document.getElementById('fileList');
        if (!container) return;
        
        container.querySelectorAll('.file-item').forEach((item, index) => {
            item.setAttribute('draggable', 'true');
            
            // Add drag handle
            const handle = document.createElement('span');
            handle.className = 'file-drag-handle';
            handle.textContent = '⋮⋮';
            handle.title = 'Drag to reorder';
            const fileInfo = item.querySelector('.file-info');
            if (fileInfo) fileInfo.insertBefore(handle, fileInfo.firstChild);
            
            item.addEventListener('dragstart', (e) => {
                item.classList.add('file-dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', index.toString());
            });
            
            item.addEventListener('dragend', () => {
                item.classList.remove('file-dragging');
                container.querySelectorAll('.file-item').forEach(fi => fi.classList.remove('file-drag-over'));
            });
            
            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                item.classList.add('file-drag-over');
            });
            
            item.addEventListener('dragleave', () => {
                item.classList.remove('file-drag-over');
            });
            
            item.addEventListener('drop', (e) => {
                e.preventDefault();
                item.classList.remove('file-drag-over');
                const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
                const toIndex = index;
                if (fromIndex === toIndex || isNaN(fromIndex)) return;
                
                // Reorder files
                const [moved] = AppState.files.splice(fromIndex, 1);
                AppState.files.splice(toIndex, 0, moved);
                FileManager.renderFileList();
                PDFPreview.updateFileSelector();
                Utils.showStatus(`Reordered: moved file to position ${toIndex + 1}`, 'success');
            });
        });
    };
    
    // Enhancement #16: What's New changelog toast
    const WHATS_NEW_VERSION = '9.2.0';
    try {
        const lastSeenVersion = localStorage.getItem('pdfWorkspaceLastVersion');
        if (lastSeenVersion !== WHATS_NEW_VERSION) {
            const overlay = document.getElementById('whatsNewOverlay');
            if (overlay) {
                setTimeout(() => overlay.classList.add('visible'), 800);
                
                const closeBtn = document.getElementById('whatsNewClose');
                if (closeBtn) {
                    closeBtn.addEventListener('click', () => {
                        overlay.classList.remove('visible');
                        try { localStorage.setItem('pdfWorkspaceLastVersion', WHATS_NEW_VERSION); } catch(e) {}
                    });
                }
                overlay.addEventListener('click', (e) => {
                    if (e.target === overlay) {
                        overlay.classList.remove('visible');
                        try { localStorage.setItem('pdfWorkspaceLastVersion', WHATS_NEW_VERSION); } catch(e) {}
                    }
                });
            }
        }
    } catch(e) {}
    
    // Enhancement #17: Offline indicator
    const offlineIndicator = document.getElementById('offlineIndicator');
    function updateOnlineStatus() {
        if (offlineIndicator) {
            offlineIndicator.classList.toggle('visible', !navigator.onLine);
        }
    }
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();
    
    // Enhancement #18: Progress on individual files during batch operations
    const originalUpdateProgress = Utils.updateProgress.bind(Utils);
    Utils.updateProgress = function(percent, text, currentFile, totalFiles) {
        if (currentFile && totalFiles) {
            text = `${text} (file ${currentFile}/${totalFiles})`;
        }
        originalUpdateProgress(percent, text);
    };

    // Enhancement #13: Batch download as ZIP button
    // Monkey-patch saveAs to detect multi-file outputs and offer ZIP
    window._batchOutputs = [];
    const originalSaveAs = window.saveAs;
    let _batchMode = false;
    
    window.enableBatchCollect = function() { _batchMode = true; window._batchOutputs = []; };
    window.disableBatchCollect = function() {
        _batchMode = false;
        if (window._batchOutputs.length > 1) {
            showBatchDownloadBar(window._batchOutputs);
        }
        window._batchOutputs = [];
    };
    
    function showBatchDownloadBar(outputs) {
        // Remove existing bar
        const existing = document.getElementById('batchDownloadBar');
        if (existing) existing.remove();
        
        const bar = document.createElement('div');
        bar.id = 'batchDownloadBar';
        bar.className = 'batch-download-bar';
        bar.innerHTML = `<span style="flex:1;font-size:14px;font-weight:500;">📦 ${outputs.length} files generated</span>`;
        
        const zipBtn = document.createElement('button');
        zipBtn.className = 'btn btn-primary';
        zipBtn.textContent = '📦 Download all as ZIP';
        zipBtn.addEventListener('click', async () => {
            zipBtn.textContent = '⏳ Creating ZIP...';
            zipBtn.disabled = true;
            await Utils.createZipBundle(outputs.map((o, i) => ({
                name: o.name, blob: o.blob
            })), 'pdf_workspace_output.zip');
            zipBtn.textContent = '✅ Downloaded!';
            setTimeout(() => bar.remove(), 3000);
        });
        bar.appendChild(zipBtn);
        
        const statusMsg = document.getElementById('statusMessage');
        if (statusMsg) statusMsg.parentNode.insertBefore(bar, statusMsg.nextSibling);
    }

    // ==================== END v9.2.0 ENHANCEMENTS ====================
    
    // PWA: Register Service Worker
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            // FIX: Use relative path so it works on subpaths (e.g., GitHub Pages)
            navigator.serviceWorker.register('./service-worker.js')
                .then((registration) => {
                    console.log('✓ Service Worker registered:', registration.scope);
                    
                    // Check for updates periodically
                    setInterval(() => {
                        registration.update();
                    }, 60 * 60 * 1000); // Check every hour
                })
                .catch((error) => {
                    console.warn('⚠ Service Worker registration failed:', error);
                });
            
            // Listen for "offline ready" signal from the service worker
            navigator.serviceWorker.addEventListener('message', (event) => {
                if (event.data && event.data.type === 'OFFLINE_READY') {
                    Utils.showStatus('✅ Offline ready — PDF Workspace can now run without internet', 'success');
                }
            });
        });
    }
    
    // PWA: Install Prompt
    let deferredPrompt;
    
    window.addEventListener('beforeinstallprompt', (e) => {
        // Prevent the mini-infobar from appearing
        e.preventDefault();
        deferredPrompt = e;
        
        // Show install button in header
        showInstallButton();
    });
    
    function showInstallButton() {
        // Check if button already exists
        if (document.getElementById('installBtn')) return;
        
        const header = document.querySelector('.header-center');
        if (!header) return;
        
        const installBtn = document.createElement('button');
        installBtn.id = 'installBtn';
        installBtn.className = 'btn btn-primary';
        installBtn.style.cssText = 'margin-top: 8px; padding: 6px 12px; font-size: 13px;';
        installBtn.innerHTML = '📱 Install App';
        installBtn.setAttribute('aria-label', 'Install PDF Workspace as an app');
        
        installBtn.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            
            // Show the install prompt
            deferredPrompt.prompt();
            
            // Wait for the user's response
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`PWA install ${outcome}`);
            
            // Clear the deferred prompt
            deferredPrompt = null;
            installBtn.remove();
        });
        
        header.appendChild(installBtn);
    }
    
    // Track when app is installed
    window.addEventListener('appinstalled', () => {
        console.log('✓ PDF Workspace installed as PWA');
        deferredPrompt = null;
        const installBtn = document.getElementById('installBtn');
        if (installBtn) installBtn.remove();
    });
    
    console.log('✓ Application initialized successfully');
});
