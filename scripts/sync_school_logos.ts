#!/usr/bin/env node

// Uploads the bundled school logos to the school-logo bucket under
// `bundled/`, so the main site can serve them from the asset hostname. Files
// already in the bucket are skipped; a file name carries its content hash, so
// an object never changes once stored. Nothing is deleted.
//
// The target comes from the API's own variables: R2_ACCOUNT_ID (or R2_ENDPOINT
// for another S3-compatible store), R2_SCHOOL_LOGOS_BUCKET, R2_ACCESS_KEY_ID,
// and R2_SECRET_ACCESS_KEY. With neither R2_ACCOUNT_ID nor R2_ENDPOINT set it
// targets the local Compose object-storage service.
//
// `--pull` does the reverse for a fresh checkout, where the images are not in
// git: it downloads the files missing from `apps/web/public/school-logos/`
// from the public R2_PUBLIC_ASSET_ORIGIN and needs no credentials.

import { createHash, createHmac } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ManifestLogo = { asset: string; mime: string; sha256: string };
type Manifest = { logos: ManifestLogo[]; athletics: ManifestLogo[] };

const publicRoot = fileURLToPath(
  new URL("../apps/web/public", import.meta.url),
);
const manifest = JSON.parse(
  readFileSync(path.join(publicRoot, "school-logos/manifest.json"), "utf8"),
) as Manifest;

const pending = [...manifest.logos, ...manifest.athletics];
const total = pending.length;

// Runs the task over every logo, eight at a time, and tallies its answers.
async function forEachLogo<Outcome extends string>(
  task: (logo: ManifestLogo) => Promise<Outcome>,
): Promise<Partial<Record<Outcome, number>>> {
  const counts: Partial<Record<Outcome, number>> = {};
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let logo = pending.pop(); logo; logo = pending.pop()) {
        const outcome = await task(logo);
        counts[outcome] = (counts[outcome] ?? 0) + 1;
      }
    }),
  );
  return counts;
}

if (process.argv.includes("--pull")) {
  const origin = process.env.R2_PUBLIC_ASSET_ORIGIN?.trim();
  if (!origin) {
    console.error("Set R2_PUBLIC_ASSET_ORIGIN to the bucket's public address.");
    process.exit(1);
  }
  const counts = await forEachLogo(async (logo) => {
    const file = path.join(publicRoot, logo.asset);
    if (existsSync(file)) return "present";
    const response = await fetch(`${origin}/bundled${logo.asset}`);
    if (!response.ok) {
      throw new Error(`GET ${logo.asset} answered ${response.status}`);
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(body).digest("hex") !== logo.sha256) {
      throw new Error(`${logo.asset} does not match its manifest checksum`);
    }
    writeFileSync(file, body);
    return "downloaded";
  });
  console.log(
    `${total} bundled logos from ${origin}: ${counts.downloaded ?? 0} downloaded, ${counts.present ?? 0} already present.`,
  );
  process.exit(0);
}

const accountID = process.env.R2_ACCOUNT_ID?.trim();
const local = !accountID && !process.env.R2_ENDPOINT?.trim();
const endpoint = accountID
  ? `https://${accountID}.r2.cloudflarestorage.com`
  : (process.env.R2_ENDPOINT?.trim() ?? "http://localhost:9090");
const bucket =
  process.env.R2_SCHOOL_LOGOS_BUCKET?.trim() ||
  (local ? "cgn-school-logos" : "");
const accessKeyID =
  process.env.R2_ACCESS_KEY_ID?.trim() || (local ? "cgn-local" : "");
const secretAccessKey =
  process.env.R2_SECRET_ACCESS_KEY?.trim() || (local ? "cgn-local-secret" : "");
if (!bucket || !accessKeyID || !secretAccessKey) {
  console.error(
    "Set R2_SCHOOL_LOGOS_BUCKET, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.",
  );
  process.exit(1);
}

const emptySHA256 = createHash("sha256").update("").digest("hex");

// AWS Signature Version 4 for one path-style object request. R2 signs with
// the region "auto".
function signedRequest(
  method: "HEAD" | "PUT",
  key: string,
  bodySHA256: string,
  objectHeaders: Record<string, string>,
): { url: string; headers: Record<string, string> } {
  const url = new URL(`${endpoint}/${bucket}/${key}`);
  const timestamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
  const date = timestamp.slice(0, 8);
  const headers: Record<string, string> = {
    ...objectHeaders,
    host: url.host,
    "x-amz-content-sha256": bodySHA256,
    "x-amz-date": timestamp,
  };
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    method,
    url.pathname,
    "",
    ...names.map((name) => `${name}:${headers[name]}`),
    "",
    signedHeaders,
    bodySHA256,
  ].join("\n");
  const scope = `${date}/auto/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    timestamp,
    scope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  const signature = [date, "auto", "s3", "aws4_request", stringToSign]
    .reduce<string | Buffer>(
      (secret, value) => createHmac("sha256", secret).update(value).digest(),
      `AWS4${secretAccessKey}`,
    )
    .toString("hex");
  const { host: _host, ...sentHeaders } = headers;
  return {
    url: url.href,
    headers: {
      ...sentHeaders,
      authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

async function sync(logo: ManifestLogo): Promise<"uploaded" | "present"> {
  // The key mirrors the site path, so `/school-logos/x.png` is stored as
  // `bundled/school-logos/x.png`.
  const key = `bundled${logo.asset}`;
  const head = signedRequest("HEAD", key, emptySHA256, {});
  const existing = await fetch(head.url, {
    method: "HEAD",
    headers: head.headers,
  });
  if (existing.ok) return "present";
  if (existing.status !== 404) {
    throw new Error(`HEAD ${key} answered ${existing.status}`);
  }

  const body = readFileSync(path.join(publicRoot, logo.asset));
  if (createHash("sha256").update(body).digest("hex") !== logo.sha256) {
    throw new Error(`${logo.asset} does not match its manifest checksum`);
  }
  const put = signedRequest("PUT", key, logo.sha256, {
    "cache-control": "public, max-age=31536000, immutable",
    "content-type": logo.mime,
  });
  const stored = await fetch(put.url, {
    method: "PUT",
    headers: put.headers,
    body,
  });
  if (!stored.ok) {
    throw new Error(`PUT ${key} answered ${stored.status}`);
  }
  return "uploaded";
}

const counts = await forEachLogo(sync);
console.log(
  `${total} bundled logos in ${endpoint}/${bucket}: ${counts.uploaded ?? 0} uploaded, ${counts.present ?? 0} already present.`,
);
