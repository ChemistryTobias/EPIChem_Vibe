/**
 * The one table in the app: TanStack Table for sorting, plain markup and
 * design tokens for the look (hairline rules, no zebra striping, no shadows).
 *
 * Click a header to sort, click again to reverse. Table v9 is feature-based,
 * so sorting is opted into once here and every screen inherits it — screens
 * describe their columns with the `Columns<T>` alias and nothing else.
 */

import { useState } from "react";
import {
  createSortedRowModel,
  flexRender,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import type { ColumnDef, RowData, SortingState } from "@tanstack/react-table";

import "./DataTable.css";

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    text: sortFn_text,
  },
});

/** Column definitions for a `DataTable` over rows of type `T`. */
export type Columns<T extends RowData> = ColumnDef<typeof features, T, any>[];

interface DataTableProps<T extends RowData> {
  data: T[];
  columns: Columns<T>;
  empty?: string;
}

export function DataTable<T extends RowData>({
  data,
  columns,
  empty = "Nothing here yet.",
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useTable({
    features,
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
  });

  if (data.length === 0) return <p className="table-empty muted">{empty}</p>;

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                return (
                  <th key={header.id} className="label">
                    <button
                      type="button"
                      className="table__sort"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      <span className="table__sort-marker">
                        {sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : ""}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getAllCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
