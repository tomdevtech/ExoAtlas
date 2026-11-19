import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { Suspense } from "react";
import { PlanetCard } from "@/app/planets/PlanetCard";
import { SUN_BODIES } from "@/app/solar-system/bodies";
import { BodyCard } from "@/app/solar-system/BodyCard";
import { getPlanetsOfStar } from "@/app/planets/queries";
import { formatNumber, parsecToLightYears } from "@/shared/format";
import { Fact, Facts, PageSkeleton, Section } from "@/shared/ui";
import { findStarSlugByAlias, getStar, getStarFormerNames } from "../queries";
import { StarImage } from "../StarImage";

type Props = PageProps<"/stars/[slug]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const star = await getStar(slug);
  if (!star) return { title: "Star not found" };
  return {
    title: star.name,
    description: `${star.name} and its ${star.planetCount === 1 ? "known planet" : `${star.planetCount} known planets`}.`,
  };
}

export default function StarPage({ params }: Props) {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <Suspense fallback={<PageSkeleton />}>
        <StarContent params={params} />
      </Suspense>
    </main>
  );
}

async function StarContent({ params }: { params: Props["params"] }) {
  const { slug } = await params;
  const star = await getStar(slug);
  if (!star) {
    // The star may have been renamed, so old URLs redirect to the new page.
    const currentSlug = await findStarSlugByAlias(slug);
    if (currentSlug) permanentRedirect(`/stars/${currentSlug}`);
    notFound();
  }

  const [planets, formerNames] = await Promise.all([
    getPlanetsOfStar(star.id),
    getStarFormerNames(star.id),
  ]);
  const active = planets.filter((planet) => planet.status === "active");
  const removed = planets.filter((planet) => planet.status === "removed");
  const isSun = star.source === "sol";
  const identifiers = [star.hd, star.hip, star.gaiaId].filter((value) => value !== null);

  return (
    <article className="flex flex-col gap-12">
      <header className="flex flex-col items-center gap-8 sm:flex-row">
        <StarImage teffK={star.teffK} size={160} className="shrink-0" />
        <div className="flex flex-col gap-3">
          <h1 className="text-4xl font-semibold tracking-tight">{star.name}</h1>
          <p className="text-lg text-muted">
            {isSun
              ? "Our own star"
              : star.distPc !== null
                ? `Star ${formatNumber(parsecToLightYears(star.distPc))} light-years from the Sun`
                : "Star at an unknown distance"}
            {" with "}
            {active.length === 1 ? "one known planet" : `${active.length} known planets`}
          </p>
          {formerNames.length > 0 && (
            <p className="text-sm text-muted">Formerly listed as {formerNames.join(", ")}.</p>
          )}
          <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {active.length > 0 && (
              <Link
                href={`/map?system=${star.slug}`}
                className="text-accent underline-offset-4 underline decoration-current/40 hover:decoration-current"
              >
                View the system in 3D
              </Link>
            )}
            {star.x !== null && (
              <Link
                href={`/map?star=${star.slug}`}
                className="text-accent underline-offset-4 underline decoration-current/40 hover:decoration-current"
              >
                {isSun ? "Open the map of the Milky Way" : "Find it on the map"}
              </Link>
            )}
          </p>
          {!isSun && star.x === null && (
            <p className="text-sm text-muted">
              Without a distance this star cannot be placed on the map.
            </p>
          )}
        </div>
      </header>

      <Section title={active.length === 1 ? "Planet" : "Planets"}>
        {active.length > 0 ? (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {active.map((planet) => (
              <li key={planet.slug}>
                <PlanetCard planet={planet} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">NASA currently lists no confirmed planet for this star.</p>
        )}
        {removed.length > 0 && (
          <>
            <h3 className="mt-2 text-sm text-muted">No longer listed by NASA</h3>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {removed.map((planet) => (
                <li key={planet.slug}>
                  <PlanetCard planet={planet} />
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      {isSun && (
        <Section title="Dwarf planets and Vesta">
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {SUN_BODIES.map((body) => (
              <li key={body.slug}>
                <BodyCard body={body} showParent />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Star">
        <Facts>
          <Fact label="Spectral type" value={star.spectralType} />
          <Fact
            label="Temperature"
            value={star.teffK !== null ? `${formatNumber(star.teffK)} K` : null}
          />
          <Fact
            label="Radius"
            value={star.radiusSun !== null ? `${formatNumber(star.radiusSun)} × Sun` : null}
          />
          <Fact
            label="Mass"
            value={star.massSun !== null ? `${formatNumber(star.massSun)} × Sun` : null}
          />
          <Fact
            label="Brightness seen from Earth"
            value={star.vmag !== null ? `${formatNumber(star.vmag)} mag` : null}
          />
          {!isSun && (
            <Fact
              label="Distance"
              value={
                star.distPc !== null
                  ? `${formatNumber(parsecToLightYears(star.distPc))} ly (${formatNumber(star.distPc)} pc)`
                  : null
              }
            />
          )}
        </Facts>
        <p className="text-sm leading-6 text-muted">
          Brightness is given in magnitudes: the smaller the number, the brighter the star. The
          faintest stars visible to the naked eye are around 6 mag.
        </p>
      </Section>

      {!isSun && (
        <Section title="Position">
          <Facts>
            <Fact
              label="Right ascension"
              value={star.ra !== null ? `${star.ra.toFixed(4)}°` : null}
            />
            <Fact
              label="Declination"
              value={star.dec !== null ? `${star.dec.toFixed(4)}°` : null}
            />
            <Fact
              label="Catalogue names"
              value={identifiers.length > 0 ? identifiers.join(", ") : null}
            />
          </Facts>
        </Section>
      )}
    </article>
  );
}
