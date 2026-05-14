import * as THREE from "three";
import type { PointRenderPreset } from "../../shared/ViewerModeTypes";

export type { PointRenderPreset };
export type DisplayPointMaterial = THREE.ShaderMaterial | THREE.PointsMaterial;

export function createPointCloudMaterial(pointSizePx: number, hasRgb: boolean, preset: PointRenderPreset): DisplayPointMaterial {
  if (preset === "default") {
    try {
      return createRoundPointShaderMaterial(pointSizePx, hasRgb);
    } catch (error) {
      console.warn("Round point shader creation failed; falling back to stable points.", error);
    }
  }

  return createStablePointsMaterial(pointSizePx, hasRgb);
}

export function createStablePointsMaterial(pointSizePx: number, hasRgb: boolean): THREE.PointsMaterial {
  return new THREE.PointsMaterial({
    size: pointSizePx,
    vertexColors: hasRgb,
    color: hasRgb ? 0xffffff : 0xdce6f2,
    sizeAttenuation: false,
    transparent: false,
    depthTest: true,
    depthWrite: true
  });
}

function createRoundPointShaderMaterial(pointSizePx: number, hasRgb: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      pointSize: { value: pointSizePx },
      fallbackColor: { value: new THREE.Color(0xdce6f2) }
    },
    vertexShader: `
      attribute vec3 color;
      uniform float pointSize;
      uniform vec3 fallbackColor;
      varying vec3 vColor;

      void main() {
        vColor = ${hasRgb ? "color" : "fallbackColor"};
        gl_PointSize = pointSize;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;

      void main() {
        vec2 center = gl_PointCoord - vec2(0.5);
        float radius = length(center);
        if (radius > 0.5) {
          discard;
        }

        float alpha = 1.0 - smoothstep(0.46, 0.5, radius);
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
    depthTest: true,
    depthWrite: true,
    transparent: true,
    vertexColors: false
  });
}
