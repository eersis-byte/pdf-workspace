#!/bin/bash
# Generate SRI hashes for PDF Workspace CDN scripts
# Run this script and paste the output integrity attributes into index.html

URLS=(
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
    "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js"
    "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"
    "https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js"
    "https://cdn.jsdelivr.net/npm/tesseract.js@4/dist/tesseract.min.js"
    "https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js"
    "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"
    "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"
    "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js"
    "https://unpkg.com/docx@8.5.0/build/index.js"
)

echo "SRI Hashes for PDF Workspace"
echo "============================"
echo ""

for url in "${URLS[@]}"; do
    HASH=$(curl -s "$url" | openssl dgst -sha384 -binary | openssl base64 -A)
    echo "URL: $url"
    echo "integrity=\"sha384-${HASH}\""
    echo ""
done
