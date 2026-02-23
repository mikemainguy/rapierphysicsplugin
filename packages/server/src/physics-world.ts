import type RAPIER from '@dimforge/rapier3d-compat';
import type {
  BodyDescriptor,
  BodyState,
  Vec3,
  Quat,
  InputAction,
} from '@rapierphysicsplugin/shared';
import { FIXED_TIMESTEP } from '@rapierphysicsplugin/shared';

export class PhysicsWorld {
  private world: RAPIER.World;
  private rapier: typeof RAPIER;
  private bodyMap: Map<string, RAPIER.RigidBody> = new Map();
  private colliderMap: Map<string, RAPIER.Collider> = new Map();

  constructor(rapier: typeof RAPIER, gravity: Vec3 = { x: 0, y: -9.81, z: 0 }) {
    this.rapier = rapier;
    this.world = new rapier.World(new rapier.Vector3(gravity.x, gravity.y, gravity.z));
    this.world.timestep = FIXED_TIMESTEP;
  }

  addBody(descriptor: BodyDescriptor): string {
    const { rapier, world } = this;
    const { id, shape, motionType, position, rotation, mass, centerOfMass, restitution, friction } = descriptor;

    if (this.bodyMap.has(id)) {
      throw new Error(`Body with id "${id}" already exists`);
    }

    // Create rigid body description
    let bodyDesc: RAPIER.RigidBodyDesc;
    switch (motionType) {
      case 'dynamic':
        bodyDesc = rapier.RigidBodyDesc.dynamic();
        break;
      case 'static':
        bodyDesc = rapier.RigidBodyDesc.fixed();
        break;
      case 'kinematic':
        bodyDesc = rapier.RigidBodyDesc.kinematicPositionBased();
        break;
    }

    bodyDesc.setTranslation(position.x, position.y, position.z);
    bodyDesc.setRotation(new rapier.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w));

    const rigidBody = world.createRigidBody(bodyDesc);

    // Create collider
    let colliderDesc: RAPIER.ColliderDesc;
    switch (shape.type) {
      case 'box': {
        const p = shape.params as { halfExtents: Vec3 };
        colliderDesc = rapier.ColliderDesc.cuboid(
          p.halfExtents.x,
          p.halfExtents.y,
          p.halfExtents.z
        );
        break;
      }
      case 'sphere': {
        const p = shape.params as { radius: number };
        colliderDesc = rapier.ColliderDesc.ball(p.radius);
        break;
      }
      case 'capsule': {
        const p = shape.params as { halfHeight: number; radius: number };
        colliderDesc = rapier.ColliderDesc.capsule(p.halfHeight, p.radius);
        break;
      }
      case 'mesh': {
        const p = shape.params as { vertices: Float32Array; indices: Uint32Array };
        colliderDesc = rapier.ColliderDesc.trimesh(p.vertices, p.indices);
        break;
      }
    }

    if (centerOfMass !== undefined && motionType === 'dynamic') {
      const m = mass ?? 1.0;
      colliderDesc.setMassProperties(
        m,
        { x: centerOfMass.x, y: centerOfMass.y, z: centerOfMass.z },
        { x: m / 6, y: m / 6, z: m / 6 },
        { x: 0, y: 0, z: 0, w: 1 },
      );
    } else if (mass !== undefined && motionType === 'dynamic') {
      colliderDesc.setMass(mass);
    }
    if (restitution !== undefined) {
      colliderDesc.setRestitution(restitution);
    }
    if (friction !== undefined) {
      colliderDesc.setFriction(friction);
    }

    const collider = world.createCollider(colliderDesc, rigidBody);

    this.bodyMap.set(id, rigidBody);
    this.colliderMap.set(id, collider);

    return id;
  }

  removeBody(id: string): void {
    const body = this.bodyMap.get(id);
    if (!body) return;

    this.world.removeRigidBody(body);
    this.bodyMap.delete(id);
    this.colliderMap.delete(id);
  }

  applyForce(id: string, force: Vec3, point?: Vec3): void {
    const body = this.bodyMap.get(id);
    if (!body) return;

    if (point) {
      body.addForceAtPoint(
        new this.rapier.Vector3(force.x, force.y, force.z),
        new this.rapier.Vector3(point.x, point.y, point.z),
        true
      );
    } else {
      body.addForce(new this.rapier.Vector3(force.x, force.y, force.z), true);
    }
  }

  applyImpulse(id: string, impulse: Vec3, point?: Vec3): void {
    const body = this.bodyMap.get(id);
    if (!body) return;

    if (point) {
      body.applyImpulseAtPoint(
        new this.rapier.Vector3(impulse.x, impulse.y, impulse.z),
        new this.rapier.Vector3(point.x, point.y, point.z),
        true
      );
    } else {
      body.applyImpulse(new this.rapier.Vector3(impulse.x, impulse.y, impulse.z), true);
    }
  }

  setBodyVelocity(id: string, linVel: Vec3, angVel?: Vec3): void {
    const body = this.bodyMap.get(id);
    if (!body) return;

    body.setLinvel(new this.rapier.Vector3(linVel.x, linVel.y, linVel.z), true);
    if (angVel) {
      body.setAngvel(new this.rapier.Vector3(angVel.x, angVel.y, angVel.z), true);
    }
  }

  setBodyPosition(id: string, position: Vec3): void {
    const body = this.bodyMap.get(id);
    if (!body) return;

    body.setTranslation(new this.rapier.Vector3(position.x, position.y, position.z), true);
  }

  setBodyRotation(id: string, rotation: Quat): void {
    const body = this.bodyMap.get(id);
    if (!body) return;

    body.setRotation(
      new this.rapier.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
      true
    );
  }

  applyInput(action: InputAction): void {
    switch (action.type) {
      case 'applyForce':
        if (action.data.force) {
          this.applyForce(action.bodyId, action.data.force, action.data.point);
        }
        break;
      case 'applyImpulse':
        if (action.data.impulse) {
          this.applyImpulse(action.bodyId, action.data.impulse, action.data.point);
        }
        break;
      case 'setVelocity':
        if (action.data.linVel) {
          this.setBodyVelocity(action.bodyId, action.data.linVel, action.data.angVel);
        }
        break;
      case 'setAngularVelocity':
        if (action.data.angVel) {
          const body = this.bodyMap.get(action.bodyId);
          if (body) {
            body.setAngvel(
              new this.rapier.Vector3(action.data.angVel.x, action.data.angVel.y, action.data.angVel.z),
              true
            );
          }
        }
        break;
      case 'setPosition':
        if (action.data.position) {
          this.setBodyPosition(action.bodyId, action.data.position);
        }
        break;
      case 'setRotation':
        if (action.data.rotation) {
          this.setBodyRotation(action.bodyId, action.data.rotation);
        }
        break;
    }
  }

  step(): void {
    this.world.step();
  }

  getSnapshot(): BodyState[] {
    const states: BodyState[] = [];
    for (const [id, body] of this.bodyMap) {
      const pos = body.translation();
      const rot = body.rotation();
      const linVel = body.linvel();
      const angVel = body.angvel();
      states.push({
        id,
        position: { x: pos.x, y: pos.y, z: pos.z },
        rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
        linVel: { x: linVel.x, y: linVel.y, z: linVel.z },
        angVel: { x: angVel.x, y: angVel.y, z: angVel.z },
      });
    }
    return states;
  }

  getBodyState(id: string): BodyState | null {
    const body = this.bodyMap.get(id);
    if (!body) return null;

    const pos = body.translation();
    const rot = body.rotation();
    const linVel = body.linvel();
    const angVel = body.angvel();
    return {
      id,
      position: { x: pos.x, y: pos.y, z: pos.z },
      rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
      linVel: { x: linVel.x, y: linVel.y, z: linVel.z },
      angVel: { x: angVel.x, y: angVel.y, z: angVel.z },
    };
  }

  loadState(bodies: BodyDescriptor[]): void {
    for (const body of bodies) {
      this.addBody(body);
    }
  }

  hasBody(id: string): boolean {
    return this.bodyMap.has(id);
  }

  get bodyCount(): number {
    return this.bodyMap.size;
  }

  destroy(): void {
    this.world.free();
    this.bodyMap.clear();
    this.colliderMap.clear();
  }
}
