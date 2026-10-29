import { Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useAnimations, useGLTF } from '@react-three/drei';
import { LoopOnce, LoopRepeat } from 'three';

// Blenderで作ったスライム（public/models/slime.glb）
// 高さ 1.0・原点は足元・正面は +Z。アクション Idle / Walk / Jump と、シェイプキー MouthOpen を持つ
const MODEL_URL = `${import.meta.env.BASE_URL}models/slime.glb`;
useGLTF.preload(MODEL_URL);

// 進化段階ごとの大きさ（段階 0〜4）
export const STAGE_SCALES = [1.0, 1.15, 1.3, 1.45, 1.6];

// カメラと足元の位置（表示枠は正方形で、その内側の円だけが見える）
const CAMERA = { y: 0.6, z: 7.5, fov: 40 };
const GROUND_Y = -1.0; // 足元の高さ（ジャンプしても上が切れないよう低めに置く）
const WALK_MAX = 0.5; // ロック中に左右へ歩く幅の上限（モデルの大きさ基準）
const WALK_SPEED = 0.35; // 歩く速さ（モデルの大きさ基準・1秒あたり）
const WALK_TURN = 1.1; // 歩く時の向き（真横は π/2。少し正面寄りにして顔が見えるように）
const MOUTH_JUMP = 0.8; // ジャンプ中の口の開き具合
const FADE = 0.25; // 動きを切り替える時のなめらかさ（秒）

// ---- 円からはみ出さずに歩ける幅の計算 ----
// スライムの外形：足元からの高さごとの半径（slime.glb の頂点から計測）
const PROFILE = [
  [0, 0.7], [0.1, 0.74], [0.2, 0.75], [0.3, 0.75], [0.4, 0.74], [0.5, 0.72],
  [0.6, 0.71], [0.7, 0.63], [0.8, 0.52], [0.9, 0.38], [1.0, 0.11],
];
// 動きでいちばん大きく変形する姿勢（Walk / Jump のボーンの動きから計測）
// hop: 跳ねる高さ / widen: 横への広がり / stretch: 縦の伸び
const POSES = [
  { hop: 0.18, widen: 1.08, stretch: 1.12 }, // Walk
  { hop: 0, widen: 1.24, stretch: 0.65 }, // Jump の溜め（いちばん横に広がる）
  { hop: 1.2, widen: 1.0, stretch: 1.1 }, // Jump の頂点
];
const EDGE = 0.92; // 円の半径のここまでに収める（傾きなどのための余裕）
const TAN_HALF_FOV = Math.tan(((CAMERA.fov / 2) * Math.PI) / 180);

// 横位置 x（モデルの大きさ基準）・大きさ scale の時に、どの姿勢でも円の内側に収まるか
function fitsInCircle(x, scale) {
  for (const { hop, widen, stretch } of POSES) {
    for (const [y, r] of PROFILE) {
      for (let i = 0; i < 48; i++) {
        const t = (i / 48) * 2 * Math.PI;
        const px = scale * (x + r * widen * Math.cos(t));
        const pz = scale * r * widen * Math.sin(t);
        const py = GROUND_Y + scale * (hop + y * stretch);
        const depth = CAMERA.z - pz;
        const nx = px / depth / TAN_HALF_FOV;
        const ny = (py - CAMERA.y) / depth / TAN_HALF_FOV;
        if (nx * nx + ny * ny > EDGE * EDGE) return false;
      }
    }
  }
  return true;
}

// 大きさ scale の時に歩ける幅（0 なら歩かずその場で足踏み）
function walkRangeFor(scale) {
  if (!fitsInCircle(0, scale)) return 0;
  let lo = 0;
  let hi = WALK_MAX;
  if (fitsInCircle(hi, scale)) return hi;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (fitsInCircle(mid, scale)) lo = mid;
    else hi = mid;
  }
  return lo;
}

// walking: ロック中か / celebrating: 「おめでとう」表示中か（始まった時に1回ジャンプ）
// tapCount: キャラをタップした回数（増えるたびに1回ジャンプ）
export default function SlimeCanvas({ stage, walking, celebrating, tapCount }) {
  return (
    <Canvas camera={{ position: [0, CAMERA.y, CAMERA.z], fov: CAMERA.fov }}>
      <ambientLight intensity={0.8} />
      <directionalLight position={[2, 4, 5]} intensity={1.4} />
      <Suspense fallback={null}>
        <Growing scale={STAGE_SCALES[stage]}>
          <Slime scale={STAGE_SCALES[stage]} walking={walking} celebrating={celebrating} tapCount={tapCount} />
        </Growing>
      </Suspense>
    </Canvas>
  );
}

// 進化したら新しい大きさまでなめらかに大きくする
function Growing({ scale, children }) {
  const ref = useRef(null);
  useFrame((_, delta) => {
    const g = ref.current;
    const current = g.userData.base ?? scale;
    const base = current + (scale - current) * Math.min(1, delta * 3);
    g.userData.base = base;
    g.scale.setScalar(base);
  });
  return (
    <group ref={ref} position={[0, GROUND_Y, 0]}>
      {children}
    </group>
  );
}

function Slime({ scale, walking, celebrating, tapCount }) {
  const moverRef = useRef(null); // 左右の移動と向き
  const animRef = useRef(null); // アニメーションの対象
  const { scene, animations } = useGLTF(MODEL_URL);
  const { actions } = useAnimations(animations, animRef);

  // MouthOpen はマテリアルごとに分かれた3つのメッシュ全部にかける必要がある
  const mouthMeshes = useMemo(() => {
    const list = [];
    scene.traverse((o) => {
      if (o.morphTargetDictionary?.MouthOpen !== undefined) list.push(o);
      // ジャンプで元の位置から大きく動くので、画面外と誤判定されて消えないように
      if (o.isMesh) o.frustumCulled = false;
    });
    return list;
  }, [scene]);

  const walkRange = useMemo(() => walkRangeFor(scale), [scale]);
  const motion = useRef({ x: 0, dir: 1, jumping: false, mouth: 0, current: null });
  const walkingRef = useRef(walking);

  // 前の動きからなめらかに切り替える
  const play = useCallback(
    (name, once = false) => {
      const next = actions[name];
      if (!next) return;
      const prev = motion.current.current;
      next.reset();
      next.setLoop(once ? LoopOnce : LoopRepeat, once ? 1 : Infinity);
      next.play();
      if (prev && prev !== next) prev.crossFadeTo(next, FADE, false);
      motion.current.current = next;
    },
    [actions],
  );
  const playLoop = useCallback(() => play(walkingRef.current ? 'Walk' : 'Idle'), [play]);
  const jump = useCallback(() => {
    motion.current.jumping = true;
    play('Jump', true);
  }, [play]);

  // 普段は Idle、ロック中は Walk（ジャンプ中はジャンプが終わってから切り替える）
  useEffect(() => {
    walkingRef.current = walking;
    if (!motion.current.jumping) playLoop();
  }, [walking, playLoop]);

  // タップされたら1回ジャンプ（最初の表示時は跳ばない）
  const lastTap = useRef(tapCount);
  useEffect(() => {
    if (tapCount === lastTap.current) return;
    lastTap.current = tapCount;
    jump();
  }, [tapCount, jump]);

  // 「おめでとう」が出た時に1回ジャンプ（閉じた時は跳ばない。開いた時にすでに出ていても跳ぶ）
  const wasCelebrating = useRef(false);
  useEffect(() => {
    if (celebrating && !wasCelebrating.current) jump();
    wasCelebrating.current = celebrating;
  }, [celebrating, jump]);

  useFrame((_, delta) => {
    const m = motion.current;

    // ジャンプが終わる少し前から元の動きへ切り替える（着地の姿勢から自然につながるように）
    const jumpAction = actions.Jump;
    if (m.jumping && jumpAction && jumpAction.time >= jumpAction.getClip().duration - FADE) {
      m.jumping = false;
      playLoop();
    }

    const moving = walkingRef.current && !m.jumping;

    // Walk はその場で跳ねるだけなので、前進はここで動かす（端まで来たら向きを変える）
    if (moving) {
      m.x += m.dir * WALK_SPEED * delta;
      if (Math.abs(m.x) > walkRange) {
        m.x = Math.sign(m.x) * walkRange;
        m.dir = -m.dir;
      }
    } else {
      m.x += (0 - m.x) * Math.min(1, delta * 1.5); // 歩いていない時は真ん中へ戻る
    }
    const mover = moverRef.current;
    mover.position.x = m.x;
    // 歩く時は進む方向（斜め）、それ以外は正面を向く
    const targetRot = moving ? m.dir * WALK_TURN : 0;
    mover.rotation.y += (targetRot - mover.rotation.y) * Math.min(1, delta * 6);

    // ジャンプ中は口を開ける
    const targetMouth = m.jumping ? MOUTH_JUMP : 0;
    m.mouth += (targetMouth - m.mouth) * Math.min(1, delta * 8);
    mouthMeshes.forEach((mesh) => {
      mesh.morphTargetInfluences[mesh.morphTargetDictionary.MouthOpen] = m.mouth;
    });
  });

  return (
    <group ref={moverRef}>
      <primitive ref={animRef} object={scene} />
      {/* 足元の影 */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.002}>
        <circleGeometry args={[0.7, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.12} depthWrite={false} />
      </mesh>
    </group>
  );
}
