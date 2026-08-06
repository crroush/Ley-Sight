export function SelectionSummary({
  selected,
  total,
  label = 'rows',
}: {
  selected: number;
  total: number;
  label?: string;
}) {
  return (
    <p>
      {selected.toLocaleString()} selected / {total.toLocaleString()} {label}
    </p>
  );
}
