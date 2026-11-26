function escapeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function validateGreeting(data, requireRecipients) {
  if (!data.greeting_title || !data.greeting_message || !data.greeting_signature) throw new Error("Enter a title, message, and signature.");
  if (data.greeting_banner_url && !/^https:\/\/[^\s]+$/i.test(data.greeting_banner_url)) throw new Error("The banner image must use a valid HTTPS URL.");
  if (!requireRecipients) return;
  if (!data.recipients.length) throw new Error("Select at least one customer.");
  const names = new Set();
  for (const recipient of data.recipients) {
    if (!recipient.name) throw new Error("Enter a name for each selected customer.");
    if (data.personalize && !recipient.first_name) throw new Error("Enter a first name for each selected customer or turn off personalization.");
    const key = recipient.name.toLocaleLowerCase();
    if (names.has(key)) throw new Error("Selected customer names must be distinct. Review and edit duplicate names before publishing.");
    names.add(key);
  }

}

function validateCommunicationPreview(data) {
  validateGreeting(data, !data.test_link);
  if (data.test_link && data.test_first_name.length > 100) throw new Error("Test first name must be at most 100 characters.");
}
