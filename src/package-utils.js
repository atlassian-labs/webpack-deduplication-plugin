const { readFileSync } = require('fs');
const { join } = require('path');
const memoize = require('lodash/memoize');

const readPackageName = memoize(function (location) {
    const data = readFileSync(join(location, 'package.json'), 'UTF-8');
    return JSON.parse(data).name;
});

module.exports = {
    readPackageName,
};
