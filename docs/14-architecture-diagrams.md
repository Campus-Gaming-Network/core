# 14 — Architecture diagrams

These diagrams reflect the current first release and its Railway deployment plan. In the system overview, dashed components run on staging and are release-gated for production.

## 1. Frontend architecture overview

```mermaid
flowchart TB
    subgraph Browser["Browser"]
        Pages["Rendered pages<br/>semantic React + application CSS"]
        Forms["Interactive forms<br/>progressive enhancement"]
        Cookies["HTTP-only cookies<br/>opaque session + private event unlock"]
    end

    subgraph Web["Railway web service — TanStack Start + TypeScript"]
        Router["TanStack Router<br/>file routes, loaders, SSR"]
        Boundaries["Route boundaries<br/>pending, error, and not found"]
        Operations["Feature operations + server functions<br/>src/features/*"]
        HealthRoute["Server route<br/>GET /api/health"]
        Metadata["Route head metadata<br/>src/routes + public-page-head"]
        RequestBoundary["Request and cache boundary<br/>src/server/request-boundary.server.ts"]
        APIClient["Typed Go API client and contracts<br/>src/server + feature slices"]
    end

    GoAPI["Private Go API<br/>API_INTERNAL_URL"]

    Pages -->|"navigation and page requests"| Router
    Forms -->|"enhanced or native submissions"| Operations
    Cookies -->|"sent with web requests"| Router
    Cookies -->|"sent with mutations"| Operations

    Router --> Boundaries
    Router --> Metadata
    Metadata --> RequestBoundary
    Router --> RequestBoundary
    RequestBoundary --> APIClient
    Operations --> APIClient
    HealthRoute --> APIClient

    APIClient -->|"server-only HTTP over Railway private networking"| GoAPI
    GoAPI -->|"JSON, errors, and Set-Cookie responses"| APIClient
    Router -->|"SSR HTML and route data"| Pages
    Operations -->|"303 redirects, notices, and cookie updates"| Forms
```

Key boundary: the browser talks to TanStack Start, while the Start server acts as the BFF and calls the Go API. The private API URL and private-event unlock tokens are not exposed to browser JavaScript. Browser authentication uses opaque cookies, not JWTs.

## 2. Backend architecture overview

```mermaid
flowchart TB
    Request["Web BFF request"]
    AdminRequest["Admin BFF request<br/>/admin/v1"]

    subgraph Runtime["Go API runtime — cmd/api"]
        Middleware["Request logging, security headers,<br/>panic recovery, body limit"]
        Session["Opaque-session middleware<br/>+ activity days"]
        Router["Public router — internal/httpapi"]
        AdminEdge["Admin API — internal/adminhttp<br/>route policy: capability, CSRF, audit"]
        RateLimit["In-process rate limits"]

        subgraph Domains["Domain packages — repositories and rules"]
            Accounts["auth, users, policies, dataexport"]
            Catalog["schools, games, people"]
            Events["events: RSVP, organizers,<br/>activity log, tournaments"]
            Teams["teams"]
            Clubs["clubs: claims, officers"]
            Safety["safety: reports, support"]
            Inbox["notifications"]
            AdminDomains["adminaccess, adminsession,<br/>adminaudit, operations, metrics"]
        end

        Outbox["emailoutbox worker"]
        Background["Maintenance sweeper,<br/>club reminders, catalog refresh"]
    end

    subgraph Operations["One-shot commands"]
        MigrateCmd["cmd/migrate"]
        SeedCmd["cmd/seed"]
        AdminCLI["cmd/cgn-admin"]
    end

    MigrationFiles["db/migrations/*.up.sql"]
    SchoolCSV["data/schools_seed.csv"]
    Postgres[("PostgreSQL")]
    Resend["Resend"]
    IGDB["IGDB"]
    R2["Cloudflare R2<br/>school logos"]

    Request --> Middleware --> Session --> Router
    AdminRequest --> Middleware --> AdminEdge
    RateLimit -.-> Router
    Router --> Accounts
    Router --> Catalog
    Router --> Events
    Router --> Teams
    Router --> Clubs
    Router --> Safety
    Router --> Inbox
    AdminEdge --> AdminDomains
    AdminEdge --> Catalog
    AdminEdge --> Clubs
    AdminEdge --> Safety

    Domains -->|"parameterized SQL, transactions,<br/>outbox rows written in the same transaction"| Postgres
    Outbox --> Postgres
    Outbox --> Resend
    Background --> Postgres
    Catalog --> IGDB
    AdminEdge --> R2

    MigrationFiles --> MigrateCmd --> Postgres
    SchoolCSV --> SeedCmd --> Postgres
    AdminCLI --> Postgres
```

The Go layer owns authorization, validation, domain rules, transactional writes, rate limits, notifications and queued email, and persistence. Email is never sent inside a request: a repository writes an `email_outbox` row in its transaction and the worker delivers it. SQL is parameterized, user-facing records use soft deletes where applicable, and `/ready` verifies Postgres connectivity.

## 3. Entire system overview

```mermaid
flowchart LR
    User["Campus gamer"]
    Operator["Developer / operator"]
    GitHub["GitHub repository"]
    CI["GitHub Actions<br/>lint, typecheck, tests, build"]
    Cloudflare["Cloudflare<br/>DNS + edge protection"]
    Resend["Resend<br/>account, event, and notification email"]

    subgraph Railway["Railway environment — staging or production"]
        Web["Public web service<br/>TanStack Start BFF"]
        API["Private API service<br/>Go"]
        Migrations["API pre-deploy<br/>versioned migrations"]
        Seed["Temporary one-time<br/>school seed service"]
        Database[("Railway PostgreSQL")]
        Backups["Scheduled + manual<br/>volume backups"]

        Web -->|"HTTP over private network"| API
        API --> Database
        Migrations --> Database
        Seed --> Database
        Database --> Backups
    end

    Admin["Admin Console (release-gated)<br/>TanStack Start"]
    R2["Cloudflare R2 (release-gated)<br/>school logos"]
    IGDB["IGDB<br/>game search, import, covers"]
    Sentry["Sentry<br/>error monitoring"]

    User -->|"HTTPS"| Cloudflare --> Web
    Web -->|"SSR HTML, redirects, opaque cookies"| User
    API -->|"transactional email + ICS"| Resend --> User

    Operator --> GitHub
    GitHub --> CI
    CI -->|"verification status"| Operator
    GitHub -->|"Railway source build"| Web
    GitHub -->|"Railway source build"| API

    Admin -.->|"shared admin API"| API
    Admin -.-> R2
    API -->|"user search and import, admin refresh"| IGDB
    Web -->|"errors"| Sentry
    API -->|"errors"| Sentry
    Admin -.->|"errors"| Sentry

    classDef deferred stroke-dasharray: 6 4,fill:#f7f7f8,color:#52525b;
    class Admin,R2 deferred;
```

Production exposes only the TanStack Start web service. The Go API and PostgreSQL remain on Railway private networking. Migrations run before a new API deployment is activated, the national school seed runs once per fresh environment, and database backups are a launch gate.
