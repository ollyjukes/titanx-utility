// app/api/holders/utils/serialization.js
export function sanitizeBigInt(obj) {
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(item => sanitizeBigInt(item));
  if (typeof obj === 'object' && obj !== null) {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeBigInt(value);
    }
    return sanitized;
  }
  return obj;
}