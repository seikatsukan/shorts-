import { Suspense, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';

// Blenderで作ったスライムを public/models/slime.glb に置いたら、ここを '/models/slime.glb' にする
// （glTF Binary(.glb) で書き出し。原点を足元・高さ約2の大きさにしておくと調整なしで収まる）
const MODEL_URL = null;

// 進化段階ごとの大きさ（段階 0〜4）
export const STAGE_SCALES = [0.55, 0.7, 0.85, 1.0, 1.15];

export default function SlimeCanvas({ stage }) {
  return (
    <Canvas camera={{ position: [0, 1.2, 6], fov: 40 }}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[2, 4, 5]} intensity={1.2} />
      <Suspense fallback={null}>
        <Growing scale={STAGE_SCALES[stage]}>{MODEL_URL ? <SlimeModel /> : <PlaceholderSlime />}</Growing>
      </Suspense>
    </Canvas>
  );
}

// 進化したら新しい大きさまでなめらかに大きくする＋ぷるぷる動かす
function Growing({ scale, children }) {
  const ref = useRef(null);
  useFrame(({ clock }, delta) => {
    const g = ref.current;
    const current = g.userData.base ?? scale;
    const base = current + (scale - current) * Math.min(1, delta * 3);
    g.userData.base = base;
    const wobble = Math.sin(clock.elapsedTime * 3) * 0.04;
    g.scale.set(base * (1 + wobble), base * (1 - wobble), base * (1 + wobble));
  });
  return (
    <group ref={ref} position={[0, -1, 0]}>
      {children}
    </group>
  );
}

function SlimeModel() {
  const { scene } = useGLTF(MODEL_URL);
  return <primitive object={scene} />;
}

// 仮のスライム（モデルができるまで）
function PlaceholderSlime() {
  return (
    <group>
      <mesh position={[0, 0.9, 0]} scale={[1.2, 0.9, 1.2]}>
        <sphereGeometry args={[1, 48, 32]} />
        <meshStandardMaterial color="#6cc7e8" roughness={0.25} />
      </mesh>
      {[-0.35, 0.35].map((x) => (
        <mesh key={x} position={[x, 1.05, 1.03]}>
          <sphereGeometry args={[0.1, 16, 16]} />
          <meshStandardMaterial color="#1d2b33" />
        </mesh>
      ))}
    </group>
  );
}
