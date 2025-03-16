import { TableData } from "../../../types/types";

export const pValRepr = (mlogp: number): string => {
  if (mlogp <= 0) {
    return "1";
  }
  const p = Math.pow(10, -mlogp);
  let repr = p.toExponential(2);
  // in case of underflow put the string together
  if (p == 0) {
    const digits = Math.round(1000 * Math.pow(10, -(mlogp - Math.floor(mlogp)))) / 100;
    const exp = Math.ceil(mlogp);
    repr = `${digits}e-${exp}`;
  }
  return repr;
};

export const afRepr = (af: string): string => {
  const afNumber = parseFloat(af);
  if (afNumber === 0) {
    return "0";
  }
  if (afNumber < 0.001) {
    return afNumber.toExponential(2);
  }
  return afNumber.toPrecision(2);
};

export const cleanConsequence = (consequence: string): string => {
  return consequence.replace(/_variant/g, "").replace(/_/g, " ");
};

// TODO if the threshold is the same across resources, just show the number
export const renderPThreshold = (clientData: TableData, thres: number): string => {
  if (thres === 1) {
    return clientData!.meta.assoc.resources.map((r) => `${r.p_thres} (${r.resource})`).join(", ");
  }
  return `the chosen threshold of ${thres}`;
};

// TODO should use the raw data instead of the HTML in these functions
// or make all HTML columns use the same format, e.g. give a value prop
// or use the meta property of the columns
export const filterAbsGreaterThanHTML = (row: any, id: string, filterValue: any): boolean => {
  const rowVal = row.getValue(id) as any;
  const val =
    typeof rowVal === "number"
      ? rowVal
      : typeof rowVal === "string"
      ? Number(rowVal)
      : rowVal.props.value !== undefined
      ? rowVal.props.value
      : typeof rowVal.props.children == "string"
      ? Number(rowVal.props.children)
      : rowVal.props.children[1] !== undefined
      ? Number(rowVal.props.children[1].props.children)
      : Number(rowVal.props.children.props.children);
  return Math.abs(val) > filterValue;
};

export const filterLessThanHTML = (row: any, id: string, filterValue: any): boolean => {
  const rowVal = row.getValue(id) as any;
  const val = id.toLowerCase().startsWith("gnomad.af")
    ? Number(row.getValue("af_hidden"))
    : typeof rowVal.props.children == "string"
    ? Number(rowVal.props.children)
    : Number(rowVal.props.children[1].props.children);
  return val < filterValue;
};

export const filterContainsWithTooltip = (row: any, id: string, filterValue: any): boolean => {
  const val = row.getValue(id) as any;
  if (typeof val === "string") {
    return (val as string).toLowerCase().indexOf(filterValue.toLowerCase()) > -1;
  } else if (typeof val === "object") {
    if (val.props.content !== undefined) {
      if (typeof filterValue === "object") {
        // multi-select
        return filterValue.length > 0
          ? filterValue.some(
              (f: string) =>
                val.props.content.props.children.toLowerCase().indexOf(f.toLowerCase()) > -1
            )
          : true;
      } else {
        if (val.props.phenos !== undefined) {
          return (
            val.props.phenos[0].phenostring.toLowerCase().indexOf(filterValue.toLowerCase()) > -1
          );
        }
        // text
        // no tooltip - blank field
        if (val.props.content.props.children === null) {
          return false;
        }
        return (
          val.props.content.props.children.toLowerCase().indexOf(filterValue.toLowerCase()) > -1
        );
      }
    }
    if (val.props.children.props !== undefined) {
      // tooltip
      return (
        val.props.children.props.children.toLowerCase().indexOf(filterValue.toLowerCase()) > -1
      );
    } else {
      //no tooltip
      return val.props.children.toLowerCase().indexOf(filterValue.toLowerCase()) > -1;
    }
  }
  return false;
};
