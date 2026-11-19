import { FormControlLabel, Radio, RadioGroup, Typography } from "@mui/material";
import { BurdenTraitType } from "@/store/store.geneEvidence";
import { LetterBadge } from "../table/DataTypeIcon";

/** the binary / quantitative trait filter and its radio row, shared by the gene evidence tables */

export const TRAIT_TYPE_BADGE = {
  binary: { label: "B", color: "#00695c" },
  quantitative: { label: "Q", color: "#4527a0" },
};

export interface RadioOption<T> {
  value: T;
  label: string;
  badge?: keyof typeof TRAIT_TYPE_BADGE;
}

export const TRAIT_TYPE_OPTIONS: RadioOption<BurdenTraitType>[] = [
  { value: "all", label: "both binary and quantitative traits" },
  { value: "binary", label: "only binary traits", badge: "binary" },
  { value: "quantitative", label: "only quantitative traits", badge: "quantitative" },
];

export const RadioOptions = <T extends string>({
  label,
  value,
  options,
  onChange,
  spanLast = false,
}: {
  label: string;
  value: T;
  options: RadioOption<T>[];
  onChange: (value: T) => void;
  // the last option runs to the grid's end, so a long label does not widen its column
  spanLast?: boolean;
}) => (
  // the group's options are laid out by the grid around it, so both groups share its columns
  <RadioGroup
    aria-label={label}
    value={value}
    onChange={(e) => onChange(e.target.value as T)}
    sx={{ display: "contents" }}>
    {options.map((o, i) => (
      <FormControlLabel
        key={o.value}
        value={o.value}
        sx={{
          gridColumn: spanLast && i === options.length - 1 ? `${i + 1} / -1` : i + 1,
          mr: 0,
        }}
        control={<Radio size="small" sx={{ py: 0.25 }} />}
        label={
          <Typography variant="body2" sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            {/* decorative here: the label beside it already says which type */}
            {o.badge && (
              <span aria-hidden style={{ display: "inline-flex" }}>
                <LetterBadge {...TRAIT_TYPE_BADGE[o.badge]} title={o.badge} />
              </span>
            )}
            {o.label}
          </Typography>
        }
      />
    ))}
  </RadioGroup>
);
