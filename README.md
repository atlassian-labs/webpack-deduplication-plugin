# Webpack Deduplication Plugin

Plugin for webpack that de-duplicates transitive dependencies in yarn and webpack-based projects.

## Usage

Import it from the package

```
const { WebpackDeduplicationPlugin } = require('webpack-deduplication-plugin');
```

And add it to your webpack config:

```
plugins: [
    new WebpackDeduplicationPlugin({
        cacheDir: cacheDirPath,
        rootPath: rootPath,
    }),
]
```

where:

-   cacheDirPath - absolute path to the directory where the cache of the duplicates will be stored.
    Cache is based on the content of `yarn.lock` file and will be updated with every change.
    If not provided then the duplicates will be re-generated with every run.

*   rootPath - absolute path to the root of the project. If not provided it will be auto-detected
    by [`app-root-path`](https://www.npmjs.com/package/app-root-path) plugin

*   lockFilePath - absolute path to the lock file. Defaults to `{rootPath}/webpack-dedup.lock`

Lock file:

Plugin will generate a lock file at `lockFilePath`. This file is used for generating deterministic builds in order to achieve the long-term caching.
Please check this file into the source control.

## Development

TBD

## Contributions

Contributions to Webpack Deduplication Plugin are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

Copyright (c) 2020 Atlassian and others.
Apache 2.0 licensed, see [LICENSE](LICENSE) file.

<br/>

[![With ❤️ from Atlassian](https://raw.githubusercontent.com/atlassian-internal/oss-assets/master/banner-with-thanks.png)](https://www.atlassian.com)
