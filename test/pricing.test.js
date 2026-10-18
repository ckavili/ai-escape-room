import {test} from 'node:test';
import assert from 'node:assert/strict';
import {estimateCost,validatePricing} from '../pricing.js';
import {formatCost,costLabel} from '../public/cost.js';

test('pricing handles real usage, unknown usage, missing rates and demo mode',()=>{
  const pricing={input_usd_per_million:2,output_usd_per_million:3};
  assert.equal(estimateCost(pricing,1000,400).estimated_cost_usd,0.0032);
  assert.equal(estimateCost(null,1000,400).cost_status,'pricing_unavailable');
  assert.equal(estimateCost(pricing,null,400).cost_status,'usage_unavailable');
  assert.equal(estimateCost(pricing,1000,400,true).estimated_cost_usd,null);
  assert.equal(estimateCost({input_usd_per_million:0,output_usd_per_million:0},1000,400).estimated_cost_usd,0);
  assert.throws(()=>validatePricing({input_usd_per_million:-1,output_usd_per_million:3}));
  assert.throws(()=>validatePricing({input_usd_per_million:2}));
});
test('small dollar amounts remain readable and never appear free',()=>{
  assert.equal(formatCost(0.0032),'0.32¢');
  assert.equal(formatCost(0.000001),'<0.01¢');
  assert.equal(formatCost(0.0032,true),'<$0.01');
  assert.equal(formatCost(12.345),'$12.35');
  assert.equal(formatCost(null),'—');
  assert.equal(formatCost(0),'0¢');
  assert.equal(costLabel({cost_status:'pricing_unavailable'}),'Pricing not configured');
});
