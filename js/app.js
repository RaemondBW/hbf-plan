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
    foodCarbs: 25,
    bottleCarbs: 60,
    device: "garmin",
    unit: "mi", // "km" or "mi"
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
    if (settings.unit === "mi") {
      $("#route-elevation").textContent = `↑ ${Math.round(routeData.totalElevGain * 3.28084)}ft`;
    } else {
      $("#route-elevation").textContent = `↑ ${routeData.totalElevGain}m`;
    }

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
    readSettings();

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
      const emoji = fp.type === "sip" ? "💧" : fp.type === "eat" ? "🍫" : "🍼";
      const icon = L.divIcon({
        className: `feed-marker ${fp.type}`,
        html: emoji,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });

      const marker = L.marker([fp.lat, fp.lon], {
        icon,
        draggable: true,
      }).addTo(map);

      const distLabel = formatDistanceShort(fp.distanceM);
      const typeLabel = fp.type === "sip" ? "Sip" : fp.type === "eat" ? "Eat" : "New Bottle";
      const carbsLabel = fp.carbs > 0 ? ` — ${fp.carbs}g` : "";
      marker.bindTooltip(
        `<strong>${typeLabel}</strong>${carbsLabel}<br>${distLabel}`,
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
      card.className = `feed-card ${fp.type}`;

      const distLabel = formatDistanceShort(fp.distanceM);
      const emoji = fp.type === "sip" ? "💧" : fp.type === "eat" ? "🍫" : "🍼";
      const typeLabel = fp.type === "sip" ? "Sip" : fp.type === "eat" ? "Eat" : "New Bottle";
      const carbsLine = fp.carbs > 0 ? `<div class="feed-card-carbs">${fp.carbs}g</div>` : "";
      card.innerHTML = `
        <div class="feed-card-km">${distLabel}</div>
        <div class="feed-card-type ${fp.type}">${emoji} ${typeLabel}</div>
        ${carbsLine}
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
    $("#sum-foods").textContent = summary.eatFeeds;
    $("#sum-sips").textContent = summary.sipFeeds;
    $("#sum-bottles").textContent = summary.bottleFeeds;

    if (isFinite(summary.bottleDurationH) && summary.bottleDurationH > 0) {
      const mins = Math.round(summary.bottleDurationH * 60);
      if (mins >= 60) {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        $("#sum-bottle-duration").textContent = m > 0 ? `${h}h ${m}m` : `${h}h`;
      } else {
        $("#sum-bottle-duration").textContent = `${mins}m`;
      }
    } else {
      $("#sum-bottle-duration").textContent = "∞";
    }
  }

  function updateRouteStats() {
    $("#route-feeds").textContent = `${feedPoints.length} feeds`;
  }

  // ==========================================
  // Feed Edit Popup
  // ==========================================

  function openFeedPopup(fp, marker) {
    const emoji = fp.type === "sip" ? "💧" : fp.type === "eat" ? "🍫" : "🍼";
    const typeLabel = fp.type === "sip" ? "Sip" : fp.type === "eat" ? "Eat" : "New Bottle";
    const popupContent = document.createElement("div");
    popupContent.innerHTML = `
      <div class="popup-title">${emoji} ${typeLabel} — ${formatDistanceShort(fp.distanceM)}</div>
      <div class="popup-row">
        <label>Type</label>
        <div class="popup-type-btns">
          <button class="popup-type-btn ${fp.type === "sip" ? "active" : ""}" data-type="sip">💧 Sip</button>
          <button class="popup-type-btn ${fp.type === "eat" ? "active" : ""}" data-type="eat">🍫 Eat</button>
          <button class="popup-type-btn ${fp.type === "bottle" ? "active" : ""}" data-type="bottle">🍼 Bottle</button>
        </div>
      </div>
      <div class="popup-row">
        <label>Note</label>
        <input type="text" class="popup-note-input" value="${fp.note}" placeholder="e.g. Gel, New bottle..." />
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
      fp.carbs = newType === "eat" ? settings.foodCarbs : 0;

      const newEmoji = newType === "sip" ? "💧" : newType === "eat" ? "🍫" : "🍼";
      const icon = L.divIcon({
        className: `feed-marker ${newType}`,
        html: newEmoji,
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
      maxWidth: 260,
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
      type: "eat",
      carbs: settings.foodCarbs,
      note: `Eat — ${settings.foodCarbs}g carbs`,
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
    const rawSpeed = parseInt($("#avg-speed").value) || 25;
    // Convert mph to km/h for internal calculations
    settings.avgSpeedKmh = settings.unit === "mi" ? rawSpeed * 1.60934 : rawSpeed;
    settings.foodCarbs = parseInt($("#food-carbs").value) || 25;
    settings.bottleCarbs = parseInt($("#bottle-carbs").value) || 60;
  }

  function initSettings() {
    // Sync number inputs with range sliders, and live-update on change
    syncInputRangeLive("carbs-per-hour", "carbs-per-hour-range");
    syncInputRangeLive("feed-interval", "feed-interval-range");
    syncInputRangeLive("avg-speed", "avg-speed-range");

    // Food/bottle carb inputs — live update
    $("#food-carbs").addEventListener("input", onSettingChange);
    $("#bottle-carbs").addEventListener("input", onSettingChange);

    // Device buttons
    $$(".device-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".device-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        settings.device = btn.dataset.device;
      });
    });

    // Unit toggle (km / mi)
    $$(".unit-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const prevUnit = settings.unit;
        $$(".unit-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        settings.unit = btn.dataset.unit;

        // Convert speed value between units
        const speedInput = $("#avg-speed");
        const speedRange = $("#avg-speed-range");
        const rawSpeed = parseFloat(speedInput.value) || 15;
        let converted;
        if (prevUnit === "km" && settings.unit === "mi") {
          converted = Math.round(rawSpeed / 1.60934);
        } else if (prevUnit === "mi" && settings.unit === "km") {
          converted = Math.round(rawSpeed * 1.60934);
        } else {
          converted = rawSpeed;
        }
        speedInput.value = converted;
        speedRange.value = converted;

        updateSpeedLabel();
        if (routeData) {
          onRouteLoaded();
        }
      });
    });
    updateSpeedLabel();
  }

  function updateSpeedLabel() {
    const speedInput = $("#avg-speed");
    const speedRange = $("#avg-speed-range");
    if (!speedInput) return;
    const speedUnit = speedInput.closest(".setting-group").querySelector(".unit");
    if (speedUnit) speedUnit.textContent = settings.unit === "mi" ? "mph" : "km/h";

    if (settings.unit === "mi") {
      speedInput.min = 5; speedInput.max = 35;
      speedRange.min = 5; speedRange.max = 35;
    } else {
      speedInput.min = 10; speedInput.max = 50;
      speedRange.min = 10; speedRange.max = 50;
    }
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

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function initEmailCapture() {
    const modal = $("#email-modal");
    const form = $("#email-form");
    const emailInput = $("#email-input");
    const submitBtn = $("#email-submit-btn");

    // Stop input events from bubbling to prevent interfering with app
    emailInput.addEventListener("input", (e) => {
      e.stopPropagation();
      submitBtn.disabled = !isValidEmail(emailInput.value.trim());
    });
    emailInput.addEventListener("keydown", (e) => e.stopPropagation());
    emailInput.addEventListener("keyup", (e) => e.stopPropagation());

    // Submit with email (required, validated)
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();
      if (!isValidEmail(email)) return;
      storeEmail(email);
      modal.classList.add("hidden");
      emailInput.value = "";
      submitBtn.disabled = true;
      doExport();
    });

    // Close on backdrop click (no download)
    modal.querySelector(".email-modal-backdrop").addEventListener("click", () => {
      modal.classList.add("hidden");
      emailInput.value = "";
      submitBtn.disabled = true;
    });
  }

  function storeEmail(email) {
    // Subscribe to Klaviyo list
    fetch("https://a.klaviyo.com/client/subscriptions/?company_id=U66Fgc", {
      method: "POST",
      headers: {
        "content-type": "application/vnd.api+json",
        "revision": "2025-01-15",
      },
      body: JSON.stringify({
        data: {
          type: "subscription",
          attributes: {
            custom_source: "HBF Feed Planner",
            profile: {
              data: {
                type: "profile",
                attributes: {
                  email,
                  subscriptions: {
                    email: {
                      marketing: {
                        consent: "SUBSCRIBED",
                      },
                    },
                  },
                },
              },
            },
          },
          relationships: {
            list: {
              data: { type: "list", id: "VCtv7H" },
            },
          },
        },
      }),
    })
      .catch(() => {});
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
    if (settings.unit === "mi") {
      const miles = meters / 1609.344;
      if (miles >= 1) return `${miles.toFixed(1)} mi`;
      return `${(miles * 5280).toFixed(0)} ft`;
    }
    if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
    return `${Math.round(meters)} m`;
  }

  function formatDistanceShort(meters) {
    if (settings.unit === "mi") {
      return `${(meters / 1609.344).toFixed(1)} mi`;
    }
    return `${(meters / 1000).toFixed(1)} km`;
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
