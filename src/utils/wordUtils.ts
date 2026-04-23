import { inflateRawSync } from "zlib";

type TiptapNode = {
  type?: string;
  text?: string;
  content?: TiptapNode[];
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

const escapeXml = (value: string) => {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
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

const createDocumentPackage = (documentXml: Buffer) => {
  const contentTypes = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `</Types>`,
    "utf8",
  );

  const relationships = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`,
    "utf8",
  );

  return createZipBuffer([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: relationships },
    { name: "word/document.xml", data: documentXml },
  ]);
};

const createDocumentXml = (body: string) => {
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" ` +
      `xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ` +
      `xmlns:o="urn:schemas-microsoft-com:office:office" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
      `xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ` +
      `xmlns:v="urn:schemas-microsoft-com:vml" ` +
      `xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" ` +
      `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
      `xmlns:w10="urn:schemas-microsoft-com:office:word" ` +
      `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
      `xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ` +
      `xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" ` +
      `xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" ` +
      `xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" ` +
      `xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ` +
      `mc:Ignorable="w14 wp14">` +
      `<w:body>${body}` +
      `<w:sectPr>` +
      `<w:pgSz w:w="12240" w:h="15840"/>` +
      `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>` +
      `</w:sectPr></w:body></w:document>`,
    "utf8",
  );
};

const createParagraphXml = (paragraph: TiptapNode) => {
  const nodes = paragraph.content ?? [];
  const runs = nodes
    .map((node) => {
      if (node.type === "hardBreak") {
        return `<w:r><w:br/></w:r>`;
      }

      if (typeof node.text === "string") {
        return `<w:r><w:t xml:space="preserve">${escapeXml(node.text)}</w:t></w:r>`;
      }

      if (Array.isArray(node.content) && node.content.length > 0) {
        return node.content
          .map((child) => {
            if (child.type === "hardBreak") {
              return `<w:r><w:br/></w:r>`;
            }

            if (typeof child.text === "string") {
              return `<w:r><w:t xml:space="preserve">${escapeXml(child.text)}</w:t></w:r>`;
            }

            return "";
          })
          .join("");
      }

      return "";
    })
    .join("");

  return runs.length > 0 ? `<w:p>${runs}</w:p>` : `<w:p/>`;
};

const normalizeTiptapDocument = (content: unknown): TiptapNode[] => {
  if (Array.isArray(content)) {
    return content.filter((node): node is TiptapNode => {
      return typeof node === "object" && node !== null && node.type === "paragraph";
    });
  }

  if (!content || typeof content !== "object") {
    return [];
  }

  const maybeDocument = content as TiptapNode;
  if (maybeDocument.type === "paragraph") {
    return [maybeDocument];
  }

  const paragraphNodes = Array.isArray(maybeDocument.content)
    ? maybeDocument.content
    : [];

  return paragraphNodes.filter((node) => node.type === "paragraph");
};

export const createBlankWordDocument = () => {
  const documentXml = createDocumentXml(`<w:p/>`);
  return createDocumentPackage(documentXml);
};

export const createWordDocumentFromTiptap = (content: unknown) => {
  const paragraphs = normalizeTiptapDocument(content);
  const body = paragraphs.map(createParagraphXml).join("") || `<w:p/>`;
  return createDocumentPackage(createDocumentXml(body));
};

const decodeXmlEntities = (value: string) => {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
};

export const extractWordDocumentXml = (buffer: Buffer) => {
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
    const fileName = buffer.toString("utf8", nameStart, nameStart + nameLength);
    const fileData = buffer.subarray(dataStart, dataEnd);

    if (fileName === "word/document.xml") {
      if (compressionMethod === 0) {
        return fileData.toString("utf8");
      }

      if (compressionMethod === 8) {
        return inflateRawSync(fileData).toString("utf8");
      }

      throw new Error(`Unsupported zip compression method: ${compressionMethod}`);
    }

    offset = dataEnd;
  }

  throw new Error("word/document.xml not found in docx buffer");
};

const extractParagraphContent = (paragraphXml: string) => {
  const nodes: Array<Record<string, unknown>> = [];
  const tokens = paragraphXml.match(/<w:t[^>]*>[\s\S]*?<\/w:t>|<w:br\s*\/?>/g) ?? [];

  for (const token of tokens) {
    if (token.startsWith("<w:br")) {
      nodes.push({ type: "hardBreak" });
      continue;
    }

    const text = token
      .replace(/^<w:t[^>]*>/, "")
      .replace(/<\/w:t>$/, "");

    const decoded = decodeXmlEntities(text);
    if (decoded.length > 0) {
      nodes.push({ type: "text", text: decoded });
    }
  }

  return nodes;
};

export const convertWordDocumentXmlToTiptap = (xml: string) => {
  const paragraphs = xml.match(/<w:p[\s\S]*?<\/w:p>/g) ?? [];

  return {
    type: "doc",
    content: paragraphs.map((paragraphXml) => {
      const content = extractParagraphContent(paragraphXml);

      if (content.length === 0) {
        return { type: "paragraph" };
      }

      return {
        type: "paragraph",
        content,
      };
    }),
  };
};
