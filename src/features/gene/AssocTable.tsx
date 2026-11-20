import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
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
import { RowGeometry, rowTop, rowWindow, totalHeight, windowSize } from "./rowWindow";
import { TRAIT_TYPE_BADGE } from "./traitTypeFilter";

/**
 * The credible sets of the variant association tab, one row each, opening to the set's members.
 *
 * Windowed: the table can hold every GWAS credible set of a locus, in the thousands, and only the
 * rows in the scroll window exist as elements. Cells are plain text with a `title` where they can
 * be cut short.
 */

const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 32;
// of an open row's members, which scroll inside it: fixed, so every row's place is arithmetic
const PANEL_HEIGHT = 240;
// rows kept in the document beyond either edge of the scroll window
const OVERSCAN = 8;
// how long after a scroll the pointer is taken to be resting rather than pointing
const HOVER_AFTER_SCROLL_MS = 150;
// below this the table scrolls sideways rather than squeeze its columns
const MIN_WIDTH = 980;

const precision3 = (v: number | null | undefined): string =>
  v == null || Number.isNaN(v) ? "" : v.toPrecision(3);

/**
 * A column, read straight off the row into a cell element.
 */
interface Column {
  id: string;
  header: string;
  // CSS grid track
  width: string;
  numeric?: boolean;
  // what the column sorts by, and what the cell shows unless `text` says otherwise; undefined
  // sorts last in either direction
  value: (r: AssocRow) => SortValue;
  text?: (r: AssocRow) => string;
  // styling that depends on the row; anything a cell shows beyond its text is CSS on these
  className?: (r: AssocRow) => string;
  // shown on hover; a text column's own text by default, since its width can cut it short
  title?: (r: AssocRow) => string;
  sortDescFirst?: boolean;
  // shown only while the table keeps the top trait only
  when?: "collapsed";
}

const COLUMNS: Column[] = [
  {
    id: "type",
    header: "type",
    width: "44px",
    value: (r) => r.traitType,
    text: (r) => (r.traitType === "" ? "" : TRAIT_TYPE_BADGE[r.traitType].label),
    className: (r) => (r.traitType === "" ? "" : `badge ${r.traitType}`),
  },
  {
    id: "dataset",
    header: "dataset",
    width: "minmax(110px, 1.1fr)",
    value: (r) => datasetDisplayName(r.dataset),
  },
  { id: "traitName", header: "trait", width: "minmax(160px, 2.6fr)", value: (r) => r.traitName },
  {
    id: "moreTraits",
    header: "more",
    width: "44px",
    when: "collapsed",
    sortDescFirst: true,
    value: (r) => r.moreTraits,
    text: (r) => (r.moreTraits > 0 ? `+${r.moreTraits}` : ""),
    className: () => "muted",
    title: (r) =>
      r.moreTraits > 0
        ? `${r.moreTraits} more credible set${r.moreTraits === 1 ? "" : "s"} of this dataset for the same variant, of other traits; untick "top trait only" to list them`
        : "",
  },
  {
    id: "kind",
    header: "credible set",
    width: "84px",
    value: (r) => (r.pseudo ? "pseudo" : "SuSiE"),
    className: (r) => (r.pseudo ? "muted" : ""),
    title: (r) => (r.pseudo ? PSEUDO_CS_TOOLTIP : ""),
  },
  {
    id: "csSize",
    header: "variants",
    width: "118px",
    sortDescFirst: true,
    value: (r) => r.csSize,
    // the coding count is of the variants inside the loaded region, so a floor for a set that
    // reaches beyond it
    text: (r) =>
      r.nMembersLoaded < r.csSize
        ? `${r.csSize} (≥${r.nCoding} coding)`
        : r.nCoding > 0
          ? `${r.csSize} (${r.nCoding} coding)`
          : String(r.csSize),
    title: (r) =>
      r.nMembersLoaded < r.csSize
        ? `${r.csSize} variants in the credible set; ${r.nMembersLoaded} of them are inside the loaded region, ${r.nCoding} of those coding`
        : `${r.csSize} variants in the credible set, ${r.nCoding} of them coding`,
  },
  {
    id: "selectedPip",
    header: "PIP of selected",
    width: "104px",
    numeric: true,
    sortDescFirst: true,
    value: (r) => r.selectedPip ?? undefined,
    text: (r) => precision3(r.selectedPip),
  },
  {
    id: "variant",
    header: "lead variant",
    width: "minmax(140px, 1.3fr)",
    // by position, which the id's text order only approximates
    value: (r) => r.leadPos,
    text: (r) =>
      r.leadSide < 0 ? `← ${r.leadVariant}` : r.leadSide > 0 ? `${r.leadVariant} →` : r.leadVariant,
    className: (r) => (r.leadSide === 0 ? "" : "muted"),
    title: (r) =>
      r.leadSide === 0
        ? r.leadVariant
        : `${r.leadVariant} lies to the ${r.leadSide < 0 ? "left" : "right"} of the current view`,
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
    id: "codingPip",
    header: "coding PIP",
    width: "126px",
    numeric: true,
    sortDescFirst: true,
    value: (r) => r.codingPip ?? undefined,
    // the gene is named where the coding variant is another gene's
    text: (r) =>
      r.codingOtherGene
        ? `${r.codingOtherGene} ${precision3(r.codingPip)}`
        : precision3(r.codingPip),
    className: (r) => (r.codingOtherGene ? "muted" : ""),
    title: (r) =>
      r.codingOtherGene ? `the strongest coding variant of the set is in ${r.codingOtherGene}` : "",
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
    text: (r) => precision3(r.leadBeta),
    className: (r) => (!r.leadBeta ? "" : r.leadBeta > 0 ? "up" : "down"),
  },
];

// a set of one variant has nothing to open
const opens = (r: AssocRow): boolean => r.csSize > 1;

const cellText = (c: Column, r: AssocRow): string => {
  const value = c.text ? c.text(r) : c.value(r);
  return value == null ? "" : String(value);
};

const cellTitle = (c: Column, r: AssocRow): string =>
  c.title ? c.title(r) : c.numeric ? "" : cellText(c, r);

/**
 * A row element of the pool, made once and rewritten for whichever row it shows: one text node
 * per cell, rewritten rather than replaced, and no attribute that changes from row to row.
 * Measured on a fast scroll, new nodes and changed attributes had the browser resolve styles for
 * longer than the script ran; a changed text node is only laid out.
 */
const createRowElement = (columns: Column[]): HTMLDivElement => {
  const el = document.createElement("div");
  el.className = "row";
  el.setAttribute("role", "row");
  el.dataset.testid = "assoc-row";
  const toggle = document.createElement("span");
  toggle.className = "toggle";
  toggle.setAttribute("role", "cell");
  toggle.setAttribute("aria-hidden", "true");
  el.append(toggle);
  for (let i = 0; i < columns.length; i++) {
    const cell = document.createElement("span");
    cell.setAttribute("role", "cell");
    cell.append("");
    el.append(cell);
  }
  return el;
};

// the element that carries a row's place. Not the row itself: measured, any change to the
// inline style of the grid has the browser resolve the style of every cell in it again, while
// one on a plain box around it costs that box alone
const createPlaceElement = (row: HTMLElement): HTMLDivElement => {
  const el = document.createElement("div");
  el.className = "place";
  el.append(row);
  return el;
};

const fillRow = (el: HTMLElement, r: AssocRow, columns: Column[]) => {
  if (el.classList.contains("single") === opens(r)) {
    el.classList.toggle("single", !opens(r));
  }
  columns.forEach((c, i) => {
    const cell = el.children[i + 1] as HTMLElement;
    (cell.firstChild as Text).data = cellText(c, r);
    const className = `${c.numeric ? "num" : ""} ${c.className?.(r) ?? ""}`.trim();
    if (cell.className !== className) {
      cell.className = className;
    }
  });
};

interface Sort {
  id: string;
  desc: boolean;
}

const HEADER_TITLES: Record<string, string> = {
  variant:
    "the variant with the highest PIP in the credible set; consequence, PIP, p-value and beta are its",
  csSize:
    "number of variants in the credible set, and how many of them are coding (LoF or other coding, in any gene)",
  codingPip:
    "the highest PIP among the credible set's coding variants, with the gene where it is not this one",
  selectedPip:
    "the PIP the selected variant has in the credible set; empty until a variant is clicked in the track",
  moreTraits: "credible sets of other traits this row stands for",
};

// the order the table opens in, and the one a table about one variant opens in
const DEFAULT_SORT: Sort = { id: "codingPip", desc: true };
const SELECTED_SORT: Sort = { id: "selectedPip", desc: true };
// rows that tie on the sorted column go by their lead variant, strongest first; with it the
// opening order is coding evidence first and everything else by its lead
const TIE_BREAK: Sort = { id: "pip", desc: true };
const columnOf = (id: string): Column => COLUMNS.find((c) => c.id === id)!;

const SetMembers = ({
  row,
  csId,
  top,
}: {
  row: AssocRow;
  csId: string | undefined;
  top: number;
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
  // the coding variants first, under their own heading, where the set has any
  const groups = useMemo(() => {
    const count = (n: number, kind: string) =>
      `${n.toLocaleString()} ${kind}variant${n === 1 ? "" : "s"} in this credible set`;
    const coding = sorted.filter((m) => m.most_severe && isCoding(m.most_severe));
    if (coding.length === 0) {
      return [{ label: count(sorted.length, ""), members: sorted }];
    }
    const rest = sorted.filter((m) => !coding.includes(m));
    return [
      { label: count(coding.length, "coding "), members: coding },
      { label: count(rest.length, "non-coding "), members: rest },
    ].filter((group) => group.members.length > 0);
  }, [sorted]);
  return (
    <div className="members" data-testid="assoc-members" style={{ top }}>
      {members.isError ? (
        <span className="error">failed to load the variants: {members.error.message}</span>
      ) : !members.data ? (
        <span className="muted">loading {row.csSize} variants…</span>
      ) : (
        <table>
          {groups.map((group, g) => (
            <tbody key={group.label}>
              <tr>
                <th colSpan={8} className="group">
                  {group.label}
                </th>
              </tr>
              {g === 0 && (
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
              )}
              {group.members.map((m) => (
                <tr key={`${m.pos}:${m.ref}:${m.alt}`}>
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
          ))}
        </table>
      )}
    </div>
  );
};

const TableHeader = memo(
  ({
    columns,
    sort,
    idle,
    onSort,
  }: {
    columns: Column[];
    sort: Sort;
    // a column that has nothing to show for now
    idle: string | null;
    onSort: (id: string) => void;
  }) => (
    <div role="row" className="header">
      <span role="columnheader" />
      {columns.map((c) => {
        const sorted = c.id === sort.id;
        return (
          <span
            key={c.id}
            role="columnheader"
            className={
              `${c.numeric ? "num" : ""} ${c.id === idle ? "idle" : ""}`.trim() || undefined
            }
            title={HEADER_TITLES[c.id]}
            aria-sort={sorted ? (sort.desc ? "descending" : "ascending") : "none"}
            onClick={() => onSort(c.id)}>
            {c.header}
            <span className="sort">{sorted ? (sort.desc ? "▼" : "▲") : ""}</span>
          </span>
        );
      })}
    </div>
  )
);
TableHeader.displayName = "TableHeader";

// one pooled element and what it currently shows
interface Slot {
  // the row, and the box around it that is moved
  el: HTMLDivElement;
  place: HTMLDivElement;
  row: AssocRow | null;
  index: number;
  // the cell given a title on hover, to take it off again when the element shows another row
  titled: HTMLElement | null;
  top: number;
  open: boolean;
  attached: boolean;
}

/**
 * The rows in the scroll window, kept outside React: a pool of row elements, as many as the
 * window holds, each rewritten in place for the row it shows next. Row i lives in element i modulo
 * the pool's size, so a scroll touches only the elements whose row changed and never adds or
 * removes one. Measured against rendering each row entering the window as a component, this took
 * the script time of a fast scroll down by most of its length in a development build.
 *
 * React renders the panels of the open rows, which are few, and nothing here on a scroll.
 */
const WindowedRows = ({
  rows,
  columns,
  scroller,
  open,
  csIds,
  onToggle,
  onHover,
}: {
  rows: AssocRow[];
  columns: Column[];
  scroller: HTMLDivElement;
  open: ReadonlySet<string>;
  csIds: string[] | undefined;
  onToggle: (key: string) => void;
  onHover: (set: number | null) => void;
}) => {
  const layer = useRef<HTMLDivElement>(null);
  const slots = useRef<Slot[]>([]);
  const slotColumns = useRef<Column[] | null>(null);
  const shownKeys = useRef<string[]>([]);
  const scrolledAt = useRef(0);
  const geometry = useMemo<RowGeometry>(() => {
    const indices: number[] = [];
    if (open.size > 0) {
      rows.forEach((r, i) => {
        if (open.has(r.key)) {
          indices.push(i);
        }
      });
    }
    return { rowHeight: ROW_HEIGHT, panelHeight: PANEL_HEIGHT, open: indices };
  }, [rows, open]);

  const place = useCallback(() => {
    const size = windowSize(scroller.clientHeight, ROW_HEIGHT, OVERSCAN);
    const pool = slots.current;
    if (pool.length !== size || slotColumns.current !== columns) {
      // the pool's size is the modulus: with another one every row moves to another element
      slotColumns.current = columns;
      pool.forEach((slot) => slot.place.remove());
      pool.length = 0;
      for (let i = 0; i < size; i++) {
        const el = createRowElement(columns);
        pool.push({
          el,
          place: createPlaceElement(el),
          row: null,
          index: -1,
          titled: null,
          top: -1,
          open: false,
          attached: false,
        });
      }
    }
    const [from, to] = rowWindow(
      scroller.scrollTop - HEADER_HEIGHT,
      rows.length,
      size,
      OVERSCAN,
      geometry
    );
    const used = new Set<Slot>();
    let nextOpen = 0;
    for (let i = from; i < to; i++) {
      const slot = pool[i % size];
      used.add(slot);
      const row = rows[i];
      if (slot.row !== row) {
        slot.row = row;
        fillRow(slot.el, row, columns);
        slot.titled?.removeAttribute("title");
        slot.titled = null;
      }
      slot.index = i;
      while (nextOpen < geometry.open.length && geometry.open[nextOpen] < i) {
        nextOpen++;
      }
      const isOpen = geometry.open[nextOpen] === i;
      if (slot.open !== isOpen || !slot.attached) {
        slot.open = isOpen;
        slot.el.setAttribute("aria-expanded", String(isOpen));
      }
      const top = rowTop(i, geometry);
      if (slot.top !== top) {
        slot.top = top;
        slot.place.style.transform = `translateY(${top}px)`;
      }
      if (!slot.attached) {
        slot.attached = true;
        layer.current!.append(slot.place);
      }
    }
    // only where the list is shorter than the pool
    for (const slot of pool) {
      if (slot.attached && !used.has(slot)) {
        slot.attached = false;
        slot.row = null;
        slot.place.remove();
      }
    }
  }, [scroller, rows, columns, geometry]);

  // other rows start from the top; the same rows told anew, as when the view moves under them,
  // and opening a row leave the scroll where it is
  useLayoutEffect(() => {
    const last = shownKeys.current;
    if (last.length !== rows.length || rows.some((r, i) => r.key !== last[i])) {
      scroller.scrollTop = 0;
    }
    shownKeys.current = rows.map((r) => r.key);
  }, [scroller, rows]);

  useLayoutEffect(() => {
    place();
    let frame = 0;
    const onScroll = () => {
      scrolledAt.current = performance.now();
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        place();
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [scroller, place]);

  // one listener each for all rows: the row elements are not React's
  const slotOf = (target: EventTarget): Slot | undefined => {
    const el = (target as HTMLElement).closest(".row");
    return el ? slots.current.find((slot) => slot.el === el) : undefined;
  };

  return (
    <div
      role="rowgroup"
      className="rows"
      style={{ height: totalHeight(rows.length, geometry) }}
      onClick={(e) => {
        const row = slotOf(e.target)?.row;
        if (row && opens(row)) {
          onToggle(row.key);
        }
      }}
      onMouseOver={(e) => {
        const slot = slotOf(e.target);
        // rows passing under a resting pointer are not being pointed at, and each would
        // otherwise repaint the tracks for its credible set
        if (!slot?.row || performance.now() - scrolledAt.current < HOVER_AFTER_SCROLL_MS) {
          return;
        }
        onHover(slot.row.set);
        // a title only where the pointer is: set on every cell, it would be an attribute to
        // change on every cell of every row a scroll brings in
        const cell = (e.target as HTMLElement).closest<HTMLElement>("[role=cell]");
        const column = cell && columns[Array.prototype.indexOf.call(slot.el.children, cell) - 1];
        if (cell && column && slot.titled !== cell) {
          slot.titled?.removeAttribute("title");
          cell.title = cellTitle(column, slot.row);
          slot.titled = cell;
        }
      }}>
      <div ref={layer} />
      {geometry.open.map((i) => (
        <SetMembers
          key={rows[i].key}
          row={rows[i]}
          csId={csIds?.[rows[i].set]}
          top={rowTop(i, geometry) + ROW_HEIGHT}
        />
      ))}
    </div>
  );
};

const TableFooter = memo(
  ({
    count,
    ready,
    sort,
    onReset,
    onDownload,
  }: {
    count: number;
    ready: boolean;
    sort: Sort;
    // undefined while the table is in the order it opens in
    onReset: (() => void) | undefined;
    onDownload: () => void;
  }) => (
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
      <Typography variant="body2" color="text.secondary" data-testid="assoc-sort">
        sorted by {columnOf(sort.id).header}
        {sort.id !== TIE_BREAK.id && `, then ${columnOf(TIE_BREAK.id).header}`}
        {onReset && (
          <>
            {" · "}
            <button type="button" className="reset" onClick={onReset}>
              reset
            </button>
          </>
        )}
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
      // opaque, which lets the browser scroll the rows as a layer instead of repainting them
      backgroundColor: theme.palette.background.default,
      border: line,
      borderRadius: theme.shape.borderRadius,
    },
    "& .rows": { position: "relative", minWidth: MIN_WIDTH },
    "& .header, & .row": {
      display: "grid",
      gridTemplateColumns: "var(--assoc-grid)",
      alignItems: "center",
      columnGap: "10px",
      padding: theme.spacing(0, 1),
      minWidth: MIN_WIDTH,
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
      "& > .idle": { color: theme.palette.text.disabled, fontWeight: 400 },
      "& .sort": {
        fontSize: "0.6rem",
        marginLeft: theme.spacing(0.5),
        color: theme.palette.text.secondary,
      },
    },
    "& .place": {
      position: "absolute",
      top: 0,
      left: 0,
      width: "100%",
      height: ROW_HEIGHT,
      // a row's size is fixed, so its contents are laid out and painted against its own box
      contain: "strict",
    },
    "& .row": {
      boxSizing: "border-box",
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
      "&.single": { cursor: "default" },
      "&.single .toggle::before": { content: '""' },
    },
    "& .num": { textAlign: "right", fontVariantNumeric: "tabular-nums" },
    "& .muted": { color: theme.palette.text.secondary },
    "& .error": { color: theme.palette.error.main },
    // the direction of an effect, ahead of its size
    "& .up::before": { content: '"↑"', color: theme.palette.error.main },
    "& .down::before": { content: '"↓"', color: theme.palette.info.main },
    // the cell itself is the badge
    "& .row > .badge": {
      justifySelf: "start",
      width: 16,
      lineHeight: "16px",
      borderRadius: "3px",
      textAlign: "center",
      color: "#fff",
      fontSize: "0.62rem",
      fontWeight: 700,
      "&.binary": { backgroundColor: TRAIT_TYPE_BADGE.binary.color },
      "&.quantitative": { backgroundColor: TRAIT_TYPE_BADGE.quantitative.color },
    },
    "& .members": {
      position: "absolute",
      left: 0,
      width: "100%",
      boxSizing: "border-box",
      height: PANEL_HEIGHT,
      padding: theme.spacing(1, 4),
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
      "& th.group": {
        color: theme.palette.text.primary,
        fontWeight: 600,
        paddingBottom: theme.spacing(0.5),
      },
      "& tbody + tbody th.group": { paddingTop: theme.spacing(1.5) },
    },
    "& .footer": {
      display: "flex",
      alignItems: "center",
      gap: theme.spacing(2),
      paddingTop: theme.spacing(1),
      "& .reset": {
        padding: 0,
        border: "none",
        background: "none",
        font: "inherit",
        color: theme.palette.primary.main,
        cursor: "pointer",
        "&:hover": { textDecoration: "underline" },
      },
    },
  };
});

const AssocTable = ({
  rows,
  csIds,
  onHoverSet,
  onOpenSets,
  onDownload,
  selected,
  collapsed,
}: {
  rows: AssocRow[];
  // the table is about one variant, and fills the column for its PIP in each set
  selected: boolean;
  // the table keeps the top trait only, and has a column for what each row stands for
  collapsed: boolean;
  // the credible sets of the rows that are open
  onOpenSets: (sets: number[]) => void;
  // undefined until the ids have loaded
  csIds: string[] | undefined;
  onHoverSet: (set: number | null) => void;
  // the rows in the order shown
  onDownload: (rows: AssocRow[]) => void;
}) => {
  // the order the user asked for, null for the one the table opens in
  const [chosen, setChosen] = useState<Sort | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  // state, not a ref: the rows are placed in a layout effect, which runs before a ref on an
  // element above them is attached
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);

  const columns = useMemo(() => COLUMNS.filter((c) => !c.when || collapsed), [collapsed]);
  // one variant's sets are read by what that variant does in each, until the user says otherwise;
  // a chosen column that has gone, or has emptied, falls back as well
  const opening = selected ? SELECTED_SORT : DEFAULT_SORT;
  const sort =
    chosen &&
    columns.some((c) => c.id === chosen.id) &&
    (selected || chosen.id !== SELECTED_SORT.id)
      ? chosen
      : opening;
  // a selection made or put away starts from its own opening order, and the user's comes back
  // with the selection gone
  const [beforeSelection, setBeforeSelection] = useState<Sort | null>(null);
  const [wasSelected, setWasSelected] = useState(selected);
  if (wasSelected !== selected) {
    setWasSelected(selected);
    setBeforeSelection(selected ? chosen : null);
    setChosen(selected ? null : beforeSelection);
  }
  useEffect(() => {
    onOpenSets(open.size === 0 ? [] : rows.filter((r) => open.has(r.key)).map((r) => r.set));
  }, [open, rows, onOpenSets]);

  const sorted = useMemo(
    () =>
      sortRows(
        rows,
        [sort, TIE_BREAK].map((s) => ({ value: columnOf(s.id).value, desc: s.desc }))
      ),
    [rows, sort]
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
  // a click sorts by that column, strongest first where the column says so, and a second click
  // turns it round
  const sortBy = useCallback(
    (id: string) =>
      setChosen(
        sort.id === id
          ? { id, desc: !sort.desc }
          : { id, desc: columnOf(id).sortDescFirst ?? false }
      ),
    [sort]
  );
  const isOpening = sort.id === opening.id && sort.desc === opening.desc;
  const reset = useCallback(() => setChosen(null), []);

  const download = useCallback(() => onDownload(sorted), [onDownload, sorted]);

  return (
    <TableRoot
      style={
        { "--assoc-grid": `24px ${columns.map((c) => c.width).join(" ")}` } as React.CSSProperties
      }>
      <div
        ref={setScroller}
        className="scroller"
        role="table"
        aria-rowcount={sorted.length}
        data-testid="assoc-table"
        onMouseLeave={() => onHoverSet(null)}>
        <TableHeader
          columns={columns}
          sort={sort}
          idle={selected ? null : SELECTED_SORT.id}
          onSort={sortBy}
        />
        {scroller && (
          <WindowedRows
            rows={sorted}
            columns={columns}
            scroller={scroller}
            open={open}
            csIds={csIds}
            onToggle={toggle}
            onHover={onHoverSet}
          />
        )}
      </div>
      <TableFooter
        count={sorted.length}
        ready={!!csIds}
        sort={sort}
        onReset={isOpening ? undefined : reset}
        onDownload={download}
      />
    </TableRoot>
  );
};

export default AssocTable;
