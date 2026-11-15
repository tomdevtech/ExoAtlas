export const CALCULATED =
  "<a refstr=CALCULATED_VALUE href=/docs/pscp_calc.html target=_blank>Calculated Value</a>";
export const PAPER = "<a refstr=X href=https://example.org target=ref>Sample et al. 2020</a>";

/** A row as NASA delivers it. Single values can be overridden. */
export function nasaRow(overrides: Record<string, unknown> = {}) {
  return {
    pl_name: "Test b",
    hostname: "Test",
    discoverymethod: "Transit",
    disc_year: 2020,
    disc_facility: "Kepler",
    pl_orbper: 10,
    pl_orbsmax: 0.1,
    pl_orbeccen: 0,
    pl_rade: 1.1,
    pl_rade_reflink: PAPER,
    pl_bmasse: 1.3,
    pl_bmasse_reflink: PAPER,
    pl_bmassprov: "Mass",
    pl_dens: 5.4,
    pl_dens_reflink: PAPER,
    pl_eqt: 300,
    pl_eqt_reflink: PAPER,
    pl_insol: 1.2,
    pl_insol_reflink: PAPER,
    st_teff: 5000,
    st_rad: 0.9,
    st_mass: 0.9,
    st_spectype: "K1 V",
    ra: 100,
    dec: 20,
    sy_dist: 50,
    sy_vmag: 9,
    hip_name: null,
    hd_name: null,
    gaia_dr3_id: "Gaia DR3 1",
    gaia_dr2_id: "Gaia DR2 1",
    ...overrides,
  };
}
