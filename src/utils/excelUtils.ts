import { inflateRawSync } from "zlib";

type ExcelCell = {
  reference?: string;
  type?: string;
  value?: string;
  inlineText?: string;
  formula?: string;
  styleId?: number;
  fontId?: number;
  bold?: boolean;
  italic?: boolean;
};

type ExcelStyle = {
  styleId: number;
  fontId: number;
  numFmtId: number;
  bold: boolean;
  italic: boolean;
};

export type ExcelEditorCellMeta = {
  row: number;
  col: number;
  value?: string | number | boolean | null;
  formula?: string | null;
  type?: string | null;
  styleId?: number | null;
  fontId?: number | null;
  numFmtId?: number | null;
  bold?: boolean;
  italic?: boolean;
};

export type ExcelEditorRowMeta = {
  row: number;
  height?: number | null;
  hidden?: boolean;
  customHeight?: boolean;
  styleId?: number | null;
  outlineLevel?: number | null;
  collapsed?: boolean;
  spans?: string | null;
};

export type ExcelEditorContent = {
  data: Array<Array<string | number | boolean | null>>;
  cellMeta: ExcelEditorCellMeta[];
  rowMeta?: ExcelEditorRowMeta[];
};

const createCrc32Table = () => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index++) {
    let crc = index;

    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }

    table[index] = crc >>> 0;
  }

  return table;
};

const CRC32_TABLE = createCrc32Table();

const crc32 = (buffer: Buffer) => {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
};

const createZipBuffer = (entries: Array<{ name: string; data: Buffer }>) => {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, "utf8");
    const data = entry.data;
    const checksum = crc32(data);

    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuffer.copy(localHeader, 30);

    localParts.push(localHeader, data);

    const centralHeader = Buffer.alloc(46 + nameBuffer.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuffer.copy(centralHeader, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralDirectorySize = centralParts.reduce(
    (total, part) => total + part.length,
    0,
  );
  const centralDirectoryOffset = offset;
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectorySize, 12);
  endOfCentralDirectory.writeUInt32LE(centralDirectoryOffset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, endOfCentralDirectory]);
};

const createWorkbookXml = () => {
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>` +
      `</workbook>`,
    "utf8",
  );
};

const createWorkbookRelationshipsXml = () => {
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
      `</Relationships>`,
    "utf8",
  );
};

const createWorksheetXml = () => {
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<sheetData/>` +
      `</worksheet>`,
    "utf8",
  );
};

const createContentTypesXml = () => {
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `</Types>`,
    "utf8",
  );
};

const createRootRelationshipsXml = () => {
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
    "utf8",
  );
};

export const createBlankExcelDocument = () => {
  return createZipBuffer([
    { name: "[Content_Types].xml", data: createContentTypesXml() },
    { name: "_rels/.rels", data: createRootRelationshipsXml() },
    { name: "xl/workbook.xml", data: createWorkbookXml() },
    { name: "xl/_rels/workbook.xml.rels", data: createWorkbookRelationshipsXml() },
    { name: "xl/worksheets/sheet1.xml", data: createWorksheetXml() },
  ]);
};

const decodeXmlEntities = (value: string) => {
  return value
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
};

const parseXmlAttributes = (xml: string) => {
  const attributes: Record<string, string> = {};

  for (const match of xml.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    const [, key, rawValue] = match;
    if (!key) continue;
    attributes[key] = decodeXmlEntities(rawValue ?? "");
  }

  return attributes;
};

const extractSingleXmlTag = (xml: string, tagName: string) => {
  const match = xml.match(new RegExp(`<${tagName}\\b[^>]*\\/?>`, "i"));
  return match?.[0];
};

const resolveWorkbookTargetPath = (target: string) => {
  const normalizedTarget = target.replace(/^\/+/, "");

  if (normalizedTarget.startsWith("xl/")) {
    return normalizedTarget;
  }

  const withoutParentTraversal = normalizedTarget.replace(/^(\.\.\/)+/, "");
  if (withoutParentTraversal.startsWith("xl/")) {
    return withoutParentTraversal;
  }

  return `xl/${withoutParentTraversal}`;
};

const extractZipEntry = (buffer: Buffer, fileName: string) => {
  let offset = 0;

  while (offset + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);

    if (signature !== 0x04034b50) break;

    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    const currentFileName = buffer.toString("utf8", nameStart, nameStart + nameLength);
    const fileData = buffer.subarray(dataStart, dataEnd);

    if (currentFileName === fileName) {
      if (compressionMethod === 0) {
        return fileData;
      }

      if (compressionMethod === 8) {
        return inflateRawSync(fileData);
      }

      throw new Error(`Unsupported zip compression method: ${compressionMethod}`);
    }

    offset = dataEnd;
  }

  throw new Error(`${fileName} not found in xlsx buffer`);
};

export const extractExcelWorksheetXml = (buffer: Buffer, sheetPath = "xl/worksheets/sheet1.xml") => {
  return extractZipEntry(buffer, sheetPath).toString("utf8");
};

export const extractExcelWorkbookXml = (buffer: Buffer) => {
  return extractZipEntry(buffer, "xl/workbook.xml").toString("utf8");
};

export const extractExcelWorkbookRelationshipsXml = (buffer: Buffer) => {
  return extractZipEntry(buffer, "xl/_rels/workbook.xml.rels").toString("utf8");
};

export const extractExcelSharedStringsXml = (buffer: Buffer) => {
  return extractZipEntry(buffer, "xl/sharedStrings.xml").toString("utf8");
};

export const extractExcelStylesXml = (buffer: Buffer) => {
  return extractZipEntry(buffer, "xl/styles.xml").toString("utf8");
};

const extractExcelSheetInfo = (
  workbookXml: string,
  workbookRelsXml: string,
) => {
  const sheetTag = extractSingleXmlTag(workbookXml, "sheet");

  if (!sheetTag) {
    return {
      name: "Sheet1",
      path: "xl/worksheets/sheet1.xml",
    };
  }

  const sheetAttributes = parseXmlAttributes(sheetTag);
  const relationshipId = sheetAttributes["r:id"] ?? sheetAttributes.id;
  const sheetName = sheetAttributes.name ?? "Sheet1";

  if (!relationshipId) {
    return {
      name: sheetName,
      path: "xl/worksheets/sheet1.xml",
    };
  }

  const relationshipTag = workbookRelsXml
    .match(/<Relationship\b[^>]*Type="[^"]*\/worksheet"[^>]*\/?>/i)
    ?.[0];

  if (!relationshipTag) {
    return {
      name: sheetName,
      path: "xl/worksheets/sheet1.xml",
    };
  }

  const relationshipAttributes = parseXmlAttributes(relationshipTag);

  if (relationshipAttributes.Id !== relationshipId) {
    const relationshipById = workbookRelsXml.match(
      new RegExp(
        `<Relationship\\b[^>]*Id="${relationshipId}"[^>]*Type="[^"]*\\/worksheet"[^>]*\\/?>`,
        "i",
      ),
    )?.[0];

    if (relationshipById) {
      const relationshipByIdAttributes = parseXmlAttributes(relationshipById);
      return {
        name: sheetName,
        path: resolveWorkbookTargetPath(
          relationshipByIdAttributes.Target ?? "worksheets/sheet1.xml",
        ),
      };
    }
  }

  return {
    name: sheetName,
    path: resolveWorkbookTargetPath(
      relationshipAttributes.Target ?? "worksheets/sheet1.xml",
    ),
  };
};

const parseSharedStrings = (sharedStringsXml: string) => {
  const sharedStringItems = sharedStringsXml.match(/<si\b[\s\S]*?<\/si>/g) ?? [];

  return sharedStringItems.map((sharedStringXml) => {
    const textParts = sharedStringXml.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? [];

    if (textParts.length === 0) {
      return "";
    }

    return textParts
      .map((textPart) => {
        const textValue = textPart.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "";
        return decodeXmlEntities(textValue);
      })
      .join("");
  });
};

const parseStyles = (stylesXml: string) => {
  const fontXmlBlocks = stylesXml.match(/<fonts\b[^>]*>([\s\S]*?)<\/fonts>/i)?.[1] ?? "";
  const cellXfXmlBlocks = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/i)?.[1] ?? "";

  const fonts = (fontXmlBlocks.match(/<font\b[\s\S]*?<\/font>/g) ?? []).map((fontXml) => ({
    bold: /<b\b[^>]*\/?>/i.test(fontXml),
    italic: /<i\b[^>]*\/?>/i.test(fontXml),
  }));

  const cellXfs = (cellXfXmlBlocks.match(/<xf\b[^>]*\/?>/g) ?? []).map((xfXml) => {
    const attributes = parseXmlAttributes(xfXml);
    return {
      fontId: Number(attributes.fontId ?? 0),
      numFmtId: Number(attributes.numFmtId ?? 0),
    };
  });

  return { fonts, cellXfs };
};

const getCellStyle = (styleId: number | undefined, styles: ReturnType<typeof parseStyles>) => {
  if (styleId === undefined || Number.isNaN(styleId)) {
    return undefined;
  }

  const xf = styles.cellXfs[styleId];
  if (!xf) {
    return {
      styleId,
      fontId: 0,
      numFmtId: 0,
      bold: false,
      italic: false,
    };
  }

  const font = styles.fonts[xf.fontId] ?? { bold: false, italic: false };

  return {
    styleId,
    fontId: xf.fontId,
    numFmtId: xf.numFmtId,
    bold: font.bold,
    italic: font.italic,
  };
};

const getColumnIndex = (reference: string) => {
  const columnLetters = reference.replace(/\d+/g, "");
  let index = 0;

  for (const letter of columnLetters) {
    index = index * 26 + (letter.toUpperCase().charCodeAt(0) - 64);
  }

  return Math.max(index - 1, 0);
};

const parseCell = (cellXml: string) => {
  const attributes = parseXmlAttributes(cellXml);
  const reference = attributes.r;
  const type = attributes.t;
  const styleId = attributes.s !== undefined ? Number(attributes.s) : undefined;

  const inlineTextMatch = cellXml.match(
    /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/,
  );
  const valueMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
  const formulaMatch = cellXml.match(/<f[^>]*>([\s\S]*?)<\/f>/);

  const cell: ExcelCell = {};

  if (reference) {
    cell.reference = reference;
  }

  if (type) {
    cell.type = type;
  }

  if (styleId !== undefined && !Number.isNaN(styleId)) {
    cell.styleId = styleId;
  }

  if (inlineTextMatch?.[1] !== undefined) {
    cell.inlineText = decodeXmlEntities(inlineTextMatch[1]);
  }

  if (valueMatch?.[1] !== undefined) {
    cell.value = decodeXmlEntities(valueMatch[1]);
  }

  if (formulaMatch?.[1] !== undefined) {
    cell.formula = decodeXmlEntities(formulaMatch[1]);
  }

  return cell;
};

const parseRow = (rowXml: string) => {
  const rowTag = rowXml.match(/<row\b[^>]*>/i)?.[0];

  if (!rowTag) {
    return {
      rowIndex: null as number | null,
      meta: null as ExcelEditorRowMeta | null,
    };
  }

  const attributes = parseXmlAttributes(rowTag);
  const rowNumber = Number(attributes.r);
  const rowIndex = Number.isNaN(rowNumber) ? null : Math.max(rowNumber - 1, 0);

  if (rowIndex === null) {
    return {
      rowIndex: null,
      meta: null,
    };
  }

  return {
    rowIndex,
    meta: {
      row: rowIndex,
      height:
        attributes.ht !== undefined && !Number.isNaN(Number(attributes.ht))
          ? Number(attributes.ht)
          : null,
      hidden: attributes.hidden === "1",
      customHeight: attributes.customHeight === "1",
      styleId:
        attributes.s !== undefined && !Number.isNaN(Number(attributes.s))
          ? Number(attributes.s)
          : null,
      outlineLevel:
        attributes.outlineLevel !== undefined &&
        !Number.isNaN(Number(attributes.outlineLevel))
          ? Number(attributes.outlineLevel)
          : null,
      collapsed: attributes.collapsed === "1",
      spans: attributes.spans ?? null,
    } as ExcelEditorRowMeta,
  };
};

const parseWorksheetRows = (
  worksheetXml: string,
  sharedStrings: string[],
  styles: ReturnType<typeof parseStyles>,
) => {
  const rows = worksheetXml.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? [];
  const data: Array<Array<string | number | boolean | null>> = [];
  const rowMeta: ExcelEditorRowMeta[] = [];

  rows.forEach((rowXml, rowPosition) => {
    const { rowIndex, meta } = parseRow(rowXml);
    const targetRowIndex = rowIndex ?? rowPosition;
    const cells = rowXml.match(/<c[\s\S]*?<\/c>/g) ?? [];
    const row: Array<string | number | boolean | null> = [];

    for (const cellXml of cells) {
      const cell = parseCell(cellXml);
      if (!cell.reference) continue;

      const index = getColumnIndex(cell.reference);
      const rawValue = cell.inlineText ?? cell.value ?? "";
      const style = getCellStyle(cell.styleId, styles);

      let parsedValue: string | number | boolean | null = null;

      if (cell.type === "s") {
        const sharedStringIndex = Number(rawValue);
        parsedValue = Number.isNaN(sharedStringIndex)
          ? rawValue
          : sharedStrings[sharedStringIndex] ?? rawValue;
      } else if (cell.type === "b") {
        parsedValue = rawValue === "1";
      } else if (cell.type === "inlineStr") {
        parsedValue = rawValue;
      } else if (rawValue.length > 0 && !Number.isNaN(Number(rawValue))) {
        parsedValue = Number(rawValue);
      } else {
        parsedValue = rawValue.length > 0 ? rawValue : null;
      }

      while (row.length < index) {
        row.push(null);
      }

      row[index] = parsedValue;
    }

    while (data.length < targetRowIndex) {
      data.push([]);
    }

    data[targetRowIndex] = row;

    if (meta) {
      rowMeta[targetRowIndex] = meta;
    }
  });

  return {
    data,
    rowMeta,
  };
};

export const extractExcelSheetName = (workbookXml: string) => {
  const sheetName = workbookXml.match(/<sheet[^>]*name="([^"]+)"/)?.[1];
  return sheetName ? decodeXmlEntities(sheetName) : "Sheet1";
};

export const convertExcelWorksheetXmlToGrid = (worksheetXml: string) => {
  const rows = parseWorksheetRows(worksheetXml, [], {
    fonts: [],
    cellXfs: [],
  });
  return rows.data.length > 0 ? rows.data : [[]];
};

export const convertExcelBufferToSheet = (buffer: Buffer) => {
  const workbookXml = extractExcelWorkbookXml(buffer);
  const workbookRelationshipsXml = extractExcelWorkbookRelationshipsXml(buffer);
  const sheetInfo = extractExcelSheetInfo(workbookXml, workbookRelationshipsXml);

  let worksheetXml = extractZipEntry(buffer, sheetInfo.path).toString("utf8");
  let sharedStrings: string[] = [];
  let styles = { fonts: [], cellXfs: [] } as ReturnType<typeof parseStyles>;

  try {
    sharedStrings = parseSharedStrings(extractExcelSharedStringsXml(buffer));
  } catch {
    sharedStrings = [];
  }

  try {
    styles = parseStyles(extractExcelStylesXml(buffer));
  } catch {
    styles = { fonts: [], cellXfs: [] };
  }

  const content = parseWorksheetRows(worksheetXml, sharedStrings, styles);

  if (content.data.length === 0) {
    worksheetXml = worksheetXml.replace(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/i, "<sheetData></sheetData>");
  }

  return {
    sheetName: sheetInfo.name,
    content: content.data.length > 0 ? content.data : [[]],
    rowMeta: content.rowMeta,
  };
};

const getColumnLabel = (columnIndex: number) => {
  let dividend = columnIndex + 1;
  let columnLabel = "";

  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    columnLabel = String.fromCharCode(65 + modulo) + columnLabel;
    dividend = Math.floor((dividend - modulo) / 26);
  }

  return columnLabel;
};

const escapeXml = (value: string) => {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
};

const normalizeCellInput = (cell: unknown) => {
  if (
    cell !== null &&
    typeof cell === "object" &&
    !Array.isArray(cell)
  ) {
    const typedCell = cell as Record<string, unknown>;
    return {
      value:
        (typedCell.value as string | number | boolean | null | undefined) ??
        null,
      formula:
        typeof typedCell.formula === "string"
          ? typedCell.formula
          : null,
      bold: Boolean(typedCell.bold),
      italic: Boolean(typedCell.italic),
      styleId:
        typeof typedCell.styleId === "number"
          ? typedCell.styleId
          : null,
      fontId:
        typeof typedCell.fontId === "number"
          ? typedCell.fontId
          : null,
      numFmtId:
        typeof typedCell.numFmtId === "number"
          ? typedCell.numFmtId
          : null,
    };
  }

  return {
    value: cell as string | number | boolean | null,
    formula: null,
    bold: false,
    italic: false,
    styleId: null,
    fontId: null,
    numFmtId: null,
  };
};

const normalizeCellMetaEntries = (cellMeta: unknown) => {
  const entries: ExcelEditorCellMeta[] = [];

  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    if (!value || typeof value !== "object") {
      return;
    }

    const meta = value as Record<string, unknown>;

    const row =
      typeof meta.row === "number"
        ? meta.row
        : typeof meta.rowIndex === "number"
          ? meta.rowIndex
          : typeof meta.r === "number"
            ? meta.r
            : null;
    const col =
      typeof meta.col === "number"
        ? meta.col
        : typeof meta.colIndex === "number"
          ? meta.colIndex
          : typeof meta.c === "number"
            ? meta.c
            : null;

    if (row !== null && col !== null) {
      entries.push({
        row,
        col,
        ...(meta.value !== undefined
          ? {
              value: meta.value as string | number | boolean | null,
            }
          : {}),
        formula:
          typeof meta.formula === "string"
            ? meta.formula
            : null,
        type:
          typeof meta.type === "string"
            ? meta.type
            : null,
        styleId:
          typeof meta.styleId === "number"
            ? meta.styleId
            : null,
        fontId:
          typeof meta.fontId === "number"
            ? meta.fontId
            : null,
        numFmtId:
          typeof meta.numFmtId === "number"
            ? meta.numFmtId
            : null,
        bold: Boolean(meta.bold),
        italic: Boolean(meta.italic),
      });
      return;
    }

    if ("data" in meta || "cellMeta" in meta) {
      visit(meta.data);
      visit(meta.cellMeta);
      return;
    }

    const rowKeys = Object.keys(meta).filter((key) => /^\d+$/.test(key));
    if (rowKeys.length > 0) {
      for (const rowKey of rowKeys) {
        const rowIndex = Number(rowKey);
        const rowValue = meta[rowKey];

        if (Array.isArray(rowValue)) {
          rowValue.forEach((item, colIndex) => {
            if (item && typeof item === "object") {
              visit({ row: rowIndex, col: colIndex, ...(item as object) });
            }
          });
        } else if (rowValue && typeof rowValue === "object") {
          for (const [colKey, item] of Object.entries(
            rowValue as Record<string, unknown>,
          )) {
            if (!/^\d+$/.test(colKey)) continue;
            const colIndex = Number(colKey);
            if (item && typeof item === "object") {
              visit({ row: rowIndex, col: colIndex, ...(item as object) });
            }
          }
        }
      }
    }
  };

  visit(cellMeta);
  return entries;
};

const normalizeRowMetaEntries = (rowMeta: unknown) => {
  const entries: ExcelEditorRowMeta[] = [];

  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    if (!value || typeof value !== "object") {
      return;
    }

    const meta = value as Record<string, unknown>;

    const row =
      typeof meta.row === "number"
        ? meta.row
        : typeof meta.rowIndex === "number"
          ? meta.rowIndex
          : typeof meta.r === "number"
            ? meta.r
            : null;

    if (row !== null) {
      entries.push({
        row,
        height:
          typeof meta.height === "number"
            ? meta.height
            : typeof meta.ht === "number"
              ? meta.ht
              : null,
        hidden: Boolean(meta.hidden),
        customHeight: Boolean(meta.customHeight),
        styleId:
          typeof meta.styleId === "number"
            ? meta.styleId
            : null,
        outlineLevel:
          typeof meta.outlineLevel === "number"
            ? meta.outlineLevel
            : null,
        collapsed: Boolean(meta.collapsed),
        spans:
          typeof meta.spans === "string"
            ? meta.spans
            : null,
      });
      return;
    }

    if ("data" in meta || "rowMeta" in meta) {
      visit(meta.data);
      visit(meta.rowMeta);
      return;
    }

    const rowKeys = Object.keys(meta).filter((key) => /^\d+$/.test(key));
    if (rowKeys.length > 0) {
      for (const rowKey of rowKeys) {
        const rowIndex = Number(rowKey);
        const rowValue = meta[rowKey];

        if (Array.isArray(rowValue)) {
          rowValue.forEach((item) => visit({ row: rowIndex, ...(item as object) }));
        } else if (rowValue && typeof rowValue === "object") {
          visit({ row: rowIndex, ...(rowValue as object) });
        }
      }
    }
  };

  visit(rowMeta);
  return entries;
};

const getStyleKey = (bold: boolean, italic: boolean) =>
  `${bold ? "1" : "0"}:${italic ? "1" : "0"}`;

const getRowAttributes = (rowMeta?: ExcelEditorRowMeta) => {
  const attributes: string[] = [];

  if (rowMeta?.height !== undefined && rowMeta.height !== null) {
    attributes.push(`ht="${rowMeta.height}"`);
    attributes.push(`customHeight="1"`);
  }

  if (rowMeta?.hidden) {
    attributes.push(`hidden="1"`);
  }

  if (rowMeta?.styleId !== undefined && rowMeta.styleId !== null) {
    attributes.push(`s="${rowMeta.styleId}"`);
    attributes.push(`customFormat="1"`);
  }

  if (rowMeta?.outlineLevel !== undefined && rowMeta.outlineLevel !== null) {
    attributes.push(`outlineLevel="${rowMeta.outlineLevel}"`);
  }

  if (rowMeta?.collapsed) {
    attributes.push(`collapsed="1"`);
  }

  if (rowMeta?.spans) {
    attributes.push(`spans="${escapeXml(rowMeta.spans)}"`);
  }

  return attributes;
};

const buildStylesXml = () => {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="4">` +
    `<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>` +
    `<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>` +
    `<font><i/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>` +
    `<font><b/><i/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>` +
    `</fonts>` +
    `<fills count="2">` +
    `<fill><patternFill patternType="none"/></fill>` +
    `<fill><patternFill patternType="gray125"/></fill>` +
    `</fills>` +
    `<borders count="1">` +
    `<border><left/><right/><top/><bottom/><diagonal/></border>` +
    `</borders>` +
    `<cellStyleXfs count="1">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>` +
    `</cellStyleXfs>` +
    `<cellXfs count="4">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `</cellXfs>` +
    `<cellStyles count="1">` +
    `<cellStyle name="Normal" xfId="0" builtinId="0"/>` +
    `</cellStyles>` +
    `<dxfs count="0"/>` +
    `<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>` +
    `</styleSheet>`
  );
};

const buildContentTypesXml = () => {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
    `</Types>`
  );
};

const buildWorkbookXml = (sheetName: string) => {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>` +
    `</workbook>`
  );
};

const buildWorkbookRelationshipsXml = () => {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
    `</Relationships>`
  );
};

const buildRootRelationshipsXml = () => {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`
  );
};

const buildSheetXml = (
  data: Array<Array<string | number | boolean | null>>,
  cellMetaMap: Map<string, ExcelEditorCellMeta>,
  rowMetaMap: Map<number, ExcelEditorRowMeta>,
  sharedStringIndex: Map<string, number>,
) => {
  const rowsXml = data
    .map((row, rowIndex) => {
      const rowMeta = rowMetaMap.get(rowIndex);
      const cellsXml = row
        .map((rawCell, colIndex) => {
          if (rawCell === null || rawCell === undefined || rawCell === "") {
            return null;
          }

          const key = `${rowIndex}:${colIndex}`;
          const meta = cellMetaMap.get(key);
          const normalized = normalizeCellInput(rawCell);
          const cellValue =
            normalized.value !== null && normalized.value !== undefined
              ? normalized.value
              : null;
          const formula = meta?.formula ?? normalized.formula;
          const bold = meta?.bold ?? normalized.bold;
          const italic = meta?.italic ?? normalized.italic;
          const styleKey = getStyleKey(Boolean(bold), Boolean(italic));
          const fallbackStyleId =
            styleKey === "0:0" ? 0 : styleKey === "1:0" ? 1 : styleKey === "0:1" ? 2 : 3;
          const styleId =
            typeof meta?.styleId === "number" &&
            !Number.isNaN(meta.styleId) &&
            meta.styleId >= 0 &&
            meta.styleId <= 3
              ? meta.styleId
              : fallbackStyleId;
          const ref = `${getColumnLabel(colIndex)}${rowIndex + 1}`;
          const attributes = [`r="${ref}"`];
          let valueXml = "";

          if (styleId > 0) {
            attributes.push(`s="${styleId}"`);
          }

          if (formula) {
            const normalizedFormula = formula.startsWith("=")
              ? formula.slice(1)
              : formula;
            attributes.push(`t="${typeof cellValue === "string" ? "str" : "n"}"`);
            valueXml += `<f>${escapeXml(normalizedFormula)}</f>`;
            if (cellValue !== null && cellValue !== undefined) {
              valueXml += `<v>${escapeXml(String(cellValue))}</v>`;
            } else {
              valueXml += `<v>0</v>`;
            }
            return `<c ${attributes.join(" ")}>${valueXml}</c>`;
          }

          if (typeof cellValue === "boolean") {
            attributes.push(`t="b"`);
            valueXml = `<v>${cellValue ? 1 : 0}</v>`;
            return `<c ${attributes.join(" ")}>${valueXml}</c>`;
          }

          if (typeof cellValue === "number") {
            attributes.push(`t="n"`);
            valueXml = `<v>${cellValue}</v>`;
            return `<c ${attributes.join(" ")}>${valueXml}</c>`;
          }

          const stringValue = String(cellValue ?? "");
          attributes.push(`t="s"`);
          const sharedIndex = sharedStringIndex.get(stringValue);
          if (sharedIndex === undefined) {
            return null;
          }

          valueXml = `<v>${sharedIndex}</v>`;
          return `<c ${attributes.join(" ")}>${valueXml}</c>`;
        })
        .filter((cellXml): cellXml is string => cellXml !== null);

      const rowAttributes = [`r="${rowIndex + 1}"`, ...getRowAttributes(rowMeta)];
      return cellsXml.length > 0
        ? `<row ${rowAttributes.join(" ")}>${cellsXml.join("")}</row>`
        : `<row ${rowAttributes.join(" ")}></row>`;
    })
    .filter((rowXml): rowXml is string => rowXml !== null);

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetData>${rowsXml.join("")}</sheetData>` +
    `</worksheet>`
  );
};

const buildSharedStringsXml = (
  sharedStrings: string[],
  totalCount: number,
) => {
  const entries = sharedStrings
    .map((value) => {
      const text = escapeXml(value);
      return `<si><t xml:space="preserve">${text}</t></si>`;
    })
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${totalCount}" uniqueCount="${sharedStrings.length}">` +
    entries +
    `</sst>`
  );
};

const buildCellMetaMap = (cellMeta: unknown) => {
  const entries = normalizeCellMetaEntries(cellMeta);
  const map = new Map<string, ExcelEditorCellMeta>();

  for (const entry of entries) {
    map.set(`${entry.row}:${entry.col}`, entry);
  }

  return map;
};

export const convertExcelBufferToEditorContent = (
  buffer: Buffer,
): {
  sheetName: string;
  content: ExcelEditorContent;
} => {
  const workbookXml = extractExcelWorkbookXml(buffer);
  const workbookRelationshipsXml = extractExcelWorkbookRelationshipsXml(buffer);
  const sheetInfo = extractExcelSheetInfo(workbookXml, workbookRelationshipsXml);

  const worksheetXml = extractZipEntry(buffer, sheetInfo.path).toString("utf8");

  let sharedStrings: string[] = [];
  let styles = { fonts: [], cellXfs: [] } as ReturnType<typeof parseStyles>;

  try {
    sharedStrings = parseSharedStrings(extractExcelSharedStringsXml(buffer));
  } catch {
    sharedStrings = [];
  }

  try {
    styles = parseStyles(extractExcelStylesXml(buffer));
  } catch {
    styles = { fonts: [], cellXfs: [] };
  }

  const rows = worksheetXml.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? [];
  const data: Array<Array<string | number | boolean | null>> = [];
  const cellMeta: ExcelEditorCellMeta[] = [];
  const rowMeta: ExcelEditorRowMeta[] = [];

  rows.forEach((rowXml, rowPosition) => {
    const { rowIndex, meta } = parseRow(rowXml);
    const targetRowIndex = rowIndex ?? rowPosition;
    const cells = rowXml.match(/<c[\s\S]*?<\/c>/g) ?? [];
    const row: Array<string | number | boolean | null> = [];

    cells.forEach((cellXml) => {
      const cell = parseCell(cellXml);
      if (!cell.reference) return;

      const colIndex = getColumnIndex(cell.reference);
      const rawValue = cell.inlineText ?? cell.value ?? "";
      const style = getCellStyle(cell.styleId, styles);

      let parsedValue: string | number | boolean | null = null;

      if (cell.type === "s") {
        const sharedStringIndex = Number(rawValue);
        parsedValue = Number.isNaN(sharedStringIndex)
          ? rawValue
          : sharedStrings[sharedStringIndex] ?? rawValue;
      } else if (cell.type === "b") {
        parsedValue = rawValue === "1";
      } else if (cell.type === "inlineStr") {
        parsedValue = rawValue;
      } else if (rawValue.length > 0 && !Number.isNaN(Number(rawValue))) {
        parsedValue = Number(rawValue);
      } else {
        parsedValue = rawValue.length > 0 ? rawValue : null;
      }

      while (row.length < colIndex) {
        row.push(null);
      }

      row[colIndex] = parsedValue;
      cellMeta.push({
        row: targetRowIndex,
        col: colIndex,
        value: parsedValue,
        formula: cell.formula ?? null,
        type: cell.type ?? null,
        styleId: cell.styleId ?? null,
        bold: style?.bold ?? false,
        italic: style?.italic ?? false,
        fontId: style?.fontId ?? null,
        numFmtId: style?.numFmtId ?? null,
      });
    });

    while (data.length < targetRowIndex) {
      data.push([]);
    }

    data[targetRowIndex] = row;

    if (meta) {
      rowMeta[targetRowIndex] = meta;
    }
  });

  return {
    sheetName: sheetInfo.name,
    content: {
      data: data.length > 0 ? data : [[]],
      cellMeta,
      rowMeta,
    },
  };
};

export const createExcelDocumentFromEditorContent = (
  content: unknown,
  sheetName = "Sheet1",
) => {
  const parsedContent =
    typeof content === "string"
      ? JSON.parse(content)
      : (content as Record<string, unknown>);

  const data = Array.isArray(parsedContent?.data)
    ? (parsedContent.data as Array<Array<unknown>>)
    : [];
  const cellMeta = buildCellMetaMap(parsedContent?.cellMeta);
  const rowMeta = new Map<number, ExcelEditorRowMeta>();
  for (const entry of normalizeRowMetaEntries(parsedContent?.rowMeta)) {
    rowMeta.set(entry.row, entry);
  }
  const normalizedData: Array<Array<string | number | boolean | null>> = data.map(
    (row) =>
      (row ?? []).map((cell) => {
        const normalized = normalizeCellInput(cell);
        return normalized.value ?? null;
      }),
  );

  const sharedStringIndex = new Map<string, number>();
  const sharedStrings: string[] = [];
  let stringCount = 0;

  for (let rowIndex = 0; rowIndex < normalizedData.length; rowIndex++) {
    const row = normalizedData[rowIndex] ?? [];
    const originalRow = data[rowIndex] ?? [];

    for (let colIndex = 0; colIndex < row.length; colIndex++) {
      const meta = cellMeta.get(`${rowIndex}:${colIndex}`);
      const value = row[colIndex];
      const normalizedCell = normalizeCellInput(originalRow[colIndex]);
      const formula = meta?.formula ?? normalizedCell.formula;

      if (formula) continue;

      if (typeof value === "string") {
        stringCount++;
        if (!sharedStringIndex.has(value)) {
          sharedStringIndex.set(value, sharedStrings.length);
          sharedStrings.push(value);
        }
      }
    }
  }

  const worksheetXml = buildSheetXml(
    normalizedData,
    cellMeta,
    rowMeta,
    sharedStringIndex,
  );
  const workbookXml = buildWorkbookXml(sheetName);
  const workbookRelsXml = buildWorkbookRelationshipsXml();
  const rootRelsXml = buildRootRelationshipsXml();
  const contentTypesXml = buildContentTypesXml();
  const stylesXml = buildStylesXml();
  const sharedStringsXml = buildSharedStringsXml(sharedStrings, stringCount);

  return createZipBuffer([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypesXml, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rootRelsXml, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbookXml, "utf8") },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(workbookRelsXml, "utf8"),
    },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(worksheetXml, "utf8") },
    { name: "xl/styles.xml", data: Buffer.from(stylesXml, "utf8") },
    {
      name: "xl/sharedStrings.xml",
      data: Buffer.from(sharedStringsXml, "utf8"),
    },
  ]);
};
