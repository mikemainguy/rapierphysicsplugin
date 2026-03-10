import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageType } from '@rapierphysicsplugin/shared';

// --- Mocks for internal dependencies ---

const mockClockSync = {
  start: vi.fn(),
  stop: vi.fn(),
  handleResponse: vi.fn(),
  getServerTick: vi.fn(() => 0),
  isCalibrated: true,
};

const mockInterpolator = {};

const mockReconciler = {
  processServerState: vi.fn(),
  addPendingInput: vi.fn(),
  addLocalBody: vi.fn(),
  removeLocalBody: vi.fn(),
  clear: vi.fn(),
};

const mockInputManager = {
  start: vi.fn(),
  stop: vi.fn(),
  queueAction: vi.fn(),
};

vi.mock('../clock-sync.js', () => ({
  ClockSyncClient: vi.fn(() => mockClockSync),
}));

vi.mock('../interpolator.js', () => ({
  Interpolator: vi.fn(() => mockInterpolator),
}));

vi.mock('../state-reconciler.js', () => ({
  StateReconciler: vi.fn(() => mockReconciler),
}));

vi.mock('../input-manager.js', () => ({
  InputManager: vi.fn(() => mockInputManager),
}));

vi.mock('../sync-message-handler.js', () => ({
  dispatchBinaryMessage: vi.fn(),
}));

vi.mock('@rapierphysicsplugin/shared', async () => {
  const actual = await vi.importActual<typeof import('@rapierphysicsplugin/shared')>('@rapierphysicsplugin/shared');
  return {
    ...actual,
    encodeMessage: vi.fn(() => new Uint8Array([1, 2, 3])),
  };
});

import { PhysicsSyncClient } from '../sync-client.js';
import { dispatchBinaryMessage } from '../sync-message-handler.js';
import { encodeMessage } from '@rapierphysicsplugin/shared';

// --- Mock WebSocket ---

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;

  binaryType = 'blob';
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: any) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: any) => void) | null = null;

  send = vi.fn();
  close = vi.fn();

  // Test helpers
  triggerOpen(): void { this.onopen?.(); }
  triggerMessage(data: ArrayBuffer | Blob): void { this.onmessage?.({ data }); }
  triggerClose(): void { this.onclose?.(); }
  triggerError(): void { this.onerror?.({}); }
}

let mockWsInstance: MockWebSocket;

// --- Tests ---

describe('PhysicsSyncClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWsInstance = new MockWebSocket();
    const WsCtor = vi.fn(() => mockWsInstance) as any;
    WsCtor.OPEN = 1;
    WsCtor.CONNECTING = 0;
    WsCtor.CLOSING = 2;
    WsCtor.CLOSED = 3;
    vi.stubGlobal('WebSocket', WsCtor);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('constructor', () => {
    it('creates a client with default options', () => {
      const client = new PhysicsSyncClient();
      expect(client.simulationRunning).toBe(false);
      expect(client.totalBodyCount).toBe(0);
      expect(client.bytesSent).toBe(0);
      expect(client.bytesReceived).toBe(0);
      expect(client.getClientId()).toBeNull();
      expect(client.getRoomId()).toBeNull();
    });

    it('passes options to sub-components', async () => {
      const { ClockSyncClient } = await import('../clock-sync.js');
      const { Interpolator } = await import('../interpolator.js');
      const { StateReconciler } = await import('../state-reconciler.js');

      new PhysicsSyncClient({
        clockSyncIntervalMs: 5000,
        clockSyncSamples: 20,
        renderDelayMs: 100,
        interpolationBufferSize: 5,
        reconciliationThreshold: 0.5,
      });

      expect(ClockSyncClient).toHaveBeenCalledWith(5000, 20);
      expect(Interpolator).toHaveBeenCalledWith(100, 5);
      expect(StateReconciler).toHaveBeenCalledWith(mockInterpolator, 0.5);
    });
  });

  describe('connect', () => {
    it('resolves when WebSocket opens', async () => {
      const client = new PhysicsSyncClient();
      const connectPromise = client.connect('ws://localhost');

      expect(mockWsInstance.binaryType).toBe('arraybuffer');
      mockWsInstance.triggerOpen();

      await expect(connectPromise).resolves.toBeUndefined();
    });

    it('starts clock sync on open', async () => {
      const client = new PhysicsSyncClient();
      const connectPromise = client.connect('ws://localhost');
      mockWsInstance.triggerOpen();
      await connectPromise;

      expect(mockClockSync.start).toHaveBeenCalledOnce();
    });

    it('rejects when WebSocket errors', async () => {
      const client = new PhysicsSyncClient();
      const connectPromise = client.connect('ws://localhost');
      mockWsInstance.triggerError();

      await expect(connectPromise).rejects.toThrow('WebSocket connection failed');
    });

    it('stops clock sync and input manager on close', async () => {
      const client = new PhysicsSyncClient();
      const connectPromise = client.connect('ws://localhost');
      mockWsInstance.triggerOpen();
      await connectPromise;

      mockWsInstance.triggerClose();

      expect(mockClockSync.stop).toHaveBeenCalled();
      expect(mockInputManager.stop).toHaveBeenCalled();
    });

    it('dispatches binary ArrayBuffer messages', async () => {
      const client = new PhysicsSyncClient();
      const connectPromise = client.connect('ws://localhost');
      mockWsInstance.triggerOpen();
      await connectPromise;

      const data = new Uint8Array([10, 20, 30]).buffer;
      mockWsInstance.triggerMessage(data);

      expect(dispatchBinaryMessage).toHaveBeenCalledOnce();
      expect(client.bytesReceived).toBe(3);
    });

    it('tracks bytesSent from clock sync', async () => {
      mockClockSync.start.mockImplementation((sendFn: (data: Uint8Array) => void) => {
        sendFn(new Uint8Array([1, 2, 3, 4, 5]));
      });

      const client = new PhysicsSyncClient();
      const connectPromise = client.connect('ws://localhost');
      mockWsInstance.triggerOpen();
      await connectPromise;

      expect(client.bytesSent).toBe(5);
      expect(mockWsInstance.send).toHaveBeenCalledWith(new Uint8Array([1, 2, 3, 4, 5]));
    });
  });

  describe('createRoom', () => {
    it('rejects if not connected', async () => {
      const client = new PhysicsSyncClient();
      await expect(client.createRoom('room1', [])).rejects.toThrow('Not connected');
    });

    it('sends CREATE_ROOM and tracks bytes', async () => {
      const client = new PhysicsSyncClient();
      await connectClient(client);

      // Don't await — it waits for server response
      const promise = client.createRoom('room1', [], { x: 0, y: -9.81, z: 0 });

      expect(encodeMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: MessageType.CREATE_ROOM,
        roomId: 'room1',
        gravity: { x: 0, y: -9.81, z: 0 },
      }));
      expect(client.bytesSent).toBeGreaterThan(0);

      // Not resolved yet (waiting for ROOM_CREATED response)
      expect(promise).toBeInstanceOf(Promise);
    });
  });

  describe('joinRoom', () => {
    it('rejects if not connected', async () => {
      const client = new PhysicsSyncClient();
      await expect(client.joinRoom('room1')).rejects.toThrow('Not connected');
    });

    it('sends JOIN_ROOM message', async () => {
      const client = new PhysicsSyncClient();
      await connectClient(client);

      client.joinRoom('room1');

      expect(encodeMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: MessageType.JOIN_ROOM,
        roomId: 'room1',
      }));
    });
  });

  describe('leaveRoom', () => {
    it('does nothing if not connected', () => {
      const client = new PhysicsSyncClient();
      client.leaveRoom(); // Should not throw
    });

    it('does nothing if no roomId set', async () => {
      const client = new PhysicsSyncClient();
      await connectClient(client);

      client.leaveRoom();

      expect(encodeMessage).not.toHaveBeenCalled();
    });

    it('sends LEAVE_ROOM and clears state when in a room', async () => {
      const client = new PhysicsSyncClient();
      await connectClient(client);
      // Simulate being in a room by setting mutableState via handler context
      setRoomId(client, 'room1');

      client.leaveRoom();

      expect(encodeMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: MessageType.LEAVE_ROOM,
      }));
      expect(mockInputManager.stop).toHaveBeenCalled();
      expect(mockReconciler.clear).toHaveBeenCalled();
      expect(client.getRoomId()).toBeNull();
    });
  });

  describe('sendInput', () => {
    it('queues actions to input manager', () => {
      const client = new PhysicsSyncClient();
      const actions = [{ type: 'jump' }, { type: 'move', x: 1 }] as any[];

      client.sendInput(actions);

      expect(mockInputManager.queueAction).toHaveBeenCalledTimes(2);
      expect(mockInputManager.queueAction).toHaveBeenCalledWith({ type: 'jump' });
      expect(mockInputManager.queueAction).toHaveBeenCalledWith({ type: 'move', x: 1 });
    });
  });

  describe('addLocalBody / removeLocalBody', () => {
    it('delegates to reconciler', () => {
      const client = new PhysicsSyncClient();
      client.addLocalBody('body-1');
      client.removeLocalBody('body-1');

      expect(mockReconciler.addLocalBody).toHaveBeenCalledWith('body-1');
      expect(mockReconciler.removeLocalBody).toHaveBeenCalledWith('body-1');
    });
  });

  describe('addBody', () => {
    it('does nothing if not connected', () => {
      const client = new PhysicsSyncClient();
      client.addBody({ id: 'b1' } as any);

      expect(encodeMessage).not.toHaveBeenCalled();
    });

    it('sends ADD_BODY message', async () => {
      const client = new PhysicsSyncClient();
      await connectClient(client);

      const body = { id: 'b1', motionType: 'dynamic' } as any;
      client.addBody(body);

      expect(encodeMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: MessageType.ADD_BODY,
        body,
      }));
    });

    it('sets ownerId when owned option is true', async () => {
      const client = new PhysicsSyncClient();
      await connectClient(client);

      const body = { id: 'b1' } as any;
      client.addBody(body, { owned: true });

      expect(body.ownerId).toBe('__self__');
    });

    it('uses clientId for ownerId when available', async () => {
      const client = new PhysicsSyncClient();
      await connectClient(client);
      setClientId(client, 'client-42');

      const body = { id: 'b1' } as any;
      client.addBody(body, { owned: true });

      expect(body.ownerId).toBe('client-42');
    });
  });

  describe('removeBody', () => {
    it('does nothing if not connected', () => {
      const client = new PhysicsSyncClient();
      client.removeBody('b1');
      expect(encodeMessage).not.toHaveBeenCalled();
    });

    it('sends REMOVE_BODY message', async () => {
      const client = new PhysicsSyncClient();
      await connectClient(client);

      client.removeBody('b1');

      expect(encodeMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: MessageType.REMOVE_BODY,
        bodyId: 'b1',
      }));
    });
  });

  describe('addConstraint / removeConstraint / updateConstraint', () => {
    it('sends constraint messages when connected', async () => {
      const client = new PhysicsSyncClient();
      await connectClient(client);

      const constraint = { id: 'c1' } as any;
      client.addConstraint(constraint);
      expect(encodeMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: MessageType.ADD_CONSTRAINT,
        constraint,
      }));

      vi.mocked(encodeMessage).mockClear();
      client.removeConstraint('c1');
      expect(encodeMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: MessageType.REMOVE_CONSTRAINT,
        constraintId: 'c1',
      }));

      vi.mocked(encodeMessage).mockClear();
      const updates = { linearLimits: {} } as any;
      client.updateConstraint('c1', updates);
      expect(encodeMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: MessageType.UPDATE_CONSTRAINT,
        constraintId: 'c1',
        updates,
      }));
    });

    it('does nothing if not connected', () => {
      const client = new PhysicsSyncClient();
      client.addConstraint({} as any);
      client.removeConstraint('c1');
      client.updateConstraint('c1', {} as any);
      expect(encodeMessage).not.toHaveBeenCalled();
    });
  });

  describe('startSimulation', () => {
    it('sends START_SIMULATION when connected', async () => {
      const client = new PhysicsSyncClient();
      await connectClient(client);

      client.startSimulation();

      expect(encodeMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: MessageType.START_SIMULATION,
      }));
    });

    it('does nothing if not connected', () => {
      const client = new PhysicsSyncClient();
      client.startSimulation();
      expect(encodeMessage).not.toHaveBeenCalled();
    });
  });

  describe('callback registration', () => {
    it('registers all 13 callback types', () => {
      const client = new PhysicsSyncClient();
      const noop = vi.fn();

      // These should not throw
      client.onStateUpdate(noop);
      client.onBodyAdded(noop);
      client.onBodyRemoved(noop);
      client.onSimulationStarted(noop);
      client.onCollisionEvents(noop);
      client.onConstraintAdded(noop);
      client.onConstraintRemoved(noop);
      client.onConstraintUpdated(noop);
      client.onMeshBinary(noop);
      client.onGeometryDef(noop);
      client.onMeshRef(noop);
      client.onMaterialDef(noop);
      client.onTextureDef(noop);
    });
  });

  describe('binary send methods', () => {
    it('sends raw bytes and tracks bytesSent', async () => {
      const client = new PhysicsSyncClient();
      await connectClient(client);
      const initialBytes = client.bytesSent;

      const data = new Uint8Array([10, 20, 30, 40]);
      client.sendMeshBinary(data);

      expect(mockWsInstance.send).toHaveBeenCalledWith(data);
      expect(client.bytesSent).toBe(initialBytes + 4);
    });

    it('all binary methods send via WebSocket', async () => {
      const client = new PhysicsSyncClient();
      await connectClient(client);

      const data = new Uint8Array([1]);
      client.sendMeshBinary(data);
      client.sendGeometryDef(data);
      client.sendMeshRef(data);
      client.sendMaterialDef(data);
      client.sendTextureDef(data);

      // 5 raw sends (clock sync start may also send)
      const rawSendCount = mockWsInstance.send.mock.calls.filter(
        (call: any[]) => call[0] instanceof Uint8Array && call[0].byteLength === 1,
      ).length;
      expect(rawSendCount).toBe(5);
    });

    it('does nothing if WebSocket is not open', async () => {
      const client = new PhysicsSyncClient();
      await connectClient(client);
      mockWsInstance.readyState = MockWebSocket.CLOSED;
      const initialBytes = client.bytesSent;

      client.sendMeshBinary(new Uint8Array([1, 2, 3]));

      expect(client.bytesSent).toBe(initialBytes);
    });
  });

  describe('shape queries', () => {
    it('delegates shapeCastQuery to QueryManager', async () => {
      const client = new PhysicsSyncClient();
      const shape = { type: 'box' } as any;
      const start = { x: 0, y: 0, z: 0 };
      const end = { x: 1, y: 0, z: 0 };
      const rot = { x: 0, y: 0, z: 0, w: 1 };

      // Not connected, so QueryManager rejects
      await expect(client.shapeCastQuery(shape, start, end, rot, 'ignore-1'))
        .rejects.toThrow('Not connected');
    });

    it('delegates shapeProximityQuery to QueryManager', async () => {
      const client = new PhysicsSyncClient();
      await expect(client.shapeProximityQuery(
        { type: 'sphere' } as any,
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0, w: 1 },
        5.0,
      )).rejects.toThrow('Not connected');
    });

    it('delegates pointProximityQuery to QueryManager', async () => {
      const client = new PhysicsSyncClient();
      await expect(client.pointProximityQuery({ x: 0, y: 0, z: 0 }, 3.0))
        .rejects.toThrow('Not connected');
    });
  });

  describe('disconnect', () => {
    it('stops all sub-components and closes WebSocket', async () => {
      const client = new PhysicsSyncClient();
      await connectClient(client);
      setRoomId(client, 'room1');
      setClientId(client, 'client-1');

      client.disconnect();

      expect(mockClockSync.stop).toHaveBeenCalled();
      expect(mockInputManager.stop).toHaveBeenCalled();
      expect(mockReconciler.clear).toHaveBeenCalled();
      expect(mockWsInstance.close).toHaveBeenCalled();
      expect(client.getRoomId()).toBeNull();
      expect(client.getClientId()).toBeNull();
    });

    it('handles disconnect when never connected', () => {
      const client = new PhysicsSyncClient();
      expect(() => client.disconnect()).not.toThrow();
    });
  });

  describe('getters', () => {
    it('getReconciler returns reconciler', () => {
      const client = new PhysicsSyncClient();
      expect(client.getReconciler()).toBe(mockReconciler);
    });

    it('getClockSync returns clock sync', () => {
      const client = new PhysicsSyncClient();
      expect(client.getClockSync()).toBe(mockClockSync);
    });

    it('getInputManager returns input manager', () => {
      const client = new PhysicsSyncClient();
      expect(client.getInputManager()).toBe(mockInputManager);
    });

    it('simulationRunning reflects mutable state', () => {
      const client = new PhysicsSyncClient();
      expect(client.simulationRunning).toBe(false);
    });

    it('bytesSent / bytesReceived start at 0', () => {
      const client = new PhysicsSyncClient();
      expect(client.bytesSent).toBe(0);
      expect(client.bytesReceived).toBe(0);
    });
  });

  describe('send (private, via public methods)', () => {
    it('does not send when WebSocket is closed', async () => {
      const client = new PhysicsSyncClient();
      await connectClient(client);
      mockWsInstance.readyState = MockWebSocket.CLOSED;

      client.addBody({ id: 'b1' } as any);

      // encodeMessage is called but ws.send is not (because readyState is CLOSED)
      // Actually, the send method checks readyState before encoding
      // So encodeMessage should NOT be called
      expect(mockWsInstance.send).not.toHaveBeenCalledWith(expect.any(Uint8Array));
    });
  });
});

// --- Helpers ---

async function connectClient(client: PhysicsSyncClient): Promise<void> {
  const p = client.connect('ws://localhost');
  mockWsInstance.triggerOpen();
  await p;
  // Clear mocks so tests only see their own calls
  vi.mocked(encodeMessage).mockClear();
  mockWsInstance.send.mockClear();
}

/**
 * Sets the roomId on the client's mutable state.
 * We access it via the public getter to confirm, but set it by
 * exercising the message handler context indirectly.
 * Since the mutableState is an object ref shared with the handler,
 * we can poke it through the dispatchBinaryMessage mock.
 */
function setRoomId(client: PhysicsSyncClient, roomId: string): void {
  // The dispatchBinaryMessage mock receives the handler context.
  // We extract the state ref from the last call and set roomId.
  const calls = vi.mocked(dispatchBinaryMessage).mock.calls;
  if (calls.length > 0) {
    const ctx = calls[calls.length - 1][1];
    ctx.state.roomId = roomId;
  } else {
    // Trigger a dummy message to capture the context
    mockWsInstance.triggerMessage(new Uint8Array([0]).buffer);
    const ctx = vi.mocked(dispatchBinaryMessage).mock.calls[0][1];
    ctx.state.roomId = roomId;
  }
}

function setClientId(client: PhysicsSyncClient, clientId: string): void {
  const calls = vi.mocked(dispatchBinaryMessage).mock.calls;
  if (calls.length > 0) {
    const ctx = calls[calls.length - 1][1];
    ctx.state.clientId = clientId;
  } else {
    mockWsInstance.triggerMessage(new Uint8Array([0]).buffer);
    const ctx = vi.mocked(dispatchBinaryMessage).mock.calls[0][1];
    ctx.state.clientId = clientId;
  }
}
