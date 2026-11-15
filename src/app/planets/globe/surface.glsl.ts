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
 * What kind of surface is drawn, and whether it has relief and craters, is
 * fixed when the program is compiled (surfaceDefines() in uniforms.ts). Each
 * combination is a program of its own that only holds the code it needs, and
 * compiles much faster than one program for everything.
 *
 * It is GLSL ES 3.00 (WebGL 2). Everything is calculated in the planet's own
 * coordinates: the planet is a ball of radius 1 around the origin and y is its
 * axis. Colours are linear light, the caller converts to the screen at the end.
 */
export const SURFACE_GLSL = /* glsl */ `
// 0 solid, 1 gas, 2 map. Programs that only use the helpers below need none of these.
#ifndef KIND
#define KIND 0
#endif
#ifndef RELIEF
#define RELIEF 0
#endif
#ifndef CRATERS
#define CRATERS 0
#endif

uniform vec3 uSeed;
uniform vec3 uColLow;
uniform vec3 uColMid;
uniform vec3 uColHigh;
uniform vec4 uOcean;        // colour, sea level (below -5: no ocean)
uniform float uIce;
uniform vec4 uCloud;        // colour, cover
uniform vec4 uGlow;         // colour, strength
uniform float uCraters;
uniform float uRelief;
uniform vec3 uBands;        // contrast, turbulence, storms
uniform vec4 uAtmo;         // colour, density
uniform vec3 uLight;        // colour of the starlight
uniform float uTime;        // seconds, moves the clouds
uniform float uDetail;      // extra octaves of noise when zoomed in, 0 to 3
uniform vec3 uRing;         // inner edge, outer edge, 1 if there are rings
uniform vec4 uMapFlags;     // night map, cloud map, ring map, water shines
uniform sampler2D uMapDay;
uniform sampler2D uMapNight;
uniform sampler2D uMapClouds;
uniform sampler2D uRingMap;
uniform highp sampler3D uNoise;

const float PI = 3.141592653589793;

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toDisplay(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }

// ---- Noise ----------------------------------------------------------------

${NOISE_GLSL}

// Integer hash (PCG) for craters and storms. The same on every graphics card,
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

// The same layers as fbm, with the slope of the sum in yzw.
vec4 fbmSlope(vec3 p, int octaves) {
  vec4 sum = vec4(0.0);
  float amp = 0.5;
  float scale = 1.0;
  float total = 0.0;
  for (int i = 0; i < 9; i++) {
    if (i >= octaves) break;
    vec4 n = noiseD(p);
    sum += amp * vec4(n.x, n.yzw * scale);
    total += amp;
    p = p * 2.02 + vec3(19.1, 7.7, 13.3);
    amp *= 0.52;
    scale *= 2.02;
  }
  return sum / total;
}

vec3 rotateY(vec3 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
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
  float lanes = gnoise(vec3(t * 28.0, uSeed.x, 3.0)) + 0.5 * gnoise(vec3(t * 90.0, 7.0, uSeed.y));
  float alpha = clamp(0.6 + lanes * 1.4, 0.0, 0.92);
  alpha *= smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.96, 1.0, t));
  return vec4(uColHigh, alpha);
}

// ---- Surfaces -------------------------------------------------------------

// Craters: bowls with a raised rim, scattered at random.
// Returns the height in w and the direction in which it rises in xyz.
vec4 craterField(vec3 p, float scale, float shift) {
  vec3 x = p * scale + uSeed.zxy + shift;
  vec3 cell = floor(x);
  float h = 0.0;
  vec3 g = vec3(0.0);
  for (int i = -1; i <= 1; i++) {
    for (int j = -1; j <= 1; j++) {
      for (int k = -1; k <= 1; k++) {
        vec3 c = cell + vec3(float(i), float(j), float(k));
        vec3 rnd = hash3(c);
        if (rnd.z < 0.45) continue;
        vec3 centre = c + 0.25 + 0.5 * rnd;
        float radius = 0.16 + 0.3 * fract(rnd.x * 7.13 + rnd.y * 3.71);
        vec3 delta = x - centre;
        float dist = length(delta);
        float d = dist / radius;
        float bowl = d < 1.0 ? (smoothstep(0.0, 1.0, d) - 1.0) * 0.8 : 0.0;
        float bowlSlope = d < 1.0 ? 4.8 * d * (1.0 - d) : 0.0;
        float rim = exp(-(d - 1.0) * (d - 1.0) * 18.0) * 0.3;
        float rimSlope = -36.0 * (d - 1.0) * rim;
        h += bowl + rim;
        if (dist > 1e-5) g += (bowlSlope + rimSlope) * delta / (dist * radius);
      }
    }
  }
  return vec4(g * scale, h);
}

// Rock, ice, water and lava. "grad" is the direction in which the ground rises.
void solidSurface(vec3 p, out vec3 albedo, out float height, out vec3 grad, out float gloss, out vec3 emit) {
  int extra = int(uDetail);
  vec3 q = p * 1.5 + uSeed;
  // Bending the coordinates first gives coastlines instead of round blobs.
  vec3 warp = vec3(
    fbm(q * 1.3 + 31.7, 2),
    fbm(q * 1.3 + 67.1, 2),
    fbm(q * 1.3 + 11.9, 2));
  // Strong bending suits coasts; dry ground would look like marble with it.
  warp *= uOcean.a > -5.0 ? 0.9 : 0.5;
  float fine = fbm(q * 7.0 + 3.1, 3 + extra);
  float h = fbm(q + warp, 5 + extra) + fine * 0.07;
  float patches = fbm(q * 2.3 + 91.3, 3);

  gloss = 0.0;
  emit = vec3(0.0);
  height = h;
  grad = vec3(0.0);

#if RELIEF
  // Light and shadow on slopes follow the broad shape of the ground, without
  // the fine grain: with the grain the surface would look like sandpaper. The
  // 1.5 is how much q grows with p, the 0.2 how strongly slopes show.
  grad = fbmSlope(q + warp, 4).yzw * (1.5 * 0.2);
#endif

  bool hasOcean = uOcean.a > -5.0;
  if (hasOcean) {
    float level = uOcean.a;
    float t = clamp((h - level) / 0.3, 0.0, 1.0);
    vec3 land = mix(uColLow, uColMid, smoothstep(0.1, 0.6, t + patches * 0.9));
    land = mix(land, uColHigh, smoothstep(0.55, 0.95, t));
    float depth = clamp((level - h) / 0.22, 0.0, 1.0);
    vec3 water = mix(uOcean.rgb * 1.5, uOcean.rgb * 0.45, depth);
    float shore = smoothstep(level - 0.006, level + 0.006, h);
    albedo = mix(water, land, shore);
    gloss = 1.0 - shore;
    height = max(h, level);
  } else {
    float t = clamp(0.5 + (h + patches * 0.35) * 1.5, 0.0, 1.0);
    albedo = mix(uColLow, uColMid, smoothstep(0.12, 0.5, t));
    albedo = mix(albedo, uColHigh, smoothstep(0.55, 0.9, t));
    albedo *= 1.0 + fine * 0.5;
  }

#if CRATERS
  vec4 craters = craterField(p, 4.0, 0.0) + 0.5 * craterField(p, 9.0, 7.3);
  if (extra > 0) craters += 0.25 * craterField(p, 21.0, 3.9);
  height += craters.w * 0.05 * uCraters;
  grad += craters.xyz * 0.05 * uCraters;
  albedo *= 1.0 + craters.w * 0.12 * uCraters;
#endif

  if (uGlow.a > 0.0) {
    // Lava: glowing cracks in the crust and pools in the lowlands.
    float vein = abs(fbm(q * 2.4 + 55.5, 4 + extra));
    float cracks = 1.0 - smoothstep(0.0, 0.035, vein);
    float pools = (1.0 - smoothstep(-0.2, -0.04, h));
    float heat = clamp(cracks * (0.4 + 0.6 * (1.0 - smoothstep(-0.15, 0.1, h))) + pools * (0.75 + fine), 0.0, 1.0);
    vec3 fire = mix(uGlow.rgb, vec3(1.0, 0.82, 0.45), heat * heat);
    emit = fire * heat * uGlow.a * 1.6;
    albedo *= 1.0 - heat * 0.7;
    height -= pools * 0.05;
  }

  if (uIce > 0.0) {
    float latitude = abs(p.y) + fine * 0.25 + patches * 0.12 + max(height - 0.1, 0.0) * 0.3;
    float ice = smoothstep(1.0 - uIce - 0.02, 1.0 - uIce + 0.02, latitude);
    albedo = mix(albedo, vec3(0.86, 0.91, 0.96) * (0.92 + fine * 0.5), ice);
    gloss = mix(gloss, 0.25, ice);
  }
}

// Bands of cloud around a planet without a solid surface.
void gasSurface(vec3 p, out vec3 albedo, out vec3 emit) {
  int extra = int(uDetail);
  float contrast = uBands.x;
  float turbulence = uBands.y;

  // Waves along the edges of the bands.
  float wave = fbm(vec3(p.x * 2.5, p.y * 7.0, p.z * 2.5) + uSeed, 4);
  float lat = p.y + wave * 0.07 * turbulence;
  // Broad belts and zones depend on the latitude only.
  float belts = fbm(vec3(uSeed.x, lat * 5.5, uSeed.z), 4);
  // Fine streaks, stretched along the bands.
  float streaks = fbm(vec3(p.x * 3.5, lat * 36.0, p.z * 3.5) + uSeed.yzx, 4 + extra);
  float v = belts * 2.6 + streaks * 0.55 * turbulence;

  albedo = mix(uColMid, v > 0.0 ? uColHigh : uColLow, smoothstep(0.0, 0.5, abs(v)) * contrast);

  // Up to three oval storms.
  for (int i = 0; i < 3; i++) {
    vec3 rnd = hash3(vec3(float(i) + 1.0, floor(uSeed.x * 31.0), 5.0));
    if (rnd.z > uBands.z) continue;
    float sinLat = (rnd.x - 0.5) * 1.1;
    float lon = rnd.y * 2.0 * PI;
    float cosLat = sqrt(1.0 - sinLat * sinLat);
    vec3 centre = vec3(cosLat * sin(lon), sinLat, cosLat * cos(lon));
    vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), centre));
    vec3 north = cross(centre, east);
    vec3 d = p - centre;
    float size = 0.07 + 0.08 * fract(rnd.x * 9.7);
    float ex = dot(d, east) / (size * 1.9);
    float ey = dot(d, north) / size;
    float r2 = ex * ex + ey * ey;
    float inside = exp(-r2 * 1.4) * step(0.0, dot(p, centre));
    float swirl = 0.5 + 0.5 * sin(sqrt(r2) * 9.0 - atan(ey, ex) * 2.0);
    vec3 storm = mix(uColLow * 0.8, uColHigh, swirl * 0.35);
    albedo = mix(albedo, storm, clamp(inside * 1.3, 0.0, 1.0) * contrast);
  }

  // The poles are hazier and darker.
  albedo = mix(albedo, uColMid * 0.72, smoothstep(0.7, 1.0, abs(p.y)) * 0.55);

  // Very hot giants glow from below, strongest in the dark belts.
  emit = uGlow.rgb * uGlow.a * (0.2 + 0.8 * (1.0 - smoothstep(-0.35, 0.15, v)));
}

// Clouds over a solid planet, 0 for clear sky to 1 for overcast.
float cloudCover(vec3 p) {
  vec3 c = rotateY(p, uTime * 0.012) * vec3(2.1, 3.0, 2.1) + uSeed.yzx;
  vec3 warp = vec3(fbm(c * 1.2 + 13.0, 2), fbm(c * 1.2 + 47.0, 2), fbm(c * 1.2 + 83.0, 2));
  float n = fbm(c + warp * 1.3, 5 + int(uDetail));
  float threshold = mix(0.3, -0.12, uCloud.a);
  return smoothstep(threshold, threshold + 0.2, n);
}

// ---- Light ----------------------------------------------------------------

// The colour of the planet at the point p, lit from the direction L and seen
// from the direction V. All three are unit vectors in the planet's coordinates.
vec3 shadePlanet(vec3 p, vec3 L, vec3 V) {
  vec3 albedo;
  vec3 emit = vec3(0.0);
  float height = 0.0;
  float gloss = 0.0;
  float cloud = 0.0;
  vec3 grad = vec3(0.0);
  vec3 cloudColor = uCloud.rgb;

#if KIND == 0
  solidSurface(p, albedo, height, grad, gloss, emit);
  if (uCloud.a > 0.0) cloud = cloudCover(p);
#elif KIND == 1
  gasSurface(p, albedo, emit);
#else
  vec3 texel = sampleMap(uMapDay, p, 0.0).rgb;
  albedo = toLinear(texel);
  height = dot(texel, vec3(0.3, 0.6, 0.1));
  // Water is the part of the map that is clearly blue.
  gloss = uMapFlags.w * smoothstep(0.0, 0.02, albedo.b - max(albedo.r, albedo.g) * 1.15);
  if (uMapFlags.y > 0.5) {
    cloud = sampleMap(uMapClouds, p, -uTime * 0.0012).r;
    cloud = smoothstep(0.05, 0.95, cloud);
    cloudColor = vec3(1.0);
  }
#endif

  // Heights tilt the surface a little, so slopes facing the star are brighter.
  vec3 n = p;
#if RELIEF
#if KIND == 2
  // On a map: compare the height with the heights a little to the east and north.
  vec3 east = normalize(vec3(p.z, 0.0, -p.x) + vec3(1e-6, 0.0, 0.0));
  vec3 north = cross(p, east);
  const float reach = 0.004;
  float hEast = mapHeight(normalize(p + east * reach));
  float hNorth = mapHeight(normalize(p + north * reach));
  vec3 slope = ((hEast - height) * east + (hNorth - height) * north) * (0.02 / reach);
#else
  // On a computed surface the rise is known; only its part along the ground counts.
  vec3 slope = (grad - p * dot(grad, p)) * 0.3;
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

  vec3 color = albedo * uLight * sun * (1.0 - cloud * 0.3);

  // Sunlight glints on water and ice.
  vec3 H = normalize(L + V);
  float glint = pow(max(dot(n, H), 0.0), 60.0) * gloss * (1.0 - cloud) * step(0.0, geo);
  color += uLight * glint * 0.6;

  color = mix(color, cloudColor * uLight * sunFlat, cloud * 0.94);

  // The lights of the cities show on the night side.
#if KIND == 2
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

  // Towards the edge the view passes through more air, which scatters light.
  float rim = pow(1.0 - max(dot(p, V), 0.0), 3.0);
  float haze = clamp(rim * uAtmo.a * 0.9, 0.0, 1.0);
  color = mix(color, uAtmo.rgb * uLight * smoothstep(-0.3, 0.45, geo) * 1.1, haze);

  return color;
}
`;
