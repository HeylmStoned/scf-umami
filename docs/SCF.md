# SCF fork

This repository is a fork of [umami-software/umami](https://github.com/umami-software/umami). GitHub records that relationship. The web product is this fork. The OpenTelemetry collector stays a separate service. Umami does not ingest API traces.

The public preview stays at [scf-analytics-poc.alexander-wurzer.workers.dev](https://scf-analytics-poc.alexander-wurzer.workers.dev). Its source in this fork is `preview/`. That page is the operator console, the API charts, the live collector, and the data and privacy controls. It is served by the existing Worker so the URL does not change. It is not the Next.js app in this repository.

The fork is the place those pieces move onto. Stock Umami already has the web dashboard, the tracker, and Postgres. The fork adds tenancy, the operator view, and the privacy limits from the technical design:

- The script is version-pinned. The `umami` global and a client-supplied IP are not accepted.
- Country only. No city, region, or ad click ids.
- The IP is truncated before the visitor hash. The daily salt is deleted.
- `umami.identify()` stays off, so a project cannot attach a wallet or account id.
- Reads and writes are bound to `tenant_id`.
- A tenant can delete its property and the rows that belong to it. That is the erasure path.

Ingest and the dashboard are committed at 99.9%. Supabase publishes that uptime figure on Enterprise only. The design does not sign 99.99%.

The live preview has the same data and privacy session as the other demo: erase web, API, or both for the selected range or the 90-day fixture, or remove a project after typing its name. Charts in that browser session update. Refresh restores the fixtures. That is not a completed production deletion. Production erasure is the tenant deleting the property and its rows.
