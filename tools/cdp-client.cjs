/**
 * Minimal CDP (Chrome DevTools Protocol) client using raw net.Socket.
 * Works with Node.js v24 built-in (no 'ws' package required).
 * Also provides browser detection prioritizing unmanaged Chromium builds.
 */
'use strict';

const net = require('net');
const crypto = require('crypto');
const fs = require('fs');

function getBrowserPath() {
  const candidates = [
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return 'chrome';
}

function buildFrame(payload) {
  const raw = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const mask = crypto.randomBytes(4);
  const masked = Buffer.allocUnsafe(raw.length);
  for (let i = 0; i < raw.length; i++) {
    masked[i] = raw[i] ^ mask[i % 4];
  }
  let header;
  if (raw.length <= 125) {
    header = Buffer.from([0x81, 0x80 | raw.length, mask[0], mask[1], mask[2], mask[3]]);
  } else if (raw.length <= 65535) {
    header = Buffer.allocUnsafe(8);
    header[0] = 0x81;
    header[1] = 0xfe;
    header.writeUInt16BE(raw.length, 2);
    header[4] = mask[0]; header[5] = mask[1]; header[6] = mask[2]; header[7] = mask[3];
  } else {
    header = Buffer.allocUnsafe(14);
    header[0] = 0x81;
    header[1] = 0xff;
    header.writeBigUInt64BE(BigInt(raw.length), 2);
    header[10] = mask[0]; header[11] = mask[1]; header[12] = mask[2]; header[13] = mask[3];
  }
  return Buffer.concat([header, masked]);
}

function parseFrames(buf) {
  const frames = [];
  let offset = 0;
  while (offset < buf.length) {
    if (offset + 2 > buf.length) break;
    const first = buf[offset];
    const second = buf[offset + 1];
    const masked = !!(second & 0x80);
    let payloadLen = second & 0x7f;
    let headerLen = 2;
    if (payloadLen === 126) {
      if (offset + 4 > buf.length) break;
      payloadLen = buf.readUInt16BE(offset + 2);
      headerLen = 4;
    } else if (payloadLen === 127) {
      if (offset + 10 > buf.length) break;
      payloadLen = Number(buf.readBigUInt64BE(offset + 2));
      headerLen = 10;
    }
    if (masked) headerLen += 4;
    const totalLen = headerLen + payloadLen;
    if (offset + totalLen > buf.length) break;
    let payload = buf.slice(offset + headerLen, offset + totalLen);
    if (masked) {
      const maskKey = buf.slice(offset + (headerLen - 4), offset + headerLen);
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
    }
    const opcode = first & 0x0f;
    if (opcode === 0x01 || opcode === 0x02) {
      frames.push(payload.toString('utf8'));
    }
    offset += totalLen;
  }
  return { frames, remaining: buf.slice(offset) };
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(wsUrl);
    const sock = net.connect(parseInt(u.port, 10), u.hostname, () => {
      const key = crypto.randomBytes(16).toString('base64');
      sock.write(
        `GET ${u.pathname} HTTP/1.1\r\n` +
        `Host: ${u.host}\r\n` +
        `Origin: http://${u.host}\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\n` +
        `Sec-WebSocket-Version: 13\r\n` +
        `\r\n`
      );
    });

    let upgraded = false;
    let recvBuf = Buffer.alloc(0);
    let headerBuf = '';
    const pending = new Map();
    const eventHandlers = [];

    sock.on('data', (d) => {
      if (!upgraded) {
        headerBuf += d.toString('binary');
        const idx = headerBuf.indexOf('\r\n\r\n');
        if (idx !== -1 && headerBuf.includes('101')) {
          upgraded = true;
          const afterHeader = Buffer.from(headerBuf.slice(idx + 4), 'binary');
          recvBuf = afterHeader;
          if (recvBuf.length > 0) processBuffer();
          resolve(client);
        } else if (headerBuf.includes('\r\n\r\n') && !headerBuf.includes('101')) {
          sock.destroy();
          reject(new Error('CDP WebSocket upgrade rejected: ' + headerBuf.slice(0, 200)));
        }
      } else {
        recvBuf = Buffer.concat([recvBuf, d]);
        processBuffer();
      }
    });

    sock.on('error', (e) => {
      if (!upgraded) reject(e);
    });

    function processBuffer() {
      const { frames, remaining } = parseFrames(recvBuf);
      recvBuf = remaining;
      for (const frame of frames) {
        try {
          const msg = JSON.parse(frame);
          if (msg.id !== undefined && pending.has(msg.id)) {
            const { resolve: res, reject: rej } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) rej(new Error(msg.error.message));
            else res(msg.result);
          } else {
            eventHandlers.forEach(fn => fn(msg));
          }
        } catch (_) {}
      }
    }

    let nextId = 1;
    const client = {
      send(method, params = {}) {
        const id = nextId++;
        return new Promise((res, rej) => {
          pending.set(id, { resolve: res, reject: rej });
          sock.write(buildFrame(JSON.stringify({ id, method, params })));
        });
      },
      onEvent(fn) {
        eventHandlers.push(fn);
      },
      close() {
        sock.destroy();
      }
    };
  });
}

module.exports = { connect, buildFrame, parseFrames, getBrowserPath };
