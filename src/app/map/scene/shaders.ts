import { SURFACE_GLSL } from "@/app/planets/globe/surface.glsl";

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

// ---- Points of light ----------------------------------------------------------

/** The cloud of points that makes up the galaxy seen from far away. */
export const GALAXY_VERTEX = /* glsl */ `
in vec3 position;
in vec3 color;
in float size;
in float alpha;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uPixelsPerUnit;  // pixels a length of 1 covers at the distance 1
uniform float uFade;
uniform float uGain;
out vec4 vColor;
void main() {
  vec4 eye = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * eye;
  float distance = length(eye.xyz);
  float pixels = size * uPixelsPerUnit / max(distance, 1.0);
  // A point smaller than the smallest dot gets fainter instead.
  float faint = min(pixels / 2.0, 1.0);
  // Points right in front of the camera would fill the screen: they fade out.
  float near = smoothstep(400.0, 3000.0, distance) * min(220.0 / pixels, 1.0);
  gl_PointSize = clamp(pixels, 2.0, 220.0);
  vColor = vec4(color, alpha * uFade * uGain * faint * faint * near);
}
`;

export const GALAXY_FRAGMENT = /* glsl */ `${HEADER}
in vec4 vColor;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float glow = exp(-dot(d, d) * 4.0) - 0.0183;
  if (glow <= 0.0) discard;
  outColor = vec4(vColor.rgb * vColor.a * glow, 1.0);
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

/**
 * Brings the summed light of the galaxy cloud to the screen. Its centre is
 * more than a hundred times brighter than its arms, far more than a screen
 * can show, so the brightness is compressed like in a long-exposure
 * photograph: the arms stay visible and the centre does not burn out to a
 * flat white disc.
 */
export const EXPOSE_FRAGMENT = /* glsl */ `${HEADER}
uniform sampler2D uMap;
in vec2 vUv;
out vec4 outColor;
const float BRIGHTEST = 40.0;
void main() {
  vec3 light = texture(uMap, vUv).rgb;
  float level = max(max(light.r, light.g), light.b);
  if (level <= 0.0) discard;
  float shown = min(log(1.0 + 10.0 * level) / log(1.0 + 10.0 * BRIGHTEST), 1.0);
  // Keep the colour and change only the brightness; the very centre turns white.
  vec3 color = light * (shown / level);
  color = mix(color, vec3(shown), 0.5 * smoothstep(8.0, BRIGHTEST, level));
  outColor = vec4(color, 1.0);
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
    float cells = fbm(p * 11.0 + vec3(0.0, uTime * 0.05, 0.0) + uSeed, 4);
    float spots = fbm(p * 2.6 + uSeed.zxy, 3);
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
