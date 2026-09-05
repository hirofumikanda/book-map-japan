/** 経緯度とタイル座標(Web メルカトル / XYZ)の相互変換。 */

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * 経緯度を指定ズームのタイル座標へ変換する。
 * 緯度は Web メルカトルの有効範囲(±85.0511)へ、
 * タイル座標は 0〜2^zoom-1 へクランプする。
 */
export function lonLatToTile(lon, lat, zoom) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new Error(`経緯度には有限の数値を指定してください: lon=${lon}, lat=${lat}`);
  }
  if (!Number.isInteger(zoom) || zoom < 0) {
    throw new Error(`ズームレベルには 0 以上の整数を指定してください: ${zoom}`);
  }

  const scale = 2 ** zoom;
  const clampedLat = clamp(lat, -85.05112878, 85.05112878);
  const latRad = (clampedLat * Math.PI) / 180;

  const x = Math.floor(((lon + 180) / 360) * scale);
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale,
  );

  return {
    z: zoom,
    x: clamp(x, 0, scale - 1),
    y: clamp(y, 0, scale - 1),
  };
}
