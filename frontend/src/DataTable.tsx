import type { CSSProperties, KeyboardEvent, ReactNode } from "react";

export type DataTableColumn<Row> = {
  id: string;
  label: string;
  shortLabel?: string;
  numeric?: boolean;
  className?: string;
  width?: string;
  render: (row: Row, index: number) => ReactNode;
  sort?: {
    active: boolean;
    direction: "asc" | "desc";
    onSort: () => void;
  };
};

export type DataTableFilter = {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
};

export type DataTableProps<Row> = {
  rows: Row[];
  columns: DataTableColumn<Row>[];
  getRowKey: (row: Row) => string;
  search?: {
    value: string;
    placeholder: string;
    onChange: (value: string) => void;
  };
  filters?: DataTableFilter[];
  countLabel?: string;
  emptyMessage: string;
  loading?: boolean;
  minWidth?: string;
  maxVisibleRows?: number;
  variant?: "default" | "compact";
  ariaLabel?: string;
  onRowClick?: (row: Row) => void;
};

export function DataTable<Row>({
  rows,
  columns,
  getRowKey,
  search,
  filters = [],
  countLabel,
  emptyMessage,
  loading = false,
  minWidth = "900px",
  maxVisibleRows,
  variant = "default",
  ariaLabel,
  onRowClick,
}: DataTableProps<Row>) {
  const hasToolbar = Boolean(search || filters.length || countLabel);

  function activateRow(event: KeyboardEvent<HTMLTableRowElement>, row: Row) {
    if (!onRowClick || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onRowClick(row);
  }

  return (
    <section className={`data-table data-table--${variant} ${loading ? "is-loading" : ""}`} aria-label={ariaLabel} aria-busy={loading}>
      {hasToolbar && <div className="data-table-toolbar">
        {search && <label className="data-table-search">
          <span className="data-table-search-icon" aria-hidden="true" />
          <span className="visually-hidden">Suche</span>
          <input value={search.value} onChange={(event) => search.onChange(event.target.value)} placeholder={search.placeholder} />
        </label>}
        {filters.map((filter) => <label className="data-table-filter" key={filter.id}>
          <span className="visually-hidden">{filter.label}</span>
          <select aria-label={filter.label} value={filter.value} onChange={(event) => filter.onChange(event.target.value)}>
            {filter.options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
          </select>
        </label>)}
        {countLabel && <span className="data-table-count">{countLabel}</span>}
      </div>}
      <div
        className={`data-table-scroll ${maxVisibleRows ? "is-bounded" : ""}`}
        style={maxVisibleRows ? {
          "--data-table-max-height": `${56 + maxVisibleRows * 82}px`,
          "--data-table-max-height-mobile": `${46 + maxVisibleRows * 68}px`,
        } as CSSProperties : undefined}
      >
        <table style={{ minWidth } as CSSProperties}>
          <colgroup>{columns.map((column) => <col key={column.id} style={column.width ? { width: column.width } : undefined} />)}</colgroup>
          <thead><tr>{columns.map((column) => <th key={column.id} className={column.numeric ? "num" : undefined} aria-sort={column.sort?.active ? (column.sort.direction === "asc" ? "ascending" : "descending") : undefined}>
            {column.sort ? <button className="data-table-sort" onClick={column.sort.onSort}><ColumnLabel label={column.label} shortLabel={column.shortLabel} /><span aria-hidden="true">{column.sort.active ? column.sort.direction === "asc" ? "↑" : "↓" : "↕"}</span></button> : <ColumnLabel label={column.label} shortLabel={column.shortLabel} />}
          </th>)}</tr></thead>
          <tbody>
            {rows.map((row, index) => <tr
              key={getRowKey(row)}
              className={onRowClick ? "data-table-clickable-row" : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (event) => activateRow(event, row) : undefined}
            >{columns.map((column) => <td key={column.id} className={[column.numeric ? "num" : "", column.className ?? ""].filter(Boolean).join(" ")}>{column.render(row, index)}</td>)}</tr>)}
          </tbody>
        </table>
        {!loading && !rows.length && <div className="data-table-empty">{emptyMessage}</div>}
      </div>
    </section>
  );
}

function ColumnLabel({ label, shortLabel }: { label: string; shortLabel?: string }) {
  return <><span className={`data-table-column-label-long ${shortLabel ? "has-short" : ""}`}>{label}</span>{shortLabel && <span className="data-table-column-label-short">{shortLabel}</span>}</>;
}
