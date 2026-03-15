import type RAPIER from '@dimforge/rapier3d-compat';
import { Vector3, Matrix, Observable } from '@babylonjs/core';
import type { PhysicsBody } from '@babylonjs/core';
import type { RapierPlugin } from './plugin.js';

export enum CharacterSupportedState {
  UNSUPPORTED = 0,
  SLIDING = 1,
  SUPPORTED = 2,
}

export interface CharacterSurfaceInfo {
  isSurfaceDynamic: boolean;
  supportedState: CharacterSupportedState;
  averageSurfaceNormal: Vector3;
  averageSurfaceVelocity: Vector3;
  averageAngularSurfaceVelocity: Vector3;
}

export interface CharacterShapeOptions {
  capsuleHeight?: number;
  capsuleRadius?: number;
  keepDistance?: number;
}

export interface ICharacterControllerCollisionEvent {
  collider: PhysicsBody | null;
  colliderIndex: number;
  impulse: Vector3;
  impulsePosition: Vector3;
}

export class RapierCharacterController {
  private _plugin: RapierPlugin;
  private _controller: RAPIER.KinematicCharacterController;
  private _rigidBody: RAPIER.RigidBody;
  private _collider: RAPIER.Collider;
  private _position: Vector3;
  private _velocity: Vector3;
  private _up: Vector3;
  private _disposed = false;

  /** Acceleration factor. 1 = reach max velocity immediately. */
  public acceleration = 1;
  /** Maximum acceleration in world-space units/s^2. */
  public maxAcceleration = Infinity;

  public onTriggerCollisionObservable: Observable<ICharacterControllerCollisionEvent>;

  constructor(position: Vector3, options: CharacterShapeOptions, plugin: RapierPlugin) {
    this._plugin = plugin;
    this._position = position.clone();
    this._velocity = Vector3.Zero();
    this._up = new Vector3(0, 1, 0);

    const keepDistance = options.keepDistance ?? 0.02;
    const halfHeight = (options.capsuleHeight ?? 1) / 2;
    const radius = options.capsuleRadius ?? 0.3;

    // Kinematic rigid body
    const bodyDesc = plugin.rapier.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(position.x, position.y, position.z);
    this._rigidBody = plugin.world.createRigidBody(bodyDesc);

    // Capsule collider
    const colliderDesc = plugin.rapier.ColliderDesc.capsule(halfHeight, radius);
    this._collider = plugin.world.createCollider(colliderDesc, this._rigidBody);

    // Character controller
    this._controller = plugin.world.createCharacterController(keepDistance);
    this._controller.setUp(new plugin.rapier.Vector3(0, 1, 0));

    this.onTriggerCollisionObservable = new Observable();
  }

  // --- Position / Velocity ---

  getPosition(): Vector3 { return this._position.clone(); }

  setPosition(position: Vector3): void {
    this._position.copyFrom(position);
    this._rigidBody.setTranslation(
      new this._plugin.rapier.Vector3(position.x, position.y, position.z), true,
    );
  }

  getVelocity(): Vector3 { return this._velocity.clone(); }

  setVelocity(velocity: Vector3): void { this._velocity.copyFrom(velocity); }

  // --- Properties ---

  get keepDistance(): number { return this._controller.offset(); }
  set keepDistance(value: number) { this._controller.setOffset(value); }

  get maxSlopeCosine(): number { return Math.cos(this._controller.maxSlopeClimbAngle()); }
  set maxSlopeCosine(value: number) {
    const angle = Math.acos(Math.max(-1, Math.min(1, value)));
    this._controller.setMaxSlopeClimbAngle(angle);
    this._controller.setMinSlopeSlideAngle(angle);
  }

  get up(): Vector3 { return this._up.clone(); }
  set up(value: Vector3) {
    this._up.copyFrom(value);
    this._controller.setUp(new this._plugin.rapier.Vector3(value.x, value.y, value.z));
  }

  get characterMass(): number | null { return this._controller.characterMass(); }
  set characterMass(value: number | null) { this._controller.setCharacterMass(value); }

  get characterStrength(): boolean { return this._controller.applyImpulsesToDynamicBodies(); }
  set characterStrength(value: boolean) { this._controller.setApplyImpulsesToDynamicBodies(value); }

  // --- Autostep / Snap-to-Ground (Rapier bonus features) ---

  enableAutostep(maxHeight: number, minWidth: number, includeDynamic: boolean): void {
    this._controller.enableAutostep(maxHeight, minWidth, includeDynamic);
  }
  disableAutostep(): void { this._controller.disableAutostep(); }

  enableSnapToGround(distance: number): void { this._controller.enableSnapToGround(distance); }
  disableSnapToGround(): void { this._controller.disableSnapToGround(); }

  // --- Core ---

  /**
   * Ensure the Rapier query pipeline is up-to-date so that
   * `computeColliderMovement` can detect colliders. This is needed when
   * the hosting plugin does not call `world.step()` each frame (e.g.
   * NetworkedRapierPlugin delegates stepping to the server).
   */
  private _updateQueryPipeline(): void {
    const world = this._plugin.world;
    const saved = world.timestep;
    world.timestep = 0;
    world.step();
    world.timestep = saved;
  }

  checkSupport(dt: number, direction: Vector3): CharacterSurfaceInfo {
    const { rapier } = this._plugin;

    this._updateQueryPipeline();
    this._syncRigidBody();
    this._controller.computeColliderMovement(
      this._collider,
      new rapier.Vector3(direction.x * dt, direction.y * dt, direction.z * dt),
      rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      (col: RAPIER.Collider) => col.handle !== this._collider.handle,
    );

    const grounded = this._controller.computedGrounded();
    const numCollisions = this._controller.numComputedCollisions();

    const surfaceNormal = Vector3.Zero();
    const surfaceVelocity = Vector3.Zero();
    const angularSurfaceVelocity = Vector3.Zero();
    let isSurfaceDynamic = false;
    let normalCount = 0;

    for (let i = 0; i < numCollisions; i++) {
      const collision = this._controller.computedCollision(i);
      if (!collision) continue;

      const n = collision.normal1;
      surfaceNormal.x += n.x;
      surfaceNormal.y += n.y;
      surfaceNormal.z += n.z;
      normalCount++;

      if (collision.collider) {
        const body = this._plugin.colliderHandleToBody.get(collision.collider.handle);
        if (body) {
          const rb = this._plugin.bodyToRigidBody.get(body);
          if (rb) {
            if (rb.isDynamic()) isSurfaceDynamic = true;
            const lv = rb.linvel();
            surfaceVelocity.x += lv.x; surfaceVelocity.y += lv.y; surfaceVelocity.z += lv.z;
            const av = rb.angvel();
            angularSurfaceVelocity.x += av.x; angularSurfaceVelocity.y += av.y; angularSurfaceVelocity.z += av.z;
          }
        }
      }
    }

    if (normalCount > 0) {
      surfaceNormal.scaleInPlace(1 / normalCount);
      surfaceVelocity.scaleInPlace(1 / normalCount);
      angularSurfaceVelocity.scaleInPlace(1 / normalCount);
    }

    let supportedState: CharacterSupportedState;
    if (!grounded) {
      supportedState = CharacterSupportedState.UNSUPPORTED;
    } else {
      const computed = this._controller.computedMovement();
      const dot = computed.x * direction.x + computed.y * direction.y + computed.z * direction.z;
      const dirLen = Math.sqrt(direction.x ** 2 + direction.y ** 2 + direction.z ** 2);
      supportedState = (dirLen > 0 && Math.abs(dot) / dirLen > 0.01 * dt)
        ? CharacterSupportedState.SLIDING
        : CharacterSupportedState.SUPPORTED;
    }

    return {
      supportedState,
      averageSurfaceNormal: surfaceNormal,
      averageSurfaceVelocity: surfaceVelocity,
      averageAngularSurfaceVelocity: angularSurfaceVelocity,
      isSurfaceDynamic,
    };
  }

  integrate(dt: number, supportInfo: CharacterSurfaceInfo, gravity: Vector3): void {
    const { rapier } = this._plugin;

    this._updateQueryPipeline();

    // Apply gravity based on support state
    if (supportInfo.supportedState === CharacterSupportedState.UNSUPPORTED) {
      this._velocity.addInPlace(gravity.scale(dt));
    } else if (supportInfo.supportedState === CharacterSupportedState.SLIDING) {
      const n = supportInfo.averageSurfaceNormal;
      const gravDotN = Vector3.Dot(gravity, n);
      this._velocity.addInPlace(gravity.subtract(n.scale(gravDotN)).scale(dt));
    }

    const d = this._velocity.scale(dt);

    this._syncRigidBody();
    this._controller.computeColliderMovement(
      this._collider,
      new rapier.Vector3(d.x, d.y, d.z),
      rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      (col: RAPIER.Collider) => col.handle !== this._collider.handle,
    );

    const m = this._controller.computedMovement();
    this._position.x += m.x;
    this._position.y += m.y;
    this._position.z += m.z;

    if (dt > 0) this._velocity.set(m.x / dt, m.y / dt, m.z / dt);

    this._syncRigidBody();
    this._fireCollisionEvents();
  }

  moveWithCollisions(displacement: Vector3): Vector3 {
    const { rapier } = this._plugin;

    this._updateQueryPipeline();
    this._syncRigidBody();
    this._controller.computeColliderMovement(
      this._collider,
      new rapier.Vector3(displacement.x, displacement.y, displacement.z),
      rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      (col: RAPIER.Collider) => col.handle !== this._collider.handle,
    );

    const m = this._controller.computedMovement();
    this._position.x += m.x;
    this._position.y += m.y;
    this._position.z += m.z;

    this._syncRigidBody();
    this._fireCollisionEvents();
    return new Vector3(m.x, m.y, m.z);
  }

  /**
   * Pure-math velocity helper — matches Babylon.js PhysicsCharacterController.calculateMovementToRef.
   * Projects desiredVelocity onto the surface frame, applies acceleration clamping,
   * and writes the result into `result`.
   * @returns true if the result was computed, false if forward/up are nearly parallel
   */
  calculateMovementToRef(
    deltaTime: number,
    forwardWorld: Vector3,
    surfaceNormal: Vector3,
    currentVelocity: Vector3,
    surfaceVelocity: Vector3,
    desiredVelocity: Vector3,
    upWorld: Vector3,
    result: Vector3,
  ): boolean {
    const eps = 1e-5;
    let binorm = forwardWorld.cross(upWorld);
    if (binorm.lengthSquared() < eps) return false;
    binorm.normalize();

    const tangent = binorm.cross(surfaceNormal);
    tangent.normalize();
    binorm = tangent.cross(surfaceNormal);
    binorm.normalize();

    const surfaceFrame = Matrix.FromValues(
      tangent.x, tangent.y, tangent.z, 0,
      binorm.x, binorm.y, binorm.z, 0,
      surfaceNormal.x, surfaceNormal.y, surfaceNormal.z, 0,
      0, 0, 0, 1,
    );
    const invSurfaceFrame = surfaceFrame.clone().invert();

    const relativeWorld = currentVelocity.subtract(surfaceVelocity);
    const relative = Vector3.TransformNormal(relativeWorld, invSurfaceFrame);

    const sideVec = upWorld.cross(forwardWorld);
    const fwd = desiredVelocity.dot(forwardWorld);
    const side = desiredVelocity.dot(sideVec);
    const len = desiredVelocity.length();

    const desiredVelocitySF = new Vector3(-fwd, side, 0);
    desiredVelocitySF.normalize();
    desiredVelocitySF.scaleInPlace(len);

    const diff = desiredVelocitySF.subtract(relative);

    // Clamp by maxAcceleration and limit by gain
    const lenSq = diff.lengthSquared();
    const maxVelocityDelta = this.maxAcceleration * deltaTime;
    const tmp = (lenSq * this.acceleration * this.acceleration > maxVelocityDelta * maxVelocityDelta)
      ? maxVelocityDelta / Math.sqrt(lenSq)
      : this.acceleration;
    diff.scaleInPlace(tmp);

    relative.addInPlace(diff);
    Vector3.TransformNormalToRef(relative, surfaceFrame, result);
    result.addInPlace(surfaceVelocity);
    return true;
  }

  calculateMovement(
    deltaTime: number,
    forwardWorld: Vector3,
    surfaceNormal: Vector3,
    currentVelocity: Vector3,
    surfaceVelocity: Vector3,
    desiredVelocity: Vector3,
    upWorld: Vector3,
  ): Vector3 {
    const result = Vector3.Zero();
    this.calculateMovementToRef(deltaTime, forwardWorld, surfaceNormal, currentVelocity, surfaceVelocity, desiredVelocity, upWorld, result);
    return result;
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._plugin.world.removeCharacterController(this._controller);
    this._plugin.world.removeRigidBody(this._rigidBody);
    this.onTriggerCollisionObservable.clear();
  }

  // --- Private helpers ---

  private _syncRigidBody(): void {
    this._rigidBody.setTranslation(
      new this._plugin.rapier.Vector3(this._position.x, this._position.y, this._position.z), true,
    );
  }

  private _fireCollisionEvents(): void {
    const n = this._controller.numComputedCollisions();
    for (let i = 0; i < n; i++) {
      const c = this._controller.computedCollision(i);
      if (!c) continue;

      let body: PhysicsBody | null = null;
      if (c.collider) {
        body = this._plugin.colliderHandleToBody.get(c.collider.handle) ?? null;
      }

      this.onTriggerCollisionObservable.notifyObservers({
        collider: body,
        colliderIndex: i,
        impulse: new Vector3(
          c.translationDeltaApplied.x,
          c.translationDeltaApplied.y,
          c.translationDeltaApplied.z,
        ),
        impulsePosition: new Vector3(c.witness1.x, c.witness1.y, c.witness1.z),
      });
    }
  }
}
