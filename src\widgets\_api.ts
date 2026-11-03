export type WidgetSize = 'S' | 'M' | 'L' | 'XL' | 'XXL';
export const SIZE_ORDER: WidgetSize[] = ['S', 'M', 'L', 'XL', 'XXL'];

export type Place = { name: string; region?: string; lat: number; lon: number; tz?: string; cc?: string };
export type WidgetCfg = {
  place?: Place;
  unit?: 'auto' | 'F' | 'C';
  h24?: boolean;
  zones?: { name: string; tz: string }[];
  symbols?: string[];
  news?: NewsCfg;
  sport?: string;
  fx?: FxCfg;
  folder?: string;
  slide?: number;
};
export type NewsCfg = { topic?: string; query?: string; local?: string; region?: string; publisher?: string; every?: number ; feeds?: string };
export type FxCfg = { amount?: number; from?: string; to?: string };
export type CfgField = 'place' | 'unit' | 'h24' | 'zones' | 'symbols' | 'news' | 'sport' | 'folder' | 'currency' | 'slide';

export type WidgetDef = {
  id: string;
  family: string;
  group: string;
  name: string;
  desc: string;
  size: WidgetSize;
  mount: (root: HTMLElement, cfg?: WidgetCfg) => () => void;
  fields?: CfgField[];
  slots?: number;
  icon?: (size: number) => string;
};

export const defineWidgets = (defs: WidgetDef[]): WidgetDef[] => defs;
