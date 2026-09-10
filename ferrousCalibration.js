/** Chart-derived prototype, not a validated chemical assay.
 * Inputs: sRGB [r,g,b], each 0..255. Lab convention: D65 / 2°.
 * No dependencies. Copy this file into your React project's src folder.
 */
function triplet(v, name, rgb = false) {
  if (!Array.isArray(v) || v.length !== 3 || v.some(x => !Number.isFinite(x) || (rgb && (x < 0 || x > 255))))
    throw new TypeError(`${name} must contain three finite ${rgb ? '0..255 RGB' : 'Lab'} numbers`);
  return v;
}
export function rgbToLab(rgb) {
  const [r,g,b] = triplet(rgb, 'rgb', true).map(v => {
    v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const f = t => t > (6/29)**3 ? Math.cbrt(t) : t / (3*(6/29)**2) + 4/29;
  const x = f((0.4124564*r + 0.3575761*g + 0.1804375*b)/0.95047);
  const y = f(0.2126729*r + 0.7151522*g + 0.0721750*b);
  const z = f((0.0193339*r + 0.1191920*g + 0.9503041*b)/1.08883);
  return [116*y-16, 500*(x-y), 200*(y-z)];
}

/** CIEDE2000, kL=kC=kH=1; Sharma, Wu & Dalal (2005).
 * https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/
 */
export function deltaE2000(lab1, lab2) {
  const [L1,a1,b1] = triplet(lab1,'lab1');
  const [L2,a2,b2] = triplet(lab2,'lab2');
  const rad = Math.PI/180, cos = d => Math.cos(d*rad), sin = d => Math.sin(d*rad);
  const C1 = Math.hypot(a1,b1), C2 = Math.hypot(a2,b2), C = (C1+C2)/2;
  const G = 0.5*(1-Math.sqrt(C**7/(C**7+25**7)));
  const ap1 = (1+G)*a1, ap2 = (1+G)*a2;
  const cp1 = Math.hypot(ap1,b1), cp2 = Math.hypot(ap2,b2);
  const hue = (a,b) => (Math.atan2(b,a)/rad+360)%360;
  const h1 = cp1 === 0 ? 0 : hue(ap1,b1), h2 = cp2 === 0 ? 0 : hue(ap2,b2);
  const dL = L2-L1, dC = cp2-cp1;
  let dh = h2-h1;
  if (cp1*cp2 === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2*Math.sqrt(cp1*cp2)*sin(dh/2);
  const lm = (L1+L2)/2, cm = (cp1+cp2)/2;
  let hm;
  if (cp1*cp2 === 0) hm = h1+h2;
  else if (Math.abs(h1-h2) <= 180) hm = (h1+h2)/2;
  else hm = (h1+h2+(h1+h2 < 360 ? 360 : -360))/2;
  const T = 1-0.17*cos(hm-30)+0.24*cos(2*hm)+0.32*cos(3*hm+6)-0.20*cos(4*hm-63);
  const sl = 1+0.015*(lm-50)**2/Math.sqrt(20+(lm-50)**2);
  const sc = 1+0.045*cm, sh = 1+0.015*cm*T;
  const rt = -2*Math.sqrt(cm**7/(cm**7+25**7))*sin(60*Math.exp(-(((hm-275)/25)**2)));
  const l = dL/sl, c = dC/sc, h = dH/sh;
  return Math.sqrt(Math.max(0,l*l+c*c+h*h+rt*c*h));
}

// Digital gray from the instruction, NOT a measured printed-card standard.
export const DIGITAL_GRAY_RGB = Object.freeze([154,154,154]);

/** Experimental signed Lab offset. Apply ONCE, before matching.
 * No scalar delta-E subtraction, no clipping of corrected Lab.
 */
export function correctLabWithGray(stripLab, measuredGrayRgb, targetGrayRgb = DIGITAL_GRAY_RGB) {
  triplet(stripLab,'stripLab');
  const observed = rgbToLab(measuredGrayRgb), target = rgbToLab(targetGrayRgb);
  return stripLab.map((v,i) => v + target[i] - observed[i]);
}

const REFERENCE_RGB = [
  {
    "ppm": 0,
    "rgb": [
      241,
      239,
      239
    ],
    "hex": "#F1EFEF"
  },
  {
    "ppm": 25,
    "rgb": [
      245,
      234,
      231
    ],
    "hex": "#F5EAE7"
  },
  {
    "ppm": 50,
    "rgb": [
      247,
      230,
      223
    ],
    "hex": "#F7E6DF"
  },
  {
    "ppm": 75,
    "rgb": [
      250,
      225,
      218
    ],
    "hex": "#FAE1DA"
  },
  {
    "ppm": 100,
    "rgb": [
      250,
      223,
      216
    ],
    "hex": "#FADFD8"
  },
  {
    "ppm": 125,
    "rgb": [
      250,
      222,
      212
    ],
    "hex": "#FADED4"
  },
  {
    "ppm": 150,
    "rgb": [
      250,
      220,
      206
    ],
    "hex": "#FADCCE"
  },
  {
    "ppm": 175,
    "rgb": [
      250,
      217,
      200
    ],
    "hex": "#FAD9C8"
  },
  {
    "ppm": 200,
    "rgb": [
      251,
      214,
      194
    ],
    "hex": "#FBD6C2"
  },
  {
    "ppm": 225,
    "rgb": [
      251,
      211,
      188
    ],
    "hex": "#FBD3BC"
  },
  {
    "ppm": 250,
    "rgb": [
      252,
      208,
      183
    ],
    "hex": "#FCD0B7"
  },
  {
    "ppm": 275,
    "rgb": [
      252,
      206,
      177
    ],
    "hex": "#FCCEB1"
  },
  {
    "ppm": 300,
    "rgb": [
      252,
      204,
      174
    ],
    "hex": "#FCCCAE"
  },
  {
    "ppm": 325,
    "rgb": [
      252,
      202,
      169
    ],
    "hex": "#FCCAA9"
  },
  {
    "ppm": 350,
    "rgb": [
      252,
      199,
      162
    ],
    "hex": "#FCC7A2"
  },
  {
    "ppm": 375,
    "rgb": [
      252,
      195,
      153
    ],
    "hex": "#FCC399"
  },
  {
    "ppm": 400,
    "rgb": [
      252,
      192,
      147
    ],
    "hex": "#FCC093"
  },
  {
    "ppm": 425,
    "rgb": [
      251,
      190,
      143
    ],
    "hex": "#FBBE8F"
  },
  {
    "ppm": 450,
    "rgb": [
      252,
      184,
      133
    ],
    "hex": "#FCB885"
  },
  {
    "ppm": 475,
    "rgb": [
      251,
      180,
      125
    ],
    "hex": "#FBB47D"
  },
  {
    "ppm": 500,
    "rgb": [
      252,
      177,
      120
    ],
    "hex": "#FCB178"
  },
  {
    "ppm": 525,
    "rgb": [
      252,
      173,
      112
    ],
    "hex": "#FCAD70"
  },
  {
    "ppm": 550,
    "rgb": [
      251,
      167,
      102
    ],
    "hex": "#FBA766"
  },
  {
    "ppm": 575,
    "rgb": [
      251,
      164,
      96
    ],
    "hex": "#FBA460"
  },
  {
    "ppm": 600,
    "rgb": [
      251,
      160,
      88
    ],
    "hex": "#FBA058"
  },
  {
    "ppm": 625,
    "rgb": [
      251,
      156,
      80
    ],
    "hex": "#FB9C50"
  },
  {
    "ppm": 650,
    "rgb": [
      251,
      151,
      74
    ],
    "hex": "#FB974A"
  },
  {
    "ppm": 675,
    "rgb": [
      251,
      146,
      65
    ],
    "hex": "#FB9241"
  },
  {
    "ppm": 700,
    "rgb": [
      251,
      140,
      57
    ],
    "hex": "#FB8C39"
  },
  {
    "ppm": 725,
    "rgb": [
      250,
      136,
      52
    ],
    "hex": "#FA8834"
  },
  {
    "ppm": 750,
    "rgb": [
      250,
      131,
      47
    ],
    "hex": "#FA832F"
  },
  {
    "ppm": 775,
    "rgb": [
      249,
      127,
      46
    ],
    "hex": "#F97F2E"
  },
  {
    "ppm": 800,
    "rgb": [
      248,
      125,
      44
    ],
    "hex": "#F87D2C"
  },
  {
    "ppm": 825,
    "rgb": [
      245,
      118,
      40
    ],
    "hex": "#F57628"
  },
  {
    "ppm": 850,
    "rgb": [
      243,
      112,
      36
    ],
    "hex": "#F37024"
  },
  {
    "ppm": 875,
    "rgb": [
      241,
      107,
      34
    ],
    "hex": "#F16B22"
  },
  {
    "ppm": 900,
    "rgb": [
      238,
      103,
      34
    ],
    "hex": "#EE6722"
  },
  {
    "ppm": 925,
    "rgb": [
      236,
      98,
      35
    ],
    "hex": "#EC6223"
  },
  {
    "ppm": 950,
    "rgb": [
      232,
      92,
      34
    ],
    "hex": "#E85C22"
  },
  {
    "ppm": 975,
    "rgb": [
      225,
      81,
      40
    ],
    "hex": "#E15128"
  },
  {
    "ppm": 1000,
    "rgb": [
      221,
      76,
      39
    ],
    "hex": "#DD4C27"
  }
];
export const FERROUS_REFERENCE = Object.freeze(REFERENCE_RGB.map(r => Object.freeze({...r, rgb:Object.freeze(r.rgb), lab:Object.freeze(rgbToLab(r.rgb))})));

/** Match Lab directly when your app already performs correction.
 * maxDeltaE is optional and must be established from validation data.
 * Without it, the function always returns the nearest chart color, even for
 * an unrelated sample. Distance and ranking gap are NOT probabilities.
 */
export function matchFerrousLab(lab, {maxDeltaE = null} = {}) {
  triplet(lab,'lab');
  if (maxDeltaE !== null && (!Number.isFinite(maxDeltaE) || maxDeltaE < 0))
    throw new TypeError('maxDeltaE must be null or a finite nonnegative number');
  const ranked = FERROUS_REFERENCE.map(r => ({ppm:r.ppm,hex:r.hex,deltaE:deltaE2000(lab,r.lab)}))
    .sort((a,b) => a.deltaE-b.deltaE);
  const best = ranked[0], rejected = maxDeltaE !== null && best.deltaE > maxDeltaE;
  return {
    status: rejected ? 'no-close-chart-match' : 'unvalidated-chart-match',
    ppm: rejected ? null : best.ppm,
    nearestChartPpm: best.ppm,
    deltaE: best.deltaE,
    runnerUpGap: ranked[1].deltaE-best.deltaE,
    candidates: ranked.slice(0,3),
    lab: [...lab],
    atChartEndpoint: best.ppm === 0 || best.ppm === 1000,
    validated: false
  };
}

/** grayRgb omitted => no lighting correction.
 * If your app already corrected the strip RGB/Lab, do not correct it again.
 */
export function estimateFerrousPpm(stripRgb, {grayRgb = null, targetGrayRgb = DIGITAL_GRAY_RGB, maxDeltaE = null} = {}) {
  const rawLab = rgbToLab(stripRgb);
  const lab = grayRgb === null ? rawLab : correctLabWithGray(rawLab,grayRgb,targetGrayRgb);
  return {...matchFerrousLab(lab,{maxDeltaE}),rawLab,grayCorrectionApplied:grayRgb !== null};
}
