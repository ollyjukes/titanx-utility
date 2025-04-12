// app/utils/Math.js
export function wdiv(a, b) {
    if (BigInt(b) === 0n) return 0n; // Prevent division by zero
    return (BigInt(a) * 10n ** 18n) / BigInt(b);
  }