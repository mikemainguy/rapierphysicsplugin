import type RAPIER from '@dimforge/rapier3d-compat';
import type {
  BodyDescriptor,
  BodyState,
  CollisionEventData,
  ConstraintDescriptor,
  ConstraintUpdates,
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
  ContainerShapeParams,
  ContainerChildShape,
} from '@rapierphysicsplugin/shared';
import { FIXED_TIMESTEP, createJointData } from '@rapierphysicsplugin/shared';

function toFloat32Array(data: unknown): Float32Array {
  if (data instanceof Float32Array) {
    console.log('[toFloat32Array] already Float32Array, length:', (data as Float32Array).length);
    return data;
  }
  console.log('[toFloat32Array] received type:', Object.prototype.toString.call(data),
    'constructor:', (data as any)?.constructor?.name,
    'isView:', ArrayBuffer.isView(data),
    'isArray:', Array.isArray(data));
  if (ArrayBuffer.isView(data)) {
    const view = data as Uint8Array;
    console.log('[toFloat32Array] converting ArrayBufferView, byteLength:', view.byteLength, 'byteOffset:', view.byteOffset);
    const aligned = new ArrayBuffer(view.byteLength);
    new Uint8Array(aligned).set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    const result = new Float32Array(aligned);
    console.log('[toFloat32Array] result length:', result.length, 'first few values:', Array.from(result.slice(0, 5)));
    return result;
  }
  if (Array.isArray(data)) {
    console.log('[toFloat32Array] converting from Array, length:', data.length, 'first few:', data.slice(0, 5));
    return new Float32Array(data);
  }
  console.log('[toFloat32Array] fallback conversion, data:', typeof data);
  return new Float32Array(data as ArrayLike<number>);
}

function toUint32Array(data: unknown): Uint32Array {
  if (data instanceof Uint32Array) {
    console.log('[toUint32Array] already Uint32Array, length:', (data as Uint32Array).length);
    return data;
  }
  console.log('[toUint32Array] received type:', Object.prototype.toString.call(data),
    'constructor:', (data as any)?.constructor?.name,
    'isView:', ArrayBuffer.isView(data),
    'isArray:', Array.isArray(data));
  if (ArrayBuffer.isView(data)) {
    const view = data as Uint8Array;
    console.log('[toUint32Array] converting ArrayBufferView, byteLength:', view.byteLength, 'byteOffset:', view.byteOffset);
    const aligned = new ArrayBuffer(view.byteLength);
    new Uint8Array(aligned).set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    const result = new Uint32Array(aligned);
    console.log('[toUint32Array] result length:', result.length, 'first few values:', Array.from(result.slice(0, 5)));
    return result;
  }
  if (Array.isArray(data)) {
    console.log('[toUint32Array] converting from Array, length:', data.length, 'first few:', data.slice(0, 5));
    return new Uint32Array(data);
  }
  console.log('[toUint32Array] fallback conversion, data:', typeof data);
  return new Uint32Array(data as ArrayLike<number>);
}

export class PhysicsWorld {
  private world: RAPIER.World;
  private rapier: typeof RAPIER;
  private bodyMap: Map<string, RAPIER.RigidBody> = new Map();
  private colliderMap: Map<string, RAPIER.Collider[]> = new Map();
  private colliderHandleToBodyId: Map<number, string> = new Map();
  private constraintMap: Map<string, RAPIER.ImpulseJoint> = new Map();
  private activeCollisionPairs: Set<string> = new Set();
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

    // Create collider(s)
    const applyColliderProps = (desc: RAPIER.ColliderDesc): void => {
      if (centerOfMass !== undefined && motionType === 'dynamic') {
        const m = mass ?? 1.0;
        desc.setMassProperties(
          m,
          { x: centerOfMass.x, y: centerOfMass.y, z: centerOfMass.z },
          { x: m / 6, y: m / 6, z: m / 6 },
          { x: 0, y: 0, z: 0, w: 1 },
        );
      } else if (mass !== undefined && motionType === 'dynamic') {
        desc.setMass(mass);
      }
      if (restitution !== undefined) {
        desc.setRestitution(restitution);
      }
      if (friction !== undefined) {
        desc.setFriction(friction);
      }
      if (isTrigger) {
        desc.setSensor(true);
      }
      desc.setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS);
    };

    const colliders: RAPIER.Collider[] = [];

    if (shape.type === 'container') {
      const cp = shape.params as ContainerShapeParams;
      for (const child of cp.children) {
        const childDesc = this.createColliderDesc(child.shape);
        if (!childDesc) continue;
        if (child.translation) {
          childDesc.setTranslation(child.translation.x, child.translation.y, child.translation.z);
        }
        if (child.rotation) {
          childDesc.setRotation(new rapier.Quaternion(child.rotation.x, child.rotation.y, child.rotation.z, child.rotation.w));
        }
        applyColliderProps(childDesc);
        const col = world.createCollider(childDesc, rigidBody);
        this.colliderHandleToBodyId.set(col.handle, id);
        colliders.push(col);
      }
    } else {
      const colliderDesc = this.createColliderDesc(shape);
      if (colliderDesc) {
        applyColliderProps(colliderDesc);
        const col = world.createCollider(colliderDesc, rigidBody);
        this.colliderHandleToBodyId.set(col.handle, id);
        colliders.push(col);
      }
    }

    this.bodyMap.set(id, rigidBody);
    this.colliderMap.set(id, colliders);

    return id;
  }

  removeBody(id: string): void {
    const body = this.bodyMap.get(id);
    if (!body) return;

    const colliders = this.colliderMap.get(id);
    if (colliders) {
      for (const col of colliders) {
        this.colliderHandleToBodyId.delete(col.handle);
      }
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

  updateConstraint(id: string, updates: ConstraintUpdates): void {
    const joint = this.constraintMap.get(id);
    if (!joint) return;

    if (updates.enabled !== undefined) {
      (joint as any).setEnabled?.(updates.enabled);
    }
    if (updates.collisionsEnabled !== undefined) {
      joint.setContactsEnabled(updates.collisionsEnabled);
    }
    if (updates.axisUpdates) {
      for (const au of updates.axisUpdates) {
        if (au.minLimit !== undefined && au.maxLimit !== undefined) {
          (joint as any).setLimits?.(au.minLimit, au.maxLimit);
        }
        if (au.motorTarget !== undefined) {
          const maxForce = au.motorMaxForce ?? 1000;
          if (au.motorType === 1) { // velocity
            (joint as any).configureMotorVelocity?.(au.motorTarget, maxForce);
          } else {
            (joint as any).configureMotorPosition?.(au.motorTarget, maxForce, 0);
          }
        }
      }
    }
  }

  hasConstraint(id: string): boolean {
    return this.constraintMap.has(id);
  }

  step(): CollisionEventData[] {
    this.world.step(this.eventQueue);

    const events: CollisionEventData[] = [];
    const eventedPairs = new Set<string>();

    this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      const bodyIdA = this.colliderHandleToBodyId.get(handle1);
      const bodyIdB = this.colliderHandleToBodyId.get(handle2);
      if (!bodyIdA || !bodyIdB) return;

      const collider1 = this.world.getCollider(handle1);
      const collider2 = this.world.getCollider(handle2);
      if (!collider1 || !collider2) return;

      const isSensor = collider1.isSensor() || collider2.isSensor();
      const pairKey = handle1 < handle2 ? `${handle1}_${handle2}` : `${handle2}_${handle1}`;
      eventedPairs.add(pairKey);

      let type: CollisionEventData['type'];
      if (isSensor) {
        type = started ? 'TRIGGER_ENTERED' : 'TRIGGER_EXITED';
      } else if (started) {
        type = 'COLLISION_STARTED';
        this.activeCollisionPairs.add(pairKey);
      } else {
        type = 'COLLISION_FINISHED';
        this.activeCollisionPairs.delete(pairKey);
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

    // Emit COLLISION_CONTINUED for active pairs with no Rapier event this frame
    for (const pairKey of this.activeCollisionPairs) {
      if (eventedPairs.has(pairKey)) continue;

      const [h1Str, h2Str] = pairKey.split('_');
      const handle1 = Number(h1Str);
      const handle2 = Number(h2Str);

      const bodyIdA = this.colliderHandleToBodyId.get(handle1);
      const bodyIdB = this.colliderHandleToBodyId.get(handle2);
      if (!bodyIdA || !bodyIdB) {
        // Stale pair — body was removed
        this.activeCollisionPairs.delete(pairKey);
        continue;
      }

      const collider1 = this.world.getCollider(handle1);
      const collider2 = this.world.getCollider(handle2);
      if (!collider1 || !collider2) {
        this.activeCollisionPairs.delete(pairKey);
        continue;
      }

      let point: Vec3 | null = null;
      let normal: Vec3 | null = null;
      let impulse = 0;

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

      events.push({ bodyIdA, bodyIdB, type: 'COLLISION_CONTINUED', point, normal, impulse });
    }

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
    this.activeCollisionPairs.clear();

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

  private createColliderDesc(shape: ShapeDescriptor): RAPIER.ColliderDesc | null {
    const { rapier } = this;
    switch (shape.type) {
      case 'box': {
        const p = shape.params as { halfExtents: Vec3 };
        return rapier.ColliderDesc.cuboid(p.halfExtents.x, p.halfExtents.y, p.halfExtents.z);
      }
      case 'sphere': {
        const p = shape.params as { radius: number };
        return rapier.ColliderDesc.ball(p.radius);
      }
      case 'capsule': {
        const p = shape.params as { halfHeight: number; radius: number };
        return rapier.ColliderDesc.capsule(p.halfHeight, p.radius);
      }
      case 'cylinder': {
        const p = shape.params as { halfHeight: number; radius: number };
        return rapier.ColliderDesc.cylinder(p.halfHeight, p.radius);
      }
      case 'mesh': {
        const p = shape.params as { vertices: Float32Array; indices: Uint32Array };
        console.log('[createColliderDesc] mesh — vertices type:', Object.prototype.toString.call(p.vertices),
          'constructor:', (p.vertices as any)?.constructor?.name,
          'indices type:', Object.prototype.toString.call(p.indices),
          'constructor:', (p.indices as any)?.constructor?.name);
        return rapier.ColliderDesc.trimesh(toFloat32Array(p.vertices), toUint32Array(p.indices));
      }
      case 'convex_hull': {
        const p = shape.params as { vertices: Float32Array };
        console.log('[createColliderDesc] convex_hull — vertices type:', Object.prototype.toString.call(p.vertices),
          'constructor:', (p.vertices as any)?.constructor?.name,
          'instanceof Float32Array:', p.vertices instanceof Float32Array,
          'byteLength:', (p.vertices as any)?.byteLength,
          'length:', (p.vertices as any)?.length);
        if (p.vertices && typeof p.vertices === 'object' && !Array.isArray(p.vertices) && !(p.vertices instanceof Float32Array) && !ArrayBuffer.isView(p.vertices)) {
          console.log('[createColliderDesc] convex_hull — vertices keys:', Object.keys(p.vertices).slice(0, 10),
            'sample values:', JSON.stringify(p.vertices).slice(0, 200));
        }
        const converted = toFloat32Array(p.vertices);
        console.log('[createColliderDesc] convex_hull — converted instanceof Float32Array:', converted instanceof Float32Array,
          'length:', converted.length, 'first 6 values:', Array.from(converted.slice(0, 6)));
        return rapier.ColliderDesc.convexHull(converted) ?? null;
      }
      case 'heightfield': {
        const p = shape.params as { heights: Float32Array; numSamplesX: number; numSamplesZ: number; sizeX: number; sizeZ: number };
        const nrows = p.numSamplesX - 1;
        const ncols = p.numSamplesZ - 1;
        console.log('[createColliderDesc] heightfield — heights type:', Object.prototype.toString.call(p.heights),
          'constructor:', (p.heights as any)?.constructor?.name);
        return rapier.ColliderDesc.heightfield(nrows, ncols, toFloat32Array(p.heights), new rapier.Vector3(p.sizeX, 1, p.sizeZ));
      }
      default:
        return null;
    }
  }

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
      case 'cylinder': {
        const p = desc.params as { halfHeight: number; radius: number };
        return new this.rapier.Cylinder(p.halfHeight, p.radius);
      }
      case 'convex_hull': {
        const p = desc.params as { vertices: Float32Array };
        return new this.rapier.ConvexPolyhedron(toFloat32Array(p.vertices), null);
      }
      case 'mesh':
        // Rapier cannot use trimeshes as query shapes
        return null;
      case 'heightfield':
        // Rapier cannot use heightfields as query shapes
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

    const ignoreRb = request.ignoreBodyId ? this.bodyMap.get(request.ignoreBodyId) : undefined;
    const result = this.world.castShape(
      startPos, rotation, direction, shape, 0, maxToi, true,
      undefined, undefined, undefined, ignoreRb, undefined,
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
    const ignoreRb = request.ignoreBodyId ? this.bodyMap.get(request.ignoreBodyId) : undefined;

    const result = this.world.castShape(
      position, rotation, direction, shape, request.maxDistance, 0, true,
      undefined, undefined, undefined, ignoreRb, undefined,
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
    const ignoreRb = request.ignoreBodyId ? this.bodyMap.get(request.ignoreBodyId) : undefined;

    const result = this.world.projectPoint(
      point, true,
      undefined, undefined, undefined, ignoreRb, undefined,
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
    this.activeCollisionPairs.clear();
    this.eventQueue.free();
    this.world.free();
    this.bodyMap.clear();
    this.colliderMap.clear();
    this.colliderHandleToBodyId.clear();
  }
}
