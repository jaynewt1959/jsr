//
//  StaticFiles.swift
//  jsp-engine
//
//  Serves a directory tree (the Vite-built `web/dist`) at the root
//  HTTP path. Wraps Hummingbird's `FileMiddleware`, which handles
//  content types, ETags, cache headers, range requests, and an
//  index.html fallback when the request hits a directory.
//
import Foundation
import Hummingbird

enum StaticFilesError: Error, CustomStringConvertible {
    case rootNotFound(String)
    var description: String {
        switch self {
        case .rootNotFound(let p): return "static directory not found: \(p)"
        }
    }
}

/// Attach a static-file middleware to the given router. Validates
/// that `rootDirectory` exists and is a directory before mounting.
func mountStaticFiles<Context: RequestContext>(
    on router: Router<Context>,
    rootDirectory: String
) throws {
    var isDir: ObjCBool = false
    guard FileManager.default.fileExists(atPath: rootDirectory, isDirectory: &isDir),
          isDir.boolValue else {
        throw StaticFilesError.rootNotFound(rootDirectory)
    }
    let middleware = FileMiddleware<Context, LocalFileSystem>(
        rootDirectory,
        searchForIndexHtml: true
    )
    router.add(middleware: middleware)
}
