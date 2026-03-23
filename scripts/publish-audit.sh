#!/bin/bash
# Run the audit and publish the report to the site.
# Usage: ./scripts/publish-audit.sh [--zips 98683 10001]
#
# This runs the full audit locally and copies the HTML report
# to public/audit-report.html, which Vercel serves as a static file.

set -e
cd "$(dirname "$0")/../audit"

# Activate venv
source venv/bin/activate

# Run audit (pass through any args)
PYTHONPATH=. python src/main.py --sequential "$@"

# Copy latest report to public/
LATEST=$(ls -t reports/*.html 2>/dev/null | head -1)
if [ -z "$LATEST" ]; then
  echo "No report generated"
  exit 1
fi

cp "$LATEST" ../public/audit-report.html
echo ""
echo "Published: public/audit-report.html ($(du -h ../public/audit-report.html | cut -f1))"
echo "Commit and push to deploy."
