// Spherical Mercator over a fixed extent, shared by three callers: the browser
// (which projects peaks out of the database), scripts/build-map.mjs (which
// projects the coastline), and node --test.
//
// Plain .mjs rather than .ts because Node 20 cannot strip types and tsconfig
// sets allowJs:false; the .d.ts beside this file gives the app full types. Do
// not make a second copy of this maths in TypeScript -- the whole point of the
// design is that the outline and the triangles come from one function.

// Chosen to clear every stored peak with margin: they span latitude 30.33 to
// 45.18 and longitude 130.51 to 145.12.
export const LON_MIN = 128.5;
export const LON_MAX = 146.5;
export const LAT_MIN = 30.0;
export const LAT_MAX = 45.8;

// The map is 1000 units wide by definition; the height is derived below so
// that changing the extent cannot silently stretch the country.
export const WIDTH = 1000;

const RAD = Math.PI / 180;

const mercatorY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));

const X0 = LON_MIN * RAD;
const Y0 = mercatorY(LAT_MAX);
const SCALE = WIDTH / (LON_MAX * RAD - X0);

export const HEIGHT = (Y0 - mercatorY(LAT_MIN)) * SCALE;

/** Summit position to map units. y grows downward, as SVG expects. */
export function project(lat, lon) {
  return { x: (lon * RAD - X0) * SCALE, y: (Y0 - mercatorY(lat)) * SCALE };
}
