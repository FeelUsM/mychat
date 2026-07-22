#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  RootsListChangedNotificationSchema,
  type Root,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { z } from "zod";
import { minimatch } from "minimatch";
import { normalizePath, expandHome } from './path-utils.js';
import { getValidRootDirectories } from './roots-utils.js';
import {
  // Function imports
  formatSize,
  validatePath,
  getFileStats,
  readFileContent,
  writeFileContent,
  searchFilesWithValidation,
  applyFileEdits,
  tailFile,
  headFile,
  setAllowedDirectories,
  getAllowedDirectories,
  resolveMcpPath,
  AllowedDir,
} from './lib.js';

// ============================================================================
// Argument Parsing
// ============================================================================

interface ParsedDir {
  hostPath: string;
  mcpPath: string;
  readonly: boolean;
}

function parseArgs(args: string[]): ParsedDir[] {
  const result: ParsedDir[] = [];
  let i = 0;

  while (i < args.length) {
    const arg = args[i];
    let readonly = false;

    // Handle flags
    if (arg === '-r' || arg === '--readonly') {
      readonly = true;
      i++;
      if (i >= args.length) {
        throw new Error(`Missing path after ${arg}`);
      }
    }

    const pathArg = args[i];

    // Validate path argument doesn't start with forbidden prefixes
    if (pathArg.startsWith('--') || pathArg.startsWith('-r')) {
      throw new Error(`Invalid path: "${pathArg}" - paths cannot start with "--" or "-r"`);
    }

    // Parse host=mcp mapping
    let hostPath: string;
    let mcpPath: string;

    if (pathArg.includes('=')) {
      const parts = pathArg.split('=');
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new Error(`Invalid mapping format: "${pathArg}" - expected "host_path=mcp_path"`);
      }
      hostPath = parts[0];
      mcpPath = parts[1];
    } else {
      hostPath = pathArg;
      mcpPath = pathArg;
    }

    // Validate mcpPath: must be absolute, no forbidden chars
    if (!mcpPath.startsWith('/')) {
      throw new Error(`MCP path must be absolute (start with /): "${mcpPath}"`);
    }
    if (mcpPath.includes('=')) {
      throw new Error(`MCP path cannot contain "=": "${mcpPath}"`);
    }

    // Normalize mcpPath: remove trailing slash except root
    if (mcpPath.length > 1 && mcpPath.endsWith('/')) {
      mcpPath = mcpPath.slice(0, -1);
    }

    result.push({ hostPath, mcpPath, readonly });
    i++;
  }

  return result;
}

async function validateAndResolveDirs(parsed: ParsedDir[]): Promise<AllowedDir[]> {
  const resolved: AllowedDir[] = [];

  for (const { hostPath, mcpPath, readonly } of parsed) {
    // Expand ~ and resolve to absolute path
    const expanded = expandHome(hostPath);
    const absolute = path.resolve(expanded);

    // Check existence and directory
    let stats: fs.Stats;
    try {
      stats = await fs.stat(absolute);
    } catch (err) {
      throw new Error(`Host path does not exist or is not accessible: ${absolute}`);
    }
    if (!stats.isDirectory()) {
      throw new Error(`Host path is not a directory: ${absolute}`);
    }

    // Resolve symlinks
    const realPath = await fs.realpath(absolute);
    const normalizedHost = normalizePath(realPath);
    const normalizedMcp = normalizePath(mcpPath).toLowerCase(); // case-insensitive for mcp paths

    resolved.push({
      hostPath: normalizedHost,
      mcpPath: normalizedMcp,
      readonly,
    });
  }

  // Check hostPath nesting (case-sensitive, real paths)
  for (let i = 0; i < resolved.length; i++) {
    for (let j = 0; j < resolved.length; j++) {
      if (i === j) continue;
      const a = resolved[i].hostPath;
      const b = resolved[j].hostPath;
      if (a === b || a.startsWith(b + path.sep)) {
        throw new Error(`Host paths must not be nested: "${resolved[i].hostPath}" is inside "${resolved[j].hostPath}"`);
      }
    }
  }

  // Check mcpPath nesting (case-insensitive)
  for (let i = 0; i < resolved.length; i++) {
    for (let j = 0; j < resolved.length; j++) {
      if (i === j) continue;
      const a = resolved[i].mcpPath;
      const b = resolved[j].mcpPath;
      if (a === b || a.startsWith(b + '/')) {
        throw new Error(`MCP paths must not be nested: "${resolved[i].mcpPath}" is inside "${resolved[j].mcpPath}"`);
      }
    }
  }

  return resolved;
}

// ============================================================================
// Main
// ============================================================================

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage: mcp-server-filesystem [options] <path_spec> [path_spec...]");
  console.error("");
  console.error("Path specifications:");
  console.error("  <host_path>                    Read-write access, MCP path = host path");
  console.error("  -r <host_path>                 Read-only access, MCP path = host path");
  console.error("  <host_path>=<mcp_path>         Read-write, custom MCP path (must start with /)");
  console.error("  -r <host_path>=<mcp_path>      Read-only, custom MCP path");
  console.error("  --readonly <host_path>=<mcp_path>  Same as -r");
  console.error("");
  console.error("Restrictions:");
  console.error("  - Host paths must exist and be directories");
  console.error("  - MCP paths must be absolute (start with /)");
  console.error("  - Paths cannot start with '--' or '-r'");
  console.error("  - Paths cannot contain '='");
  console.error("  - Host paths must not be nested within each other");
  console.error("  - MCP paths must not be nested within each other");
  console.error("");
  console.error("Examples:");
  console.error("  mcp-server-filesystem /data /home/user/docs");
  console.error("  mcp-server-filesystem -r /data/readonly /data/readwrite");
  console.error("  mcp-server-filesystem /host/data=/mcp/data /host/ro=/mcp/ro -r /host/ro2=/mcp/ro2");
  process.exit(1);
}

let allowedDirs: AllowedDir[];

try {
  const parsed = parseArgs(args);
  allowedDirs = await validateAndResolveDirs(parsed);
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

// Log startup summary
console.error("Secure MCP Filesystem Server starting...");
console.error("Allowed directories:");
for (const dir of allowedDirs) {
  console.error(`  ${dir.mcpPath} -> ${dir.hostPath} (${dir.readonly ? 'readonly' : 'readwrite'})`);
}

// Initialize global state in lib.ts
setAllowedDirectories(allowedDirs);

// ============================================================================
// Schema definitions
// ============================================================================

const ReadTextFileArgsSchema = z.object({
  path: z.string(),
  tail: z.number().optional().describe('If provided, returns only the last N lines of the file'),
  head: z.number().optional().describe('If provided, returns only the first N lines of the file')
});

const ReadMediaFileArgsSchema = z.object({
  path: z.string()
});

const ReadMultipleFilesArgsSchema = z.object({
  paths: z
    .array(z.string())
    .min(1, "At least one file path must be provided")
    .describe("Array of file paths to read. Each path must be a string pointing to a valid file within allowed directories."),
});

const WriteFileArgsSchema = z.object({
  path: z.string(),
  content: z.string(),
});

const EditOperation = z.object({
  oldText: z.string().describe('Text to search for - must match exactly'),
  newText: z.string().describe('Text to replace with')
});

const EditFileArgsSchema = z.object({
  path: z.string(),
  edits: z.array(EditOperation),
  dryRun: z.boolean().default(false).describe('Preview changes using git-style diff format')
});

const CreateDirectoryArgsSchema = z.object({
  path: z.string(),
});

const ListDirectoryArgsSchema = z.object({
  path: z.string(),
});

const ListDirectoryWithSizesArgsSchema = z.object({
  path: z.string(),
  sortBy: z.enum(['name', 'size']).optional().default('name').describe('Sort entries by name or size'),
});

const DirectoryTreeArgsSchema = z.object({
  path: z.string(),
  excludePatterns: z.array(z.string()).optional().default([])
});

const MoveFileArgsSchema = z.object({
  source: z.string(),
  destination: z.string(),
});

const SearchFilesArgsSchema = z.object({
  path: z.string(),
  pattern: z.string(),
  excludePatterns: z.array(z.string()).optional().default([])
});

const GetFileInfoArgsSchema = z.object({
  path: z.string(),
});

// ============================================================================
// Server setup
// ============================================================================

const server = new McpServer(
  {
    name: "secure-filesystem-server",
    version: "0.3.0",
  }
);

// ============================================================================
// Helper: read file as base64
// ============================================================================

async function readFileAsBase64Stream(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => {
      chunks.push(chunk as Buffer);
    });
    stream.on('end', () => {
      const finalBuffer = Buffer.concat(chunks);
      resolve(finalBuffer.toString('base64'));
    });
    stream.on('error', (err) => reject(err));
  });
}

// ============================================================================
// Tool registrations
// ============================================================================

// read_file (deprecated) and read_text_file
const readTextFileHandler = async (args: z.infer<typeof ReadTextFileArgsSchema>) => {
  const validPath = await validatePath(args.path);

  if (args.head && args.tail) {
    throw new Error("Cannot specify both head and tail parameters simultaneously");
  }

  let content: string;
  if (args.tail) {
    content = await tailFile(validPath, args.tail);
  } else if (args.head) {
    content = await headFile(validPath, args.head);
  } else {
    content = await readFileContent(validPath);
  }

  return {
    content: [{ type: "text" as const, text: content }],
    structuredContent: { content }
  };
};

server.registerTool(
  "read_file",
  {
    title: "Read File (Deprecated)",
    description: "Read the complete contents of a file as text. DEPRECATED: Use read_text_file instead.",
    inputSchema: ReadTextFileArgsSchema.shape,
    outputSchema: { content: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  readTextFileHandler
);

server.registerTool(
  "read_text_file",
  {
    title: "Read Text File",
    description:
      "Read the complete contents of a file from the file system as text. " +
      "Handles various text encodings and provides detailed error messages " +
      "if the file cannot be read. Use this tool when you need to examine " +
      "the contents of a single file. Use the 'head' parameter to read only " +
      "the first N lines of a file, or the 'tail' parameter to read only " +
      "the last N lines of a file. Operates on the file as text regardless of extension. " +
      "Only works within allowed directories. Read-only directories are accessible.",
    inputSchema: {
      path: z.string(),
      tail: z.number().optional().describe("If provided, returns only the last N lines of the file"),
      head: z.number().optional().describe("If provided, returns only the first N lines of the file")
    },
    outputSchema: { content: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  readTextFileHandler
);

server.registerTool(
  "read_media_file",
  {
    title: "Read Media File",
    description:
      "Read a file and return it as a base64-encoded content block with its MIME type. " +
      "Image and audio files are returned as image/audio content; any other file type is " +
      "returned as an embedded resource. Only works within allowed directories. Read-only directories are accessible.",
    inputSchema: {
      path: z.string()
    },
    outputSchema: {
      content: z.array(z.union([
        z.object({
          type: z.enum(["image", "audio"]),
          data: z.string(),
          mimeType: z.string()
        }),
        z.object({
          type: z.literal("resource"),
          resource: z.object({
            uri: z.string(),
            mimeType: z.string().optional(),
            blob: z.string()
          })
        })
      ]))
    },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  async (args: z.infer<typeof ReadMediaFileArgsSchema>) => {
    const validPath = await validatePath(args.path);
    const extension = path.extname(validPath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".bmp": "image/bmp",
      ".svg": "image/svg+xml",
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".ogg": "audio/ogg",
      ".flac": "audio/flac",
    };
    const mimeType = mimeTypes[extension] || "application/octet-stream";
    const data = await readFileAsBase64Stream(validPath);

    const contentItem =
      mimeType.startsWith("image/")
        ? { type: "image" as const, data, mimeType }
        : mimeType.startsWith("audio/")
          ? { type: "audio" as const, data, mimeType }
          : {
              type: "resource" as const,
              resource: { uri: pathToFileURL(validPath).href, mimeType, blob: data }
            };
    return {
      content: [contentItem],
      structuredContent: { content: [contentItem] }
    };
  }
);

server.registerTool(
  "read_multiple_files",
  {
    title: "Read Multiple Files",
    description:
      "Read the contents of multiple files simultaneously. This is more " +
      "efficient than reading files one by one when you need to analyze " +
      "or compare multiple files. Each file's content is returned with its " +
      "path as a reference. Failed reads for individual files won't stop " +
      "the entire operation. Only works within allowed directories. Read-only directories are accessible.",
    inputSchema: {
      paths: z.array(z.string())
        .min(1)
        .describe("Array of file paths to read. Each path must be a string pointing to a valid file within allowed directories.")
    },
    outputSchema: { content: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  async (args: z.infer<typeof ReadMultipleFilesArgsSchema>) => {
    const results = await Promise.all(
      args.paths.map(async (filePath: string) => {
        try {
          const validPath = await validatePath(filePath);
          const content = await readFileContent(validPath);
          return `${filePath}:\n${content}\n`;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return `${filePath}: Error - ${errorMessage}`;
        }
      }),
    );
    const text = results.join("\n---\n");
    return {
      content: [{ type: "text" as const, text }],
      structuredContent: { content: text }
    };
  }
);

server.registerTool(
  "write_file",
  {
    title: "Write File",
    description:
      "Create a new file or completely overwrite an existing file with new content. " +
      "Use with caution as it will overwrite existing files without warning. " +
      "Handles text content with proper encoding. Only works within allowed directories. " +
      "Fails if the target directory is read-only.",
    inputSchema: {
      path: z.string(),
      content: z.string()
    },
    outputSchema: { content: z.string() },
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: false }
  },
  async (args: z.infer<typeof WriteFileArgsSchema>) => {
    const validPath = await validatePath(args.path);
    await writeFileContent(validPath, args.content);
    const text = `Successfully wrote to ${args.path}`;
    return {
      content: [{ type: "text" as const, text }],
      structuredContent: { content: text }
    };
  }
);

server.registerTool(
  "edit_file",
  {
    title: "Edit File",
    description:
      "Make line-based edits to a text file. Each edit replaces exact line sequences " +
      "with new content. Returns a git-style diff showing the changes made. " +
      "Only works within allowed directories. Fails if the target directory is read-only.",
    inputSchema: {
      path: z.string(),
      edits: z.array(z.object({
        oldText: z.string().describe("Text to search for - must match exactly"),
        newText: z.string().describe("Text to replace with")
      })),
      dryRun: z.boolean().default(false).describe("Preview changes using git-style diff format")
    },
    outputSchema: { content: z.string() },
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true, openWorldHint: false }
  },
  async (args: z.infer<typeof EditFileArgsSchema>) => {
    const validPath = await validatePath(args.path);
    const result = await applyFileEdits(validPath, args.edits, args.dryRun);
    return {
      content: [{ type: "text" as const, text: result }],
      structuredContent: { content: result }
    };
  }
);

server.registerTool(
  "create_directory",
  {
    title: "Create Directory",
    description:
      "Create a new directory or ensure a directory exists. Can create multiple " +
      "nested directories in one operation. If the directory already exists, " +
      "this operation will succeed silently. Perfect for setting up directory " +
      "structures for projects or ensuring required paths exist. Only works within allowed directories. " +
      "Fails if the target directory is read-only.",
    inputSchema: {
      path: z.string()
    },
    outputSchema: { content: z.string() },
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false }
  },
  async (args: z.infer<typeof CreateDirectoryArgsSchema>) => {
    const validPath = await validatePath(args.path);
    await fs.mkdir(validPath, { recursive: true });
    const text = `Successfully created directory ${args.path}`;
    return {
      content: [{ type: "text" as const, text }],
      structuredContent: { content: text }
    };
  }
);

server.registerTool(
  "list_directory",
  {
    title: "List Directory",
    description:
      "Get a detailed listing of all files and directories in a specified path. " +
      "Results clearly distinguish between files and directories with [FILE] and [DIR] " +
      "prefixes. This tool is essential for understanding directory structure and " +
      "finding specific files within a directory. Only works within allowed directories. Read-only directories are accessible.",
    inputSchema: {
      path: z.string()
    },
    outputSchema: { content: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  async (args: z.infer<typeof ListDirectoryArgsSchema>) => {
    const validPath = await validatePath(args.path);
    const entries = await fs.readdir(validPath, { withFileTypes: true });
    const formatted = entries
      .map((entry) => `${entry.isDirectory() ? "[DIR]" : "[FILE]"} ${entry.name}`)
      .join("\n");
    return {
      content: [{ type: "text" as const, text: formatted }],
      structuredContent: { content: formatted }
    };
  }
);

server.registerTool(
  "list_directory_with_sizes",
  {
    title: "List Directory with Sizes",
    description:
      "Get a detailed listing of all files and directories in a specified path, including sizes. " +
      "Results clearly distinguish between files and directories with [FILE] and [DIR] " +
      "prefixes. This tool is useful for understanding directory structure and " +
      "finding specific files within a directory. Only works within allowed directories. Read-only directories are accessible.",
    inputSchema: {
      path: z.string(),
      sortBy: z.enum(["name", "size"]).optional().default("name").describe("Sort entries by name or size")
    },
    outputSchema: { content: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  async (args: z.infer<typeof ListDirectoryWithSizesArgsSchema>) => {
    const validPath = await validatePath(args.path);
    const entries = await fs.readdir(validPath, { withFileTypes: true });

    // Get detailed information for each entry
    const detailedEntries = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(validPath, entry.name);
        try {
          const stats = await fs.stat(entryPath);
          return {
            name: entry.name,
            isDirectory: entry.isDirectory(),
            size: stats.size,
            mtime: stats.mtime
          };
        } catch (error) {
          return {
            name: entry.name,
            isDirectory: entry.isDirectory(),
            size: 0,
            mtime: new Date(0)
          };
        }
      })
    );

    // Sort entries based on sortBy parameter
    const sortedEntries = [...detailedEntries].sort((a, b) => {
      if (args.sortBy === 'size') {
        return b.size - a.size; // Descending by size
      }
      // Default sort by name
      return a.name.localeCompare(b.name);
    });

    // Format the output
    const formattedEntries = sortedEntries.map(entry =>
      `${entry.isDirectory ? "[DIR]" : "[FILE]"} ${entry.name.padEnd(30)} ${
        entry.isDirectory ? "" : formatSize(entry.size).padStart(10)
      }`
    );

    // Add summary
    const totalFiles = detailedEntries.filter(e => !e.isDirectory).length;
    const totalDirs = detailedEntries.filter(e => e.isDirectory).length;
    const totalSize = detailedEntries.reduce((sum, entry) => sum + (entry.isDirectory ? 0 : entry.size), 0);

    const summary = [
      "",
      `Total: ${totalFiles} files, ${totalDirs} directories`,
      `Combined size: ${formatSize(totalSize)}`
    ];

    const text = [...formattedEntries, ...summary].join("\n");
    const contentBlock = { type: "text" as const, text };
    return {
      content: [contentBlock],
      structuredContent: { content: text }
    };
  }
);

server.registerTool(
  "directory_tree",
  {
    title: "Directory Tree",
    description:
      "Get a recursive tree view of files and directories as a JSON structure. " +
      "Each entry includes 'name', 'type' (file/directory), and 'children' for directories. " +
      "Files have no children array, while directories always have a children array (which may be empty). " +
      "The output is formatted with 2-space indentation for readability. Only works within allowed directories. Read-only directories are accessible.",
    inputSchema: {
      path: z.string(),
      excludePatterns: z.array(z.string()).optional().default([])
    },
    outputSchema: { content: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  async (args: z.infer<typeof DirectoryTreeArgsSchema>) => {
    interface TreeEntry {
      name: string;
      type: 'file' | 'directory';
      children?: TreeEntry[];
    }
    const rootPath = args.path;

    async function buildTree(currentPath: string, excludePatterns: string[] = []): Promise<TreeEntry[]> {
      const validPath = await validatePath(currentPath);
      const entries = await fs.readdir(validPath, { withFileTypes: true });
      const result: TreeEntry[] = [];

      for (const entry of entries) {
        const relativePath = path.relative(rootPath, path.join(currentPath, entry.name));
        const shouldExclude = excludePatterns.some(pattern => {
          if (pattern.includes('*')) {
            return minimatch(relativePath, pattern, { dot: true });
          }
          // For files: match exact name or as part of path
          // For directories: match as directory path
          return minimatch(relativePath, pattern, { dot: true }) ||
            minimatch(relativePath, `**/${pattern}`, { dot: true }) ||
            minimatch(relativePath, `**/${pattern}/**`, { dot: true });
        });
        if (shouldExclude)
          continue;

        const entryData: TreeEntry = {
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file'
        };

        if (entry.isDirectory()) {
          const subPath = path.join(currentPath, entry.name);
          entryData.children = await buildTree(subPath, excludePatterns);
        }

        result.push(entryData);
      }

      return result;
    }

    const treeData = await buildTree(rootPath, args.excludePatterns);
    const text = JSON.stringify(treeData, null, 2);
    const contentBlock = { type: "text" as const, text };
    return {
      content: [contentBlock],
      structuredContent: { content: text }
    };
  }
);

server.registerTool(
  "move_file",
  {
    title: "Move File",
    description:
      "Move or rename files and directories. Can move files between directories " +
      "and rename them in a single operation. If the destination exists, the " +
      "operation will fail. Works across different directories and can be used " +
      "for simple renaming within the same directory. Both source and destination must be within allowed directories. " +
      "Fails if the source or destination directory is read-only.",
    inputSchema: {
      source: z.string(),
      destination: z.string()
    },
    outputSchema: { content: z.string() },
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true, openWorldHint: false }
  },
  async (args: z.infer<typeof MoveFileArgsSchema>) => {
    const validSourcePath = await validatePath(args.source);
    const validDestPath = await validatePath(args.destination);
    await fs.rename(validSourcePath, validDestPath);
    const text = `Successfully moved ${args.source} to ${args.destination}`;
    const contentBlock = { type: "text" as const, text };
    return {
      content: [contentBlock],
      structuredContent: { content: text }
    };
  }
);

server.registerTool(
  "search_files",
  {
    title: "Search Files",
    description:
      "Recursively search for files and directories matching a pattern. " +
      "The patterns should be glob-style patterns that match paths relative to the working directory. " +
      "Use pattern like '*.ext' to match files in current directory, and '**/*.ext' to match files in all subdirectories. " +
      "Returns full paths to all matching items. Great for finding files when you don't know their exact location. " +
      "Only searches within allowed directories. Read-only directories are accessible.",
    inputSchema: {
      path: z.string(),
      pattern: z.string(),
      excludePatterns: z.array(z.string()).optional().default([])
    },
    outputSchema: { content: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  async (args: z.infer<typeof SearchFilesArgsSchema>) => {
    const validPath = await validatePath(args.path);
    const results = await searchFilesWithValidation(validPath, args.pattern, getAllowedDirectories().map(d => d.hostPath), { excludePatterns: args.excludePatterns });
    const text = results.length > 0 ? results.join("\n") : "No matches found";
    return {
      content: [{ type: "text" as const, text }],
      structuredContent: { content: text }
    };
  }
);

server.registerTool(
  "get_file_info",
  {
    title: "Get File Info",
    description:
      "Retrieve detailed metadata about a file or directory. Returns comprehensive " +
      "information including size, creation time, last modified time, permissions, " +
      "and type. This tool is perfect for understanding file characteristics " +
      "without reading the actual content. Only works within allowed directories. Read-only directories are accessible.",
    inputSchema: {
      path: z.string()
    },
    outputSchema: { content: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  async (args: z.infer<typeof GetFileInfoArgsSchema>) => {
    const validPath = await validatePath(args.path);
    const info = await getFileStats(validPath);
    const text = Object.entries(info)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
    return {
      content: [{ type: "text" as const, text }],
      structuredContent: { content: text }
    };
  }
);

server.registerTool(
  "list_allowed_directories",
  {
    title: "List Allowed Directories",
    description:
      "Returns the list of directories that this server is allowed to access. " +
      "Each entry includes the MCP path (as seen by the client) and the access mode (readonly/readwrite). " +
      "Subdirectories within these allowed directories are also accessible. " +
      "Use this to understand which directories and their nested paths are available " +
      "before trying to access files. The client should not know about host paths.",
    inputSchema: {},
    outputSchema: { content: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  async () => {
    const dirs = getAllowedDirectories();
    const text = JSON.stringify(dirs.map(d => ({
      path: d.mcpPath,
      mode: d.readonly ? 'readonly' : 'readwrite'
    })), null, 2);
    return {
      content: [{ type: "text" as const, text }],
      structuredContent: { content: text }
    };
  }
);

// ============================================================================
// MCP Roots handling
// ============================================================================

async function updateAllowedDirectoriesFromRoots(requestedRoots: Root[]) {
  const validatedRootDirs = await getValidRootDirectories(requestedRoots);
  if (validatedRootDirs.length > 0) {
    // Convert to AllowedDir format (readwrite by default for roots)
    const newDirs: AllowedDir[] = validatedRootDirs.map(dir => ({
      hostPath: dir,
      mcpPath: normalizePath(dir).toLowerCase(),
      readonly: false,
    }));
    allowedDirs = newDirs;
    setAllowedDirectories(allowedDirs);
    console.error(`Updated allowed directories from MCP roots: ${validatedRootDirs.length} valid directories`);
  } else {
    console.error("No valid root directories provided by client");
  }
}

server.server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
  try {
    const response = await server.server.listRoots();
    if (response && 'roots' in response) {
      await updateAllowedDirectoriesFromRoots(response.roots);
    }
  } catch (error) {
    console.error("Failed to request roots from client:", error instanceof Error ? error.message : String(error));
  }
});

server.server.oninitialized = async () => {
  const clientCapabilities = server.server.getClientCapabilities();

  if (clientCapabilities?.roots) {
    try {
      const response = await server.server.listRoots();
      if (response && 'roots' in response) {
        await updateAllowedDirectoriesFromRoots(response.roots);
      } else {
        console.error("Client returned no roots set, keeping current settings");
      }
    } catch (error) {
      console.error("Failed to request initial roots from client:", error instanceof Error ? error.message : String(error));
    }
  } else {
    if (allowedDirs.length > 0) {
      console.error("Client does not support MCP Roots, using allowed directories set from server args:", allowedDirs.map(d => d.mcpPath));
    } else {
      throw new Error(`Server cannot operate: No allowed directories available. Server was started without command-line directories and client either does not support MCP roots protocol or provided empty roots. Please either: 1) Start server with directory arguments, or 2) Use a client that supports MCP roots protocol and provides valid root directories.`);
    }
  }
};

// ============================================================================
// Start server
// ============================================================================

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Secure MCP Filesystem Server running on stdio");
  if (allowedDirs.length === 0) {
    console.error("Started without allowed directories - waiting for client to provide roots via MCP protocol");
  }
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});