import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const apiDirectory = path.join(repositoryRoot, "apps", "api");
const webDirectory = path.join(repositoryRoot, "apps", "web");
const composeFile = path.join(webDirectory, "tests", "e2e-real", "docker-compose.yml");
const externalDatabaseURL = process.env.REAL_E2E_DATABASE_URL?.trim();
const databaseURL = externalDatabaseURL || "postgres://cgn:cgn@127.0.0.1:55432/cgn_e2e?sslmode=disable";
const manageDatabase = !externalDatabaseURL;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const goCommand = process.env.REAL_E2E_GO_EXECUTABLE?.trim() || "go";
const childEnvironment = {
  ...process.env,
  API_DATABASE_URL: databaseURL,
  PATH: [path.dirname(process.execPath), process.env.PATH]
    .filter(Boolean)
    .join(path.delimiter),
  REAL_E2E_DATABASE_URL: databaseURL
};

try {
  if (manageDatabase) {
    await run("docker", ["compose", "-p", "cgn-real-e2e", "-f", composeFile, "up", "-d", "--wait"], repositoryRoot);
  }
  await run(goCommand, ["run", "./cmd/migrate", "-dir", "../../db/migrations"], apiDirectory);
  await run(goCommand, ["run", "./cmd/e2e-seed"], apiDirectory);
  await run(npmCommand, ["run", "build"], webDirectory);
  await run(
    npxCommand,
    ["playwright", "test", "--config=playwright.real.config.ts", ...process.argv.slice(2)],
    webDirectory
  );
} finally {
  if (manageDatabase) {
    await run(
      "docker",
      ["compose", "-p", "cgn-real-e2e", "-f", composeFile, "down", "--volumes", "--remove-orphans"],
      repositoryRoot,
      false
    );
  }
}

async function run(command, args, cwd, failOnError = true) {
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: childEnvironment,
      stdio: "inherit"
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
