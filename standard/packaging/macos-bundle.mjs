export const MAC_HELPER_SUFFIXES = Object.freeze([" Helper", " Helper (GPU)", " Helper (Renderer)", " Helper (Plugin)"]);

// Electron compares helper paths byte-for-byte, whereas macOS filename lookup
// considers composed/decomposed Unicode equivalent. Match the builder's NFD
// filenames internally; the visible display name keeps its approved spelling.
export function validateMacBundleNames(productName, {name, displayName, executable, helpers}) {
  const internal = productName.normalize("NFD");
  if (name !== internal || executable !== internal || displayName !== productName) {
    throw new Error("macOS bundle/helper Unicode names differ; this can crash Electron before startup.");
  }
  for (const suffix of MAC_HELPER_SUFFIXES) {
    const expected = internal + suffix, helper = helpers?.[suffix];
    if (!helper || helper.bundle !== `${expected}.app` || helper.executable !== expected) {
      throw new Error(`macOS helper filename/metadata mismatch: ${suffix.trim()}.`);
    }
  }
}
