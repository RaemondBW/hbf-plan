/**
 * Feed Planner — calculates nutrition feed points along a route.
 *
 * Feed point types:
 *   "sip"    — reminder to sip from bottle
 *   "eat"    — reminder to eat a food item
 *   "bottle" — bottle is empty, grab a new one
 */

const FeedPlanner = (() => {
  /**
   * Calculate feed points based on settings and route data.
   *
   * Model:
   *  - Feed interval determines when eat + sip reminders appear.
   *  - Every other feed interval is an "eat", the rest are "sip".
   *  - Food carbs per item is known; remainder of target comes from sipping.
   *  - Bottle duration is calculated from sip rate and bottle carbs.
   *  - "bottle" markers are placed where a bottle runs out.
   */
  function calculateFeedPoints(route, settings) {
    const {
      carbsPerHour,
      feedIntervalMin,
      avgSpeedKmh,
      foodCarbs,
      bottleCarbs,
    } = settings;

    const totalDistM = route.totalDistance;
    const avgSpeedMs = (avgSpeedKmh * 1000) / 3600;
    const feedIntervalS = feedIntervalMin * 60;
    const feedIntervalM = avgSpeedMs * feedIntervalS; // meters between feeds

    const feedCount = Math.max(1, Math.floor(totalDistM / feedIntervalM));

    // Calculate food contribution per hour
    const feedsPerHour = 60 / feedIntervalMin;
    const eatFeedsPerHour = feedsPerHour / 2; // every other interval is eat
    const foodCarbsPerHour = eatFeedsPerHour * foodCarbs;

    // Remainder comes from sipping
    const sipCarbsPerHour = Math.max(0, carbsPerHour - foodCarbsPerHour);

    // How long does a bottle last?
    const bottleDurationH = sipCarbsPerHour > 0
      ? bottleCarbs / sipCarbsPerHour
      : Infinity;
    const bottleDurationM = bottleDurationH * avgSpeedKmh * 1000; // meters

    const feedPoints = [];
    let eatCounter = 0;

    for (let i = 1; i <= feedCount; i++) {
      const dist = feedIntervalM * i;

      // Don't place feed in last 2km
      if (dist > totalDistM - 2000) break;

      const coord = RouteParser.coordAtDistance(route.coords, dist);
      if (!coord) continue;

      // Alternate: odd intervals = sip, even intervals = eat
      const isEat = i % 2 === 0;
      const type = isEat ? "eat" : "sip";
      const carbs = isEat ? foodCarbs : Math.round(sipCarbsPerHour / feedsPerHour * 2);
      const label = isEat
        ? `Eat — ${foodCarbs}g carbs`
        : `Sip — ~${carbs}g`;

      feedPoints.push({
        id: `feed-${i}`,
        index: i,
        distanceM: dist,
        lat: coord.lat,
        lon: coord.lon,
        elev: coord.elev,
        type,
        carbs,
        note: label,
      });
    }

    // Add "new bottle" markers based on bottle duration
    if (bottleDurationM < totalDistM && bottleDurationM > 0 && isFinite(bottleDurationM)) {
      let bottleDist = bottleDurationM;
      let bottleNum = 1;

      while (bottleDist < totalDistM - 2000) {
        const coord = RouteParser.coordAtDistance(route.coords, bottleDist);
        if (coord) {
          feedPoints.push({
            id: `bottle-${bottleNum}`,
            index: 1000 + bottleNum,
            distanceM: bottleDist,
            lat: coord.lat,
            lon: coord.lon,
            elev: coord.elev,
            type: "bottle",
            carbs: 0,
            note: `New Bottle #${bottleNum + 1}`,
          });
        }
        bottleDist += bottleDurationM;
        bottleNum++;
      }
    }

    // Sort all points by distance
    feedPoints.sort((a, b) => a.distanceM - b.distanceM);

    return feedPoints;
  }

  /**
   * Calculate nutrition summary from feed points.
   */
  function calculateSummary(feedPoints, route, settings) {
    const totalTimeH = route.totalDistance / 1000 / settings.avgSpeedKmh;

    const eatFeedsPerHour = (60 / settings.feedIntervalMin) / 2;
    const foodCarbsPerHour = eatFeedsPerHour * settings.foodCarbs;
    const sipCarbsPerHour = Math.max(0, settings.carbsPerHour - foodCarbsPerHour);

    const bottleDurationH = sipCarbsPerHour > 0
      ? settings.bottleCarbs / sipCarbsPerHour
      : Infinity;

    const totalCarbs = Math.round(settings.carbsPerHour * totalTimeH);
    const actualCarbsPerHour = settings.carbsPerHour;

    const eatFeeds = feedPoints.filter(fp => fp.type === "eat").length;
    const sipFeeds = feedPoints.filter(fp => fp.type === "sip").length;
    const bottleFeeds = feedPoints.filter(fp => fp.type === "bottle").length;
    const totalBottles = bottleFeeds + 1; // includes the starting bottle

    return {
      totalFeeds: feedPoints.length,
      totalCarbs,
      actualCarbsPerHour,
      estimatedTimeH: totalTimeH,
      eatFeeds,
      sipFeeds,
      bottleFeeds: totalBottles,
      bottleDurationH,
    };
  }

  /**
   * Snap a lat/lon to the nearest point on the route.
   * Returns the distance along the route.
   */
  function snapToRoute(route, lat, lon) {
    let bestDist = Infinity;
    let bestRouteDist = 0;

    for (let i = 0; i < route.coords.length; i++) {
      const d = RouteParser.haversine(lat, lon, route.coords[i].lat, route.coords[i].lon);
      if (d < bestDist) {
        bestDist = d;
        bestRouteDist = route.coords[i].dist;
      }
    }

    return bestRouteDist;
  }

  return { calculateFeedPoints, calculateSummary, snapToRoute };
})();
