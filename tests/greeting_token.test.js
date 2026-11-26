// Run with JavaScriptCore: jsc tests/greeting_token.test.js
const { encode, decode } = new Function(`${readFile("greeting-token.js")}; return { encode: encodeGreetingToken, decode: decodeGreetingToken };`)();
function assert(value, message) { if (!value) throw new Error(message); }
for (const token of ["00".repeat(32), "ff".repeat(32), "0123456789abcdef".repeat(4), "1234567890abcdef".repeat(4)]) {
  const short = encode(token);
  assert(short.length === 43 && /^[A-Za-z0-9_-]+$/.test(short), "Encoded token must be 43 URL-safe characters");
  assert(decode(short) === token, "Short token must round-trip without losing entropy");
  assert(decode(token.toUpperCase()) === token, "Legacy hexadecimal token must remain valid");
}
assert(decode("A".repeat(42) + "B") === null, "Reject noncanonical padding bits");
assert(decode("bad") === null && decode("!".repeat(43)) === null, "Reject malformed tokens");
print("PASS: shortened greeting tokens and legacy compatibility");
