import type RAPIER from '@dimforge/rapier3d-compat';
import type {
  BodyDescriptor,
  BodyState,
  CollisionEventData,
  ConstraintDescriptor,
  Vec3,
  Quat,
  InputAction,
  ShapeDescriptor,
  ShapeCastRequest,
  ShapeCastResponse,
  ShapeProximityRequest,
  ShapeProximityResponse,
  PointProximityRequest,
  PointProximityResponse,
} from '@rapierphysicsplugin/shared';
import { FIXED_TIMESTEP, createJointData } from '@rapierphysicsplugin/shared';

export class PhysicsWorld {
  private world: RAPIER.World;
  private rapier: typeof RAPIER;
  private bodyMap: Map<string, RAPIER.RigidBody> = new Map();
  private colliderMap: Map<string, RAPIER.Collider> = new Map();
  private colliderHandleToBodyId: Map<number, string> = new Map();
  private constraintMap: Map<string, RAPIER.ImpulseJoint> = new Map();
  private eventQueue: RAPIER.EventQueue;

  constructor(rapier: typeof RAPIER, gravity: Vec3 = { x: 0, y: -9.81, z: 0 }) {
    this.rapier = rapier;
    this.world = new rapier.World({ x: gravity.x, y: gravity.y, z: gravity.z });
    this.world.timestep = FIXED_TIMESTEP;
    this.eventQueue = new rapier.EventQueue(true);
  }

  addBody(descriptor: BodyDescriptor): string {
    const { rapier, world } = this;
    const { id, shape, motionType, position, rotation, mass, centerOfMass, restitution, friction, isTrigger } = descriptor;

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
    if (isTrigger) {
      colliderDesc.setSensor(true);
    }
    colliderDesc.setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS);

    const collider = world.createCollider(colliderDesc, rigidBody);

    this.bodyMap.set(id, rigidBody);
    this.colliderMap.set(id, collider);
    this.colliderHandleToBodyId.set(collider.handle, id);

    return id;
  }

  removeBody(id: string): void {
    const body = this.bodyMap.get(id);
    if (!body) return;

    const collider = this.colliderMap.get(id);
    if (collider) {
      this.colliderHandleToBodyId.delete(collider.handle);
    }

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
      case 'applyAngularImpulse':
        if (action.data.angImpulse) {
          const body = this.bodyMap.get(action.bodyId);
          if (body) {
            body.applyTorqueImpulse(
              new this.rapier.Vector3(action.data.angImpulse.x, action.data.angImpulse.y, action.data.angImpulse.z),
              true
            );
          }
        }
        break;
      case 'applyTorque':
        if (action.data.torque) {
          const body = this.bodyMap.get(action.bodyId);
          if (body) {
            body.addTorque(
              new this.rapier.Vector3(action.data.torque.x, action.data.torque.y, action.data.torque.z),
              true
            );
          }
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

  addConstraint(descriptor: ConstraintDescriptor): string {
    const { id, bodyIdA, bodyIdB } = descriptor;

    if (this.constraintMap.has(id)) {
      throw new Error(`Constraint with id "${id}" already exists`);
    }

    const rbA = this.bodyMap.get(bodyIdA);
    const rbB = this.bodyMap.get(bodyIdB);
    if (!rbA) throw new Error(`Body "${bodyIdA}" not found for constraint "${id}"`);
    if (!rbB) throw new Error(`Body "${bodyIdB}" not found for constraint "${id}"`);

    const jointData = createJointData(this.rapier, descriptor);
    const joint = this.world.createImpulseJoint(jointData, rbA, rbB, true);

    if (descriptor.collision === false) {
      joint.setContactsEnabled(false);
    }

    this.constraintMap.set(id, joint);
    return id;
  }

  removeConstraint(id: string): void {
    const joint = this.constraintMap.get(id);
    if (!joint) return;
    this.world.removeImpulseJoint(joint, true);
    this.constraintMap.delete(id);
  }

  hasConstraint(id: string): boolean {
    return this.constraintMap.has(id);
  }

  step(): CollisionEventData[] {
    this.world.step(this.eventQueue);

    const events: CollisionEventData[] = [];

    this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      const bodyIdA = this.colliderHandleToBodyId.get(handle1);
      const bodyIdB = this.colliderHandleToBodyId.get(handle2);
      if (!bodyIdA || !bodyIdB) return;

      const collider1 = this.world.getCollider(handle1);
      const collider2 = this.world.getCollider(handle2);
      if (!collider1 || !collider2) return;

      const isSensor = collider1.isSensor() || collider2.isSensor();

      let type: CollisionEventData['type'];
      if (isSensor) {
        type = started ? 'TRIGGER_ENTERED' : 'TRIGGER_EXITED';
      } else {
        type = started ? 'COLLISION_STARTED' : 'COLLISION_FINISHED';
      }

      let point: Vec3 | null = null;
      let normal: Vec3 | null = null;
      let impulse = 0;

      if (started && !isSensor) {
        this.world.contactPair(collider1, collider2, (manifold, flipped) => {
          const cp = manifold.localContactPoint1(0);
          if (cp) {
            point = { x: cp.x, y: cp.y, z: cp.z };
          }
          const n = manifold.localNormal1();
          if (n) {
            normal = flipped
              ? { x: -n.x, y: -n.y, z: -n.z }
              : { x: n.x, y: n.y, z: n.z };
          }
          impulse = manifold.contactImpulse(0) ?? 0;
        });
      }

      events.push({ bodyIdA, bodyIdB, type, point, normal, impulse });
    });

    return events;
  }

  getSnapshot(skipSleeping = false): BodyState[] {
    const states: BodyState[] = [];
    for (const [id, body] of this.bodyMap) {
      if (skipSleeping && body.isSleeping()) continue;
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

  isBodySleeping(id: string): boolean {
    const body = this.bodyMap.get(id);
    return body ? body.isSleeping() : false;
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

  reset(bodies: BodyDescriptor[], constraints?: ConstraintDescriptor[]): void {
    // Remove all existing constraints first (joints reference bodies)
    for (const [, joint] of this.constraintMap) {
      this.world.removeImpulseJoint(joint, true);
    }
    this.constraintMap.clear();

    // Remove all existing bodies
    for (const [, body] of this.bodyMap) {
      this.world.removeRigidBody(body);
    }
    this.bodyMap.clear();
    this.colliderMap.clear();
    this.colliderHandleToBodyId.clear();

    // Reload from descriptors
    this.loadState(bodies);

    // Re-create constraints
    if (constraints) {
      for (const c of constraints) {
        this.addConstraint(c);
      }
    }
  }

  hasBody(id: string): boolean {
    return this.bodyMap.has(id);
  }

  get bodyCount(): number {
    return this.bodyMap.size;
  }

  // --- Shape query methods ---

  private createShapeFromDescriptor(desc: ShapeDescriptor): RAPIER.Shape | null {
    switch (desc.type) {
      case 'box': {
        const p = desc.params as { halfExtents: Vec3 };
        return new this.rapier.Cuboid(p.halfExtents.x, p.halfExtents.y, p.halfExtents.z);
      }
      case 'sphere': {
        const p = desc.params as { radius: number };
        return new this.rapier.Ball(p.radius);
      }
      case 'capsule': {
        const p = desc.params as { halfHeight: number; radius: number };
        return new this.rapier.Capsule(p.halfHeight, p.radius);
      }
      case 'mesh':
        // Rapier cannot use trimeshes as query shapes
        return null;
      default:
        return null;
    }
  }

  shapeCast(request: ShapeCastRequest): ShapeCastResponse {
    const shape = this.createShapeFromDescriptor(request.shape);
    if (!shape) {
      return { queryId: request.queryId, hit: false };
    }

    const startPos = new this.rapier.Vector3(request.startPosition.x, request.startPosition.y, request.startPosition.z);
    const rotation = new this.rapier.Quaternion(request.rotation.x, request.rotation.y, request.rotation.z, request.rotation.w);

    const dx = request.endPosition.x - request.startPosition.x;
    const dy = request.endPosition.y - request.startPosition.y;
    const dz = request.endPosition.z - request.startPosition.z;
    const maxToi = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (maxToi < 1e-8) {
      return { queryId: request.queryId, hit: false };
    }

    const direction = new this.rapier.Vector3(dx / maxToi, dy / maxToi, dz / maxToi);

    const ignoreCollider = request.ignoreBodyId ? this.colliderMap.get(request.ignoreBodyId) : undefined;
    const result = this.world.castShape(
      startPos, rotation, direction, shape, 0, maxToi, true,
      undefined, undefined, ignoreCollider, undefined, undefined,
    );

    if (result) {
      const hitBodyId = this.colliderHandleToBodyId.get(result.collider.handle);
      // Compute hit point from start + direction * toi
      const hitPoint = {
        x: request.startPosition.x + dx * (result.time_of_impact / maxToi),
        y: request.startPosition.y + dy * (result.time_of_impact / maxToi),
        z: request.startPosition.z + dz * (result.time_of_impact / maxToi),
      };
      const witness1 = result.witness1;
      const normal1 = result.normal1;
      return {
        queryId: request.queryId,
        hit: true,
        hitBodyId,
        fraction: result.time_of_impact / maxToi,
        point: witness1 ? { x: witness1.x, y: witness1.y, z: witness1.z } : hitPoint,
        normal: normal1 ? { x: normal1.x, y: normal1.y, z: normal1.z } : undefined,
      };
    }

    return { queryId: request.queryId, hit: false };
  }

  shapeProximity(request: ShapeProximityRequest): ShapeProximityResponse {
    const shape = this.createShapeFromDescriptor(request.shape);
    if (!shape) {
      return { queryId: request.queryId, hit: false };
    }

    const position = new this.rapier.Vector3(request.position.x, request.position.y, request.position.z);
    const rotation = new this.rapier.Quaternion(request.rotation.x, request.rotation.y, request.rotation.z, request.rotation.w);
    const direction = new this.rapier.Vector3(0, 0, 0);
    const ignoreCollider = request.ignoreBodyId ? this.colliderMap.get(request.ignoreBodyId) : undefined;

    const result = this.world.castShape(
      position, rotation, direction, shape, request.maxDistance, 0, true,
      undefined, undefined, ignoreCollider, undefined, undefined,
    );

    if (result) {
      const hitBodyId = this.colliderHandleToBodyId.get(result.collider.handle);
      const witness1 = result.witness1;
      const normal1 = result.normal1;
      return {
        queryId: request.queryId,
        hit: true,
        hitBodyId,
        distance: result.time_of_impact,
        point: witness1 ? { x: witness1.x, y: witness1.y, z: witness1.z } : undefined,
        normal: normal1 ? { x: normal1.x, y: normal1.y, z: normal1.z } : undefined,
      };
    }

    return { queryId: request.queryId, hit: false };
  }

  pointProximity(request: PointProximityRequest): PointProximityResponse {
    const point = new this.rapier.Vector3(request.position.x, request.position.y, request.position.z);
    const ignoreCollider = request.ignoreBodyId ? this.colliderMap.get(request.ignoreBodyId) : undefined;

    const result = this.world.projectPoint(
      point, true,
      undefined, undefined, ignoreCollider, undefined, undefined,
    );

    if (result) {
      const hitBodyId = this.colliderHandleToBodyId.get(result.collider.handle);
      const projected = result.point;
      const dx = projected.x - request.position.x;
      const dy = projected.y - request.position.y;
      const dz = projected.z - request.position.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (distance <= request.maxDistance) {
        const normal = distance > 1e-8
          ? { x: dx / distance, y: dy / distance, z: dz / distance }
          : { x: 0, y: 1, z: 0 };
        return {
          queryId: request.queryId,
          hit: true,
          hitBodyId,
          distance,
          point: { x: projected.x, y: projected.y, z: projected.z },
          normal,
        };
      }
    }

    return { queryId: request.queryId, hit: false };
  }

  destroy(): void {
    this.constraintMap.clear();
    this.eventQueue.free();
    this.world.free();
    this.bodyMap.clear();
    this.colliderMap.clear();
    this.colliderHandleToBodyId.clear();
  }
}
