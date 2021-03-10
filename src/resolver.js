const fs = require('fs');
const { ResolverFactory, CachedInputFileSystem } = require('enhanced-resolve');
const memoize = require('lodash/memoize');

const noop = () => {};

const createMemoisedResolver = (mainFields) => {
    const resolver = ResolverFactory.createResolver({
        fileSystem: new CachedInputFileSystem(fs, 4000),
        useSyncFileSystemCalls: true,
        mainFields,
    });

    return memoize(
        (request, context) => {
            let resolved;

            // This is a bit of a performance hack. The short of it is that the way to checks for the
            // existence of a file in Node is by performing an fs operation (whether that's a `read`
            // or a `stat`). When this operation fails, an exception is created and thrown. Checking
            // the underlying OS error type in this exception can be used to determine whether the file
            // exists or some other error occurred.
            //
            // Node does this through an internal method called `uvException` - https://github.com/nodejs/node/blob/307c67be175b8fe7d9dd9e1b5ed55d928b73d66d/lib/internal/errors.js#L399
            // (`libuv` being the underlying library that handles Node's async i/o). These exceptions
            // have a full stacktrace generated, which is actually a super expensive operation. Now
            // when we call `resolve` 20,000+ times during a webpack build we're generating a lot of
            // exceptions with stack traces that we just end up throwing away.
            //
            // So this hack noops the `captureStackTrace` method Node uses, and cuts the stack limit for
            // `new Error` calls. This means that errors occurring in this function won't have stack
            // traces, but this is an acceptable tradeoff for the almost 50% perf improvement we get
            // when we have a compile of significant size.
            //
            // A profile still shows significant time in `uvException`, but there aren't any extra obvious
            // easy optimisation opportunities.
            const originalCaptureStackTrace = Error.captureStackTrace;
            const originalStackLimit = Error.stackTraceLimit;
            try {
                Error.captureStackTrace = noop;
                Error.stackTraceLimit = 0;

                resolved = resolver.resolveSync({}, context, request);
            } catch (e) {
                // Where a resolution fails (e.g. trying to resolve a built-in) we just
                // return the original request, this allows it to be handled properly downstream
                resolved = request;
            } finally {
                Error.captureStackTrace = originalCaptureStackTrace;
                Error.stackTraceLimit = originalStackLimit;
            }
            return resolved;
        },
        (r, c) => `${r} _____ ${c}`
    );
};

module.exports = { createMemoisedResolver };
