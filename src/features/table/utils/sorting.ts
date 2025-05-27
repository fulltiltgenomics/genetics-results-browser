export const variantSort = (rowA: any, rowB: any, id: string) => {
  const cpraA = rowA.original[id].split("-");
  const cpraB = rowB.original[id].split("-");
  // chromosome
  let cmp = new Intl.Collator("en", { numeric: true }).compare(cpraA[0], cpraB[0]);
  if (cmp !== 0) {
    return cmp;
  }
  // position
  cmp = parseFloat(cpraA[1]) - parseFloat(cpraB[1]);
  if (cmp !== 0) {
    return cmp;
  }
  // reference
  cmp = cpraA[2].localeCompare(cpraB[2]);
  if (cmp !== 0) {
    return cmp;
  }
  // alternative
  cmp = cpraA[3].localeCompare(cpraB[3]);
  if (cmp !== 0) {
    return cmp;
  }
  return 0;
};

export const naInfSort = (rowA: any, rowB: any, id: string) => {
  // https://stackoverflow.com/a/22129960
  let valA = id.split(".").reduce((p, c) => p[c], rowA.original);
  let valB = id.split(".").reduce((p, c) => p[c], rowB.original);
  let a = parseFloat(valA);
  let b = parseFloat(valB);

  if (typeof valA == "string" && valA.toLowerCase().startsWith("inf")) {
    a = Number.POSITIVE_INFINITY;
  }
  if (isNaN(a)) {
    // NA to bottom
    a = Number.NEGATIVE_INFINITY;
  }
  if (typeof valB == "string" && valB.toLowerCase().startsWith("inf")) {
    b = Number.POSITIVE_INFINITY;
  }
  if (Number.isNaN(b)) {
    b = Number.NEGATIVE_INFINITY;
  }
  return a - b;
};
