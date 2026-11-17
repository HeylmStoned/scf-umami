# SCF fork

This repository is a fork of [umami-software/umami](https://github.com/umami-software/umami). GitHub records that relationship. The web product is this fork. The OpenTelemetry collector stays a separate service. Umami does not ingest API traces.

The public preview is still [scf-analytics-poc.alexander-wurzer.workers.dev](https://scf-analytics-poc.alexander-wurzer.workers.dev). That preview is not this Next.js app. It shows the operator console, the API charts, and the live collector.

The fork is the place those pieces move onto. Stock Umami already has the web dashboard, the tracker, and Postgres. The fork adds tenancy, the operator view, and the privacy limits from the technical design:

- The script is version-pinned. The `umami` global and a client-supplied IP are not accepted.
- Country only. No city, region, or ad click ids.
- The IP is truncated before the visitor hash. The daily salt is deleted.
- `umami.identify()` stays off, so a project cannot attach a wallet or account id.
- Reads and writes are bound to `tenant_id`.
- A tenant can delete its property and the rows that belong to it. That is the erasure path.

Ingest and the dashboard are committed at 99.9%. Supabase publishes that uptime figure on Enterprise only. The design does not sign 99.99%.

Data and privacy controls on a demo session, including erasing web or API numbers and removing a project after typing its name, are fixture actions. Refresh restores them. They are not a completed production deletion.
