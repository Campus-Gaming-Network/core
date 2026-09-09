import { createServerFn } from "@tanstack/react-start";
import { validatedPublicOrigin } from "./environment.server.js";

export const getPublicSiteOrigin = createServerFn({ method: "GET" }).handler(
  () => validatedPublicOrigin()
);
