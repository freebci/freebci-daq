interface ZipFileInput {
  path: string;
  data: string;
}

export type ZipFileMap = Record<string, string>;

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const crcTable = createCrcTable();

function createCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function concat(parts: Uint8Array[], totalLength: number): Uint8Array {
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

export function createStoredZip(files: ZipFileInput[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const entries: Array<{
    pathBytes: Uint8Array;
    dataBytes: Uint8Array;
    crc: number;
    localHeaderOffset: number;
  }> = [];
  let offset = 0;

  for (const file of files) {
    const pathBytes = encoder.encode(file.path);
    const dataBytes = encoder.encode(file.data);
    const crc = crc32(dataBytes);
    const localHeader = new Uint8Array(30 + pathBytes.byteLength);
    const localView = new DataView(localHeader.buffer);
    writeUint32(localView, 0, LOCAL_FILE_HEADER_SIGNATURE);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, 0);
    writeUint16(localView, 12, 0);
    writeUint32(localView, 14, crc);
    writeUint32(localView, 18, dataBytes.byteLength);
    writeUint32(localView, 22, dataBytes.byteLength);
    writeUint16(localView, 26, pathBytes.byteLength);
    writeUint16(localView, 28, 0);
    localHeader.set(pathBytes, 30);

    entries.push({
      pathBytes,
      dataBytes,
      crc,
      localHeaderOffset: offset,
    });
    localParts.push(localHeader, dataBytes);
    offset += localHeader.byteLength + dataBytes.byteLength;
  }

  const centralDirectoryOffset = offset;
  for (const entry of entries) {
    const centralHeader = new Uint8Array(46 + entry.pathBytes.byteLength);
    const view = new DataView(centralHeader.buffer);
    writeUint32(view, 0, CENTRAL_DIRECTORY_SIGNATURE);
    writeUint16(view, 4, 20);
    writeUint16(view, 6, 20);
    writeUint16(view, 8, 0);
    writeUint16(view, 10, 0);
    writeUint16(view, 12, 0);
    writeUint16(view, 14, 0);
    writeUint32(view, 16, entry.crc);
    writeUint32(view, 20, entry.dataBytes.byteLength);
    writeUint32(view, 24, entry.dataBytes.byteLength);
    writeUint16(view, 28, entry.pathBytes.byteLength);
    writeUint16(view, 30, 0);
    writeUint16(view, 32, 0);
    writeUint16(view, 34, 0);
    writeUint16(view, 36, 0);
    writeUint32(view, 38, 0);
    writeUint32(view, 42, entry.localHeaderOffset);
    centralHeader.set(entry.pathBytes, 46);
    centralParts.push(centralHeader);
    offset += centralHeader.byteLength;
  }

  const centralDirectorySize = offset - centralDirectoryOffset;
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint32(endView, 0, END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, entries.length);
  writeUint16(endView, 10, entries.length);
  writeUint32(endView, 12, centralDirectorySize);
  writeUint32(endView, 16, centralDirectoryOffset);
  writeUint16(endView, 20, 0);

  return concat([...localParts, ...centralParts, end], offset + end.byteLength);
}

function readUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

export function readStoredZip(bytes: ArrayBuffer): ZipFileMap {
  const view = new DataView(bytes);
  const out: ZipFileMap = {};
  let offset = 0;

  while (offset + 30 <= bytes.byteLength) {
    const signature = readUint32(view, offset);
    if (signature !== LOCAL_FILE_HEADER_SIGNATURE) {
      break;
    }

    const compressionMethod = readUint16(view, offset + 8);
    if (compressionMethod !== 0) {
      throw new Error('Only stored .eegai.zip entries are supported.');
    }

    const expectedCrc = readUint32(view, offset + 14);
    const compressedSize = readUint32(view, offset + 18);
    const fileNameLength = readUint16(view, offset + 26);
    const extraLength = readUint16(view, offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    const dataStart = nameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;

    if (dataEnd > bytes.byteLength) {
      throw new Error('Invalid .eegai.zip bundle.');
    }

    const name = decoder.decode(new Uint8Array(bytes, nameStart, fileNameLength));
    const data = new Uint8Array(bytes, dataStart, compressedSize);
    if (crc32(data) !== expectedCrc) {
      throw new Error(`CRC mismatch for bundle entry: ${name}`);
    }
    out[name] = decoder.decode(data);
    offset = dataEnd;
  }

  return out;
}
