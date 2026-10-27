import { randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import mammoth from "mammoth";
import type {
  PearlAttachment,
  PearlAttachmentInput,
} from "../shared/pearl-chat";

const maxFileBytes = 20 * 1024 * 1024;
const maxDocumentCharacters = 200_000;
const maxPdfPages = 100;
const maxScannedPages = 12;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type StoredPart = { file: string; mime: string };
type StoredAttachment = { text: string; images: StoredPart[] };

function decoded(input: PearlAttachmentInput): Buffer {
  if (
    !input ||
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 150 ||
    /[/\\\u0000-\u001f\u007f]/.test(input.name) ||
    typeof input.base64 !== "string" ||
    input.base64.length > Math.ceil(maxFileBytes / 3) * 4 + 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      input.base64,
    )
  )
    throw new Error("Invalid attachment");
  const bytes = Buffer.from(input.base64, "base64");
  if (
    !bytes.length ||
    bytes.length > maxFileBytes ||
    bytes.toString("base64") !== input.base64
  )
    throw new Error("Attachment exceeds 20 MB or has invalid data");
  return bytes;
}

function imageMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
    return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return null;
}

function textFromBytes(bytes: Buffer): string {
  let value: string;
  try {
    value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("This text attachment is not valid UTF-8");
  }
  if (value.includes("\u0000"))
    throw new Error("Binary data cannot be attached as text");
  return value;
}

export class PearlAttachments {
  constructor(private readonly dataRoot: string) {}

  private directory(chatId: string, id?: string): string {
    if (!uuid.test(chatId) || (id && !uuid.test(id)))
      throw new Error("Invalid attachment owner");
    return id
      ? join(this.dataRoot, "pearl-attachments", chatId, id)
      : join(this.dataRoot, "pearl-attachments", chatId);
  }

  private stored(chatId: string, attachmentId: string): StoredAttachment {
    const owner = this.directory(chatId);
    const directory = this.directory(chatId, attachmentId);
    if (!lstatSync(owner).isDirectory() || !lstatSync(directory).isDirectory())
      throw new Error("Invalid stored attachment");
    const path = join(directory, "record.json");
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 2_000_000)
      throw new Error("Invalid stored attachment");
    const record: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!record || typeof record !== "object")
      throw new Error("Invalid stored attachment");
    const value = record as Record<string, unknown>;
    if (
      typeof value.text !== "string" ||
      value.text.length > maxDocumentCharacters ||
      !Array.isArray(value.images) ||
      value.images.length > maxScannedPages ||
      value.images.some(
        (part: unknown) =>
          !part ||
          typeof part !== "object" ||
          !/^\d{1,2}\.bin$/.test((part as StoredPart).file) ||
          !["image/png", "image/jpeg", "image/webp"].includes(
            (part as StoredPart).mime,
          ),
      )
    )
      throw new Error("Invalid stored attachment");
    return value as StoredAttachment;
  }

  async prepare(
    chatId: string,
    input: PearlAttachmentInput,
  ): Promise<PearlAttachment> {
    const bytes = decoded(input);
    const name = input.name.trim();
    const suffix = name.split(".").at(-1)?.toLowerCase();
    const mime = imageMime(bytes);
    let kind: PearlAttachment["kind"];
    let text = "";
    let pages: number | undefined;
    const imageBytes: { bytes: Buffer; mime: string }[] = [];
    if (mime) {
      kind = "image";
      imageBytes.push({ bytes, mime });
    } else if (suffix === "pdf" && bytes.toString("ascii", 0, 5) === "%PDF-") {
      kind = "pdf";
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const task = pdfjs.getDocument({
        data: new Uint8Array(bytes),
        useSystemFonts: true,
      });
      const pdf = await task.promise;
      try {
        pages = pdf.numPages;
        if (pages > maxPdfPages)
          throw new Error("PDF exceeds 100 pages. Attach a smaller section.");
        const sections: string[] = [];
        for (let index = 1; index <= pages; index++) {
          const page = await pdf.getPage(index);
          const content = await page.getTextContent();
          const pageText = content.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ")
            .trim();
          if (pageText.length > 30)
            sections.push(`[Page ${index}]\n${pageText}`);
          else {
            if (imageBytes.length >= maxScannedPages)
              throw new Error(
                "Scanned PDF exceeds 12 visual pages. Attach a smaller section.",
              );
            const viewport = page.getViewport({ scale: 1 });
            const scale = Math.min(
              1.5,
              1200 / viewport.width,
              1600 / viewport.height,
            );
            const sized = page.getViewport({ scale });
            const canvas = createCanvas(
              Math.ceil(sized.width),
              Math.ceil(sized.height),
            );
            await page.render({
              canvas: canvas as unknown as HTMLCanvasElement,
              canvasContext: canvas.getContext(
                "2d",
              ) as unknown as CanvasRenderingContext2D,
              viewport: sized,
            }).promise;
            imageBytes.push({
              bytes: canvas.toBuffer("image/png"),
              mime: "image/png",
            });
          }
        }
        text = sections.join("\n\n");
      } finally {
        await task.destroy();
      }
    } else if (
      suffix === "docx" &&
      bytes.subarray(0, 2).toString("ascii") === "PK"
    ) {
      kind = "docx";
      text = (await mammoth.extractRawText({ buffer: bytes })).value;
    } else if (
      ["txt", "md", "markdown", "csv", "json"].includes(suffix || "")
    ) {
      kind = "text";
      text = textFromBytes(bytes);
    } else {
      throw new Error("Attach a PNG, JPEG, WebP, PDF, DOCX, or text document");
    }
    if (text.length > maxDocumentCharacters)
      throw new Error(
        "Document text exceeds 200,000 characters. Attach a smaller section.",
      );
    const id = randomUUID();
    const directory = this.directory(chatId, id);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    try {
      const images = imageBytes.map((part, index) => {
        const file = `${index}.bin`;
        writeFileSync(join(directory, file), part.bytes, { mode: 0o600 });
        return { file, mime: part.mime };
      });
      writeFileSync(
        join(directory, "record.json"),
        JSON.stringify({ text, images } satisfies StoredAttachment),
        { mode: 0o600 },
      );
    } catch (error) {
      rmSync(directory, { recursive: true, force: true });
      throw error;
    }
    return {
      id,
      name,
      kind,
      bytes: bytes.length,
      needsVision: imageBytes.length > 0,
      ...(pages ? { pages } : {}),
    };
  }

  content(
    chatId: string,
    attachment: PearlAttachment,
  ): { text: string; images: string[] } {
    const directory = this.directory(chatId, attachment.id);
    const record = this.stored(chatId, attachment.id);
    return {
      text: record.text,
      images: record.images.map((image) => {
        const path = join(directory, image.file);
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.size > maxFileBytes)
          throw new Error("Invalid stored attachment");
        return `data:${image.mime};base64,${readFileSync(path).toString("base64")}`;
      }),
    };
  }

  text(chatId: string, attachmentId: string): string {
    return this.stored(chatId, attachmentId).text;
  }

  remove(chatId: string, attachmentId: string): void {
    rmSync(this.directory(chatId, attachmentId), {
      recursive: true,
      force: true,
    });
  }

  removeChat(chatId: string): void {
    rmSync(this.directory(chatId), { recursive: true, force: true });
  }
}
