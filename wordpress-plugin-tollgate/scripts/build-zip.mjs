import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputPath = path.join(pluginDir, "dist", "tollgate.zip");
const files = [
  { source: "tollgate.php", target: "tollgate/tollgate.php" },
  { source: "readme.txt", target: "tollgate/readme.txt" },
];

const crcTable = new Uint32Array(256);
for (let i = 0; i < crcTable.length; i += 1) {
  let value = i;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[i] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate =
    ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

async function entry({ source, target }, offset) {
  const data = await readFile(path.join(pluginDir, source));
  const name = Buffer.from(target, "utf8");
  const checksum = crc32(data);
  const { dosDate, dosTime } = dosDateTime(new Date());
  const localHeader = Buffer.concat([
    u32(0x04034b50),
    u16(20),
    u16(0x0800),
    u16(0),
    u16(dosTime),
    u16(dosDate),
    u32(checksum),
    u32(data.byteLength),
    u32(data.byteLength),
    u16(name.byteLength),
    u16(0),
    name,
  ]);
  const centralHeader = Buffer.concat([
    u32(0x02014b50),
    u16(20),
    u16(20),
    u16(0x0800),
    u16(0),
    u16(dosTime),
    u16(dosDate),
    u32(checksum),
    u32(data.byteLength),
    u32(data.byteLength),
    u16(name.byteLength),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(offset),
    name,
  ]);
  return { local: Buffer.concat([localHeader, data]), central: centralHeader };
}

async function main() {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const file of files) {
    const built = await entry(file, offset);
    localParts.push(built.local);
    centralParts.push(built.central);
    offset += built.local.byteLength;
  }
  const central = Buffer.concat(centralParts);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.byteLength),
    u32(offset),
    u16(0),
  ]);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.concat([...localParts, central, end]));
  console.log(`Built ${path.relative(pluginDir, outputPath)}`);
}

await main();
