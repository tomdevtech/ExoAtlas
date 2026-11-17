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
uniform float uStormSpin;   // band presets: how fast the storms of the preset turn, 0 to 1
uniform vec4 uGiantStorms[6]; // band presets: the largest storms of the preset: longitude, latitude, half height (radians), 1 or -1 for the way it turns
// The storms alive at this moment. They are the same for every pixel, so
// they are worked out once per picture (storms.ts) and only read here.
uniform vec4 uCyclones[12]; // three groups per cyclone: centre and size; strength, hemisphere (1 or -1, twice that if tropical), how mature, how fast it turns; how much longer one way, a number of its own
uniform float uCycloneCount;
uniform vec4 uDusts[3];     // dust storms: centre and radius
uniform vec3 uDustLives;    // the strength of each, 0 for none
uniform vec4 uOutbreak;     // band presets: longitude and latitude of the head of an outbreak, its age 0 to 1, its strength
uniform float uOutbreakTail; // 1 or -1: the side its tail trails on
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

// ---- Noise no finer than a pixel ----------------------------------------------

// How wide one pixel is on the planet at the place being drawn, in planet
// radii: set by shadePlanet, and by the moon and the star for themselves.
float gPixel = 0.0;

// How much can be shown of a layer of noise that repeats "frequency" times
// per planet radius: all of it while each of its features spans two pixels
// or more, nothing once they shrink to one. Finer noise is no
// detail but grain: each pixel catches it at random, and it shimmers while
// the planet turns. Zoomed in, the layers come back.
float shows(float frequency) {
  return 1.0 - smoothstep(0.5, 1.0, frequency * gPixel);
}

// Several layers of noise, each twice as fine and half as strong. "scale" is
// how often the first layer repeats per planet radius: layers finer than a
// pixel are faded out (see shows), and the large ones keep their strength.
// Every layer is still read: asking first whether to read it would keep the
// graphics card from fetching them all at once, which costs more than the
// reads it saves.
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
  // Divided by the weight of all the layers, shown or not, so that fading
  // out the fine ones does not make the coarse ones stronger.
  return sum / total;
}

// The same with a fixed number of layers, written out. Most places ask for
// two, three or four: without the loop and its early end the graphics card
// has less to do, and the shader is built faster.
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

// ---- Storms ---------------------------------------------------------------

// What the storms add to the clouds at the place last looked at: more cloud
// (or less, in the eye), and how much thunderstorm there is for lightning.
float gStormCover = 0.0;
float gStormCore = 0.0;

// The body of the cloud at the place last looked at, 0 to 1: its thickness
// without the fine cells at its edges (see cloudCover). The light models the
// cloud from it, so the cells do not break its shading up into grain.
float gCloudBody = 0.0;

// A point on the ball from the sine of its latitude and its longitude.
vec3 onBall(float sinLat, float lon) {
  float cosLat = sqrt(max(1.0 - sinLat * sinLat, 0.0));
  return vec3(cosLat * sin(lon), sinLat, cosLat * cos(lon));
}

#if KIND == 1
// How much of the ground under a point of the clouds is land, 0 to 1, read
// from a coarse level of the preset. "pr" is in the frame of the drifting
// clouds. It rises over a stretch of coast rather than at one line, so a
// storm that drifts ashore weakens over hours instead of in one frame.
float landBelow(vec3 pr, float rate) {
  vec3 ground = uMapTurn * rotateY(pr, -uTime * rate);
  vec2 uv = vec2(atan(ground.x, ground.z) / (2.0 * PI) + 0.5, asin(clamp(ground.y, -1.0, 1.0)) / PI + 0.5);
  return smoothstep(uOcean.a - 0.05, uOcean.a + 0.05, textureLod(uMapDay, uv, 4.0).r);
}
#endif

// Storms over the sea of a planet with water, in the frame of its drifting
// clouds. Tropical cyclones are born over warm water near the equator, drift
// west, swing towards the pole and die over land or cold water; on the way
// they grow, clear an eye and wind their clouds into spiral arms. Storms of
// the middle latitudes are wider, have no eye and drift east. Where they are
// and how old is worked out in storms.ts (uCyclones). Returns the point
// twisted around them, so the clouds there follow their winds.
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
    // No storm is quite round: a little longer one way than the other.
    float ey = dot(d, north) / size * own.x;
    if (ex * ex + ey * ey > 12.0) continue;
#if KIND == 1
    // A tropical storm draws its strength from warm sea and dies over land.
    // Read only here, for the few places a storm reaches.
    if (tropical) life01 *= mix(1.0, 0.25, landBelow(centre, rate));
#endif
    // Nor are its arms clean curves: the air it draws in is lumpy, so
    // its shape wavers and its bands break up.
    vec3 lumps = vec3(ex, ey, own.y);
    ex += gnoise(lumps * 0.9 + uSeed) * 0.4;
    ey += gnoise(lumps.yxz * 0.9 + uSeed.yzx) * 0.4;
    float r = sqrt(ex * ex + ey * ey);
    float fade = (1.0 - smoothstep(1.8, 3.0, r)) * smoothstep(0.2, 0.5, dot(p, centre));
    // Turning most near the eye: the arms wind up into a spiral, tighter as
    // the storm matures and as it ages. Fading to nothing at the edge, or
    // the clouds would break there.
    float turn = state.w / (r + 0.45) * exp(-r * r * 0.22);
    float angle = turn * hemi * life01 * fade;
    float c = cos(angle);
    float s = sin(angle);
    q += east * ((c * ex - s * ey - ex) * size) + north * ((s * ex + c * ey - ey) * size);
    // Clouds gather in the arms and round the eye; the eye itself is clear.
    float bend = gnoise(lumps * 1.9 + uSeed.zxy) * 2.2;
    float arms = 0.5 + 0.5 * cos(2.0 * atan(ey, ex) - hemi * 5.0 * log(r + 0.08) + bend);
    arms *= 0.45 + 0.75 * smoothstep(-0.25, 0.3, gnoise(lumps * 3.3 + uSeed));
    float core = exp(-r * r * (tropical ? 1.4 : 0.6));
    float eye = exp(-pow(r / 0.16, 2.0)) * mature;
    // A tropical storm is a dense round mass; one of the middle latitudes a
    // loose comma of cloud bands round a clearer middle.
    gStormCover += life01 * fade * (core * (tropical ? 0.45 : 0.12) + arms * exp(-r * r * 0.3) * (tropical ? 0.38 : 0.32)) - eye * life01 * 1.8;
    gStormCore = max(gStormCore, life01 * core * (1.0 - eye) * (tropical ? 1.0 : 0.6));
  }
  return q;
}

// Dust storms on a dry planet with air: a cloud of dust rises somewhere,
// spreads for days and settles again. Now and then one grows until it wraps
// the whole planet, as on Mars. Where they are is worked out in storms.ts
// (uDusts). Returns how much dust hides the ground, 0 to 1.
float dustStorms(vec3 p) {
  // First whether a storm reaches the place at all. Their billows cost three
  // layers of noise, and most of a planet lies outside every storm most of
  // the time. The billows shift the edge by 0.3 * min(radius, 0.6) at most.
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

// The colour of the dust: the ground it was blown from, lit through the haze.
vec3 dustColor() {
  return mix(uColMid, uAtmo.rgb, 0.35) * 1.1;
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
  float rate = mix(0.012, 0.03, uLocked);
  vec3 pr = rotateY(p, uTime * rate);
  // On ocean worlds winds draw the clouds out along the latitudes.
  vec3 stretch = weather ? vec3(2.8, 3.9, 2.8) : vec3(2.1, 3.0, 2.1);
  gStormCover = 0.0;
  gStormCore = 0.0;
  vec3 c = (weather ? cyclones(pr, rate) : pr) * stretch + uSeed.yzx;
  // Reading the bending noise a little further along over time lets the
  // clouds slowly change shape while they drift, at no extra cost.
  vec3 morph = vec3(0.0, uTime * 0.015, 0.0);
  vec3 warp = vec3(
    fbm2(c * 1.2 + 13.0 + morph, 4.7),
    fbm2(c * 1.2 + 47.0 + morph, 4.7),
    fbm2(c * 1.2 + 83.0 + morph, 4.7));
  // Strong bending smears clouds into streaks; ocean worlds take less of it.
  float n = fbm(c + warp * (weather ? 0.8 : 1.3), octaves, 3.9);
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
    // A storm is a thick mass of cloud of its own, with a clear eye.
    n += gStormCover;
  }
  float threshold = mix(0.3, -0.12, clamp(cover, 0.0, 1.0));
  // On ocean worlds the result is how thick the cloud is, rising slowly from
  // its edge, so the light can model it (see shadePlanet).
  if (!weather) {
    gCloudBody = smoothstep(threshold, threshold + 0.12, n);
    return gCloudBody;
  }
  // Seen from space cloud is two things. Around and between the masses it
  // is thin: fields of small cells that let the sea show through, with
  // fraying edges. The masses themselves are thick, and their thickness
  // rises steeply from their edge, so the light gives them a bright side
  // towards the star, a grey one away from it and a shadow on the ground
  // (see shadePlanet): that is what makes them stand above the ground.
  float clear = threshold - 0.12;
  float dense = threshold + 0.3;
  // The lumps and cells below move the result by 0.23 at most. Where the
  // sky is clear or overcast beyond that, they change nothing and are left out.
  if (n < clear - 0.23) {
    gCloudBody = 0.0;
    return 0.0;
  }
  if (n > dense + 0.23) {
    gCloudBody = 1.0;
    return 1.0;
  }
  // Fine lumps at the edges, as in heaps of cumulus.
  float lumps = fbm3(pr * 15.0 + uSeed.zxy + 11.0, 15.0) * 0.14;
  // The light reads the body off the neighbouring pixels, which the graphics
  // card hands over in blocks of two by two. The lumps join the body only once
  // their finest layer spans a few such blocks; smaller, they would break the
  // light up into those blocks.
  gCloudBody = smoothstep(threshold, dense, n + lumps * (1.0 - smoothstep(0.12, 0.25, 61.0 * gPixel)));
  n += lumps;
  float mass = smoothstep(threshold, dense, n);
  float veil = smoothstep(clear, threshold + 0.4, n + fbm2(pr * 38.0 + uSeed.yzx + 5.0, 38.0) * 0.09);
  return max(veil, mass);
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
  float fine = fbm(p * 9.0 + uSeed, 3 + extra, 9.0);
  float patches = fbm3(p * 3.1 + uSeed.zxy + 91.3, 3.1);

  gloss = 0.0;
  emit = vec3(0.0);
  height = d.r + dent * 0.12;
  // The preset is too coarse for the finest bays and headlands. Noise adds
  // them, more of it the closer the viewer comes, so coasts stay crisp.
  float h = height + fine * 0.025 + fbm(p * 37.0 + uSeed.yzx, 2 + extra, 37.0) * 0.012;
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
    albedo *= 1.0 + fbm3(p * 1.6 + uSeed + 17.0, 1.6) * 0.5;
    albedo *= 1.0 - smoothstep(0.27, 0.82, flow) * 0.3 * uTerrain.y;
    albedo *= 1.0 + fine * 0.5 + dent * 0.45;

    // Rust where the ground has weathered, grey bare rock where it has not:
    // a dry world is never one flat colour.
    float rust = fbm3(p * 2.2 + uSeed.yzx + 3.0, 2.2);
    float grey = dot(albedo, vec3(0.3, 0.6, 0.1));
    albedo = mix(albedo, albedo * vec3(1.1, 0.94, 0.85), smoothstep(0.0, 0.35, rust) * 0.5);
    albedo = mix(albedo, vec3(grey) * vec3(0.95, 0.97, 1.0), smoothstep(0.0, 0.35, -rust) * 0.35);
    // Layers of rock show on the slopes of the highlands.
    float slopes = smoothstep(0.45, 0.8, t);
    if (slopes > 0.0) albedo *= 1.0 + sin(h * 140.0 + fbm2(p * 6.0 + uSeed, 6.0) * 6.0) * 0.06 * slopes;
    // Wind heaps the sand of the lowlands into fields of dunes, long ridges
    // across the wind with a bright crest and a dark lee side.
    if (uAtmo.a > 0.05) {
      // The ridges repeat 150 times per radius: from afar they would be grain.
      float lowland = (1.0 - smoothstep(0.35, 0.6, h)) * shows(150.0);
      if (lowland > 0.0) {
        vec3 sand = p * vec3(150.0, 55.0, 150.0) + uSeed + gnoise(p * 18.0 + uSeed.zxy) * 2.5;
        float dune = pow(clamp(1.0 - abs(gnoise(sand) * 1.7), 0.0, 1.0), 2.0);
        albedo *= mix(1.0, 0.76 + 0.48 * dune, lowland * 0.9);
      }
    }
    // Fine grain of dust and stones, finer the closer one looks.
    albedo *= 1.0 + fbm(p * 120.0 + uSeed.zxy, 2 + extra, 120.0) * 0.18;
  }

  if (uGlow.a > 0.0) {
    // Lava: seas in the basins under a dark crust that breaks into glowing
    // cracks, and streams running down the channels. On a planet that always
    // faces its star the same way, the rock melts on the day side and
    // hardens on the night side.
    float lava = uTerrain.x + uLocked * 0.3 * sunward * min(uGlow.a, 1.0);
    float sea = 1.0 - smoothstep(lava - 0.02, lava + 0.02, h);
    // Thin glowing seams where the crust breaks, and open lakes of lava in
    // between where it has not formed yet. A crust that glows everywhere in
    // an even net would look like neon. Both only count in a sea of lava.
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
// The wind a band preset was drawn out with, at the sine s of one of its
// latitudes: the jets of the simulation (scripts/generate-presets.ts), calm
// towards the poles. Positive blows east.
float presetWind(float s) {
  return jetSpeed(s, uBelts.y) * (1.0 - pow(abs(s), 6.0));
}

// Threads of cloud along the bands, finer than the preset can hold.
float cloudThreads(vec3 q) {
  return fbm(vec3(q.x * 6.0, q.y * 80.0, q.z * 6.0) + uSeed.zxy, 3 + int(uDetail), 80.0);
}

// Turns a point of the preset around the storms the preset names, by as far
// as they turn in "seconds" (see uGiantStorms). Each storm turns fastest at
// its centre, so its clouds wind round inside it.
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
    // Reading the picture turned back shows the storm turned forward.
    float angle = -storm.w * 0.16 * uStormSpin * seconds * exp(-r2 * 0.6) * (1.0 - r2 / 9.0);
    float c = cos(angle);
    float s = sin(angle);
    lon = storm.x + (c * ex - s * ey) * 1.7 * storm.z;
    lat = storm.y + (s * ex + c * ey) * storm.z;
    turned = true;
  }
  // Most of the planet lies in no storm and stays where it is.
  return turned ? onBall(sin(lat), lon) : q;
}

// A storm breaking out: a bright plume of fresh cloud wells up at one point
// and is drawn out along its band, east and west, as on Saturn now and then.
// Where and how old it is, is worked out in storms.ts (uOutbreak). Returns
// how much of it covers the point, 0 to 1. "q" is in the preset.
float outbreak(vec3 q) {
  float life01 = uOutbreak.w;
  if (life01 <= 0.0) return 0.0;
  float f = uOutbreak.z;
  float dLon = mod(atan(q.x, q.z) - uOutbreak.x + PI, 2.0 * PI) - PI;
  float dLat = asin(clamp(q.y, -1.0, 1.0)) - uOutbreak.y;
  // The tail trails behind the head, and grows longer and wider with time.
  float tail = dLon * uOutbreakTail;
  float stretch = 0.15 + 2.4 * f;
  float width = 0.035 + 0.07 * f;
  // A bright, lumpy head where the cloud wells up, and a tail that thins out.
  float along = tail > 0.0 ? exp(-pow(tail / stretch, 2.0) * 1.5) * (0.45 + 0.55 * exp(-tail / (0.3 * stretch))) : exp(-pow(tail / 0.06, 2.0));
  float crown = exp(-(dLon * dLon + dLat * dLat) / pow(width * 1.3, 2.0));
  float body = along * exp(-pow(dLat / width, 2.0));
  // The puffs are 1.3 at most. Away from the plume, which is most of the
  // planet, nothing of it shows and its lumps need not be worked out.
  if ((body * 1.3 + crown * 0.8) * life01 < 0.004) return 0.0;
  float puffs = smoothstep(-0.15, 0.35, fbm4(q * 34.0 + uSeed + vec3(uTime * 0.05), 34.0)) * 1.3;
  return clamp((body * puffs + crown * 0.8) * life01, 0.0, 1.0);
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
    // Each phase also lets the storms turn for as long as it has run.
    float seconds = 1.0 / (FLOW_RATE * 0.6);
    d = mix(
      sampleMap(uMapDay, turnStorms(rotateY(q, 2.0 * PI * phases.y * speed), phases.y * seconds), 0.0).rgb,
      sampleMap(uMapDay, turnStorms(rotateY(q, 2.0 * PI * phases.x * speed), phases.x * seconds), 0.0).rgb,
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

  // A fresh plume of cloud is brighter and whiter than anything around it.
  float plume = outbreak(q);
  // Its edge throws a little shadow on the deeper clouds around it, which
  // sets it apart even from bright zones.
  float rim = smoothstep(0.02, 0.25, plume) * (1.0 - smoothstep(0.25, 0.7, plume));
  albedo *= 1.0 - 0.3 * rim;
  albedo = mix(albedo, vec3(0.97, 0.99, 1.0) * 1.5, smoothstep(0.15, 0.8, plume));

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
    flash = step(1.0 - 0.0007 * uLightning * (1.0 + 4.0 * d.b + 6.0 * plume), rnd.x)
      * (1.0 - smoothstep(0.0, 0.45, length(fract(cells) - 0.5)));
  }
}
#endif

// ---- Light ----------------------------------------------------------------

// The colour of the planet at the point p, lit from the direction L and seen
// from the direction V. All three are unit vectors in the planet's coordinates.
vec3 shadePlanet(vec3 p, vec3 L, vec3 V) {
  // How far the point moves from one pixel to the next. At the edge of the
  // ball the neighbour may lie beside it; the cap keeps that harmless.
  gPixel = min(max(length(dFdx(p)), length(dFdy(p))), 0.5);
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
  float body = 0.0;
  float flash = 0.0;
  if (uCloud.a > 0.0) {
    thick = cloudCover(p, zone, 5 + int(uDetail));
    body = gCloudBody;
    // Thin cloud is a veil, thick cloud hides the ground.
    cloud = smoothstep(0.0, 0.65, thick);
    // Lightning in the thunderstorms round the eye of a cyclone, for a blink.
    if (gStormCore > 0.05) {
      // A flash lights up a whole cell of thundercloud from within, so it
      // is wider than the bolt itself and soft at its edge.
      vec3 cells = p * 45.0;
      vec3 rnd = hash3(floor(cells) + floor(uTime * 5.0) * vec3(7.0, 3.0, 5.0));
      flash = step(1.0 - 0.05 * gStormCore, rnd.x) * (1.0 - smoothstep(0.0, 0.5, length(fract(cells) - 0.5))) * (0.6 + 0.8 * rnd.y);
    }
  }
  // Dust storms of a dry world hide its ground like a cloud of its own colour.
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
    // No map of the clouds (Mars): thin computed veils over the real ground.
    cloud = cloudCover(p, abs(p.y), 6 + int(uDetail)) * 0.55;
    float dust = dustStorms(p);
    if (dust > 0.0) {
      cloudColor = mix(cloudColor, dustColor(), dust / max(max(cloud, dust), 1e-3));
      cloud = max(cloud, dust * 0.85);
    }
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
    // The body of the cloud, not the cells at its edge: they would break the
    // light up into grain instead of modelling the cloud.
    vec2 thicker = vec2(dFdx(body), dFdy(body));
    vec2 nearer = vec2(dFdx(geo), dFdy(geo));
    // The graphics card hands the neighbours over in blocks of two by two.
    // Where the body changes a lot from one pixel to the next, the light
    // read off them would show those blocks; there it is left out.
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
  // Waves break the glint into patches: smooth, it would look painted on.
  // Only where there is a glint to break: a small part of the day side of a sea.
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
    float rays = fbm2(vec3(p.x * 46.0, uTime * 0.2, p.z * 46.0) + uSeed, 46.0);
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
