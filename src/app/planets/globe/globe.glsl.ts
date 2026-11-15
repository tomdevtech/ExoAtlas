import { SURFACE_GLSL } from "./surface.glsl";
import { defineLines, type SurfaceDefines } from "./uniforms";

/**
 * The program that draws one planet into a square of the canvas, for the
 * moving images and the 3D model on the planet pages.
 *
 * There is no geometry: one triangle covers the whole area, and for each pixel
 * the fragment shader works out which point of the ball lies behind it. That
 * gives a perfectly round edge at any size. The view has no perspective, as
 * through a telescope.
 */
export const GLOBE_VERTEX = /* glsl */ `#version 300 es
void main() {
  // One triangle that reaches over the whole area, without any buffer.
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** The fragment shader for one combination of surface parts (see surfaceDefines). */
export function globeFragment(defines: SurfaceDefines): string {
  // #version has to be the very first line.
  return `#version 300 es\n${defineLines(defines)}${GLOBE_FRAGMENT_BODY}`;
}

const GLOBE_FRAGMENT_BODY = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
${SURFACE_GLSL}
uniform vec2 uCenter;      // centre of the planet in pixels
uniform float uRadius;     // radius of the planet in pixels
uniform mat3 uViewToObj;   // turns the viewer's coordinates into the planet's
uniform vec3 uLightView;   // direction to the star as the viewer sees it

out vec4 outColor;

// Puts a layer over what is already there.
void over(inout vec4 below, vec3 color, float opacity) {
  below = vec4(color * opacity + below.rgb * (1.0 - opacity), opacity + below.a * (1.0 - opacity));
}

void main() {
  // The pixel in planet radii: x to the right, y up, the viewer looks along -z.
  vec2 d = (gl_FragCoord.xy - uCenter) / uRadius;
  float r = length(d);
  float pixel = 1.0 / uRadius;
  vec4 result = vec4(0.0);

  // The atmosphere glows a little beyond the edge, on the side facing the star.
  if (uAtmo.a > 0.0 && r > 1.0 - pixel) {
    float width = 0.03 + 0.07 * uAtmo.a;
    float fade = exp(-max(r - 1.0, 0.0) / width * 3.0);
    float lit = smoothstep(-0.25, 0.45, dot(d / r, uLightView.xy));
    over(result, uAtmo.rgb * uLight, fade * lit * uAtmo.a * 0.55);
  }

  // The rings lie in the plane through the centre, at right angles to the axis.
  vec3 axis = vec3(uViewToObj[0][1], uViewToObj[1][1], uViewToObj[2][1]);
  vec4 ring = vec4(0.0);
  float ringZ = 0.0;
  if (uRing.z > 0.5 && abs(axis.z) > 0.02) {
    ringZ = -dot(d, axis.xy) / axis.z;
    vec3 point = vec3(d, ringZ);
    ring = ringSample(length(point), pixel / max(abs(axis.z), 0.2));
    if (ring.a > 0.0) {
      // Seen at a flat angle the view passes through more of the rings.
      ring.a = 1.0 - pow(1.0 - ring.a, 1.0 / max(abs(axis.z), 0.15));
      // The planet throws a shadow on the rings behind it.
      float towards = dot(point, uLightView);
      float hit = towards * towards - (dot(point, point) - 1.0);
      float shadow = towards < 0.0 ? smoothstep(0.0, 0.03, hit) : 0.0;
      float lit = 0.3 + 0.7 * clamp(abs(dot(axis, uLightView)) * 1.8, 0.0, 1.0);
      ring.rgb *= uLight * lit * (1.0 - shadow * 0.93);
    }
  }

  // The ball itself. It is computed two pixels beyond the edge as well, so the
  // differences between neighbouring pixels are defined everywhere on it.
  float cover = clamp((1.0 - r) / pixel + 0.5, 0.0, 1.0);
  float ballZ = 0.0;
  vec3 ball = vec3(0.0);
  if (r < 1.0 + 2.5 * pixel) {
    vec2 dc = d * min(1.0, 0.9995 / max(r, 1e-6));
    ballZ = sqrt(1.0 - dot(dc, dc));
    ball = shadePlanet(
      uViewToObj * vec3(dc, ballZ),
      uViewToObj * uLightView,
      uViewToObj * vec3(0.0, 0.0, 1.0));
  }

  bool ringInFront = cover <= 0.0 || ringZ > ballZ;
  if (!ringInFront) over(result, ring.rgb, ring.a);
  over(result, ball, cover);
  if (ringInFront) over(result, ring.rgb, ring.a);

  outColor = vec4(toDisplay(result.rgb / max(result.a, 1e-4)) * result.a, result.a);
}
`;
