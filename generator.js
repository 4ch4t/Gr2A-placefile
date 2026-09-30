import fs from "node:fs/promises";
import path from "node:path";
import * as turf from "@turf/turf";

// --- КОНФИГУРАЦИЯ СТИЛЕЙ И ОПЦИЙ ---
const CONFIG = {
  title: "MeteoAlarm Europe & Ukraine Warnings",
  refreshMinutes: 2,
  drawOutlines: true, // Рисовать тонкий полупрозрачный контур вокруг полигона

  // Цветовые схемы RGBA (Red Green Blue Alpha [0-255])
  colors: {
    Extreme:  { fill: "255 0 0 18",    line: "255 50 50 45" },   // Красный
    Severe:   { fill: "255 130 0 16",  line: "255 160 0 45" },  // Оранжевый
    Moderate: { fill: "235 215 0 14",  line: "200 190 0 40" },  // Желтый
    Minor:    { fill: "0 170 230 12",  line: "0 130 200 35" }   // Голубой
  },

  simplifyTolerance: 0.001
};

// 39 Фидов MeteoAlarm для всей Европы
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

// Европейские геобазы (Евросоюз NUTS2/3 + Не-ЕС регионы ADM1)
const EUROPE_BOUNDARY_SOURCES = [
  "https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_20M_2021_4326_LEVL_3.geojson",
  "https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_20M_2021_4326_LEVL_2.geojson",
  "https://raw.githubusercontent.com/wmgeolab/geoBoundaries/main/releaseData/gbOpen/UKR/ADM1/geoBoundaries-UKR-ADM1.geojson",
  "https://raw.githubusercontent.com/wmgeolab/geoBoundaries/main/releaseData/gbOpen/MDA/ADM1/geoBoundaries-MDA-ADM1.geojson"
];

// Словарь альянсов и транслитераций для нелатинских регионов
const REGION_ALIASES = {
  "черкаська": "cherkasy", "cherkasy": "cherkasy",
  "чернігівська": "chernihiv", "chernihiv": "chernihiv",
  "чернівецька": "chernivtsi", "chernivtsi": "chernivtsi",
  "дніпропетровська": "dnipropetrovsk", "dnipropetrovsk": "dnipropetrovsk",
  "донецька": "donetsk", "donetsk": "donetsk",
  "івано-франківська": "ivano-frankivsk", "ivanofrankivsk": "ivano-frankivsk",
  "харківська": "kharkiv", "kharkiv": "kharkiv",
  "херсонська": "kherson", "kherson": "kherson",
  "хмельницька": "khmelnytskyi", "khmelnytskyi": "khmelnytskyi",
  "кіровоградська": "kirovohrad", "kirovohrad": "kirovohrad",
  "київська": "kyiv", "kyiv": "kyiv", "kiev": "kyiv",
  "луганська": "luhansk", "luhansk": "luhansk",
  "львівська": "lviv", "lviv": "lviv",
  "миколаївська": "mykolaiv", "mykolaiv": "mykolaiv",
  "одеська": "odesa", "odesa": "odesa",
  "полтавська": "poltava", "poltava": "poltava",
  "рівненська": "rivne", "rivne": "rivne",
  "сумська": "sumy", "sumy": "sumy",
  "тернопільська": "ternopil", "ternopil": "ternopil",
  "вінницька": "vinnytsia", "vinnytsia": "vinnytsia",
  "волинська": "volyn", "volyn": "volyn",
  "закарпатська": "zakarpattia", "zakarpattia": "zakarpattia",
  "запорізька": "zaporizhzhia", "zaporizhzhia": "zaporizhzhia",
  "житомирська": "zhytomyr", "zhytomyr": "zhytomyr",
  "крим": "crimea", "crimea": "crimea", "sevastopol": "sevastopol"
};

async function main() {
  console.log("Starting All-Europe MeteoAlarm Placefile Generation...");
  
  const warnings = await fetchAllFeeds();
  console.log(`Fetched ${warnings.length} total active warning records.`);

  // Загружаем границы регионов для сопоставления предупреждений без встроенных полигонов
  const boundaryMap = await fetchEuropeanBoundaries();

  const groups = {
    Extreme: [],
    Severe: [],
    Moderate: [],
    Minor: []
  };

  for (const w of warnings) {
    const sev = groups[w.severity] ? w.severity : "Moderate";
    let polygonsToRender = [];

    // 1. Если фид отдал полигон напрямую
    if (w.polygon && w.polygon.length >= 3) {
      polygonsToRender.push(w.polygon);
    } 
    // 2. Иначе ищем границы региона в загруженных GeoJSON базах Европы
    else if (w.areaDesc) {
      const regions = w.areaDesc.split(/[,;\n]+/).map(r => r.trim()).filter(Boolean);
      for (const reg of regions) {
        const norm = normalizeName(reg);
        if (norm.length >= 3 && boundaryMap.has(norm)) {
          const boundaryPolys = boundaryMap.get(norm);
          polygonsToRender.push(...boundaryPolys);
        }
      }
    }

    for (const polyCoords of polygonsToRender) {
      try {
        const polyFeature = turf.polygon([polyCoords], {
          title: w.title,
          areaDesc: w.areaDesc,
          severity: sev
        });
        groups[sev].push(polyFeature);
      } catch {
        // Пропускаем некорректные кольца координат
      }
    }
  }

  const outputLines = [
    `Title: ${CONFIG.title}`,
    `Refresh: ${CONFIG.refreshMinutes}`,
    ""
  ];

  for (const [severity, features] of Object.entries(groups)) {
    if (features.length === 0) continue;

    console.log(`Processing ${features.length} polygons for severity: ${severity}`);
    const mergedFeatures = mergeAndSimplify(features);
    const colorSpec = CONFIG.colors[severity] || CONFIG.colors.Moderate;

    for (const feat of mergedFeatures) {
      const coordsRings = feat.geometry.type === "Polygon" 
        ? [feat.geometry.coordinates] 
        : feat.geometry.coordinates;

      for (const rings of coordsRings) {
        const outerRing = rings[0];
        if (!outerRing || outerRing.length < 3) continue;

        // Заливка (Polygon)
        outputLines.push(`Color: ${colorSpec.fill}`);
        outputLines.push(`Polygon:`);
        for (const [lon, lat] of outerRing) {
          outputLines.push(`  ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
        }
        outputLines.push("End:");

        // Контур (Line)
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

  const publicDir = path.join(process.cwd(), "public");
  await fs.mkdir(publicDir, { recursive: true });
  const outputPath = path.join(publicDir, "placefile.txt");
  
  await fs.writeFile(outputPath, outputLines.join("\n"), "utf-8");
  console.log(`Placefile generated successfully at ${outputPath}`);
}

/**
 * Нормализация строк с поддержкой европейских языков и кириллицы
 */
function normalizeName(str) {
  if (!str) return "";
  const cleanStr = str.toLowerCase().trim();

  for (const [key, alias] of Object.entries(REGION_ALIASES)) {
    if (cleanStr.includes(key)) {
      return alias;
    }
  }

  return cleanStr
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Удаление умлаутов/акцентов
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/**
 * Загрузка векторных границ для всей Европы из GISCO / NUTS / geoBoundaries
 */
async function fetchEuropeanBoundaries() {
  const boundaryMap = new Map();

  for (const url of EUROPE_BOUNDARY_SOURCES) {
    try {
      console.log(`Fetching boundary dataset: ${url.substring(url.lastIndexOf('/') + 1)}`);
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;

      const geojson = await res.json();
      if (!geojson.features) continue;

      for (const feat of geojson.features) {
        const props = feat.properties || {};
        const rawName = props.NUTS_NAME || props.NUTS_ID || props.shapeName || props.NAME_LATN || props.NAME || props.id;
        if (!rawName) continue;

        const norm = normalizeName(rawName);
        if (norm.length < 3) continue;

        const geom = feat.geometry;
        if (!geom) continue;

        const polygons = [];
        if (geom.type === "Polygon") {
          polygons.push(geom.coordinates[0]);
        } else if (geom.type === "MultiPolygon") {
          for (const poly of geom.coordinates) {
            polygons.push(poly[0]);
          }
        }

        if (polygons.length > 0) {
          if (!boundaryMap.has(norm)) {
            boundaryMap.set(norm, []);
          }
          boundaryMap.get(norm).push(...polygons);
        }
      }
    } catch (e) {
      console.warn(`Failed to fetch boundary dataset ${url}:`, e.message);
    }
  }

  return boundaryMap;
}

/**
 * Объединение пространственных полигонов через Turf.js
 */
function mergeAndSimplify(features) {
  if (features.length === 1) {
    return [turf.simplify(features[0], { tolerance: CONFIG.simplifyTolerance, highQuality: true })];
  }

  try {
    let unionResult = null;
    for (const feat of features) {
      if (!unionResult) {
        unionResult = feat;
      } else {
        try {
          unionResult = turf.union(turf.featureCollection([unionResult, feat]));
        } catch {
          // Игнорируем ошибки пространственной стыковки для поврежденных ребер
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
  } catch {
    return features;
  }
}

/**
 * Загрузка 39 RSS/Atom-фидов MeteoAlarm
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

function parseAtomFeed(xml) {
  const warnings = [];
  let entryStart = xml.indexOf("<entry>");

  while (entryStart !== -1) {
    const entryEnd = xml.indexOf("</entry>", entryStart);
    if (entryEnd === -1) break;

    const entry = xml.substring(entryStart, entryEnd);
    const polygonStr = extractTag(entry, "cap:polygon");
    const severity = extractTag(entry, "cap:severity") || "Moderate";
    const title = extractTag(entry, "title") || "Weather Warning";
    const areaDesc = extractTag(entry, "cap:areaDesc") || "";

    let polygon = null;
    if (polygonStr) {
      const rawPoints = polygonStr.trim().split(/\s+/);
      const points = [];

      for (let i = 0; i < rawPoints.length; i++) {
        const parts = rawPoints[i].split(",");
        if (parts.length === 2) {
          const lat = parseFloat(parts[0]);
          const lon = parseFloat(parts[1]);
          if (!isNaN(lat) && !isNaN(lon)) {
            points.push([lon, lat]);
          }
        }
      }

      if (points.length >= 3) {
        const first = points[0];
        const last = points[points.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          points.push([first[0], first[1]]);
        }
        polygon = points;
      }
    }

    warnings.push({ severity, title, areaDesc, polygon });
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
