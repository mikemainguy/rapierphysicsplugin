import type RAPIER from '@dimforge/rapier3d-compat';
import type { BodyDescriptor, ConstraintDescriptor, Vec3 } from '@rapierphysicsplugin/shared';
import { Room } from './room.js';

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private rapier: typeof RAPIER;

  constructor(rapier: typeof RAPIER) {
      console.log('ROOM Manager Created');
    this.rapier = rapier;
  }

  createRoom(roomId: string, initialBodies: BodyDescriptor[] = [], gravity?: Vec3, initialConstraints?: ConstraintDescriptor[]): Room {
    if (this.rooms.has(roomId)) {
      throw new Error(`Room "${roomId}" already exists`);
    }

    const room = new Room(roomId, this.rapier, gravity);
    if (initialBodies.length > 0 || (initialConstraints && initialConstraints.length > 0)) {
      room.loadInitialState(initialBodies, initialConstraints);
    }
    this.rooms.set(roomId, room);
    return room;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  destroyRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.destroy();
      this.rooms.delete(roomId);
    }
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  getAllRoomIds(): string[] {
    return Array.from(this.rooms.keys());
  }
}
