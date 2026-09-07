import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitepress";

const docsDirectory = fileURLToPath(new URL("../../../docs", import.meta.url));
const gitLastUpdatedEnabled = process.env.DOCS_GIT_LAST_UPDATED !== "false";
const markdownFiles = readdirSync(docsDirectory)
  .filter((fileName) => fileName.endsWith(".md"))
  .sort((left, right) => {
    if (left === "README.md") return -1;
    if (right === "README.md") return 1;
    return left.localeCompare(right, "en", { numeric: true });
  });

function outputName(fileName: string) {
  if (fileName === "README.md") return "index.md";
  return fileName.replace(/^\d+-/, "");
}

function linkFor(fileName: string) {
  const path = outputName(fileName).replace(/\.md$/, "");
  return path === "index" ? "/" : `/${path}`;
}

function titleFor(fileName: string) {
  const source = readFileSync(`${docsDirectory}/${fileName}`, "utf8");
  const heading = source.match(/^#\s+(.+)$/m)?.[1];
  return heading ?? fileName.replace(/\.md$/, "");
}

const rewrites = Object.fromEntries(
  markdownFiles.map((fileName) => [fileName, outputName(fileName)])
);

const sidebar = markdownFiles.map((fileName) => ({
  text: fileName === "README.md" ? "Overview" : titleFor(fileName),
  link: linkFor(fileName)
}));

export default defineConfig({
  lang: "en-US",
  title: "CGN Docs",
  titleTemplate: ":title · CGN Docs",
  description: "Campus Gaming Network product and engineering reference",
  srcDir: "../../docs",
  outDir: "build",
  cacheDir: ".cache",
  cleanUrls: true,
  lastUpdated: gitLastUpdatedEnabled,
  rewrites,
  head: [["link", { rel: "icon", href: "/img/favicon.svg", type: "image/svg+xml" }]],

  markdown: {
    config(markdown) {
      markdown.renderer.rules.code_inline = (tokens, index) => {
        const escaped = markdown.utils
          .escapeHtml(tokens[index].content)
          .replaceAll("{", "&#123;");
        return `<code>${escaped}</code>`;
      };

      const defaultFence = markdown.renderer.rules.fence;
      markdown.renderer.rules.fence = (tokens, index, options, environment, self) => {
        const token = tokens[index];
        if (token.info.trim() === "mermaid") {
          const encoded = Buffer.from(token.content, "utf8").toString("base64");
          return `<MermaidChart encoded="${encoded}" />`;
        }

        return defaultFence?.(tokens, index, options, environment, self) ?? "";
      };

      const defaultLinkOpen = markdown.renderer.rules.link_open;
      markdown.renderer.rules.link_open = (
        tokens,
        index,
        options,
        environment,
        self
      ) => {
        const token = tokens[index];
        const href = token.attrGet("href");
        if (href?.startsWith("../")) {
          const repoPath = href.replace(/^\.\.\//, "").replace(/\/$/, "");
          const kind = href.endsWith("/") ? "tree" : "blob";
          token.attrSet(
            "href",
            `https://github.com/Campus-Gaming-Network/core/${kind}/main/${repoPath}`
          );
          token.attrSet("target", "_blank");
          token.attrSet("rel", "noreferrer");
        } else if (href === "./") {
          token.attrSet("href", "/");
        } else {
          const localDoc = href?.match(/^\.\/([^?#]+\.md)([?#].*)?$/);
          if (localDoc) {
            token.attrSet("href", `${linkFor(localDoc[1])}${localDoc[2] ?? ""}`);
          }
        }

        return defaultLinkOpen?.(tokens, index, options, environment, self) ??
          self.renderToken(tokens, index, options);
      };
    }
  },

  themeConfig: {
    logo: "/img/mark.svg",
    siteTitle: "CGN Docs",
    nav: [
      { text: "Current state", link: "/current-state" },
      { text: "Action plan", link: "/codebase-review-action-plan" },
      { text: "Open product", link: "http://localhost:3000" }
    ],
    sidebar,
    outline: {
      level: [2, 4],
      label: "On this page"
    },
    search: {
      provider: "local"
    },
    editLink: {
      pattern:
        "https://github.com/Campus-Gaming-Network/core/edit/main/docs/:path",
      text: "Edit this page on GitHub"
    },
    docFooter: {
      prev: "Previous",
      next: "Next"
    },
    lastUpdated: {
      text: "Last updated",
      formatOptions: {
        dateStyle: "medium",
        timeStyle: "short"
      }
    },
    footer: {
      message: "Campus Gaming Network · Local documentation"
    }
  }
});
