import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute } from 'three';

// 骨で動くメッシュ（SkinnedMesh）の面を細かく分けて、表面を滑らかにする（Loop 細分割。Blender のサブディビジョンと同じ考え方）
// - 骨の重み・シェイプキー（MouthOpen など）も、位置と同じ割合で新しい頂点に引き継ぐ
// - 法線が分かれている所（底の平らな面のふち）と穴のふち（口）は角として残す（底が丸まって浮かないように）
// iterations 回分けるごとに三角形は4倍になる
export function subdivideSkinned(geometry, iterations) {
  let mesh = weld(geometry);
  for (let i = 0; i < iterations; i++) mesh = loopStep(mesh);
  return build(mesh, geometry);
}

// 同じ位置にある頂点を1つにまとめる。法線を分けるために分かれていた面同士は、別のグループ（角）として覚えておく
function weld(geometry) {
  const pos = geometry.attributes.position;
  const skinIndex = geometry.attributes.skinIndex;
  const skinWeight = geometry.attributes.skinWeight;
  const targets = geometry.morphAttributes.position ?? [];
  const index = geometry.index;
  let joints = 0;
  for (let i = 0; i < skinIndex.count; i++) {
    for (let k = 0; k < 4; k++) joints = Math.max(joints, skinIndex.getComponent(i, k) + 1);
  }

  // 1頂点のデータ：位置(3) + シェイプキーごとの移動量(3ずつ) + 骨ごとの重み
  const C = 3 + targets.length * 3 + joints;
  const welded = new Map();
  const toWelded = new Int32Array(pos.count);
  const rows = [];
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i)},${pos.getY(i)},${pos.getZ(i)}`;
    if (!welded.has(key)) {
      const row = new Float64Array(C);
      row.set([pos.getX(i), pos.getY(i), pos.getZ(i)]);
      targets.forEach((t, n) => row.set([t.getX(i), t.getY(i), t.getZ(i)], 3 + n * 3));
      for (let k = 0; k < 4; k++) row[3 + targets.length * 3 + skinIndex.getComponent(i, k)] += skinWeight.getComponent(i, k);
      welded.set(key, rows.length);
      rows.push(row);
    }
    toWelded[i] = welded.get(key);
  }
  const data = new Float64Array(rows.length * C);
  rows.forEach((row, i) => data.set(row, i * C));

  // 元の頂点番号で辺を共有している面同士を同じグループにする（法線が分かれた辺はグループの境目＝角になる）
  const raw = index ? Array.from(index.array) : Array.from({ length: pos.count }, (_, i) => i);
  const F = raw.length / 3;
  const parent = Array.from({ length: F }, (_, f) => f);
  const find = (f) => (parent[f] === f ? f : (parent[f] = find(parent[f])));
  const byEdge = new Map();
  for (let f = 0; f < F; f++) {
    for (let k = 0; k < 3; k++) {
      const a = raw[f * 3 + k];
      const b = raw[f * 3 + ((k + 1) % 3)];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (byEdge.has(key)) parent[find(f)] = find(byEdge.get(key));
      else byEdge.set(key, f);
    }
  }
  return {
    data,
    C,
    faces: Int32Array.from(raw, (i) => toWelded[i]),
    groups: Int32Array.from({ length: F }, (_, f) => find(f)),
    targets: targets.length,
    joints,
  };
}

// 1回分の細分割（三角形1枚を4枚に分け、頂点の位置を周りとなじませる）
function loopStep({ data, C, faces, groups, ...rest }) {
  const V = data.length / C;
  const F = faces.length / 3;

  // 辺の一覧（両側の面と、それぞれの向かいの頂点）
  const edgeIndex = new Map();
  const edges = [];
  const faceEdges = new Int32Array(F * 3);
  for (let f = 0; f < F; f++) {
    for (let k = 0; k < 3; k++) {
      const a = faces[f * 3 + k];
      const b = faces[f * 3 + ((k + 1) % 3)];
      const key = a < b ? a * V + b : b * V + a;
      let e = edgeIndex.get(key);
      if (e === undefined) {
        e = edges.length;
        edgeIndex.set(key, e);
        edges.push({ a, b, faces: [], opposite: [] });
      }
      edges[e].faces.push(f);
      edges[e].opposite.push(faces[f * 3 + ((k + 2) % 3)]);
      faceEdges[f * 3 + k] = e;
    }
  }
  // 角の辺：穴のふち、またはグループの境目
  const isCrease = (e) => e.faces.length !== 2 || groups[e.faces[0]] !== groups[e.faces[1]];

  const neighbors = Array.from({ length: V }, () => []);
  const creaseNeighbors = Array.from({ length: V }, () => []);
  for (const e of edges) {
    neighbors[e.a].push(e.b);
    neighbors[e.b].push(e.a);
    if (isCrease(e)) {
      creaseNeighbors[e.a].push(e.b);
      creaseNeighbors[e.b].push(e.a);
    }
  }

  const out = new Float64Array((V + edges.length) * C);
  const add = (to, from, w) => {
    for (let c = 0; c < C; c++) out[to * C + c] += data[from * C + c] * w;
  };

  // 元の頂点：周りの頂点となじませる（角の上では角に沿ってだけ、角が交わる点は動かさない）
  for (let v = 0; v < V; v++) {
    const crease = creaseNeighbors[v];
    if (crease.length === 0) {
      const n = neighbors[v].length;
      const beta = n > 3 ? 3 / (8 * n) : 3 / 16;
      add(v, v, 1 - n * beta);
      neighbors[v].forEach((u) => add(v, u, beta));
    } else if (crease.length === 2) {
      add(v, v, 3 / 4);
      add(v, crease[0], 1 / 8);
      add(v, crease[1], 1 / 8);
    } else {
      add(v, v, 1);
    }
  }
  // 辺の真ん中に新しい頂点を置く
  edges.forEach((e, i) => {
    const v = V + i;
    if (isCrease(e)) {
      add(v, e.a, 1 / 2);
      add(v, e.b, 1 / 2);
    } else {
      add(v, e.a, 3 / 8);
      add(v, e.b, 3 / 8);
      add(v, e.opposite[0], 1 / 8);
      add(v, e.opposite[1], 1 / 8);
    }
  });

  // 三角形1枚を4枚に（向きはそのまま）
  const nextFaces = new Int32Array(F * 12);
  const nextGroups = new Int32Array(F * 4);
  for (let f = 0; f < F; f++) {
    const [v0, v1, v2] = faces.subarray(f * 3, f * 3 + 3);
    const [e01, e12, e20] = Array.from(faceEdges.subarray(f * 3, f * 3 + 3), (e) => V + e);
    nextFaces.set([v0, e01, e20, v1, e12, e01, v2, e20, e12, e01, e12, e20], f * 12);
    nextGroups.fill(groups[f], f * 4, f * 4 + 4);
  }
  return { data: out, C, faces: nextFaces, groups: nextGroups, ...rest };
}

// three.js のジオメトリに戻す。角の上の頂点はグループごとに分けて、法線がなめらかにつながらないようにする
function build({ data, C, faces, groups, targets, joints }, original) {
  const vertexGroups = new Map();
  faces.forEach((v, i) => {
    const g = groups[Math.floor(i / 3)];
    if (!vertexGroups.has(v)) vertexGroups.set(v, new Set());
    vertexGroups.get(v).add(g);
  });

  const outIndex = new Map();
  const position = [];
  const morph = Array.from({ length: targets }, () => []);
  const skinIndex = [];
  const skinWeight = [];
  const index = faces.map((v, i) => {
    const g = groups[Math.floor(i / 3)];
    const key = vertexGroups.get(v).size > 1 ? `${v}:${g}` : `${v}`;
    if (!outIndex.has(key)) {
      outIndex.set(key, position.length / 3);
      const row = data.subarray(v * C, v * C + C);
      position.push(row[0], row[1], row[2]);
      morph.forEach((m, n) => m.push(row[3 + n * 3], row[4 + n * 3], row[5 + n * 3]));
      // 重みの大きい骨を4本まで
      const weights = Array.from({ length: joints }, (_, j) => [j, row[3 + targets * 3 + j]])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4);
      while (weights.length < 4) weights.push([0, 0]);
      const sum = weights.reduce((s, [, w]) => s + w, 0) || 1;
      weights.forEach(([j, w]) => {
        skinIndex.push(j);
        skinWeight.push(w / sum);
      });
    }
    return outIndex.get(key);
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(skinWeight, 4));
  if (targets > 0) {
    geometry.morphAttributes.position = morph.map((m) => new Float32BufferAttribute(m, 3));
    geometry.morphTargetsRelative = original.morphTargetsRelative;
  }
  geometry.setIndex(Array.from(index));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
