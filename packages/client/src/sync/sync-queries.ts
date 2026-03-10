import type {
  ClientMessage,
  ShapeDescriptor,
  Vec3,
  Quat,
  ShapeCastResponse,
  ShapeProximityResponse,
  PointProximityResponse,
} from '@rapierphysicsplugin/shared';
import { MessageType } from '@rapierphysicsplugin/shared';

export class QueryManager {
  private nextQueryId = 0;
  private pendingQueries = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(
    private readonly isConnected: () => boolean,
    private readonly sendMessage: (msg: ClientMessage) => void,
  ) {}

  shapeCastQuery(
    shape: ShapeDescriptor,
    startPosition: Vec3,
    endPosition: Vec3,
    rotation: Quat,
    ignoreBodyId?: string,
  ): Promise<ShapeCastResponse> {
    const queryId = this.nextQueryId++;
    return this.sendQuery(queryId, {
      type: MessageType.SHAPE_CAST_REQUEST,
      request: { queryId, shape, startPosition, endPosition, rotation, ignoreBodyId },
    }) as Promise<ShapeCastResponse>;
  }

  shapeProximityQuery(
    shape: ShapeDescriptor,
    position: Vec3,
    rotation: Quat,
    maxDistance: number,
    ignoreBodyId?: string,
  ): Promise<ShapeProximityResponse> {
    const queryId = this.nextQueryId++;
    return this.sendQuery(queryId, {
      type: MessageType.SHAPE_PROXIMITY_REQUEST,
      request: { queryId, shape, position, rotation, maxDistance, ignoreBodyId },
    }) as Promise<ShapeProximityResponse>;
  }

  pointProximityQuery(
    position: Vec3,
    maxDistance: number,
    ignoreBodyId?: string,
  ): Promise<PointProximityResponse> {
    const queryId = this.nextQueryId++;
    return this.sendQuery(queryId, {
      type: MessageType.POINT_PROXIMITY_REQUEST,
      request: { queryId, position, maxDistance, ignoreBodyId },
    }) as Promise<PointProximityResponse>;
  }

  resolveQuery(queryId: number, response: unknown): void {
    const pending = this.pendingQueries.get(queryId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingQueries.delete(queryId);
      pending.resolve(response);
    }
  }

  cleanup(): void {
    for (const [, pending] of this.pendingQueries) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Disconnected'));
    }
    this.pendingQueries.clear();
  }

  private sendQuery(queryId: number, message: ClientMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('Not connected'));
        return;
      }

      const timer = setTimeout(() => {
        this.pendingQueries.delete(queryId);
        reject(new Error(`Query ${queryId} timed out`));
      }, 5000);

      this.pendingQueries.set(queryId, { resolve, reject, timer });
      this.sendMessage(message);
    });
  }
}
