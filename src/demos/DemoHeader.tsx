import {ArrowLeft, Home} from "lucide-react";

type DemoHeaderProps = {
  title: string;
  description: string;
  useCases: number[];
};

export function DemoHeader({
  title,
  description,
  useCases,
}: DemoHeaderProps) {
  return (
    <header className="demo-header">
      <a className="demo-home-link" href="/">
        <Home size={16} />
        <ArrowLeft size={13} />
        All examples
      </a>
      <div className="demo-title">
        <span className="eyebrow">LEYSIGHT EXAMPLE</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="demo-use-cases" aria-label="Covered reference examples">
        {useCases.map((id) => (
          <span key={id}>REF {String(id).padStart(2, "0")}</span>
        ))}
      </div>
    </header>
  );
}
