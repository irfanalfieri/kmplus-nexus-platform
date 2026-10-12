# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: integration administrators (IT) and HR data stewards at KMPlus client companies in Indonesia. They work at a desktop, often for long sessions, connecting HR systems (SAP HCM, Talenta, Active Directory, local HRIS spreadsheets), building and monitoring pipelines, fixing quarantined rows, and governing who sees what. Secondary: workspace admins (members, SSO, approvals, environments) and analysts reading dashboards and asking questions about datasets.

## Product Purpose

KMPlus Nexus is an enterprise integration platform (EiPaaS), HR-first: it connects, transforms, governs and distributes enterprise data for KMPlus products (KMS, LMS, TMS, PMS, CMS, IMS) and third-party systems. Success: HR data from scattered sources arrives clean, checked, governed and on time in every product that needs it, and data teams can see and fix what went wrong without engineers.

## Positioning

Built for Indonesian HR data first: SAP/Talenta/local HRIS mappings, NIK/NPWP/phone validators, UU PDP masking and erasure, and first-class delivery into KMPlus products through the Nexus Ingest Contract. An on-prem Nexus Agent reaches systems behind client firewalls, and the AI assistant runs on free open-source models (optionally next to the agent).

## Operating Context

Layers of the app (one screen each): Overview, Data Sources, Connectors, Pipelines (canvas editor, runs, approvals, promotion), Business Rules, Data Quality (quarantine inbox, fix/replay), Data Catalog (lineage, quality history), Monitoring, Analytics (dashboards, ask a question), Governance (policies, masking, row filters, erasure), Settings (members, roles, approvals, environments, Nexus Agents, AI assistant, SSO/SAML, SCIM, API keys, webhooks, audit log). Workspaces can be linked as Development → Staging → Production. Roles: admin, steward, operator, analyst, auditor, viewer. Test data and walkthrough: `test-data/README.md`.

## Capabilities and Constraints

- Next.js 16 App Router, React 19, Tailwind v4 + shadcn/ui (Base UI), lucide icons, React Flow canvas; deployed on Vercel; server actions return errors as values.
- Every account uses TOTP 2FA or SSO; permissions are enforced on the server, the UI only hides controls.
- Interface language: **English and Bahasa Indonesia, switchable by the user** (confirmed 2026-10-12). Data, column names and test files stay as they are.
- Light and dark appearance, chosen by the user (with the system setting as default).
- No mock data in the UI (PRD §14): every screen shows real data with empty, loading and error states.

## Brand Commitments

- KMPlus (KM+) colour guide: `C:\Users\Irfan Alfieri\Downloads\KMPlus Color Palette.pdf` (not in the repo). "Cool Green" (Teal) is the anchor colour of every KM+ identity, paired with neutral black and white; Cyan and Purple are supporting families; each family has ten shades (10–100) with HEX/RGB/CMYK. The guide cites WCAG contrast guidance.
- Logo: the thin geometric "KM+" wordmark, recreated in code until an official file is supplied (confirmed 2026-10-12). Product name: "KMPlus Nexus".

## Evidence on Hand

- Real product functionality and test data (`test-data/`); no customer logos, testimonials or metrics exist and none may be invented.
- The colour guide PDF above; no official logo file, font licence or typography guide was supplied.

## Product Principles

1. Clarity over cleverness: data teams must see what ran, what failed, and what to do next.
2. Safety is visible: approvals, masking, environments and audit are shown plainly, never hidden behind jargon.
3. Indonesian HR reality first: local systems, IDs and regulations are first-class.
4. Nothing is invented: real data, real states, honest empty screens.

## Accessibility & Inclusion

WCAG 2.2 AA (confirmed 2026-10-12): text contrast, full keyboard operation with visible focus, screen-reader labels, no information by colour alone, reduced-motion respected. Bilingual English / Bahasa Indonesia.
