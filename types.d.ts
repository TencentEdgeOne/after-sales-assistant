// Type declarations for external packages that are dynamically loaded or injected at deploy time.
// Note: mammoth / xlsx / jszip / unpdf 都自带类型声明，无需在此重复声明；
// pdf-parse 已替换为 unpdf；这里只保留平台运行时注入的 @edgeone/pages-blob。

declare module "@edgeone/pages-blob" {
  interface BlobStore {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
    list(options?: { prefix?: string }): Promise<{ blobs: Array<{ key: string }> }>;
  }

  interface GetStoreOptions {
    name: string;
    projectId?: string;
    token?: string;
  }

  export function getStore(nameOrOptions: string | GetStoreOptions): BlobStore;
}
