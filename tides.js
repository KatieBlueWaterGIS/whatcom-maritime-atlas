/*
  WHATCOM MARITIME STORYTELLING ATLAS — TIDES OF CHANGE PROTOTYPE
  ----------------------------------------------------------------
  ArcGIS Online remains the source of truth:
  - Web Map item: c4a718cbf6284cb88b0499e7ac55095b
  - Tides of Change point layer: StoryMap_Theme_Locations/FeatureServer/11

  The app intentionally discovers likely title/theme/description/image/StoryMap URL fields
  from the live public layer at runtime. Once the exact schema is confirmed, FIELD_HINTS can
  be tightened to make the mapping deterministic.
*/

const CONFIG = {
  portalUrl: "https://www.arcgis.com",
  webMapId: "c4a718cbf6284cb88b0499e7ac55095b",
  pointLayerUrl: "https://services2.arcgis.com/VmLllxPKgIzlr2id/arcgis/rest/services/StoryMap_Theme_Locations/FeatureServer/11",
  initialZoomPadding: 90,
  fieldHints: {
    title: ["title", "name", "story_name", "location_name", "site_name", "place", "label"],
    theme: ["theme", "story_theme", "category", "topic", "storyline"],
    description: ["description", "summary", "subtitle", "short_description", "blurb", "excerpt", "central_message"],
    storyUrl: ["storymap_url", "story_url", "url", "link", "storymap", "story_link", "web_url"],
    image: ["image", "image_url", "thumbnail", "thumbnail_url", "photo", "photo_url", "media", "media_url"],
    sort: ["sort", "sort_order", "order", "sequence", "rank"]
  }
};

let mapView;
let webMap;
let storyLayer;
let storyLayerView;
let allGraphics = [];
let activeTheme = "all";
let selectedObjectId = null;
let fieldMap = {};
let objectIdField = null;
let initialExtent = null;

const dom = {
  mapStatus: document.getElementById("mapStatus"),
  storyList: document.getElementById("storyList"),
  themeFilter: document.getElementById("themeFilter"),
  resultCount: document.getElementById("resultCount"),
  resetViewButton: document.getElementById("resetViewButton"),
  showAllButton: document.getElementById("showAllButton"),
  panelTitle: document.getElementById("panelTitle"),
  panelSubtitle: document.getElementById("panelSubtitle"),
  menuButton: document.getElementById("menuButton"),
  siteNav: document.getElementById("siteNav"),
  storyCardTemplate: document.getElementById("storyCardTemplate"),
  storyViewer: document.getElementById("storyViewer"),
  storyFrame: document.getElementById("storyFrame"),
  storyFrameLoading: document.getElementById("storyFrameLoading"),
  storyViewerTitle: document.getElementById("storyViewerTitle"),
  storyExternalLink: document.getElementById("storyExternalLink"),
  storyBackButton: document.getElementById("storyBackButton"),
  storyViewerScrim: document.getElementById("storyViewerScrim")
};

function normalize(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;"
  })[char]);
}

function plainText(value) {
  const tmp = document.createElement("div");
  tmp.innerHTML = String(value ?? "");
  return tmp.textContent || tmp.innerText || "";
}

function findField(fields, hints) {
  const normalizedHints = hints.map(normalize);
  const exact = fields.find(f => normalizedHints.includes(normalize(f.name)) || normalizedHints.includes(normalize(f.alias)));
  if (exact) return exact.name;
  const fuzzy = fields.find(f => normalizedHints.some(h => normalize(f.name).includes(h) || normalize(f.alias).includes(h)));
  return fuzzy?.name || null;
}

function detectFieldMap(layer) {
  const fields = layer.fields || [];
  const detected = {};
  for (const [key, hints] of Object.entries(CONFIG.fieldHints)) {
    detected[key] = findField(fields, hints);
  }
  detected.title = detected.title || layer.displayField || null;
  objectIdField = layer.objectIdField;
  return detected;
}

function extractStoryUrl(attrs) {
  const direct = fieldMap.storyUrl && attrs[fieldMap.storyUrl];
  if (direct && /^https?:\/\//i.test(String(direct))) return String(direct);

  // Fallback: scan every attribute for an ArcGIS StoryMaps-looking URL.
  for (const value of Object.values(attrs)) {
    if (typeof value !== "string") continue;
    const match = value.match(/https?:\/\/[^\s"'<>]+/i);
    if (match && /(storymaps|stories\.arcgis|arcgis\.com\/stories|storymaps\.arcgis)/i.test(match[0])) return match[0];
  }
  return "";
}

function extractImageUrl(attrs) {
  const direct = fieldMap.image && attrs[fieldMap.image];
  if (direct && /^https?:\/\//i.test(String(direct))) return String(direct);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value !== "string") continue;
    if (!/(image|photo|thumb|media)/i.test(key)) continue;
    const match = value.match(/https?:\/\/[^\s"'<>]+/i);
    if (match) return match[0];
  }
  return "";
}

function getTitle(graphic) {
  const attrs = graphic.attributes || {};
  return plainText(fieldMap.title ? attrs[fieldMap.title] : "") || `Waterfront story ${attrs[objectIdField] ?? ""}`;
}

function getTheme(graphic) {
  const attrs = graphic.attributes || {};
  const value = fieldMap.theme ? attrs[fieldMap.theme] : "";
  return plainText(value) || "Tides of Change";
}

function getDescription(graphic) {
  const attrs = graphic.attributes || {};
  const value = fieldMap.description ? attrs[fieldMap.description] : "";
  return plainText(value) || "Explore this place and its role in the changing Whatcom waterfront.";
}

function themeKey(value) {
  return normalize(value || "uncategorized");
}

function uniqueThemes(graphics) {
  const values = new Map();
  graphics.forEach(g => {
    const label = getTheme(g);
    const key = themeKey(label);
    if (!values.has(key)) values.set(key, label);
  });
  return [...values.entries()].sort((a,b) => a[1].localeCompare(b[1]));
}

function filteredGraphics() {
  if (activeTheme === "all") return allGraphics;
  return allGraphics.filter(g => themeKey(getTheme(g)) === activeTheme);
}

function sortGraphics(graphics) {
  return [...graphics].sort((a,b) => {
    if (fieldMap.sort) {
      const av = Number(a.attributes?.[fieldMap.sort]);
      const bv = Number(b.attributes?.[fieldMap.sort]);
      if (Number.isFinite(av) && Number.isFinite(bv) && av !== bv) return av - bv;
    }
    return getTitle(a).localeCompare(getTitle(b));
  });
}

function themeType(label) {
  const l = String(label || "").toLowerCase();
  if (l.includes("fish") || l.includes("cann")) return "fishing";
  if (l.includes("lumber") || l.includes("timber")) return "lumber";
  if (l.includes("boat")) return "boatbuilding";
  if (l.includes("orca") || l.includes("environment")) return "orca";
  return "other";
}

function iconSvg(type, circle = false) {
  const bg = {fishing:"#0b6f78", lumber:"#7d713c", boatbuilding:"#b2752c", orca:"#355f7c", other:"#0b6f78"}[type] || "#0b6f78";
  const wrapStart = circle ? `<circle cx="32" cy="32" r="30" fill="${bg}"/>` : '';
  const stroke = circle ? '#fff' : 'currentColor';
  const common = `fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"`;
  let art = '';
  if(type === 'boatbuilding') art = `<path ${common} d="M12 38h40l-5 9c-2 4-6 6-11 6H24c-5 0-9-2-11-6l-4-6z"/><path ${common} d="M21 38V27h18l7 11M27 27v-8h10v8M32 19V10M32 10l10 6H32"/>`;
  else if(type === 'fishing') art = `<path ${common} d="M13 32c8-10 18-14 30-8l8-7-1 11 1 11-8-7c-12 6-22 2-30-8z"/><circle cx="24" cy="29" r="1.8" fill="${stroke}" stroke="none"/>`;
  else if(type === 'lumber') art = `<path ${common} d="M32 10 20 27h7L17 42h11v12h8V42h11L37 27h7z"/>`;
  else if(type === 'orca') art = `<path ${common} d="M10 35c10-12 22-16 38-9l7-7-2 12 2 9-8-4c-5 8-15 13-27 10-6-2-9-6-10-11z"/><path ${common} d="M32 24c1-7 5-11 9-13-1 7-4 11-9 13z"/><path d="M25 29c4-3 8-3 11 0-3 4-7 5-11 0z" fill="${stroke}" stroke="none"/>`;
  else art = `<path ${common} d="M32 11v42M11 32h42M18 18l28 28M46 18 18 46"/>`;
  return `<svg viewBox="0 0 64 64" aria-hidden="true">${wrapStart}${art}</svg>`;
}

function themeIconMarkup(label) { return iconSvg(themeType(label), false); }
function themeMarkerUrl(label) {
  const svg = iconSvg(themeType(label), true);
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

async function applyTidesRenderer() {
  if (!storyLayer || !fieldMap.theme || storyLayer.geometryType !== 'point') return;
  try {
    const [UniqueValueRenderer, PictureMarkerSymbol] = await Promise.all([
      $arcgis ? $arcgis.import('@arcgis/core/renderers/UniqueValueRenderer.js') : Promise.reject() ,
      $arcgis ? $arcgis.import('@arcgis/core/symbols/PictureMarkerSymbol.js') : Promise.reject()
    ]);
    const values = [...new Map(allGraphics.map(g => [String(g.attributes?.[fieldMap.theme] ?? ''), getTheme(g)])).entries()].filter(([v]) => v);
    storyLayer.renderer = new UniqueValueRenderer({
      field: fieldMap.theme,
      defaultSymbol: new PictureMarkerSymbol({url:themeMarkerUrl('other'),width:30,height:30}),
      uniqueValueInfos: values.map(([value,label]) => ({value,label,symbol:new PictureMarkerSymbol({url:themeMarkerUrl(label),width:32,height:32})}))
    });
  } catch (e) {
    // 4.x AMD build fallback below.
    try {
      require(['esri/renderers/UniqueValueRenderer','esri/symbols/PictureMarkerSymbol'], (UniqueValueRenderer, PictureMarkerSymbol) => {
        const values = [...new Map(allGraphics.map(g => [String(g.attributes?.[fieldMap.theme] ?? ''), getTheme(g)])).entries()].filter(([v]) => v);
        storyLayer.renderer = new UniqueValueRenderer({field:fieldMap.theme, defaultSymbol:new PictureMarkerSymbol({url:themeMarkerUrl('other'),width:'30px',height:'30px'}), uniqueValueInfos:values.map(([value,label])=>({value,label,symbol:new PictureMarkerSymbol({url:themeMarkerUrl(label),width:'32px',height:'32px'})}))});
      });
    } catch(err) { console.warn('Could not override Tides symbology; retaining Web Map renderer.', err); }
  }
}
function buildThemeFilters() {
  dom.themeFilter.querySelectorAll(".theme-chip:not([data-theme='all'])").forEach(el => el.remove());
  uniqueThemes(allGraphics).forEach(([key, label]) => {
    const button = document.createElement("button");
    button.className = "theme-chip";
    button.type = "button";
    button.dataset.theme = key;
    button.innerHTML = `<span class="theme-symbol">${themeIconMarkup(label)}</span><span><strong>${escapeHtml(label)}</strong><small>Explore this storyline</small></span>`;
    dom.themeFilter.appendChild(button);
  });
}

function renderStories() {
  const graphics = sortGraphics(filteredGraphics());
  dom.storyList.innerHTML = "";
  dom.resultCount.textContent = `${graphics.length} ${graphics.length === 1 ? "story" : "stories"}`;

  if (!graphics.length) {
    dom.storyList.innerHTML = `<div style="padding:28px;color:#627077;line-height:1.6">No stories are currently assigned to this theme.</div>`;
    return;
  }

  graphics.forEach((graphic, index) => {
    const node = dom.storyCardTemplate.content.firstElementChild.cloneNode(true);
    const oid = graphic.attributes?.[objectIdField];
    node.dataset.oid = oid;
    if (String(oid) === String(selectedObjectId)) node.classList.add("selected");

    node.querySelector(".theme-pill").textContent = getTheme(graphic);
    const cardIcon = node.querySelector(".card-theme-icon");
    if (cardIcon) cardIcon.innerHTML = themeIconMarkup(getTheme(graphic));
    node.querySelector(".story-number").textContent = String(index + 1).padStart(2, "0");
    node.querySelector("h4").textContent = getTitle(graphic);
    node.querySelector(".story-description").textContent = getDescription(graphic);

    const img = extractImageUrl(graphic.attributes || {});
    if (img) node.querySelector(".story-thumb").style.backgroundImage = `url("${img.replace(/"/g, "%22")}")`;

    const storyUrl = extractStoryUrl(graphic.attributes || {});
    const mainButton = node.querySelector(".story-card-main");
    if (storyUrl) {
      mainButton.addEventListener("click", async () => {
        await selectGraphic(graphic, true);
        openStoryViewer(graphic);
      });
    } else {
      const label = node.querySelector(".inline-open-label");
      if (label) label.textContent = "Story link coming soon";
      mainButton.addEventListener("click", () => selectGraphic(graphic, true));
    }
    dom.storyList.appendChild(node);
  });
}

function openStoryViewer(graphic) {
  const url = extractStoryUrl(graphic.attributes || {});
  if (!url || !dom.storyViewer || !dom.storyFrame) return;
  dom.storyViewerTitle.textContent = getTitle(graphic);
  dom.storyExternalLink.href = url;
  dom.storyFrameLoading?.classList.remove("hidden");
  dom.storyFrame.src = url;
  dom.storyViewer.classList.add("open");
  dom.storyViewer.setAttribute("aria-hidden", "false");
  document.body.classList.add("story-open");
}

function closeStoryViewer() {
  if (!dom.storyViewer) return;
  dom.storyViewer.classList.remove("open");
  dom.storyViewer.setAttribute("aria-hidden", "true");
  document.body.classList.remove("story-open");
  // Delay unloading slightly so the slide-out animation is smooth.
  setTimeout(() => { if (!dom.storyViewer.classList.contains("open")) dom.storyFrame.src = "about:blank"; }, 300);
}

async function selectGraphic(graphic, navigate = true) {
  selectedObjectId = graphic.attributes?.[objectIdField];
  renderStories();

  if (!mapView) return;
  try {
    mapView.popup.close();
    if (navigate && graphic.geometry) {
      await mapView.goTo({ target: graphic.geometry, zoom: Math.max(mapView.zoom || 13, 15) }, { duration: 650 });
    }
    if (storyLayerView && selectedObjectId != null) {
      storyLayerView.highlight([selectedObjectId]);
      setTimeout(() => {
        // Highlight is intentionally brief; selected card remains persistent.
        // A persistent handle can be added later if desired.
      }, 1200);
    }
  } catch (e) {
    console.warn("Unable to navigate to selected feature", e);
  }
}

async function applyTheme(theme) {
  activeTheme = theme;
  selectedObjectId = null;
  document.querySelectorAll(".theme-chip").forEach(btn => btn.classList.toggle("active", btn.dataset.theme === theme));

  const graphics = filteredGraphics();
  renderStories();

  const selectedButton = document.querySelector(`.theme-chip[data-theme="${CSS.escape(theme)}"]`);
  const label = selectedButton?.querySelector("strong")?.textContent || "All";
  dom.panelTitle.textContent = theme === "all" ? "Explore the waterfront" : label;
  dom.panelSubtitle.textContent = theme === "all" ? "Select a point on the map or browse the stories below." : `Explore the places connected to ${label}.`;

  if (storyLayerView) {
    if (theme === "all" || !fieldMap.theme) storyLayerView.filter = null;
    else {
      const values = [...new Set(allGraphics.filter(g => themeKey(getTheme(g)) === theme).map(g => g.attributes[fieldMap.theme]))];
      const field = storyLayer.fields.find(f => f.name === fieldMap.theme);
      if (field && field.type === "string") {
        const escaped = values.map(v => `'${String(v).replace(/'/g, "''")}'`).join(",");
        storyLayerView.filter = { where: `${fieldMap.theme} IN (${escaped})` };
      }
    }
  }

  if (mapView && graphics.length) {
    try {
      const result = await storyLayer.queryExtent({ objectIds: graphics.map(g => g.attributes[objectIdField]).filter(v => v != null) });
      if (result.extent) await mapView.goTo(result.extent.expand(1.45), { duration: 650 });
    } catch (e) { console.warn(e); }
  }
}

async function initArcGIS() {
  require([
    "esri/WebMap",
    "esri/views/MapView",
    "esri/layers/FeatureLayer",
    "esri/widgets/Home",
    "esri/widgets/Locate"
  ], async (WebMap, MapView, FeatureLayer, Home, Locate) => {
    try {
      webMap = new WebMap({ portalItem: { id: CONFIG.webMapId, portal: { url: CONFIG.portalUrl } } });
      mapView = new MapView({
        container: "viewDiv",
        map: webMap,
        popup: { dockEnabled: false },
        constraints: { snapToZoom: false }
      });

      await mapView.when();
      initialExtent = mapView.extent?.clone();

      mapView.ui.move("zoom", "bottom-right");
      mapView.ui.add(new Home({ view: mapView }), "bottom-right");
      mapView.ui.add(new Locate({ view: mapView }), "bottom-right");

      await webMap.loadAll();

      // Reuse the layer already in the Web Map when possible, preserving its renderer/popups.
      storyLayer = webMap.allLayers.find(layer => {
        const url = String(layer.url || "").replace(/\/$/, "").toLowerCase();
        return url === CONFIG.pointLayerUrl.toLowerCase();
      });

      // Otherwise add the live public FeatureLayer directly.
      if (!storyLayer) {
        storyLayer = new FeatureLayer({
          url: CONFIG.pointLayerUrl,
          outFields: ["*"],
          popupEnabled: false
        });
        webMap.add(storyLayer);
      }

      await storyLayer.load();
      fieldMap = detectFieldMap(storyLayer);
      storyLayer.outFields = ["*"];

      const result = await storyLayer.queryFeatures({
        where: "1=1",
        outFields: ["*"],
        returnGeometry: true,
        orderByFields: fieldMap.sort ? [fieldMap.sort] : undefined
      });
      allGraphics = result.features || [];
      await applyTidesRenderer();
      storyLayerView = await mapView.whenLayerView(storyLayer);

      buildThemeFilters();
      renderStories();

      dom.mapStatus.textContent = `Live ArcGIS connection · ${allGraphics.length} Tides of Change locations loaded`;
      dom.mapStatus.classList.add("success");
      setTimeout(() => dom.mapStatus.style.opacity = ".72", 3500);

      mapView.on("click", async event => {
        const response = await mapView.hitTest(event, { include: storyLayer });
        const hit = response.results.find(r => r.graphic?.layer === storyLayer);
        if (hit?.graphic) {
          const oid = hit.graphic.attributes?.[objectIdField];
          const fullGraphic = allGraphics.find(g => String(g.attributes?.[objectIdField]) === String(oid)) || hit.graphic;
          await selectGraphic(fullGraphic, false);
          const card = dom.storyList.querySelector(`[data-oid="${CSS.escape(String(oid))}"]`);
          card?.scrollIntoView({ behavior:"smooth", block:"nearest" });
          if (extractStoryUrl(fullGraphic.attributes || {})) openStoryViewer(fullGraphic);
        }
      });

      console.info("Detected Tides of Change fields:", fieldMap);
    } catch (error) {
      console.error(error);
      dom.mapStatus.textContent = "The prototype shell loaded, but the live ArcGIS content could not be reached. Open this page with an internet connection; if the issue persists, check that the Web Map and point layer are shared publicly.";
      dom.mapStatus.classList.add("error");
      dom.resultCount.textContent = "ArcGIS connection unavailable";
      dom.storyList.innerHTML = `<div style="padding:28px;color:#627077;line-height:1.65"><strong style="color:#0c2d3d">Custom Atlas shell is running.</strong><br><br>The live Web Map and point layer are loaded at runtime from ArcGIS Online. This workspace cannot test those endpoints directly, so the first browser test will also confirm the live schema mapping.</div>`;
    }
  });
}

dom.themeFilter.addEventListener("click", event => {
  const button = event.target.closest(".theme-chip");
  if (button) applyTheme(button.dataset.theme);
});

dom.resetViewButton.addEventListener("click", () => {
  if (mapView && initialExtent) mapView.goTo(initialExtent, { duration:650 });
  applyTheme("all");
});

if (dom.showAllButton) dom.showAllButton.addEventListener("click", () => {
  applyTheme("all");
  document.getElementById("atlasExplorer").scrollIntoView({ behavior:"smooth" });
});


if (dom.storyBackButton) dom.storyBackButton.addEventListener("click", closeStoryViewer);
if (dom.storyViewerScrim) dom.storyViewerScrim.addEventListener("click", closeStoryViewer);
if (dom.storyFrame) dom.storyFrame.addEventListener("load", () => dom.storyFrameLoading?.classList.add("hidden"));
document.addEventListener("keydown", event => { if (event.key === "Escape") closeStoryViewer(); });

dom.menuButton.addEventListener("click", () => {
  const open = document.body.classList.toggle("nav-open");
  dom.menuButton.setAttribute("aria-expanded", String(open));
});

dom.siteNav.addEventListener("click", () => {
  document.body.classList.remove("nav-open");
  dom.menuButton.setAttribute("aria-expanded", "false");
});

initArcGIS();
