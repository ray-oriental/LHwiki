import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { DOMParser } from '@xmldom/xmldom';
import { parseDocx } from '../public/docx-import.js';

function minimalDocx(xml, method = 8) {
  const name = Buffer.from('word/document.xml');
  const plain = Buffer.from(xml);
  const compressed = method === 8 ? deflateRawSync(plain) : plain;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(plain.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(plain.length, 24);
  central.writeUInt16LE(name.length, 28);
  const centralOffset = local.length + name.length + compressed.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + name.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  const archive = Buffer.concat([local, name, compressed, central, name, eocd]);
  return { size: archive.length, arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) };
}

test('DOCX deflate path imports headings, formatted text and tables', async () => {
  const originalParser = globalThis.DOMParser;
  globalThis.DOMParser = DOMParser;
  const xml = `<?xml version="1.0"?><w:document xmlns:w="urn:word"><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>标题</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>重点</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  </w:body></w:document>`;
  try {
    const result = await parseDocx(minimalDocx(xml));
    assert.deepEqual(result.blocks.map(block => block.type), ['heading', 'paragraph', 'table']);
    assert.equal(result.blocks[1].text, '**重点**');
    assert.deepEqual(result.blocks[2].rows, [['A', 'B']]);
  } finally {
    globalThis.DOMParser = originalParser;
  }
});

test('DOCX import rejects corrupt archives and unsupported compression', async () => {
  await assert.rejects(() => parseDocx({ size: 4, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer }), /有效的 DOCX/);
  await assert.rejects(() => parseDocx(minimalDocx('<w:document/>', 99)), /不支持的压缩方式/);
});
