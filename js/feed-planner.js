/**
 * Feed Planner — calculates nutrition feed points along a route.
 */

const FeedPlanner = (() => {
  /**
   * Calculate feed points based on settings and route data.
   *
   * @param {RouteData} route - Parsed route data with coords and distances
   * @param {Object} settings
   * @param {number} settings.carbsPerHour - Target carbs per hour (g)
   * @param {number} settings.feedIntervalMin - Feed interval in minutes
   * @param {number} settings.avgSpeedKmh - Estimated average speed (km/h)
   * @param {number} settings.drinkCarbs - Carbs per drink serving (g)
   * @param {number} settings.foodCarbs - Carbs per food serving (g)
   * @param {string} settings.strategy - "alternate" | "drink-only" | "food-only" | "custom"
   * @returns {FeedPoint[]}
   */
  function calculateFeedPoints(route, settings) {
    const {
      carbsPerHour,
      feedIntervalMin,
      avgSpeedKmh,
      drinkCarbs,
      foodCarbs,
      strategy,
    } = settings;

    const totalDistM = route.totalDistance; // meters
    const avgSpeedMs = (avgSpeedKmh * 1000) / 3600; // m/s
    const feedIntervalS = feedIntervalMin * 60; // seconds
    const feedIntervalM = avgSpeedMs * feedIntervalS; // meters between feeds

    // How many feeds needed?
    const totalTimeH = totalDistM / 1000 / avgSpeedKmh; // hours
    const feedCount = Math.max(1, Math.floor(totalDistM / feedIntervalM));

    // Carbs per feed to meet target
    const feedsPerHour = 60 / feedIntervalMin;
    const carbsPerFeed = carbsPerHour / feedsPerHour;

    const feedPoints = [];

    for (let i = 1; i <= feedCount; i++) {
      const dist = feedIntervalM * i;

      // Don't place feed in last 2km
      if (dist > totalDistM - 2000) break;

      const coord = RouteParser.coordAtDistance(route.coords, dist);
      if (!coord) continue;

      let type;
      if (strategy === "drink-only") {
        type = "drink";
      } else if (strategy === "food-only") {
        type = "food";
      } else {
        // alternate: odd = drink, even = food
        type = i % 2 === 1 ? "drink" : "food";
      }

      const carbs = type === "drink" ? drinkCarbs : foodCarbs;
      const note = type === "drink" ? `Drink — ${carbs}g carbs` : `Eat — ${carbs}g carbs`;

      feedPoints.push({
        id: `feed-${i}`,
        index: i,
        distanceM: dist,
        lat: coord.lat,
        lon: coord.lon,
        elev: coord.elev,
        type,
        carbs,
        note,
      });
    }

    return feedPoints;
  }

  /**
   * Calculate nutrition summary from feed points.
   */
  function calculateSummary(feedPoints, route, settings) {
    const totalCarbs = feedPoints.reduce((sum, fp) => sum + fp.carbs, 0);
    const totalTimeH = route.totalDistance / 1000 / settings.avgSpeedKmh;
    const actualCarbsPerHour = totalTimeH > 0 ? totalCarbs / totalTimeH : 0;
    const drinkFeeds = feedPoints.filter((fp) => fp.type === "drink").length;
    const foodFeeds = feedPoints.filter((fp) => fp.type === "food").length;

    return {
      totalFeeds: feedPoints.length,
      totalCarbs: Math.round(totalCarbs),
      actualCarbsPerHour: Math.round(actualCarbsPerHour),
      estimatedTimeH: totalTimeH,
      drinkFeeds,
      foodFeeds,
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
