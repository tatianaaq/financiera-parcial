export function SkeletonRows({ columns, rows = 3 }: { columns: number; rows?: number }) {
  return Array.from({ length: rows }, (_, row) => (
    <tr key={row} className="skeleton-row" aria-hidden="true">
      {Array.from({ length: columns }, (_, column) => (
        <td key={column}><span className={`skeleton-line skeleton-line-${column % 3}`} /></td>
      ))}
    </tr>
  ));
}
