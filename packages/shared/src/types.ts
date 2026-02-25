export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

// Field mask bits for delta state updates
export const FIELD_POSITION = 0x01;
export const FIELD_ROTATION = 0x02;
export const FIELD_LIN_VEL  = 0x04;
export const FIELD_ANG_VEL  = 0x08;
export const FIELD_ALL      = 0x0F;

export interface BodyState {
  id: string;
  position: Vec3;
  rotation: Quat;
  linVel: Vec3;
  angVel: Vec3;
  /** Present in delta updates — indicates which field groups were transmitted */
  fieldMask?: number;
}

export type ShapeType = 'box' | 'sphere' | 'capsule' | 'mesh';

export type MotionType = 'dynamic' | 'static' | 'kinematic';

export interface BoxShapeParams {
  halfExtents: Vec3;
}

export interface SphereShapeParams {
  radius: number;
}

export interface CapsuleShapeParams {
  halfHeight: number;
  radius: number;
}

export interface MeshShapeParams {
  vertices: Float32Array;
  indices: Uint32Array;
}

export interface ShapeDescriptor {
  type: ShapeType;
  params: BoxShapeParams | SphereShapeParams | CapsuleShapeParams | MeshShapeParams;
}

export interface BodyDescriptor {
  id: string;
  shape: ShapeDescriptor;
  motionType: MotionType;
  position: Vec3;
  rotation: Quat;
  mass?: number;
  centerOfMass?: Vec3;
  restitution?: number;
  friction?: number;
  isTrigger?: boolean;
}

export type CollisionEventType =
  | 'COLLISION_STARTED'
  | 'COLLISION_FINISHED'
  | 'TRIGGER_ENTERED'
  | 'TRIGGER_EXITED';

export interface CollisionEventData {
  bodyIdA: string;
  bodyIdB: string;
  type: CollisionEventType;
  point: Vec3 | null;
  normal: Vec3 | null;
  impulse: number;
}

export interface RoomSnapshot {
  tick: number;
  timestamp: number;
  bodies: BodyState[];
}

export type InputActionType =
  | 'applyForce'
  | 'applyImpulse'
  | 'setVelocity'
  | 'setAngularVelocity'
  | 'setPosition'
  | 'setRotation';

export interface InputAction {
  type: InputActionType;
  bodyId: string;
  data: {
    force?: Vec3;
    impulse?: Vec3;
    linVel?: Vec3;
    angVel?: Vec3;
    position?: Vec3;
    rotation?: Quat;
    point?: Vec3;
  };
}

export interface ClientInput {
  tick: number;
  sequenceNum: number;
  actions: InputAction[];
}
