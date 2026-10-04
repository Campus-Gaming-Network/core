#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const localAdminEmail = "dev@campusgamingnetwork.test";
const localEnvironment = {
  ...process.env,
  DEPLOYMENT_ENV: "local",
  API_DEV_SEED_USER_EMAIL: localAdminEmail,
  ADMIN_ENABLED: "true",
  ADMIN_LOCAL_ACCESS_EMAIL: localAdminEmail,
  ADMIN_SITE_URL: "http://localhost:3002",
  CLOUDFLARE_ACCESS_TEAM_DOMAIN: "http://admin:3002",
  CLOUDFLARE_ACCESS_AUDIENCE: "cgn-local-admin",
  CLOUDFLARE_ACCESS_JWKS_URL: "http://admin:3002/cdn-cgi/access/certs",
};
const compose = ["compose", "--profile", "admin"];

run([...compose, "up", "--build", "-d", "--wait"]);

const activeAdmins = run(
  [...compose, "exec", "-T", "api", "cgn-admin", "list-site-admins"],
  true,
)
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const [email, , , , eligibility] = line.split("\t");
    return { email, eligible: eligibility === "eligible" };
  });

if (!activeAdmins.some(({ email }) => email === localAdminEmail)) {
  const actor = activeAdmins.find(({ eligible }) => eligible);
  const grantArguments = actor
    ? [
        "grant-site-admin",
        "--email",
        localAdminEmail,
        "--actor-email",
        actor.email,
        "--reason",
        "Local Admin Console development",
      ]
    : [
        "grant-site-admin",
        "--bootstrap",
        "--email",
        localAdminEmail,
        "--reason",
        "Local Admin Console development bootstrap",
      ];
  const execArguments = [...compose, "exec", "-T"];
  if (!actor) {
    execArguments.push(
      "-e",
      "CGN_ADMIN_OPERATOR_IDENTITY=local-development@campusgamingnetwork.test",
    );
  }
  run([...execArguments, "api", "cgn-admin", ...grantArguments]);
}

console.log(
  `Admin Console is ready at http://localhost:3002 as ${localAdminEmail}`,
);

function run(arguments_, capture = false) {
  const result = spawnSync("docker", arguments_, {
    cwd: repositoryRoot,
    env: localEnvironment,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error) {
    console.error(`Unable to run Docker: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
  return capture ? result.stdout : "";
}
