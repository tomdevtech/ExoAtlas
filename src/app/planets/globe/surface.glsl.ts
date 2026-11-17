import { NOISE_GLSL } from "./noise";

/**
 * GLSL ES 3.00 that computes and lights a planet's surface. Both globe.glsl.ts and the system view
 * of the map include it, so a planet looks the same in both. It works in planet space (a unit
 * sphere with y as the axis) and in linear light. The uniforms come from surfaceUniforms() and the
 * KIND and RELIEF defines from surfaceDefines() in uniforms.ts; the uNoise texture comes from noise.ts.
 */
export const SURFACE_GLSL = /* glsl */ `
// KIND is 0 for a map, 1 for a terrain preset and 2 for a band preset. The defaults let programs
// that only use the helpers below compile without setting these.
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
uniform vec4 uOcean;        // colour, sea level as a preset height (below -5: no ocean)
uniform float uIce;
uniform vec4 uCloud;        // colour, cover
uniform vec4 uGlow;         // colour, strength
uniform vec4 uAurora;       // polar lights: colour, strength
uniform float uLightning;   // band presets: lightning frequency at night
uniform float uCraters;     // crater depth of a terrain preset
uniform float uRelief;
uniform vec3 uBands;        // band presets: contrast, fine streak strength, storm strength
uniform vec4 uAtmo;         // colour, density
uniform vec3 uLight;        // colour of the starlight
uniform float uTime;        // seconds
uniform float uFlow;        // 0 static clouds, 1 gas-giant bands, 2 Venus cloud deck
uniform mat3 uMapTurn;      // presets: orientation of the preset on the sphere
uniform mat3 uMapTurn2;     // terrain presets: orientation of the second preset
uniform vec4 uTerrain;      // terrain presets: lava/basin level, rivers, relief height, 1 for an ice crust
uniform vec2 uBelts;        // band presets: share of latitudes shown, jet phase
uniform float uZones;       // sharpness of latitude climate zones: 1 for an upright axis, less with tilt
uniform float uLocked;      // 1 if tidally locked
uniform vec4 uJets;         // alternating jets: strength, count; equatorial jet: strength, narrowness
uniform float uDetail;      // extra octaves of noise when zoomed in, 0 to 3
uniform float uStormSpin;   // band presets: spin rate of the preset's storms, 0 to 1
uniform vec4 uGiantStorms[6]; // band presets: longitude, latitude, half height (radians), 1 or -1 for spin direction
// The storms alive right now are the same for every pixel, so storms.ts computes them once per
// frame.
uniform vec4 uCyclones[12]; // per cyclone: centre, size; strength, hemisphere (+-1, +-2 if tropical), maturity, spin; elongation, lump seed
uniform float uCycloneCount;
uniform vec4 uDusts[3];     // dust storms: centre and radius
uniform vec3 uDustLives;    // strength of each, 0 for none
uniform vec4 uOutbreak;     // band presets: outbreak head longitude and latitude, age 0 to 1, strength
uniform float uOutbreakTail; // 1 or -1: the side the tail trails on
uniform vec3 uRing;         // inner radius, outer radius, 1 if there are rings
uniform vec4 uMapFlags;     // night map (terrain: second preset), cloud map, ring map, water is glossy
uniform sampler2D uMapDay;
uniform sampler2D uMapNight;
uniform sampler2D uMapClouds;
uniform sampler2D uRingMap;
uniform highp sampler3D uNoise;

const float PI = 3.141592653589793;

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }

// Converts linear light for display. Values above the knee are compressed so glints and lava fade
// into white instead of clipping, and a dither smaller than one brightness step prevents banding on
// the dark night side.
vec3 toDisplay(vec3 c) {
  const float knee = 0.6;
  vec3 over = max(c - knee, 0.0) / (1.0 - knee);
  vec3 pressed = min(c, knee) + (1.0 - knee) * (1.0 - exp(-over));
  float grain = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
  return pow(max(pressed, 0.0), vec3(1.0 / 2.2)) + grain / 255.0;
}

${NOISE_GLSL}

// PCG integer hash. Unlike sin()-based hashes, it gives the same result on every GPU.
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

// The size of one pixel on the surface, in planet radii. shadePlanet sets it, and so do the moon
// and the star for themselves.
float gPixel = 0.0;

// How much of a noise layer that repeats frequency times per planet radius can be shown. Layers
// whose features shrink below two pixels fade out, because they would alias and shimmer as the
// planet turns.
float shows(float frequency) {
  return 1.0 - smoothstep(0.5, 1.0, frequency * gPixel);
}

// Fractal noise whose first layer repeats scale times per planet radius; layers finer than a pixel
// fade out (see shows). Every layer is sampled without a branch, because branching would stop the
// GPU from batching the texture fetches.
float fbm(vec3 p, int octaves, float scale) {
  float sum = 0.0;
  float amp = 0.5;
  float total = 0.0;
  for (int i = 0; i < 9; i++) {
    if (i >= octaves) break;
    sum += amp * shows(scale) * gnoise(p);
    total += amp;
    p = p * 2.02 + vec3(19.1, 7.7, 13.3);
    amp *= 0.52;
    scale *= 2.02;
  }
  // Dividing by the weight of all layers keeps the coarse layers from getting stronger when the
  // fine ones fade out.
  return sum / total;
}

// Unrolled versions with two, three and four layers. Most callers need only a few layers, and these
// run and compile faster than the loop.
float fbm2(vec3 p, float scale) {
  return (0.5 * shows(scale) * gnoise(p)
    + 0.26 * shows(scale * 2.02) * gnoise(p * 2.02 + vec3(19.1, 7.7, 13.3))) / 0.76;
}

float fbm3(vec3 p, float scale) {
  vec3 p2 = p * 2.02 + vec3(19.1, 7.7, 13.3);
  return (0.5 * shows(scale) * gnoise(p) + 0.26 * shows(scale * 2.02) * gnoise(p2)
    + 0.1352 * shows(scale * 4.0804) * gnoise(p2 * 2.02 + vec3(19.1, 7.7, 13.3))) / 0.8952;
}

float fbm4(vec3 p, float scale) {
  vec3 p2 = p * 2.02 + vec3(19.1, 7.7, 13.3);
  vec3 p3 = p2 * 2.02 + vec3(19.1, 7.7, 13.3);
  return (0.5 * shows(scale) * gnoise(p) + 0.26 * shows(scale * 2.02) * gnoise(p2)
    + 0.1352 * shows(scale * 4.0804) * gnoise(p3)
    + 0.070304 * shows(scale * 8.2424) * gnoise(p3 * 2.02 + vec3(19.1, 7.7, 13.3))) / 0.965504;
}

vec3 rotateY(vec3 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

// Neighbouring bands of a gas giant move at different speeds. Sliding them forever would shear the
// pattern into ever finer stripes, so two phases each slide for FLOW_PERIOD seconds and cross-fade.
const float FLOW_PERIOD = 8.0;
// The angle in radians per second at the fastest latitude.
const float FLOW_RATE = 0.07;

// East-west wind speed at y = sin(latitude), roughly -1 to 1. The jets can model many alternating
// bands (Jupiter), one broad equatorial jet (Saturn) or a retrograde equator (Uranus, Neptune).
float jetSpeed(float y, float phase) {
  return uJets.x * sin(y * uJets.y + phase) + uJets.z * exp(-y * y * uJets.w);
}

// On Venus the whole cloud deck circles the planet at nearly one speed and falls behind towards the
// poles.
float veilSpeed(float y) {
  return -1.2 * smoothstep(0.3, 0.9, abs(y)) + 0.15 * sin(y * 5.0 + uSeed.y);
}

// Returns the angle per unit of speed for both phases (x, y) and the weight of the first (z). A
// larger scale makes fine details show twice during the fade. Each place starts its cycle at its
// own time, so the planet does not turn soft and sharp in sync.
vec3 flowPhases(float scale, vec3 p) {
  float a = fract(uTime / FLOW_PERIOD + gnoise(p * 1.7 + uSeed) * 0.9);
  float b = fract(a + 0.5);
  float reach = FLOW_PERIOD * FLOW_RATE * scale;
  return vec3((a - 0.5) * reach, (b - 0.5) * reach, 1.0 - abs(1.0 - 2.0 * a));
}

// Samples an equirectangular map. The longitude jumps from 1 to 0 on the far side, so the gradients
// come from a second longitude with its seam on the near side; otherwise the seam would show.
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

// Map brightness stands in for height, which is good enough for craters and mountains to catch the
// light.
float mapHeight(vec3 p) {
  return dot(sampleMap(uMapDay, p, 0.0).rgb, vec3(0.3, 0.6, 0.1));
}

// Cloud cover from 0 to 1 for planets with a cloud map (Earth). Each latitude moves with its own
// winds, because sliding the whole map would look like a rigid glass shell.
float mapClouds(vec3 p) {
  vec3 waver = vec3(
    gnoise(p * 5.0 + uSeed + vec3(0.0, uTime * 0.03, 0.0)),
    gnoise(p * 5.0 + uSeed.yzx + vec3(uTime * 0.03, 0.0, 0.0)),
    gnoise(p * 5.0 + uSeed.zxy + vec3(0.0, 0.0, uTime * 0.03))) * 0.012;
  vec3 q = normalize(p + waver);
  // A short reach keeps the fine detail of the photo from showing twice.
  vec3 phases = flowPhases(0.14, q + 3.7);
  float wind = -cos(3.0 * asin(clamp(q.y, -1.0, 1.0)));
  // The whole deck also drifts slowly east; sampling further west moves the clouds east.
  float drift = -uTime * 0.0012;
  float speed = -wind / (2.0 * PI);
  return mix(
    sampleMap(uMapClouds, q, drift + phases.y * speed).r,
    sampleMap(uMapClouds, q, drift + phases.x * speed).r,
    phases.z);
}

// Ring colour and opacity at distance rho from the axis. The footprint is the width of one pixel
// there; both are in planet radii, and a wider footprint blurs the fine gaps.
vec4 ringSample(float rho, float footprint) {
  float t = (rho - uRing.x) / (uRing.y - uRing.x);
  if (uRing.z < 0.5 || t <= 0.0 || t >= 1.0) return vec4(0.0);
  if (uMapFlags.z > 0.5) {
    float texels = float(textureSize(uRingMap, 0).x) * footprint / (uRing.y - uRing.x);
    vec4 c = textureLod(uRingMap, vec2(t, 0.5), log2(max(texels, 1.0)));
    return vec4(toLinear(c.rgb), c.a);
  }
  // Without a ring map, the rings get broad bands, one dark gap and fine lanes. Lanes finer than a
  // pixel fade to an even grey instead of flickering, as in a telescope.
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

// What the storms add at the last sampled point: extra cover (negative in the eye) and thunderstorm
// strength for lightning.
float gStormCover = 0.0;
float gStormCore = 0.0;

// Cloud thickness from 0 to 1 at the last sampled point, without the fine cells at the edges (see
// cloudCover). The lighting uses it so the cells do not break the shading into grain.
float gCloudBody = 0.0;

// Returns a point on the unit sphere from sin(latitude) and longitude.
vec3 onBall(float sinLat, float lon) {
  float cosLat = sqrt(max(1.0 - sinLat * sinLat, 0.0));
  return vec3(cosLat * sin(lon), sinLat, cosLat * cos(lon));
}

#if KIND == 1
// Share of land, from 0 to 1, below a point in the drifting cloud frame, read from a coarse mip
// level of the preset. It rises over a stretch of coast so a storm weakens gradually as it drifts
// ashore.
float landBelow(vec3 pr, float rate) {
  vec3 ground = uMapTurn * rotateY(pr, -uTime * rate);
  vec2 uv = vec2(atan(ground.x, ground.z) / (2.0 * PI) + 0.5, asin(clamp(ground.y, -1.0, 1.0)) / PI + 0.5);
  return smoothstep(uOcean.a - 0.05, uOcean.a + 0.05, textureLod(uMapDay, uv, 4.0).r);
}
#endif

// Sea cyclones in the frame of the drifting clouds; storms.ts decides where they are and how old.
// Tropical ones form an eye and spiral arms and weaken over land, while mid-latitude ones are wider
// and have no eye. Returns the point twisted by their winds.
vec3 cyclones(vec3 p, float rate) {
  vec3 q = p;
  gStormCover = 0.0;
  gStormCore = 0.0;
  for (int i = 0; i < 4; i++) {
    if (float(i) >= uCycloneCount) break;
    vec4 place = uCyclones[3 * i];
    vec4 state = uCyclones[3 * i + 1];
    vec4 own = uCyclones[3 * i + 2];
    vec3 centre = place.xyz;
    float size = place.w;
    float life01 = state.x;
    float hemi = sign(state.y);
    bool tropical = abs(state.y) > 1.5;
    float mature = state.z;
    vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), centre));
    vec3 north = cross(centre, east);
    vec3 d = p - centre;
    float ex = dot(d, east) / size;
    // No storm is perfectly round.
    float ey = dot(d, north) / size * own.x;
    if (ex * ex + ey * ey > 12.0) continue;
#if KIND == 1
    // Tropical storms weaken over land. The preset is only read here, for the few points a storm
    // reaches.
    if (tropical) life01 *= mix(1.0, 0.25, landBelow(centre, rate));
#endif
    // The inflowing air is lumpy, so the storm's shape wavers and its bands break up.
    vec3 lumps = vec3(ex, ey, own.y);
    ex += gnoise(lumps * 0.9 + uSeed) * 0.4;
    ey += gnoise(lumps.yxz * 0.9 + uSeed.yzx) * 0.4;
    float r = sqrt(ex * ex + ey * ey);
    float fade = (1.0 - smoothstep(1.8, 3.0, r)) * smoothstep(0.2, 0.5, dot(p, centre));
    // The twist is strongest near the eye and tightens as the storm matures and ages. It fades to
    // zero at the edge so the clouds do not tear there.
    float turn = state.w / (r + 0.45) * exp(-r * r * 0.22);
    float angle = turn * hemi * life01 * fade;
    float c = cos(angle);
    float s = sin(angle);
    q += east * ((c * ex - s * ey - ex) * size) + north * ((s * ex + c * ey - ey) * size);
    float bend = gnoise(lumps * 1.9 + uSeed.zxy) * 2.2;
    float arms = 0.5 + 0.5 * cos(2.0 * atan(ey, ex) - hemi * 5.0 * log(r + 0.08) + bend);
    arms *= 0.45 + 0.75 * smoothstep(-0.25, 0.3, gnoise(lumps * 3.3 + uSeed));
    float core = exp(-r * r * (tropical ? 1.4 : 0.6));
    float eye = exp(-pow(r / 0.16, 2.0)) * mature;
    // A tropical storm is a dense round mass; a mid-latitude storm is a loose comma around a
    // clearer centre.
    gStormCover += life01 * fade * (core * (tropical ? 0.45 : 0.12) + arms * exp(-r * r * 0.3) * (tropical ? 0.38 : 0.32)) - eye * life01 * 1.8;
    gStormCore = max(gStormCore, life01 * core * (1.0 - eye) * (tropical ? 1.0 : 0.6));
  }
  return q;
}

// Dust storms on a dry planet with air; now and then one covers the whole planet, as on Mars.
// storms.ts decides where they are. Returns how much dust hides the ground, from 0 to 1.
float dustStorms(vec3 p) {
  // Most of the surface lies outside every storm most of the time, so the costly billows are
  // skipped there. The billows move the edge by at most 0.3 * min(radius, 0.6).
  vec3 away = vec3(9.0);
  bool any = false;
  for (int i = 0; i < 3; i++) {
    if (uDustLives[i] <= 0.0) continue;
    float radius = uDusts[i].w;
    away[i] = acos(clamp(dot(p, uDusts[i].xyz), -1.0, 1.0));
    if (away[i] - 0.3 * min(radius, 0.6) < radius) any = true;
  }
  if (!any) return 0.0;
  float billow = fbm3(p * 7.0 + uSeed.zxy + vec3(uTime * 0.02, 0.0, 0.0), 7.0);
  float dust = 0.0;
  for (int i = 0; i < 3; i++) {
    if (uDustLives[i] <= 0.0) continue;
    float radius = uDusts[i].w;
    float far = away[i] + billow * 0.3 * min(radius, 0.6);
    dust = max(dust, uDustLives[i] * (1.0 - smoothstep(radius * 0.5, radius, far)));
  }
  return clamp(dust * (0.8 + 0.5 * billow), 0.0, 1.0);
}

// Dust takes the colour of the ground it came from, tinted by the haze.
vec3 dustColor() {
  return mix(uColMid, uAtmo.rgb, 0.35) * 1.1;
}

// Where a place lies between the warmest (0) and the coldest (1) part of the planet. That is the
// latitude on a rotating planet and the distance from the point under the star (L) on a tidally
// locked one.
float climateZone(vec3 p, vec3 L) {
  return mix(abs(p.y), 0.5 - 0.5 * dot(p, L), uLocked);
}

// Cloud cover over a solid planet, from 0 for clear sky to 1 for overcast. zone comes from
// climateZone.
float cloudCover(vec3 p, float zone, int octaves) {
  bool weather = uOcean.a > -5.0;
  // A tidally locked planet does not turn, but its air still circulates, so its clouds move faster.
  float rate = mix(0.012, 0.03, uLocked);
  vec3 pr = rotateY(p, uTime * rate);
  // On ocean worlds the winds stretch the clouds along the latitudes.
  vec3 stretch = weather ? vec3(2.8, 3.9, 2.8) : vec3(2.1, 3.0, 2.1);
  gStormCover = 0.0;
  gStormCore = 0.0;
  vec3 c = (weather ? cyclones(pr, rate) : pr) * stretch + uSeed.yzx;
  // Moving the warp noise over time lets the clouds change shape as they drift, at no extra cost.
  vec3 morph = vec3(0.0, uTime * 0.015, 0.0);
  vec3 warp = vec3(
    fbm2(c * 1.2 + 13.0 + morph, 4.7),
    fbm2(c * 1.2 + 47.0 + morph, 4.7),
    fbm2(c * 1.2 + 83.0 + morph, 4.7));
  // Strong warping smears clouds into streaks, so ocean worlds use less of it.
  float n = fbm(c + warp * (weather ? 0.8 : 1.3), octaves, 3.9);
  float cover = uCloud.a;
  if (weather) {
    // Thunderstorms gather where it is warmest, the subtropics are clear, and storm tracks lie
    // further out (like the deserts in terrainSurface).
    float lat = zone;
    // A tilted axis smears these belts over the year (uZones).
    cover += mix(0.4, 1.0, uZones) * (
        0.3 * exp(-pow(lat / 0.09, 2.0))
      - 0.3 * exp(-pow((lat - 0.42) / 0.12, 2.0))
      + 0.2 * exp(-pow((lat - 0.68) / 0.14, 2.0)));
    n += gStormCover;
  }
  float threshold = mix(0.3, -0.12, clamp(cover, 0.0, 1.0));
  // Without weather the result is the cloud thickness, which the lighting uses (see shadePlanet).
  if (!weather) {
    gCloudBody = smoothstep(threshold, threshold + 0.12, n);
    return gCloudBody;
  }
  // With weather, thin cellular veils with fraying edges lie between thick cloud masses. The
  // thickness of a mass rises steeply from its edge, which gives it a lit side, a grey side and a
  // shadow on the ground (see shadePlanet).
  float clear = threshold - 0.12;
  float dense = threshold + 0.3;
  // The lumps and cells move the result by at most 0.23, so they are skipped where the sky is
  // clearly clear or overcast.
  if (n < clear - 0.23) {
    gCloudBody = 0.0;
    return 0.0;
  }
  if (n > dense + 0.23) {
    gCloudBody = 1.0;
    return 1.0;
  }
  // Fine lumps at the edges make the clouds look like heaps of cumulus.
  float lumps = fbm3(pr * 15.0 + uSeed.zxy + 11.0, 15.0) * 0.14;
  // The lighting differentiates the body over 2x2 pixel blocks. The lumps join the body only once
  // their finest layer spans several blocks, because smaller lumps would make the blocks visible.
  gCloudBody = smoothstep(threshold, dense, n + lumps * (1.0 - smoothstep(0.12, 0.25, 61.0 * gPixel)));
  n += lumps;
  float mass = smoothstep(threshold, dense, n);
  float veil = smoothstep(clear, threshold + 0.4, n + fbm2(pr * 38.0 + uSeed.yzx + 5.0, 38.0) * 0.09);
  return max(veil, mass);
}

// The exoplanet presets (scripts/generate-presets.ts) hold no colours, only what shaped the
// surface. The code below turns them into each planet's own picture.
#if KIND == 1 || KIND == 2
vec3 presetPoint(vec3 p) {
  return uMapTurn * p;
}
#endif

#if KIND == 1
// Reads the presets at a point: r is the eroded height, g is where water gathers (or the cracks of
// an ice crust), and b holds the craters. share is how much of the second preset is mixed in.
vec3 terrainData(vec3 p, float share) {
  vec3 d = sampleMap(uMapDay, presetPoint(p), 0.0).rgb;
  if (uMapFlags.x > 0.5) d = mix(d, sampleMap(uMapNight, uMapTurn2 * p, 0.0).rgb, share);
  return d;
}

// Ground height from 0 to 1, including craters.
float terrainHeight(vec3 p, float share) {
  vec3 d = terrainData(p, share);
  return d.r + (d.b - 0.5) * 0.24 * uCraters;
}

// Rocky surface from the preset data d. zone comes from climateZone, and sunward is how directly
// the star stands above the point.
void terrainSurface(vec3 p, vec3 d, float zone, float sunward, out vec3 albedo, out float height, out float gloss, out vec3 emit) {
  int extra = int(uDetail);
  float dent = (d.b - 0.5) * 2.0 * uCraters;
  float fine = fbm(p * 9.0 + uSeed, 3 + extra, 9.0);
  float patches = fbm3(p * 3.1 + uSeed.zxy + 91.3, 3.1);

  gloss = 0.0;
  emit = vec3(0.0);
  height = d.r + dent * 0.12;
  // The preset is too coarse for small bays and headlands, so noise adds them, more when zoomed in,
  // which keeps coasts crisp.
  float h = height + fine * 0.025 + fbm(p * 37.0 + uSeed.yzx, 2 + extra, 37.0) * 0.012;
  float flow = d.g;
  float level = uOcean.a;

  if (uTerrain.w > 0.5) {
    // An ice crust has bright young ice, darker old ice and stained cracks.
    albedo = mix(uColMid, uColHigh, smoothstep(0.2, 0.8, h + patches * 0.35));
    albedo = mix(albedo, uColLow, smoothstep(0.05, 0.4, patches) * 0.45);
    float lines = smoothstep(0.1, 0.55, flow);
    albedo = mix(albedo, uColLow * vec3(0.8, 0.55, 0.42), lines * 0.8);
    albedo *= 1.0 + fine * 0.35 + dent * 0.25;
    gloss = 0.3 * (1.0 - lines);
  } else if (level > -5.0) {
    float inland = h - level;
    // Altitude is measured relative to what lies above this planet's sea.
    float alt = smoothstep(0.3, 0.9, inland / max(1.0 - level, 0.05));
    float valley = smoothstep(0.0, 0.64, flow);

    // Earth-like climate zones: it is wet near the equator, dry around 25 degrees, mild in the
    // mid-latitudes and cold near the poles and on mountains. Valleys are greener and the inland is
    // drier.
    float lat = zone;
    float moisture = patches;
    // On a tilted planet the seasons widen and weaken the desert belts and push the cold towards
    // the poles.
    float dryBelt = exp(-pow((lat - 0.42) / mix(0.24, 0.13, uZones), 2.0)) * mix(0.5, 1.0, uZones);
    float dryness = clamp(dryBelt * 0.95 - moisture * 1.3 + smoothstep(0.03, 0.3, inland) * 0.3 - valley * 0.35 - 0.1, 0.0, 1.0);
    float warmer = (1.0 - uZones) * 0.15;
    float cold = smoothstep(0.6 + warmer, 0.85 + warmer, lat + moisture * 0.15 + alt * 0.25);

    // Seen from space, vegetation is dark and muted rather than bright green.
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

    float river = smoothstep(0.49, 0.82, flow) * uTerrain.y * (1.0 - cold) * (1.0 - dryness * 0.6);
    land = mix(land, uOcean.rgb * 0.9, river * 0.8);

    // Shallow shelves are light and the deep sea is dark.
    float depth = clamp(-inland / 0.25, 0.0, 1.0);
    vec3 water = mix(uOcean.rgb * vec3(0.95, 1.15, 1.12), uOcean.rgb * 0.35, smoothstep(0.0, 0.3, depth));
    float shore = smoothstep(level - 0.004, level + 0.004, h);
    albedo = mix(water, land, shore);
    gloss = (1.0 - shore) + shore * river * 0.5;
    height = max(height, level);
  } else {
    // On dry ground, old filled basins are darker plains, old riverbeds are darker lines, and
    // craters have bright rims and dark floors.
    float basin = uTerrain.x > 0.0 ? 1.0 - smoothstep(uTerrain.x - 0.1, uTerrain.x + 0.1, h + patches * 0.12) : 0.0;
    float t = clamp(h + patches * 0.25, 0.0, 1.0);
    // Highlands are paler than lowlands, but dust covers both, so the colours blend over a long
    // distance.
    albedo = mix(uColLow, uColMid, smoothstep(0.15, 0.6, t));
    albedo = mix(albedo, uColHigh, smoothstep(0.45, 1.0, t) * 0.7);
    albedo = mix(albedo, uColLow * 0.8, basin * 0.45);
    albedo *= 1.0 + fbm3(p * 1.6 + uSeed + 17.0, 1.6) * 0.5;
    albedo *= 1.0 - smoothstep(0.27, 0.82, flow) * 0.3 * uTerrain.y;
    albedo *= 1.0 + fine * 0.5 + dent * 0.45;

    // Weathered ground turns rusty and bare rock stays grey, so a dry world is never one flat
    // colour.
    float rust = fbm3(p * 2.2 + uSeed.yzx + 3.0, 2.2);
    float grey = dot(albedo, vec3(0.3, 0.6, 0.1));
    albedo = mix(albedo, albedo * vec3(1.1, 0.94, 0.85), smoothstep(0.0, 0.35, rust) * 0.5);
    albedo = mix(albedo, vec3(grey) * vec3(0.95, 0.97, 1.0), smoothstep(0.0, 0.35, -rust) * 0.35);
    // Rock strata show on the slopes of the highlands.
    float slopes = smoothstep(0.45, 0.8, t);
    if (slopes > 0.0) albedo *= 1.0 + sin(h * 140.0 + fbm2(p * 6.0 + uSeed, 6.0) * 6.0) * 0.06 * slopes;
    // With an atmosphere, wind piles the lowland sand into dune fields with bright crests and dark
    // lee sides.
    if (uAtmo.a > 0.05) {
      // The ridges repeat 150 times per radius and would only alias from afar, so they fade out
      // with shows().
      float lowland = (1.0 - smoothstep(0.35, 0.6, h)) * shows(150.0);
      if (lowland > 0.0) {
        vec3 sand = p * vec3(150.0, 55.0, 150.0) + uSeed + gnoise(p * 18.0 + uSeed.zxy) * 2.5;
        float dune = pow(clamp(1.0 - abs(gnoise(sand) * 1.7), 0.0, 1.0), 2.0);
        albedo *= mix(1.0, 0.76 + 0.48 * dune, lowland * 0.9);
      }
    }
    // Fine grain of dust and stones adds detail that gets finer when zoomed in.
    albedo *= 1.0 + fbm(p * 120.0 + uSeed.zxy, 2 + extra, 120.0) * 0.18;
  }

  if (uGlow.a > 0.0) {
    // Lava fills the basins under a dark crust and runs down the channels. On a tidally locked
    // planet the rock melts on the day side and hardens on the night side.
    float lava = uTerrain.x + uLocked * 0.3 * sunward * min(uGlow.a, 1.0);
    float sea = 1.0 - smoothstep(lava - 0.02, lava + 0.02, h);
    // Thin glowing cracks and open lava pools only appear inside a lava sea. A crust that glows
    // evenly everywhere would look like neon.
    float cracks = 0.0;
    float pool = 0.0;
    if (sea > 0.0) {
      float crust = abs(fbm(p * 7.0 + uSeed + 55.5, 4 + extra, 7.0));
      cracks = 1.0 - smoothstep(0.0, 0.03, crust);
      pool = smoothstep(0.0, 0.35, fbm3(p * 3.3 + uSeed.yzx + 9.0, 3.3));
    }
    float streams = smoothstep(0.45, 0.82, flow) * (1.0 - sea);
    float heat = clamp(sea * (0.08 + 0.5 * cracks * (0.35 + 0.65 * pool) + 0.8 * pool * (0.55 + fine)) + streams * 0.8, 0.0, 1.0);
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
// The wind a band preset was simulated with (scripts/generate-presets.ts) at s = sin(latitude). It
// calms towards the poles, and positive values blow east.
float presetWind(float s) {
  return jetSpeed(s, uBelts.y) * (1.0 - pow(abs(s), 6.0));
}

// Thin cloud threads along the bands add detail finer than the preset can hold.
float cloudThreads(vec3 q) {
  return fbm(vec3(q.x * 6.0, q.y * 80.0, q.z * 6.0) + uSeed.zxy, 3 + int(uDetail), 80.0);
}

// Turns a preset point around the preset's largest storms (uGiantStorms) by as far as they turn in
// the given seconds. Each storm turns fastest at its centre, so its clouds wind round inside it.
vec3 turnStorms(vec3 q, float seconds) {
  if (uStormSpin <= 0.0) return q;
  float lon = atan(q.x, q.z);
  float lat = asin(clamp(q.y, -1.0, 1.0));
  bool turned = false;
  for (int i = 0; i < 6; i++) {
    vec4 storm = uGiantStorms[i];
    if (storm.z <= 0.0) continue;
    float dLon = mod(lon - storm.x + PI, 2.0 * PI) - PI;
    float ex = dLon / (1.7 * storm.z);
    float ey = (lat - storm.y) / storm.z;
    float r2 = ex * ex + ey * ey;
    if (r2 >= 9.0) continue;
    // Sampling the image turned backwards shows the storm turned forwards.
    float angle = -storm.w * 0.16 * uStormSpin * seconds * exp(-r2 * 0.6) * (1.0 - r2 / 9.0);
    float c = cos(angle);
    float s = sin(angle);
    lon = storm.x + (c * ex - s * ey) * 1.7 * storm.z;
    lat = storm.y + (s * ex + c * ey) * storm.z;
    turned = true;
  }
  // Most of the planet lies outside every storm and is returned unchanged.
  return turned ? onBall(sin(lat), lon) : q;
}

// A storm outbreak as on Saturn: a bright plume wells up at one point and is drawn out along its
// band. storms.ts decides where it is and how old. Returns its cover from 0 to 1 at the preset
// point q.
float outbreak(vec3 q) {
  float life01 = uOutbreak.w;
  if (life01 <= 0.0) return 0.0;
  float f = uOutbreak.z;
  float dLon = mod(atan(q.x, q.z) - uOutbreak.x + PI, 2.0 * PI) - PI;
  float dLat = asin(clamp(q.y, -1.0, 1.0)) - uOutbreak.y;
  // The tail trails behind the head and grows longer and wider with time.
  float tail = dLon * uOutbreakTail;
  float stretch = 0.15 + 2.4 * f;
  float width = 0.035 + 0.07 * f;
  // The head is bright and lumpy where the cloud wells up, and the tail thins out.
  float along = tail > 0.0 ? exp(-pow(tail / stretch, 2.0) * 1.5) * (0.45 + 0.55 * exp(-tail / (0.3 * stretch))) : exp(-pow(tail / 0.06, 2.0));
  float crown = exp(-(dLon * dLon + dLat * dLat) / pow(width * 1.3, 2.0));
  float body = along * exp(-pow(dLat / width, 2.0));
  // The puffs are at most 1.3, so they are skipped where the plume cannot show, which is most of
  // the planet.
  if ((body * 1.3 + crown * 0.8) * life01 < 0.004) return 0.0;
  float puffs = smoothstep(-0.15, 0.35, fbm4(q * 34.0 + uSeed + vec3(uTime * 0.05), 34.0)) * 1.3;
  return clamp((body * puffs + crown * 0.8) * life01, 0.0, 1.0);
}

// A gas giant from a band preset: r holds the belts and zones, g a second tracer for fine streaks,
// and b the storms. flash returns the lightning there.
void bandsSurface(vec3 p, out vec3 albedo, out vec3 emit, out float flash) {
  float contrast = uBands.x;
  vec3 q = presetPoint(p);
  // Only part of the preset's latitudes is shown, which widens the belts.
  float lat = asin(clamp(q.y, -1.0, 1.0)) * uBelts.x;
  vec2 around = normalize(q.xz + vec2(1e-6, 0.0)) * cos(lat);
  q = vec3(around.x, sin(lat), around.y);

  vec3 d;
  float threads;
  if (uFlow > 0.0) {
    vec3 phases = flowPhases(0.6, p);
    // The clouds keep drifting with the winds they were simulated with; sampling further west moves
    // them east.
    float speed = -presetWind(q.y) / (2.0 * PI);
    // Each phase also lets the storms turn for as long as it has run.
    float seconds = 1.0 / (FLOW_RATE * 0.6);
    d = mix(
      sampleMap(uMapDay, turnStorms(rotateY(q, 2.0 * PI * phases.y * speed), phases.y * seconds), 0.0).rgb,
      sampleMap(uMapDay, turnStorms(rotateY(q, 2.0 * PI * phases.x * speed), phases.x * seconds), 0.0).rgb,
      phases.z);
    // The fine threads drift too, because standing still they would look like scratches on a
    // window.
    threads = mix(
      cloudThreads(rotateY(q, phases.y * speed * 2.0 * PI)),
      cloudThreads(rotateY(q, phases.x * speed * 2.0 * PI)),
      phases.z);
  } else {
    d = sampleMap(uMapDay, q, 0.0).rgb;
    threads = cloudThreads(q);
  }
  // Threads are left out inside the storms, where the clouds run in circles.
  threads *= 1.0 - d.b;

  // Every grey of the preset is kept, because two flat colours with an edge between them would look
  // drawn.
  float streak = (d.g - 0.5) * 2.0;
  float tone = clamp(
    0.5 + ((d.r - 0.5) * 1.7 + (streak * 0.1 + threads * 0.12) * uBands.y) * contrast, 0.0, 1.0);
  albedo = tone < 0.5
    ? mix(uColLow, uColMid, tone * 2.0)
    : mix(uColMid, uColHigh, tone * 2.0 - 1.0);

  // Each belt gets its own tint, redder or greyer, because the clouds of each latitude differ in
  // make-up. The second tracer marks upwelling gas and tints it slightly.
  float belt = gnoise(vec3(uSeed.x, q.y * 4.3 + uSeed.y, 7.3)) * 1.5;
  vec3 grey = vec3(dot(albedo, vec3(0.3, 0.6, 0.1)));
  albedo = mix(albedo, albedo * vec3(1.14, 0.95, 0.8), clamp(belt, 0.0, 1.0) * 0.7);
  albedo = mix(albedo, grey * vec3(0.94, 0.99, 1.07), clamp(-belt, 0.0, 1.0) * 0.5);
  albedo *= 1.0 + streak * vec3(0.1, 0.05, -0.03);

  // Storms are darker and warmer than the clouds around them.
  vec3 storm = mix(uColLow, uColHigh, 0.3) * vec3(1.12, 0.9, 0.8);
  albedo = mix(albedo, storm, d.b * uBands.z * 0.45 * contrast);

  // A fresh plume is brighter and whiter than anything around it.
  float plume = outbreak(q);
  // A slight shadow at its edge sets it apart even from bright zones.
  float rim = smoothstep(0.02, 0.25, plume) * (1.0 - smoothstep(0.25, 0.7, plume));
  albedo *= 1.0 - 0.3 * rim;
  albedo = mix(albedo, vec3(0.97, 0.99, 1.0) * 1.5, smoothstep(0.15, 0.8, plume));

  // The poles are hazier and darker.
  albedo = mix(albedo, uColMid * 0.72, smoothstep(0.7, 1.0, abs(p.y)) * 0.55);

  // Very hot giants glow from below, most through the dark belts, which are gaps in the clouds.
  // Faint heat is deep red and strong heat turns orange, like glowing iron.
  float heat = 0.08 + 0.92 * pow(1.0 - tone, 2.2);
  emit = mix(uGlow.rgb * vec3(0.75, 0.3, 0.2), uGlow.rgb, heat) * heat * uGlow.a;

  // Lightning briefly lights a thundercloud cell from within, most often in the storms.
  flash = 0.0;
  if (uLightning > 0.0) {
    vec3 cells = q * 26.0;
    vec3 rnd = hash3(floor(cells) + floor(uTime * 4.0) * vec3(7.0, 3.0, 5.0));
    flash = step(1.0 - 0.0007 * uLightning * (1.0 + 4.0 * d.b + 6.0 * plume), rnd.x)
      * (1.0 - smoothstep(0.0, 0.45, length(fract(cells) - 0.5)));
  }
}
#endif

// The colour of the planet at the point p, lit from L and seen from V. All three are unit vectors
// in planet space.
vec3 shadePlanet(vec3 p, vec3 L, vec3 V) {
  // The surface distance between neighbouring pixels. At the limb a neighbour may lie far away, so
  // the cap keeps it harmless.
  gPixel = min(max(length(dFdx(p)), length(dFdy(p))), 0.5);
  vec3 albedo;
  vec3 emit = vec3(0.0);
  float height = 0.0;
  float gloss = 0.0;
  float cloud = 0.0;
  vec3 cloudColor = uCloud.rgb;

#if KIND == 1
  // Warping the lookup gives each planet its own coastlines. A fine second warp frays the steps of
  // the preset's pixels so rivers and shores stay ragged up close.
  vec3 bend = vec3(
    gnoise(p * 1.4 + uSeed),
    gnoise(p * 1.4 + uSeed + 31.7),
    gnoise(p * 1.4 + uSeed + 67.1)) * 0.11;
  bend += vec3(
    gnoise(p * 57.0 + uSeed.zxy),
    gnoise(p * 57.0 + uSeed.zxy + 13.3),
    gnoise(p * 57.0 + uSeed.zxy + 41.9)) * 0.004;
  // The two presets are mixed in large, softly blended patches, because a sharp transition would
  // look like a cliff.
  float share = smoothstep(-0.32, 0.32, gnoise(p * 0.8 + uSeed.yzx + 23.0));
  float zone = climateZone(p, L);
  terrainSurface(p, terrainData(normalize(p + bend), share), zone, dot(p, L), albedo, height, gloss, emit);
  // Thin cloud lets the ground show through, while thick cloud hides it.
  float thick = 0.0;
  float body = 0.0;
  float flash = 0.0;
  if (uCloud.a > 0.0) {
    thick = cloudCover(p, zone, 5 + int(uDetail));
    body = gCloudBody;
    cloud = smoothstep(0.0, 0.65, thick);
    // Lightning flashes briefly in the thunderstorms around a cyclone's eye.
    if (gStormCore > 0.05) {
      // A flash lights a whole cloud cell from within, so it is wider and softer than the bolt
      // itself.
      vec3 cells = p * 45.0;
      vec3 rnd = hash3(floor(cells) + floor(uTime * 5.0) * vec3(7.0, 3.0, 5.0));
      flash = step(1.0 - 0.05 * gStormCore, rnd.x) * (1.0 - smoothstep(0.0, 0.5, length(fract(cells) - 0.5))) * (0.6 + 0.8 * rnd.y);
    }
  }
  // Dust storms on a dry world hide the ground like a cloud of their own colour.
  if (uOcean.a <= -5.0) {
    float dust = dustStorms(p);
    if (dust > 0.0) {
      cloudColor = mix(cloudColor, dustColor(), dust / max(max(cloud, dust), 1e-3));
      cloud = max(cloud, dust * 0.85);
      thick = max(thick, dust * 0.5);
      body = max(body, dust * 0.5);
    }
  }
#elif KIND == 2
  float flash;
  bandsSurface(p, albedo, emit, flash);
#else
  vec3 texel;
  if (uFlow > 0.0) {
    // Each latitude of the map slides at its own speed (see flowPhases). The soft clouds of Venus
    // can take the full reach, sharp storms only half.
    bool veil = uFlow > 1.5;
    vec3 phases = flowPhases(veil ? 1.0 : 0.5, p);
    float speed = (veil ? veilSpeed(p.y) : jetSpeed(p.y, uSeed.x)) / (2.0 * PI);
    texel = mix(
      sampleMap(uMapDay, p, phases.y * speed).rgb,
      sampleMap(uMapDay, p, phases.x * speed).rgb,
      phases.z);
    if (veil) {
      // On Venus, brighter and darker swaths drift along the flow and slowly change shape.
      vec3 c = rotateY(p, uTime * 0.02) * vec3(2.0, 4.5, 2.0) + uSeed.zxy;
      vec3 morph = vec3(0.0, uTime * 0.02, 0.0);
      vec3 warp = vec3(fbm2(c * 1.3 + 5.0 + morph, 5.9), fbm2(c * 1.3 + 29.0 + morph, 5.9), 0.0);
      texel *= 1.0 + fbm4(c + warp * 1.2, 4.5) * 0.35;
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
    // Without a cloud map (Mars), thin computed veils lie over the real ground.
    cloud = cloudCover(p, abs(p.y), 6 + int(uDetail)) * 0.55;
    float dust = dustStorms(p);
    if (dust > 0.0) {
      cloudColor = mix(cloudColor, dustColor(), dust / max(max(cloud, dust), 1e-3));
      cloud = max(cloud, dust * 0.85);
    }
  }
#endif

  // Relief tilts the normal by the height gradient, so slopes facing the star are brighter.
  vec3 n = p;
#if RELIEF
  vec3 east = normalize(vec3(p.z, 0.0, -p.x) + vec3(1e-6, 0.0, 0.0));
  vec3 north = cross(p, east);
#if KIND == 1
  // The step is wide enough to cross single pixels of the preset.
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

  // An atmosphere carries light a little past the edge of the day side.
  float wrap = 0.02 + 0.22 * uAtmo.a;
  float geo = dot(p, L);
  float sun = clamp((dot(n, L) + wrap) / (1.0 + wrap), 0.0, 1.0);
  float sunFlat = clamp((geo + wrap) / (1.0 + wrap), 0.0, 1.0);

  // Clouds a little towards the star cast shadows on the ground, further away when the star is low.
  // This is computed for every pixel because the derivative-based map lookups need uniform control
  // flow.
  float shadow = 0.0;
  vec3 towardsStar = (L - p * geo) * (0.035 / max(geo, 0.3));
  vec3 sp = normalize(p + towardsStar);
#if KIND == 1
  // The cloud towards the star also shades the cloud here, which gives it a bright sunward side and
  // a grey far side.
  float cloudLight = 1.0;
  if (uCloud.a > 0.0) {
    // The thickness towards the star is estimated from screen-space derivatives, because evaluating
    // the clouds twice would double the cost. It uses the cloud body, not the edge cells, to avoid
    // grain.
    vec2 thicker = vec2(dFdx(body), dFdy(body));
    vec2 nearer = vec2(dFdx(geo), dFdy(geo));
    // Derivatives come in 2x2 pixel blocks. Where the body changes sharply the blocks would show,
    // so the estimate is dropped there.
    float trust = 1.0 - smoothstep(0.04, 0.12, length(thicker));
    float rate = dot(thicker, nearer) / (dot(nearer, nearer) + 1e-8) * trust;
    float sunward = clamp(body + rate * (1.0 - geo * geo) * (0.035 / max(geo, 0.3)), 0.0, 1.0);
    shadow = smoothstep(0.0, 0.4, sunward);
    cloudLight = clamp(0.84 + 0.16 * body + 0.75 * (body - sunward), 0.5, 1.12);
  }
#elif KIND == 0
  if (uMapFlags.y > 0.5) {
    shadow = smoothstep(0.05, 0.95, mapClouds(sp));
  } else if (uCloud.a > 0.0) {
    shadow = cloudCover(sp, abs(sp.y), 6 + int(uDetail)) * 0.55;
  }
#endif
  shadow *= step(0.0, geo) * 0.7;

  // Where the star is low, its light has crossed more air and lost some blue. From space this is a
  // narrow reddish band along the terminator.
  vec3 starlight = uLight;
#if KIND != 2
  starlight *= mix(vec3(1.0), mix(vec3(1.0, 0.8, 0.62), vec3(1.0), smoothstep(-0.12, 0.07, geo)), uAtmo.a);
#endif

  vec3 color = albedo * starlight * sun * (1.0 - cloud * 0.3) * (1.0 - shadow);
#if KIND == 2
  // A gas planet has no hard surface, so haze dims the clouds towards the limb.
  color *= 0.4 + 0.6 * pow(max(dot(p, V), 0.0), 0.5);
  // An image exposed for the sunlit clouds hardly shows a hot giant's glow by day, so the glow
  // mainly shows on the night side.
  emit *= 1.0 - 0.8 * smoothstep(-0.15, 0.5, geo);
  // Lightning only shows in the dark.
  emit += vec3(0.75, 0.82, 1.0) * flash * (1.0 - smoothstep(-0.25, 0.0, geo));
#endif

  // Sunlight glints on water and ice.
  vec3 H = normalize(L + V);
  float glint = pow(max(dot(n, H), 0.0), 120.0) * gloss * (1.0 - cloud) * (1.0 - shadow) * step(0.0, geo);
  // Waves break the glint into patches, because a smooth glint would look painted on. The noise is
  // only evaluated where there is a glint.
  if (glint > 2e-5) {
    glint *= 0.55 + 0.6 * smoothstep(-0.3, 0.3, fbm2(p * 18.0 + uSeed, 18.0));
    color += starlight * glint * 0.2;
  }

#if KIND == 1
  cloudColor *= cloudLight;
#endif
  color = mix(color, cloudColor * starlight * sunFlat, cloud * 0.94);

#if KIND == 1
  // Lightning only shows in the dark.
  color += vec3(0.75, 0.82, 1.0) * flash * (1.0 - smoothstep(-0.25, 0.0, geo)) * 1.3;
#endif

  // City lights show on the night side.
#if KIND == 0
  if (uMapFlags.x > 0.5) {
    vec3 night = toLinear(sampleMap(uMapNight, p, 0.0).rgb);
    color += night * 1.8 * (1.0 - smoothstep(-0.2, 0.1, geo)) * (1.0 - cloud * 0.6);
  }
#endif

  color += emit * (1.0 - cloud * 0.8);

  // The rings cast a shadow on the planet.
  if (uRing.z > 0.5 && abs(L.y) > 1e-4) {
    float t = -p.y / L.y;
    if (t > 0.0) {
      vec3 hit = p + t * L;
      color *= 1.0 - ringSample(length(hit.xz), 0.02).a * 0.8;
    }
  }

  // A trace of ambient light keeps the night side from vanishing.
  color += albedo * 0.004;

  if (uAurora.a > 0.0) {
    // Polar lights form a thin, wavering oval around each magnetic pole, which is slightly offset
    // from the axis, with rays that come and go. They only show against the dark.
    float waver = gnoise(vec3(p.x * 5.0, uTime * 0.04, p.z * 5.0) + uSeed.zxy);
    float pole = abs(dot(p, vec3(0.19, 0.98, 0.07))) + waver * 0.008;
    float oval = exp(-pow((pole - 0.94) / 0.009, 2.0));
    float rays = fbm2(vec3(p.x * 46.0, uTime * 0.2, p.z * 46.0) + uSeed, 46.0);
    float dark = 1.0 - smoothstep(-0.45, -0.1, geo);
    color += uAurora.rgb * uAurora.a * oval * (0.2 + 0.9 * max(rays + 0.25, 0.0)) * (0.6 + waver) * dark * 0.55;
  }

  // The air scatters light towards the viewer: a thin veil over the day side and much more towards
  // the limb. It has the colour of the sky by day and glows like a sunset at the terminator.
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
