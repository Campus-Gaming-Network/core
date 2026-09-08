import { assertSafeEnvironment } from "./lib/environment";

export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    assertSafeEnvironment();
  }
}
