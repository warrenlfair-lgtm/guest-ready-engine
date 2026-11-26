function greetingWrapText(context, text, maxWidth) {
  const lines = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    let line = "";
    for (const word of paragraph.split(/(\s+)/)) {
      if (!word) continue;
      if (context.measureText(line + word).width <= maxWidth) {
        line += word;
        continue;
      }
      if (line.trim()) lines.push(line.trimEnd());
      line = "";
      if (!word.trim()) continue;
      for (const character of Array.from(word)) {
        if (line && context.measureText(line + character).width > maxWidth) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

async function greetingBannerImage(url) {
  if (!url) return null;
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The banner image could not be included. Its image host must allow cross-origin access to save the card."));
    image.src = url;
  });
}

async function createGreetingImage(data) {
  const image = await greetingBannerImage(data.banner_url);
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser cannot create a greeting image.");
  const blocks = [
    { text: data.title, font: "bold 64px Georgia, serif", lineHeight: 82, gap: 38 },
    ...(data.first_name ? [{ text: `Dear ${data.first_name},`, font: "38px Georgia, serif", lineHeight: 58, gap: 24 }] : []),
    { text: data.message, font: "38px Georgia, serif", lineHeight: 58, gap: 38 },
    { text: data.signature, font: "38px Georgia, serif", lineHeight: 58, gap: 0 },
  ].map((block) => {
    context.font = block.font;
    return { ...block, lines: greetingWrapText(context, block.text, 1000) };
  });
  const bannerHeight = image ? Math.min(500, Math.round(1200 * image.naturalHeight / image.naturalWidth)) : 0;
  const height = 130 + bannerHeight + 100 + blocks.reduce((sum, block) => sum + block.lines.length * block.lineHeight + block.gap, 0) + 100;
  if (height > 12000) throw new Error("This greeting is too long to save as one image. Shorten the message and publish a new greeting.");
  canvas.height = height;
  context.fillStyle = "#fffdf8";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#183b43";
  context.fillRect(0, 0, canvas.width, 130);
  context.fillStyle = "#e9d8a8";
  context.font = "bold 34px Arial, sans-serif";
  context.textBaseline = "top";
  context.fillText("GUEST READY", 100, 48);
  let y = 130;
  if (image) {
    const sourceHeight = Math.min(image.naturalHeight, image.naturalWidth * bannerHeight / 1200);
    context.drawImage(image, 0, (image.naturalHeight - sourceHeight) / 2, image.naturalWidth, sourceHeight, 0, y, 1200, bannerHeight);
    y += bannerHeight;
  }
  y += 100;
  context.fillStyle = "#183b43";
  for (const block of blocks) {
    context.font = block.font;
    for (const line of block.lines) {
      context.fillText(line, 100, y);
      y += block.lineHeight;
    }
    y += block.gap;
  }
  const blob = await new Promise((resolve, reject) => {
    try { canvas.toBlob(resolve, "image/png"); } catch (error) { reject(error); }
  });
  if (!blob) throw new Error("Your browser could not save the greeting image.");
  return blob;
}
