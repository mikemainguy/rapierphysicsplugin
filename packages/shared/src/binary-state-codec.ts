import type { RoomStateMessage } from './protocol.js';
import type { BodyState } from './types.js';
import { MessageType } from './protocol.js';
import { FIELD_POSITION, FIELD_ROTATION, FIELD_LIN_VEL, FIELD_ANG_VEL, FIELD_ALL } from './types.js';

/**
 * Binary wire format for ROOM_STATE messages.
 *
 * Header (16 bytes):
 *   [opcode: u8 = 0x01]
 *   [tick: u32 LE]
 *   [timestamp: f64 LE]
 *   [flags: u8]        — bit 0: isDelta, bit 1: numeric body IDs
 *   [bodyCount: u16 LE]
 *
 * Per body (variable length):
 *   If flags & 0x02 (numeric IDs):
 *     [bodyIndex: u16 LE]
 *   Else (string IDs):
 *     [idLength: u8] [id: utf8]
 *   [fieldMask: u8]
 *   If fieldMask & 0x01: [pos.x: f32] [pos.y: f32] [pos.z: f32]          (12 bytes)
 *   If fieldMask & 0x02: [smallest-three quaternion]                       (7 bytes)
 *   If fieldMask & 0x04: [linVel.x: f32] [linVel.y: f32] [linVel.z: f32] (12 bytes)
 *   If fieldMask & 0x08: [angVel.x: f32] [angVel.y: f32] [angVel.z: f32] (12 bytes)
 *
 * Smallest-three quaternion encoding (7 bytes):
 *   [largestIndex: u8]  — 0=x, 1=y, 2=z, 3=w
 *   [a: int16 LE] [b: int16 LE] [c: int16 LE]
 *   The three smallest components scaled from [-1/√2, 1/√2] to [-32767, 32767].
 *   The largest component is reconstructed as sqrt(1 - a² - b² - c²).
 */

const OPCODE_ROOM_STATE = 0x01;
const HEADER_SIZE = 16; // 1 opcode + 4 tick + 8 timestamp + 1 flags + 2 bodyCount

const FLAG_IS_DELTA = 0x01;
const FLAG_NUMERIC_IDS = 0x02;

const QUAT_SCALE = 32767.0 / 0.7071067811865476; // 32767 / (1/√2)

export function encodeRoomState(
  msg: RoomStateMessage,
  idToIndex?: Map<string, number>,
): Uint8Array {
  const useNumericIds = idToIndex != null && idToIndex.size > 0;
  const encoder = new TextEncoder();

  // Pre-encode string IDs if needed
  let encodedIds: Uint8Array[] | undefined;
  if (!useNumericIds) {
    encodedIds = [];
    for (const body of msg.bodies) {
      encodedIds.push(encoder.encode(body.id));
    }
  }

  // Calculate total size
  let totalSize = HEADER_SIZE;
  for (let i = 0; i < msg.bodies.length; i++) {
    const body = msg.bodies[i];
    const mask = body.fieldMask ?? FIELD_ALL;

    // Body ID
    if (useNumericIds) {
      totalSize += 2; // uint16
    } else {
      totalSize += 1 + encodedIds![i].length; // u8 length + utf8
    }

    // Field mask
    totalSize += 1;

    // Fields
    if (mask & FIELD_POSITION) totalSize += 12;
    if (mask & FIELD_ROTATION) totalSize += 7; // smallest-three
    if (mask & FIELD_LIN_VEL) totalSize += 12;
    if (mask & FIELD_ANG_VEL) totalSize += 12;
  }

  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const arr = new Uint8Array(buf);
  let offset = 0;

  // Header
  let flags = 0;
  if (msg.isDelta) flags |= FLAG_IS_DELTA;
  if (useNumericIds) flags |= FLAG_NUMERIC_IDS;

  view.setUint8(offset, OPCODE_ROOM_STATE); offset += 1;
  view.setUint32(offset, msg.tick, true); offset += 4;
  view.setFloat64(offset, msg.timestamp, true); offset += 8;
  view.setUint8(offset, flags); offset += 1;
  view.setUint16(offset, msg.bodies.length, true); offset += 2;

  // Bodies
  for (let i = 0; i < msg.bodies.length; i++) {
    const body = msg.bodies[i];
    const mask = body.fieldMask ?? FIELD_ALL;

    // Body ID
    if (useNumericIds) {
      view.setUint16(offset, idToIndex!.get(body.id)!, true); offset += 2;
    } else {
      const idBytes = encodedIds![i];
      view.setUint8(offset, idBytes.length); offset += 1;
      arr.set(idBytes, offset); offset += idBytes.length;
    }

    // Field mask
    view.setUint8(offset, mask); offset += 1;

    // Position
    if (mask & FIELD_POSITION) {
      view.setFloat32(offset, body.position.x, true); offset += 4;
      view.setFloat32(offset, body.position.y, true); offset += 4;
      view.setFloat32(offset, body.position.z, true); offset += 4;
    }

    // Rotation (smallest-three encoding)
    if (mask & FIELD_ROTATION) {
      offset = encodeSmallestThree(body.rotation, view, offset);
    }

    // Linear velocity
    if (mask & FIELD_LIN_VEL) {
      view.setFloat32(offset, body.linVel.x, true); offset += 4;
      view.setFloat32(offset, body.linVel.y, true); offset += 4;
      view.setFloat32(offset, body.linVel.z, true); offset += 4;
    }

    // Angular velocity
    if (mask & FIELD_ANG_VEL) {
      view.setFloat32(offset, body.angVel.x, true); offset += 4;
      view.setFloat32(offset, body.angVel.y, true); offset += 4;
      view.setFloat32(offset, body.angVel.z, true); offset += 4;
    }
  }

  return arr;
}

export function decodeRoomState(
  data: Uint8Array,
  indexToId?: Map<number, string>,
): RoomStateMessage {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder();
  let offset = 1; // skip opcode

  const tick = view.getUint32(offset, true); offset += 4;
  const timestamp = view.getFloat64(offset, true); offset += 8;
  const flags = view.getUint8(offset); offset += 1;
  const bodyCount = view.getUint16(offset, true); offset += 2;

  const isDelta = (flags & FLAG_IS_DELTA) !== 0;
  const useNumericIds = (flags & FLAG_NUMERIC_IDS) !== 0;

  const bodies: BodyState[] = new Array(bodyCount);

  for (let i = 0; i < bodyCount; i++) {
    // Body ID
    let id: string;
    if (useNumericIds) {
      const idx = view.getUint16(offset, true); offset += 2;
      id = indexToId?.get(idx) ?? `__unknown_${idx}`;
    } else {
      const idLength = view.getUint8(offset); offset += 1;
      id = decoder.decode(data.subarray(offset, offset + idLength));
      offset += idLength;
    }

    // Field mask
    const fieldMask = view.getUint8(offset); offset += 1;

    // Position
    let px = 0, py = 0, pz = 0;
    if (fieldMask & FIELD_POSITION) {
      px = view.getFloat32(offset, true); offset += 4;
      py = view.getFloat32(offset, true); offset += 4;
      pz = view.getFloat32(offset, true); offset += 4;
    }

    // Rotation (smallest-three decoding)
    let rx = 0, ry = 0, rz = 0, rw = 1;
    if (fieldMask & FIELD_ROTATION) {
      const result = decodeSmallestThree(view, offset);
      rx = result.x; ry = result.y; rz = result.z; rw = result.w;
      offset = result.offset;
    }

    // Linear velocity
    let lvx = 0, lvy = 0, lvz = 0;
    if (fieldMask & FIELD_LIN_VEL) {
      lvx = view.getFloat32(offset, true); offset += 4;
      lvy = view.getFloat32(offset, true); offset += 4;
      lvz = view.getFloat32(offset, true); offset += 4;
    }

    // Angular velocity
    let avx = 0, avy = 0, avz = 0;
    if (fieldMask & FIELD_ANG_VEL) {
      avx = view.getFloat32(offset, true); offset += 4;
      avy = view.getFloat32(offset, true); offset += 4;
      avz = view.getFloat32(offset, true); offset += 4;
    }

    bodies[i] = {
      id,
      position: { x: px, y: py, z: pz },
      rotation: { x: rx, y: ry, z: rz, w: rw },
      linVel: { x: lvx, y: lvy, z: lvz },
      angVel: { x: avx, y: avy, z: avz },
      fieldMask,
    };
  }

  return {
    type: MessageType.ROOM_STATE,
    tick,
    timestamp,
    bodies,
    isDelta,
  };
}

// --- Smallest-three quaternion encoding ---

function encodeSmallestThree(
  q: { x: number; y: number; z: number; w: number },
  view: DataView,
  offset: number,
): number {
  const components = [q.x, q.y, q.z, q.w];

  // Find largest component by absolute value
  let maxIdx = 0;
  let maxVal = Math.abs(components[0]);
  for (let i = 1; i < 4; i++) {
    const abs = Math.abs(components[i]);
    if (abs > maxVal) {
      maxVal = abs;
      maxIdx = i;
    }
  }

  // If the largest is negative, negate all to ensure reconstructed value is positive
  const sign = components[maxIdx] < 0 ? -1 : 1;

  // Collect the three other components
  const others: number[] = [];
  for (let i = 0; i < 4; i++) {
    if (i !== maxIdx) {
      others.push(components[i] * sign);
    }
  }

  // Write: 1 byte index + 3 × int16
  view.setUint8(offset, maxIdx); offset += 1;
  for (let i = 0; i < 3; i++) {
    const clamped = Math.max(-0.7071067811865476, Math.min(0.7071067811865476, others[i]));
    view.setInt16(offset, Math.round(clamped * QUAT_SCALE), true); offset += 2;
  }

  return offset;
}

function decodeSmallestThree(
  view: DataView,
  offset: number,
): { x: number; y: number; z: number; w: number; offset: number } {
  const maxIdx = view.getUint8(offset); offset += 1;

  const others: number[] = [];
  for (let i = 0; i < 3; i++) {
    others.push(view.getInt16(offset, true) / QUAT_SCALE);
    offset += 2;
  }

  // Reconstruct the largest component
  const sumSq = others[0] * others[0] + others[1] * others[1] + others[2] * others[2];
  const largest = Math.sqrt(Math.max(0, 1 - sumSq));

  // Rebuild the quaternion
  const components = [0, 0, 0, 0];
  let otherIdx = 0;
  for (let i = 0; i < 4; i++) {
    if (i === maxIdx) {
      components[i] = largest;
    } else {
      components[i] = others[otherIdx++];
    }
  }

  return { x: components[0], y: components[1], z: components[2], w: components[3], offset };
}
