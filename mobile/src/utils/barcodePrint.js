import barcodes from 'jsbarcode/src/barcodes';
import * as Print from 'expo-print';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

export function code128Svg(value) {
  const text = String(value || '').trim();
  if (!text) throw new Error('A tracking barcode is required to print a label.');

  const Encoder = barcodes.CODE128;
  const encoder = new Encoder(text, {});
  if (!encoder.valid()) throw new Error('This tracking code cannot be encoded as Code 128.');

  const bits = encoder.encode().data;
  const quiet = 18;
  const height = 82;
  const width = bits.length + quiet * 2;
  const paths = [];
  let start = -1;
  for (let index = 0; index <= bits.length; index += 1) {
    if (bits[index] === '1' && start < 0) start = index;
    if (bits[index] !== '1' && start >= 0) {
      paths.push(`<rect x="${start + quiet}" y="0" width="${index - start}" height="${height}"/>`);
      start = -1;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 112" role="img" aria-label="Code 128 ${escapeHtml(text)}"><rect width="${width}" height="112" fill="#fff"/><g fill="#000">${paths.join('')}</g><text x="${width / 2}" y="104" text-anchor="middle" font-family="Arial,sans-serif" font-size="10">${escapeHtml(text)}</text></svg>`;
}

export async function printTrackingBarcode(value) {
  const svg = code128Svg(value);
  return Print.printAsync({
    html: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/><style>html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,sans-serif}.label{width:100%;max-width:720px;margin:24px auto;padding:18px;box-sizing:border-box;text-align:center}.label svg{width:100%;height:auto}.company{font-size:12px;font-weight:700;letter-spacing:1px;margin-bottom:16px}</style></head><body><main class="label"><div class="company">CONTAINER YARD · TRACKING LABEL</div>${svg}</main></body></html>`,
  });
}
