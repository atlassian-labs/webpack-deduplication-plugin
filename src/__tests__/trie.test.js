import { buildSearchTrie, searchTrie } from '../trie';

describe('trie', () => {
    const trie = buildSearchTrie([
        ['1/2/3', 1],
        ['1/2/33', 2],
        ['1/2/3345', 3],
        ['1/2/33/45', 5],
    ]);

    it('searches the trie', () => {
        expect(searchTrie(trie, '1/2/3')).toEqual({
            value: 1,
            path: '1/2/3',
        });

        expect(searchTrie(trie, '1/2/33/45')).toEqual({
            value: 5,
            path: '1/2/33/45',
        });
    });

    it('picks last known value', () => {
        expect(searchTrie(trie, '1/2/33')).toEqual({
            value: 2,
            path: '1/2/33',
        });
        // non-existing path
        expect(searchTrie(trie, '1/2/333')).toEqual({
            value: undefined,
            path: '',
        });
    });
});
