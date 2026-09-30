import fs from "node:fs/promises";
import path from "node:path";

const CONFIG = {
  title: "MeteoAlarm Europe Warnings",
  refreshMinutes: 2,
  
  // Цвета для GRLevelX (RGBA, alpha 0-255)
  colors: {
    Extreme:  { fill: "255 0 0 40",    line: "255 0 0 255" },     // Красный
    Severe:   { fill: "255 140 0 35",  line: "255 140 0 255" },   // Оранжевый
    Moderate: { fill: "240 210 0 30",  line: "210 180 0 255" },   // Желтый
    Minor:    { fill: "0 170 230 25",  line: "0 130 200 255" }    // Голубой
  }
};

// Все 39 стран MeteoAlarm
const FEEDS = [
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-andorra",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-austria",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-belgium",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-bosnia-herzegovina",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-bulgaria",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-croatia",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-cyprus",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-czechia",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-denmark",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-estonia",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-finland",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-france",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-germany",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-greece",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-hungary",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-iceland",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-ireland",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-israel",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-italy",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-latvia",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-lithuania",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-luxembourg",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-malta",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-moldova",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-montenegro",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-netherlands",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-norway",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-poland",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-portugal",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-republic-of-north-macedonia",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-romania",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-serbia",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-slovakia",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-slovenia",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-spain",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-sweden",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-switzerland",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-ukraine",
  "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-united-kingdom"
];

async function main() {
  console.log("Starting MeteoAlarm Europe Placefile generation...");

  const warnings = await fetchAllFeeds();
  console.log(`Parsed ${warnings.length} total active warnings with polygons.`);

  const outputLines = [
    `Title: ${CONFIG.title}`,
    `Refresh: ${CONFIG.refreshMinutes}`,
    ""
  ];

  let totalPolygons = 0;

  for (const w of warnings) {
    const colorSpec = CONFIG.colors[w.severity] || CONFIG.colors.Moderate;

    for (const poly of w.polygons) {
      if (!poly || poly.length < 3) continue;

      // Заливка
      outputLines.push(`Color: ${colorSpec.fill}`);
      outputLines.push(`Polygon:`);
      for (const [lat, lon] of poly) {
        outputLines.push(`  ${lat.toFixed(5)}, ${lon.toFixed(5)}`);
      }
      outputLines.push("End:");

      // Контур
      outputLines.push(`Color: ${colorSpec.line}`);
      outputLines.push(`Line: 1, 0, "${w.title.replace(/"/g, "'")}"`);
      for (const [lat, lon] of poly) {
        outputLines.push(`  ${lat.toFixed(5)}, ${lon.toFixed(5)}`);
      }
      outputLines.push("End:");
      outputLines.push("");

      totalPolygons++;
    }
  }

  const publicDir = path.join(process.cwd(), "public");
  await fs.mkdir(publicDir, { recursive: true });
  const outputPath = path.join(publicDir, "placefile.txt");

  await fs.writeFile(outputPath, outputLines.join("\n"), "utf-8");
  console.log(`Successfully generated ${outputPath} with ${totalPolygons} polygons.`);
}

async function fetchAllFeeds() {
  const promises = FEEDS.map(async (url) => {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "GRLevelX-Europe-Placefile/1.0" },
        signal: AbortSignal.timeout(6000)
      });
      if (!res.ok) return [];
      const xml = await res.text();
      return parseFeed(xml);
    } catch {
      return [];
    }
  });

  const results = await Promise.allSettled(promises);
  const allWarnings = [];

  for (const res of results) {
    if (res.status === "fulfilled" && Array.isArray(res.value)) {
      allWarnings.push(...res.value);
    }
  }

  return allWarnings;
}

function parseFeed(xml) {
  const warnings = [];
  let entryStart = xml.indexOf("<entry>");

  while (entryStart !== -1) {
    const entryEnd = xml.indexOf("</entry>", entryStart);
    if (entryEnd === -1) break;

    const entry = xml.substring(entryStart, entryEnd);
    const title = extractTag(entry, "title") || "Weather Warning";
    const severity = extractTag(entry, "cap:severity") || "Moderate";

    const polygons = [];
    let polyMatch;
    const polyRegex = /<cap:polygon>([\s\S]*?)<\/cap:polygon>/g;

    while ((polyMatch = polyRegex.exec(entry)) !== null) {
      const rawPoints = polyMatch[1].trim().split(/\s+/);
      const points = [];

      for (const pt of rawPoints) {
        const parts = pt.split(",");
        if (parts.length === 2) {
          const lat = parseFloat(parts[0]);
          const lon = parseFloat(parts[1]);
          if (!isNaN(lat) && !isNaN(lon)) {
            points.push([lat, lon]);
          }
        }
      }

      if (points.length >= 3) {
        // Замыкаем кольцо если надо
        const first = points[0];
        const last = points[points.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          points.push([first[0], first[1]]);
        }
        polygons.push(points);
      }
    }

    if (polygons.length > 0) {
      warnings.push({ title, severity, polygons });
    }

    entryStart = xml.indexOf("<entry>", entryEnd);
  }

  return warnings;
}

function extractTag(text, tag) {
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  const start = text.indexOf(openTag);
  if (start === -1) return null;
  const end = text.indexOf(closeTag, start + openTag.length);
  if (end === -1) return null;
  return text.substring(start + openTag.length, end).trim();
}

main().catch((err) => {
  console.error("Build error:", err);
  process.exit(1);
});
