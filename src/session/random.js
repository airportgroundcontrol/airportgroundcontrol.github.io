export const validSeed = (value) =>
  Number.isInteger(value) && value > 0 && value <= 0xffffffff;

export function freshSeed() {
  const values = new Uint32Array(1);
  do globalThis.crypto.getRandomValues(values);
  while (values[0] === 0);
  return values[0];
}

// Xorshift32: a single serialized word, with identical integer arithmetic in
// browsers and Node. Zero is excluded because it is an absorbing state.
export function nextRandomState(state) {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state >>> 0;
}
