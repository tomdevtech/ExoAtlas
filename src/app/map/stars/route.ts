import { toMapStar, type MapStarsPayload } from "../payload";
import { getMapStars } from "../queries";

/**
 * GET /map/stars answers with every star that has a position, as JSON.
 *
 * The map loads this once when it opens. The catalogue changes at most once a
 * day, so browsers may keep the answer for an hour.
 */
export async function GET() {
  try {
    const payload: MapStarsPayload = { stars: (await getMapStars()).map(toMapStar) };
    return Response.json(payload, {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch (error) {
    console.error("Loading the stars of the map failed:", error);
    return Response.json({ error: "The star catalogue is not available right now." }, { status: 503 });
  }
}
