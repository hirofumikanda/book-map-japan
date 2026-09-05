import assert from "node:assert/strict";
import test from "node:test";

import { lonLatToTile } from "./tile-math.js";

test("lonLatToTile: z0 では常に 0/0", () => {
  assert.deepEqual(lonLatToTile(139.7005, 35.6909, 0), { z: 0, x: 0, y: 0 });
  assert.deepEqual(lonLatToTile(-179.9, -85, 0), { z: 0, x: 0, y: 0 });
});

test("lonLatToTile: z1 で 4 象限に分かれる", () => {
  assert.deepEqual(lonLatToTile(-90, 45, 1), { z: 1, x: 0, y: 0 });
  assert.deepEqual(lonLatToTile(90, 45, 1), { z: 1, x: 1, y: 0 });
  assert.deepEqual(lonLatToTile(-90, -45, 1), { z: 1, x: 0, y: 1 });
  assert.deepEqual(lonLatToTile(90, -45, 1), { z: 1, x: 1, y: 1 });
});

// 実際に tippecanoe が生成したタイル座標と一致することを確認済みの既知値
test("lonLatToTile: 紀伊國屋書店 新宿本店 (139.7005, 35.6909) は z14 で 14549/6451", () => {
  assert.deepEqual(lonLatToTile(139.7005, 35.6909, 14), { z: 14, x: 14549, y: 6451 });
});

test("lonLatToTile: ジュンク堂書店 大阪本店 (135.4959, 34.7024) は z14 で 14358/6506", () => {
  assert.deepEqual(lonLatToTile(135.4959, 34.7024, 14), { z: 14, x: 14358, y: 6506 });
});

test("lonLatToTile: 同一地点の z10 タイルは z14 タイルを 16 で割った位置になる", () => {
  const z14 = lonLatToTile(139.7005, 35.6909, 14);
  const z10 = lonLatToTile(139.7005, 35.6909, 10);

  assert.deepEqual(z10, { z: 10, x: Math.floor(z14.x / 16), y: Math.floor(z14.y / 16) });
});

test("lonLatToTile: 経度0・緯度0 は z1 で x=1, y=1(タイル境界は右下側に属する)", () => {
  assert.deepEqual(lonLatToTile(0, 0, 1), { z: 1, x: 1, y: 1 });
});

test("lonLatToTile: 緯度は Web メルカトルの有効範囲へクランプされる", () => {
  const north = lonLatToTile(139.7, 89, 5);
  const south = lonLatToTile(139.7, -89, 5);

  assert.equal(north.y, 0);
  assert.equal(south.y, 2 ** 5 - 1);
});

test("lonLatToTile: 経度の東端はタイル範囲内へクランプされる", () => {
  assert.deepEqual(lonLatToTile(180, 0, 2), { z: 2, x: 3, y: 2 });
});

test("lonLatToTile: 不正な入力は例外になる", () => {
  assert.throws(() => lonLatToTile(Number.NaN, 35, 14), /経緯度/);
  assert.throws(() => lonLatToTile(139, undefined, 14), /経緯度/);
  assert.throws(() => lonLatToTile(139, 35, -1), /ズームレベル/);
  assert.throws(() => lonLatToTile(139, 35, 1.5), /ズームレベル/);
});
