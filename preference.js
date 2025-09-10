function tokenize(str) {
  return str
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function determineVariant(baseStr, variantStr) {
  const baseTokens = tokenize(baseStr);
  const baseLower = baseTokens.map(t => t.toLowerCase());
  const baseLowerJoined = baseLower.join(' ');
  const baseSortedJoined = [...baseLower].sort().join(' ');

  const variantTokens = tokenize(variantStr);
  const variantLower = variantTokens.map(t => t.toLowerCase());
  const variantLowerJoined = variantLower.join(' ');

  if (variantLowerJoined === baseLowerJoined) {
    // Same tokens and order, check for case differences
    if (variantTokens.join(' ') !== baseTokens.join(' ')) {
      return 'VC'; // case variant
    }
    // If strings are identical including case, treat as case variant as well
    return 'VC';
  }

  const variantSortedJoined = [...variantLower].sort().join(' ');
  if (variantSortedJoined === baseSortedJoined) {
    return 'VW'; // word-order variant
  }

  return 'VO'; // other variant
}

/**
 * Assign TS, STT and ISPREF values to an array of atoms.
 * Each atom should have at least { LAT, LUI, SUI, STR } properties.
 * The array will be sorted in-place according to LAT, LUI and SUI.
 *
 * @param {Array<object>} atoms
 * @returns {Array<object>} the mutated array
 */
function assignPreferences(atoms) {
  atoms.sort((a, b) => {
    if (a.LAT !== b.LAT) return a.LAT.localeCompare(b.LAT);
    if (a.LUI !== b.LUI) return a.LUI.localeCompare(b.LUI);
    if (a.SUI !== b.SUI) return a.SUI.localeCompare(b.SUI);
    return a.STR.localeCompare(b.STR);
  });

  const preferredLUIByLang = new Map();
  const firstStringByLUI = new Map();
  const seenSUI = new Set();

  for (const atom of atoms) {
    const { LAT, LUI, SUI, STR } = atom;

    // TS: Term Status
    if (!preferredLUIByLang.has(LAT)) {
      preferredLUIByLang.set(LAT, LUI);
    }
    atom.TS = preferredLUIByLang.get(LAT) === LUI ? 'P' : 'S';

    // ISPREF: Is Preferred for SUI
    if (!seenSUI.has(SUI)) {
      atom.ISPREF = 'Y';
      seenSUI.add(SUI);
    } else {
      atom.ISPREF = 'N';
    }

    // STT: String Type
    if (!firstStringByLUI.has(LUI)) {
      firstStringByLUI.set(LUI, STR);
      atom.STT = 'PF';
    } else {
      const baseStr = firstStringByLUI.get(LUI);
      atom.STT = determineVariant(baseStr, STR);
    }
  }

  return atoms;
}

module.exports = { assignPreferences };
