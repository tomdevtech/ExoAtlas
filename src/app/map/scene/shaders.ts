import { SURFACE_GLSL } from "@/app/planets/globe/surface.glsl";
import {
  BULGE_HEIGHT,
  BULGE_WIDTH,
  DISC_HEIGHT,
  GALACTIC_CENTRE,
  GALAXY_EDGE,
  GALAXY_PICTURE_WIDTH,
} from "../galaxy";

/**
 * The shader programs of the map. All are GLSL ES 3.00 and write colours as
 * the screen shows them, so three.js must not convert them again.
 */

const HEADER = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
`;

// ---- The sky ----------------------------------------------------------------

/** A ball around the camera that never comes closer: only its direction counts. */
export const SKY_VERTEX = /* glsl */ `
in vec3 position;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
out vec3 vDirection;
void main() {
  vDirection = position;
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  // z = w puts the sky behind everything else.
  gl_Position = clip.xyww;
}
`;

/**
 * Looks up the photograph of the whole sky. The picture has the galactic
 * centre in the middle, the longitude grows to the left and north is up.
 */
export const SKY_FRAGMENT = /* glsl */ `${HEADER}
uniform sampler2D uMap;
uniform float uOpacity;
uniform mat3 uToGalactic;
in vec3 vDirection;
out vec4 outColor;
const float PI = 3.141592653589793;
void main() {
  vec3 d = normalize(uToGalactic * vDirection);
  float longitude = atan(d.y, d.x);
  float latitude = asin(clamp(d.z, -1.0, 1.0));
  vec2 uv = vec2(0.5 - longitude / (2.0 * PI), 0.5 + latitude / PI);
  outColor = vec4(texture(uMap, uv).rgb * uOpacity, 1.0);
}
`;

// ---- The galaxy ---------------------------------------------------------------

/**
 * The galaxy, from the artist's impression of the Milky Way (see galaxy.ts).
 * The picture is the plan of the disc as seen from straight above. Here it
 * gets what a flat picture lacks:
 *
 * - Most of its light lies in a thin sheet in the plane, where the young
 *   stars, the glowing gas and the dust are. Seen from outside, the line of
 *   sight meets that sheet at one place, and the picture is read there as
 *   sharp as it is.
 * - The rest is a soft glow of old stars, thicker than the sheet and thickest
 *   in the bulge. It is added up along the line of sight, and a sheet of dust
 *   takes light away on the way.
 *
 * So the galaxy looks like the picture from above, like a thin streak with a
 * bulge and a dark lane from the side, and from inside like the band of the
 * Milky Way with its dark rift.
 */
export const GALAXY_GLOW_FRAGMENT = /* glsl */ `${HEADER}
uniform sampler2D uMap;  // the picture of the galaxy from above
uniform vec3 uEye;       // the camera, in parsecs around the Sun
uniform vec3 uForward;   // the direction of view, and how far the picture
uniform vec3 uRight;     // reaches to the right and upwards at the distance 1
uniform vec3 uUp;
uniform float uFade;
uniform float uOutside;  // 0 for a camera inside the disc, 1 for one outside
uniform float uClouds;   // the share of the light of the sheet that the clouds of galaxyClouds.ts carry
in vec2 vUv;
out vec4 outColor;

const vec3 CENTRE = vec3(${GALACTIC_CENTRE.map((value) => value.toFixed(1)).join(", ")});
const float PICTURE_WIDTH = ${GALAXY_PICTURE_WIDTH.toFixed(1)};
const float EDGE = ${GALAXY_EDGE.toFixed(1)};
const float DISC_HEIGHT = ${DISC_HEIGHT.toFixed(1)};
const float BULGE_HEIGHT = ${BULGE_HEIGHT.toFixed(1)};
const float BULGE_WIDTH = ${BULGE_WIDTH.toFixed(1)};
// The dust lies in a sheet this thin around the plane.
const float DUST_HEIGHT = 90.0;
// Above and below this height there is next to nothing.
const float HALF_HEIGHT = 6000.0;
// From outside the bulge is drawn as an oval this much lower than wide, and
// the light of the picture there spread through its depth (the depth of
// the oval through its centre, sqrt(pi) * BULGE_FLAT * BULGE_WIDTH).
const float BULGE_FLAT = 0.62;
const float BULGE_OVAL = BULGE_WIDTH * 1.35;
const float BULGE_DEPTH = 1.7725 * BULGE_FLAT * BULGE_OVAL;
// The share of the light that lies in the thin sheet, away from the bulge
// (once the clouds are there, the share they carry); the rest is the smooth
// light of the old disc, drawn as a soft glow.
const float SHEET = 0.5;
const int STEPS = 22;

// Where a place of the galaxy is in the picture: towards the centre is up,
// and the direction the galaxy turns in is to the left.
vec2 inPicture(vec2 g) {
  return vec2(0.5 - g.y / PICTURE_WIDTH, 0.5 + g.x / PICTURE_WIDTH);
}

// The picture fades out before its edge.
float within(float radius) {
  return 1.0 - smoothstep(EDGE * 0.82, EDGE, radius);
}

// How much of the light at a distance from the centre lies in the thin
// sheet. The bulge and the bar are old stars in a thick cloud: there nearly
// all of it belongs to the glow.
float inSheet(float radius) {
  return SHEET * (1.0 - 0.85 * exp(-radius * radius / (BULGE_WIDTH * BULGE_WIDTH)));
}

// How much dust lies at a place of the plane: where the picture is darker
// than its surroundings ("around" is the picture, blurred), and a little
// everywhere in the disc, but none in the bulge.
float dustAt(vec3 seen, vec3 around, float radius) {
  float dark = max(dot(around - seen, vec3(0.3, 0.6, 0.1)), 0.0);
  return (0.0004 + 0.016 * dark) * smoothstep(300.0, 1500.0, radius);
}

void main() {
  vec2 screen = vUv * 2.0 - 1.0;
  vec3 direction = normalize(uForward + screen.x * uRight + screen.y * uUp);
  vec3 from = uEye - CENTRE;

  // The part of the line of sight inside the galaxy: between two planes above
  // and below the disc, and inside its edge.
  float start = 0.0;
  float end = 1e9;
  if (abs(direction.z) > 1e-5) {
    float a = (-HALF_HEIGHT - from.z) / direction.z;
    float b = (HALF_HEIGHT - from.z) / direction.z;
    start = max(start, min(a, b));
    end = min(end, max(a, b));
  } else if (abs(from.z) > HALF_HEIGHT) {
    end = -1.0;
  }
  float qa = dot(direction.xy, direction.xy);
  float qb = dot(from.xy, direction.xy);
  float qc = dot(from.xy, from.xy) - EDGE * EDGE;
  if (qa > 1e-9) {
    float root = qb * qb - qa * qc;
    if (root <= 0.0) {
      end = -1.0;
    } else {
      root = sqrt(root);
      start = max(start, (-qb - root) / qa);
      end = min(end, (-qb + root) / qa);
    }
  } else if (qc > 0.0) {
    end = -1.0;
  }
  if (end <= start) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec3 light = vec3(0.0);
  // The thin sheet, where the line of sight meets the plane: the picture as
  // sharp as it is. A flat view passes through more of the sheet, which
  // makes it a little brighter, but also through more of the dust that lies
  // in it, and seen from the side the dust hides nearly all of it: that is
  // the dark lane of a galaxy seen edge-on. From inside the disc there is no
  // sheet to look at from afar: there all the light is added up along the
  // line of sight.
  // Seen nearly along the plane the sheet would be a line without height:
  // there its light goes into the thick glow instead.
  float sheetSeen = uOutside * smoothstep(0.03, 0.3, abs(direction.z));
  // The levels of blur below are counted for a picture 4096 pixels wide; a
  // smaller one reaches the same blur that many levels earlier.
  float level0 = log2(float(textureSize(uMap, 0).x) / 4096.0);
  float meets = abs(direction.z) > 1e-5 ? -from.z / direction.z : -1.0;
  if (sheetSeen > 0.0 && meets > start && meets < end) {
    vec2 place = from.xy + direction.xy * meets;
    vec2 at = inPicture(place);
    vec3 seen = texture(uMap, at).rgb;
    float radius = length(place);
    float steep = max(abs(direction.z), 0.01);
    float depth = dustAt(seen, textureLod(uMap, at, 5.5 + level0).rgb, radius) * 1.7725 * DUST_HEIGHT / steep;
    float through = depth > 1e-4 ? (1.0 - exp(-depth)) / depth : 1.0;
    light = pow(seen, vec3(2.2)) * within(radius) * inSheet(radius) * sheetSeen
      * pow(1.0 / max(steep, 0.25), 0.5) * through * (1.0 - uClouds);
  }

  // A different start for every pixel hides the steps: they turn into a fine
  // grain instead of rings. From inside the galaxy the steps are short near
  // the camera and grow with the distance.
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float reach = end - start;
  float bend = start > 0.0 ? 1.0 : 2.0;
  float texels = float(textureSize(uMap, 0).x) / PICTURE_WIDTH * length(direction.xy);
  float clear = 1.0;
  float before = 0.0;
  for (int i = 0; i < STEPS; i++) {
    float after = pow(float(i + 1) / float(STEPS), bend);
    float stride = (after - before) * reach;
    vec3 g = from + direction * (start + (before + jitter * (after - before)) * reach);
    before = after;

    // A step that passes over several pixels of the picture reads a blurred
    // version of it, or it would miss what lies between its samples. The
    // glow of the old stars is soft anyway.
    vec2 at = inPicture(g.xy);
    // From outside the picture is only read softly: what is sharp there are
    // the clouds and clusters made after it, not the picture itself.
    float blur = max(log2(max(stride * texels, 1.0)), mix(3.0, 5.5, uOutside * uClouds) + level0);
    vec3 seen = textureLod(uMap, at, blur).rgb;
    vec3 around = textureLod(uMap, at, max(blur, 5.5 + level0)).rgb;
    float radius = length(g.xy);
    float edge = within(radius);

    // The picture is the sum of the light from top to bottom. The glow is
    // spread over the height of the disc, which is thicker in the bulge.
    // Seen from outside the glow of the disc is spread higher: the thick
    // disc of old stars, which the picture from above cannot show.
    float inBulge = exp(-radius * radius / (BULGE_WIDTH * BULGE_WIDTH));
    float thick = DISC_HEIGHT * mix(1.0, 5.0, uOutside) + BULGE_HEIGHT * (1.0 - uOutside) * inBulge;
    // Far above the plane the glow falls off faster than the exponential.
    float high = g.z / (2.5 * thick);
    vec3 shine = pow(seen, vec3(2.2)) * exp(-abs(g.z) / thick - high * high) / (2.0 * thick) * edge;
    // The glow carries what the sheet does not, and the part of the sheet not
    // seen (sheetSeen) that the clouds of galaxyClouds.ts do not carry either.
    float share = 1.0 - inSheet(radius) * (uOutside - (uOutside - sheetSeen) * (1.0 - uClouds));
    vec3 glow = shine * share * (1.0 - inBulge * uOutside);
    // Seen from outside the bulge is a body of its own, an oval. Spread up
    // from the plane like the disc, its bright narrow core would stand above
    // the disc like a pillar. So a place in it shines as the picture does at
    // its distance from the centre in the oval: above the centre as brightly
    // as the picture at that distance beside it, flattened by BULGE_FLAT.
    float oval = length(vec3(g.xy, g.z / BULGE_FLAT));
    float inOval = exp(-oval * oval / (BULGE_OVAL * BULGE_OVAL));
    // Only where the bulge shines: beyond three of its widths it adds less
    // than a thousandth, and four readings of the picture per step are saved.
    if (uOutside > 0.0 && inOval > 0.001) {
      // Read in four directions a quarter turn apart and averaged: read in
      // one, the bar would cast wedges of light from the centre.
      vec2 out1 = g.xy * (oval / max(radius, 1.0));
      vec2 out2 = vec2(-out1.y, out1.x);
      vec3 core = pow(textureLod(uMap, inPicture(out1), blur).rgb, vec3(2.2))
        + pow(textureLod(uMap, inPicture(-out1), blur).rgb, vec3(2.2))
        + pow(textureLod(uMap, inPicture(out2), blur).rgb, vec3(2.2))
        + pow(textureLod(uMap, inPicture(-out2), blur).rgb, vec3(2.2));
      glow += core * 0.25 * inOval / BULGE_DEPTH * uOutside;
    }
    light += glow * clear * stride;

    // The dust lies in a thin sheet around the plane. Seen from above, as
    // in the picture, it hardly counts; seen along the plane it hides what
    // is behind.
    float dust = dustAt(seen, around, radius) * exp(-pow(g.z / DUST_HEIGHT, 2.0)) * edge;
    clear *= exp(-dust * stride);
    if (clear < 0.004) break;
  }

  // From inside, the galaxy is all around. The picture is drawn as bright as
  // a long exposure from far away shows it; with that exposure the whole sky
  // would be fog. A much shorter one leaves the band of the Milky Way.
  light *= mix(0.05, 1.0, uOutside);
  // Up to middle brightness the picture stays as it was drawn; above that the
  // light is pressed together, so that a view along the plane, where much
  // light adds up, does not burn out.
  const float knee = 0.55;
  vec3 over = max(light - knee, 0.0) / (1.0 - knee);
  vec3 pressed = min(light, knee) + (1.0 - knee) * (1.0 - exp(-over));
  vec3 color = pow(pressed, vec3(1.0 / 2.2));
  // A grain finer than one step of brightness keeps the faint outskirts from showing stripes.
  outColor = vec4(color * uFade + (jitter - 0.5) / 255.0, 1.0);
}
`;

/**
 * The galaxy as a body (galaxyClouds.ts): soft clouds of light at different
 * heights, and dark clouds of dust in the plane. Each cloud of light carries
 * an equal share of the light of the picture, spread over its disc, so that
 * together they shine about as brightly as the picture, from any distance.
 * Clouds close to the camera would fill the screen with blur: they fade out,
 * and the stars around the camera (starfield.ts) take over.
 */
export const CLOUDS_VERTEX = /* glsl */ `
in vec3 position;
in vec3 color;
in float radius;   // in parsecs
in float share;    // of the light of the picture, or for dust how much it hides
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uPixelsPerUnit;
uniform float uPixelRatio;
uniform float uGain;
uniform float uFade;
uniform float uDust;     // 1 for clouds of dust
uniform vec3 uEye;       // the camera
out vec3 vColor;
out float vStrength;
void main() {
  vec4 eye = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * eye;
  float distance = max(length(eye.xyz), 1.0);
  float pixels = radius * uPixelsPerUnit / distance;
  gl_PointSize = clamp(pixels * 1.7, 1.0, 256.0 * uPixelRatio);
  // A cloud keeps its brightness per area at any distance, as the picture
  // does: its share of the light spread over its disc. One smaller than a
  // pixel spreads it over that pixel instead.
  float perPixel = distance / uPixelsPerUnit;
  float area = max(3.14159 * radius * radius, perPixel * perPixel);
  float near = smoothstep(radius * 8.0, radius * 20.0, distance);
  vStrength = mix(share * uGain / area, share * uGain, uDust) * near * uFade;
  // Round clouds of dust only suit a view from above. Seen along the plane
  // they would stack into speckles; there the glow draws the dark lane.
  float steep = abs(normalize(position - uEye).z);
  vStrength *= mix(1.0, smoothstep(0.12, 0.4, steep), uDust);
  // Seen along the plane, the dust hides most of the thin layer of the arms
  // in it: the dark lane of a galaxy seen edge-on. The thick disc above and
  // below shines on.
  float inLane = exp(-abs(position.z) / 250.0) * (1.0 - uDust);
  vStrength *= 1.0 - 0.96 * inLane * (1.0 - smoothstep(0.03, 0.3, steep));
  vColor = color;
  if (vStrength < 1e-5 || gl_PointSize * near < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

export const CLOUDS_FRAGMENT = /* glsl */ `${HEADER}
in vec3 vColor;
in float vStrength;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  // A soft disc, faded out at the edge of its square; the factor keeps its
  // sum about equal to that of a flat disc of the cloud's radius.
  float soft = exp(-r2 * 2.2) * 1.6;
  outColor = vec4(vColor * vStrength * soft, 1.0);
}
`;

/** Dust takes away a share of the light behind it. */
export const DUST_FRAGMENT = /* glsl */ `${HEADER}
in vec3 vColor;
in float vStrength;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  outColor = vec4(0.0, 0.0, 0.0, clamp(vStrength * exp(-r2 * 3.0), 0.0, 0.85));
}
`;

/** Covers the whole picture, whatever the camera does. */
export const SCREEN_VERTEX = /* glsl */ `
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Puts a picture that was drawn beforehand onto the screen. */
export const COPY_FRAGMENT = /* glsl */ `${HEADER}
uniform sampler2D uMap;
in vec2 vUv;
out vec4 outColor;
void main() {
  outColor = vec4(texture(uMap, vUv).rgb, 1.0);
}
`;

/** The stars with planets: small glowing discs in the colour of their temperature. */
export const HOSTS_VERTEX = /* glsl */ `
in vec3 position;
in vec3 color;
in float weight;   // 0 for one planet, up to 1 for many
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uPixelsPerUnit;
uniform float uPixelRatio;
out vec4 vColor;
void main() {
  vec4 eye = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * eye;
  float distance = length(eye.xyz);
  float pixels = 0.5 * uPixelsPerUnit / max(distance, 1e-4);
  // From across the galaxy thousands of stars pile up on a few pixels.
  float far = smoothstep(1500.0, 25000.0, distance);
  float smallest = (2.6 + weight * 2.4) * uPixelRatio * mix(1.0, 0.65, far);
  gl_PointSize = clamp(pixels, smallest, 46.0 * uPixelRatio);
  float crowd = mix(1.0, 0.07, far);
  vColor = vec4(color, crowd);
}
`;

export const HOSTS_FRAGMENT = /* glsl */ `${HEADER}
in vec4 vColor;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float glow = exp(-r2 * 5.0) - 0.0067;
  float core = exp(-r2 * 28.0);
  outColor = vec4((vColor.rgb * glow + vec3(core) * 0.75) * vColor.a, 1.0);
}
`;

/**
 * The stars between the stars with planets (starfield.ts). Each gives as much
 * light as it has, thinned out with the square of its distance, so near and
 * bright stars are large and sharp, far and faint ones small and dim. A class
 * of stars fades out before the end of its reach, so stars never pop up.
 */
export const FIELD_VERTEX = /* glsl */ `
in vec3 position;
in vec3 color;
in float light;    // in suns
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uPixelRatio;
uniform float uReach;
uniform float uFade;
out vec4 vColor;
void main() {
  vec4 eye = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * eye;
  float distance = max(length(eye.xyz), 1e-3);
  // Dust in the plane of the galaxy dims what lies far away in it: light
  // loses about half of itself every two kiloparsecs along the plane. Only
  // the part of the way that runs inside the layer of dust counts: from
  // above or below the disc, little of it.
  vec3 camera = -transpose(mat3(modelViewMatrix)) * modelViewMatrix[3].xyz;
  float inLayer = min(1.0, 320.0 / max(abs(camera.z - position.z), 1.0));
  float dust = exp(-distance * inLayer / 2800.0 * exp(-abs(position.z) / 160.0));
  // Light arriving here, compared with a faint star at the end of its reach.
  // Only the nearest and brightest stand out; the rest are the faint grain
  // that the glow of the galaxy is made of. Below about FAINTEST in
  // starfieldView.ts a star is invisible.
  float seen = light / (distance * distance) / 1e-4 * 0.07 * dust;
  float edge = 1.0 - smoothstep(0.7 * uReach, uReach, distance);
  float alpha = min(pow(seen, 0.85), 1.0) * edge * uFade;
  // Brighter than that a star does not get whiter, it gets a larger glow.
  gl_PointSize = clamp(1.3 + 1.6 * log2(1.0 + seen), 1.3, 16.0) * uPixelRatio;
  vColor = vec4(color, alpha);
  if (alpha < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

export const FIELD_FRAGMENT = /* glsl */ `${HEADER}
in vec4 vColor;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float glow = exp(-r2 * 6.0);
  float core = exp(-r2 * 40.0);
  outColor = vec4((vColor.rgb * glow + vec3(core) * 0.6) * vColor.a, 1.0);
}
`;

/** A cloud of gas or the glow of a cluster: a picture turned towards the camera. */
export const LANDMARK_VERTEX = /* glsl */ `
in vec3 position;
in vec2 uv;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Glowing gas is pink from hydrogen, with blue light scattered by dust near
 * the young stars in its middle and dark lanes of dust across it. A cluster
 * is a soft glow of the stars too faint to see one by one.
 */
export const LANDMARK_FRAGMENT = /* glsl */ `${HEADER}
uniform vec3 uColor;
uniform float uKind;      // 0 cloud of gas, 1 young cluster, 2 globular cluster, 3 shell of a dying star, 4 remnant of a supernova, 5 small galaxy
uniform float uSeed;
uniform float uFade;
in vec2 vUv;
out vec4 outColor;

// Without sin(): on many graphics cards sin() of large numbers loses its
// precision, and the noise falls apart into square blocks.
float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    sum += amp * noise(p);
    p = p * 2.03 + 17.1;
    amp *= 0.5;
  }
  return sum;
}

void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  vec3 color;
  if (uKind < 0.5) {
    vec2 p = vUv * 2.6 + uSeed;
    vec2 warp = vec2(fbm(p + 3.1), fbm(p + 8.7));
    float gas = fbm(p + warp * 1.6);
    float lanes = smoothstep(0.45, 0.7, fbm(p * 1.7 + warp + 31.0));
    // A bright core, ragged lobes and faint outskirts far around it.
    float shape = exp(-r2 * 7.0) * smoothstep(0.2, 0.7, gas + 0.3 * (1.0 - r2));
    float outskirts = exp(-r2 * 2.2) * smoothstep(0.35, 0.8, gas) * 0.35;
    float middle = exp(-r2 * 40.0);
    vec3 ionised = mix(uColor, vec3(1.0, 0.55, 0.45), smoothstep(0.5, 0.8, gas) * 0.4);
    color = (ionised * (shape + outskirts) * (1.0 - 0.75 * lanes) + vec3(0.5, 0.65, 1.0) * middle * 0.5) * 0.9;
  } else if (uKind < 1.5) {
    color = uColor * exp(-r2 * 5.0) * 0.22;
  } else if (uKind < 2.5) {
    color = uColor * exp(-r2 * 14.0) * 0.22 + uColor * exp(-r2 * 4.0) * 0.05;
  } else if (uKind < 3.5) {
    // A dying star has blown off its outer layers: a thin ring of gas, blue
    // green inside, red at its rim, with the hot little star in the middle.
    float r = sqrt(r2);
    float lumps = fbm(vUv * 7.0 + uSeed);
    float ring = exp(-pow((r - 0.55 - 0.08 * lumps) / 0.16, 2.0));
    vec3 tint = mix(uColor, vec3(1.0, 0.35, 0.35), smoothstep(0.45, 0.75, r));
    color = tint * ring * (0.6 + 0.6 * lumps) * 0.9 + uColor * exp(-r2 * 6.0) * 0.12 + vec3(0.9, 0.95, 1.0) * exp(-r2 * 900.0);
  } else if (uKind < 4.5) {
    // The shell of an exploded star: thin tangled filaments, bunched into
    // arcs where the blast ran into denser gas, missing elsewhere.
    float r = sqrt(r2);
    float wobble = fbm(vUv * 3.0 + uSeed) - 0.5;
    float shell = exp(-pow((r - 0.74 - 0.32 * wobble) / 0.035, 2.0))
      + 0.6 * exp(-pow((r - 0.62 - 0.4 * wobble) / 0.025, 2.0));
    float strands = smoothstep(0.45, 0.8, fbm(vUv * 11.0 + uSeed * 2.0));
    float arcs = smoothstep(0.38, 0.62, fbm(vUv * 1.8 + uSeed + 4.0));
    vec3 tint = mix(uColor, vec3(1.0, 0.45, 0.5), smoothstep(0.4, 0.7, fbm(vUv * 3.0 + 5.0)));
    color = tint * shell * strands * arcs * 1.5;
  } else {
    // A small galaxy: a lopsided cloud of stars with a bar across it and
    // pink knots where new stars are born.
    vec2 p = vUv * 2.2 + uSeed;
    float body = exp(-r2 * 2.6) * (0.55 + 0.9 * fbm(p));
    vec2 b = vec2(vUv.x * 0.9 + vUv.y * 0.44, -vUv.x * 0.44 + vUv.y * 0.9);
    float bar = exp(-pow(b.x / 0.55, 2.0) - pow(b.y / 0.14, 2.0)) * 0.7;
    float knots = smoothstep(0.62, 0.78, fbm(vUv * 6.0 + uSeed * 3.0)) * exp(-r2 * 2.0);
    color = (uColor * (body + bar) + vec3(1.0, 0.4, 0.55) * knots * 0.8) * 0.35;
  }
  // Fades out before the edge of its square, or the edge would show.
  outColor = vec4(color * uFade * (1.0 - smoothstep(0.6, 1.0, r2)), 1.0);
}
`;

// ---- The system view ---------------------------------------------------------

/** Shared by the planets, the star and the haze: hands the point on the ball to the fragment shader. */
export const BALL_VERTEX = /* glsl */ `
in vec3 position;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec3 vPosition;
void main() {
  vPosition = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** A planet with the same surface as on its page. */
export const PLANET_FRAGMENT = /* glsl */ `${HEADER}
${SURFACE_GLSL}
uniform vec3 uLightObject;   // direction to the star in the planet's coordinates
uniform vec3 uCameraObject;  // the camera in the planet's coordinates
in vec3 vPosition;
out vec4 outColor;
void main() {
  vec3 p = normalize(vPosition);
  vec3 V = normalize(uCameraObject - p);
  outColor = vec4(toDisplay(shadePlanet(p, normalize(uLightObject), V)), 1.0);
}
`;

/** A moon: a small ball of grey rock, lit by the star. */
export const MOON_FRAGMENT = /* glsl */ `${HEADER}
${SURFACE_GLSL}
uniform vec3 uLightObject;   // direction to the star in the moon's coordinates
in vec3 vPosition;
out vec4 outColor;
void main() {
  vec3 n = normalize(vPosition);
  gPixel = min(max(length(dFdx(n)), length(dFdy(n))), 0.5);
  float rock = 0.36 + 0.3 * fbm(n * 2.6 + uSeed.zyx + 40.0, 3, 2.6);
  float sun = max(dot(n, normalize(uLightObject)), 0.0);
  outColor = vec4(toDisplay(vec3(rock, rock * 0.97, rock * 0.93) * uLight * sun), 1.0);
}
`;

/** The thin shell of air that glows around the edge of a planet. */
export const HAZE_FRAGMENT = /* glsl */ `${HEADER}
uniform vec3 uColor;
uniform float uStrength;
uniform float uShell;        // radius of the shell in planet radii
uniform vec3 uLightObject;
uniform vec3 uCameraObject;
in vec3 vPosition;
out vec4 outColor;
void main() {
  vec3 p = normalize(vPosition);
  vec3 V = normalize(uCameraObject - p);
  // How far the line of sight passes from the centre, in planet radii: the
  // glow is strongest right at the edge of the planet and gone at the shell's.
  float facing = abs(dot(p, V));
  float passing = sqrt(max(1.0 - facing * facing, 0.0)) * uShell;
  float outside = clamp((passing - 1.0) / (uShell - 1.0), 0.0, 1.0);
  float lit = smoothstep(-0.35, 0.5, dot(p, normalize(uLightObject)));
  float glow = pow(1.0 - outside, 3.0) * uStrength * lit;
  outColor = vec4(pow(uColor, vec3(1.0 / 2.2)) * glow, 1.0);
}
`;

/** Rings: a flat disc in the plane of the planet's equator. */
export const RING_VERTEX = /* glsl */ `
in vec3 position;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec2 vPlane;
void main() {
  vPlane = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const RING_FRAGMENT = /* glsl */ `${HEADER}
${SURFACE_GLSL}
uniform vec3 uLightObject;   // direction to the star in the coordinates of the disc
in vec2 vPlane;
out vec4 outColor;
void main() {
  float rho = length(vPlane);
  vec4 ring = ringSample(rho, fwidth(rho));
  if (ring.a <= 0.003) discard;
  vec3 L = normalize(uLightObject);
  // The planet throws a shadow on the part of the rings behind it.
  vec3 q = vec3(vPlane, 0.0);
  float along = dot(q, L);
  float miss = sqrt(max(dot(q, q) - along * along, 0.0));
  float shadow = along < 0.0 ? 1.0 - smoothstep(0.97, 1.03, miss) : 0.0;
  float lit = mix(0.55, 1.0, abs(L.z)) * (1.0 - 0.88 * shadow);
  outColor = vec4(toDisplay(ring.rgb * uLight * lit), ring.a);
}
`;

/** The star in the middle: a glowing ball, darker towards the edge. */
export const STAR_FRAGMENT = /* glsl */ `${HEADER}
${SURFACE_GLSL}
uniform vec3 uColor;
uniform vec3 uCameraObject;
uniform float uHasMap;
in vec3 vPosition;
out vec4 outColor;
void main() {
  vec3 p = normalize(vPosition);
  float facing = max(dot(p, normalize(uCameraObject - p)), 0.0);
  vec3 surface;
  if (uHasMap > 0.5) {
    surface = toLinear(sampleMap(uMapDay, p, 0.0).rgb) * 1.3;
  } else {
    // Bubbling gas and a few darker spots.
    gPixel = min(max(length(dFdx(p)), length(dFdy(p))), 0.5);
    float cells = fbm(p * 11.0 + vec3(0.0, uTime * 0.05, 0.0) + uSeed, 4, 11.0);
    float spots = fbm(p * 2.6 + uSeed.zxy, 3, 2.6);
    surface = uColor * (0.9 + cells * 0.7) * (1.0 - 0.4 * smoothstep(0.22, 0.34, spots));
  }
  float limb = 0.5 + 0.5 * pow(facing, 0.55);
  outColor = vec4(toDisplay(surface * limb * 1.2), 1.0);
}
`;

/** The shine around the star: a square that always faces the camera. */
export const GLOW_VERTEX = /* glsl */ `
in vec3 position;
in vec2 uv;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const GLOW_FRAGMENT = /* glsl */ `${HEADER}
uniform vec3 uColor;
uniform float uCore;   // radius of the star as a share of the square
in vec2 vUv;
out vec4 outColor;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  if (r >= 1.0) discard;
  float outside = max(r - uCore, 0.0) / (1.0 - uCore);
  float glow = pow(1.0 - outside, 5.0) * 0.55;
  outColor = vec4(uColor * glow, 1.0);
}
`;
