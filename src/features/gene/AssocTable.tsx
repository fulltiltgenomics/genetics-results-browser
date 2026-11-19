import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCredibleSetMembers } from "@/store/serverQuery";
import { isCoding } from "@/utils/coding";
import { DownloadButton } from "../table/ExportToolbar";
import {
  cleanConsequence,
  datasetDisplayName,
  PSEUDO_CS_TOOLTIP,
  pValRepr,
} from "../table/utils/tableutil";
import { AssocRow, sortRows, SortValue } from "./geneAssociation";
import { TRAIT_TYPE_BADGE } from "./traitTypeFilter";

/**
 * The credible sets of the variant association tab, one row each, opening to the set's members.
 *
 * Virtualized: the table can hold every GWAS credible set of a locus, in the
 * thousands, and only the rows in the scroll window exist as elements. Cells are plain text with
 * a `title` where they can be cut short.
 */

const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 32;

const precision3 = (v: number | null | undefined): string =>
  v == null || Number.isNaN(v) ? "" : v.toPrecision(3);

/**
 * A column, read straight off the row. A row's cells are built as DOM nodes rather than React elements: measured on a fast scroll, element
 * creation for the rows entering the window was over half of the script time in a development
 * build, and a cell here is never updated after it is made.
 */
interface Column {
  id: string;
  header: string;
  // CSS grid track
  width: string;
  numeric?: boolean;
  // what the column sorts by, and what the cell shows unless `text` or `build` says otherwise;
  // undefined sorts last in either direction
  value: (r: AssocRow) => SortValue;
  text?: (r: AssocRow) => string;
  // fills the cell itself, for the few that are more than text
  build?: (r: AssocRow, cell: HTMLElement) => void;
  sortDescFirst?: boolean;
}

const span = (text: string, className?: string, title?: string): HTMLSpanElement => {
  const el = document.createElement("span");
  el.textContent = text;
  if (className) {
    el.className = className;
  }
  if (title) {
    el.title = title;
  }
  return el;
};

const COLUMNS: Column[] = [
  {
    id: "type",
    header: "type",
    width: "44px",
    value: (r) => r.traitType,
    build: (r, cell) => {
      if (r.traitType !== "") {
        const badge = span(TRAIT_TYPE_BADGE[r.traitType].label, "badge", r.traitType);
        badge.style.background = TRAIT_TYPE_BADGE[r.traitType].color;
        cell.append(badge);
      }
    },
  },
  {
    id: "dataset",
    header: "dataset",
    width: "minmax(110px, 1.1fr)",
    value: (r) => datasetDisplayName(r.dataset),
  },
  { id: "traitName", header: "trait", width: "minmax(160px, 2.6fr)", value: (r) => r.traitName },
  {
    id: "kind",
    header: "credible set",
    width: "84px",
    value: (r) => (r.pseudo ? "pseudo" : "SuSiE"),
    build: (r, cell) =>
      cell.append(r.pseudo ? span("pseudo", "muted", PSEUDO_CS_TOOLTIP) : "SuSiE"),
  },
  {
    id: "variant",
    header: "lead variant",
    width: "minmax(130px, 1.3fr)",
    // by position, which the id's text order only approximates
    value: (r) => r.leadPos,
    build: (r, cell) => {
      cell.append(r.leadVariant);
      cell.title = r.leadVariant;
      if (r.nMembersLoaded < r.csSize) {
        cell.append(" ", span("†", "muted"));
        cell.title = `${r.leadVariant} — the strongest of the ${r.nMembersLoaded} of ${r.csSize} variants inside the loaded region; open the row for the whole set`;
      }
    },
  },
  {
    id: "consequence",
    header: "consequence",
    width: "minmax(90px, 1fr)",
    value: (r) => (r.leadConsequence ? cleanConsequence(r.leadConsequence) : ""),
  },
  {
    id: "pip",
    header: "PIP",
    width: "58px",
    numeric: true,
    sortDescFirst: true,
    value: (r) => r.leadPip,
    text: (r) => precision3(r.leadPip),
  },
  {
    // sorted on -log10(p): p underflows to 0 and would tie the strongest associations
    id: "mlog10p",
    header: "p-value",
    width: "76px",
    numeric: true,
    sortDescFirst: true,
    value: (r) => r.leadMlog10p ?? undefined,
    text: (r) => (r.leadMlog10p == null ? "" : pValRepr(r.leadMlog10p)),
  },
  {
    // by magnitude, so strong effects of either sign come first
    id: "beta",
    header: "beta",
    width: "78px",
    numeric: true,
    sortDescFirst: true,
    value: (r) => (r.leadBeta == null ? undefined : Math.abs(r.leadBeta)),
    build: (r, cell) => {
      if (r.leadBeta != null) {
        if (r.leadBeta !== 0) {
          cell.append(r.leadBeta > 0 ? span("↑", "up") : span("↓", "down"));
        }
        cell.append(r.leadBeta.toPrecision(3));
      }
    },
  },
  { id: "csSize", header: "variants", width: "66px", numeric: true, value: (r) => r.csSize },
  {
    id: "nCoding",
    header: "coding",
    width: "58px",
    numeric: true,
    sortDescFirst: true,
    value: (r) => r.nCoding,
    text: (r) => (r.nCoding ? String(r.nCoding) : ""),
  },
  {
    id: "codingPip",
    header: "coding PIP",
    width: "82px",
    numeric: true,
    sortDescFirst: true,
    value: (r) => r.codingPip ?? undefined,
    text: (r) => precision3(r.codingPip),
  },
];

const fillRow = (el: HTMLElement, r: AssocRow) => {
  const toggle = span("", "toggle");
  toggle.setAttribute("role", "cell");
  toggle.setAttribute("aria-hidden", "true");
  const cells = COLUMNS.map((c) => {
    const cell = document.createElement("span");
    cell.setAttribute("role", "cell");
    if (c.numeric) {
      cell.className = "num";
    }
    if (c.build) {
      c.build(r, cell);
    } else {
      const value = c.text ? c.text(r) : c.value(r);
      cell.textContent = value == null ? "" : String(value);
      // a text column can be cut short by its width
      if (typeof value === "string" && !c.numeric) {
        cell.title = value;
      }
    }
    return cell;
  });
  el.replaceChildren(toggle, ...cells);
};

interface Sort {
  id: string;
  desc: boolean;
}

const HEADER_TITLES: Record<string, string> = {
  variant:
    "the variant with the highest PIP in the credible set, and what the next four columns describe",
  csSize: "number of variants in the credible set",
  nCoding: "coding variants of this gene in the credible set at or above the PIP threshold",
  codingPip: "the highest PIP among those coding variants",
};

const GRID = `24px ${COLUMNS.map((c) => c.width).join(" ")}`;

// the gene's coding evidence first, then everything else by its lead variant
const DEFAULT_SORTING: Sort[] = [
  { id: "codingPip", desc: true },
  { id: "pip", desc: true },
];

const SetMembers = ({
  row,
  csId,
  gene,
}: {
  row: AssocRow;
  csId: string | undefined;
  gene: string;
}) => {
  const members = useCredibleSetMembers(row.resource, row.traitCode, csId);
  const sorted = useMemo(() => {
    // the API can serve a variant of a set twice
    const seen = new Set<string>();
    return (members.data ?? [])
      .filter((m) => {
        const id = `${m.pos}:${m.ref}:${m.alt}`;
        return seen.has(id) ? false : (seen.add(id), true);
      })
      .sort((a, b) => b.pip - a.pip);
  }, [members.data]);
  return (
    <div className="members" data-testid="assoc-members" onClick={(e) => e.stopPropagation()}>
      {members.isError ? (
        <span className="error">failed to load the variants: {members.error.message}</span>
      ) : !members.data ? (
        <span className="muted">loading {row.csSize} variants…</span>
      ) : (
        <table>
          <thead>
            <tr>
              <th>variant</th>
              <th>consequence</th>
              <th>gene</th>
              <th className="num">PIP</th>
              <th className="num">p-value</th>
              <th className="num">beta</th>
              <th className="num">se</th>
              <th className="num">AF</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((m) => (
              <tr
                key={`${m.pos}:${m.ref}:${m.alt}`}
                className={
                  m.gene_most_severe === gene && m.most_severe && isCoding(m.most_severe)
                    ? "coding"
                    : undefined
                }>
                <td>
                  {m.chr}:{m.pos}:{m.ref}:{m.alt}
                </td>
                <td>{m.most_severe ? cleanConsequence(m.most_severe) : ""}</td>
                <td>{m.gene_most_severe ?? ""}</td>
                <td className="num">{precision3(m.pip)}</td>
                <td className="num">{m.mlog10p == null ? "" : pValRepr(m.mlog10p)}</td>
                <td className="num">{precision3(m.beta)}</td>
                <td className="num">{precision3(m.se)}</td>
                <td className="num">{precision3(m.aaf)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

// memoized on the row, its place and its open state, so a scroll renders only the rows entering
// the window: for the others React compares its props and creates nothing
const TableRow = memo(
  ({
    row,
    index,
    start,
    open,
    csId,
    gene,
    measure,
    onToggle,
    onHover,
  }: {
    row: AssocRow;
    index: number;
    start: number;
    open: boolean;
    csId: string | undefined;
    gene: string;
    measure: (el: HTMLElement | null) => void;
    onToggle: (key: string) => void;
    onHover: (set: number | null) => void;
  }) => {
    const cells = useRef<HTMLDivElement>(null);
    // React renders the row without children and so never touches these
    useLayoutEffect(() => fillRow(cells.current!, row), [row]);
    return (
      <div
        className="item"
        data-index={index}
        // a closed row has the estimated height exactly; only an open one needs measuring
        ref={open ? measure : undefined}
        style={{ transform: `translateY(${start}px)` }}>
        <div
          ref={cells}
          role="row"
          className="row"
          data-testid="assoc-row"
          aria-expanded={open}
          onClick={() => onToggle(row.key)}
          onMouseEnter={() => onHover(row.set)}
        />
        {open && <SetMembers row={row} csId={csId} gene={gene} />}
      </div>
    );
  }
);
TableRow.displayName = "TableRow";

const TableHeader = memo(
  ({ sorting, onSort }: { sorting: Sort[]; onSort: (id: string) => void }) => (
    <div role="row" className="header">
      <span role="columnheader" />
      {COLUMNS.map((c) => {
        const sort = sorting.find((s) => s.id === c.id);
        return (
          <span
            key={c.id}
            role="columnheader"
            className={c.numeric ? "num" : undefined}
            title={HEADER_TITLES[c.id]}
            aria-sort={sort ? (sort.desc ? "descending" : "ascending") : "none"}
            onClick={() => onSort(c.id)}>
            {c.header}
            <span className="sort">{sort ? (sort.desc ? "▼" : "▲") : ""}</span>
          </span>
        );
      })}
    </div>
  )
);
TableHeader.displayName = "TableHeader";

/**
 * The rows in the scroll window. The virtualizer's state lives here and nowhere above, so a
 * scroll renders this component alone: not the styled container, not the header, not the footer.
 */
const VirtualRows = ({
  rows,
  scroller,
  open,
  csIds,
  gene,
  onToggle,
  onHover,
}: {
  rows: AssocRow[];
  scroller: HTMLDivElement;
  open: ReadonlySet<string>;
  csIds: string[] | undefined;
  gene: string;
  onToggle: (key: string) => void;
  onHover: (set: number | null) => void;
}) => {
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (i) => rows[i].key,
    // the header is inside the scroll element, above the rows
    scrollMargin: HEADER_HEIGHT,
    overscan: 10,
  });
  return (
    <div role="rowgroup" style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
      {virtualizer.getVirtualItems().map((item) => {
        const row = rows[item.index];
        return (
          <TableRow
            key={row.key}
            row={row}
            index={item.index}
            start={item.start - HEADER_HEIGHT}
            open={open.has(row.key)}
            csId={csIds?.[row.set]}
            gene={gene}
            measure={virtualizer.measureElement}
            onToggle={onToggle}
            onHover={onHover}
          />
        );
      })}
    </div>
  );
};

const TableFooter = memo(
  ({ count, ready, onDownload }: { count: number; ready: boolean; onDownload: () => void }) => (
    <div className="footer">
      <DownloadButton
        variant="outlined"
        label="DOWNLOAD TABLE"
        disabled={!ready}
        onClick={onDownload}
      />
      <Typography variant="body2" color="text.secondary" data-testid="assoc-row-count">
        {count.toLocaleString()} credible set{count === 1 ? "" : "s"}
      </Typography>
    </div>
  )
);
TableFooter.displayName = "TableFooter";

// a styled element rather than `sx`: the table renders again on every filter change, and `sx`
// resolves its theme shorthands each time
const TableRoot = styled("div")(({ theme }) => {
  const line = `1px solid ${theme.palette.divider}`;
  return {
    fontSize: "0.75rem",
    "& .scroller": {
      // fills what the sticky tracks leave of the window, so the page keeps one scrollbar's
      // worth of travel and the table its own
      height: "max(320px, calc(100vh - 420px))",
      overflow: "auto",
      border: line,
      borderRadius: theme.shape.borderRadius,
      // the browser lays out and paints a row only against its own box
      "& .item": { position: "absolute", top: 0, left: 0, width: "100%", contain: "layout paint" },
    },
    "& .header, & .row": {
      display: "grid",
      gridTemplateColumns: GRID,
      alignItems: "center",
      columnGap: "10px",
      padding: theme.spacing(0, 1),
      minWidth: 980,
    },
    "& .header": {
      position: "sticky",
      top: 0,
      zIndex: 1,
      height: HEADER_HEIGHT,
      backgroundColor: theme.palette.background.paper,
      borderBottom: line,
      fontWeight: 600,
      "& > span": { cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" },
      "& .sort": {
        fontSize: "0.6rem",
        marginLeft: theme.spacing(0.5),
        color: theme.palette.text.secondary,
      },
    },
    "& .row": {
      height: ROW_HEIGHT,
      cursor: "pointer",
      borderBottom: line,
      "&:hover": { backgroundColor: theme.palette.action.hover },
      "& > span": {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        minWidth: 0,
      },
      "& .toggle": { color: theme.palette.text.secondary },
      "& .toggle::before": { content: '"▸"' },
      "&[aria-expanded=true] .toggle::before": { content: '"▾"' },
    },
    "& .num": { textAlign: "right", fontVariantNumeric: "tabular-nums" },
    "& .muted": { color: theme.palette.text.secondary },
    "& .error, & .up": { color: theme.palette.error.main },
    "& .down": { color: theme.palette.info.main },
    "& .badge": {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: 16,
      height: 16,
      borderRadius: "3px",
      color: "#fff",
      fontSize: "0.62rem",
      fontWeight: 700,
    },
    "& .members": {
      padding: theme.spacing(1, 4),
      maxHeight: 300,
      overflow: "auto",
      cursor: "default",
      backgroundColor: theme.palette.action.hover,
      borderBottom: line,
      "& table": { borderCollapse: "collapse" },
      "& th, & td": {
        textAlign: "left",
        padding: theme.spacing("2px", 2.5, "2px", 0),
        whiteSpace: "nowrap",
        fontWeight: 400,
      },
      "& th": { color: theme.palette.text.secondary },
      "& .num": { textAlign: "right" },
      "& tr.coding td": { fontWeight: 700 },
    },
    "& .footer": {
      display: "flex",
      alignItems: "center",
      gap: theme.spacing(2),
      paddingTop: theme.spacing(1),
    },
  };
});

const AssocTable = ({
  rows,
  gene,
  csIds,
  onHoverSet,
  onDownload,
}: {
  rows: AssocRow[];
  gene: string;
  // undefined until the ids have loaded
  csIds: string[] | undefined;
  onHoverSet: (set: number | null) => void;
  // the rows in the order shown
  onDownload: (rows: AssocRow[]) => void;
}) => {
  const [sorting, setSorting] = useState<Sort[]>(DEFAULT_SORTING);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  // state, not a ref: the rows are rendered once the element exists, and a ref would be attached
  // only after their first layout effect has looked for it
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);

  const sorted = useMemo(
    () =>
      sortRows(
        rows,
        sorting.map((s) => ({ value: COLUMNS.find((c) => c.id === s.id)!.value, desc: s.desc }))
      ),
    [rows, sorting]
  );

  const toggle = useCallback(
    (key: string) =>
      setOpen((current) => {
        const next = new Set(current);
        if (!next.delete(key)) {
          next.add(key);
        }
        return next;
      }),
    []
  );
  // a click sorts by that column alone, strongest first where the column says so, and a second
  // click turns it round
  const sort = useCallback(
    (id: string) =>
      setSorting((current) => [
        {
          id,
          desc:
            current.length === 1 && current[0].id === id
              ? !current[0].desc
              : (COLUMNS.find((c) => c.id === id)!.sortDescFirst ?? false),
        },
      ]),
    []
  );

  const download = useCallback(() => onDownload(sorted), [onDownload, sorted]);

  return (
    <TableRoot>
      <div
        ref={setScroller}
        className="scroller"
        role="table"
        aria-rowcount={sorted.length}
        data-testid="assoc-table"
        onMouseLeave={() => onHoverSet(null)}>
        <TableHeader sorting={sorting} onSort={sort} />
        {scroller && (
          <VirtualRows
            rows={sorted}
            scroller={scroller}
            open={open}
            csIds={csIds}
            gene={gene}
            onToggle={toggle}
            onHover={onHoverSet}
          />
        )}
      </div>
      <TableFooter count={sorted.length} ready={!!csIds} onDownload={download} />
    </TableRoot>
  );
};

export default AssocTable;
