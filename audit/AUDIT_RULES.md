# Audit System — Strict Isolation Rules

**CRITICAL: Read this before touching any audit code.**

## The Rule

The audit system MUST NOT import, reference, or read any code from the main whatchanged codebase. This means:

- NO imports from `src/`, `scripts/`, or any other directory outside `audit/`
- NO reading the main codebase's source files to understand how data is transformed
- NO using knowledge of internal implementation details to "help" the audit pass
- NO sharing modules, utilities, or helpers with the main app

The audit interacts with whatchanged.us **exclusively** through:
1. The public API: `https://whatchanged.us/api/data/{zip}`
2. Screenshots of the live website via Playwright
3. External government APIs (BLS, EIA, Census, FRED) queried independently

## Why

If the audit references the codebase, it becomes circular — it can only catch bugs that the codebase itself doesn't mask. An external audit catches bugs precisely because it doesn't share assumptions with the code under test.

## Allowed

- Reading API keys from shared environment variables (`BLS_API_KEY`, `EIA_API_KEY`, `CENSUS_API_KEY`, `FRED_API_KEY`)
- The audit directory has its own Python dependencies, config, and tests — fully self-contained
