/*
 * stl.js — binary STL export for a flat triangle array.
 * Browser: window.STLExport.trianglesToSTL(triangles, name) -> Blob
 * Node:    module.exports.trianglesToBytes(triangles) -> Uint8Array
 */
(function (global) {
  'use strict';

  function trianglesToBytes(triangles) {
    var count = triangles.length / 9;
    var buffer = new ArrayBuffer(84 + count * 50);
    var view = new DataView(buffer);
    // 80-byte header left as zeros; triangle count at byte 84 - 4.
    view.setUint32(80, count, true);
    var offset = 84;
    for (var i = 0; i < triangles.length; i += 9) {
      var ax = triangles[i], ay = triangles[i + 1], az = triangles[i + 2];
      var bx = triangles[i + 3], by = triangles[i + 4], bz = triangles[i + 5];
      var cx = triangles[i + 6], cy = triangles[i + 7], cz = triangles[i + 8];
      var ux = bx - ax, uy = by - ay, uz = bz - az;
      var vx = cx - ax, vy = cy - ay, vz = cz - az;
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      var len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len > 0) { nx /= len; ny /= len; nz /= len; }
      view.setFloat32(offset, nx, true);
      view.setFloat32(offset + 4, ny, true);
      view.setFloat32(offset + 8, nz, true);
      var verts = [ax, ay, az, bx, by, bz, cx, cy, cz];
      for (var k = 0; k < 9; k++) {
        view.setFloat32(offset + 12 + k * 4, verts[k], true);
      }
      view.setUint16(offset + 48, 0, true);
      offset += 50;
    }
    return new Uint8Array(buffer);
  }

  function trianglesToSTL(triangles) {
    var bytes = trianglesToBytes(triangles);
    return new Blob([bytes], { type: 'model/stl' });
  }

  var api = { trianglesToBytes: trianglesToBytes, trianglesToSTL: trianglesToSTL };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.STLExport = api;
  }
})(typeof window !== 'undefined' ? window : this);
