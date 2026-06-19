import { inflateRawSync } from "zlib";

type TiptapNode = {
  type?: string;
  text?: string;
  content?: TiptapNode[];
  attrs?: Record<string, unknown>;
  marks?: Array<{
    type?: string;
    attrs?: Record<string, unknown>;
  }>;
};

type ListType = "bulletList" | "orderedList";

type RenderContext = {
  listType?: ListType;
  listLevel?: number;
  numId?: number;
};

type ZipEntryMap = Map<string, Buffer>;

type WordPackageParts = {
  documentXml: string;
  numberingXml?: string;
};

type NumberingLevelDefinition = {
  format: string;
};

type NumberingDefinition = {
  levels: Map<number, NumberingLevelDefinition>;
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

const createNumberingXml = () => {
  const createLevelXml = (level: number, format: "bullet" | "decimal") => {
    const bulletChars = ["\u2022", "o", "\u25AA"];
    const lvlText =
      format === "bullet"
        ? (bulletChars[level % bulletChars.length] ?? bulletChars[0])
        : `${Array.from({ length: level + 1 }, (_, index) => `%${index + 1}`).join(".")}.`;
    const safeLvlText = lvlText ?? "";
    const indent = 720 + level * 360;

    return (
      `<w:lvl w:ilvl="${level}">` +
      `<w:start w:val="1"/>` +
      `<w:numFmt w:val="${format}"/>` +
      `<w:lvlText w:val="${escapeXml(safeLvlText)}"/>` +
      `<w:lvlJc w:val="left"/>` +
      `<w:pPr><w:ind w:left="${indent}" w:hanging="360"/></w:pPr>` +
      (format === "bullet"
        ? `<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr>`
        : "") +
      `</w:lvl>`
    );
  };

  const createAbstractNumbering = (
    abstractNumId: number,
    format: "bullet" | "decimal",
  ) => {
    return (
      `<w:abstractNum w:abstractNumId="${abstractNumId}">` +
      `<w:multiLevelType w:val="hybridMultilevel"/>` +
      Array.from({ length: 9 }, (_, level) =>
        createLevelXml(level, format),
      ).join("") +
      `</w:abstractNum>`
    );
  };

  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `${createAbstractNumbering(0, "bullet")}` +
      `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>` +
      `${createAbstractNumbering(1, "decimal")}` +
      `<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>` +
      `</w:numbering>`,
    "utf8",
  );
};

const createDocumentPackage = (documentXml: Buffer, numberingXml?: Buffer) => {
  const contentTypes = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      (numberingXml
        ? `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>`
        : "") +
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

  const documentRelationships = numberingXml
    ? Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>` +
          `</Relationships>`,
        "utf8",
      )
    : undefined;

  const entries = [
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: relationships },
    { name: "word/document.xml", data: documentXml },
  ];

  if (documentRelationships) {
    entries.push({
      name: "word/_rels/document.xml.rels",
      data: documentRelationships,
    });
  }

  if (numberingXml) {
    entries.push({ name: "word/numbering.xml", data: numberingXml });
  }

  return createZipBuffer(entries);
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

const normalizeTiptapDocument = (content: unknown): TiptapNode[] => {
  if (Array.isArray(content)) {
    return content.filter((node): node is TiptapNode => {
      return typeof node === "object" && node !== null;
    });
  }

  if (!content || typeof content !== "object") {
    return [];
  }

  const maybeDocument = content as TiptapNode;
  if (maybeDocument.type === "doc" && Array.isArray(maybeDocument.content)) {
    return maybeDocument.content.filter((node): node is TiptapNode => {
      return typeof node === "object" && node !== null;
    });
  }

  if (Array.isArray(maybeDocument.content)) {
    return [maybeDocument];
  }

  return [];
};

export const createBlankWordDocument = () => {
  const documentXml = createDocumentXml(`<w:p/>`);
  const numberingXml = createNumberingXml();
  return createDocumentPackage(documentXml, numberingXml);
};

export const createWordDocumentFromTiptap = (content: unknown) => {
  const blocks = normalizeTiptapDocument(content);
  const numberingXml = createNumberingXml();
  const body = renderBlocks(blocks).join("") || `<w:p/>`;
  return createDocumentPackage(createDocumentXml(body), numberingXml);
};

const decodeXmlEntities = (value: string) => {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
};

const parseRunMarks = (runXml: string) => {
  const marks: Array<{ type: string }> = [];

  if (/<w:b\b[^>]*\/?>/.test(runXml)) {
    marks.push({ type: "bold" });
  }

  if (/<w:i\b[^>]*\/?>/.test(runXml)) {
    marks.push({ type: "italic" });
  }

  if (/<w:u\b[^>]*w:val="[^"]*"/.test(runXml)) {
    marks.push({ type: "underline" });
  }

  if (/<w:strike\b[^>]*\/?>/.test(runXml) || /<w:dstrike\b[^>]*\/?>/.test(runXml)) {
    marks.push({ type: "strike" });
  }

  return marks;
};

const extractZipEntries = (buffer: Buffer) => {
  const entries: ZipEntryMap = new Map();
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
    let data: Buffer;

    if (compressionMethod === 0) {
      data = Buffer.from(fileData);
    } else if (compressionMethod === 8) {
      data = inflateRawSync(fileData);
    } else {
      throw new Error(
        `Unsupported zip compression method: ${compressionMethod}`,
      );
    }

    entries.set(fileName, data);
    offset = dataEnd;
  }

  return entries;
};

const readXmlEntry = (entries: ZipEntryMap, name: string) => {
  const entry = entries.get(name);
  return entry ? entry.toString("utf8") : undefined;
};

export const extractWordDocumentXml = (buffer: Buffer) => {
  const entries = extractZipEntries(buffer);
  const documentXml = readXmlEntry(entries, "word/document.xml");

  if (!documentXml) {
    throw new Error("word/document.xml not found in docx buffer");
  }

  return documentXml;
};

export const extractWordDocumentParts = (buffer: Buffer): WordPackageParts => {
  const entries = extractZipEntries(buffer);
  const documentXml = readXmlEntry(entries, "word/document.xml");
  const numberingXml = readXmlEntry(entries, "word/numbering.xml");

  if (!documentXml) {
    throw new Error("word/document.xml not found in docx buffer");
  }

  return numberingXml
    ? {
        documentXml,
        numberingXml,
      }
    : {
        documentXml,
      };
};

const extractParagraphContent = (paragraphXml: string) => {
  const nodes: Array<Record<string, unknown>> = [];
  const runs = paragraphXml.match(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g) ?? [];

  for (const runXml of runs) {
    const marks = parseRunMarks(runXml);
    const tokens =
      runXml.match(
        /<w:t[^>]*>[\s\S]*?<\/w:t>|<w:br\s*\/?>|<w:tab\s*\/?>/g,
      ) ?? [];

    for (const token of tokens) {
      if (token.startsWith("<w:br")) {
        nodes.push({ type: "hardBreak" });
        continue;
      }

      if (token.startsWith("<w:tab")) {
        nodes.push({ type: "text", text: "\t", marks });
        continue;
      }

      const text = token.replace(/^<w:t[^>]*>/, "").replace(/<\/w:t>$/, "");

      const decoded = decodeXmlEntities(text);
      if (decoded.length > 0) {
        nodes.push({
          type: "text",
          text: decoded,
          ...(marks.length > 0 ? { marks } : {}),
        });
      }
    }
  }

  return nodes;
};

const parseNumberingDefinitions = (xml?: string) => {
  const definitions = new Map<number, NumberingDefinition>();
  const numIdToAbstractNumId = new Map<number, number>();

  if (!xml) {
    return { definitions, numIdToAbstractNumId };
  }

  const abstractNumMatches = xml.matchAll(
    /<w:abstractNum[^>]*w:abstractNumId="(\d+)"[\s\S]*?<\/w:abstractNum>/g,
  );

  for (const match of abstractNumMatches) {
    const abstractNumId = Number(match[1]);
    const block = match[0];
    const levels = new Map<number, NumberingLevelDefinition>();

    for (const levelMatch of block.matchAll(
      /<w:lvl[^>]*w:ilvl="(\d+)"[\s\S]*?<w:numFmt[^>]*w:val="([^"]+)"/g,
    )) {
      const format = levelMatch[2] ?? "bullet";
      levels.set(Number(levelMatch[1]), {
        format,
      });
    }

    definitions.set(abstractNumId, { levels });
  }

  for (const numMatch of xml.matchAll(
    /<w:num[^>]*w:numId="(\d+)"[\s\S]*?<w:abstractNumId[^>]*w:val="(\d+)"/g,
  )) {
    numIdToAbstractNumId.set(Number(numMatch[1]), Number(numMatch[2]));
  }

  return { definitions, numIdToAbstractNumId };
};

const resolveListType = (
  numId: number | undefined,
  level: number | undefined,
  numbering: ReturnType<typeof parseNumberingDefinitions>,
): ListType | undefined => {
  if (numId === undefined || level === undefined) {
    return undefined;
  }

  const abstractNumId = numbering.numIdToAbstractNumId.get(numId);
  if (abstractNumId === undefined) {
    return undefined;
  }

  const definition = numbering.definitions.get(abstractNumId);
  if (!definition) {
    return undefined;
  }

  const levelDefinition = definition.levels.get(level);
  if (!levelDefinition) {
    return undefined;
  }

  return levelDefinition.format === "bullet" ? "bulletList" : "orderedList";
};

const parseParagraphNode = (
  paragraphXml: string,
  numbering: ReturnType<typeof parseNumberingDefinitions>,
) => {
  const content = extractParagraphContent(paragraphXml);
  const styleMatch = paragraphXml.match(/<w:pStyle[^>]*w:val="([^"]+)"/);
  const numIdMatch = paragraphXml.match(/<w:numId[^>]*w:val="(\d+)"/);
  const ilvlMatch = paragraphXml.match(/<w:ilvl[^>]*w:val="(\d+)"/);
  const style = styleMatch?.[1];
  const numId = numIdMatch ? Number(numIdMatch[1]) : undefined;
  const level = ilvlMatch ? Number(ilvlMatch[1]) : undefined;
  const listType = resolveListType(numId, level, numbering);
  const isHorizontalRule = /<w:pBdr>[\s\S]*?<w:bottom\b/.test(paragraphXml);
  const indentMatch = paragraphXml.match(/<w:ind[^>]*w:left="(\d+)"/);

  if (listType) {
    return {
      block: {
        type: "paragraph",
        content: content.length > 0 ? content : undefined,
      } as TiptapNode,
      listType,
      level: level ?? 0,
    };
  }

  if (isHorizontalRule) {
    return {
      block: {
        type: "horizontalRule",
      } as TiptapNode,
    };
  }

  if (indentMatch && Number(indentMatch[1]) >= 720) {
    return {
      block: {
        type: "blockquote",
        content: content.length > 0 ? content : undefined,
      } as TiptapNode,
    };
  }

  if (style && /^Heading[1-6]$/.test(style)) {
    return {
      block: {
        type: "heading",
        attrs: {
          level: Number(style.replace("Heading", "")),
        },
        content: content.length > 0 ? content : undefined,
      } as TiptapNode,
    };
  }

  if (paragraphXml.includes("<w:tbl")) {
    return {
      block: {
        type: "paragraph",
        content: content.length > 0 ? content : undefined,
      } as TiptapNode,
    };
  }

  return {
    block: {
      type: "paragraph",
      content: content.length > 0 ? content : undefined,
    } as TiptapNode,
  };
};

const renderTextNode = (node: TiptapNode) => {
  if (node.type === "hardBreak") {
    return `<w:r><w:br/></w:r>`;
  }

  if (typeof node.text !== "string") {
    return "";
  }

  const marks = node.marks ?? [];
  const runProperties: string[] = [];

  for (const mark of marks) {
    if (mark.type === "bold") {
      runProperties.push("<w:b/>");
    }

    if (mark.type === "italic") {
      runProperties.push("<w:i/>");
    }

    if (mark.type === "underline") {
      runProperties.push('<w:u w:val="single"/>');
    }

    if (mark.type === "strike") {
      runProperties.push("<w:strike/>");
    }

    if (mark.type === "code") {
      runProperties.push(
        '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="20"/>',
      );
    }
  }

  const properties =
    runProperties.length > 0 ? `<w:rPr>${runProperties.join("")}</w:rPr>` : "";
  return `<w:r>${properties}<w:t xml:space="preserve">${escapeXml(node.text)}</w:t></w:r>`;
};

const renderInlineNodes = (nodes: TiptapNode[] = []): string => {
  return nodes
    .map((node) => {
      if (
        Array.isArray(node.content) &&
        node.content.length > 0 &&
        !node.text
      ) {
        return renderInlineNodes(node.content);
      }

      return renderTextNode(node);
    })
    .join("");
};

const createParagraphXml = (
  paragraph: TiptapNode,
  context: RenderContext = {},
) => {
  const nodes = paragraph.content ?? [];
  const runs = renderInlineNodes(nodes);
  const paragraphProperties: string[] = [];

  if (paragraph.type === "heading") {
    const level = Number(paragraph.attrs?.level ?? 1);
    paragraphProperties.push(
      `<w:pStyle w:val="Heading${Math.min(Math.max(level, 1), 6)}"/>`,
    );
  }

  if (paragraph.type === "blockquote") {
    paragraphProperties.push('<w:ind w:left="720" w:right="360"/>');
  }

  if (paragraph.type === "codeBlock") {
    paragraphProperties.push(
      '<w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="20"/></w:rPr>',
    );
  }

  if (paragraph.type === "horizontalRule") {
    return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:p>`;
  }

  if (context.listType && context.numId !== undefined) {
    paragraphProperties.push(
      `<w:numPr><w:ilvl w:val="${context.listLevel ?? 0}"/><w:numId w:val="${context.numId}"/></w:numPr>`,
    );
  }

  const properties =
    paragraphProperties.length > 0
      ? `<w:pPr>${paragraphProperties.join("")}</w:pPr>`
      : "";
  return runs.length > 0
    ? `<w:p>${properties}${runs}</w:p>`
    : `<w:p>${properties}</w:p>`;
};

const renderBlockXml = (
  node: TiptapNode,
  context: RenderContext = {},
): string => {
  if (node.type === "doc") {
    return renderBlocks(node.content ?? [], context).join("");
  }

  if (node.type === "bulletList" || node.type === "orderedList") {
    const nextContext: RenderContext = {
      listType: node.type,
      listLevel: context.listLevel ?? 0,
      numId: node.type === "bulletList" ? 1 : 2,
    };

    return (node.content ?? [])
      .map((child) => {
        if (child.type !== "listItem") {
          return renderBlockXml(child, context);
        }

        return renderListItemXml(child, nextContext);
      })
      .join("");
  }

  if (node.type === "listItem") {
    return renderListItemXml(node, context);
  }

  if (node.type === "blockquote") {
    const content = Array.isArray(node.content) ? node.content : [];
    return content.map((child) => renderBlockXml(child, context)).join("");
  }

  if (
    node.type === "paragraph" ||
    node.type === "heading" ||
    node.type === "codeBlock" ||
    node.type === "horizontalRule"
  ) {
    return createParagraphXml(node, context);
  }

  if (Array.isArray(node.content) && node.content.length > 0) {
    return renderBlocks(node.content, context).join("");
  }

  if (typeof node.text === "string") {
    return createParagraphXml({ type: "paragraph", content: [node] }, context);
  }

  return `<w:p/>`;
};

const renderListItemXml = (node: TiptapNode, context: RenderContext) => {
  const children = node.content ?? [];
  const blocks: string[] = [];
  let firstParagraphRendered = false;

  for (const child of children) {
    if (child.type === "bulletList" || child.type === "orderedList") {
      blocks.push(
        renderBlockXml(child, {
          listType: child.type,
          listLevel: (context.listLevel ?? 0) + 1,
          numId: child.type === "bulletList" ? 1 : 2,
        }),
      );
      continue;
    }

    if (!firstParagraphRendered) {
      blocks.push(
        createParagraphXml(
          child.type ? child : { type: "paragraph", content: [child] },
          context,
        ),
      );
      firstParagraphRendered = true;
      continue;
    }

    blocks.push(renderBlockXml(child, context));
  }

  if (!firstParagraphRendered) {
    blocks.unshift(createParagraphXml({ type: "paragraph" }, context));
  }

  return blocks.join("");
};

const renderBlocks = (
  nodes: TiptapNode[] = [],
  context: RenderContext = {},
) => {
  const blocks: string[] = [];

  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (!node) {
      continue;
    }

    if (node.type === "bulletList" || node.type === "orderedList") {
      const currentListType = node.type;
      const currentLevel = context.listLevel ?? 0;
      const currentNumId = currentListType === "bulletList" ? 1 : 2;

      blocks.push(
        renderBlockXml(node, {
          listType: currentListType,
          listLevel: currentLevel,
          numId: currentNumId,
        }),
      );
      continue;
    }

    blocks.push(renderBlockXml(node, context));
  }

  return blocks;
};

const groupListItems = (
  items: Array<{
    block: TiptapNode;
    listType: ListType;
    level: number;
  }>,
  startIndex: number,
  level: number,
  listType: ListType,
): [TiptapNode | null, number] => {
  const listItems: TiptapNode[] = [];
  let index = startIndex;

  while (index < items.length) {
    const item = items[index];
    if (!item) {
      break;
    }

    if (item.level < level || item.listType !== listType) {
      break;
    }

    if (item.level > level) {
      const previousItem = listItems[listItems.length - 1];
      if (!previousItem) {
        index++;
        continue;
      }

      const [nestedList, nextIndex] = groupListItems(
        items,
        index,
        item.level,
        item.listType,
      );

      if (nestedList) {
        previousItem.content ??= [];
        previousItem.content.push(nestedList);
      }

      index = nextIndex;
      continue;
    }

    listItems.push({
      type: "listItem",
      content: [item.block],
    });
    index++;

    while (index < items.length) {
      const nestedItem = items[index];
      if (!nestedItem) {
        break;
      }
      if (nestedItem.level <= level) {
        break;
      }
      if (!nestedItem.listType) {
        break;
      }
      const [nestedList, nextIndex] = groupListItems(
        items,
        index,
        nestedItem.level,
        nestedItem.listType,
      );

      if (nestedList) {
        const previousItem = listItems[listItems.length - 1];
        if (previousItem) {
          previousItem.content ??= [];
          previousItem.content.push(nestedList);
        }
      }

      index = nextIndex;
    }
  }

  if (listItems.length === 0) {
    return [null, startIndex];
  }

  return [
    {
      type: listType,
      content: listItems,
    },
    index,
  ];
};

export const convertWordDocumentXmlToTiptap = (
  xml: string,
  numberingXml?: string,
) => {
  const paragraphs = xml.match(/<w:p[\s\S]*?<\/w:p>/g) ?? [];
  const numbering = parseNumberingDefinitions(numberingXml);
  const flatBlocks: Array<{
    block: TiptapNode;
    listType?: ListType;
    level?: number;
  }> = [];

  for (const paragraphXml of paragraphs) {
    const parsed = parseParagraphNode(paragraphXml, numbering);
    flatBlocks.push(parsed);
  }

  const docContent: TiptapNode[] = [];

  for (let index = 0; index < flatBlocks.length; index++) {
    const item = flatBlocks[index];
    if (!item) {
      continue;
    }

    if (item.listType && item.level !== undefined) {
      const [listNode, nextIndex] = groupListItems(
        flatBlocks as Array<{
          block: TiptapNode;
          listType: ListType;
          level: number;
        }>,
        index,
        item.level,
        item.listType,
      );

      if (listNode) {
        docContent.push(listNode);
      }

      index = nextIndex - 1;
      continue;
    }

    docContent.push(item.block);
  }

  return {
    type: "doc",
    content: docContent,
  };
};
