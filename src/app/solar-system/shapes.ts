import GRIDS from "./shapes.json";

/**
 * The irregular bodies that are drawn from a shape model instead of as a sphere. `npm run shapes`
 * (scripts/fetch-shapes.ts) downloads each model and writes its radius grid to public/shapes/<slug>.bin
 * and the grid's largest radius to shapes.json.
 */
export interface ShapeSource {
  download: string;
  /** Whether the download is a ZIP archive holding the OBJ file. */
  zipped: boolean;
  credit: string;
  url: string;
}

const SATURN_SMALL_MOONS = "https://sbn.psi.edu/pds/shape-models/files/SATURN_SMALL_MOONS/";
const THOMAS = "P. Thomas, J. Joseph and T. Ansty, Saturn Small Moon Shape Models, NASA PDS";

export const SHAPE_SOURCES: Record<string, ShapeSource> = {
  vesta: {
    download: "https://sbn.psi.edu/pds/shape-models/files/vesta/Vesta-256V.obj",
    zipped: false,
    credit: "F. Preusker et al., Dawn FC2 derived Vesta DTM, NASA PDS Small Bodies Node",
    url: "https://sbn.psi.edu/pds/shape-models/",
  },
  phobos: {
    download: "https://sbmt.jhuapl.edu/shared-files/files/phobos_g_148m_spc_obj_0000n00000_v004.obj.zip",
    zipped: true,
    credit: "C. M. Ernst et al. 2023, JHU/APL Small Body Mapping Tool",
    url: "https://doi.org/10.1186/s40623-023-01814-7",
  },
  deimos: {
    download: "https://sbmt.jhuapl.edu/shared-files/files/deimos_g_083m_spc_obj_0000n00000_v002.obj.zip",
    zipped: true,
    credit: "C. M. Ernst et al. 2023, JHU/APL Small Body Mapping Tool",
    url: "https://doi.org/10.1186/s40623-023-01814-7",
  },
  hyperion: {
    download: `${SATURN_SMALL_MOONS}hyperion_30k_plt.tab.obj`,
    zipped: false,
    credit: THOMAS,
    url: "https://doi.org/10.26033/ewy3-jy61",
  },
  pan: {
    download: `${SATURN_SMALL_MOONS}pan_30k_plt.tab.obj`,
    zipped: false,
    credit: THOMAS,
    url: "https://doi.org/10.26033/ewy3-jy61",
  },
  daphnis: {
    download: `${SATURN_SMALL_MOONS}daphnis_30k_plt.tab.obj`,
    zipped: false,
    credit: THOMAS,
    url: "https://doi.org/10.26033/ewy3-jy61",
  },
  atlas: {
    download: `${SATURN_SMALL_MOONS}atlas_30k_plt.tab.obj`,
    zipped: false,
    credit: THOMAS,
    url: "https://doi.org/10.26033/ewy3-jy61",
  },
  prometheus: {
    download: `${SATURN_SMALL_MOONS}prometheus_30k_plt.tab.obj`,
    zipped: false,
    credit: THOMAS,
    url: "https://doi.org/10.26033/ewy3-jy61",
  },
  pandora: {
    download: `${SATURN_SMALL_MOONS}pandora_30k_plt.tab.obj`,
    zipped: false,
    credit: THOMAS,
    url: "https://doi.org/10.26033/ewy3-jy61",
  },
  epimetheus: {
    download: `${SATURN_SMALL_MOONS}epimetheus_30k_plt.tab.obj`,
    zipped: false,
    credit: THOMAS,
    url: "https://doi.org/10.26033/ewy3-jy61",
  },
  janus: {
    download: `${SATURN_SMALL_MOONS}janus_30k_plt.tab.obj`,
    zipped: false,
    credit: THOMAS,
    url: "https://doi.org/10.26033/ewy3-jy61",
  },
  telesto: {
    download: `${SATURN_SMALL_MOONS}telesto_30k_plt.tab.obj`,
    zipped: false,
    credit: THOMAS,
    url: "https://doi.org/10.26033/ewy3-jy61",
  },
  calypso: {
    download: `${SATURN_SMALL_MOONS}calypso_30k_plt.tab.obj`,
    zipped: false,
    credit: THOMAS,
    url: "https://doi.org/10.26033/ewy3-jy61",
  },
  helene: {
    download: `${SATURN_SMALL_MOONS}helene_30k_plt.tab.obj`,
    zipped: false,
    credit: THOMAS,
    url: "https://doi.org/10.26033/ewy3-jy61",
  },
  phoebe: {
    download: "https://sbn.psi.edu/pds/shape-models/files/phoebe/phoebe_ver64q.tab.obj",
    zipped: false,
    credit: "R. W. Gaskell, Cassini, NASA PDS Small Bodies Node",
    url: "https://sbn.psi.edu/pds/shape-models/",
  },
};

/** What the app needs to unpack a radius grid: its largest radius in km, and the radius of equal volume. */
export interface ShapeGrid {
  maxRadiusKm: number;
  meanRadiusKm: number;
}

export function shapeGrid(slug: string): ShapeGrid | null {
  return (GRIDS as Record<string, ShapeGrid>)[slug] ?? null;
}
