// Cascaded sun / moon light of the 'cinematic' tier (SPEC §7.5.3).
//
// three.js r186's WebGL renderer has a first-class two-cascade sun light (`isSunLight`: the
// shader chunks pick a cascade by view depth and blend between them, the shadow map is one
// atlas with a viewport per cascade), but its example classes fit the cascades to the view
// frustum, which changes with every mouse movement. Our sun map holds only the static world
// and is re-rendered on demand (lights.js), so this variant fits the cascades to spheres
// around the CAMERA POSITION instead: rotation-invariant, texel-snapped, and valid until the
// camera has travelled `drift` units. Same interface as three's SunLight / SunLightShadow
// (`_cascadeData`, `getMatrix`, `getCamera`, `getFrustum`, `updateMatrices`, 2 viewports in an
// atlas `frameExtents (2, 1)`), so no shader is patched for it.
//
//   cascade 0: view depth 0 .. depths[0]      (near: ~9 mm texels at 4096 px)
//   cascade 1: depths[0] .. depths[1]         (far: the rest of the fog range; fades to lit)
//
// Coverage: a point at view depth d and angle θ off the view axis lies d / cos θ from the
// camera, at most d × k for the frustum's half diagonal (k = sqrt(1 + tan²h + tan²v)), so the
// cascade sphere has radius depth × k + drift.

import * as THREE from 'three';

const CASCADES = 2;
const FADE = 0.12;              // fraction of a cascade's depth range that blends into the next
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3();
const _orient = new THREE.Matrix4();
const _c = new THREE.Vector3();

export class HHSunShadow extends THREE.LightShadow {
  constructor() {
    super(new THREE.OrthographicCamera(-5, 5, 5, -5, 0.5, 500));
    this.isSunLightShadow = true;
    this.mapSize.set(2048, 2048);
    this._cameras = [];
    this._matrices = [];
    this._frustums = [];
    this._cascadeData = [];
    this._viewportCount = CASCADES;
    this._frameExtents.set(CASCADES, 1);
    for (let i = 0; i < CASCADES; i++) {
      this._cameras.push(new THREE.OrthographicCamera());
      this._matrices.push(new THREE.Matrix4());
      this._frustums.push(new THREE.Frustum());
      this._cascadeData.push(new THREE.Vector4());
    }
    while (this._viewports.length < CASCADES) this._viewports.push(new THREE.Vector4());
    /** World point the cascades are centred on (lights.js snaps it and re-renders when it moves). */
    this.center = new THREE.Vector3();
    /** View depths where cascade 0 and cascade 1 end. */
    this.depths = [320, 1900];
    /** Distance the camera may drift from `center` before the map is redrawn (adds to the radii). */
    this.drift = [110, 260];
    /** Half diagonal factor of the view frustum (see file header); lights.js keeps it current. */
    this.k = 1.7;
    /** How far toward the light casters may stand outside a cascade's sphere and still shadow it (tall buildings, low sun). */
    this.reach = 900;
    this.radii = [0, 0];
  }

  getCamera(i = 0) { return this._cameras[i]; }
  getMatrix(i = 0) { return this._matrices[i]; }
  getFrustum(i = 0) { return this._frustums[i]; }

  /** Cascade sphere radii for the current depths / k / drift. */
  fit() {
    this.radii[0] = this.depths[0] * this.k + this.drift[0];
    this.radii[1] = this.depths[1] * this.k + this.drift[1];
    return this.radii;
  }

  updateMatrices(light /* , viewCamera (ignored: the cascades follow the camera POSITION) */) {
    // inset the atlas viewports so the filter never reads across tiles
    const insetX = Math.min(0.25, (Math.ceil(this.radius) + 2) / this.mapSize.x);
    const insetY = Math.min(0.25, (Math.ceil(this.radius) + 2) / this.mapSize.y);
    for (let i = 0; i < CASCADES; i++) this._viewports[i].set(i + insetX, insetY, 1 - 2 * insetX, 1 - 2 * insetY);
    const resX = this.mapSize.x * (1 - 2 * insetX), resY = this.mapSize.y * (1 - 2 * insetY);
    this.fit();

    _dir.setFromMatrixPosition(light.matrixWorld).negate().normalize();   // the way the light travels
    _up.set(0, 1, 0);
    if (Math.abs(_up.dot(_dir)) > 0.99) _up.set(0, 0, 1);
    _orient.lookAt(_c.set(0, 0, 0), _dir, _up);
    // centre in light space, for snapping to the texel grid
    const inv = new THREE.Matrix4().copy(_orient).transpose();
    const lc = new THREE.Vector3().copy(this.center).applyMatrix4(inv);

    for (let i = 0; i < CASCADES; i++) {
      const r = this.radii[i];
      const texX = (2 * r) / resX, texY = (2 * r) / resY;
      const cx = Math.round(lc.x / texX) * texX, cy = Math.round(lc.y / texY) * texY;
      // the camera sits above the sphere, toward the light (light-space z points to the light), so
      // casters that stand up to `reach` beyond it (tall buildings, a low sun) still fall inside the depth range
      const ceiling = r + this.reach;
      _c.set(cx, cy, lc.z + ceiling).applyMatrix4(_orient);
      const cam = this._cameras[i];
      cam.position.copy(_c);
      cam.quaternion.setFromRotationMatrix(_orient);
      cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
      cam.near = 1;
      cam.far = ceiling + r + 120;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      this._updateMatrix(cam, this._matrices[i], this._frustums[i], this._viewports[i]);
      // view depths this cascade answers for: 0 .. depths[0], then depths[0] (minus the blend band) .. depths[1]
      const end = this.depths[i];
      const begin = i === 0 ? -1e10 : this._cascadeData[i - 1].z;
      const start = i === 0 ? 0 : this.depths[i - 1];
      this._cascadeData[i].set(begin, end, end - FADE * (end - start), 0);
    }
  }
}

export class HHSunLight extends THREE.Light {
  /**
   * @param {THREE.ColorRepresentation} color
   * @param {number} intensity
   */
  constructor(color, intensity) {
    super(color, intensity);
    this.isSunLight = true;
    this.type = 'SunLight';
    this.position.copy(THREE.Object3D.DEFAULT_UP);
    this.updateMatrix();
    this.shadow = new HHSunShadow();
  }

  dispose() {
    super.dispose();
    this.shadow.dispose();
  }
}
