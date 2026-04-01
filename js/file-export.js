/**
 * File Export — generates downloadable GPX files with feed course points.
 *
 * Notification strategy per device:
 * - All devices: <wpt> elements with <name> and <type> are the universal
 *   method for course point alerts. Devices pop up the <name> text when
 *   the rider approaches the waypoint (~100-200m before).
 * - <wpt> must be within ~50m of the <trk> line to be associated with the
 *   course. Our snap-to-route logic guarantees this.
 * - <type> values "Food" and "Water" are recognized by Garmin, Wahoo, and
 *   Hammerhead with specific icons. COROS recognizes them on recent firmware
 *   and falls back to generic on older versions.
 * - The <name> field is what gets displayed in the on-device alert on ALL
 *   platforms — it's the most important field.
 * - Wahoo: ELEMNT devices read course point alerts from <rtept> inside
 *   <rte>, not from <wpt>. The Wahoo export includes an <rte> block with
 *   feed points as <rtept> elements. Original turn-by-turn navigation
 *   waypoints from the input GPX are also preserved as <rtept> elements.
 * - Non-Wahoo: No <rte>/<rtept> block — some devices misinterpret it as
 *   a separate route, causing duplicate alerts or navigation confusion.
 */

const FileExport = (() => {
  /**
   * Export a GPX file with waypoints that trigger feed notifications.
   *
   * @param {RouteData} route - Parsed route data
   * @param {FeedPoint[]} feedPoints - Calculated feed points
   * @param {string} device - Target device: garmin | wahoo | hammerhead | coros
   * @returns {Blob}
   */
  function exportGPX(route, feedPoints, device) {
    const timestamp = new Date().toISOString();
    const routeName = escapeXml(route.name || "Feed Plan Route");

    // Build <wpt> elements — the universal course point format
    const feedWpts = feedPoints
      .map((fp, i) => {
        const name = buildAlertName(fp, device, i + 1);
        const type = getCoursePointType(fp);

        return `  <wpt lat="${fp.lat.toFixed(7)}" lon="${fp.lon.toFixed(7)}">
${fp.elev !== null ? `    <ele>${fp.elev.toFixed(1)}</ele>\n` : ""}    <name>${escapeXml(name)}</name>
    <cmt>${escapeXml(fp.note)}</cmt>
    <desc>${escapeXml(fp.note)}</desc>
    <sym>${type}</sym>
    <type>${type}</type>
  </wpt>`;
      });

    // For Wahoo, preserve original turn-by-turn navigation waypoints
    const navWpts = [];
    if (device === "wahoo" && route.waypoints && route.waypoints.length > 0) {
      const feedTypes = new Set(["Food", "Water"]);
      for (const wpt of route.waypoints) {
        // Skip nutrition waypoints — we're replacing those with ours
        if (feedTypes.has(wpt.type)) continue;
        let xml = `  <wpt lat="${wpt.lat.toFixed(7)}" lon="${wpt.lon.toFixed(7)}">`;
        if (wpt.elev !== null) xml += `\n    <ele>${wpt.elev.toFixed(1)}</ele>`;
        if (wpt.name) xml += `\n    <name>${escapeXml(wpt.name)}</name>`;
        if (wpt.cmt) xml += `\n    <cmt>${escapeXml(wpt.cmt)}</cmt>`;
        if (wpt.desc) xml += `\n    <desc>${escapeXml(wpt.desc)}</desc>`;
        if (wpt.sym) xml += `\n    <sym>${escapeXml(wpt.sym)}</sym>`;
        if (wpt.type) xml += `\n    <type>${escapeXml(wpt.type)}</type>`;
        xml += `\n  </wpt>`;
        navWpts.push(xml);
      }
    }

    const waypointsXml = [...navWpts, ...feedWpts].join("\n");

    // Build track points from route coords
    const trkpts = route.coords
      .map((c) => {
        let pt = `      <trkpt lat="${c.lat.toFixed(7)}" lon="${c.lon.toFixed(7)}">`;
        if (c.elev !== null) pt += `\n        <ele>${c.elev.toFixed(1)}</ele>`;
        pt += `\n      </trkpt>`;
        return pt;
      })
      .join("\n");

    // Wahoo reads course point alerts from <rtept> inside <rte>, not <wpt>
    let rteXml = "";
    if (device === "wahoo") {
      const rtePts = [];

      // Include original nav waypoints as route points
      if (route.waypoints && route.waypoints.length > 0) {
        const feedTypes = new Set(["Food", "Water"]);
        for (const wpt of route.waypoints) {
          if (feedTypes.has(wpt.type)) continue;
          let xml = `      <rtept lat="${wpt.lat.toFixed(7)}" lon="${wpt.lon.toFixed(7)}">`;
          if (wpt.elev !== null) xml += `\n        <ele>${wpt.elev.toFixed(1)}</ele>`;
          if (wpt.name) xml += `\n        <name>${escapeXml(wpt.name)}</name>`;
          if (wpt.cmt) xml += `\n        <cmt>${escapeXml(wpt.cmt)}</cmt>`;
          if (wpt.desc) xml += `\n        <desc>${escapeXml(wpt.desc)}</desc>`;
          if (wpt.sym) xml += `\n        <sym>${escapeXml(wpt.sym)}</sym>`;
          if (wpt.type) xml += `\n        <type>${escapeXml(wpt.type)}</type>`;
          xml += `\n      </rtept>`;
          rtePts.push({ dist: null, xml });
        }
      }

      // Include feed points as route points
      feedPoints.forEach((fp, i) => {
        const name = buildAlertName(fp, device, i + 1);
        const type = getCoursePointType(fp);
        rtePts.push({
          dist: fp.distanceM,
          xml: `      <rtept lat="${fp.lat.toFixed(7)}" lon="${fp.lon.toFixed(7)}">
${fp.elev !== null ? `        <ele>${fp.elev.toFixed(1)}</ele>\n` : ""}        <name>${escapeXml(name)}</name>
        <cmt>${escapeXml(fp.note)}</cmt>
        <desc>${escapeXml(fp.note)}</desc>
        <sym>${type}</sym>
        <type>${type}</type>
      </rtept>`,
        });
      });

      rteXml = `
  <rte>
    <name>${routeName}</name>
${rtePts.map((p) => p.xml).join("\n")}
  </rte>`;
    }

    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd"
     version="1.1"
     creator="HBF Feed Planner">
  <metadata>
    <name>${routeName}</name>
    <desc>Route with nutrition feed alerts generated by HBF Feed Planner</desc>
    <time>${timestamp}</time>
  </metadata>
${waypointsXml}${rteXml}
  <trk>
    <name>${routeName}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;

    return new Blob([gpx], { type: "application/gpx+xml" });
  }

  /**
   * Build the alert name that appears on the device screen.
   * This is the most important field — it's what the rider sees.
   * Keep it short, clear, and ASCII-only (no emojis — some firmware
   * renders them as boxes or strips them).
   */
  function buildAlertName(fp, device, index) {
    const km = (fp.distanceM / 1000).toFixed(1);
    const action = fp.type === "sip" ? "DRINK" : fp.type === "bottle" ? "NEW BOTTLE" : "EAT";
    const carbs = fp.carbs + "g";

    switch (device) {
      case "garmin":
        // Garmin Edge shows name as alert ~100-200m before point
        // Keep concise — long names get truncated on smaller units
        return fp.type === "bottle"
          ? `${action} @ ${km}km`
          : `${action} ${carbs} @ ${km}km`;
      case "wahoo":
        // Wahoo ELEMNT shows name in popup banner
        return fp.type === "bottle"
          ? `${action}`
          : `${action} - ${carbs} carbs`;
      case "hammerhead":
        // Karoo shows name in notification banner
        return fp.type === "bottle"
          ? `${action} (${km}km)`
          : `${action} ${carbs} (${km}km)`;
      case "coros":
        // COROS shows name on watch face — even shorter
        return fp.type === "bottle"
          ? `${action}`
          : `${action} ${carbs}`;
      default:
        return fp.type === "bottle"
          ? `${action} @ ${km}km`
          : `${action} ${carbs} @ ${km}km`;
    }
  }

  /**
   * Get the GPX course point type.
   * "Food" and "Water" are recognized by all major platforms:
   * - Garmin: shows fork/knife or water drop icon
   * - Wahoo: shows POI icon with type label
   * - Hammerhead: shows typed icon
   * - COROS: recent firmware recognizes Food/Water, older falls back to generic
   */
  function getCoursePointType(fp) {
    return fp.type === "eat" ? "Food" : "Water";
  }

  /**
   * Escape special characters for XML.
   */
  function escapeXml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  /**
   * Trigger a file download in the browser.
   */
  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return { exportGPX, download };
})();
