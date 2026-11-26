// Run with JavaScriptCore: jsc tests/greeting_image.test.js
const wrap = new Function(`${readFile("greeting-image.js")}; return greetingWrapText;`)();
const context = { measureText: (text) => ({ width: Array.from(text).length }) };
function assert(value, message) { if (!value) throw new Error(message); }
assert(wrap(context, "Happy holidays everyone", 10).join("|") === "Happy|holidays|everyone", "Wrap words without dropping text");
assert(wrap(context, "abcdefghijkl", 5).join("|") === "abcde|fghij|kl", "Wrap long unbroken words");
assert(wrap(context, "Hello\n\nWorld", 10).join("|") === "Hello||World", "Preserve blank lines");
assert(wrap(context, "😀😀😀", 2).join("|") === "😀😀|😀", "Preserve Unicode characters when wrapping");
print("PASS: greeting image text wrapping");
