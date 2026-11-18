# Textures

The images in this folder come from third parties and were scaled down by `npm run textures` ([scripts/fetch-textures.ts](../../scripts/fetch-textures.ts)). They are not covered by the MIT licence of the code.

| Files | Source | Licence |
| --- | --- | --- |
| `planets/*` of the planets, the Sun and Saturn's rings | [Solar System Scope](https://www.solarsystemscope.com/textures/), based on NASA imagery | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `planets/*` of the moons, Ceres and Pluto | NASA, JPL-Caltech, USGS Astrogeology, Space Science Institute, DLR, MPS, IDA, Johns Hopkins APL, SwRI and the Lunar and Planetary Institute; every map with its credit and source in [maps.ts](../../src/app/solar-system/maps.ts) and on the body's page | public domain (works of NASA and the USGS); credited as the publishers ask |
| `sky/milky-way-*.jpg` | [ESO/S. Brunier, "The Milky Way panorama" (eso0932a)](https://www.eso.org/public/images/eso0932a/) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `sky/galaxy.jpg` | [NASA/JPL-Caltech/ESO/R. Hurt, "Artist's impression of the Milky Way" (eso1339g)](https://www.eso.org/public/images/eso1339g/) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `presets/*` | Simulated by `npm run presets` ([scripts/generate-presets.ts](../../scripts/generate-presets.ts)): no third-party material | MIT, like the code |

Changes: scaled down and compressed again. `planets/venus-*` is the map of the cloud tops, not of the surface. The maps of the moons, Ceres and Pluto were also turned so that longitude 0 lies in the middle; grey mosaics were tinted with the body's colours, exaggerated or false colours toned down, the brightness set after the body's albedo, and parts no spacecraft saw filled with a smooth continuation of the neighbouring tones ([moon-maps.ts](../../scripts/moon-maps.ts)). `planets/titan-*` shows Titan's haze, with the near-infrared map of its surface showing through faintly.

The files in `presets/` are not pictures but data: the base maps the exoplanets are drawn from. For rocky planets red is the height after erosion, green where water gathers (or the cracks of an ice crust), blue the craters. For gas giants red are the belts and zones, green a second tracer for streaks, blue the storms. The shader turns them into a planet with the values of that planet.
