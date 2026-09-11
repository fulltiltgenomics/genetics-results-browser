export type ChangeLogItem = {
  type: string;
  text?: string;
  children?: Array<ChangeLogItem>;
};

export type GeneInfo = {
  _id: string;
  symbol: string;
  name: string;
  summary: string;
};
