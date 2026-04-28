import { inflateRawSync } from "zlib";

type ExcelCell = {
  reference?: string;
  type?: string;
  value?: string;
  inlineText?: string;
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
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
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

const getColumnIndex = (reference: string) => {
  const columnLetters = reference.replace(/\d+/g, "");
  let index = 0;

  for (const letter of columnLetters) {
    index = index * 26 + (letter.toUpperCase().charCodeAt(0) - 64);
  }

  return Math.max(index - 1, 0);
};

const parseCell = (cellXml: string) => {
  const reference = cellXml.match(/r="([^"]+)"/)?.[1];
  const type = cellXml.match(/t="([^"]+)"/)?.[1];

  const inlineTextMatch = cellXml.match(
    /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/,
  );
  const valueMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);

  const cell: ExcelCell = {};

  if (reference) {
    cell.reference = reference;
  }

  if (type) {
    cell.type = type;
  }

  if (inlineTextMatch?.[1] !== undefined) {
    cell.inlineText = decodeXmlEntities(inlineTextMatch[1]);
  }

  if (valueMatch?.[1] !== undefined) {
    cell.value = decodeXmlEntities(valueMatch[1]);
  }

  return cell;
};

const parseWorksheetRows = (worksheetXml: string) => {
  const rows = worksheetXml.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? [];

  return rows.map((rowXml) => {
    const cells = rowXml.match(/<c[\s\S]*?<\/c>/g) ?? [];
    const row: Array<string | number | boolean | null> = [];

    for (const cellXml of cells) {
      const cell = parseCell(cellXml);
      if (!cell.reference) continue;

      const index = getColumnIndex(cell.reference);
      const rawValue =
        cell.inlineText ??
        cell.value ??
        "";

      const parsedValue =
        cell.type === "b"
          ? rawValue === "1"
          : rawValue.length > 0 && !Number.isNaN(Number(rawValue))
            ? Number(rawValue)
            : rawValue;

      while (row.length < index) {
        row.push(null);
      }

      row[index] = parsedValue;
    }

    return row;
  });
};

export const extractExcelSheetName = (workbookXml: string) => {
  const sheetName = workbookXml.match(/<sheet[^>]*name="([^"]+)"/)?.[1];
  return sheetName ? decodeXmlEntities(sheetName) : "Sheet1";
};

export const convertExcelWorksheetXmlToGrid = (worksheetXml: string) => {
  const rows = parseWorksheetRows(worksheetXml);
  return rows.length > 0 ? rows : [[]];
};
