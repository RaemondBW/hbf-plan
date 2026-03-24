/**
 * GPX / TCX file parser
 * Extracts coordinates, elevation, distances, and route metadata.
 */

const RouteParser = (() => {
  /**
   * Parse a file (GPX or TCX) and return route data.
   * @param {File} file
   * @returns {Promise<RouteData>}
   */
  async function parseFile(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    const text = await file.text();

    if (ext === "gpx") return parseGPX(text, file.name);
    if (ext === "tcx") return parseTCX(text, file.name);
    if (ext === "fit") return parseFIT(file);

    throw new Error(`Unsupported file type: .${ext}`);
  }

  /**
   * Parse GPX XML string.
   */
  function parseGPX(xmlString, fileName) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, "application/xml");

    const parseError = doc.querySelector("parsererror");
    if (parseError) throw new Error("Invalid GPX file");

    // Try track points first, then route points
    let points = Array.from(doc.querySelectorAll("trkpt"));
    if (points.length === 0) {
      points = Array.from(doc.querySelectorAll("rtept"));
    }

    if (points.length === 0) {
      throw new Error("No track or route points found in GPX file");
    }

    const nameEl = doc.querySelector("trk > name") || doc.querySelector("rte > name") || doc.querySelector("metadata > name");
    const name = nameEl ? nameEl.textContent.trim() : fileName.replace(/\.gpx$/i, "");

    const coords = [];
    let totalElevGain = 0;
    let totalElevLoss = 0;
    let prevElev = null;

    for (const pt of points) {
      const lat = parseFloat(pt.getAttribute("lat"));
      const lon = parseFloat(pt.getAttribute("lon"));
      const eleEl = pt.querySelector("ele");
      const elev = eleEl ? parseFloat(eleEl.textContent) : null;

      if (isNaN(lat) || isNaN(lon)) continue;

      coords.push({ lat, lon, elev });

      if (elev !== null && prevElev !== null) {
        const diff = elev - prevElev;
        if (diff > 0) totalElevGain += diff;
        else totalElevLoss += Math.abs(diff);
      }
      if (elev !== null) prevElev = elev;
    }

    // Calculate cumulative distances
    addCumulativeDistances(coords);

    const totalDistance = coords.length > 0 ? coords[coords.length - 1].dist : 0;

    return {
      name,
      coords,
      totalDistance,
      totalElevGain: Math.round(totalElevGain),
      totalElevLoss: Math.round(totalElevLoss),
      format: "gpx",
      rawXml: xmlString,
    };
  }

  /**
   * Parse TCX XML string.
   */
  function parseTCX(xmlString, fileName) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, "application/xml");

    const parseError = doc.querySelector("parsererror");
    if (parseError) throw new Error("Invalid TCX file");

    const trackpoints = Array.from(doc.querySelectorAll("Trackpoint"));

    if (trackpoints.length === 0) {
      throw new Error("No trackpoints found in TCX file");
    }

    const nameEl = doc.querySelector("Activity > Id") || doc.querySelector("Course > Name");
    const name = nameEl ? nameEl.textContent.trim() : fileName.replace(/\.tcx$/i, "");

    const coords = [];
    let totalElevGain = 0;
    let totalElevLoss = 0;
    let prevElev = null;

    for (const tp of trackpoints) {
      const posEl = tp.querySelector("Position");
      if (!posEl) continue;

      const latEl = posEl.querySelector("LatitudeDegrees");
      const lonEl = posEl.querySelector("LongitudeDegrees");
      if (!latEl || !lonEl) continue;

      const lat = parseFloat(latEl.textContent);
      const lon = parseFloat(lonEl.textContent);
      const eleEl = tp.querySelector("AltitudeMeters");
      const elev = eleEl ? parseFloat(eleEl.textContent) : null;

      if (isNaN(lat) || isNaN(lon)) continue;

      coords.push({ lat, lon, elev });

      if (elev !== null && prevElev !== null) {
        const diff = elev - prevElev;
        if (diff > 0) totalElevGain += diff;
        else totalElevLoss += Math.abs(diff);
      }
      if (elev !== null) prevElev = elev;
    }

    addCumulativeDistances(coords);

    const totalDistance = coords.length > 0 ? coords[coords.length - 1].dist : 0;

    return {
      name,
      coords,
      totalDistance,
      totalElevGain: Math.round(totalElevGain),
      totalElevLoss: Math.round(totalElevLoss),
      format: "tcx",
      rawXml: xmlString,
    };
  }

  /**
   * Parse FIT binary file — basic decoder for course/activity records.
   */
  async function parseFIT(file) {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);

    // Validate FIT header
    const headerSize = view.getUint8(0);
    if (headerSize < 12) throw new Error("Invalid FIT file header");

    const dataType = String.fromCharCode(
      view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)
    );
    if (dataType !== ".FIT") throw new Error("Not a valid FIT file");

    // FIT parsing is complex — we do a simplified extraction of record messages
    // looking for latitude/longitude fields in known global message numbers
    const coords = [];
    const dataSize = view.getUint32(4, true);
    let offset = headerSize;
    const endOffset = headerSize + dataSize;

    // Track field definitions per local message type
    const definitions = {};

    while (offset < endOffset && offset < buffer.byteLength - 1) {
      const recordHeader = view.getUint8(offset);
      offset++;

      const isDefinition = (recordHeader & 0x40) !== 0;
      const localMsgType = recordHeader & 0x0f;
      const isCompressedTimestamp = (recordHeader & 0x80) !== 0;

      if (isCompressedTimestamp) {
        // Compressed timestamp — use existing definition
        const def = definitions[localMsgType];
        if (!def) { offset += 1; continue; }
        const recordSize = def.fields.reduce((sum, f) => sum + f.size, 0);
        offset += recordSize;
        continue;
      }

      if (isDefinition) {
        // Definition message
        offset++; // reserved
        const arch = view.getUint8(offset); offset++;
        const isLittleEndian = arch === 0;
        const globalMsgNum = isLittleEndian ? view.getUint16(offset, true) : view.getUint16(offset, false);
        offset += 2;
        const numFields = view.getUint8(offset); offset++;

        const fields = [];
        for (let i = 0; i < numFields; i++) {
          const fieldDefNum = view.getUint8(offset); offset++;
          const size = view.getUint8(offset); offset++;
          const baseType = view.getUint8(offset); offset++;
          fields.push({ fieldDefNum, size, baseType });
        }

        // Check for dev fields (bit 5 of record header)
        const hasDeveloperData = (recordHeader & 0x20) !== 0;
        let devFields = [];
        if (hasDeveloperData) {
          const numDevFields = view.getUint8(offset); offset++;
          for (let i = 0; i < numDevFields; i++) {
            const fn = view.getUint8(offset); offset++;
            const sz = view.getUint8(offset); offset++;
            const di = view.getUint8(offset); offset++;
            devFields.push({ size: sz });
          }
        }

        definitions[localMsgType] = { globalMsgNum, fields, isLittleEndian, devFields };
      } else {
        // Data message
        const def = definitions[localMsgType];
        if (!def) break;

        const recordStart = offset;
        let lat = null, lon = null, altitude = null;

        // record message (global 20) or course_point (global 32) contain lat/lon
        if (def.globalMsgNum === 20 || def.globalMsgNum === 32) {
          for (const field of def.fields) {
            const fieldOffset = offset;
            // position_lat = field 0, position_long = field 1, altitude = field 2 (for record)
            if (field.fieldDefNum === 0 && field.size === 4) {
              // latitude in semicircles
              const raw = view.getInt32(fieldOffset, def.isLittleEndian);
              if (raw !== 0x7FFFFFFF) lat = raw * (180 / 2147483648);
            } else if (field.fieldDefNum === 1 && field.size === 4) {
              const raw = view.getInt32(fieldOffset, def.isLittleEndian);
              if (raw !== 0x7FFFFFFF) lon = raw * (180 / 2147483648);
            } else if (field.fieldDefNum === 2 && field.size === 2) {
              const raw = view.getUint16(fieldOffset, def.isLittleEndian);
              if (raw !== 0xFFFF) altitude = (raw / 5.0) - 500;
            }
            offset += field.size;
          }

          if (lat !== null && lon !== null && !isNaN(lat) && !isNaN(lon)) {
            coords.push({ lat, lon, elev: altitude });
          }
        } else {
          // Skip all fields
          for (const field of def.fields) {
            offset += field.size;
          }
        }

        // Skip dev fields
        if (def.devFields) {
          for (const df of def.devFields) {
            offset += df.size;
          }
        }

        // Safety: if offset didn't advance, break
        if (offset === recordStart) break;
      }
    }

    if (coords.length === 0) {
      throw new Error("No GPS coordinates found in FIT file. Try converting to GPX first.");
    }

    addCumulativeDistances(coords);

    let totalElevGain = 0, totalElevLoss = 0, prevElev = null;
    for (const c of coords) {
      if (c.elev !== null && prevElev !== null) {
        const diff = c.elev - prevElev;
        if (diff > 0) totalElevGain += diff;
        else totalElevLoss += Math.abs(diff);
      }
      if (c.elev !== null) prevElev = c.elev;
    }

    const totalDistance = coords.length > 0 ? coords[coords.length - 1].dist : 0;

    return {
      name: file.name.replace(/\.fit$/i, ""),
      coords,
      totalDistance,
      totalElevGain: Math.round(totalElevGain),
      totalElevLoss: Math.round(totalElevLoss),
      format: "fit",
      rawXml: null,
    };
  }

  /**
   * Calculate cumulative distance along the route for each coordinate.
   * Uses the Haversine formula.
   */
  function addCumulativeDistances(coords) {
    if (coords.length === 0) return;
    coords[0].dist = 0;

    for (let i = 1; i < coords.length; i++) {
      const d = haversine(
        coords[i - 1].lat, coords[i - 1].lon,
        coords[i].lat, coords[i].lon
      );
      coords[i].dist = coords[i - 1].dist + d;
    }
  }

  /**
   * Haversine distance between two lat/lon points in meters.
   */
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Find the coordinate on the route closest to a given distance (meters).
   * Returns the interpolated lat/lon.
   */
  function coordAtDistance(coords, targetDist) {
    if (coords.length === 0) return null;
    if (targetDist <= 0) return { lat: coords[0].lat, lon: coords[0].lon, elev: coords[0].elev };
    if (targetDist >= coords[coords.length - 1].dist) {
      const last = coords[coords.length - 1];
      return { lat: last.lat, lon: last.lon, elev: last.elev };
    }

    // Binary search for the segment
    let lo = 0, hi = coords.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (coords[mid].dist <= targetDist) lo = mid;
      else hi = mid;
    }

    const c1 = coords[lo];
    const c2 = coords[hi];
    const segLen = c2.dist - c1.dist;
    const t = segLen > 0 ? (targetDist - c1.dist) / segLen : 0;

    return {
      lat: c1.lat + t * (c2.lat - c1.lat),
      lon: c1.lon + t * (c2.lon - c1.lon),
      elev: c1.elev !== null && c2.elev !== null ? c1.elev + t * (c2.elev - c1.elev) : null,
    };
  }

  return { parseFile, coordAtDistance, haversine };
})();
