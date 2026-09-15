// Where the members of a ridge go when it is drawn fanned out, in screen
// pixels from the anchor that marks where they really are.
//
// Plain .mjs with a .d.mts beside it, like cluster.mjs and projection.mjs:
// the map draws with this and node --test checks it, and Node 20 cannot strip
// types. Do not make a second copy of this maths in TypeScript.

/** Closest a fanned member is ever drawn to the anchor, in screen pixels. */
export const FAN_RADIUS_PX = 28;

// What the ring aims to put between neighbours, halved. Adjacent members on a
// ring of radius r sit 2r*sin(pi/n) apart, so a radius of GAP_PX/sin(pi/n)
// spaces them exactly 2*GAP_PX apart however many there are. 14 makes that
// 28px: past MIN_SEPARATION_PX in cluster.mjs, with room left for the focus
// ring a marker grows when tabbed to.
const GAP_PX = 14;

/**
 * @param {number} n how many peaks the ridge holds
 * @returns {{dx: number, dy: number}[]} one offset per member, in input order
 */
export function fanOffsets(n) {
  // n < 2 is load-bearing rather than defensive: sin(pi/1) is 1.2e-16 rather
  // than 0, so the spacing formula alone would put a lone member 10^17 pixels
  // away. The Math.max floor only binds for small n, where the formula would
  // otherwise draw the ring so tight to the anchor that it reads as a pile.
  const radius = n < 2 ? FAN_RADIUS_PX : Math.max(FAN_RADIUS_PX, GAP_PX / Math.sin(Math.PI / n));

  return Array.from({ length: n }, (_, i) => {
    // First member straight up, the rest clockwise. Straight up is what keeps
    // a two-peak fan -- every ridge the real data produces at full zoom -- on
    // a vertical, where the names that extend rightward cannot collide.
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { dx: radius * Math.cos(angle), dy: radius * Math.sin(angle) };
  });
}
