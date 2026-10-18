export function formatCost(usd, dollars = false) {
  if (usd == null || !Number.isFinite(usd)) return '—';
  if (usd === 0) return dollars ? '$0.00' : '0¢';
  if (dollars || usd >= 1) return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`;
  const cents = usd * 100;
  return cents < 0.01 ? '<0.01¢' : `${cents.toFixed(2)}¢`;
}
export function costLabel(result) {
  if (result.cost_status === 'demo') return 'Simulated · no real cost';
  if (result.cost_status === 'pricing_unavailable') return 'Pricing not configured';
  if (result.cost_status === 'usage_unavailable') return 'Cost unavailable: missing usage';
  return result.estimated_cost_usd == null ? 'Cost unavailable' : `${result.pricing_basis === 'demo' ? 'Demo est.' : 'Est.'} ${formatCost(result.estimated_cost_usd)}`;
}
