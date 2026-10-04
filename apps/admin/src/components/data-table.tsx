import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
} from "@tanstack/react-table";
import type { ReactNode } from "react";

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns,
});
const helper = createColumnHelper<typeof features, RowData>();

export type DataTableColumn<TData extends RowData> = ColumnDef<
  typeof features,
  TData
>;

/**
 * One sortable column. `sortValue` is what the column sorts by; `cell` is what
 * it displays, defaulting to the sort value.
 */
export function dataColumn<TData extends RowData>(config: {
  id: string;
  header: string;
  sortValue: (row: TData) => string | number;
  cell?: (row: TData) => ReactNode;
}): DataTableColumn<TData> {
  const { id, header, sortValue, cell } = config;
  return helper.accessor((row) => sortValue(row as TData), {
    id,
    header,
    cell: (context) =>
      cell
        ? cell(context.row.original as TData)
        : String(sortValue(context.row.original as TData)),
  }) as unknown as DataTableColumn<TData>;
}

const sortLabels = { asc: "ascending", desc: "descending" } as const;
const sortGlyphs = { asc: "↑", desc: "↓" } as const;

/**
 * Sorting applies to the rows on the current page only: the API pages by
 * creation time, so a sort cannot reach across pages.
 */
export function DataTable<TData extends RowData>({
  columns,
  data,
  getRowId,
  label,
}: {
  columns: DataTableColumn<TData>[];
  data: TData[];
  getRowId: (row: TData) => string;
  label: string;
}): ReactNode {
  const table = useTable({ features, columns, data, getRowId });

  return (
    <div className="data-table-wrap">
      <table className="data-table" aria-label={label}>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={
                      sorted
                        ? (`${sortLabels[sorted]}` as
                            | "ascending"
                            | "descending")
                        : "none"
                    }
                  >
                    <button
                      className="data-table__sort"
                      onClick={header.column.getToggleSortingHandler()}
                      type="button"
                    >
                      <table.FlexRender header={header} />
                      <span aria-hidden="true" className="data-table__glyph">
                        {sorted ? sortGlyphs[sorted] : "↕"}
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
                <td key={cell.id}>
                  <table.FlexRender cell={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
