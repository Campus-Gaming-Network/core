export type DeploymentEnvironment = "local" | "staging" | "production";

type Environment = Readonly<Record<string, string | undefined>>;

const localDefaults = {
  ADMIN_API_INTERNAL_URL: "http://localhost:8080",
  ADMIN_API_PROXY_SHARED_SECRET: "local-admin-bff-proxy-secret-000000",
  ADMIN_SITE_URL: "http://localhost:3002",
  ADMIN_SESSION_COOKIE: "cgn_admin_session",
  ADMIN_CSRF_COOKIE: "cgn_admin_csrf",
} as const;

export type AdminEnvironment = {
  deploymentEnvironment: DeploymentEnvironment;
  apiInternalURL: string;
  apiProxySecret: string;
  siteOrigin: string;
  sessionCookieName: string;
  csrfCookieName: string;
  accessIssuer?: string;
  accessAudience?: string;
  accessJWKSURL?: string;
  /** Where the API publishes school logos; previews load only from here. */
  logoAssetBase?: string;
};

export function environmentValidationIssues(
  environment: Environment,
): string[] {
  const deploymentEnvironment = parseDeploymentEnvironment(
    environment.DEPLOYMENT_ENV,
  );
  if (!deploymentEnvironment) {
    return ["DEPLOYMENT_ENV must be local, staging, or production"];
  }

  const strict = deploymentEnvironment !== "local";
  const issues: string[] = [];
  validateInternalURL(environment, strict, issues);
  validateSiteURL(environment, strict, issues);
  validateCookies(environment, strict, issues);

  const proxySecret = configuredValue(
    environment,
    "ADMIN_API_PROXY_SHARED_SECRET",
  );
  if (strict && (proxySecret?.length ?? 0) < 32) {
    issues.push(
      "ADMIN_API_PROXY_SHARED_SECRET must contain at least 32 characters",
    );
  }
  const publicProxySecret = configuredValue(
    environment,
    "API_PROXY_SHARED_SECRET",
  );
  if (strict && proxySecret && proxySecret === publicProxySecret) {
    issues.push(
      "ADMIN_API_PROXY_SHARED_SECRET must differ from API_PROXY_SHARED_SECRET",
    );
  }

  for (const key of [
    "CLOUDFLARE_ACCESS_TEAM_DOMAIN",
    "CLOUDFLARE_ACCESS_AUDIENCE",
    "CLOUDFLARE_ACCESS_JWKS_URL",
  ] as const) {
    if (strict && !configuredValue(environment, key)) {
      issues.push(`${key} must be set`);
    }
  }

  const logoAssetBase = configuredValue(environment, "R2_PUBLIC_ASSET_ORIGIN");
  if (strict && !logoAssetBase) {
    issues.push("R2_PUBLIC_ASSET_ORIGIN must be set");
  } else if (logoAssetBase && !parseLogoAssetBase(logoAssetBase, strict)) {
    issues.push(
      strict
        ? "R2_PUBLIC_ASSET_ORIGIN must be an HTTPS origin"
        : "R2_PUBLIC_ASSET_ORIGIN must be an absolute HTTP(S) URL without a query or trailing slash",
    );
  }

  const accessIssuer = configuredValue(
    environment,
    "CLOUDFLARE_ACCESS_TEAM_DOMAIN",
  );
  if (accessIssuer && !parseAccessOrigin(accessIssuer, strict)) {
    issues.push(
      strict
        ? "CLOUDFLARE_ACCESS_TEAM_DOMAIN must be an absolute HTTPS origin"
        : "CLOUDFLARE_ACCESS_TEAM_DOMAIN must be an absolute HTTP(S) origin",
    );
  }
  const jwksURL = configuredValue(environment, "CLOUDFLARE_ACCESS_JWKS_URL");
  if (jwksURL && !parseAccessURL(jwksURL, strict)) {
    issues.push(
      strict
        ? "CLOUDFLARE_ACCESS_JWKS_URL must be an absolute HTTPS URL"
        : "CLOUDFLARE_ACCESS_JWKS_URL must be an absolute HTTP(S) URL",
    );
  }

  return issues;
}

export function assertSafeEnvironment(
  environment: Environment = process.env,
): void {
  const issues = environmentValidationIssues(environment);
  if (issues.length > 0) {
    throw new Error(
      `[configuration] Unsafe Admin Console configuration: ${issues.join("; ")}`,
    );
  }
}

export function adminEnvironment(
  environment: Environment = process.env,
): AdminEnvironment {
  assertSafeEnvironment(environment);
  const deploymentEnvironment = parseDeploymentEnvironment(
    environment.DEPLOYMENT_ENV,
  );
  if (!deploymentEnvironment) {
    throw new Error("[configuration] Invalid deployment environment");
  }

  return {
    deploymentEnvironment,
    apiInternalURL:
      configuredValue(environment, "ADMIN_API_INTERNAL_URL") ??
      localDefaults.ADMIN_API_INTERNAL_URL,
    apiProxySecret:
      configuredValue(environment, "ADMIN_API_PROXY_SHARED_SECRET") ??
      localDefaults.ADMIN_API_PROXY_SHARED_SECRET,
    siteOrigin: new URL(
      configuredValue(environment, "ADMIN_SITE_URL") ??
        localDefaults.ADMIN_SITE_URL,
    ).origin,
    sessionCookieName:
      configuredValue(environment, "ADMIN_SESSION_COOKIE") ??
      localDefaults.ADMIN_SESSION_COOKIE,
    csrfCookieName:
      configuredValue(environment, "ADMIN_CSRF_COOKIE") ??
      localDefaults.ADMIN_CSRF_COOKIE,
    accessIssuer: configuredValue(environment, "CLOUDFLARE_ACCESS_TEAM_DOMAIN"),
    accessAudience: configuredValue(environment, "CLOUDFLARE_ACCESS_AUDIENCE"),
    accessJWKSURL: configuredValue(environment, "CLOUDFLARE_ACCESS_JWKS_URL"),
    logoAssetBase: configuredValue(environment, "R2_PUBLIC_ASSET_ORIGIN"),
  };
}

/**
 * The asset base is an origin in staging and production. Locally it may add
 * the storage bucket's path.
 */
function parseLogoAssetBase(value: string, strict: boolean): URL | undefined {
  try {
    const parsed = new URL(value);
    const valid =
      (parsed.protocol === "https:" ||
        (!strict && parsed.protocol === "http:")) &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash &&
      !value.endsWith("/") &&
      (!strict || parsed.pathname === "/");
    return valid ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function validateInternalURL(
  environment: Environment,
  strict: boolean,
  issues: string[],
): void {
  const configured = configuredValue(environment, "ADMIN_API_INTERNAL_URL");
  if (strict && !configured) {
    issues.push("ADMIN_API_INTERNAL_URL must be set");
    return;
  }
  const parsed = parseHTTPOrigin(
    configured ?? localDefaults.ADMIN_API_INTERNAL_URL,
  );
  if (!parsed) {
    issues.push("ADMIN_API_INTERNAL_URL must be an absolute HTTP(S) origin");
  } else if (strict && isLocalHostname(parsed.hostname)) {
    issues.push("ADMIN_API_INTERNAL_URL must not use a local hostname");
  } else if (
    strict &&
    parsed.protocol !== "https:" &&
    !parsed.hostname.endsWith(".railway.internal")
  ) {
    issues.push(
      "ADMIN_API_INTERNAL_URL must use HTTPS unless it is a Railway private-network origin",
    );
  }
}

function validateSiteURL(
  environment: Environment,
  strict: boolean,
  issues: string[],
): void {
  const configured = configuredValue(environment, "ADMIN_SITE_URL");
  if (strict && !configured) {
    issues.push("ADMIN_SITE_URL must be set");
    return;
  }
  const parsed = parseHTTPOrigin(configured ?? localDefaults.ADMIN_SITE_URL);
  if (!parsed) {
    issues.push("ADMIN_SITE_URL must be an absolute HTTP(S) origin");
  } else if (strict && parsed.protocol !== "https:") {
    issues.push("ADMIN_SITE_URL must use HTTPS");
  } else if (strict && isLocalHostname(parsed.hostname)) {
    issues.push("ADMIN_SITE_URL must not use a local hostname");
  }
}

function validateCookies(
  environment: Environment,
  strict: boolean,
  issues: string[],
): void {
  const session =
    configuredValue(environment, "ADMIN_SESSION_COOKIE") ??
    localDefaults.ADMIN_SESSION_COOKIE;
  const csrf =
    configuredValue(environment, "ADMIN_CSRF_COOKIE") ??
    localDefaults.ADMIN_CSRF_COOKIE;
  if (!validCookieName(session)) {
    issues.push("ADMIN_SESSION_COOKIE must be a valid cookie name");
  }
  if (!validCookieName(csrf)) {
    issues.push("ADMIN_CSRF_COOKIE must be a valid cookie name");
  }
  if (session === csrf) {
    issues.push("ADMIN_SESSION_COOKIE and ADMIN_CSRF_COOKIE must differ");
  }
  if (strict && session !== "__Host-cgn_admin_session") {
    issues.push("ADMIN_SESSION_COOKIE must be __Host-cgn_admin_session");
  }
  if (strict && csrf !== "__Host-cgn_admin_csrf") {
    issues.push("ADMIN_CSRF_COOKIE must be __Host-cgn_admin_csrf");
  }
}

function parseDeploymentEnvironment(
  value: string | undefined,
): DeploymentEnvironment | undefined {
  const normalized = value?.trim().toLowerCase() || "local";
  if (
    normalized === "local" ||
    normalized === "staging" ||
    normalized === "production"
  ) {
    return normalized;
  }
  return undefined;
}

function configuredValue(
  environment: Environment,
  key: string,
): string | undefined {
  const value = environment[key]?.trim();
  return value ? value : undefined;
}

function parseHTTPOrigin(value: string): URL | undefined {
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      (parsed.pathname !== "" && parsed.pathname !== "/") ||
      parsed.search ||
      parsed.hash
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

/** Local development may point Access validation at a plain-HTTP stub. */
function parseAccessOrigin(value: string, strict: boolean): URL | undefined {
  const parsed = parseHTTPOrigin(value);
  return parsed && (!strict || parsed.protocol === "https:")
    ? parsed
    : undefined;
}

function parseAccessURL(value: string, strict: boolean): URL | undefined {
  try {
    const parsed = new URL(value);
    const protocolAllowed =
      parsed.protocol === "https:" || (!strict && parsed.protocol === "http:");
    return protocolAllowed && !parsed.username && !parsed.password
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

function validCookieName(value: string): boolean {
  const separators = '()<>@,;:\\"/[]?={} \t';
  return (
    value.length > 0 &&
    [...value].every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        codePoint >= 0x21 &&
        codePoint <= 0x7e &&
        !separators.includes(character)
      );
    })
  );
}

function isLocalHostname(value: string): boolean {
  const hostname = value
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/\.$/, "");
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    hostname === "::" ||
    hostname === "0.0.0.0" ||
    hostname.startsWith("127.")
  );
}
