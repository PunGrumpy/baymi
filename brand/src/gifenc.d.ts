/**
 * Types for `gifenc`, which ships none.
 *
 * @remarks
 * Only the surface `banner.ts` uses is declared. Everything on this path was
 * `any` until this file existed, which is the sort of gap that lets a palette
 * of the wrong length reach `applyPalette` without a word from the compiler.
 *
 * The one contract worth reading off these signatures: `quantize` returns the
 * palette that `applyPalette` must be given, and the palette handed to
 * `writeFrame` is a *different* one, extended with the entry that
 * `transparentIndex` points at. Passing the extended palette to `applyPalette`
 * lets real pixels map onto the transparent slot.
 */
declare module "gifenc" {
  /** A palette entry. Alpha is carried by `transparentIndex`, not per entry. */
  export type Rgb = [number, number, number];

  /** How colours are bucketed while quantising. Must match across the pair. */
  export type PaletteFormat = "rgb444" | "rgb565" | "rgba4444";

  export interface WriteFrameOptions {
    /** Indexed by the values in the frame. May carry a transparent entry. */
    palette: Rgb[];
    /** Frame duration in milliseconds. */
    delay?: number;
    /** `1` leaves the frame in place for the next one to draw over. */
    dispose?: number;
    first?: boolean;
    /** `0` loops forever. Only read on the first frame. */
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
  }

  export interface Encoder {
    writeFrame: (
      index: Uint8Array,
      width: number,
      height: number,
      options: WriteFrameOptions
    ) => void;
    finish: () => void;
    bytes: () => Uint8Array;
  }

  export function GIFEncoder(options?: {
    auto?: boolean;
    initialCapacity?: number;
  }): Encoder;

  export function quantize(
    rgba: Uint8Array,
    maxColors: number,
    options?: {
      format?: PaletteFormat;
      oneBitAlpha?: boolean | number;
      clearAlpha?: boolean;
      clearAlphaThreshold?: number;
      clearAlphaColor?: number;
    }
  ): Rgb[];

  export function applyPalette(
    rgba: Uint8Array,
    palette: Rgb[],
    format?: PaletteFormat
  ): Uint8Array;
}
