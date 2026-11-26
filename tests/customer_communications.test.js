// Run with JavaScriptCore: jsc tests/customer_communications.test.js
const core = new Function(`${readFile("customer-communications-core.js")}; return { escapeText, validateGreeting };`)();
function assert(value, message) { if (!value) throw new Error(message); }
function rejects(data, message) {
  try { core.validateGreeting(data, true); } catch (error) { return; }
  throw new Error(message);
}
const greeting = {
  greeting_title: "Hello", greeting_message: "Thank you", greeting_signature: "Guest Ready",
  greeting_banner_url: null, personalize: false,
  recipients: [{ name: "Alex", first_name: "" }, { name: "Taylor", first_name: "" }],
};
core.validateGreeting(greeting, true);
rejects({ ...greeting, recipients: [] }, "A greeting needs recipients");
rejects({ ...greeting, recipients: [{ name: "Alex" }, { name: "alex" }] }, "Duplicate names must be reviewed");
rejects({ ...greeting, personalize: true }, "Personalization needs reviewed first names");
rejects({ ...greeting, greeting_banner_url: "http://example.test/a.png" }, "Banner images require HTTPS");
core.validateGreeting({ ...greeting, personalize: true, recipients: [{ name: "Alex", first_name: "Alex" }] }, true);
assert(core.escapeText('<img src="x" onerror=\'alert(1)\'>') === '&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;', "Admin HTML must escape recipient-supplied values");
print("PASS: Customer Communications validation, duplicate review and HTML escaping");
