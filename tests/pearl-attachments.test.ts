// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PearlAttachments } from "../src/main/pearl-attachments";
import JSZip from "jszip";

const chatId = "11111111-1111-1111-1111-111111111111";
const roots: string[] = [];
function onePagePdf(scanned = false): Buffer {
  const stream = scanned
    ? "0 0 0 rg 10 10 10 10 re f"
    : "BT /F1 14 Tf 50 150 Td (Project overview and implementation notes) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length + 1} >>\nstream\n${stream}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = Buffer.byteLength(body);
  body += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(body);
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "scully-attachment-"));
  roots.push(root);
  return new PearlAttachments(root);
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

it("extracts text documents without requiring vision and removes their storage", async () => {
  const service = fixture();
  const item = await service.prepare(chatId, {
    name: "notes.md",
    base64: Buffer.from("Project notes\nNext step: test").toString("base64"),
  });
  expect(item).toMatchObject({
    name: "notes.md",
    kind: "text",
    needsVision: false,
  });
  expect(service.content(chatId, item)).toEqual({
    text: "Project notes\nNext step: test",
    images: [],
  });
  service.remove(chatId, item.id);
  expect(() => service.content(chatId, item)).toThrow();
});

it("keeps image bytes as a vision input and rejects forged owners", async () => {
  const service = fixture();
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=";
  const item = await service.prepare(chatId, {
    name: "screen.png",
    base64: png,
  });
  expect(item.needsVision).toBe(true);
  expect(service.content(chatId, item).images[0]).toBe(
    `data:image/png;base64,${png}`,
  );
  expect(() => service.content("../other", item)).toThrow(
    "Invalid attachment owner",
  );
});

it("extracts searchable PDF text for a text-only model", async () => {
  const service = fixture();
  const item = await service.prepare(chatId, {
    name: "overview.pdf",
    base64: onePagePdf().toString("base64"),
  });
  expect(item).toMatchObject({ kind: "pdf", pages: 1, needsVision: false });
  expect(service.content(chatId, item).text).toContain(
    "Project overview and implementation",
  );
});

it("marks pages without extractable text as requiring image analysis", async () => {
  const service = fixture();
  const item = await service.prepare(chatId, {
    name: "scan.pdf",
    base64: onePagePdf(true).toString("base64"),
  });
  expect(item).toMatchObject({ kind: "pdf", pages: 1, needsVision: true });
  expect(service.content(chatId, item).images[0]).toMatch(
    /^data:image\/png;base64,/,
  );
});

it("extracts DOCX paragraph text without requiring vision", async () => {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Product requirements</w:t></w:r></w:p></w:body></w:document>',
  );
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  const service = fixture();
  const item = await service.prepare(chatId, {
    name: "requirements.docx",
    base64: bytes.toString("base64"),
  });
  expect(item).toMatchObject({ kind: "docx", needsVision: false });
  expect(service.content(chatId, item).text).toContain("Product requirements");
});

it("rejects unsupported, malformed and oversized attachment inputs", async () => {
  const service = fixture();
  await expect(
    service.prepare(chatId, { name: "../bad.txt", base64: "YQ==" }),
  ).rejects.toThrow();
  await expect(
    service.prepare(chatId, { name: "bad.txt", base64: "%%%" }),
  ).rejects.toThrow();
  await expect(
    service.prepare(chatId, { name: "bad.exe", base64: "YQ==" }),
  ).rejects.toThrow();
  await expect(
    service.prepare(chatId, {
      name: "large.txt",
      base64: Buffer.alloc(20 * 1024 * 1024 + 1).toString("base64"),
    }),
  ).rejects.toThrow();
});

it("rejects tampered attachment metadata that points outside its storage", async () => {
  const service = fixture();
  const item = await service.prepare(chatId, {
    name: "notes.txt",
    base64: Buffer.from("safe").toString("base64"),
  });
  writeFileSync(
    join(roots.at(-1)!, "pearl-attachments", chatId, item.id, "record.json"),
    JSON.stringify({
      text: "safe",
      images: [{ file: "../../outside", mime: "image/png" }],
    }),
  );
  expect(() => service.content(chatId, item)).toThrow(
    "Invalid stored attachment",
  );
});
