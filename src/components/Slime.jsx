import { Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useAnimations, useGLTF } from '@react-three/drei';
import { Color, DoubleSide, LoopOnce, LoopRepeat, Vector3 } from 'three';
import { COLORS, MAX_STAGE } from '../habit';
import { subdivideSkinned } from './subdivide';

// Blenderで作ったスライム（public/models/slime.glb）
// 高さ 1.0・原点は足元・正面は +Z。アクション Idle / Walk / Jump と、シェイプキー MouthOpen を持つ
const MODEL_URL = `${import.meta.env.BASE_URL}models/slime.glb`;
useGLTF.preload(MODEL_URL);

const SCALE = 1.3; // スライムの大きさ（成長は色で表すので一定）

// カメラと足元の位置（表示枠は正方形で、その内側の円だけが見える）
const CAMERA = { y: 0.6, z: 7.5, fov: 40 };
const GROUND_Y = -1.0; // 足元の高さ（ジャンプしても上が切れないよう低めに置く）
const WALK_MAX = 0.5; // ロック中に左右へ歩く幅の上限（モデルの大きさ基準）
const WALK_SPEED = 0.35; // 歩く速さ（モデルの大きさ基準・1秒あたり）
const WALK_TURN = 1.1; // 歩く時の向き（真横は π/2。少し正面寄りにして顔が見えるように）
const MOUTH_JUMP = 0.8; // ジャンプ中の口の開き具合
const MOUTH_EAT = 1.0; // 食べる時の口の開き具合
const FADE = 0.25; // 動きを切り替える時のなめらかさ（秒）
const SMOOTH = 2; // 体の表面を滑らかにする細かさ（1回ごとに面が4倍。0 なら Blender で作ったまま）
// 銀色の時の質感。周りの映り込みが無いので金属っぽさは控えめにし、少し自分で光らせて明るい銀色にする
const SILVER = { metalness: 0.15, roughness: 0.12, emissive: new Color('#8d9bb0'), emissiveIntensity: 0.55 };
const MOUTH_POS = [0, 0.376, 0.741]; // 口の位置（モデル基準。slime.glb の SlimeMouth から計測）

// 食べ物（お休みチケット）の飛び方
const SNACK_TIME = 0.8; // 口に着くまでの秒数
const SNACK_START = new Vector3(1.6, -1.2, 1.4); // 飛び始める位置（🎫 の表示がある右下。枠のすぐ外から入ってくる）
const SNACK_ARC = 2.0; // 弧の高さ（頭の高さまで上がってから口へ落ちる）
const SNACK_SIZE = 1.4; // チケットの大きさ（何が飛んでいるか分かるように少し大きめ）
const GULP_TIME = 0.35; // 食べた時に「もぐっ」と弾む時間
const MAX_FRAME_DELTA = 0.05; // 1コマで進める最大の秒数

// 王冠（隠し要素。銀色を続けるとかぶる）
const CROWN_SINK = 0.16; // 頭のてっぺんからどれだけ沈めてかぶせるか（モデルの大きさ基準）
const CROWN_GROW = 4; // かぶる時に大きくなる速さ

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

const WALK_RANGE = walkRangeFor(SCALE);

// colorStage: 色の段階（habit.js の COLORS の番号。上がった時に1回ジャンプ） / walking: ロック中か
// celebrating: 「おめでとう」表示中か（始まった時に1回ジャンプ） / tapCount: タップ回数（増えるたびにジャンプ）
// snacks: 口へ飛ばすもの [{ id, delay(秒) }]（今はお休みチケット） / onSnackEaten(id): 口に入った時
// crown: 王冠をかぶるか
export default function SlimeCanvas({ colorStage, crown, walking, celebrating, tapCount, snacks = [], onSnackEaten }) {
  // 口の今の位置（スライムが毎フレーム更新し、飛んでくるものがそこを目指す）
  const mouthRef = useRef(new Vector3(0, GROUND_Y + MOUTH_POS[1] * SCALE, MOUTH_POS[2] * SCALE));
  // 最後に食べた時刻（「もぐっ」と弾む演出用）
  const gulpRef = useRef(-Infinity);

  return (
    <Canvas camera={{ position: [0, CAMERA.y, CAMERA.z], fov: CAMERA.fov }}>
      <ambientLight intensity={0.8} />
      <directionalLight position={[2, 4, 5]} intensity={1.4} />
      <Suspense fallback={null}>
        <group position={[0, GROUND_Y, 0]} scale={SCALE}>
          <Slime
            colorStage={colorStage}
            crown={crown}
            walking={walking}
            eating={snacks.length > 0}
            celebrating={celebrating}
            tapCount={tapCount}
            mouthRef={mouthRef}
            gulpRef={gulpRef}
          />
        </group>
        {snacks.map(({ id, delay }) => (
          <TicketSnack
            key={id}
            delay={delay}
            mouthRef={mouthRef}
            onArrive={() => {
              gulpRef.current = performance.now();
              onSnackEaten(id);
            }}
          />
        ))}
      </Suspense>
    </Canvas>
  );
}

function Slime({ colorStage, crown, walking, eating, celebrating, tapCount, mouthRef, gulpRef }) {
  const moverRef = useRef(null); // 左右の移動と向き
  const crownRef = useRef(null); // 王冠（頭のてっぺんについていく）
  const gulpGroupRef = useRef(null); // 食べた時に弾ませる
  const animRef = useRef(null); // アニメーションの対象
  const { scene, animations } = useGLTF(MODEL_URL);
  const { actions } = useAnimations(animations, animRef);

  // MouthOpen はマテリアルごとに分かれた3つのメッシュ全部にかける必要がある
  // 口の位置は、口の中のメッシュ（SlimeMouth）の頂点の平均で求める
  // 頭のてっぺんは、体のメッシュ（SlimeBody）でいちばん高い頂点（王冠をそこへ乗せる）
  const { mouthMeshes, mouthInside, head } = useMemo(() => {
    const list = [];
    let inside = null;
    let top = null;
    scene.traverse((o) => {
      if (o.morphTargetDictionary?.MouthOpen !== undefined) list.push(o);
      if (o.isMesh && o.material?.name === 'SlimeMouth') inside = o;
      if (o.isMesh && o.material?.name === 'SlimeBody') {
        // 読み込んだモデルは使い回されるので、滑らかにするのは1回だけ
        if (!o.userData.smoothed) {
          o.geometry = subdivideSkinned(o.geometry, SMOOTH);
          o.userData.smoothed = true;
        }
        const pos = o.geometry.attributes.position;
        let index = 0;
        for (let i = 1; i < pos.count; i++) if (pos.getY(i) > pos.getY(index)) index = i;
        top = { mesh: o, index };
      }
      // ジャンプで元の位置から大きく動くので、画面外と誤判定されて消えないように
      if (o.isMesh) o.frustumCulled = false;
    });
    return { mouthMeshes: list, mouthInside: inside, head: top };
  }, [scene]);
  // 体の色は SlimeBody のマテリアルを段階の色に変える（毎フレーム書き換えるので ref に持つ）
  const bodyRef = useRef(null);
  const targetColor = useMemo(() => new Color(COLORS[colorStage].hex), [colorStage]);
  const isSilver = colorStage === MAX_STAGE;

  const motion = useRef({ x: 0, dir: 1, jumping: false, mouth: 0, current: null });
  const walkingRef = useRef(walking);
  const eatingRef = useRef(eating);
  const tmp = useMemo(() => ({ v: new Vector3(), sum: new Vector3() }), []);

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
  // 食べている間は歩かずに Idle（正面を向いて口で受け止める）
  const playLoop = useCallback(
    () => play(walkingRef.current && !eatingRef.current ? 'Walk' : 'Idle'),
    [play],
  );
  const jump = useCallback(() => {
    motion.current.jumping = true;
    play('Jump', true);
  }, [play]);

  // 普段は Idle、ロック中は Walk（ジャンプ中はジャンプが終わってから切り替える）
  useEffect(() => {
    walkingRef.current = walking;
    eatingRef.current = eating;
    if (!motion.current.jumping) playLoop();
  }, [walking, eating, playLoop]);

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

  // 色が上がったら1回ジャンプ（最初の表示時は跳ばない）
  const lastStage = useRef(colorStage);
  useEffect(() => {
    if (colorStage > lastStage.current) jump();
    lastStage.current = colorStage;
  }, [colorStage, jump]);

  useFrame((_, delta) => {
    const m = motion.current;

    // ジャンプが終わる少し前から元の動きへ切り替える（着地の姿勢から自然につながるように）
    const jumpAction = actions.Jump;
    if (m.jumping && jumpAction && jumpAction.time >= jumpAction.getClip().duration - FADE) {
      m.jumping = false;
      playLoop();
    }

    const moving = walkingRef.current && !eatingRef.current && !m.jumping;

    // Walk はその場で跳ねるだけなので、前進はここで動かす（端まで来たら向きを変える）
    if (moving) {
      m.x += m.dir * WALK_SPEED * delta;
      if (Math.abs(m.x) > WALK_RANGE) {
        m.x = Math.sign(m.x) * WALK_RANGE;
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

    // 食べる時は大きく、ジャンプ中は少し口を開ける
    const targetMouth = eatingRef.current ? MOUTH_EAT : m.jumping ? MOUTH_JUMP : 0;
    m.mouth += (targetMouth - m.mouth) * Math.min(1, delta * 12);
    mouthMeshes.forEach((mesh) => {
      mesh.morphTargetInfluences[mesh.morphTargetDictionary.MouthOpen] = m.mouth;
    });

    // 体の色を段階の色へなめらかに変える（銀色の時は金属っぽく光らせる）
    // 銀色以外の時は、モデルの元の質感（最初に覚えておく）に戻す
    if (!bodyRef.current) {
      scene.traverse((o) => {
        if (o.isMesh && o.material?.name === 'SlimeBody') {
          const m = o.material;
          bodyRef.current = {
            material: m,
            metalness: m.metalness,
            roughness: m.roughness,
            emissive: m.emissive.clone(),
            emissiveIntensity: m.emissiveIntensity,
          };
        }
      });
    }
    if (bodyRef.current) {
      const base = bodyRef.current;
      const { material } = base;
      const to = isSilver ? SILVER : base;
      const k = Math.min(1, delta * 3);
      material.color.lerp(targetColor, k);
      material.metalness += (to.metalness - material.metalness) * k;
      material.roughness += (to.roughness - material.roughness) * k;
      material.emissive.lerp(to.emissive, k);
      material.emissiveIntensity += (to.emissiveIntensity - material.emissiveIntensity) * k;
    }

    // 食べた直後は「もぐっ」と縦につぶれて戻る
    const since = (performance.now() - gulpRef.current) / 1000;
    const squash = since < GULP_TIME ? Math.sin((since / GULP_TIME) * Math.PI) * 0.12 : 0;
    gulpGroupRef.current.scale.set(1 + squash * 0.7, 1 - squash, 1 + squash * 0.7);

    // 口の今の位置（歩き・ジャンプ・弾みで動いた後）を、飛んでくるものに教える
    if (mouthInside) {
      const pos = mouthInside.geometry.attributes.position;
      tmp.sum.set(0, 0, 0);
      for (let i = 0; i < pos.count; i++) {
        mouthInside.getVertexPosition(i, tmp.v);
        tmp.sum.add(mouthInside.localToWorld(tmp.v));
      }
      mouthRef.current.copy(tmp.sum.divideScalar(pos.count));
    }

    // 王冠：頭のてっぺん（動きで伸び縮みした後）に乗せる。かぶる・外れる時はふわっと大きさを変える
    const crownGroup = crownRef.current;
    const crownScale = crownGroup.scale.x + ((crown ? 1 : 0) - crownGroup.scale.x) * Math.min(1, delta * CROWN_GROW);
    crownGroup.scale.setScalar(crownScale < 0.01 ? 0 : crownScale);
    crownGroup.visible = crownScale >= 0.01;
    if (crownGroup.visible && head) {
      head.mesh.getVertexPosition(head.index, tmp.v);
      mover.worldToLocal(head.mesh.localToWorld(tmp.v));
      crownGroup.position.set(tmp.v.x, tmp.v.y - CROWN_SINK, tmp.v.z);
    }
  });

  return (
    <group ref={moverRef}>
      <group ref={gulpGroupRef}>
        <primitive ref={animRef} object={scene} />
      </group>
      <group ref={crownRef} scale={0} visible={false}>
        <Crown />
      </group>
      {/* 足元の影 */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.002}>
        <circleGeometry args={[0.7, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.12} depthWrite={false} />
      </mesh>
    </group>
  );
}

// 右下から弧を描いて口へ飛び込むお休みチケット（最後は吸い込まれるように小さくなる）
// delay 秒たってから飛び始める（何枚か続けて食べる時に間をあける）
function TicketSnack({ delay, mouthRef, onArrive }) {
  const ref = useRef(null);
  const state = useRef({ t: -delay, arrived: false });
  const tmp = useMemo(() => ({ ctrl: new Vector3() }), []);

  useFrame((_, frameDelta) => {
    const s = state.current;
    if (s.arrived) return;
    // 画面が裏に回って描画が止まっていた時間を一度に進めない（戻ってから最初から飛ぶように）
    s.t += Math.min(frameDelta, MAX_FRAME_DELTA);
    const ticket = ref.current;
    ticket.visible = s.t >= 0;
    if (s.t < 0) return;
    const k = Math.min(1, s.t / SNACK_TIME);
    const end = mouthRef.current;

    // 2次ベジェ曲線（始点 → 上に持ち上げた中間点 → 口）。口が動いても最後は口に着く
    const ctrl = tmp.ctrl.set(
      (SNACK_START.x + end.x) / 2,
      Math.max(SNACK_START.y, end.y) + SNACK_ARC,
      (SNACK_START.z + end.z) / 2,
    );
    const a = (1 - k) * (1 - k);
    const b = 2 * (1 - k) * k;
    const c = k * k;
    ticket.position.set(
      a * SNACK_START.x + b * ctrl.x + c * end.x,
      a * SNACK_START.y + b * ctrl.y + c * end.y,
      a * SNACK_START.z + b * ctrl.z + c * end.z,
    );
    // ひらひらと揺れながら飛ぶ
    ticket.rotation.z = Math.sin(s.t * 12) * 0.35;
    ticket.rotation.y = Math.sin(s.t * 7) * 0.5;
    ticket.scale.setScalar(SNACK_SIZE * (k < 0.7 ? 1 : 1 - ((k - 0.7) / 0.3) * 0.85));

    if (k >= 1) {
      s.arrived = true;
      ticket.visible = false;
      onArrive();
    }
  });

  // 🎫 のような横長のチケット（台紙・中央の帯・ミシン目の丸）
  return (
    <group ref={ref} position={SNACK_START.toArray()} visible={false}>
      <mesh>
        <boxGeometry args={[0.5, 0.3, 0.03]} />
        <meshStandardMaterial color="#f5a623" roughness={0.5} emissive="#7a3d00" emissiveIntensity={0.25} />
      </mesh>
      <mesh position={[0.05, 0, 0.02]}>
        <boxGeometry args={[0.26, 0.2, 0.01]} />
        <meshStandardMaterial color="#ffe08a" roughness={0.5} />
      </mesh>
      {[-0.08, 0, 0.08].map((y) => (
        <mesh key={y} position={[-0.15, y, 0.02]}>
          <circleGeometry args={[0.018, 12]} />
          <meshBasicMaterial color="#b86a00" />
        </mesh>
      ))}
    </group>
  );
}

// 王冠（輪・5本のとがり・先の玉・正面の宝石）。底の中心が原点
const CROWN_POINTS = 5;
function Crown() {
  const gold = { color: '#ffd24a', metalness: 0.35, roughness: 0.25, emissive: '#a86b00', emissiveIntensity: 0.35 };
  return (
    <group rotation-x={-0.12} scale={1.25}>
      {/* 輪（上に向かって少し広がる） */}
      <mesh position-y={0.06}>
        <cylinderGeometry args={[0.3, 0.27, 0.12, 32, 1, true]} />
        <meshStandardMaterial {...gold} side={DoubleSide} />
      </mesh>
      {Array.from({ length: CROWN_POINTS }, (_, i) => {
        const a = (i / CROWN_POINTS) * Math.PI * 2;
        const x = Math.sin(a) * 0.29;
        const z = Math.cos(a) * 0.29;
        return (
          <group key={i} position={[x, 0.12, z]}>
            <mesh position-y={0.08}>
              <coneGeometry args={[0.07, 0.16, 12]} />
              <meshStandardMaterial {...gold} />
            </mesh>
            <mesh position-y={0.17}>
              <sphereGeometry args={[0.03, 12, 12]} />
              <meshStandardMaterial {...gold} />
            </mesh>
          </group>
        );
      })}
      {/* 正面の宝石 */}
      <mesh position={[0, 0.06, 0.29]}>
        <sphereGeometry args={[0.04, 16, 16]} />
        <meshStandardMaterial color="#e8344e" roughness={0.15} emissive="#7a0a1c" emissiveIntensity={0.4} />
      </mesh>
    </group>
  );
}
