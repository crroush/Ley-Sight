import assert from 'node:assert/strict';
import test from 'node:test';
import {routeRegistry, resolveRoute} from './routeRegistry';

test('every registered route has presentation metadata and a component', () => {
  assert.ok(routeRegistry.length > 0);
  for (const route of routeRegistry) {
    assert.ok(route.id, 'route ID');
    assert.ok(route.label.trim(), `${route.id} title`);
    assert.ok(route.description.trim(), `${route.id} description`);
    assert.ok(route.component, `${route.id} component`);
  }
});

test('route lookup selects examples and falls back to the shell default', () => {
  assert.equal(resolveRoute('csv', '?example=04').id, 'example-4');
  assert.equal(resolveRoute('csv', '?example=unknown').id, 'csv');
  assert.equal(resolveRoute('vector').id, 'vector');
});

test('route components are lazy so entries only load the selected application', () => {
  for (const route of routeRegistry) {
    assert.equal(
      typeof route.component,
      'object',
      `${route.id} lazy component`
    );
  }
});
