import type { RoomStateMessage } from './protocol.js';
import type { BodyState } from './types.js';
import { MessageType } from './protocol.js';

const OPCODE_ROOM_STATE = 0x01;
const HEADER_SIZE = 15; // 1 opcode + 4 tick + 8 timestamp + 2 bodyCount
const FLOATS_PER_BODY = 13;
const BYTES_PER_FLOAT = 4;

export function encodeRoomState(msg: RoomStateMessage): Uint8Array {
  // Calculate total size
  let idBytesTotal = 0;
  const encoder = new TextEncoder();
  const encodedIds: Uint8Array[] = [];

  for (const body of msg.bodies) {
    const idBytes = encoder.encode(body.id);
    encodedIds.push(idBytes);
    idBytesTotal += 1 + idBytes.length; // 1 byte for length + id bytes
  }

  const totalSize =
    HEADER_SIZE +
    msg.bodies.length * (FLOATS_PER_BODY * BYTES_PER_FLOAT) +
    idBytesTotal;

  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const arr = new Uint8Array(buf);
  let offset = 0;

  // Header
  view.setUint8(offset, OPCODE_ROOM_STATE);
  offset += 1;
  view.setUint32(offset, msg.tick, true);
  offset += 4;
  view.setFloat64(offset, msg.timestamp, true);
  offset += 8;
  view.setUint16(offset, msg.bodies.length, true);
  offset += 2;

  // Bodies
  for (let i = 0; i < msg.bodies.length; i++) {
    const body = msg.bodies[i];
    const idBytes = encodedIds[i];

    // ID
    view.setUint8(offset, idBytes.length);
    offset += 1;
    arr.set(idBytes, offset);
    offset += idBytes.length;

    // Position (3 floats)
    view.setFloat32(offset, body.position.x, true);
    offset += 4;
    view.setFloat32(offset, body.position.y, true);
    offset += 4;
    view.setFloat32(offset, body.position.z, true);
    offset += 4;

    // Rotation (4 floats)
    view.setFloat32(offset, body.rotation.x, true);
    offset += 4;
    view.setFloat32(offset, body.rotation.y, true);
    offset += 4;
    view.setFloat32(offset, body.rotation.z, true);
    offset += 4;
    view.setFloat32(offset, body.rotation.w, true);
    offset += 4;

    // Linear velocity (3 floats)
    view.setFloat32(offset, body.linVel.x, true);
    offset += 4;
    view.setFloat32(offset, body.linVel.y, true);
    offset += 4;
    view.setFloat32(offset, body.linVel.z, true);
    offset += 4;

    // Angular velocity (3 floats)
    view.setFloat32(offset, body.angVel.x, true);
    offset += 4;
    view.setFloat32(offset, body.angVel.y, true);
    offset += 4;
    view.setFloat32(offset, body.angVel.z, true);
    offset += 4;
  }

  return arr;
}

export function decodeRoomState(data: Uint8Array): RoomStateMessage {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder();
  let offset = 1; // skip opcode

  const tick = view.getUint32(offset, true);
  offset += 4;
  const timestamp = view.getFloat64(offset, true);
  offset += 8;
  const bodyCount = view.getUint16(offset, true);
  offset += 2;

  const bodies: BodyState[] = new Array(bodyCount);

  for (let i = 0; i < bodyCount; i++) {
    const idLength = view.getUint8(offset);
    offset += 1;
    const id = decoder.decode(data.subarray(offset, offset + idLength));
    offset += idLength;

    const px = view.getFloat32(offset, true); offset += 4;
    const py = view.getFloat32(offset, true); offset += 4;
    const pz = view.getFloat32(offset, true); offset += 4;

    const rx = view.getFloat32(offset, true); offset += 4;
    const ry = view.getFloat32(offset, true); offset += 4;
    const rz = view.getFloat32(offset, true); offset += 4;
    const rw = view.getFloat32(offset, true); offset += 4;

    const lvx = view.getFloat32(offset, true); offset += 4;
    const lvy = view.getFloat32(offset, true); offset += 4;
    const lvz = view.getFloat32(offset, true); offset += 4;

    const avx = view.getFloat32(offset, true); offset += 4;
    const avy = view.getFloat32(offset, true); offset += 4;
    const avz = view.getFloat32(offset, true); offset += 4;

    bodies[i] = {
      id,
      position: { x: px, y: py, z: pz },
      rotation: { x: rx, y: ry, z: rz, w: rw },
      linVel: { x: lvx, y: lvy, z: lvz },
      angVel: { x: avx, y: avy, z: avz },
    };
  }

  return {
    type: MessageType.ROOM_STATE,
    tick,
    timestamp,
    bodies,
  };
}
