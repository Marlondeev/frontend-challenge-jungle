import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import lighthouse from "lighthouse";
import desktopConfig from "lighthouse/core/config/desktop-config.js";
import { launch } from "chrome-launcher";
import { chromium } from "@playwright/test";
import { preview } from "vite";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(
  await fs.readFile(path.join(root, "lighthouse/config.json"), "utf8"),
);
const output = path.join(root, "lighthouse/reports");
await fs.mkdir(output, { recursive: true });
const version = (name) => require(`${name}/package.json`).version;
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const runs = Number(process.env.LIGHTHOUSE_RUNS ?? config.runs);
if (!Number.isSafeInteger(runs) || runs < 1)
  throw new Error("LIGHTHOUSE_RUNS must be a positive integer");
const build = await fs.readFile(path.join(root, "dist/index.html"));
const environment = {
  measuredAt: new Date().toISOString(),
  node: process.version,
  lighthouse: version("lighthouse"),
  playwright: version("@playwright/test"),
  platform: os.platform(),
  release: os.release(),
  arch: os.arch(),
  cpu: os.cpus()[0]?.model,
  logicalCpus: os.cpus().length,
  memoryGiB: Math.round(os.totalmem() / 1024 ** 3),
  buildIndexSha256: crypto.createHash("sha256").update(build).digest("hex"),
  conditions: config.conditions,
};
let server;
const measurements = [];
try {
  if (!process.env.AUDIT_BASE_URL)
    server = await preview({
      root,
      preview: { host: "127.0.0.1", port: 4173, strictPort: true },
    });
  const base = process.env.AUDIT_BASE_URL ?? "http://127.0.0.1:4173";
  for (const [pageName, pathname] of Object.entries(config.pages)) {
    for (const profile of config.profiles) {
      for (let run = 1; run <= runs; run++) {
        console.log(`[Lighthouse] ${pageName} / ${profile} — ${run}/${runs}`);
        const chrome = await launch({
          chromePath: chromium.executablePath(),
          chromeFlags: [
            "--headless=new",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-extensions",
          ],
        });
        try {
          const result = await lighthouse(
            new URL(pathname, base).href,
            {
              port: chrome.port,
              logLevel: "error",
              output: ["html", "json"],
              onlyCategories: Object.keys(config.targets),
            },
            profile === "desktop" ? desktopConfig : undefined,
          );
          if (!result || result.lhr.runtimeError)
            throw new Error(
              result?.lhr.runtimeError?.message ??
                "Lighthouse returned no report",
            );
          const name = `${pageName}-${profile}-${run}`;
          const reports = Array.isArray(result.report)
            ? result.report
            : [result.report, JSON.stringify(result.lhr)];
          await fs.writeFile(path.join(output, `${name}.html`), reports[0]);
          await fs.writeFile(
            path.join(output, `${name}.json`),
            reports[1] ?? JSON.stringify(result.lhr),
          );
          const lhr = result.lhr;
          measurements.push({
            page: pageName,
            profile,
            run,
            scores: Object.fromEntries(
              Object.entries(lhr.categories).map(([key, value]) => [
                key,
                Math.round((value.score ?? 0) * 100),
              ]),
            ),
            metrics: {
              LCP: lhr.audits["largest-contentful-paint"].numericValue,
              CLS: lhr.audits["cumulative-layout-shift"].numericValue,
              TBT: lhr.audits["total-blocking-time"].numericValue,
            },
            settings: lhr.configSettings,
            browser: lhr.environment.hostUserAgent,
            report: `${name}.html`,
          });
          console.log(JSON.stringify(measurements.at(-1).scores));
        } finally {
          await chrome.kill();
        }
      }
    }
  }
  const medians = [];
  for (const page of Object.keys(config.pages))
    for (const profile of config.profiles) {
      const values = measurements.filter(
        (item) => item.page === page && item.profile === profile,
      );
      const scores = Object.fromEntries(
        Object.keys(config.targets).map((key) => [
          key,
          median(values.map((item) => item.scores[key])),
        ]),
      );
      medians.push({
        page,
        profile,
        runs: values.length,
        scores,
        metrics: Object.fromEntries(
          ["LCP", "CLS", "TBT"].map((key) => [
            key,
            median(values.map((item) => item.metrics[key])),
          ]),
        ),
        belowTargets: Object.keys(config.targets).filter(
          (key) => scores[key] < config.targets[key],
        ),
      });
    }
  const summary = { environment, config, measurements, medians };
  await fs.writeFile(
    path.join(output, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  let markdown =
    "# Lighthouse: medições da entrega\n\n" +
    config.conditions +
    "\n\n| Página | Perfil | Performance | Acessibilidade | Boas práticas | SEO | LCP (ms) | CLS | TBT (ms) |\n|---|---|---:|---:|---:|---:|---:|---:|---:|\n";
  for (const item of medians)
    markdown += `| ${item.page} | ${item.profile} | ${item.scores.performance} | ${item.scores.accessibility} | ${item.scores["best-practices"]} | ${item.scores.seo} | ${Math.round(item.metrics.LCP)} | ${item.metrics.CLS.toFixed(4)} | ${Math.round(item.metrics.TBT)} |\n`;
  markdown +=
    "\nResultados são medianas de " +
    runs +
    " execuções por página/perfil. Os relatórios HTML/JSON individuais e o ambiente completo estão neste diretório.\n";
  markdown +=
    "\n" +
    medians
      .filter((item) => item.belowTargets.length)
      .map(
        (item) =>
          `- ${item.page}/${item.profile}: abaixo da meta em ${item.belowTargets.join(", ")}; consultar oportunidades e diagnósticos nos relatórios individuais e a análise em ARCHITECTURE.md.`,
      )
      .join("\n") +
    "\n";
  await fs.writeFile(path.join(output, "SUMMARY.md"), markdown);
  console.log(JSON.stringify({ medians, output }, null, 2));
} finally {
  if (server) await new Promise((resolve) => server.httpServer.close(resolve));
}
// This standalone CLI has awaited its reports and every owned browser/server.
// Explicitly finish so retained third-party handles cannot keep npm audit open.
await new Promise((resolve) => process.stdout.write("", resolve));
process.exit(0);
