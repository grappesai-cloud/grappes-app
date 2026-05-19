import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import { Suspense, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
export type BrainRegion = {
  id: string;
  label: string;
  source: string;
  center: [number, number, number];
  radius: number;
  activity: number;
};
type Props = {
  regions: BrainRegion[];
  liveValue?: number;
  currentTime?: number;
  totalDuration?: number;
  className?: string;
  axisConvention?: AxisConvention;
};
export type AxisConvention = {
  flipX: boolean;
  flipY: boolean;
  flipZ: boolean;
};
type Hemisphere = "both" | "L" | "R";
const REGION_SLOTS = 8;
const VERT = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vObjectPos;
  void main() {
    vObjectPos = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  uniform float uHemiMask;
  uniform vec3  uRegionCenters[${REGION_SLOTS}];
  uniform float uRegionRadii[${REGION_SLOTS}];
  uniform float uRegionActivities[${REGION_SLOTS}];
  uniform vec3  uRegionDebugColors[${REGION_SLOTS}];
  uniform int   uRegionCount;
  uniform float uDebug;
  // fMRI heat palette: dark blue -> blue -> teal -> green -> yellow -> orange -> red
  vec3 palette(float t) {
    t = clamp(t, 0.0, 1.0);
    vec3 cBlueDark  = vec3(0.04, 0.06, 0.22);
    vec3 cBlue      = vec3(0.10, 0.32, 0.78);
    vec3 cTeal      = vec3(0.10, 0.65, 0.70);
    vec3 cGreen     = vec3(0.30, 0.82, 0.40);
    vec3 cYellow    = vec3(0.96, 0.90, 0.18);
    vec3 cOrange    = vec3(0.97, 0.55, 0.12);
    vec3 cRed       = vec3(0.94, 0.18, 0.16);
    if (t < 0.15)      return mix(cBlueDark, cBlue,  t / 0.15);
    else if (t < 0.35) return mix(cBlue,     cTeal,  (t - 0.15) / 0.20);
    else if (t < 0.55) return mix(cTeal,     cGreen, (t - 0.35) / 0.20);
    else if (t < 0.72) return mix(cGreen,    cYellow,(t - 0.55) / 0.17);
    else if (t < 0.88) return mix(cYellow,   cOrange,(t - 0.72) / 0.16);
    return mix(cOrange, cRed, (t - 0.88) / 0.12);
  }
  void main() {
    float fresnel = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 2.4);
    if (uHemiMask > 0.5 && vWorldPos.x < -0.05) discard;
    if (uHemiMask < -0.5 && vWorldPos.x > 0.05) discard;
    // Each region contributes a gaussian-falloff hotspot driven by a real
    // per-second signal (motion / loudness / cut density / scene cuts).
    // No procedural noise, no time-drift, no embellishment.
    float regional = 0.0;
    int dominantIdx = -1;
    float dominantFalloff = 0.0;
    for (int i = 0; i < ${REGION_SLOTS}; i++) {
      if (i >= uRegionCount) break;
      vec3 d = vWorldPos - uRegionCenters[i];
      float r = max(uRegionRadii[i], 0.0001);
      float dist2 = dot(d, d);
      float falloff = exp(-dist2 / (r * r));
      float contrib = uRegionActivities[i] * falloff;
      if (contrib > regional) regional = contrib;
      if (falloff > dominantFalloff) {
        dominantFalloff = falloff;
        dominantIdx = i;
      }
    }
    float activation = clamp(0.06 + regional * 0.94, 0.0, 1.0);
    vec3 col;
    if (uDebug > 0.5 && dominantIdx >= 0) {
      // Debug mode: paint each region with its own color regardless of activity.
      vec3 dcol = vec3(0.1);
      for (int i = 0; i < ${REGION_SLOTS}; i++) {
        if (i == dominantIdx) dcol = uRegionDebugColors[i];
      }
      col = mix(vec3(0.02, 0.04, 0.10), dcol, clamp(dominantFalloff * 1.4, 0.0, 1.0));
    } else {
      col = palette(activation);
    }
    float diffuse = 0.55 + 0.45 * max(dot(vNormal, normalize(vec3(0.4, 0.8, 0.5))), 0.0);
    col *= diffuse;
    if (uDebug < 0.5) {
      col += palette(min(activation + 0.10, 1.0)) * fresnel * 0.40;
    }
    col += pow(fresnel, 5.0) * 0.30;
    gl_FragColor = vec4(col, 1.0);
  }
`;
const DEBUG_COLORS: [number, number, number][] = [
  [0.95, 0.35, 0.25], // occipital — red
  [0.30, 0.70, 0.95], // temporal L — light blue
  [0.30, 0.95, 0.80], // temporal R — cyan
  [0.95, 0.55, 0.20], // limbic — orange
  [0.65, 0.40, 0.95], // prefrontal — purple
  [0.95, 0.85, 0.30], // hippocampus L — yellow
  [0.55, 0.95, 0.40], // hippocampus R — green
  [0.95, 0.40, 0.75], // slot 8 — pink
];
function BrainMesh({
  hemi,
  regions,
  debug,
  axisConvention,
  onClickWorld,
}: {
  hemi: Hemisphere;
  regions: BrainRegion[];
  debug: boolean;
  axisConvention: AxisConvention;
  onClickWorld?: (p: { x: number; y: number; z: number }) => void;
}) {
  const obj = useLoader(OBJLoader, "/brain.obj");
  const matsRef = useRef<THREE.ShaderMaterial[]>([]);
  const activitiesRef = useRef<number[]>(new Array(REGION_SLOTS).fill(0));
  const { processed } = useMemo(() => {
    const cloned = obj.clone(true);
    const box = new THREE.Box3().setFromObject(cloned);
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const scale = 2.4 / size;
    cloned.position.sub(c).multiplyScalar(scale);
    cloned.scale.setScalar(scale);
    cloned.updateMatrixWorld(true);
    return { processed: cloned };
  }, [obj]);
  const hemiMask = hemi === "L" ? -1 : hemi === "R" ? 1 : 0;
  const sx = axisConvention.flipX ? -1 : 1;
  const sy = axisConvention.flipY ? -1 : 1;
  const sz = axisConvention.flipZ ? -1 : 1;
  const centersValue = useMemo(() => {
    const arr: THREE.Vector3[] = [];
    for (let i = 0; i < REGION_SLOTS; i++) {
      const r = regions[i];
      arr.push(
        r
          ? new THREE.Vector3(
              r.center[0] * sx,
              r.center[1] * sy,
              r.center[2] * sz,
            )
          : new THREE.Vector3(0, 0, 0),
      );
    }
    return arr;
  }, [regions, sx, sy, sz]);
  const radiiValue = useMemo(() => {
    const arr = new Array(REGION_SLOTS).fill(0.001);
    regions.forEach((r, i) => {
      if (i < REGION_SLOTS) arr[i] = r.radius;
    });
    return arr;
  }, [regions]);
  matsRef.current = [];
  processed.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      if (!(child.userData.brainMat instanceof THREE.ShaderMaterial)) {
        const debugColors = DEBUG_COLORS.map(
          (c) => new THREE.Vector3(c[0], c[1], c[2]),
        );
        const mat = new THREE.ShaderMaterial({
          vertexShader: VERT,
          fragmentShader: FRAG,
          uniforms: {
            uHemiMask: { value: hemiMask },
            uRegionCenters: { value: centersValue },
            uRegionRadii: { value: radiiValue },
            uRegionActivities: { value: activitiesRef.current.slice() },
            uRegionDebugColors: { value: debugColors },
            uRegionCount: { value: regions.length },
            uDebug: { value: debug ? 1 : 0 },
          },
          transparent: false,
          side: THREE.FrontSide,
        });
        child.userData.brainMat = mat;
        child.material = mat;
      }
      matsRef.current.push(child.userData.brainMat as THREE.ShaderMaterial);
    }
  });
  useFrame(() => {
    // Lerp toward the real signal values so transitions are visible but the
    // activation itself is purely data-driven — no procedural drift.
    const target = activitiesRef.current;
    for (let i = 0; i < REGION_SLOTS; i++) {
      const want = regions[i]?.activity ?? 0;
      target[i] += (want - target[i]) * 0.20;
    }
    for (const m of matsRef.current) {
      m.uniforms.uHemiMask.value = hemiMask;
      m.uniforms.uRegionCount.value = regions.length;
      m.uniforms.uDebug.value = debug ? 1 : 0;
      const dest = m.uniforms.uRegionActivities.value as number[];
      for (let i = 0; i < REGION_SLOTS; i++) dest[i] = target[i];
      (m.uniforms.uRegionCenters.value as THREE.Vector3[]).forEach((v, i) => {
        const src = centersValue[i];
        v.set(src.x, src.y, src.z);
      });
      const radii = m.uniforms.uRegionRadii.value as number[];
      for (let i = 0; i < REGION_SLOTS; i++) radii[i] = radiiValue[i];
    }
  });
  return (
    <>
      <primitive
        object={processed}
        onClick={
          onClickWorld
            ? (e: { point: THREE.Vector3; stopPropagation: () => void }) => {
                e.stopPropagation();
                onClickWorld({ x: e.point.x, y: e.point.y, z: e.point.z });
              }
            : undefined
        }
      />
      {debug && (
        <>
          <axesHelper args={[1.2]} />
          {regions.map((r, i) => (
            <mesh
              key={r.id}
              position={[
                r.center[0] * sx,
                r.center[1] * sy,
                r.center[2] * sz,
              ]}
            >
              <sphereGeometry args={[0.04, 12, 12]} />
              <meshBasicMaterial
                color={
                  new THREE.Color(
                    DEBUG_COLORS[i]?.[0] ?? 1,
                    DEBUG_COLORS[i]?.[1] ?? 1,
                    DEBUG_COLORS[i]?.[2] ?? 1,
                  )
                }
              />
            </mesh>
          ))}
        </>
      )}
    </>
  );
}
function Fallback() {
  return (
    <mesh>
      <icosahedronGeometry args={[1, 2]} />
      <meshBasicMaterial color="#0f0f12" wireframe />
    </mesh>
  );
}
export default function BrainHeatmap({
  regions,
  liveValue,
  currentTime = 0,
  totalDuration = 0,
  className,
  axisConvention,
}: Props) {
  const [hemi, setHemi] = useState<Hemisphere>("both");
  const [debug, setDebug] = useState(false);
  const [axes, setAxes] = useState<AxisConvention>(
    () =>
      axisConvention ?? { flipX: false, flipY: false, flipZ: false },
  );
  const [lastPick, setLastPick] = useState<{
    x: number;
    y: number;
    z: number;
  } | null>(null);
  const overallHeat = regions.length
    ? regions.reduce((a, r) => a + r.activity, 0) / regions.length
    : 0;
  const displayValue = Math.round(liveValue ?? overallHeat * 100);
  const isPlaying = currentTime > 0;
  const hottest = regions.length
    ? [...regions].sort((a, b) => b.activity - a.activity)[0]
    : undefined;
  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-[radial-gradient(circle_at_50%_50%,rgba(244,63,94,0.10),rgba(0,0,0,0.85))] ring-1 ring-zinc-900 ${className ?? "h-full min-h-[420px] w-full"}`}
    >
      <Canvas
        camera={{ position: [0, 0.1, 3.4], fov: 38 }}
        gl={{
          antialias: true,
          powerPreference: "high-performance",
          alpha: true,
        }}
      >
        <color attach="background" args={["#040406"]} />
        <ambientLight intensity={0.3} />
        <pointLight position={[3, 4, 5]} intensity={0.95} color="#ffe0c2" />
        <pointLight position={[-3, -2, -3]} intensity={0.55} color="#5e9fff" />
        <Suspense fallback={<Fallback />}>
          <BrainMesh
            hemi={hemi}
            regions={regions}
            debug={debug}
            axisConvention={axes}
            onClickWorld={debug ? (p) => setLastPick(p) : undefined}
          />
          <Environment preset="city" />
        </Suspense>
        <OrbitControls
          enableZoom={false}
          enablePan={false}
          rotateSpeed={0.6}
        />
      </Canvas>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_55%,rgba(0,0,0,0.55))]" />
      <div className="absolute right-3 top-3 flex gap-1 rounded-full border border-zinc-800 bg-zinc-950/80 p-0.5 font-mono text-[10px] uppercase tracking-widest backdrop-blur">
        {(["both", "L", "R"] as const).map((h) => (
          <button
            key={h}
            type="button"
            onClick={() => setHemi(h)}
            className={`rounded-full px-2.5 py-1 transition ${
              hemi === h ? "bg-zinc-100 text-zinc-900" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {h === "both" ? "both" : h}
          </button>
        ))}
      </div>
      <div className="absolute left-3 top-3 flex items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950/80 px-2.5 py-1 font-mono text-[9px] uppercase tracking-widest backdrop-blur">
          <span
            className={`h-1.5 w-1.5 rounded-full ${isPlaying ? "bg-emerald-400 shadow-[0_0_8px_currentColor]" : "bg-zinc-600"}`}
          />
          <span className="text-zinc-400">
            {isPlaying ? "live" : "idle"}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setDebug((v) => !v)}
          className={`rounded-full border px-2.5 py-1 font-mono text-[9px] uppercase tracking-widest backdrop-blur transition ${
            debug
              ? "border-fuchsia-700 bg-fuchsia-950/40 text-fuchsia-200"
              : "border-zinc-800 bg-zinc-950/80 text-zinc-500 hover:text-zinc-200"
          }`}
          title="Color each region distinctly · pin spheres at center · click to inspect coords"
        >
          {debug ? "regions" : "debug"}
        </button>
      </div>
      {debug && (
        <div className="absolute left-3 top-12 flex flex-col gap-1.5">
          <div className="flex gap-1 rounded-full border border-zinc-800 bg-zinc-950/85 px-1.5 py-1 font-mono text-[9px] uppercase tracking-widest backdrop-blur">
            <span className="px-1 text-zinc-500">flip</span>
            {(["X", "Y", "Z"] as const).map((axis) => {
              const key = `flip${axis}` as const;
              const active = axes[key];
              return (
                <button
                  key={axis}
                  type="button"
                  onClick={() =>
                    setAxes((a) => ({ ...a, [key]: !a[key] }))
                  }
                  className={`rounded-full px-1.5 transition ${
                    active
                      ? "bg-fuchsia-500/80 text-zinc-900"
                      : "text-zinc-400 hover:text-zinc-100"
                  }`}
                >
                  {axis}
                </button>
              );
            })}
          </div>
          {lastPick && (
            <div className="rounded-md border border-zinc-800 bg-zinc-950/85 px-2 py-1 font-mono text-[9px] tabular-nums text-zinc-300 backdrop-blur">
              pick · x={lastPick.x.toFixed(2)} y={lastPick.y.toFixed(2)} z=
              {lastPick.z.toFixed(2)}
            </div>
          )}
          <div className="rounded-md border border-zinc-900 bg-zinc-950/85 px-2 py-1 font-mono text-[9px] leading-snug text-zinc-500 backdrop-blur">
            <div className="text-zinc-300">axes</div>
            <div>
              <span className="text-red-400">x</span> /{" "}
              <span className="text-green-400">y</span> /{" "}
              <span className="text-blue-400">z</span> · click to pick coords
            </div>
          </div>
        </div>
      )}
      {hottest && hottest.activity > 0.05 && (
        <div className="pointer-events-none absolute right-3 top-12 flex max-w-[60%] items-center gap-1.5 rounded-full border border-amber-700/60 bg-zinc-950/80 px-2.5 py-1 font-mono text-[9px] uppercase tracking-widest text-amber-300 backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_currentColor]" />
          firing · {hottest.label} · {hottest.source}
        </div>
      )}
      <div className="pointer-events-none absolute left-3 bottom-20 hidden max-w-[55%] rounded-lg border border-zinc-900 bg-zinc-950/85 p-2.5 font-mono text-[9px] leading-relaxed text-zinc-400 backdrop-blur sm:block">
        <div className="mb-1 flex items-center gap-1.5 uppercase tracking-widest text-zinc-500">
          <span className="inline-block h-1 w-1 rounded-full bg-emerald-400" />
          measured signals
        </div>
        {regions.slice(0, 5).map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between gap-3"
          >
            <span className="text-zinc-300">{r.label}</span>
            <span className="text-zinc-500">{r.source}</span>
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex items-end justify-between">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-widest text-zinc-500">
            {isPlaying ? "engagement now" : "average activity"}
          </div>
          <div className="font-mono text-xl font-medium tabular-nums text-zinc-100">
            {displayValue}
            <span className="text-xs text-zinc-600">/100</span>
          </div>
          {totalDuration > 0 && isPlaying && (
            <div className="mt-0.5 font-mono text-[9px] text-zinc-500">
              t = {currentTime.toFixed(1)}s / {totalDuration.toFixed(0)}s
            </div>
          )}
        </div>
        <div className="rounded-full border border-zinc-800 bg-zinc-950/80 px-2.5 py-1 font-mono text-[9px] uppercase tracking-widest text-zinc-500 backdrop-blur">
          drag to rotate
        </div>
      </div>
    </div>
  );
}
