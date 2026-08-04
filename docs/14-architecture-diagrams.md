# 14 — Architecture diagrams

These diagrams reflect the current main-site MVP and its Railway deployment plan. In the system overview, dashed components are explicitly post-MVP.

## 1. Frontend architecture overview

```mermaid
flowchart TB
    subgraph Browser["Browser"]
        Pages["Rendered pages<br/>HeroUI + application CSS"]
        Forms["Interactive forms<br/>progressive enhancement"]
        Cookies["HTTP-only cookies<br/>opaque session + private event unlock"]
    end

    subgraph Web["Railway web service — Next.js 16 + TypeScript"]
        AppRouter["App Router<br/>layouts, pages, SSR server components"]
        Boundaries["Error, loading, and not-found boundaries<br/>error.tsx, global-error.tsx, not-found.tsx"]
        ServerActions["Server Actions<br/>app/actions.ts"]
        HealthRoute["Route Handler<br/>GET /api/health"]
        Metadata["Page metadata and social tags<br/>lib/metadata.ts"]
        ServerAPI["Server-side data helpers<br/>lib/server-api.ts (React cache)"]
        APIClient["Typed API client and DTOs<br/>lib/cgn-api.ts"]
    end

    GoAPI["Private Go API<br/>API_INTERNAL_URL"]

    Pages -->|"navigation and page requests"| AppRouter
    Forms -->|"form submissions"| ServerActions
    Cookies -->|"sent with web requests"| AppRouter
    Cookies -->|"sent with mutations"| ServerActions

    AppRouter --> Boundaries
    AppRouter --> Metadata
    Metadata --> ServerAPI
    AppRouter --> ServerAPI
    ServerAPI --> APIClient
    ServerActions --> APIClient
    HealthRoute --> APIClient

    APIClient -->|"server-only HTTP over Railway private networking"| GoAPI
    GoAPI -->|"JSON, errors, and Set-Cookie responses"| APIClient
    AppRouter -->|"SSR HTML"| Pages
    ServerActions -->|"redirects and cookie updates"| Forms
```

Key boundary: the browser talks to Next.js, while Next.js acts as the BFF and calls the Go API. The private API URL and private-event unlock tokens are not exposed to browser JavaScript. Browser authentication uses opaque cookies, not JWTs.

## 2. Backend architecture overview

```mermaid
flowchart TB
    Request["Next.js BFF request"]

    subgraph Runtime["Go API runtime — cmd/api"]
        Config["Environment configuration"]
        Logging["Structured request logging"]
        Session["Opaque-session middleware"]
        Router["HTTP router<br/>health + domain routes"]
        RateLimit["In-memory rate-limit checks"]

        subgraph Handlers["HTTP handlers"]
            AuthHandlers["Auth and account"]
            CatalogHandlers["Users, schools, games"]
            EventHandlers["Events, RSVP, interest"]
            TeamHandlers["Teams and membership"]
            SafetyHandlers["Reports and support"]
        end

        AccountService["Account service<br/>validation, passwords, tokens"]

        subgraph Repositories["Postgres repositories"]
            UserRepo["Users and profiles"]
            AuthRepos["Sessions and auth tokens"]
            CatalogRepos["Schools, follows, games"]
            EventRepo["Events and attendance"]
            TeamRepo["Teams and members"]
            SafetyRepo["Reports and support tickets"]
        end

        AccountMailer["Account mailer"]
        EventMailer["RSVP + ICS mailer"]
    end

    subgraph Operations["One-shot operational commands"]
        MigrateCmd["cmd/migrate"]
        MigrationRunner["Versioned migration runner"]
        SeedCmd["cmd/seed"]
        SchoolImporter["Guarded school CSV importer"]
    end

    MigrationFiles["db/migrations/*.up.sql"]
    SchoolCSV["data/schools_seed.csv"]
    Postgres[("PostgreSQL")]
    Resend["Resend transactional email"]

    Config --> Router
    Request --> Logging --> Session --> Router
    Router --> AuthHandlers
    Router --> CatalogHandlers
    Router --> EventHandlers
    Router --> TeamHandlers
    Router --> SafetyHandlers
    RateLimit -.-> AuthHandlers
    RateLimit -.-> EventHandlers
    RateLimit -.-> TeamHandlers
    RateLimit -.-> SafetyHandlers

    AuthHandlers --> AccountService
    AccountService --> UserRepo
    AccountService --> AuthRepos
    AccountService --> CatalogRepos
    AccountService --> AccountMailer
    CatalogHandlers --> UserRepo
    CatalogHandlers --> CatalogRepos
    EventHandlers --> EventRepo
    EventHandlers --> EventMailer
    TeamHandlers --> TeamRepo
    SafetyHandlers --> SafetyRepo

    UserRepo --> Postgres
    AuthRepos --> Postgres
    CatalogRepos --> Postgres
    EventRepo --> Postgres
    TeamRepo --> Postgres
    SafetyRepo --> Postgres
    Router -.->|"readiness ping"| Postgres
    AccountMailer --> Resend
    EventMailer --> Resend

    MigrateCmd --> MigrationRunner
    MigrationFiles --> MigrationRunner --> Postgres
    SeedCmd --> SchoolImporter
    SchoolCSV --> SchoolImporter --> Postgres
```

The Go layer owns authorization, validation, domain rules, transactional writes, rate limits, mail triggers, and persistence. SQL is parameterized, user-facing records use soft deletes where applicable, and `/ready` verifies Postgres connectivity.

## 3. Entire system overview

```mermaid
flowchart LR
    User["Campus gamer"]
    Operator["Developer / operator"]
    GitHub["GitHub repository"]
    CI["GitHub Actions<br/>lint, typecheck, tests, build"]
    Cloudflare["Cloudflare<br/>DNS + edge protection"]
    Resend["Resend<br/>account + event email"]

    subgraph Railway["Railway environment — staging or production"]
        Web["Public web service<br/>Next.js BFF"]
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

    CRM["Post-MVP CRM<br/>TanStack Start"]
    R2["Post-MVP Cloudflare R2<br/>school logos"]
    IGDB["Post-MVP IGDB<br/>game enrichment"]
    Sentry["Post-MVP Sentry"]

    User -->|"HTTPS"| Cloudflare --> Web
    Web -->|"SSR HTML, redirects, opaque cookies"| User
    API -->|"transactional email + ICS"| Resend --> User

    Operator --> GitHub
    GitHub --> CI
    CI -->|"verification status"| Operator
    GitHub -->|"Railway source build"| Web
    GitHub -->|"Railway source build"| API

    CRM -.->|"shared admin API"| API
    CRM -.-> R2
    IGDB -.-> CRM
    Web -.-> Sentry
    API -.-> Sentry

    classDef deferred stroke-dasharray: 6 4,fill:#f7f7f8,color:#52525b;
    class CRM,R2,IGDB,Sentry deferred;
```

Production exposes only the Next.js web service. The Go API and PostgreSQL remain on Railway private networking. Migrations run before a new API deployment is activated, the national school seed runs once per fresh environment, and database backups are a launch gate.
