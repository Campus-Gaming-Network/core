import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "@playwright/test";

// Explicit maintenance command, never a scheduled catalog sync. Identity comes
// from IPEDS IDs, not fuzzy school names or a shared university-system domain.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "apps/web/public/school-logos");
// The Go API embeds this slim lookup of the manifest, since `embed` cannot
// read outside apps/api. `--check` fails when it drifts from the manifest.
const apiLookup = join(root, "apps/api/internal/schools/bundled_logos.json");
const cache = join(tmpdir(), "cgn-school-logo-cache");
const userAgent =
  "CampusGamingNetworkLogoResearch/1.0 (https://github.com/Campus-Gaming-Network/core)";
const query = `SELECT ?item ?unitid ?logo ?website ?label WHERE {
  ?item wdt:P1771 ?unitid; wdt:P154 ?logo.
  OPTIONAL { ?item wdt:P856 ?website }
  OPTIONAL { ?item rdfs:label ?label. FILTER(LANG(?label) = "en") }
}`;

type Binding = {
  item: { value: string };
  unitid: { value: string };
  logo: { value: string };
  website?: { value: string };
  label?: { value: string };
};
type ImageInfo = {
  url: string;
  descriptionurl: string;
  width: number;
  height: number;
  size: number;
  mime: string;
  sha1: string;
  extmetadata: Record<string, { value: string }>;
};
type CommonsResponse = {
  error?: { info: string };
  query?: {
    pages: Record<string, { title: string; imageinfo?: ImageInfo[] }>;
  };
};
type Logo = {
  unitid: number;
  name: string;
  slug: string;
  website_url: string;
  asset: string;
  wikidata_url: string;
  wikidata_label: string;
  identity_note: string;
  identity_source_url: string;
  file_title: string;
  source_url: string;
  original_source: string;
  original_source_urls: string[];
  author: string;
  license: string;
  license_url: string;
  attribution_required: boolean;
  attribution: string;
  restrictions: string;
  width: number;
  height: number;
  mime: string;
  bytes: number;
  sha256: string;
  download_url: string;
  retrieved_at: string;
  /** The source file's facts, when the bundled copy was downscaled. */
  /** Copyrighted artwork kept on Wikipedia under its non-free content policy. */
  non_free?: true;
  resized_from?: {
    width: number;
    height: number;
    bytes: number;
    sha256: string;
  };
};
type Manifest = {
  generated_at: string;
  catalog_count: number;
  candidate_count: number;
  query_url: string;
  matching_method: string;
  logos: Logo[];
  excluded: Array<{ unitid: number; name: string; reasons: string[] }>;
  /** Athletics marks, preferred over `logos` for the same school. */
  athletics?: Logo[];
  athletics_excluded?: Array<{
    unitid: number;
    name: string;
    reasons: string[];
  }>;
};

type Review = {
  unitid: number;
  name: string;
  reason: string;
  source_url: string;
};
const reviews: Review[] = JSON.parse(
  await readFile(join(root, "data/school-logo-review.json"), "utf8"),
);
type Override = {
  unitid: number;
  file_title: string;
  reason: string;
  identity_source_url: string;
};
const overrides: Override[] = JSON.parse(
  await readFile(join(root, "data/school-logo-overrides.json"), "utf8"),
);

if (process.argv.includes("--collect")) await collect();
else if (process.argv.includes("--collect-athletics")) await collectAthletics();
else if (process.argv.includes("--check")) await check();
else if (process.argv.includes("--apply-review")) {
  const manifest: Manifest = JSON.parse(
    await readFile(join(output, "manifest.json"), "utf8"),
  );
  await applyReview(manifest);
  await writeManifest(manifest);
  await writeCredits(manifest);
} else if (process.argv.includes("--optimize")) {
  const manifest: Manifest = JSON.parse(
    await readFile(join(output, "manifest.json"), "utf8"),
  );
  await optimize(manifest);
  await writeManifest(manifest);
} else if (process.argv.includes("--credits"))
  await writeCredits(
    JSON.parse(
      await readFile(join(output, "manifest.json"), "utf8"),
    ) as Manifest,
  );
else
  throw new Error(
    "Use --collect, --collect-athletics, --check, --apply-review, --optimize, or --credits.",
  );

async function request(url: string): Promise<Response> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": userAgent },
      signal: AbortSignal.timeout(60_000),
    });
    if (response.ok) return response;
    if (![429, 502, 503, 504].includes(response.status) || attempt === 3)
      throw new Error(`HTTP ${response.status}: ${url}`);
    const seconds =
      Number(response.headers.get("retry-after")) || 2 ** (attempt + 1);
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(seconds, 60) * 1000),
    );
  }
  throw new Error(`Request failed: ${url}`);
}

async function collect(): Promise<void> {
  await mkdir(cache, { recursive: true });
  await mkdir(output, { recursive: true });
  const csv = parseCSV(
    await readFile(join(root, "data/schools_seed.csv"), "utf8"),
  );
  const headers = csv.shift()!;
  const schools = new Map(
    csv.map((row) => {
      const school = Object.fromEntries(
        headers.map((key, index) => [key, row[index]]),
      );
      return [school.unitid, school];
    }),
  );
  const queryURL = new URL("https://query.wikidata.org/sparql");
  queryURL.search = new URLSearchParams({ query, format: "json" }).toString();
  const queryFile = process.argv
    .find((argument) => argument.startsWith("--query-file="))
    ?.slice(13);
  const data: { results: { bindings: Binding[] } } = queryFile
    ? JSON.parse(await readFile(queryFile, "utf8"))
    : await (await request(queryURL.href)).json();
  const matches = data.results.bindings
    .filter((binding) => schools.has(binding.unitid.value))
    .map((binding) => {
      const override = overrides.find(
        (candidate) => candidate.unitid === Number(binding.unitid.value),
      );
      return override
        ? {
            ...binding,
            logo: {
              value: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(override.file_title.slice(5))}`,
            },
          }
        : binding;
    });
  const titles = [...new Set(matches.map(fileTitle))].sort();
  const images = new Map<string, ImageInfo>();
  for (let offset = 0; offset < titles.length; offset += 50) {
    const batch = titles.slice(offset, offset + 50);
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      prop: "imageinfo",
      iiprop: "url|size|mime|extmetadata|sha1",
      titles: batch.join("|"),
    });
    const key = createHash("sha256")
      .update(new Date().toISOString().slice(0, 10))
      .update(batch.join("|"))
      .digest("hex");
    const metadataFile = join(cache, `${key}.json`);
    let metadata: CommonsResponse;
    try {
      metadata = JSON.parse(await readFile(metadataFile, "utf8"));
    } catch {
      metadata = (await (
        await request(
          `https://commons.wikimedia.org/w/api.php?${params.toString()}`,
        )
      ).json()) as CommonsResponse;
      if (metadata.error || !metadata.query)
        throw new Error(metadata.error?.info ?? "Missing metadata");
      await writeFile(metadataFile, JSON.stringify(metadata));
    }
    for (const page of Object.values(metadata.query?.pages ?? {})) {
      if (page.imageinfo?.[0])
        images.set(page.title.replaceAll("_", " "), page.imageinfo[0]);
    }
    console.log(
      `License metadata: ${Math.min(offset + 50, titles.length)}/${titles.length}`,
    );
  }
  const manifest: Manifest = {
    generated_at: new Date().toISOString(),
    catalog_count: schools.size,
    candidate_count: new Set(matches.map((binding) => binding.unitid.value))
      .size,
    query_url: queryURL.href,
    matching_method:
      "Exact College Scorecard UNITID = Wikidata P1771 (IPEDS ID), with P154 logo and documented rebrand overrides; one institution per ID, no branch inheritance.",
    logos: [],
    excluded: [],
  };
  const ids = [
    ...new Set(matches.map((binding) => binding.unitid.value)),
  ].sort();
  // Sequential workers per school, bounded concurrency against the public host.
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        const school = schools.get(id)!;
        const candidates = matches.filter(
          (binding) => binding.unitid.value === id,
        );
        const reasons = new Set<string>();
        if (
          new Set(candidates.map((binding) => binding.item.value)).size !== 1
        ) {
          manifest.excluded.push({
            unitid: Number(id),
            name: school.name,
            reasons: ["Ambiguous Wikidata institutions for this IPEDS ID"],
          });
          continue;
        }
        candidates.sort(
          (a, b) => candidateScore(b, images) - candidateScore(a, images),
        );
        for (const binding of candidates) {
          const title = fileTitle(binding);
          const info = images.get(title);
          try {
            if (!info) throw new Error("Image unavailable in Commons");
            const metadata = info.extmetadata;
            const field = (name: string) =>
              plainText(metadata[name]?.value ?? "");
            const license = field("LicenseShortName");
            if (
              !/^(Public domain|CC0|CC BY(?:-SA)? (?:[1-4]\.0|2\.5))$/.test(
                license,
              )
            )
              throw new Error(
                `Unapproved or unclear copyright terms: ${license}`,
              );
            if (
              /seal|athletic|sports|anniversary|historical|former|\bold logo|\(old\)|\bflag\b|monochrome|white\.svg/i.test(
                title,
              )
            )
              throw new Error(
                "Seal, athletics, historical, anniversary, or unsuitable variant",
              );
            if (
              !/logo|wordmark|logotype/i.test(
                `${title} ${field("ImageDescription")}`,
              )
            )
              throw new Error(
                "Not identified as an institutional logo/wordmark",
              );
            const extension = new Map([
              ["image/svg+xml", "svg"],
              ["image/png", "png"],
              ["image/jpeg", "jpg"],
            ]).get(info.mime);
            if (
              !extension ||
              info.size > 2 * 1024 * 1024 ||
              info.width < 20 ||
              info.height < 20 ||
              Math.max(info.width, info.height) > 8192
            )
              throw new Error("Unsupported format, file size, or dimensions");
            const author = field("Artist");
            const attribution = field("Attribution");
            const required = field("AttributionRequired") === "true";
            if (required && !author && !attribution)
              throw new Error("Missing required author/credit");
            const downloadURL = new URL(info.url);
            downloadURL.search = "";
            if (
              downloadURL.protocol !== "https:" ||
              downloadURL.hostname !== "upload.wikimedia.org"
            )
              throw new Error("Unexpected download host");
            const imageCache = join(cache, `${info.sha1}.${extension}`);
            let bytes: Buffer;
            try {
              bytes = await readFile(imageCache);
              if (createHash("sha1").update(bytes).digest("hex") !== info.sha1)
                throw new Error("Invalid cached source bytes");
            } catch {
              const response = await request(downloadURL.href);
              if (
                response.headers.get("content-type")?.split(";")[0] !==
                info.mime
              )
                throw new Error("Downloaded MIME type differs from metadata");
              bytes = Buffer.from(await response.arrayBuffer());
            }
            if (
              createHash("sha1").update(bytes).digest("hex") !== info.sha1 ||
              bytes.length !== info.size
            )
              throw new Error(
                "Downloaded bytes do not match Commons hash/size",
              );
            validateImage(bytes, info.mime);
            await writeFile(imageCache, bytes);
            const sha256 = createHash("sha256").update(bytes).digest("hex");
            const asset = `/school-logos/${id}-${sha256.slice(0, 12)}.${extension}`;
            await writeFile(join(output, asset.split("/").at(-1)!), bytes);
            const creditHTML = metadata.Credit?.value ?? "";
            const originalURLs = [
              ...creditHTML.matchAll(/href="(https?:\/\/[^"<>]+)"/g),
            ].map((match) => match[1].replaceAll("&amp;", "&"));
            const licenseURL = field("LicenseUrl");
            manifest.logos.push({
              unitid: Number(id),
              name: school.name,
              slug: school.slug,
              website_url: school.website_url,
              asset,
              wikidata_url: binding.item.value.replace("http:", "https:"),
              wikidata_label: binding.label?.value ?? "",
              identity_note:
                overrides.find((candidate) => candidate.unitid === Number(id))
                  ?.reason ?? "Exact IPEDS identifier match.",
              identity_source_url:
                overrides.find((candidate) => candidate.unitid === Number(id))
                  ?.identity_source_url ??
                binding.item.value.replace("http:", "https:"),
              file_title: title,
              source_url: info.descriptionurl,
              original_source: field("Credit"),
              original_source_urls: originalURLs,
              author,
              license,
              license_url: /^https?:\/\//.test(licenseURL)
                ? licenseURL.replace("http:", "https:")
                : "https://commons.wikimedia.org/wiki/Commons:Public_domain",
              attribution_required: required,
              attribution,
              restrictions:
                field("Restrictions") ||
                "Institutional trademarks may apply independently of copyright.",
              width: info.width,
              height: info.height,
              mime: info.mime,
              bytes: bytes.length,
              sha256,
              download_url: downloadURL.href,
              retrieved_at: manifest.generated_at,
            });
            break;
          } catch (error) {
            reasons.add(error instanceof Error ? error.message : String(error));
          }
        }
        if (!manifest.logos.some((logo) => logo.unitid === Number(id)))
          manifest.excluded.push({
            unitid: Number(id),
            name: school.name,
            reasons: [...reasons],
          });
        if (cursor % 50 === 0)
          console.log(
            `Images: ${cursor}/${ids.length}, accepted ${manifest.logos.length}`,
          );
      }
    }),
  );
  manifest.logos.sort((a, b) => a.unitid - b.unitid);
  await applyReview(manifest);
  await optimize(manifest);
  manifest.excluded.sort((a, b) => a.unitid - b.unitid);
  await writeManifest(manifest);
  await writeCredits(manifest);
  console.log(
    `Bundled ${manifest.logos.length}/${schools.size} schools; ${ids.length - manifest.logos.length} candidate schools excluded; ${schools.size - ids.length} without a Wikidata logo match.`,
  );
}

type TeamBinding = {
  team: { value: string };
  teamLabel?: { value: string };
  unitid: { value: string };
  logo?: { value: string };
  article?: { value: string };
};
type WikiResponse = {
  query?: {
    normalized?: Array<{ from: string; to: string }>;
    pages: Record<
      string,
      {
        title: string;
        imageinfo?: Array<
          ImageInfo & {
            thumburl?: string;
            thumbwidth?: number;
            thumbheight?: number;
          }
        >;
        revisions?: Array<{ slots: { main: { "*": string } } }>;
      }
    >;
  };
};

// Athletics marks are compact and read well in a small square, unlike most
// institutional wordmarks. A program is matched through the institution it
// represents (Wikidata P1268), itself matched by exact IPEDS ID. The logo is
// the one in the program's English Wikipedia infobox, else Wikidata's P154.
// Many are non-free: only a reduced-size copy is kept, for identification.
async function collectAthletics(): Promise<void> {
  await mkdir(cache, { recursive: true });
  const manifest: Manifest = JSON.parse(
    await readFile(join(output, "manifest.json"), "utf8"),
  );
  const csv = parseCSV(
    await readFile(join(root, "data/schools_seed.csv"), "utf8"),
  );
  const headers = csv.shift()!;
  const schools = new Map(
    csv.map((row) => {
      const school = Object.fromEntries(
        headers.map((key, index) => [key, row[index]]),
      );
      return [school.unitid, school];
    }),
  );
  const queryURL = new URL("https://query.wikidata.org/sparql");
  queryURL.search = new URLSearchParams({
    format: "json",
    query: `SELECT ?team ?teamLabel ?unitid ?logo ?article WHERE {
      ?team wdt:P1268 ?school; wdt:P31 wd:Q2367225. ?school wdt:P1771 ?unitid.
      OPTIONAL { ?team wdt:P154 ?logo }
      OPTIONAL { ?article schema:about ?team; schema:isPartOf <https://en.wikipedia.org/> }
      OPTIONAL { ?team rdfs:label ?teamLabel. FILTER(LANG(?teamLabel) = "en") }
    }`,
  }).toString();
  const bindings: TeamBinding[] = (
    (await (await request(queryURL.href)).json()) as {
      results: { bindings: TeamBinding[] };
    }
  ).results.bindings.filter((binding) => schools.has(binding.unitid.value));
  const athleticsReviews: Review[] = JSON.parse(
    await readFile(
      join(root, "data/school-athletics-logo-review.json"),
      "utf8",
    ),
  );
  const excluded: NonNullable<Manifest["athletics_excluded"]> =
    athleticsReviews.map((review) => ({
      unitid: review.unitid,
      name: review.name,
      reasons: [`${review.reason} Source: ${review.source_url}`],
    }));
  const logos: Logo[] = [];
  // One program per school and one school per program; never inherit.
  const programs = new Map<string, TeamBinding[]>();
  for (const id of new Set(bindings.map((binding) => binding.unitid.value))) {
    if (athleticsReviews.some((review) => review.unitid === Number(id)))
      continue;
    const mine = bindings.filter((binding) => binding.unitid.value === id);
    const shared = bindings.some(
      (binding) =>
        binding.team.value === mine[0].team.value &&
        binding.unitid.value !== id,
    );
    if (new Set(mine.map((binding) => binding.team.value)).size !== 1 || shared)
      excluded.push({
        unitid: Number(id),
        name: schools.get(id)!.name,
        reasons: ["Ambiguous athletics program for this IPEDS ID"],
      });
    else programs.set(id, mine);
  }
  // A batch's content can exceed one response; follow `continue` to the end.
  const wiki = async (params: Record<string, string>) => {
    const pages: NonNullable<WikiResponse["query"]>["pages"][string][] = [];
    const normalized = new Map<string, string>();
    let next: Record<string, string> | undefined = {};
    while (next) {
      const data = (await (
        await request(
          `https://en.wikipedia.org/w/api.php?${new URLSearchParams({ action: "query", format: "json", ...params, ...next }).toString()}`,
        )
      ).json()) as WikiResponse & { continue?: Record<string, string> };
      pages.push(...Object.values(data.query?.pages ?? {}));
      for (const { from, to } of data.query?.normalized ?? [])
        normalized.set(to, from);
      next = data.continue;
    }
    return { pages, normalized };
  };
  const fileName = (value: string) => {
    const name = value.replaceAll("_", " ").trim();
    return `File:${name[0].toUpperCase()}${name.slice(1)}`;
  };
  const articles = new Map<string, string>();
  for (const [id, mine] of programs) {
    const article = mine.find((binding) => binding.article)?.article?.value;
    if (article)
      articles.set(
        decodeURIComponent(article.split("/wiki/")[1]).replaceAll("_", " "),
        id,
      );
  }
  const infobox = new Map<string, string>();
  const articleTitles = [...articles.keys()];
  for (let offset = 0; offset < articleTitles.length; offset += 50) {
    const data = await wiki({
      prop: "revisions",
      rvprop: "content",
      rvslots: "main",
      rvsection: "0",
      titles: articleTitles.slice(offset, offset + 50).join("|"),
    });
    for (const page of data.pages) {
      const id = articles.get(page.title);
      const match = page.revisions?.[0]?.slots.main["*"].match(
        /\|\s*(?:logo|image)\s*=\s*(?:\[\[)?(?:File:|Image:)?\s*([^|\]\n{}]+?\.(?:svg|png|jpe?g))/i,
      );
      if (id && match) infobox.set(id, fileName(match[1]));
    }
    console.log(
      `Infoboxes: ${Math.min(offset + 50, articleTitles.length)}/${articleTitles.length}`,
    );
  }
  const candidates = new Map<string, string[]>();
  for (const [id, mine] of programs)
    candidates.set(id, [
      ...new Set([
        ...(infobox.has(id) ? [infobox.get(id)!] : []),
        ...mine
          .filter((binding) => binding.logo)
          .map((binding) =>
            fileName(
              decodeURIComponent(
                binding.logo!.value.split("/Special:FilePath/")[1],
              ),
            ),
          ),
      ]),
    ]);
  const titles = [...new Set([...candidates.values()].flat())].sort();
  const images = new Map<
    string,
    NonNullable<WikiResponse["query"]>["pages"][string]["imageinfo"]
  >();
  for (let offset = 0; offset < titles.length; offset += 50) {
    const data = await wiki({
      prop: "imageinfo",
      iiprop: "url|size|mime|extmetadata",
      iiurlwidth: "330",
      titles: titles.slice(offset, offset + 50).join("|"),
    });
    for (const page of data.pages)
      if (page.imageinfo?.[0])
        images.set(
          data.normalized.get(page.title) ?? page.title,
          page.imageinfo,
        );
    console.log(
      `Metadata: ${Math.min(offset + 50, titles.length)}/${titles.length}`,
    );
  }
  const retrieved = new Date().toISOString();
  const ids = [...programs.keys()].sort();
  let cursor = 0;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.route(/^https?:/, (route) => route.abort());
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        const school = schools.get(id)!;
        const team =
          programs.get(id)!.find((binding) => binding.article) ??
          programs.get(id)![0];
        const reasons = new Set<string>();
        // Prefer a mark that fits a square, then the article's own choice.
        const ordered = candidates
          .get(id)!
          .map((title, index) => ({
            title,
            index,
            info: images.get(title)?.[0],
          }))
          .sort(
            (a, b) =>
              Number(!!b.info && b.info.width / b.info.height <= 1.5) -
                Number(!!a.info && a.info.width / a.info.height <= 1.5) ||
              a.index - b.index,
          );
        if (ordered.length === 0)
          reasons.add("No logo recorded for the program");
        for (const { title, info } of ordered) {
          try {
            if (!info?.thumburl) throw new Error("Image unavailable");
            const field = (name: string) =>
              plainText(info.extmetadata[name]?.value ?? "");
            const nonFree = field("NonFree") === "true";
            const license = nonFree
              ? "Non-free (identification only)"
              : field("LicenseShortName");
            if (
              !nonFree &&
              !/^(Public domain|CC0|CC BY(?:-SA)? (?:[1-4]\.0|2\.5))$/.test(
                license,
              )
            )
              throw new Error(
                `Unapproved or unclear copyright terms: ${license}`,
              );
            if (
              /seal|anniversary|historical|former|\bold logo|\(old\)|\bflag\b|\bwhite\b/i.test(
                title,
              )
            )
              throw new Error(
                "Seal, historical, anniversary, or unsuitable variant",
              );
            if (
              !["image/svg+xml", "image/png", "image/jpeg"].includes(info.mime)
            )
              throw new Error("Unsupported format");
            const downloadURL = new URL(info.thumburl);
            downloadURL.search = "";
            if (
              downloadURL.protocol !== "https:" ||
              !["thumb.wikimedia.org", "upload.wikimedia.org"].includes(
                downloadURL.hostname,
              )
            )
              throw new Error("Unexpected download host");
            const mime =
              info.mime === "image/jpeg" ? "image/jpeg" : "image/png";
            const extension = mime === "image/jpeg" ? "jpg" : "png";
            const imageCache = join(
              cache,
              `athletics-${createHash("sha256").update(downloadURL.href).digest("hex")}.${extension}`,
            );
            let bytes: Buffer;
            try {
              bytes = await readFile(imageCache);
            } catch {
              bytes = Buffer.from(
                await (await request(downloadURL.href)).arrayBuffer(),
              );
            }
            validateImage(bytes, mime);
            await writeFile(imageCache, bytes);
            if ((await visibleShare(page, bytes, mime)) < 0.01)
              throw new Error("Not visible on a light background");
            const sha256 = createHash("sha256").update(bytes).digest("hex");
            const asset = `/school-logos/${id}-athletics-${sha256.slice(0, 12)}.${extension}`;
            await writeFile(join(output, asset.split("/").at(-1)!), bytes);
            const licenseURL = field("LicenseUrl");
            const teamURL = team.team.value.replace("http:", "https:");
            logos.push({
              unitid: Number(id),
              name: school.name,
              slug: school.slug,
              website_url: school.website_url,
              asset,
              wikidata_url: teamURL,
              wikidata_label: team.teamLabel?.value ?? "",
              identity_note:
                "Athletics program that represents the institution with this exact IPEDS identifier.",
              identity_source_url: team.article?.value ?? teamURL,
              file_title: title,
              source_url: info.descriptionurl,
              original_source: field("Credit"),
              original_source_urls: [],
              author: field("Artist") || school.name,
              license,
              license_url: nonFree
                ? "https://en.wikipedia.org/wiki/Wikipedia:Non-free_content"
                : /^https?:\/\//.test(licenseURL)
                  ? licenseURL.replace("http:", "https:")
                  : "https://commons.wikimedia.org/wiki/Commons:Public_domain",
              attribution_required: field("AttributionRequired") === "true",
              attribution: field("Attribution"),
              restrictions:
                "Institutional trademarks apply independently of copyright.",
              width: info.thumbwidth ?? info.width,
              height: info.thumbheight ?? info.height,
              mime,
              bytes: bytes.length,
              sha256,
              download_url: downloadURL.href,
              retrieved_at: retrieved,
              ...(nonFree ? { non_free: true as const } : {}),
            });
            break;
          } catch (error) {
            reasons.add(error instanceof Error ? error.message : String(error));
          }
        }
        if (!logos.some((logo) => logo.unitid === Number(id)))
          excluded.push({
            unitid: Number(id),
            name: school.name,
            reasons: [...reasons],
          });
        if (cursor % 100 === 0)
          console.log(
            `Images: ${cursor}/${ids.length}, accepted ${logos.length}`,
          );
      }
    }),
  );
  await browser.close();
  manifest.athletics = logos.sort((a, b) => a.unitid - b.unitid);
  manifest.athletics_excluded = excluded.sort((a, b) => a.unitid - b.unitid);
  const assets = new Set(logos.map((logo) => logo.asset.split("/").at(-1)));
  for (const file of await readdir(output))
    if (/^\d+-athletics-/.test(file) && !assets.has(file))
      await rm(join(output, file));
  await writeManifest(manifest);
  await writeCredits(manifest);
  console.log(
    `Athletics logos for ${logos.length}/${schools.size} schools (${logos.filter((logo) => logo.non_free).length} non-free); ${excluded.length} programs excluded.`,
  );
}

type BundledLogoEntry = {
  unitid: number;
  slug: string;
  asset: string;
  athletics: boolean;
};

function bundledLogoLookup(manifest: Manifest): string {
  const entries: BundledLogoEntry[] = [
    ...manifest.logos.map(({ unitid, slug, asset }) => ({
      unitid,
      slug,
      asset,
      athletics: false,
    })),
    ...(manifest.athletics ?? []).map(({ unitid, slug, asset }) => ({
      unitid,
      slug,
      asset,
      athletics: true,
    })),
  ];
  return `[\n${entries.map((entry) => `  ${JSON.stringify(entry)}`).join(",\n")}\n]\n`;
}

async function writeManifest(manifest: Manifest): Promise<void> {
  await writeFile(
    join(output, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  await writeFile(apiLookup, bundledLogoLookup(manifest));
}

async function writeCredits(manifest: Manifest): Promise<void> {
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  const rows = [
    ...manifest.logos,
    ...(manifest.athletics ?? []).map((logo) => ({
      ...logo,
      name: `${logo.name} (athletics)`,
    })),
  ]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (logo) =>
        `<tr><th scope="row">${escape(logo.name)}</th><td>${escape(logo.author)}${logo.attribution ? `<br>${escape(logo.attribution)}` : ""}</td><td><a href="${escape(logo.license_url)}">${escape(logo.license)}</a></td><td><a href="${escape(logo.source_url)}">Source and history</a></td></tr>`,
    )
    .join("\n");
  await writeFile(
    join(output, "credits.html"),
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>School logo credits | Campus Gaming Network</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:2rem auto;padding:0 1rem;max-width:80rem;color:#17212e}a{color:#1748b2}table{border-collapse:collapse;width:100%}th,td{padding:.75rem;border-bottom:1px solid #ccd3de;text-align:left;vertical-align:top}.scroll{overflow:auto}p{max-width:65rem}</style></head><body>
<a href="/schools">Browse schools</a><h1>School logo credits</h1>
<p>These institutional logos identify schools in our directory. They do not indicate endorsement or affiliation. School names and marks remain subject to their owners’ trademark rights. Copyright status is recorded from each linked source; it does not grant a trademark license.</p>
<p>Images are copies of the source files, displayed at a smaller size with their proportions preserved. Large PNG and JPEG files are downscaled and are otherwise unaltered; SVG files are unchanged. Athletics marks are reduced-size copies. Those listed as non-free are copyrighted by their institutions and appear only to identify the school. Any ShareAlike terms apply to the respective image, not to the application. Source history and individual license terms are linked below. Full provenance and checksums: <a href="manifest.json">logo manifest</a>.</p>
<div class="scroll"><table><thead><tr><th scope="col">School</th><th scope="col">Author / attribution</th><th scope="col">Copyright terms</th><th scope="col">Source</th></tr></thead><tbody>${rows}</tbody></table></div>
</body></html>\n`,
  );
}

async function applyReview(manifest: Manifest): Promise<void> {
  for (const review of reviews) {
    const logo = manifest.logos.find(
      (candidate) => candidate.unitid === review.unitid,
    );
    if (logo) {
      await rm(join(output, logo.asset.split("/").at(-1)!), { force: true });
      manifest.logos = manifest.logos.filter(
        (candidate) => candidate.unitid !== review.unitid,
      );
    }
    const reason = `${review.reason} Source: ${review.source_url}`;
    const excluded = manifest.excluded.find(
      (candidate) => candidate.unitid === review.unitid,
    );
    if (excluded) {
      if (!excluded.reasons.includes(reason)) excluded.reasons.push(reason);
    } else
      manifest.excluded.push({
        unitid: review.unitid,
        name: review.name,
        reasons: [reason],
      });
  }
  manifest.excluded.sort((a, b) => a.unitid - b.unitid);
  const assets = new Set(
    manifest.logos.map((logo) => logo.asset.split("/").at(-1)),
  );
  for (const file of await readdir(output)) {
    if (/^\d+-[a-f0-9]{12}\.(svg|png|jpg)$/.test(file) && !assets.has(file))
      await rm(join(output, file));
  }
}

// The site shows a logo at most a few hundred pixels wide. Downscale larger
// rasters and keep the source's dimensions and checksum in the manifest.
async function optimize(manifest: Manifest): Promise<void> {
  const limit = 640;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route(/^https?:/, (route) => route.abort());
    for (const logo of manifest.logos) {
      const scale = limit / Math.max(logo.width, logo.height);
      if (logo.mime === "image/svg+xml" || logo.resized_from || scale >= 1)
        continue;
      const name = logo.asset.split("/").at(-1)!;
      const source = await readFile(join(output, name));
      const width = Math.round(logo.width * scale);
      const height = Math.round(logo.height * scale);
      const resized = Buffer.from(
        (
          await page.evaluate<string>(`(async () => {
            const image = new Image();
            image.src = ${JSON.stringify(`data:${logo.mime};base64,${source.toString("base64")}`)};
            await image.decode();
            const bitmap = await createImageBitmap(image, {
              resizeWidth: ${width},
              resizeHeight: ${height},
              resizeQuality: "high",
            });
            const canvas = document.createElement("canvas");
            canvas.width = ${width};
            canvas.height = ${height};
            canvas.getContext("2d").drawImage(bitmap, 0, 0);
            return canvas.toDataURL(${JSON.stringify(logo.mime)}, 0.9);
          })()`)
        ).split(",")[1],
        "base64",
      );
      if (resized.length >= source.length) continue;
      validateImage(resized, logo.mime);
      const sha256 = createHash("sha256").update(resized).digest("hex");
      const asset = `/school-logos/${logo.unitid}-${sha256.slice(0, 12)}.${name.split(".").at(-1)}`;
      await writeFile(join(output, asset.split("/").at(-1)!), resized);
      await rm(join(output, name));
      logo.resized_from = {
        width: logo.width,
        height: logo.height,
        bytes: logo.bytes,
        sha256: logo.sha256,
      };
      Object.assign(logo, {
        asset,
        width,
        height,
        bytes: resized.length,
        sha256,
      });
    }
  } finally {
    await browser.close();
  }
}

async function check(): Promise<void> {
  const manifest: Manifest = JSON.parse(
    await readFile(join(output, "manifest.json"), "utf8"),
  );
  if ((await readFile(apiLookup, "utf8")) !== bundledLogoLookup(manifest))
    throw new Error(
      "The API's bundled logo lookup does not match the manifest; run --apply-review to rewrite it.",
    );
  const csv = parseCSV(
    await readFile(join(root, "data/schools_seed.csv"), "utf8"),
  );
  const headers = csv.shift()!;
  const catalog = new Map(
    csv.map((row) => [
      Number(row[headers.indexOf("unitid")]),
      row[headers.indexOf("slug")],
    ]),
  );
  if (
    catalog.size !== manifest.catalog_count ||
    manifest.logos.some((logo) => catalog.get(logo.unitid) !== logo.slug)
  )
    throw new Error("Logo identity does not match the school seed.");
  if (
    manifest.logos.some((logo) =>
      reviews.some((review) => review.unitid === logo.unitid),
    )
  )
    throw new Error(
      "A reviewed exclusion is still bundled; run --apply-review.",
    );
  if (
    manifest.logos.some((logo) =>
      overrides.some(
        (override) =>
          override.unitid === logo.unitid &&
          override.file_title !== logo.file_title,
      ),
    )
  )
    throw new Error(
      "A reviewed logo correction has not been applied; rerun --collect.",
    );
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route(/^https?:/, (route) => route.abort());
    const ids = new Set<number>();
    const athletics = manifest.athletics ?? [];
    if (athletics.some((logo) => catalog.get(logo.unitid) !== logo.slug))
      throw new Error(
        "Athletics logo identity does not match the school seed.",
      );
    if (new Set(athletics.map((logo) => logo.unitid)).size !== athletics.length)
      throw new Error("Duplicate athletics logo for a school.");
    const all = [...manifest.logos, ...athletics];
    for (const logo of all) {
      if (!athletics.includes(logo)) {
        if (ids.has(logo.unitid))
          throw new Error(`Duplicate school ${logo.unitid}`);
        ids.add(logo.unitid);
      }
      if (
        !/^\/school-logos\/\d+(-athletics)?-[a-f0-9]{12}\.(svg|png|jpg)$/.test(
          logo.asset,
        )
      )
        throw new Error(`Unexpected asset path ${logo.asset}`);
      const bytes = await readFile(join(output, logo.asset.split("/").at(-1)!));
      if (createHash("sha256").update(bytes).digest("hex") !== logo.sha256)
        throw new Error(`Checksum mismatch ${logo.asset}`);
      validateImage(bytes, logo.mime);
      const dimensions = await page.evaluate(
        async (url) => {
          const ImageConstructor = Reflect.get(
            globalThis,
            "Image",
          ) as new () => {
            src: string;
            decode(): Promise<void>;
            naturalWidth: number;
            naturalHeight: number;
          };
          const image = new ImageConstructor();
          image.src = url;
          await image.decode();
          return { width: image.naturalWidth, height: image.naturalHeight };
        },
        `data:${logo.mime};base64,${bytes.toString("base64")}`,
      );
      if (dimensions.width <= 0 || dimensions.height <= 0)
        throw new Error(`Undecodable image ${logo.asset}`);
      if ((await visibleShare(page, bytes, logo.mime)) < 0.01)
        throw new Error(`Not visible on a light background: ${logo.asset}`);
    }
    console.log(
      `Verified hashes, SVG safety, and browser decoding for ${ids.size} institutional and ${athletics.length} athletics logos across ${new Set(all.map((logo) => logo.unitid)).size}/${manifest.catalog_count} schools.`,
    );
    if (process.argv.includes("--preview")) {
      await page.setViewportSize({ width: 1440, height: 1200 });
      const shown = process.argv.includes("--athletics")
        ? athletics
        : manifest.logos;
      for (let offset = 0; offset < shown.length; offset += 96) {
        const cells: string[] = [];
        for (const logo of shown.slice(offset, offset + 96)) {
          const bytes = await readFile(
            join(output, logo.asset.split("/").at(-1)!),
          );
          cells.push(
            `<div><img src="data:${logo.mime};base64,${bytes.toString("base64")}"><p>${plainText(logo.name).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}<br>${logo.unitid}</p></div>`,
          );
        }
        await page.setContent(
          `<html><head><style>body{font:12px system-ui;display:grid;grid-template-columns:repeat(8,1fr);gap:12px;margin:12px}div{border:1px solid #ddd;padding:8px;text-align:center;min-height:112px}img{width:135px;height:60px;object-fit:contain}p{margin:6px 0}</style></head><body>${cells.join("")}</body></html>`,
        );
        await page.evaluate(async () => {
          const document = Reflect.get(globalThis, "document") as {
            images: Iterable<{ decode(): Promise<void> }>;
          };
          await Promise.all(
            Array.from(document.images, (image) => image.decode()),
          );
        });
        const path = join(
          tmpdir(),
          `cgn-school-logo-preview-${offset / 96 + 1}.png`,
        );
        await page.screenshot({ path, fullPage: true });
        console.log(`Preview: ${path}`);
      }
    }
  } finally {
    await browser.close();
  }
}

// The share of a logo's area that shows against the site's white mark. A
// white or blank variant scores zero and would leave an empty square.
async function visibleShare(
  page: Page,
  bytes: Buffer,
  mime: string,
): Promise<number> {
  return page.evaluate<number>(`(async () => {
    const image = new Image();
    image.src = ${JSON.stringify(`data:${mime};base64,${bytes.toString("base64")}`)};
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = Math.max(1, Math.round((64 * image.naturalHeight) / image.naturalWidth));
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let visible = 0;
    for (let index = 0; index < data.length; index += 4)
      if (Math.min(data[index], data[index + 1], data[index + 2]) < 200) visible++;
    return visible / (data.length / 4);
  })()`);
}

function fileTitle(binding: Binding): string {
  return `File:${decodeURIComponent(binding.logo.value.split("/Special:FilePath/")[1])}`.replaceAll(
    "_",
    " ",
  );
}

function candidateScore(
  binding: Binding,
  images: Map<string, ImageInfo>,
): number {
  const title = fileTitle(binding);
  const info = images.get(title);
  const source = info?.extmetadata.Credit?.value ?? "";
  return (
    (title.endsWith(".svg") ? 2 : 0) +
    (/logo|wordmark/i.test(title) ? 2 : 0) +
    (/\.edu\//.test(source) ? 3 : 0)
  );
}

function validateImage(bytes: Buffer, mime: string): void {
  if (
    mime === "image/png" &&
    bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
  )
    return;
  if (
    mime === "image/jpeg" &&
    bytes.subarray(0, 3).toString("hex") === "ffd8ff"
  )
    return;
  if (mime === "image/svg+xml") {
    const svg = bytes.toString("utf8");
    // Reject active content and dependencies. Keep accepted source bytes intact.
    if (
      !/<svg[\s>]/i.test(svg) ||
      /<(?:script|foreignObject|iframe|object|embed|image|feImage|a)\b|\bon\w+\s*=|<!ENTITY|<\?xml-stylesheet|@import/i.test(
        svg,
      )
    )
      throw new Error("SVG contains active/embedded content");
    if (
      [...svg.matchAll(/(?:href|src)\s*=\s*["']([^"']*)["']/gi)].some(
        (match) => !match[1].startsWith("#"),
      ) ||
      [...svg.matchAll(/url\s*\(\s*["']?([^\s)'";]+)/gi)].some(
        (match) => !match[1].startsWith("#"),
      )
    )
      throw new Error("SVG depends on external content");
    return;
  }
  throw new Error(`Unexpected image signature: ${mime}`);
}

function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) =>
      String.fromCodePoint(
        code.startsWith("x") ? parseInt(code.slice(1), 16) : Number(code),
      ),
    )
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCSV(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let index = 0; index < csv.length; index++) {
    const character = csv[index];
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        field += '"';
        index++;
      } else quoted = !quoted;
    } else if (!quoted && (character === "," || character === "\n")) {
      row.push(field.replace(/\r$/, ""));
      field = "";
      if (character === "\n") {
        rows.push(row);
        row = [];
      }
    } else field += character;
  }
  if (quoted) throw new Error("Unterminated quoted CSV field");
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
