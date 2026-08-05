export function StatusBar({ items }: { items: readonly string[] }) {
  return (
    <footer className="reference-status-bar">
      {items.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </footer>
  )
}
