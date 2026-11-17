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
uniform float uFlatten;    // how much shorter the planet is from pole to pole than across
uniform vec4 uMoon;        // centre of the moon as the viewer sees it, in planet radii, and its radius (0: no moon)

out vec4 outColor;

// Puts a layer over what is already there.
void over(inout vec4 below, vec3 color, float opacity) {
  below = vec4(color * opacity + below.rgb * (1.0 - opacity), opacity + below.a * (1.0 - opacity));
}

void main() {
  // The pixel in planet radii: x to the right, y up, the viewer looks along -z.
  vec2 d = (gl_FragCoord.xy - uCenter) / uRadius;
  float pixel = 1.0 / uRadius;
  vec4 result = vec4(0.0);

  // A giant that turns fast is flattened at its poles. Seen from the side it
  // is an ellipse, shorter along its axis; r is 1 on its edge.
  vec3 axis = vec3(uViewToObj[0][1], uViewToObj[1][1], uViewToObj[2][1]);
  float squeeze = 1.0 / ((1.0 - uFlatten) * (1.0 - uFlatten)) - 1.0;
  float depthTerm = 1.0 + squeeze * axis.z * axis.z;
  float alongAxis = dot(d, axis.xy);
  float r = sqrt(dot(d, d) + squeeze * alongAxis * alongAxis / depthTerm);

  // The atmosphere glows a little beyond the edge, on the side facing the star.
  if (uAtmo.a > 0.0 && r > 1.0 - pixel) {
    float width = 0.03 + 0.07 * uAtmo.a;
    float fade = exp(-max(r - 1.0, 0.0) / width * 3.0);
    float lit = smoothstep(-0.25, 0.45, dot(d / r, uLightView.xy));
    over(result, uAtmo.rgb * uLight, fade * lit * uAtmo.a * 0.55);
  }

  // The rings lie in the plane through the centre, at right angles to the axis.
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
    // Where the line of sight meets the flattened ball.
    float along = dot(dc, axis.xy);
    float halfway = squeeze * along * axis.z;
    float rest = dot(dc, dc) + squeeze * along * along - 1.0;
    ballZ = (-halfway + sqrt(max(halfway * halfway - depthTerm * rest, 0.0))) / depthTerm;
    // The surface is computed on a ball, so the point is stretched back to one.
    vec3 onBall = uViewToObj * vec3(dc, ballZ);
    onBall.y /= 1.0 - uFlatten;
    ball = shadePlanet(
      normalize(onBall),
      uViewToObj * uLightView,
      uViewToObj * vec3(0.0, 0.0, 1.0));
  }

  // The moon: a small ball of grey rock.
  vec4 moon = vec4(0.0);
  float moonZ = 0.0;
  if (uMoon.w > 0.0) {
    vec2 md = (d - uMoon.xy) / uMoon.w;
    float mr = length(md);
    float moonPixel = pixel / uMoon.w;
    if (mr < 1.0 + moonPixel) {
      vec2 mc = md * min(1.0, 0.9995 / max(mr, 1e-6));
      vec3 n = vec3(mc, sqrt(1.0 - dot(mc, mc)));
      moonZ = uMoon.z + n.z * uMoon.w;
      // Behind the planet, as seen from the star, the moon is in its shadow.
      float towards = dot(uMoon.xyz, uLightView);
      float miss = length(uMoon.xyz - towards * uLightView);
      float lit = towards < 0.0 ? smoothstep(0.92, 1.06, miss) : 1.0;
      // Its own pixel size: the moon is smaller than the planet.
      gPixel = moonPixel;
      float rock = 0.36 + 0.3 * fbm(n * 2.6 + uSeed.zyx + 40.0, 3, 2.6);
      moon = vec4(
        vec3(rock, rock * 0.97, rock * 0.93) * uLight * max(dot(n, uLightView), 0.0) * lit,
        clamp((1.0 - mr) / moonPixel + 0.5, 0.0, 1.0));
    }
  }

  bool ringInFront = cover <= 0.0 || ringZ > ballZ;
  bool moonInFront = cover <= 0.0 || moonZ > ballZ;
  if (!ringInFront) over(result, ring.rgb, ring.a);
  if (!moonInFront) over(result, moon.rgb, moon.a);
  over(result, ball, cover);
  if (ringInFront) over(result, ring.rgb, ring.a);
  if (moonInFront) over(result, moon.rgb, moon.a);

  outColor = vec4(toDisplay(result.rgb / max(result.a, 1e-4)) * result.a, result.a);
}
`;
