/**
 * Writes the three channels of a preset texture stacked as one greyscale image.
 *
 *   tsx scripts/preview-presets.ts <name> <output.jpg>
 */
import path from "node:path";
import sharp from "sharp";

async function main() {
  const [name, out] = process.argv.slice(2);
  const file = path.resolve("public/textures/presets", `${name}-lg.webp`);
  const channels = await Promise.all(
    ([0, 1, 2] as const).map((channel) =>
      sharp(file).extractChannel(channel).resize(1024, 512).jpeg({ quality: 85 }).toBuffer(),
    ),
  );
  await sharp({ create: { width: 1024, height: 1536, channels: 3, background: "#000" } })
    .composite(channels.map((input, index) => ({ input, left: 0, top: index * 512 })))
    .jpeg({ quality: 85 })
    .toFile(out);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
