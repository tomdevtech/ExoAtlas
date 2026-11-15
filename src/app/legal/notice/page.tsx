import type { Metadata } from "next";
import { LegalPage, LegalSection, OperatorAddress, OperatorContact } from "../LegalPage";
import { getOperator } from "../operator";

const CC_BY = "https://creativecommons.org/licenses/by/4.0/";

export const metadata: Metadata = {
  title: "Legal notice",
  description: "Who runs this website and how to reach them.",
  // A private address does not belong into search results.
  robots: { index: false },
};

/** The legal notice ("Impressum") that German law asks of a website: who runs it and how to reach them. */
export default function LegalNoticePage() {
  const { operator, missing } = getOperator();

  return (
    <LegalPage title="Legal notice" subtitle="Impressum" missing={missing}>
      <LegalSection title="Who runs this website">
        <p className="text-sm text-muted">Information according to § 5 DDG and § 18 (1) MStV</p>
        <OperatorAddress operator={operator} />
      </LegalSection>

      {(operator.email !== "" || operator.phone !== null) && (
        <LegalSection title="Contact">
          <OperatorContact operator={operator} />
        </LegalSection>
      )}

      <LegalSection title="About this website">
        <p>
          ExoAtlas is a private project without advertising and without commercial purpose. Its
          source code is public under the MIT licence.
        </p>
      </LegalSection>

      <LegalSection title="Data and images">
        <p>
          The data about exoplanets comes from the{" "}
          <a href="https://exoplanetarchive.ipac.caltech.edu/">NASA Exoplanet Archive</a>, the data
          about the planets of the solar system from the{" "}
          <a href="https://nssdc.gsfc.nasa.gov/planetary/factsheet/">NASA Planetary Fact Sheets</a>.
          The values are copied automatically and are not checked by hand, so they can contain
          errors or be out of date. They are not meant for scientific work: use the archive itself
          for that.
        </p>
        <p>Images of exoplanets are illustrations computed from the data, not photographs.</p>
        <p>
          The maps of the planets of the solar system are by{" "}
          <a href="https://www.solarsystemscope.com/textures/">Solar System Scope</a>, based on
          NASA imagery. The panorama of the sky is “The Milky Way panorama” by{" "}
          <a href="https://www.eso.org/public/images/eso0932a/">ESO/S. Brunier</a>. Both are
          licensed under <a href={CC_BY}>CC BY 4.0</a>. They were scaled down and compressed for
          this website; the map of Venus shows the cloud tops, not the surface.
        </p>
      </LegalSection>

      <LegalSection title="Links to other websites">
        <p>
          This website links to websites of others. Their operators alone are responsible for what
          is shown there. The linked pages were free of visibly unlawful content when the links
          were set. Should one of them have changed, a note by e-mail is enough and the link is
          removed.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
