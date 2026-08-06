import assert from 'node:assert/strict';
import test from 'node:test';
import {routeRegistry, resolveRoute} from './routeRegistry';

test('every registered route has presentation metadata and a component', () => {
  assert.ok(routeRegistry.length > 0);
  for (const route of routeRegistry) {
    assert.ok(route.id, 'route ID');
    assert.ok(route.label.trim(), `${route.id} title`);
    assert.ok(route.description.trim(), `${route.id} description`);
    assert.equal(typeof route.component, 'function', `${route.id} component`);
  }
});

test('route lookup selects examples and falls back to the shell default', () => {
  assert.equal(resolveRoute('csv', '?example=04').id, 'example-4');
  assert.equal(resolveRoute('csv', '?example=unknown').id, 'csv');
  assert.equal(resolveRoute('vector').id, 'vector');
});
