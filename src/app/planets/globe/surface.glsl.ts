import { NOISE_GLSL } from "./noise";

/**
 * The shader code that computes the surface of a planet and lights it.
 *
 * Two programs include it: the one for the moving images and the 3D model on
 * the planet pages (globe.glsl.ts), and the one for the planets in the system
 * view of the map. Both therefore show the same planet. The values of the
 * uniforms come from surfaceUniforms() in uniforms.ts, the noise texture
 * uNoise from noise.ts.
 *
 * What kind of surface is drawn, and whether its heights catch the light, is
 * fixed when the program is compiled (surfaceDefines() in uniforms.ts). Each
 * combination is a program of its own that only holds the code it needs, and
 * compiles much faster than one program for everything.
 *
 * It is GLSL ES 3.00 (WebGL 2). Everything is calculated in the planet's own
 * coordinates: the planet is a ball of radius 1 around the origin and y is its
 * axis. Colours are linear light, the caller converts to the screen at the end.
 */
export const SURFACE_GLSL = /* glsl */ `
// 0 map, 1 terrain preset, 2 band preset. Programs that only use the helpers
// below need none of these.
#ifndef KIND
#define KIND 0
#endif
#ifndef RELIEF
#define RELIEF 0
#endif

uniform vec3 uSeed;
uniform vec3 uColLow;
uniform vec3 uColMid;
uniform vec3 uColHigh;
uniform vec4 uOcean;        // colour, sea level as a height of the preset (below -5: no ocean)
uniform float uIce;
uniform vec4 uCloud;        // colour, cover
uniform vec4 uGlow;         // colour, strength
uniform vec4 uAurora;       // polar lights: colour, strength
uniform float uLightning;   // band presets: how often lightning flashes at night
uniform float uCraters;     // how deep the craters of a terrain preset show
uniform float uRelief;
uniform vec3 uBands;        // band presets: contrast, strength of the fine streaks, strength of the storms
uniform vec4 uAtmo;         // colour, density
uniform vec3 uLight;        // colour of the starlight
uniform float uTime;        // seconds, moves the clouds
uniform float uFlow;        // 0 holds the clouds, 1 bands of gas giants, 2 the cloud deck of Venus
uniform mat3 uMapTurn;      // presets: how the planet lays its preset on the ball
uniform mat3 uMapTurn2;     // terrain presets: the same for the second preset
uniform vec4 uTerrain;      // terrain presets: level of lava or dry basins, rivers, height of the relief, 1 for a crust of ice
uniform vec2 uBelts;        // band presets: share of the latitudes shown, phase of the jets
uniform float uZones;       // how sharply the climate is split into zones by latitude: 1 for an upright axis, less the more it is tilted
uniform float uLocked;      // 1 if the planet always turns the same side to its star
uniform vec4 uJets;         // winds: strength and number of the alternating jets, strength and narrowness of the equator jet
uniform float uDetail;      // extra octaves of noise when zoomed in, 0 to 3
uniform vec3 uRing;         // inner edge, outer edge, 1 if there are rings
uniform vec4 uMapFlags;     // night map (terrain presets: second preset), cloud map, ring map, water shines
uniform sampler2D uMapDay;
uniform sampler2D uMapNight;
uniform sampler2D uMapClouds;
uniform sampler2D uRingMap;
uniform highp sampler3D uNoise;

const float PI = 3.141592653589793;

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }

// From linear light to the screen, as a camera would record it. Up to middle
// brightness nothing changes. Above it the light is pressed together more and
// more, so glints and glowing lava fade into white instead of being cut off
// in flat patches. A grain finer than one step of brightness is added: without
// it the dark, even slopes of the night side would show as stripes.
vec3 toDisplay(vec3 c) {
  const float knee = 0.6;
  vec3 over = max(c - knee, 0.0) / (1.0 - knee);
  vec3 pressed = min(c, knee) + (1.0 - knee) * (1.0 - exp(-over));
  float grain = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
  return pow(max(pressed, 0.0), vec3(1.0 / 2.2)) + grain / 255.0;
}

// ---- Noise ----------------------------------------------------------------

${NOISE_GLSL}

// Integer hash (PCG) for the cyclones. The same on every graphics card,
// unlike sin() tricks.
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}

vec3 hash3(vec3 cell) {
  return vec3(pcg3d(uvec3(ivec3(cell) + 65536))) * (1.0 / 4294967295.0);
}

// Several layers of noise, each twice as fine and half as strong.
float fbm(vec3 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  float total = 0.0;
  for (int i = 0; i < 9; i++) {
    if (i >= octaves) break;
    sum += amp * gnoise(p);
    total += amp;
    p = p * 2.02 + vec3(19.1, 7.7, 13.3);
    amp *= 0.52;
  }
  return sum / total;
}

vec3 rotateY(vec3 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

// ---- Moving bands ---------------------------------------------------------

// On gas giants neighbouring bands run at different speeds. Sliding the bands
// for ever would shear the pattern into ever finer stripes, so two phases each
// slide them for FLOW_PERIOD seconds and take turns, fading into each other.
const float FLOW_PERIOD = 8.0;
// Angle in radians per second at the fastest latitude.
const float FLOW_RATE = 0.07;

// East or west speed of the band at the height y (sine of the latitude),
// roughly -1 to 1. Jupiter has many narrow jets in turn, Saturn one broad
// fast jet at the equator, and on Uranus and Neptune the equator runs
// backwards. The phase says where along y the alternating jets begin.
float jetSpeed(float y, float phase) {
  return uJets.x * sin(y * uJets.y + phase) + uJets.z * exp(-y * y * uJets.w);
}

// Venus: the whole cloud deck races round the planet at nearly one speed
// (that is the turning of the globe); towards the poles it falls behind.
float veilSpeed(float y) {
  return -1.2 * smoothstep(0.3, 0.9, abs(y)) + 0.15 * sin(y * 5.0 + uSeed.y);
}

// x and y: angle per unit of speed in the two phases, z: weight of the first.
// The more the two phases lie apart, the more fine details show twice while
// they fade, so maps with sharp storms take a smaller scale. Each place starts
// its cycle at its own time (from slow noise), otherwise the whole planet
// would turn soft and sharp again in step, which the eye notices at once.
vec3 flowPhases(float scale, vec3 p) {
  float a = fract(uTime / FLOW_PERIOD + gnoise(p * 1.7 + uSeed) * 0.9);
  float b = fract(a + 0.5);
  float reach = FLOW_PERIOD * FLOW_RATE * scale;
  return vec3((a - 0.5) * reach, (b - 0.5) * reach, 1.0 - abs(1.0 - 2.0 * a));
}

// ---- Real maps ------------------------------------------------------------

// Reads a map of the whole surface (longitude across, latitude up). The
// longitude jumps from 1 to 0 on the far side; a second longitude that jumps
// on the near side supplies the slope there, otherwise a seam would show.
vec4 sampleMap(sampler2D map, vec3 p, float shift) {
  float u = atan(p.x, p.z) / (2.0 * PI) + 0.5;
  float v = asin(clamp(p.y, -1.0, 1.0)) / PI + 0.5;
  float uAlt = atan(-p.x, -p.z) / (2.0 * PI);
  vec2 dx = vec2(dFdx(u), dFdx(v));
  vec2 dy = vec2(dFdy(u), dFdy(v));
  float dxAlt = dFdx(uAlt);
  float dyAlt = dFdy(uAlt);
  if (abs(dxAlt) + abs(dyAlt) < abs(dx.x) + abs(dy.x)) {
    dx.x = dxAlt;
    dy.x = dyAlt;
  }
  return textureGrad(map, vec2(u + shift, v), dx, dy);
}

// Brightness of the map stands in for height: good enough to let craters and
// mountains catch the light.
float mapHeight(vec3 p) {
  return dot(sampleMap(uMapDay, p, 0.0).rgb, vec3(0.3, 0.6, 0.1));
}

// The clouds of a planet with a map of them (Earth), 0 to 1. The map is one
// photograph. Sliding it round the planet as a whole would look like a
// shell of glass, so each latitude moves with its own winds: the trade winds
// near the equator blow west, the westerlies of the middle latitudes east
// (see flowPhases). The clouds also slowly change their shape.
float mapClouds(vec3 p) {
  vec3 waver = vec3(
    gnoise(p * 5.0 + uSeed + vec3(0.0, uTime * 0.03, 0.0)),
    gnoise(p * 5.0 + uSeed.yzx + vec3(uTime * 0.03, 0.0, 0.0)),
    gnoise(p * 5.0 + uSeed.zxy + vec3(0.0, 0.0, uTime * 0.03))) * 0.012;
  vec3 q = normalize(p + waver);
  // A short reach: the photograph is full of fine detail, which must not show twice.
  vec3 phases = flowPhases(0.14, q + 3.7);
  float wind = -cos(3.0 * asin(clamp(q.y, -1.0, 1.0)));
  // The whole deck drifts east a little as well. Reading the map further
  // west moves its clouds east.
  float drift = -uTime * 0.0012;
  float speed = -wind / (2.0 * PI);
  return mix(
    sampleMap(uMapClouds, q, drift + phases.y * speed).r,
    sampleMap(uMapClouds, q, drift + phases.x * speed).r,
    phases.z);
}

// ---- Rings ----------------------------------------------------------------

// Colour and opacity of the rings at a distance from the axis, in planet radii.
// The footprint is the width one pixel covers there, also in planet radii: the
// wider it is, the more the fine gaps blur together.
vec4 ringSample(float rho, float footprint) {
  float t = (rho - uRing.x) / (uRing.y - uRing.x);
  if (uRing.z < 0.5 || t <= 0.0 || t >= 1.0) return vec4(0.0);
  if (uMapFlags.z > 0.5) {
    float texels = float(textureSize(uRingMap, 0).x) * footprint / (uRing.y - uRing.x);
    vec4 c = textureLod(uRingMap, vec2(t, 0.5), log2(max(texels, 1.0)));
    return vec4(toLinear(c.rgb), c.a);
  }
  // Broad brighter and fainter rings with one dark gap, and lanes within
  // them. Lanes finer than a pixel would flicker as dots: they fade into an
  // even grey instead, as they do in a telescope.
  float width = uRing.y - uRing.x;
  float broad = gnoise(vec3(t * 6.0, uSeed.x, 3.0));
  float lanes = broad * 1.1
    + gnoise(vec3(t * 28.0, uSeed.x, 3.0)) * (1.0 - smoothstep(0.25, 0.9, footprint * 28.0 / width))
    + 0.5 * gnoise(vec3(t * 90.0, 7.0, uSeed.y)) * (1.0 - smoothstep(0.25, 0.9, footprint * 90.0 / width));
  float alpha = clamp(0.55 + lanes * 1.1, 0.06, 0.92);
  float gap = 0.45 + 0.3 * fract(uSeed.y * 0.37);
  alpha *= 1.0 - 0.85 * exp(-pow((t - gap) / 0.035, 2.0));
  alpha *= smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.96, 1.0, t));
  return vec4(uColHigh * (0.8 + 0.4 * broad), alpha);
}

// ---- Clouds ---------------------------------------------------------------

// Twists the point around a few cyclones in the middle latitudes, so the
// clouds there wind into the spiral arms of storms. Only on ocean worlds.
vec3 cyclones(vec3 p) {
  vec3 q = p;
  for (int i = 0; i < 4; i++) {
    vec3 rnd = hash3(vec3(float(i) + 11.0, floor(uSeed.y * 17.0), 3.0));
    float sinLat = (rnd.x < 0.5 ? -1.0 : 1.0) * (0.5 + 0.3 * rnd.z);
    float lon = rnd.y * 2.0 * PI;
    float cosLat = sqrt(1.0 - sinLat * sinLat);
    vec3 centre = vec3(cosLat * sin(lon), sinLat, cosLat * cos(lon));
    vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), centre));
    vec3 north = cross(centre, east);
    vec3 d = p - centre;
    float size = 0.2 + 0.1 * rnd.z;
    float ex = dot(d, east) / size;
    float ey = dot(d, north) / size;
    float r = sqrt(ex * ex + ey * ey);
    // Turning most near the eye: the arms wind up into a spiral. The turn
    // fades to nothing towards the edge, otherwise the clouds would break there.
    float fade = (1.0 - smoothstep(1.2, 2.4, r)) * smoothstep(0.2, 0.5, dot(p, centre));
    float angle = 1.5 / (r + 0.6) * exp(-r * r * 0.3) * sign(sinLat) * fade;
    float c = cos(angle);
    float s = sin(angle);
    q += east * ((c * ex - s * ey - ex) * size) + north * ((s * ex + c * ey - ey) * size);
  }
  return q;
}

// Where a place lies between the warmest and the coldest part of its planet,
// 0 to 1. With days and nights that is the latitude, from the equator to the
// poles. A planet that always turns the same side to its star (direction L) is
// warmest under the star and coldest in the middle of the night side.
float climateZone(vec3 p, vec3 L) {
  return mix(abs(p.y), 0.5 - 0.5 * dot(p, L), uLocked);
}

// Clouds over a solid planet, 0 for clear sky to 1 for overcast. "zone" is
// the climate zone of the place (see climateZone).
float cloudCover(vec3 p, float zone, int octaves) {
  bool weather = uOcean.a > -5.0;
  // Over a planet that cannot turn, the air still circles: there the clouds
  // are what moves.
  vec3 pr = rotateY(p, uTime * mix(0.012, 0.03, uLocked));
  // On ocean worlds winds draw the clouds out along the latitudes.
  vec3 stretch = weather ? vec3(2.8, 3.9, 2.8) : vec3(2.1, 3.0, 2.1);
  vec3 c = (weather ? cyclones(pr) : pr) * stretch + uSeed.yzx;
  // Reading the bending noise a little further along over time lets the
  // clouds slowly change shape while they drift, at no extra cost.
  vec3 morph = vec3(0.0, uTime * 0.015, 0.0);
  vec3 warp = vec3(
    fbm(c * 1.2 + 13.0 + morph, 2),
    fbm(c * 1.2 + 47.0 + morph, 2),
    fbm(c * 1.2 + 83.0 + morph, 2));
  // Strong bending smears clouds into streaks; ocean worlds take less of it.
  float n = fbm(c + warp * (weather ? 0.8 : 1.3), octaves);
  if (weather) {
    // Fine lumps at the edges, as in heaps of cumulus.
    n += fbm(pr * 15.0 + uSeed.zxy + 11.0, 3) * 0.14;
  }
  float cover = uCloud.a;
  if (weather) {
    // A band of thunderstorms where it is warmest, clear skies over the dry
    // belts, storm tracks further out (as the deserts in terrainSurface).
    float lat = zone;
    // A tilted axis smears these belts over the year (uZones).
    cover += mix(0.4, 1.0, uZones) * (
        0.3 * exp(-pow(lat / 0.09, 2.0))
      - 0.3 * exp(-pow((lat - 0.42) / 0.12, 2.0))
      + 0.2 * exp(-pow((lat - 0.68) / 0.14, 2.0)));
  }
  float threshold = mix(0.3, -0.12, clamp(cover, 0.0, 1.0));
  // On ocean worlds the result is how thick the cloud is, rising slowly from
  // its edge, so the light can model it (see shadePlanet).
  return smoothstep(threshold, threshold + (weather ? 0.3 : 0.12), n);
}

// ---- Presets --------------------------------------------------------------

// The base maps of the exoplanets (scripts/generate-presets.ts) hold no
// colours, only what shaped the surface. The values of the planet turn them
// into its own picture here.

#if KIND == 1 || KIND == 2
// Each planet turns and mirrors its preset its own way.
vec3 presetPoint(vec3 p) {
  return uMapTurn * p;
}
#endif

#if KIND == 1
// What the planet's presets hold at a place: red is the height after erosion,
// green where water gathers (or the cracks of an ice crust), blue the craters.
// A planet with two presets shows the one here and the other there; "share"
// says how much of the second.
vec3 terrainData(vec3 p, float share) {
  vec3 d = sampleMap(uMapDay, presetPoint(p), 0.0).rgb;
  if (uMapFlags.x > 0.5) d = mix(d, sampleMap(uMapNight, uMapTurn2 * p, 0.0).rgb, share);
  return d;
}

// Height of the ground at a place, craters included. 0 to 1.
float terrainHeight(vec3 p, float share) {
  vec3 d = terrainData(p, share);
  return d.r + (d.b - 0.5) * 0.24 * uCraters;
}

// A rocky planet from what its presets hold at the place (d, see terrainData).
// "zone" is its climate zone, "sunward" how directly the star stands above it.
void terrainSurface(vec3 p, vec3 d, float zone, float sunward, out vec3 albedo, out float height, out float gloss, out vec3 emit) {
  int extra = int(uDetail);
  float dent = (d.b - 0.5) * 2.0 * uCraters;
  float fine = fbm(p * 9.0 + uSeed, 3 + extra);
  float patches = fbm(p * 3.1 + uSeed.zxy + 91.3, 3);

  gloss = 0.0;
  emit = vec3(0.0);
  height = d.r + dent * 0.12;
  // The preset is too coarse for the finest bays and headlands. Noise adds
  // them, more of it the closer the viewer comes, so coasts stay crisp.
  float h = height + fine * 0.025 + fbm(p * 37.0 + uSeed.yzx, 2 + extra) * 0.012;
  float flow = d.g;
  float level = uOcean.a;

  if (uTerrain.w > 0.5) {
    // A crust of ice: bright young ice, darker old ice, stained cracks.
    albedo = mix(uColMid, uColHigh, smoothstep(0.2, 0.8, h + patches * 0.35));
    albedo = mix(albedo, uColLow, smoothstep(0.05, 0.4, patches) * 0.45);
    float lines = smoothstep(0.1, 0.55, flow);
    albedo = mix(albedo, uColLow * vec3(0.8, 0.55, 0.42), lines * 0.8);
    albedo *= 1.0 + fine * 0.35 + dent * 0.25;
    gloss = 0.3 * (1.0 - lines);
  } else if (level > -5.0) {
    float inland = h - level;
    // How high up, measured on what stands above this planet's sea.
    float alt = smoothstep(0.3, 0.9, inland / max(1.0 - level, 0.05));
    float valley = smoothstep(0.0, 0.64, flow);

    // Climate zones as on Earth: wet near the equator, a dry belt of deserts
    // around 25 degrees, mild middle latitudes, tundra towards the poles and
    // up in the mountains. Valleys are greener, the inland is drier.
    float lat = zone;
    float moisture = patches;
    // On a tilted planet the seasons carry warmth and rain across the
    // latitudes: the desert belts are wider and fainter, the cold begins
    // nearer the poles.
    float dryBelt = exp(-pow((lat - 0.42) / mix(0.24, 0.13, uZones), 2.0)) * mix(0.5, 1.0, uZones);
    float dryness = clamp(dryBelt * 0.95 - moisture * 1.3 + smoothstep(0.03, 0.3, inland) * 0.3 - valley * 0.35 - 0.1, 0.0, 1.0);
    float warmer = (1.0 - uZones) * 0.15;
    float cold = smoothstep(0.6 + warmer, 0.85 + warmer, lat + moisture * 0.15 + alt * 0.25);

    // Seen from space vegetation is dark and muted, not bright green.
    float grey = dot(uColLow, vec3(0.3, 0.6, 0.1));
    vec3 forest = mix(uColLow, vec3(grey), 0.3) * 0.55;
    vec3 grass = mix(uColLow, uColMid, 0.25) * 0.85;
    vec3 tundra = mix(uColHigh, uColLow, 0.35) * 0.8;
    vec3 land = mix(forest, grass, smoothstep(0.15, 0.45, dryness));
    land = mix(land, uColMid, smoothstep(0.45, 0.75, dryness));
    land = mix(land, tundra, cold);
    land = mix(land, uColHigh * 0.9, smoothstep(0.35, 0.8, alt));
    land = mix(land, vec3(0.8, 0.83, 0.87), smoothstep(0.75, 1.0, alt + cold * 0.4));
    land *= 0.85 + fine * 0.6 + patches * 0.15;

    // Rivers run where it is neither frozen nor desert.
    float river = smoothstep(0.49, 0.82, flow) * uTerrain.y * (1.0 - cold) * (1.0 - dryness * 0.6);
    land = mix(land, uOcean.rgb * 0.9, river * 0.8);

    // Light shallow water on the shelves, dark deep sea.
    float depth = clamp(-inland / 0.25, 0.0, 1.0);
    vec3 water = mix(uOcean.rgb * vec3(0.95, 1.15, 1.12), uOcean.rgb * 0.35, smoothstep(0.0, 0.3, depth));
    float shore = smoothstep(level - 0.004, level + 0.004, h);
    albedo = mix(water, land, shore);
    gloss = (1.0 - shore) + shore * river * 0.5;
    height = max(height, level);
  } else {
    // Dry ground. Basins filled long ago are darker plains, old riverbeds
    // darker lines, craters bright rims and dark floors.
    float basin = uTerrain.x > 0.0 ? 1.0 - smoothstep(uTerrain.x - 0.1, uTerrain.x + 0.1, h + patches * 0.12) : 0.0;
    float t = clamp(h + patches * 0.25, 0.0, 1.0);
    // Highlands are paler than lowlands, but dust lies over both: the colours
    // run into each other over a long way.
    albedo = mix(uColLow, uColMid, smoothstep(0.15, 0.6, t));
    albedo = mix(albedo, uColHigh, smoothstep(0.45, 1.0, t) * 0.7);
    albedo = mix(albedo, uColLow * 0.8, basin * 0.45);
    // Broad lighter and darker regions, as dust and rock differ.
    albedo *= 1.0 + fbm(p * 1.6 + uSeed + 17.0, 3) * 0.5;
    albedo *= 1.0 - smoothstep(0.27, 0.82, flow) * 0.3 * uTerrain.y;
    albedo *= 1.0 + fine * 0.5 + dent * 0.45;
  }

  if (uGlow.a > 0.0) {
    // Lava: seas in the basins under a dark crust that breaks into glowing
    // cracks, and streams running down the channels. On a planet that always
    // faces its star the same way, the rock melts on the day side and
    // hardens on the night side.
    float lava = uTerrain.x + uLocked * 0.3 * sunward * min(uGlow.a, 1.0);
    float sea = 1.0 - smoothstep(lava - 0.02, lava + 0.02, h);
    float crust = abs(fbm(p * 7.0 + uSeed + 55.5, 4 + extra));
    float cracks = 1.0 - smoothstep(0.0, 0.05, crust);
    float streams = smoothstep(0.45, 0.82, flow) * (1.0 - sea);
    float heat = clamp(sea * (0.18 + 0.82 * cracks + fine * 0.5) + streams, 0.0, 1.0);
    vec3 fire = mix(uGlow.rgb, vec3(1.0, 0.82, 0.45), heat * heat);
    emit = fire * heat * uGlow.a * 1.6;
    albedo *= 1.0 - heat * 0.7;
    height = mix(height, lava, sea);
  }

  if (uIce > 0.0 && uTerrain.w < 0.5) {
    float latitude = zone + fine * 0.08 + patches * 0.1 + max(h - 0.6, 0.0) * 0.12;
    float ice = smoothstep(1.0 - uIce - 0.04, 1.0 - uIce + 0.04, latitude);
    albedo = mix(albedo, vec3(0.86, 0.91, 0.96) * (0.92 + fine * 0.5), ice);
    gloss = mix(gloss, 0.25, ice);
  }
}
#endif

#if KIND == 2
// The wind a band preset was drawn out with, at the sine s of one of its
// latitudes: the jets of the simulation (scripts/generate-presets.ts), calm
// towards the poles. Positive blows east.
float presetWind(float s) {
  return jetSpeed(s, uBelts.y) * (1.0 - pow(abs(s), 6.0));
}

// Threads of cloud along the bands, finer than the preset can hold.
float cloudThreads(vec3 q) {
  return fbm(vec3(q.x * 6.0, q.y * 80.0, q.z * 6.0) + uSeed.zxy, 3 + int(uDetail));
}

// A gas giant from a band preset: red are the belts and zones, green a second
// tracer for fine streaks, blue the storms. "flash" is the lightning there.
void bandsSurface(vec3 p, out vec3 albedo, out vec3 emit, out float flash) {
  float contrast = uBands.x;
  vec3 q = presetPoint(p);
  // Only a part of the latitudes of the preset is shown, which widens the belts.
  float lat = asin(clamp(q.y, -1.0, 1.0)) * uBelts.x;
  vec2 around = normalize(q.xz + vec2(1e-6, 0.0)) * cos(lat);
  q = vec3(around.x, sin(lat), around.y);

  vec3 d;
  float threads;
  if (uFlow > 0.0) {
    vec3 phases = flowPhases(0.6, p);
    // The same winds blow on, so the clouds keep drifting the way they were
    // drawn out. Reading the map further west moves its clouds east.
    float speed = -presetWind(q.y) / (2.0 * PI);
    d = mix(
      sampleMap(uMapDay, q, phases.y * speed).rgb,
      sampleMap(uMapDay, q, phases.x * speed).rgb,
      phases.z);
    // The fine threads are carried along with them. Standing still, they
    // would lie over the drifting clouds like scratches on a window.
    threads = mix(
      cloudThreads(rotateY(q, phases.y * speed * 2.0 * PI)),
      cloudThreads(rotateY(q, phases.x * speed * 2.0 * PI)),
      phases.z);
  } else {
    d = sampleMap(uMapDay, q, 0.0).rgb;
    threads = cloudThreads(q);
  }
  // Not inside the storms, where the clouds run in circles.
  threads *= 1.0 - d.b;

  // The preset holds every grey between the darkest belt and the brightest
  // zone. All of them are kept: two flat colours with an edge between them
  // would look drawn, the soft steps in between look like cloud.
  float streak = (d.g - 0.5) * 2.0;
  float tone = clamp(
    0.5 + ((d.r - 0.5) * 1.7 + (streak * 0.1 + threads * 0.12) * uBands.y) * contrast, 0.0, 1.0);
  albedo = tone < 0.5
    ? mix(uColLow, uColMid, tone * 2.0)
    : mix(uColMid, uColHigh, tone * 2.0 - 1.0);

  // No two belts have the same colour: one is redder, the next greyer, as the
  // clouds of each latitude are made of something else. The second tracer
  // marks gas that came up from below and tints it a little as well.
  float belt = gnoise(vec3(uSeed.x, q.y * 4.3 + uSeed.y, 7.3)) * 1.5;
  vec3 grey = vec3(dot(albedo, vec3(0.3, 0.6, 0.1)));
  albedo = mix(albedo, albedo * vec3(1.14, 0.95, 0.8), clamp(belt, 0.0, 1.0) * 0.7);
  albedo = mix(albedo, grey * vec3(0.94, 0.99, 1.07), clamp(-belt, 0.0, 1.0) * 0.5);
  albedo *= 1.0 + streak * vec3(0.1, 0.05, -0.03);

  // Storms are darker and warmer than the clouds around them.
  vec3 storm = mix(uColLow, uColHigh, 0.3) * vec3(1.12, 0.9, 0.8);
  albedo = mix(albedo, storm, d.b * uBands.z * 0.45 * contrast);

  // The poles are hazier and darker.
  albedo = mix(albedo, uColMid * 0.72, smoothstep(0.7, 1.0, abs(p.y)) * 0.55);

  // Very hot giants glow from below. The dark belts are gaps in the clouds,
  // so the deeper and hotter gas shows through them most.
  // Faint heat is a deep red, strong heat turns orange, like glowing iron.
  float heat = 0.08 + 0.92 * pow(1.0 - tone, 2.2);
  emit = mix(uGlow.rgb * vec3(0.75, 0.3, 0.2), uGlow.rgb, heat) * heat * uGlow.a;

  // Lightning: for a blink, a cell of thunderclouds lights up from within,
  // most often in the storms.
  flash = 0.0;
  if (uLightning > 0.0) {
    vec3 cells = q * 26.0;
    vec3 rnd = hash3(floor(cells) + floor(uTime * 4.0) * vec3(7.0, 3.0, 5.0));
    flash = step(1.0 - 0.0007 * uLightning * (1.0 + 4.0 * d.b), rnd.x)
      * (1.0 - smoothstep(0.0, 0.45, length(fract(cells) - 0.5)));
  }
}
#endif

// ---- Light ----------------------------------------------------------------

// The colour of the planet at the point p, lit from the direction L and seen
// from the direction V. All three are unit vectors in the planet's coordinates.
vec3 shadePlanet(vec3 p, vec3 L, vec3 V) {
  vec3 albedo;
  vec3 emit = vec3(0.0);
  float height = 0.0;
  float gloss = 0.0;
  float cloud = 0.0;
  vec3 cloudColor = uCloud.rgb;

#if KIND == 1
  // Bending the lookup a little gives each planet its own coastlines. A
  // second, very fine bend frays what the preset can only draw in steps of
  // its pixels: rivers and shores stay ragged when the viewer comes close.
  vec3 bend = vec3(
    gnoise(p * 1.4 + uSeed),
    gnoise(p * 1.4 + uSeed + 31.7),
    gnoise(p * 1.4 + uSeed + 67.1)) * 0.11;
  bend += vec3(
    gnoise(p * 57.0 + uSeed.zxy),
    gnoise(p * 57.0 + uSeed.zxy + 13.3),
    gnoise(p * 57.0 + uSeed.zxy + 41.9)) * 0.004;
  // Large patches of the one preset and of the other, running into each
  // other over a long way: a short one would stand in the land as a cliff.
  float share = smoothstep(-0.32, 0.32, gnoise(p * 0.8 + uSeed.yzx + 23.0));
  float zone = climateZone(p, L);
  terrainSurface(p, terrainData(normalize(p + bend), share), zone, dot(p, L), albedo, height, gloss, emit);
  // How thick the cloud is here. Thin edges let the ground show through.
  float thick = 0.0;
  if (uCloud.a > 0.0) {
    thick = cloudCover(p, zone, 5 + int(uDetail));
    cloud = smoothstep(0.0, 0.4, thick);
  }
#elif KIND == 2
  float flash;
  bandsSurface(p, albedo, emit, flash);
#else
  vec3 texel;
  if (uFlow > 0.0) {
    // Banded planets: each latitude of the map slides at its own speed (see flowPhases).
    // The soft clouds of Venus can take the full reach, sharp storms only half.
    bool veil = uFlow > 1.5;
    vec3 phases = flowPhases(veil ? 1.0 : 0.5, p);
    float speed = (veil ? veilSpeed(p.y) : jetSpeed(p.y, uSeed.x)) / (2.0 * PI);
    texel = mix(
      sampleMap(uMapDay, p, phases.y * speed).rgb,
      sampleMap(uMapDay, p, phases.x * speed).rgb,
      phases.z);
    if (veil) {
      // Brighter and darker swaths, drawn out along the flow, that drift
      // over the map and slowly change shape, as the clouds of Venus do.
      vec3 c = rotateY(p, uTime * 0.02) * vec3(2.0, 4.5, 2.0) + uSeed.zxy;
      vec3 morph = vec3(0.0, uTime * 0.02, 0.0);
      vec3 warp = vec3(fbm(c * 1.3 + 5.0 + morph, 2), fbm(c * 1.3 + 29.0 + morph, 2), 0.0);
      texel *= 1.0 + fbm(c + warp * 1.2, 4) * 0.35;
    }
  } else {
    texel = sampleMap(uMapDay, p, 0.0).rgb;
  }
  albedo = toLinear(texel);
  height = dot(texel, vec3(0.3, 0.6, 0.1));
  // Water is the part of the map that is clearly blue.
  gloss = uMapFlags.w * smoothstep(0.0, 0.02, albedo.b - max(albedo.r, albedo.g) * 1.15);
  if (uMapFlags.y > 0.5) {
    cloud = smoothstep(0.05, 0.95, mapClouds(p));
    cloudColor = vec3(1.0);
  } else if (uCloud.a > 0.0) {
    // No map of the clouds (Mars): thin computed veils over the real ground.
    cloud = cloudCover(p, abs(p.y), 6 + int(uDetail)) * 0.55;
  }
#endif

  // Heights tilt the surface a little, so slopes facing the star are brighter.
  vec3 n = p;
#if RELIEF
  // Compare the height with the heights a little to the east and north.
  vec3 east = normalize(vec3(p.z, 0.0, -p.x) + vec3(1e-6, 0.0, 0.0));
  vec3 north = cross(p, east);
#if KIND == 1
  // Wide enough to step over single pixels of the preset.
  const float reach = 0.007;
  float hEast = terrainHeight(normalize(p + east * reach + bend), share);
  float hNorth = terrainHeight(normalize(p + north * reach + bend), share);
  vec3 slope = ((hEast - height) * east + (hNorth - height) * north) * (0.07 * uTerrain.z / reach);
#else
  const float reach = 0.004;
  float hEast = mapHeight(normalize(p + east * reach));
  float hNorth = mapHeight(normalize(p + north * reach));
  vec3 slope = ((hEast - height) * east + (hNorth - height) * north) * (0.02 / reach);
#endif
  slope *= uRelief * (1.0 - gloss) * (1.0 - cloud);
  float steepness = length(slope);
  if (steepness > 0.8) slope *= 0.8 / steepness;
  n = normalize(p - slope);
#endif

  // An atmosphere carries light a little way past the edge of the day side.
  float wrap = 0.02 + 0.22 * uAtmo.a;
  float geo = dot(p, L);
  float sun = clamp((dot(n, L) + wrap) / (1.0 + wrap), 0.0, 1.0);
  float sunFlat = clamp((geo + wrap) / (1.0 + wrap), 0.0, 1.0);

  // Clouds throw shadows on the ground: the cloud a little towards the star
  // stands between it and the point. The flatter the light, the further away
  // that cloud is. Computed everywhere, since the map lookups need it so.
  float shadow = 0.0;
  vec3 towardsStar = (L - p * geo) * (0.035 / max(geo, 0.3));
  vec3 sp = normalize(p + towardsStar);
#if KIND == 1
  // The cloud towards the star shades the ground and the cloud here: its
  // sunward side is bright, the far side grey, which gives clouds their body.
  float cloudLight = 1.0;
  if (uCloud.a > 0.0) {
    // How thick it is over there is read off the neighbouring pixels: how
    // fast the cloud thickens towards the star, times the distance. Computing
    // the clouds a second time would double the cost of the planet.
    vec2 thicker = vec2(dFdx(thick), dFdy(thick));
    vec2 nearer = vec2(dFdx(geo), dFdy(geo));
    float rate = dot(thicker, nearer) / (dot(nearer, nearer) + 1e-8);
    float sunward = clamp(thick + rate * (1.0 - geo * geo) * (0.035 / max(geo, 0.3)), 0.0, 1.0);
    shadow = smoothstep(0.0, 0.4, sunward);
    cloudLight = clamp(0.84 + 0.16 * thick + 0.75 * (thick - sunward), 0.5, 1.12);
  }
#elif KIND == 0
  if (uMapFlags.y > 0.5) {
    shadow = smoothstep(0.05, 0.95, mapClouds(sp));
  } else if (uCloud.a > 0.0) {
    shadow = cloudCover(sp, abs(sp.y), 6 + int(uDetail)) * 0.55;
  }
#endif
  shadow *= step(0.0, geo) * 0.7;

  // Where the star stands low, its light has come a long way through the air
  // and has lost some of its blue. Seen from space that is a narrow seam
  // along the edge of the night; a little further into the day, clouds and
  // ice are white again.
  vec3 starlight = uLight;
#if KIND != 2
  starlight *= mix(vec3(1.0), mix(vec3(1.0, 0.8, 0.62), vec3(1.0), smoothstep(-0.12, 0.07, geo)), uAtmo.a);
#endif

  vec3 color = albedo * starlight * sun * (1.0 - cloud * 0.3) * (1.0 - shadow);
#if KIND == 2
  // A ball of gas has no hard surface: towards its edge the view runs through
  // more and more haze, and the clouds below grow dim.
  color *= 0.4 + 0.6 * pow(max(dot(p, V), 0.0), 0.5);
  // A picture exposed for the sunlit clouds hardly shows the glow of a hot
  // giant by day. It shows on the night side.
  emit *= 1.0 - 0.8 * smoothstep(-0.15, 0.5, geo);
  // Lightning only shows in the dark.
  emit += vec3(0.75, 0.82, 1.0) * flash * (1.0 - smoothstep(-0.25, 0.0, geo));
#endif

  // Sunlight glints on water and ice.
  vec3 H = normalize(L + V);
  float glint = pow(max(dot(n, H), 0.0), 120.0) * gloss * (1.0 - cloud) * (1.0 - shadow) * step(0.0, geo);
  color += starlight * glint * 0.3;

#if KIND == 1
  cloudColor *= cloudLight;
#endif
  color = mix(color, cloudColor * starlight * sunFlat, cloud * 0.94);

  // The lights of the cities show on the night side.
#if KIND == 0
  if (uMapFlags.x > 0.5) {
    vec3 night = toLinear(sampleMap(uMapNight, p, 0.0).rgb);
    color += night * 1.8 * (1.0 - smoothstep(-0.2, 0.1, geo)) * (1.0 - cloud * 0.6);
  }
#endif

  color += emit * (1.0 - cloud * 0.8);

  // The rings throw a shadow on the planet.
  if (uRing.z > 0.5 && abs(L.y) > 1e-4) {
    float t = -p.y / L.y;
    if (t > 0.0) {
      vec3 hit = p + t * L;
      color *= 1.0 - ringSample(length(hit.xz), 0.02).a * 0.8;
    }
  }

  // A trace of light on the night side, so the planet does not vanish.
  color += albedo * 0.004;

  if (uAurora.a > 0.0) {
    // Polar lights: a thin oval around each magnetic pole, which leans a
    // little away from the axis. The oval wavers, and along it stand rays
    // that come and go. Seen from space it is a faint line of light, and it
    // only shows against the dark.
    float waver = gnoise(vec3(p.x * 5.0, uTime * 0.04, p.z * 5.0) + uSeed.zxy);
    float pole = abs(dot(p, vec3(0.19, 0.98, 0.07))) + waver * 0.008;
    float oval = exp(-pow((pole - 0.94) / 0.009, 2.0));
    float rays = fbm(vec3(p.x * 46.0, uTime * 0.2, p.z * 46.0) + uSeed, 2);
    float dark = 1.0 - smoothstep(-0.45, -0.1, geo);
    color += uAurora.rgb * uAurora.a * oval * (0.2 + 0.9 * max(rays + 0.25, 0.0)) * (0.6 + waver) * dark * 0.55;
  }

  // The air scatters light towards the viewer: a thin veil over the whole day
  // side, and much more towards the edge, where the view passes through more
  // of it. By day it has the colour of the sky; at the edge of the night it
  // glows like a sunset.
  float rim = pow(1.0 - max(dot(p, V), 0.0), 3.0);
#if KIND == 2
  float haze = clamp(rim * uAtmo.a * 0.9, 0.0, 1.0);
  vec3 sky = uAtmo.rgb;
#else
  float haze = clamp((0.035 + rim) * uAtmo.a * 0.9, 0.0, 1.0);
  vec3 sky = mix(uAtmo.rgb * vec3(1.45, 0.82, 0.55), uAtmo.rgb, smoothstep(-0.1, 0.12, geo));
#endif
  color = mix(color, sky * uLight * smoothstep(-0.3, 0.45, geo) * 1.1, haze);

  return color;
}
`;
