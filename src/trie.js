const VALUE = Symbol('value');

/**
 * Created search trie
 * @param {string[][]} lines
 * @example
 *  buildSearchTrie([
 *   ['path1','value1'],
 *   ['path1.path2','value2'],
 *  ]);
 */
export const buildSearchTrie = (lines, separator = '/') => {
    const root = {};
    for (let i = 0; i < lines.length; ++i) {
        const path = lines[i][0].split(separator);
        let node = root;
        // const lastIndex = path.length - 1;
        for (let j = 0; j < path.length; ++j) {
            const item = path[j];
            if (!node[item]) {
                node[item] = {};
            }
            node = node[item];
        }
        node[VALUE] = lines[i][1];
    }
    return root;
};

export const searchTrie = (trie, path, separator = '/') => {
    let node = trie;
    let lastValue = undefined;
    let lastValuePath = -1;
    let valuePath = [];
    const paths = path.split(separator);

    for (let i = 0; i < paths.length; ++i) {
        node = node[paths[i]];
        if (!node) {
            break;
        }
        valuePath.push(paths[i]);
        if (node[VALUE]) {
            lastValue = node[VALUE];
            lastValuePath = i;
        }
    }

    return {
        value: lastValue,
        path: valuePath.slice(0, lastValuePath + 1).join(separator),
    };
};
