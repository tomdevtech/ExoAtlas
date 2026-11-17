# Textures

The images in this folder come from third parties and were scaled down by `npm run textures` ([scripts/fetch-textures.ts](../../scripts/fetch-textures.ts)). They are not covered by the MIT licence of the code.

| Files | Source | Licence |
| --- | --- | --- |
| `planets/*` | [Solar System Scope](https://www.solarsystemscope.com/textures/), based on NASA imagery | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `sky/milky-way-*.jpg` | [ESO/S. Brunier, "The Milky Way panorama" (eso0932a)](https://www.eso.org/public/images/eso0932a/) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `sky/galaxy.jpg` | [NASA/JPL-Caltech/ESO/R. Hurt, "Artist's impression of the Milky Way" (eso1339g)](https://www.eso.org/public/images/eso1339g/) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `presets/*` | Simulated by `npm run presets` ([scripts/generate-presets.ts](../../scripts/generate-presets.ts)): no third-party material | MIT, like the code |

Changes: scaled down and compressed again. `planets/venus-*` is the map of the cloud tops, not of the surface.

The files in `presets/` are not pictures but data: the base maps the exoplanets are drawn from. For rocky planets red is the height after erosion, green where water gathers (or the cracks of an ice crust), blue the craters. For gas giants red are the belts and zones, green a second tracer for streaks, blue the storms. The shader turns them into a planet with the values of that planet.
