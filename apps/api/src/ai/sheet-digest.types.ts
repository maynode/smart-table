export interface SheetDigestField {
  id: string;
  name: string;
  type: string;
  nonEmpty: number;
  empty: number;
  topValues: Array<{ value: string; count: number }>;
}

export interface SheetDigest {
  sheetId: string;
  sheetName: string;
  fieldCount: number;
  recordCount: number;
  fields: SheetDigestField[];
}
