import { createWriteStream } from "node:fs";
import yauzl from "yauzl";
import yazl from "yazl";
import { assertSafeZipEntryName } from "./zip-names.js";

export interface ZipEntry {
  readonly name: string;
  readonly data: Buffer;
}

/** Writes entries to a zip file; every entry name is validated first. */
export async function createSafeZip(entries: readonly ZipEntry[], outPath: string): Promise<{ fileCount: number }> {
  if (entries.length === 0) throw new Error("createSafeZip: no entries");
  const names = new Set<string>();
  for (const entry of entries) {
    assertSafeZipEntryName(entry.name);
    if (names.has(entry.name)) throw new Error(`createSafeZip: duplicate entry ${entry.name}`);
    names.add(entry.name);
  }
  const zip = new yazl.ZipFile();
  for (const entry of entries) zip.addBuffer(entry.data, entry.name, { mtime: new Date(0), mode: 0o100644 });
  zip.end();
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(outPath);
    output.on("close", () => resolve());
    output.on("error", reject);
    zip.outputStream.on("error", reject);
    zip.outputStream.pipe(output);
  });
  return { fileCount: entries.length };
}

export interface ReadZipOptions {
  readonly maxEntries?: number;
  readonly maxBytes?: number;
}

export const DEFAULT_MAX_ZIP_ENTRIES = 500;
export const DEFAULT_MAX_ZIP_BYTES = 64 * 1024 * 1024;

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: true }, (error, zipfile) => {
      if (error) reject(error);
      else resolve(zipfile);
    });
  });
}

function readEntry(zipfile: yauzl.ZipFile, entry: yauzl.Entry, remainingBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }
      const chunks: Buffer[] = [];
      let received = 0;
      stream.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > remainingBytes) {
          stream.destroy();
          reject(new Error(`Zip entry ${entry.fileName} exceeds the byte budget while inflating`));
          return;
        }
        chunks.push(chunk);
      });
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  });
}

/** Reads all file entries with name checks and zip-bomb limits (entry count, declared and actual bytes). */
export async function readZipEntries(path: string, options: ReadZipOptions = {}): Promise<ZipEntry[]> {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ZIP_ENTRIES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_ZIP_BYTES;
  const zipfile = await openZip(path);
  if (zipfile.entryCount > maxEntries) {
    zipfile.close();
    throw new Error(`Zip has ${zipfile.entryCount} entries, more than the allowed ${maxEntries}`);
  }
  const entries: ZipEntry[] = [];
  let totalBytes = 0;
  return new Promise<ZipEntry[]>((resolve, reject) => {
    const fail = (error: Error): void => {
      zipfile.close();
      reject(error);
    };
    zipfile.on("error", fail);
    zipfile.on("end", () => resolve(entries));
    zipfile.on("entry", (entry: yauzl.Entry) => {
      try {
        if (entry.fileName.endsWith("/")) {
          zipfile.readEntry();
          return;
        }
        assertSafeZipEntryName(entry.fileName);
        totalBytes += entry.uncompressedSize;
        if (totalBytes > maxBytes) throw new Error(`Zip declares more than ${maxBytes} bytes uncompressed`);
      } catch (error: unknown) {
        fail(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      readEntry(zipfile, entry, entry.uncompressedSize)
        .then((data) => {
          entries.push({ name: entry.fileName, data });
          zipfile.readEntry();
        })
        .catch((error: unknown) => fail(error instanceof Error ? error : new Error(String(error))));
    });
    zipfile.readEntry();
  });
}
