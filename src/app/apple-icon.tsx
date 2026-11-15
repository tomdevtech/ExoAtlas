import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// The icon on a phone's home screen. iOS wants an opaque square and rounds the corners itself.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  // The mark itself comes from icon.svg, so there is only one drawing to keep up to date.
  const svg = await readFile(join(process.cwd(), "src/app/icon.svg"));
  const src = `data:image/svg+xml;base64,${svg.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "radial-gradient(circle at 50% 50%, #2a2416 0%, #0d1019 45%, #05060b 75%)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain <img>, not next/image */}
        <img src={src} width={124} height={124} alt="" />
      </div>
    ),
    size,
  );
}
