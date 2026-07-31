import {
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  Database,
  Image as ImageIcon,
  Link2,
  Map as MapIcon,
  MousePointerClick,
  SlidersHorizontal,
  Construction,
} from "lucide-react";
import {
  QT_USE_CASES,
  type ParityStatus,
} from "./demos/qtUseCases";
import "./styles.css";

const STATUS_LABELS: Record<ParityStatus, string> = {
  available: "Parity verified",
  partial: "Port in progress",
  planned: "Representative only",
};

const DEMO_APPS = [
  {
    title: "CSV data lab",
    description:
      "Millions of points and ellipses, timeline, virtual table, measurement, and layer controls.",
    href: "/csv.html",
    icon: Database,
  },
  {
    title: "Vector geometry",
    description:
      "Styled geometry, packaged boundaries, selection, recoloring, movement, and editing.",
    href: "/vector.html",
    icon: MapIcon,
  },
  {
    title: "Raster processing",
    description:
      "Georeferenced image overlays, polygon masks, debounce, and hard worker cancellation.",
    href: "/raster.html",
    icon: ImageIcon,
  },
  {
    title: "Numeric and time filtering",
    description:
      "Independent numeric and timestamp windows synchronized across a map and table.",
    href: "/filtering.html",
    icon: SlidersHorizontal,
  },
  {
    title: "Linked map and tables",
    description:
      "One-to-many spatial linking and metadata-only child records with shared selection.",
    href: "/linked-tables.html",
    icon: Link2,
  },
  {
    title: "Map events",
    description:
      "Right-click actions plus held-key and modifier-aware map click bindings.",
    href: "/events.html",
    icon: MousePointerClick,
  },
  {
    title: "Viewshed / LOS",
    description:
      "Application for computing a viewshed/LOS to see if your terrian is blocking your transmitter or receiver",
    href: "/viewshed.html",
    icon: MousePointerClick,
  },
] as const;

function StatusIcon({status}: {status: ParityStatus}) {
  if (status === "available") return <CheckCircle2 size={16} />;
  if (status === "partial") return <Construction size={16} />;
  return <CircleDashed size={16} />;
}

export function UseCasesApp() {
  return (
    <main className="catalog-page theme-dark">
      <header className="catalog-header">
        <div>
          <span className="eyebrow">LEYSIGHT</span>
          <h1>Browser geospatial examples</h1>
          <p>
            Launch each workflow independently. The CSV data lab is one
            example—not the application shell—and every numbered reference
            workflow below links to a browser implementation.
          </p>
        </div>
      </header>
      <section className="app-launch-grid" aria-label="Example applications">
        {DEMO_APPS.map((app) => {
          const Icon = app.icon;
          const useCaseCount = QT_USE_CASES.filter(
            (useCase) => useCase.href.split("?")[0] === app.href,
          ).length;
          return (
            <a className="app-launch-card" href={app.href} key={app.href}>
              <Icon size={21} />
              <div>
                <h2>{app.title}</h2>
                <p>{app.description}</p>
                <small>{useCaseCount} reference workflows</small>
              </div>
              <ArrowRight size={17} />
            </a>
          );
        })}
      </section>
      <div className="catalog-section-heading">
        <span className="eyebrow">SOURCE PARITY INDEX</span>
        <h2>Reference use cases 01–22</h2>
      </div>
      <section className="catalog-grid">
        {QT_USE_CASES.map((useCase) => (
          <article className={`use-case-card status-${useCase.status}`} key={useCase.id}>
            <div className="use-case-heading">
              <span className="use-case-number">
                {String(useCase.id).padStart(2, "0")}
              </span>
              <span className="status-badge">
                <StatusIcon status={useCase.status} />
                {STATUS_LABELS[useCase.status]}
              </span>
            </div>
            <h2>{useCase.example}</h2>
            <p>{useCase.capability}</p>
            <dl>
              <div>
                <dt>Web surface</dt>
                <dd>{useCase.webSurface}</dd>
              </div>
              {useCase.remaining && (
                <div>
                  <dt>Remaining</dt>
                  <dd>{useCase.remaining}</dd>
                </div>
              )}
            </dl>
            <a className="use-case-launch" href={useCase.href}>
              Open example <ArrowRight size={13} />
            </a>
          </article>
        ))}
      </section>
    </main>
  );
}
