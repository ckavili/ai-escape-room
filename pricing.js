export function validatePricing(pricing) {
  if (pricing == null) return;
  if (pricing.basis !== undefined && !['demo','configured'].includes(pricing.basis)) throw new Error('Invalid pricing basis');
  for (const field of ['input_usd_per_million','output_usd_per_million']) {
    if (typeof pricing[field] !== 'number' || !Number.isFinite(pricing[field]) || pricing[field] < 0) throw new Error(`Invalid pricing: ${field} must be a nonnegative number.`);
  }
}
export function estimateCost(pricing, input, output, demo = false) {
  if (demo) return {estimated_cost_usd:null,cost_status:'demo'};
  if (pricing == null) return {estimated_cost_usd:null,cost_status:'pricing_unavailable'};
  if (![input,output].every(n=>Number.isSafeInteger(n)&&n>=0)) return {estimated_cost_usd:null,cost_status:'usage_unavailable'};
  return {estimated_cost_usd:(input*pricing.input_usd_per_million+output*pricing.output_usd_per_million)/1_000_000,cost_status:'estimated',pricing_basis:pricing.basis ?? 'configured'};
}
