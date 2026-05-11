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

const parseWorksheetRows = (
  worksheetXml: string,
  sharedStrings: string[],
  styles: ReturnType<typeof parseStyles>,
) => {
  const rows = worksheetXml.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? [];

  return rows.map((rowXml) => {
    const cells = rowXml.match(/<c[\s\S]*?<\/c>/g) ?? [];
    const row: Array<Record<string, unknown> | null> = [];

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

      row[index] = {
        reference: cell.reference,
        value: parsedValue,
        formula: cell.formula ?? null,
        type: cell.type ?? null,
        styleId: cell.styleId ?? null,
        bold: style?.bold ?? false,
        italic: style?.italic ?? false,
        fontId: style?.fontId ?? null,
        numFmtId: style?.numFmtId ?? null,
      };
    }

    return row;
  });
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
  return rows.length > 0 ? rows : [[]];
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

  if (content.length === 0) {
    worksheetXml = worksheetXml.replace(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/i, "<sheetData></sheetData>");
  }

  return {
    sheetName: sheetInfo.name,
    content: content.length > 0 ? content : [[]],
  };
};
