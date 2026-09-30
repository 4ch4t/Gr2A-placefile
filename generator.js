import fs from "node:fs/promises";
import path from "node:path";
import * as turf from "@turf/turf";

// --- КОНФИГУРАЦИЯ СТИЛЕЙ И ОПЦИЙ ---
const CONFIG = {
  // Заголовок и интервал обновления (в минутах) для GRLevelX
  title: "MeteoAlarm Europe & Ukraine (Pro Spatial)",
  refreshMinutes: 2,

  // Настройка контуров: true - рисовать тончайший контур, false - только прозрачная заливка
  drawOutlines: true,

  // Цветовые схемы RGBA (Red Green Blue Alpha [0-255])
  colors: {
    Extreme:  { fill: "255 0 0 18",    line: "255 50 50 45" },   // Красный
    Severe:   { fill: "255 130 0 16",  line: "255 160 0 45" },  // Оранжевый
    Moderate: { fill: "235 215 0 14",  line: "200 190 0 40" },  // Желтый
    Minor:    { fill: "0 170 230 12",  line: "0 130 200 35" }   // Голубой
  },

  // Точность сглаживания геометрии (уменьшает размер файла и ускоряет рендеринг в GRLevelX)
  simplifyTolerance: 0.001
};

const METEOALARM_FEEDS = [
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
  console.log("Starting MeteoAlarm Placefile Generation...");
  const warnings = await fetchAllFeeds();
  console.log(`Fetched ${warnings.length} active warning entries.`);

  // Группировка геометрий по уровню опасности
  const groups = {
    Extreme: [],
    Severe: [],
    Moderate: [],
    Minor: []
  };

  for (const w of warnings) {
    const sev = groups[w.severity] ? w.severity : "Moderate";
    const polyFeature = turf.polygon([w.polygon], {
      title: w.title,
      areaDesc: w.areaDesc,
      severity: sev
    });
    groups[sev].push(polyFeature);
  }

  const outputLines = [
    `Title: ${CONFIG.title}`,
    `Refresh: ${CONFIG.refreshMinutes}`,
    ""
  ];

  // Обработка каждой группы уровней предупреждений
  for (const [severity, features] of Object.entries(groups)) {
    if (features.length === 0) continue;

    console.log(`Processing ${features.length} regions for severity level: ${severity}`);
    const mergedFeatures = mergeAndSimplify(features);
    const colorSpec = CONFIG.colors[severity] || CONFIG.colors.Moderate;

    for (const feat of mergedFeatures) {
      const coordsRings = feat.geometry.type === "Polygon" 
        ? [feat.geometry.coordinates] 
        : feat.geometry.coordinates;

      for (const rings of coordsRings) {
        const outerRing = rings[0];
        if (!outerRing || outerRing.length < 3) continue;

        // 1. Отрисовка заливки (Polygon)
        outputLines.push(`Color: ${colorSpec.fill}`);
        outputLines.push(`Polygon:`);
        for (const [lon, lat] of outerRing) {
          outputLines.push(`  ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
        }
        outputLines.push("End:");

        // 2. Отрисовка тонкого сглаженного контура (Line), если включено
        if (CONFIG.drawOutlines) {
          outputLines.push(`Color: ${colorSpec.line}`);
          outputLines.push(`Line: 1, 0, "${severity} Warning"`);
          for (const [lon, lat] of outerRing) {
            outputLines.push(`  ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
          }
          outputLines.push("End:");
        }
        outputLines.push("");
      }
    }
  }

  // Запись итогового файла в директорию public
  const publicDir = path.join(process.cwd(), "public");
  await fs.mkdir(publicDir, { recursive: true });
  const outputPath = path.join(publicDir, "placefile.txt");
  
  await fs.writeFile(outputPath, outputLines.join("\n"), "utf-8");
  console.log(`Placefile successfully generated at: ${outputPath}`);
}

/**
 * Объединяет пересекающиеся/смежные полигоны с помощью Turf.js
 */
function mergeAndSimplify(features) {
  if (features.length === 1) {
    return [turf.simplify(features[0], { tolerance: CONFIG.simplifyTolerance, highQuality: true })];
  }

  try {
    const fc = turf.featureCollection(features);
    const combined = turf.combine(fc);
    let unionResult = null;

    // Последовательное пространственное объединение геометрий
    for (const feat of features) {
      if (!unionResult) {
        unionResult = feat;
      } else {
        try {
          unionResult = turf.union(turf.featureCollection([unionResult, feat]));
        } catch {
          // Игнорируем ошибки топологии CAP геометрий, если полигоны повреждены
        }
      }
    }

    if (!unionResult) return features;

    const simplified = turf.simplify(unionResult, {
      tolerance: CONFIG.simplifyTolerance,
      highQuality: true
    });

    return simplified.geometry.type === "MultiPolygon"
      ? turf.flatten(simplified).features
      : [simplified];
  } catch (err) {
    console.warn("Spatial union fallback to raw features:", err.message);
    return features;
  }
}

/**
 * Параллельная загрузка XML-фидов с таймаутами
 */
async function fetchAllFeeds() {
  const promises = METEOALARM_FEEDS.map(async (url) => {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "GRLevelX-Placefile-Generator/2.0" },
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) return [];
      const xmlText = await res.text();
      return parseAtomFeed(xmlText);
    } catch {
      return [];
    }
  });

  const results = await Promise.allSettled(promises);
  const warnings = [];

  for (const r of results) {
    if (r.status === "fulfilled" && Array.isArray(r.value)) {
      warnings.push(...r.value);
    }
  }

  return warnings;
}

/**
 * Парсер XML Atom Feed
 */
function parseAtomFeed(xml) {
  const warnings = [];
  let entryStart = xml.indexOf("<entry>");

  while (entryStart !== -1) {
    const entryEnd = xml.indexOf("</entry>", entryStart);
    if (entryEnd === -1) break;

    const entry = xml.substring(entryStart, entryEnd);
    const polygonStr = extractTag(entry, "cap:polygon");

    if (polygonStr) {
      const severity = extractTag(entry, "cap:severity") || "Moderate";
      const title = extractTag(entry, "title") || "Weather Warning";
      const areaDesc = extractTag(entry, "cap:areaDesc") || "";

      const rawPoints = polygonStr.trim().split(/\s+/);
      const polygon = [];

      for (let i = 0; i < rawPoints.length; i++) {
        const parts = rawPoints[i].split(",");
        if (parts.length === 2) {
          const lat = parseFloat(parts[0]);
          const lon = parseFloat(parts[1]);
          if (!isNaN(lat) && !isNaN(lon)) {
            polygon.push([lon, lat]); // GeoJSON формат: [lon, lat]
          }
        }
      }

      // Валидация замкнутого полигона
      if (polygon.length >= 3) {
        const first = polygon[0];
        const last = polygon[polygon.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          polygon.push([first[0], first[1]]);
        }
        warnings.push({ severity, title, areaDesc, polygon });
      }
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
  console.error("Fatal build error:", err);
  process.exit(1);
});
