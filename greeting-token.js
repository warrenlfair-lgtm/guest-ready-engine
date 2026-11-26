const GREETING_TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function encodeGreetingToken(token) {
  if (!/^[0-9a-f]{64}$/i.test(token)) throw new Error("Invalid greeting token.");
  let encoded = "";
  let bits = 0;
  let buffer = 0;
  for (let i = 0; i < token.length; i += 2) {
    buffer = (buffer << 8) | parseInt(token.slice(i, i + 2), 16);
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      encoded += GREETING_TOKEN_ALPHABET[(buffer >> bits) & 63];
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits) encoded += GREETING_TOKEN_ALPHABET[(buffer << (6 - bits)) & 63];
  return encoded;
}

function decodeGreetingToken(value) {
  if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  let token = "";
  let bits = 0;
  let buffer = 0;
  for (const character of value) {
    buffer = (buffer << 6) | GREETING_TOKEN_ALPHABET.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      token += ((buffer >> bits) & 255).toString(16).padStart(2, "0");
      buffer &= (1 << bits) - 1;
    }
  }
  return buffer === 0 && token.length === 64 ? token : null;
}
