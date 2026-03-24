/**
 * Feed Planner — Main Application
 * Sidebar is always visible. Settings live-update the map preview.
 */

(() => {
  // ==========================================
  // State
  // ==========================================

  let map;
  let routeData = null;
  let routeLine = null;
  let feedPoints = [];
  let feedMarkers = [];
  let startMarker = null;
  let endMarker = null;
  let isAddingFeed = false;

  const settings = {
    carbsPerHour: 60,
    feedIntervalMin: 20,
    avgSpeedKmh: 25,
    drinkCarbs: 30,
    foodCarbs: 25,
    strategy: "alternate",
    device: "garmin",
  };

  // ==========================================
  // DOM References
  // ==========================================

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const uploadOverlay = $("#upload-overlay");
  const fileInput = $("#file-input");
  const dropZone = $("#drop-zone");
  const toolbar = $("#toolbar");
  const routeInfo = $("#route-info");
  const feedSummary = $("#feed-summary");
  const feedList = $("#feed-list");
  const nutritionSummary = $("#nutrition-summary");

  // ==========================================
  // Map Setup
  // ==========================================

  function initMap() {
    map = L.map("map", {
      zoomControl: false,
      attributionControl: false,
    });

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      { maxZoom: 19 }
    ).addTo(map);

    map.setView([48.8, 2.35], 5);
    map.on("click", onMapClick);
  }

  // ==========================================
  // Theme
  // ==========================================

  function initTheme() {
    const saved = localStorage.getItem("feed-planner-theme");
    if (saved) {
      document.documentElement.setAttribute("data-theme", saved);
      updateThemeIcon(saved);
    }

    $("#theme-toggle").addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme");
      const isDark =
        current === "dark" ||
        (!current && window.matchMedia("(prefers-color-scheme: dark)").matches);
      const next = isDark ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("feed-planner-theme", next);
      updateThemeIcon(next);
    });
  }

  function updateThemeIcon(theme) {
    const icon = $(".theme-icon");
    icon.textContent = theme === "dark" ? "☀️" : "🌙";
  }

  // ==========================================
  // File Upload
  // ==========================================

  function initUpload() {
    fileInput.addEventListener("change", (e) => {
      if (e.target.files.length > 0) loadFile(e.target.files[0]);
    });

    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("drag-over");
    });

    dropZone.addEventListener("dragleave", () => {
      dropZone.classList.remove("drag-over");
    });

    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag-over");
      if (e.dataTransfer.files.length > 0) loadFile(e.dataTransfer.files[0]);
    });

    uploadOverlay.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("drag-over");
    });

    uploadOverlay.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag-over");
      if (e.dataTransfer.files.length > 0) loadFile(e.dataTransfer.files[0]);
    });
  }

  async function loadFile(file) {
    try {
      routeData = await RouteParser.parseFile(file);
      onRouteLoaded();
    } catch (err) {
      alert(`Error loading file: ${err.message}`);
      console.error(err);
    }
  }

  // ==========================================
  // Route Display
  // ==========================================

  function onRouteLoaded() {
    uploadOverlay.classList.add("hidden");
    toolbar.classList.remove("hidden");
    routeInfo.classList.remove("hidden");
    nutritionSummary.classList.remove("hidden");

    $("#route-name").textContent = routeData.name;
    $("#route-distance").textContent = formatDistance(routeData.totalDistance);
    $("#route-elevation").textContent = `↑ ${routeData.totalElevGain}m`;

    drawRoute();
    recalculateFeeds();
  }

  function drawRoute() {
    if (routeLine) map.removeLayer(routeLine);
    if (startMarker) map.removeLayer(startMarker);
    if (endMarker) map.removeLayer(endMarker);

    const latlngs = routeData.coords.map((c) => [c.lat, c.lon]);

    routeLine = L.polyline(latlngs, {
      color: "#EC008C",
      weight: 5,
      opacity: 1,
      lineJoin: "round",
      lineCap: "round",
    }).addTo(map);

    const startIcon = L.divIcon({
      className: "start-marker",
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
    startMarker = L.marker(latlngs[0], { icon: startIcon, interactive: false }).addTo(map);

    const endIcon = L.divIcon({
      className: "end-marker",
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
    endMarker = L.marker(latlngs[latlngs.length - 1], { icon: endIcon, interactive: false }).addTo(map);

    // Tight padding: [top, right, bottom (feed bar), left]
    const isMobile = window.innerWidth <= 700;
    const bottomPad = isMobile ? 130 : 100; // room for feed summary + export bar
    map.fitBounds(routeLine.getBounds(), {
      paddingTopLeft: [20, 20],
      paddingBottomRight: [20, bottomPad],
    });
  }

  // ==========================================
  // Feed Points
  // ==========================================

  function recalculateFeeds() {
    if (!routeData) return;

    feedPoints = FeedPlanner.calculateFeedPoints(routeData, settings);
    renderFeedMarkers();
    renderFeedSummary();
    updateNutritionSummary();
    updateRouteStats();
  }

  function renderFeedMarkers() {
    feedMarkers.forEach((m) => map.removeLayer(m));
    feedMarkers = [];

    feedPoints.forEach((fp) => {
      const icon = L.divIcon({
        className: `feed-marker ${fp.type}`,
        html: fp.type === "drink" ? "💧" : "🍫",
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });

      const marker = L.marker([fp.lat, fp.lon], {
        icon,
        draggable: true,
      }).addTo(map);

      const km = (fp.distanceM / 1000).toFixed(1);
      marker.bindTooltip(
        `<strong>${fp.type === "drink" ? "Drink" : "Eat"}</strong> — ${fp.carbs}g<br>${km} km`,
        {
          direction: "top",
          offset: [0, -16],
          className: "feed-marker-label",
        }
      );

      marker.on("click", () => openFeedPopup(fp, marker));

      marker.on("dragend", () => {
        const pos = marker.getLatLng();
        const snapDist = FeedPlanner.snapToRoute(routeData, pos.lat, pos.lng);
        const snappedCoord = RouteParser.coordAtDistance(routeData.coords, snapDist);

        fp.lat = snappedCoord.lat;
        fp.lon = snappedCoord.lon;
        fp.elev = snappedCoord.elev;
        fp.distanceM = snapDist;

        marker.setLatLng([snappedCoord.lat, snappedCoord.lon]);

        feedPoints.sort((a, b) => a.distanceM - b.distanceM);
        renderFeedSummary();
        updateNutritionSummary();
        updateRouteStats();
      });

      feedMarkers.push(marker);
    });
  }

  function renderFeedSummary() {
    feedSummary.classList.remove("hidden");
    feedList.innerHTML = "";

    if (feedPoints.length === 0) {
      feedSummary.classList.add("hidden");
      return;
    }

    feedPoints.forEach((fp, idx) => {
      const card = document.createElement("div");
      card.className = `feed-card ${fp.type === "food" ? "food" : ""}`;

      const km = (fp.distanceM / 1000).toFixed(1);
      card.innerHTML = `
        <div class="feed-card-km">${km} km</div>
        <div class="feed-card-type ${fp.type}">${fp.type === "drink" ? "💧 Drink" : "🍫 Food"}</div>
        <div class="feed-card-carbs">${fp.carbs}g carbs</div>
      `;

      card.addEventListener("click", () => {
        map.panTo([fp.lat, fp.lon]);
        const marker = feedMarkers[idx];
        if (marker) openFeedPopup(fp, marker);
      });

      feedList.appendChild(card);
    });
  }

  function updateNutritionSummary() {
    if (!routeData || feedPoints.length === 0) {
      nutritionSummary.classList.add("hidden");
      return;
    }
    nutritionSummary.classList.remove("hidden");

    const summary = FeedPlanner.calculateSummary(feedPoints, routeData, settings);
    $("#sum-total-carbs").textContent = `${summary.totalCarbs}g`;
    $("#sum-carbs-hr").textContent = `${summary.actualCarbsPerHour}g`;
    $("#sum-drinks").textContent = summary.drinkFeeds;
    $("#sum-foods").textContent = summary.foodFeeds;
  }

  function updateRouteStats() {
    $("#route-feeds").textContent = `${feedPoints.length} feeds`;
  }

  // ==========================================
  // Feed Edit Popup
  // ==========================================

  function openFeedPopup(fp, marker) {
    const popupContent = document.createElement("div");
    popupContent.innerHTML = `
      <div class="popup-title">${fp.type === "drink" ? "💧 Drink" : "🍫 Food"} — ${(fp.distanceM / 1000).toFixed(1)} km</div>
      <div class="popup-row">
        <label>Type</label>
        <div class="popup-type-btns">
          <button class="popup-type-btn ${fp.type === "drink" ? "active" : ""}" data-type="drink">💧 Drink</button>
          <button class="popup-type-btn ${fp.type === "food" ? "active" : ""}" data-type="food">🍫 Food</button>
        </div>
      </div>
      <div class="popup-row">
        <label>Note</label>
        <input type="text" class="popup-note-input" value="${fp.note}" placeholder="e.g. Gel, Bottle..." />
      </div>
      <div class="popup-actions">
        <button class="popup-delete">Delete</button>
        <button class="popup-save">Save</button>
      </div>
    `;

    popupContent.querySelectorAll(".popup-type-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        popupContent.querySelectorAll(".popup-type-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });

    popupContent.querySelector(".popup-delete").addEventListener("click", () => {
      deleteFeedPoint(fp.id);
      marker.closePopup();
    });

    popupContent.querySelector(".popup-save").addEventListener("click", () => {
      const activeType = popupContent.querySelector(".popup-type-btn.active");
      const newType = activeType ? activeType.dataset.type : fp.type;
      const newNote = popupContent.querySelector(".popup-note-input").value;

      fp.type = newType;
      fp.note = newNote;
      fp.carbs = newType === "drink" ? settings.drinkCarbs : settings.foodCarbs;

      const icon = L.divIcon({
        className: `feed-marker ${newType}`,
        html: newType === "drink" ? "💧" : "🍫",
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
      marker.setIcon(icon);

      marker.closePopup();
      renderFeedSummary();
      updateNutritionSummary();
      updateRouteStats();
    });

    marker.bindPopup(popupContent, {
      maxWidth: 240,
      className: "",
    }).openPopup();
  }

  function deleteFeedPoint(id) {
    const idx = feedPoints.findIndex((fp) => fp.id === id);
    if (idx === -1) return;

    map.removeLayer(feedMarkers[idx]);
    feedMarkers.splice(idx, 1);
    feedPoints.splice(idx, 1);

    renderFeedSummary();
    updateNutritionSummary();
    updateRouteStats();
  }

  // ==========================================
  // Add Feed Point (click on map)
  // ==========================================

  function onMapClick(e) {
    if (!isAddingFeed || !routeData) return;

    const { lat, lng } = e.latlng;
    const snapDist = FeedPlanner.snapToRoute(routeData, lat, lng);
    const snappedCoord = RouteParser.coordAtDistance(routeData.coords, snapDist);

    const id = `feed-custom-${Date.now()}`;
    const newFeed = {
      id,
      index: feedPoints.length + 1,
      distanceM: snapDist,
      lat: snappedCoord.lat,
      lon: snappedCoord.lon,
      elev: snappedCoord.elev,
      type: "drink",
      carbs: settings.drinkCarbs,
      note: `Drink — ${settings.drinkCarbs}g carbs`,
    };

    feedPoints.push(newFeed);
    feedPoints.sort((a, b) => a.distanceM - b.distanceM);

    renderFeedMarkers();
    renderFeedSummary();
    updateNutritionSummary();
    updateRouteStats();

    isAddingFeed = false;
    $("#btn-add-feed").classList.remove("active");
    map.getContainer().style.cursor = "";
  }

  // ==========================================
  // Mobile Sidebar
  // ==========================================

  function initMobileSidebar() {
    const sidebar = $("#sidebar");
    const toggle = $("#mobile-sidebar-toggle");
    const backdrop = $("#mobile-backdrop");

    toggle.addEventListener("click", () => {
      sidebar.classList.toggle("open");
      backdrop.classList.toggle("visible");
    });

    backdrop.addEventListener("click", () => {
      sidebar.classList.remove("open");
      backdrop.classList.remove("visible");
    });
  }

  // ==========================================
  // Toolbar Actions
  // ==========================================

  function initToolbar() {
    $("#btn-add-feed").addEventListener("click", () => {
      isAddingFeed = !isAddingFeed;
      $("#btn-add-feed").classList.toggle("active", isAddingFeed);
      map.getContainer().style.cursor = isAddingFeed ? "crosshair" : "";
    });

    $("#btn-clear-feeds").addEventListener("click", () => {
      if (feedPoints.length === 0) return;
      if (!confirm("Clear all feed points?")) return;
      feedMarkers.forEach((m) => map.removeLayer(m));
      feedMarkers = [];
      feedPoints = [];
      renderFeedSummary();
      updateNutritionSummary();
      updateRouteStats();
    });

    $("#btn-export").addEventListener("click", showEmailCapture);
    $("#btn-export-mobile").addEventListener("click", showEmailCapture);

    $("#btn-new-route").addEventListener("click", () => {
      fileInput.value = "";
      fileInput.click();
    });
  }

  // ==========================================
  // Settings — Live Update
  // ==========================================

  function readSettings() {
    settings.carbsPerHour = parseInt($("#carbs-per-hour").value) || 60;
    settings.feedIntervalMin = parseInt($("#feed-interval").value) || 20;
    settings.avgSpeedKmh = parseInt($("#avg-speed").value) || 25;
    settings.drinkCarbs = parseInt($("#drink-carbs").value) || 30;
    settings.foodCarbs = parseInt($("#food-carbs").value) || 25;
  }

  function initSettings() {
    // Sync number inputs with range sliders, and live-update on change
    syncInputRangeLive("carbs-per-hour", "carbs-per-hour-range");
    syncInputRangeLive("feed-interval", "feed-interval-range");
    syncInputRangeLive("avg-speed", "avg-speed-range");

    // Drink/food carb inputs — live update
    $("#drink-carbs").addEventListener("input", onSettingChange);
    $("#food-carbs").addEventListener("input", onSettingChange);

    // Strategy buttons — live update
    $$(".strategy-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".strategy-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        settings.strategy = btn.dataset.strategy;
        recalculateFeeds();
      });
    });

    // Device buttons
    $$(".device-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".device-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        settings.device = btn.dataset.device;
      });
    });
  }

  function syncInputRangeLive(inputId, rangeId) {
    const input = $(`#${inputId}`);
    const range = $(`#${rangeId}`);

    input.addEventListener("input", () => {
      range.value = input.value;
      onSettingChange();
    });

    range.addEventListener("input", () => {
      input.value = range.value;
      onSettingChange();
    });
  }

  let debounceTimer = null;
  function onSettingChange() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      readSettings();
      recalculateFeeds();
    }, 150);
  }

  // ==========================================
  // Email Capture & Export
  // ==========================================

  function showEmailCapture() {
    if (!routeData || feedPoints.length === 0) {
      alert("No route or feed points to export.");
      return;
    }

    const modal = $("#email-modal");
    modal.classList.remove("hidden");

    // Focus the email input
    setTimeout(() => $("#email-input").focus(), 100);
  }

  function initEmailCapture() {
    const modal = $("#email-modal");
    const form = $("#email-form");
    const skipBtn = $("#email-skip");

    // Submit with email
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = $("#email-input").value.trim();
      if (email) {
        storeEmail(email);
      }
      modal.classList.add("hidden");
      $("#email-input").value = "";
      doExport();
    });

    // Skip — download without email
    skipBtn.addEventListener("click", () => {
      modal.classList.add("hidden");
      $("#email-input").value = "";
      doExport();
    });

    // Close on backdrop click
    modal.querySelector(".email-modal-backdrop").addEventListener("click", () => {
      modal.classList.add("hidden");
      $("#email-input").value = "";
    });
  }

  function storeEmail(email) {
    // Store locally — in production you'd POST to an API
    const emails = JSON.parse(localStorage.getItem("feed-planner-emails") || "[]");
    if (!emails.includes(email)) {
      emails.push(email);
      localStorage.setItem("feed-planner-emails", JSON.stringify(emails));
    }
    console.log("Email captured:", email);
  }

  function doExport() {
    const blob = FileExport.exportGPX(routeData, feedPoints, settings.device);
    const filename = `${routeData.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_feed_plan.gpx`;
    FileExport.download(blob, filename);
  }

  // ==========================================
  // Utilities
  // ==========================================

  function formatDistance(meters) {
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(1)} km`;
    }
    return `${Math.round(meters)} m`;
  }

  // ==========================================
  // Init
  // ==========================================

  function init() {
    initMap();
    initTheme();
    initUpload();
    initToolbar();
    initSettings();
    initMobileSidebar();
    initEmailCapture();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
