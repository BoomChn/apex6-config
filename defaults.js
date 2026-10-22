// The profile the official site (space_station.flydigi.com, index-*.js) gives a new profile: its
// defaultConfig mapping, XMUL v1.8, wrapped as in RAM 0x05 (len, crc16, blob). Data, not code: one
// layer with no button maps or macros, gyro off, no name. "Move to library" writes it into a slot
// so the slot starts again from the defaults. Lighting has its own default there (LGHT, RAM 0x04),
// which this app doesn't write yet.
export const DEFAULT_PROFILE = Uint8Array.from([
  182, 0, 16, 37, 88, 77, 85, 76, 8, 0, 0, 0, 1, 0, 0, 0, 44, 1, 144, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 12, 13, 0, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 2, 12,
  13, 0, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 3, 11, 0, 0, 255, 255, 0, 0, 0, 0, 0, 0, 0, 4, 11, 0, 0,
  255, 255, 0, 0, 0, 0, 0, 0, 0, 5, 24, 0, 0, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 255, 0,
  255, 0, 255, 1, 2, 32, 6, 12, 0, 0, 0, 255, 255, 0, 0, 0, 0, 0, 0, 0, 7, 12, 0, 0, 0, 255, 255, 0,
  0, 0, 0, 0, 0, 0, 8, 12, 1, 0, 76, 255, 153, 2, 55, 98, 132, 126, 0, 0, 9, 12, 1, 0, 97, 255, 194,
  2, 85, 142, 175, 172, 0, 0, 255, 0
]);
