import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(
  fileURLToPath(new URL("..", import.meta.url)),
);
const apiDirectory = path.join(repositoryRoot, "apps", "api");
const adminDirectory = path.join(repositoryRoot, "apps", "admin");
const composeFile = path.join(
  repositoryRoot,
  "apps",
  "web",
  "tests",
  "e2e-real",
  "docker-compose.yml",
);
const externalDatabaseURL = process.env.REAL_E2E_DATABASE_URL?.trim();
const databaseURL =
  externalDatabaseURL ||
  "postgres://cgn:cgn@127.0.0.1:55432/cgn_e2e?sslmode=disable";
const manageDatabase = !externalDatabaseURL;
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const goCommand = process.env.REAL_E2E_GO_EXECUTABLE?.trim() || "go";

// One key pair per run: the Access stub publishes the public half and the
// specs sign assertions with the private half.
const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const keyID = "admin-real-e2e-key";
const childEnvironment = {
  ...process.env,
  API_DATABASE_URL: databaseURL,
  CGN_ADMIN_OPERATOR_IDENTITY: "runner@admin-real.test",
  PATH: [path.dirname(process.execPath), process.env.PATH]
    .filter(Boolean)
    .join(path.delimiter),
  REAL_E2E_DATABASE_URL: databaseURL,
  ADMIN_REAL_E2E_KEY_ID: keyID,
  ADMIN_REAL_E2E_PUBLIC_JWK: JSON.stringify({
    ...keyPair.publicKey.export({ format: "jwk" }),
    kid: keyID,
    alg: "RS256",
    use: "sig",
  }),
  ADMIN_REAL_E2E_PRIVATE_KEY: keyPair.privateKey.export({
    format: "pem",
    type: "pkcs8",
  }),
};

const operator = "operator@admin-real.test";
const former = "former@admin-real.test";
const bootstrapReason = "Real-stack suite bootstrap";

try {
  if (manageDatabase) {
    await run(
      "docker",
      [
        "compose",
        "-p",
        "cgn-admin-real-e2e",
        "-f",
        composeFile,
        "up",
        "-d",
        "--wait",
      ],
      repositoryRoot,
    );
  }
  await run(
    goCommand,
    ["run", "./cmd/migrate", "-dir", "../../db/migrations"],
    apiDirectory,
  );
  await run(goCommand, ["run", "./cmd/e2e-seed", "admin"], apiDirectory);
  const grant = (args) =>
    run(goCommand, ["run", "./cmd/cgn-admin", ...args], apiDirectory);
  await grant([
    "grant-site-admin",
    "-bootstrap",
    "-email",
    operator,
    "-reason",
    bootstrapReason,
  ]);
  await grant([
    "grant-site-admin",
    "-email",
    former,
    "-actor-email",
    operator,
    "-reason",
    "Temporary operator",
  ]);
  await grant([
    "revoke-site-admin",
    "-email",
    former,
    "-actor-email",
    operator,
    "-reason",
    "Left the team",
  ]);
  await run(pnpmCommand, ["run", "build"], adminDirectory);
  await run(
    pnpmCommand,
    [
      "exec",
      "playwright",
      "test",
      "--config=playwright.real.config.ts",
      ...process.argv.slice(2),
    ],
    adminDirectory,
  );
} finally {
  if (manageDatabase) {
    await run(
      "docker",
      [
        "compose",
        "-p",
        "cgn-admin-real-e2e",
        "-f",
        composeFile,
        "down",
        "--volumes",
        "--remove-orphans",
      ],
      repositoryRoot,
      false,
    );
  }
}

async function run(command, args, cwd, failOnError = true) {
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: childEnvironment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} exited on ${signal}`));
      else resolve(code ?? 1);
    });
  });
  if (exitCode !== 0 && failOnError) {
    throw new Error(`${command} exited with code ${exitCode}`);
  }
  return exitCode;
}
