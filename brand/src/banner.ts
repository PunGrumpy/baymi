import { writeFileSync } from "node:fs";

import type { ShaderLabConfig } from "@basementstudio/shader-lab";
import { GIFEncoder, applyPalette, quantize } from "gifenc";
import type { Rgb } from "gifenc";
import sharp from "sharp";

import { withRenderPage } from "./render-page.ts";

/**
 * Generates `banner.gif`, the animated header at the top of the README.
 *
 * @remarks
 * The picture is a Shader Lab composition rendered on WebGPU by
 * `@basementstudio/shader-lab`: soft lobes welded into one inflated mass by a
 * smooth minimum, carrying Baymax's two-eyes-and-a-bar face, under a halftone
 * turned down almost to nothing.
 * `COMPOSITION` below is a plain `ShaderLabConfig`, the same shape the Shader
 * Lab editor exports, so it can be opened at
 * https://eng.basement.studio/tools/shader-lab and edited by hand or through
 * the `shader-lab` MCP server. `banner.shader-lab.json` is written next to the
 * GIF on every run to keep that copy honest.
 *
 * The toolchain lives in `brand/package.json`, not the root one: nothing in the
 * running agent draws images, and a browser plus a native image library would
 * otherwise be installed by everyone, and by CI, for one asset that changes
 * once a year.
 *
 * ```bash
 * cd brand && bun install
 * bun run banner
 * ```
 *
 * It needs a Chromium with WebGPU. Set `BANNER_BROWSER` to the binary, or let
 * it find a Playwright install (`bunx playwright install chromium`).
 *
 * Text is composited afterwards with sharp rather than drawn as a Shader Lab
 * text layer, so the tagline is the vendored Nunito at a known size instead of
 * whatever the headless browser resolves a webfont to.
 *
 * Pass `--preview` to write PNG stills instead of encoding the GIF.
 */

/**
 * Fonts are handed to sharp as files, not looked up by name.
 *
 * @remarks
 * The obvious approach, writing a fontconfig config and exporting
 * `FONTCONFIG_FILE`, does not work from inside the script: assigning to
 * `process.env` does not reach the `getenv` that fontconfig actually reads, so
 * every vendored family silently falls back and the banner renders in whatever
 * the machine has. sharp's text API takes a `fontfile` and registers it through
 * `FcConfigAppFontAddFile`, which needs no environment at all.
 *
 * That registration is not visible to the SVG renderer, so every run of text is
 * rendered through the text API and composited at a known position rather than
 * being laid out in the overlay SVG.
 */
const BRAND = new URL("../", import.meta.url);
const FONTS = new URL("fonts/", BRAND).pathname;

/**
 * The grid every position in this file is written in, and the factor the
 * output is rendered at.
 *
 * @remarks
 * The layout was tuned at 800x213 and the numbers below still read in those
 * units, so they stay comparable to the design they came from. `SCALE` is what
 * decides the size of the file that ships.
 *
 * It is 1.25 because the README serves the banner at `width="100%"`, and
 * GitHub's markdown column is around a thousand pixels wide. At 800 the browser
 * had to stretch the asset to fill it, which softened the type; at 1000 it does
 * not. Going to 2 would cover retina as well, but a banner is not worth the
 * four-times file it costs.
 */
const DESIGN_WIDTH = 800;
const DESIGN_HEIGHT = 213;
const SCALE = 1.25;

/** Scales a design-grid measurement to the rendered image. */
const px = (value: number) => Math.round(value * SCALE);

const WIDTH = px(DESIGN_WIDTH);
const HEIGHT = px(DESIGN_HEIGHT);
const FPS = 12;
const OUTPUT_FRAMES = 36;

/**
 * Frames rendered past `OUTPUT_FRAMES`, dissolved back over the opening frames.
 *
 * @remarks
 * The gradient pass runs on an open clock and never returns to its starting
 * state, so a straight cut from the last frame to the first is visible. Playing
 * the tail under the head instead turns the wrap into a continuation.
 */
const BLEND_FRAMES = 10;

/** The ground the logo was rendered on, so the two meet without a seam. */
const PAPER = "#eef0ee";
/**
 * Tagline. Near-black with a trace of warmth rather than pure black, which on
 * this paper reads as a hole punched in it. Measured at 9.5:1 against the worst
 * background pixel it covers in any frame, which clears AAA.
 */
const INK = "#23211f";
/**
 * Wordmark. Geist Pixel at 22px is not large text under WCAG, so it needs the
 * full 4.5:1 rather than the 3:1 a heading gets. Measured at 4.7:1 against the
 * worst background pixel it covers in any frame.
 */
const MUTED = "#666059";
const TAGLINE = ["Hello. I am Baymi, your", "personal repository companion."];
const WORDMARK = "baymi";

const PORT = 7317;

/**
 * The banner as a Shader Lab project.
 *
 * @remarks
 * Layers read top to bottom, the way they do in the editor: the dither sits
 * above the field and takes it as input. Reversing them renders the field last
 * and the dither over nothing.
 *
 * The gradient pass normalises by total weight, so it always returns a blend of
 * its five points. Darkness therefore has to win on weight, not on count: the
 * three anchors sit below the bottom edge at `y: -1.7` with weights around 2.5,
 * which keeps the lower half solid enough to carry white text, while the two
 * highlights stay small and ride the top band.
 */
/**
 * The banner as a Shader Lab project.
 *
 * @remarks
 * This is the ground the logo sits on, not the subject. Five points a few
 * percent apart in lightness, warped slowly, so the paper drifts instead of
 * sitting flat. Anything with more contrast competes with the face, which is
 * the thing the banner is actually for.
 *
 * The grain matters more than it looks: a gradient this shallow posterises into
 * visible bands once the GIF is down to 128 colours, and the grain breaks them
 * up.
 */
export const COMPOSITION: ShaderLabConfig = {
  composition: { height: HEIGHT, width: WIDTH },
  layers: [
    {
      blendMode: "normal",
      compositeMode: "filter",
      hue: 0,
      id: "ground",
      kind: "source",
      name: "Ground",
      opacity: 1,
      params: {
        activePoints: 5,
        animate: true,
        falloff: 1.6,
        glowStrength: 0,
        glowThreshold: 1,
        grainAmount: 0.05,
        motionAmount: 0.32,
        motionSpeed: 0.5,
        noiseSeed: 3,
        noiseType: "simplex",
        point1Color: "#f7f8f7",
        point1Position: [-1.5, 0.45],
        point1Weight: 1,
        point2Color: "#e7e9e8",
        point2Position: [-0.5, -0.4],
        point2Weight: 1,
        point3Color: "#f2f3f2",
        point3Position: [0.4, 0.35],
        point3Weight: 1,
        point4Color: "#e9ebea",
        point4Position: [1.3, -0.3],
        point4Weight: 1,
        point5Color: "#f4f5f4",
        point5Position: [2, 0.2],
        point5Weight: 1,
        tonemapMode: "none",
        vignetteRadius: 1.1,
        vignetteSoftness: 0.6,
        vignetteStrength: 0.12,
        vortexAmount: 0.1,
        warpAmount: 0.5,
        warpBias: 0.5,
        warpDecay: 1.1,
        warpIterations: 2,
        warpScale: 0.9,
      },
      saturation: 1,
      type: "gradient",
      visible: true,
    },
  ],
  timeline: { duration: OUTPUT_FRAMES / FPS, loop: true, tracks: [] },
};

/**
 * The page that renders the composition.
 *
 * @remarks
 * `ShaderLabTextureSource` renders offscreen and hands back a texture, which is
 * the only capture path that survives here: a WebGPU canvas is invalidated when
 * the browser composites it, so `toDataURL` on the canvas the runtime draws into
 * returns a blank image. The texture goes through a render target and
 * `readRenderTargetPixelsAsync` instead, then into a 2D canvas, whose
 * `toDataURL` is reliable.
 */
interface RenderOptions {
  fps: number;
  frames: number;
  height: number;
  warmup: number;
  width: number;
}

declare global {
  interface Window {
    renderShaderLab: (
      config: ShaderLabConfig,
      options: RenderOptions
    ) => Promise<string[]>;
  }
}

const BROWSER_ENTRY = `
import { ShaderLabTextureSource } from "@basementstudio/shader-lab";
import * as THREE from "three/webgpu";
import { float, texture as tslTexture, uv, vec2 } from "three/tsl";

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

window.renderShaderLab = async (config, { width, height, frames, fps, warmup }) => {
  const renderer = new THREE.WebGPURenderer({ alpha: false, antialias: false });
  await renderer.init();
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  const source = new ShaderLabTextureSource(config, { renderer, width, height, pixelRatio: 1 });
  await source.initialize();

  const target = new THREE.RenderTarget(width, height, {
    colorSpace: THREE.SRGBColorSpace,
    depthBuffer: false,
    stencilBuffer: false,
  });
  const blitScene = new THREE.Scene();
  const blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const blitNode = tslTexture(new THREE.Texture(), vec2(uv().x, float(1).sub(uv().y)));
  const blitMaterial = new THREE.MeshBasicNodeMaterial();
  blitMaterial.colorNode = blitNode;
  blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMaterial));

  const readCanvas = document.createElement("canvas");
  readCanvas.width = width;
  readCanvas.height = height;
  const context = readCanvas.getContext("2d");

  const delta = 1 / fps;

  // Passes compile asynchronously and are skipped until they are ready, so
  // hold at time 0 until the pipeline is complete before capturing anything.
  for (let i = 0; i < warmup; i += 1) {
    source.update(0, delta);
    await nextFrame();
  }

  const shots = [];
  for (let frame = 0; frame < frames; frame += 1) {
    const output = source.update(frame * delta, delta);
    if (!output) throw new Error("texture source returned no texture at frame " + frame);
    blitNode.value = output;
    renderer.setRenderTarget(target);
    await renderer.renderAsync(blitScene, blitCamera);
    renderer.setRenderTarget(null);

    const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
    // WebGPU pads every row but the last to a 256-byte boundary, so an 800px
    // row of RGBA arrives as 3328 bytes rather than 3200.
    const rowBytes = width * 4;
    const bytes = new Uint8ClampedArray(rowBytes * height);
    if (pixels.length === bytes.length) {
      bytes.set(pixels);
    } else {
      const paddedRow = Math.ceil(rowBytes / 256) * 256;
      for (let row = 0; row < height; row += 1) {
        const start = row * paddedRow;
        bytes.set(pixels.subarray(start, start + rowBytes), row * rowBytes);
      }
    }
    context.putImageData(new ImageData(bytes, width, height), 0, 0);
    shots.push(readCanvas.toDataURL("image/png"));
    await nextFrame();
  }

  target.dispose();
  source.dispose();
  renderer.dispose();
  return shots;
};
`;

const FADE =
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.34" stop-color="${PAPER}" stop-opacity="0"/>
      <stop offset="0.70" stop-color="${PAPER}" stop-opacity="0.55"/>
      <stop offset="0.95" stop-color="${PAPER}" stop-opacity="0.72"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${px(470)}" height="${HEIGHT}" fill="url(#fade)"/>
</svg>`);

/** Renders one run of text through sharp, at 72 dpi so points equal pixels. */
const textRun = (options: {
  font: string;
  file: string;
  fill: string;
  text: string;
  tracking?: number;
}) =>
  sharp({
    text: {
      dpi: 72,
      font: options.font,
      fontfile: `${FONTS}${options.file}`,
      rgba: true,
      text: `<span foreground="${options.fill}"${options.tracking ? ` letter_spacing="${options.tracking}"` : ""}>${options.text}</span>`,
    },
  })
    .png()
    .toBuffer();

const typeLayers = async () => {
  const [markImage, first, second] = await Promise.all([
    textRun({
      file: "GeistPixel-Square.ttf",
      fill: MUTED,
      font: `Geist Pixel Square ${22 * SCALE}`,
      text: WORDMARK,
    }),
    textRun({
      file: "Geist-SemiBold.ttf",
      fill: INK,
      font: `Geist SemiBold ${32 * SCALE}`,
      text: TAGLINE[0],
      tracking: -700,
    }),
    textRun({
      file: "Geist-SemiBold.ttf",
      fill: INK,
      font: `Geist SemiBold ${32 * SCALE}`,
      text: TAGLINE[1],
      tracking: -700,
    }),
  ]);
  return [
    { input: markImage, left: px(36), top: px(40) },
    { input: first, left: px(36), top: px(112) },
    { input: second, left: px(36), top: px(152) },
  ];
};

/**
 * The logo, cropped to what lands inside the frame and faded on its left edge.
 *
 * @remarks
 * It runs off the right, top and bottom edges on purpose. Only the left side
 * ends up inside the frame, so that is the only edge that has to be hidden, and
 * one horizontal fade does it. The alternative, keying out the logo's own
 * background, is not safe here: that background is a soft vignette running from
 * `#dcdee0` to `#f4f5f4`, which overlaps the white of the body itself.
 *
 * The logo does not move. Drifting it a few pixels tripled the GIF, because a
 * one-pixel shift rewrites every pixel of the body, and the motion it bought
 * was almost invisible. The glow over the eyes carries the life instead: it
 * covers a twelfth of the area and is smooth enough to quantise cheaply.
 */
const LOGO_SIZE = px(350);
const LOGO_LEFT = px(466);
const LOGO_TOP = px(-70);
const LOGO_FEATHER = px(96);

const logoLayer = async () => {
  const top = LOGO_TOP;
  const cropTop = Math.max(0, -top);
  const width = Math.min(LOGO_SIZE, WIDTH - LOGO_LEFT);
  const height = Math.min(LOGO_SIZE - cropTop, HEIGHT - Math.max(0, top));
  const scaled = await sharp(new URL("logo.png", BRAND).pathname)
    .resize(LOGO_SIZE, LOGO_SIZE)
    .removeAlpha()
    .toBuffer();
  const mask =
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="m" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/>
      <stop offset="${(LOGO_FEATHER / width).toFixed(3)}" stop-color="#fff" stop-opacity="1"/>
    </linearGradient></defs>
    <rect width="${width}" height="${height}" fill="url(#m)"/></svg>`);
  return {
    input: await sharp(scaled)
      .extract({ height, left: 0, top: cropTop, width })
      .composite([
        { blend: "dest-in", input: await sharp(mask).png().toBuffer() },
      ])
      .png()
      .toBuffer(),
    left: LOGO_LEFT,
    top: Math.max(0, top),
  };
};

const renderFrames = (count: number) =>
  withRenderPage(
    {
      args: ["--enable-unsafe-webgpu", "--enable-unsafe-swiftshader"],
      name: "banner",
      port: PORT,
      ready: "renderShaderLab",
      source: BROWSER_ENTRY,
    },
    async (page) => {
      const shots: string[] = await page.evaluate(
        ([config, options]) => window.renderShaderLab(config, options),
        [
          COMPOSITION,
          { fps: FPS, frames: count, height: HEIGHT, warmup: 30, width: WIDTH },
        ] as const
      );
      return await Promise.all(
        shots.map((shot) =>
          sharp(Buffer.from(shot.split(",")[1], "base64"))
            .removeAlpha()
            .raw()
            .toBuffer()
        )
      );
    }
  );

const loopFrames = (rendered: Buffer[]) => {
  const looped: Buffer[] = [];
  for (let frame = 0; frame < OUTPUT_FRAMES; frame += 1) {
    if (frame >= BLEND_FRAMES) {
      looped.push(rendered[frame]);
      continue;
    }
    const head = rendered[frame];
    const tail = rendered[OUTPUT_FRAMES + frame];
    const mix = frame / BLEND_FRAMES;
    const blended = Buffer.allocUnsafe(head.length);
    for (let i = 0; i < head.length; i += 1) {
      blended[i] = Math.round(tail[i] * (1 - mix) + head[i] * mix);
    }
    looped.push(blended);
  }
  return looped;
};

/**
 * A soft warm bloom over the eyes, pulsing once across the loop.
 *
 * @remarks
 * Drawn as a local tile rather than a full-canvas gradient so the frame diff
 * stays inside it. A full-canvas radial gradient is transparent at the edges,
 * but its dithering is not, and that alone is enough to mark every pixel as
 * changed.
 */
const EYES = {
  height: px(190),
  left: px(526),
  top: 0,
  width: px(230),
};

const eyeGlow = (index: number) => {
  const phase = (index / OUTPUT_FRAMES) * Math.PI * 2;
  const strength = (0.16 + 0.16 * (0.5 + 0.5 * Math.sin(phase))).toFixed(3);
  const cx = px(640) - EYES.left;
  const cy = px(97) - EYES.top;
  return {
    blend: "over" as const,
    input:
      Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${EYES.width}" height="${EYES.height}">
      <defs><radialGradient id="g" cx="${cx / EYES.width}" cy="${cy / EYES.height}" r="0.46">
        <stop offset="0" stop-color="#fff6e0" stop-opacity="${strength}"/>
        <stop offset="1" stop-color="#fff6e0" stop-opacity="0"/>
      </radialGradient></defs>
      <rect width="${EYES.width}" height="${EYES.height}" fill="url(#g)"/></svg>`),
    left: EYES.left,
    top: EYES.top,
  };
};

// Everything except the glow is the same on every frame, so it is built once
// rather than 46 times. Rebuilding it per frame meant re-reading and resizing
// the logo and re-rasterising all three runs of text for each one.
const LOGO_LAYER = await logoLayer();
const TEXT_LAYERS = await typeLayers();

const compose = (frame: Buffer, index: number) =>
  sharp(frame, { raw: { channels: 3, height: HEIGHT, width: WIDTH } })
    .composite([
      LOGO_LAYER,
      eyeGlow(index),
      { input: FADE, left: 0, top: 0 },
      ...TEXT_LAYERS,
    ])
    .removeAlpha();

const toRgba = (buffer: Buffer) => {
  const out = new Uint8Array((buffer.length / 3) * 4);
  for (let read = 0, write = 0; read < buffer.length; read += 3, write += 4) {
    out[write] = buffer[read];
    out[write + 1] = buffer[read + 1];
    out[write + 2] = buffer[read + 2];
    out[write + 3] = 255;
  }
  return out;
};

const encode = (frames: Buffer[]) => {
  const sample = toRgba(
    Buffer.concat(frames.filter((_, index) => index % 4 === 0))
  );
  const palette = quantize(sample, 128, { format: "rgb565" });
  const transparentIndex = palette.length;
  // The transparent slot is appended only for `writeFrame`, and `applyPalette`
  // is given the palette without it. Hand it the extended one and any pixel
  // whose nearest colour is that entry maps onto the transparent index, which
  // `dispose: 1` then fills with whatever the previous frame left there. It
  // reads as streaks smeared across the picture, and it only appears once the
  // composition happens to contain the appended colour.
  const TRANSPARENT_ENTRY: Rgb = [0, 0, 0];
  const framePalette: Rgb[] = [...palette, TRANSPARENT_ENTRY];

  const gif = GIFEncoder();
  let previous: Uint8Array | null = null;
  for (const [index, frame] of frames.entries()) {
    const indexed = applyPalette(toRgba(frame), palette, "rgb565");
    const painted = Uint8Array.from(indexed);
    if (previous) {
      // Frames after the first carry only what changed; `dispose: 1` leaves
      // the rest of the previous frame in place. The tagline never moves, so
      // it is written once.
      for (let i = 0; i < painted.length; i += 1) {
        if (painted[i] === previous[i]) {
          painted[i] = transparentIndex;
        }
      }
    }
    previous = indexed;
    gif.writeFrame(painted, WIDTH, HEIGHT, {
      delay: Math.round(1000 / FPS),
      dispose: 1,
      first: index === 0,
      palette: framePalette,
      repeat: 0,
      transparent: true,
      transparentIndex,
    });
  }
  gif.finish();
  return gif.bytes();
};

const preview = process.argv.includes("--preview");
const rendered = await renderFrames(OUTPUT_FRAMES + BLEND_FRAMES);

// oxfmt keeps short numeric arrays on one line and `JSON.stringify` always
// expands them, so collapse the vec2 params here rather than leaving every run
// of this script to be undone by the next `bun run fix`.
const serialised = JSON.stringify(COMPOSITION, null, 2).replaceAll(
  /\[\n\s*(?<x>-?[\d.]+),\n\s*(?<y>-?[\d.]+)\n\s*\]/gu,
  "[$<x>, $<y>]"
);
writeFileSync(new URL("banner.shader-lab.json", BRAND), `${serialised}\n`);

if (preview) {
  await Promise.all(
    [0, 9, 18, 27].map((index) =>
      compose(rendered[index], index)
        .png()
        .toFile(new URL(`preview-${index}.png`, BRAND).pathname)
    )
  );
  process.stdout.write(
    "wrote preview-0.png, preview-9.png, preview-18.png and preview-27.png\n"
  );
} else {
  const composited = await Promise.all(
    loopFrames(rendered).map((frame, index) =>
      compose(frame, index).raw().toBuffer()
    )
  );
  // `banner.png` is the still the README serves under
  // `prefers-reduced-motion: reduce`. It is the GIF's own first frame, so the
  // two start from the same picture.
  await sharp(composited[0], {
    raw: { channels: 3, height: HEIGHT, width: WIDTH },
  })
    .png({ palette: true })
    .toFile(new URL("banner.png", BRAND).pathname);

  const bytes = encode(composited);
  writeFileSync(new URL("banner.gif", BRAND), bytes);
  process.stdout.write(
    `banner.gif ${Math.round(bytes.length / 1024)} KB, ${composited.length} frames\n`
  );
}
