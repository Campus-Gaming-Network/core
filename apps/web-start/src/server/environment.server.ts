export type DeploymentEnvironment = "local" | "staging" | "production";

type Environment = Readonly<Record<string, string | undefined>>;

const localDefaults = {
  API_INTERNAL_URL: "http://localhost:8080",
  API_SESSION_COOKIE: "cgn_session",
  SITE_URL: "http://localhost:3100"
} as const;

export function environmentValidationIssues(environment: Environment): string[] {
  const deploymentEnvironment = parseDeploymentEnvironment(
    environment.DEPLOYMENT_ENV
  );
  if (!deploymentEnvironment) {
    return ["DEPLOYMENT_ENV must be local, staging, or production"];
  }

  const strict = deploymentEnvironment !== "local";
  const issues: string[] = [];

  const internalURLValue = configuredValue(environment, "API_INTERNAL_URL");
  if (strict && !internalURLValue) {
    issues.push("API_INTERNAL_URL must be set");
  } else {
    const internalURL = parseHTTPOrigin(
      internalURLValue ?? localDefaults.API_INTERNAL_URL
    );
    if (!internalURL) {
      issues.push("API_INTERNAL_URL must be an absolute HTTP(S) origin");
    } else if (strict && isLocalHostname(internalURL.hostname)) {
      issues.push("API_INTERNAL_URL must not use a local hostname");
    } else if (
      strict &&
      internalURL.protocol !== "https:" &&
      !isRailwayPrivateHostname(internalURL.hostname)
    ) {
      issues.push(
        "API_INTERNAL_URL must use HTTPS unless it is a Railway private-network origin"
      );
    }
  }

  const siteURLValue = configuredValue(environment, "SITE_URL");
  if (strict && !siteURLValue) {
    issues.push("SITE_URL must be set");
  } else {
    const siteURL = parseHTTPOrigin(siteURLValue ?? localDefaults.SITE_URL);
    if (!siteURL) {
      issues.push("SITE_URL must be an absolute HTTP(S) origin");
    } else if (strict) {
      if (siteURL.protocol !== "https:") {
        issues.push("SITE_URL must use HTTPS");
      }
      if (isLocalHostname(siteURL.hostname)) {
        issues.push("SITE_URL must not use a local hostname");
      }
    }
  }

  const sessionCookieValue = configuredValue(
    environment,
    "API_SESSION_COOKIE"
  );
  if (strict && !sessionCookieValue) {
    issues.push("API_SESSION_COOKIE must be set");
  } else if (
    !validCookieName(sessionCookieValue ?? localDefaults.API_SESSION_COOKIE)
  ) {
    issues.push("API_SESSION_COOKIE must be a valid cookie name");
  }

  if (strict) {
    if (configuredLength(environment, "API_PROXY_SHARED_SECRET") < 32) {
      issues.push(
        "API_PROXY_SHARED_SECRET must contain at least 32 characters"
      );
    }
    if (configuredLength(environment, "CLOUDFLARE_ORIGIN_SECRET") < 32) {
      issues.push(
        "CLOUDFLARE_ORIGIN_SECRET must contain at least 32 characters"
      );
    }
  }

  return issues;
}

export function assertSafeEnvironment(
  environment: Environment = process.env
): void {
  const issues = environmentValidationIssues(environment);
  if (issues.length === 0) {
    return;
  }

  throw new Error(`[configuration] Unsafe configuration: ${issues.join("; ")}`);
}

export function validatedPublicOrigin(
  environment: Environment = process.env
): string {
  assertSafeEnvironment(environment);

  return new URL(
    configuredValue(environment, "SITE_URL") ?? localDefaults.SITE_URL
  ).origin;
}

function parseDeploymentEnvironment(
  value: string | undefined
): DeploymentEnvironment | undefined {
  const normalized =
    value === undefined || value === "" ? "local" : value.trim().toLowerCase();
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
  key: string
): string | undefined {
  const value = environment[key];
  return value?.trim() ? value : undefined;
}

function configuredLength(environment: Environment, key: string): number {
  return configuredValue(environment, key)?.trim().length ?? 0;
}

function parseHTTPOrigin(value: string): URL | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    if (
      !parsed.hostname ||
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

function validCookieName(value: string): boolean {
  const separators = "()<>@,;:\\\"/[]?={} \t";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x21 || codePoint > 0x7e || separators.includes(character)) {
      return false;
    }
  }
  return value.length > 0;
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

function isRailwayPrivateHostname(value: string): boolean {
  const hostname = value.toLowerCase().replace(/\.$/, "");
  return hostname.endsWith(".railway.internal");
}
