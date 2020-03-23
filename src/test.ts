const s = require('./index.ts');

test('adds 1 + 2 to equal 3', () => {
  expect(s(1, 2)).toBe(3);
});
