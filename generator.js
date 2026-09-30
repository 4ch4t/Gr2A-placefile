import fs from "node:fs/promises";
import path from "node:path";
import * as turf from "@turf/turf";

const CONFIG = {
  title: "MeteoAlarm Europe Warnings",
  refreshMinutes: 2,
  drawOutlines: true,

  colors: {
    Extreme:  { fill: "255 0 0 20",    line: "255 50 50 50" },   // Красный
    Severe:   { fill: "255 130 0 18",  line: "255 160 0 50" },  // Оранжевый
    Moderate: { fill: "235 215 0 16",  line: "200 190 0 45" },  // Желтый
    Minor:    { fill: "0 170 230 14",  line: "0 130 200 40" }   // Голубой
  },

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

// Оптимизированные геобазы ЕС NUTS + geoBoundaries + Natural Earth Admin-1
const EUROPE_BOUNDARY_SOURCES = [
  "https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_60M_2021_4326_LEVL_3.geojson",
  "https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_60M_2021_4326_LEVL_2.geojson",
  "https://raw.githubusercontent.com/wmgeolab/geoBoundaries/main/releaseData/gbOpen/UKR/ADM1/geoBoundaries-UKR-ADM1.geojson",
  "https://raw.githubusercontent.com/wmgeolab/geoBoundaries/main/releaseData/gbOpen/MDA/ADM1/geoBoundaries-MDA-ADM1.geojson"
];

const REGION_ALIASES = {
  "черкаська": "cherkasy", "чернігівська": "chernihiv", "чернівецька": "chernivtsi",
  "дніпропетровська": "dnipropetrovsk", "донецька": "donetsk", "івано-франківська": "ivano-frankivsk",
  "харківська": "kharkiv", "херсонська": "kherson", "хмельницька": "khmelnytskyi",
  "кіровоградська": "kirovohrad", "київська": "kyiv", "луганська": "luhansk",
  "львівська": "lviv", "миколаївська": "mykolaiv", "одеська": "odesa",
  "полтавська": "poltava", "рівненська": "rivne", "сумська": "sumy",
  "тернопільська": "ternopil", "вінницька": "vinnytsia", "волинська": "volyn",
  "закарпатська": "zakarpattia", "запорізька": "zaporizhzhia", "житомирська": "zhytomyr",
  "крим": "crimea", "севастополь": "sevastopol"
};

async function main() {
  console.log("Starting All-Europe MeteoAlarm Placefile Generation...");
  
  const warnings = await fetchAllFeeds();
  console.log(`Fetched ${warnings.length} active warnings across Europe.`);

  const boundaryMap = await fetchEuropeanBoundaries();
  console.log(`Loaded ${boundaryMap.size} boundary mappings.`);

  const groups = { Extreme: [], Severe: [], Moderate: [], Minor: [] };
  let totalPolygonsMapped = 0;

  for (const w of warnings) {
    const sev = groups[w.severity] ? w.severity : "Moderate";
    let polygonsToRender = [];

    // 1. Координаты напрямую из CAP
    if (w.polygons && w.polygons.length > 0) {
      polygonsToRender.push(...w.polygons);
    } 
    // 2. Поиск по NUTS / EMMA геолокационным кодам
    if (polygonsToRender.length === 0 && w.geocodes.length > 0) {
      for (const code of w.geocodes) {
        const normCode = normalizeName(code);
        if (boundaryMap.has(normCode)) {
          polygonsToRender.push(...boundaryMap.get(normCode));
        }
      }
    }
    // 3. Поиск по названиям регионов (areaDesc)
    if (polygonsToRender.length === 0 && w.areaDesc) {
      const regions = w.areaDesc.split(/[,;\n/]+/).map(r => r.trim()).filter(Boolean);
      for (const reg of regions) {
        const norm = normalizeName(reg);
        if (norm.length >= 2 && boundaryMap.has(norm)) {
          polygonsToRender.push(...boundaryMap.get(norm));
        }
      }
    }

    for (const polyCoords of polygonsToRender) {
      try {
        const polyFeature = turf.polygon([polyCoords], {
          title: w.title,
          severity: sev
        });
        groups[sev].push(polyFeature);
        totalPolygonsMapped++;
      } catch {
        // Игнорируем некорректные геометрические контуры
      }
    }
  }

  console.log(`Successfully mapped ${totalPolygonsMapped} warning polygons.`);

  const outputLines = [
    `Title: ${CONFIG.title}`,
    `Refresh: ${CONFIG.refreshMinutes}`,
    ""
  ];

  for (const [severity, features] of Object.entries(groups)) {
    if (features.length === 0) continue;

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

function normalizeName(str) {
  if (!str) return "";
  const cleanStr = str.toLowerCase().trim();

  for (const [key, alias] of Object.entries(REGION_ALIASES)) {
    if (cleanStr.includes(key)) return alias;
  }

  return cleanStr
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

async function fetchEuropeanBoundaries() {
  const boundaryMap = new Map();

  for (const url of EUROPE_BOUNDARY_SOURCES) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;

      const geojson = await res.json();
      if (!geojson.features) continue;

      for (const feat of geojson.features) {
        const props = feat.properties || {};
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
        if (polygons.length === 0) continue;

        // Сохраняем векторные контуры под всеми возможными ключами (NUTS ID, Имя региона, Коды)
        const keys = [
          props.NUTS_ID,
          props.NUTS_NAME,
          props.shapeName,
          props.shapeID,
          props.NAME_LATN,
          props.NAME,
          props.id
        ].filter(Boolean);

        for (const k of keys) {
          const normKey = normalizeName(k);
          if (normKey.length >= 2) {
            if (!boundaryMap.has(normKey)) {
              boundaryMap.set(normKey, []);
            }
            boundaryMap.get(normKey).push(...polygons);
          }
        }
      }
    } catch (e) {
      console.warn(`Failed to fetch boundary set ${url}:`, e.message);
    }
  }

  return boundaryMap;
}

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
          // Игнорируем гео-стыковки при поврежденных вершинах
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
    const severity = extractTag(entry, "cap:severity") || "Moderate";
    const title = extractTag(entry, "title") || "Weather Warning";
    const areaDesc = extractTag(entry, "cap:areaDesc") || "";

    // Извлечение geocode (NUTS/EMMA ID)
    const geocodes = [];
    let geocodeMatch;
    const geocodeRegex = /<cap:geocode>[\s\S]*?<cap:value>([\s\S]*?)<\/cap:value>[\s\S]*?<\/cap:geocode>/g;
    while ((geocodeMatch = geocodeRegex.exec(entry)) !== null) {
      if (geocodeMatch[1]) geocodes.push(geocodeMatch[1].trim());
    }

    // Извлечение полигонов coordinates (lat,lon)
    const polygons = [];
    let polyMatch;
    const polyRegex = /<cap:polygon>([\s\S]*?)<\/cap:polygon>/g;
    while ((polyMatch = polyRegex.exec(entry)) !== null) {
      const rawPoints = polyMatch[1].trim().split(/\s+/);
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
        polygons.push(points);
      }
    }

    warnings.push({ severity, title, areaDesc, geocodes, polygons });
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
