/* Piara — conversor Markdown -> .docx (Word), sin dependencias externas.
 * Genera el paquete OOXML y escribe el ZIP directamente en Node (método "store" + CRC32),
 * con nombres de entrada usando "/" (requisito de Word). No usa PowerShell.
 *
 * Uso: node tools/md-to-docx.js <entrada.md> <salida.docx>
 * Soporta: # ## ### encabezados, listas "- ", **negrita**, tablas |..|, bloques ``` y párrafos.
 */
const fs = require("fs");
const zlib = require("zlib");

const [, , mdPath, outPath] = process.argv;
if (!mdPath || !outPath) { console.error("Uso: node tools/md-to-docx.js <entrada.md> <salida.docx>"); process.exit(1); }

const md = fs.readFileSync(mdPath, "utf8").replace(/\r\n/g, "\n");
const lines = md.split("\n");

const xmlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function runs(text, baseRpr) {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g).filter((x) => x !== "");
  return parts.map((p) => {
    const bold = /^\*\*[^*]+\*\*$/.test(p);
    const t = bold ? p.slice(2, -2) : p;
    const rpr = (baseRpr || "") + (bold ? "<w:b/>" : "");
    return `<w:r><w:rPr>${rpr}</w:rPr><w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r>`;
  }).join("");
}
const para = (inner, pPr) => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${inner}</w:p>`;

const body = [];
let inCode = false;
for (const raw of lines) {
  const line = raw.replace(/\t/g, "    ");
  if (line.trim().startsWith("```")) { inCode = !inCode; continue; }
  if (inCode) { body.push(para(runs(line, '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/>'), '<w:shd w:val="clear" w:fill="F2F2F2"/><w:spacing w:after="0"/>')); continue; }
  if (line.trim() === "") continue;
  if (line.trim() === "---") { body.push(para("", '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="AAAAAA"/></w:pBdr>')); continue; }
  let m;
  if ((m = line.match(/^#\s+(.*)/))) { body.push(para(runs(m[1], '<w:b/><w:sz w:val="40"/><w:color w:val="1F6B4C"/>'), '<w:spacing w:before="240" w:after="120"/>')); continue; }
  if ((m = line.match(/^##\s+(.*)/))) { body.push(para(runs(m[1], '<w:b/><w:sz w:val="30"/><w:color w:val="1F6B4C"/>'), '<w:spacing w:before="200" w:after="100"/>')); continue; }
  if ((m = line.match(/^###\s+(.*)/))) { body.push(para(runs(m[1], '<w:b/><w:sz w:val="26"/>'), '<w:spacing w:before="160" w:after="80"/>')); continue; }
  if (/^\s*\|.*\|\s*$/.test(line)) {
    const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    body.push(para(runs(cells.join("   |   "), '<w:sz w:val="20"/>'), '<w:spacing w:after="20"/>'));
    continue;
  }
  if ((m = line.match(/^\s*[-*]\s+(.*)/))) { body.push(para(runs("•  " + m[1], '<w:sz w:val="22"/>'), '<w:ind w:left="360"/><w:spacing w:after="20"/>')); continue; }
  body.push(para(runs(line, '<w:sz w:val="22"/>'), '<w:spacing w:after="80"/>'));
}

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;
const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

/* ---- ZIP writer mínimo (deflate) ---- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function zip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const comp = zlib.deflateRawSync(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);       // version
    local.writeUInt16LE(0, 6);        // flags
    local.writeUInt16LE(8, 8);        // method: deflate
    local.writeUInt16LE(0, 10);       // time
    local.writeUInt16LE(0, 12);       // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8); cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(0, 42);          // offset of local header
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameBuf]));
    offset += local.length + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(central);
  const centralOffset = offset;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

const buf = zip([
  { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
  { name: "_rels/.rels", data: Buffer.from(rels, "utf8") },
  { name: "word/document.xml", data: Buffer.from(documentXml, "utf8") },
]);
fs.writeFileSync(outPath, buf);
console.log(`DOCX generado: ${outPath} (${body.length} párrafos, ${buf.length} bytes).`);
