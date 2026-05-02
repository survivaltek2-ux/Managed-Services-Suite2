import { Storage, File } from "@google-cloud/storage";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

// Object storage client.
//
// On Replit, an in-process token broker ("sidecar") at 127.0.0.1:1106 vends
// short-lived GCS credentials. When this app runs OUTSIDE Replit we use
// standard Google Application Default Credentials (ADC):
//   - Set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON file path,
//   - or run on a GCP VM / GKE / Cloud Run with an attached service account,
//   - or `gcloud auth application-default login` for local dev.
//
// Set USE_REPLIT_OBJECT_STORAGE_SIDECAR=true to force the sidecar path even
// when REPL_ID is unset (rarely needed).
const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

const useReplitSidecar =
  process.env.USE_REPLIT_OBJECT_STORAGE_SIDECAR === "true" ||
  (process.env.REPL_ID !== undefined &&
    process.env.USE_REPLIT_OBJECT_STORAGE_SIDECAR !== "false");

export const objectStorageClient = useReplitSidecar
  ? new Storage({
      credentials: {
        audience: "replit",
        subject_token_type: "access_token",
        token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
        type: "external_account",
        credential_source: {
          url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
          format: {
            type: "json",
            subject_token_field_name: "access_token",
          },
        },
        universe_domain: "googleapis.com",
      },
      projectId: "",
    })
  : new Storage({
      // Use Application Default Credentials. The library will pick up
      // GOOGLE_APPLICATION_CREDENTIALS, GCE/GKE metadata, or a workload
      // identity automatically. Project ID can be inferred from the creds
      // file but can also be set explicitly via GOOGLE_CLOUD_PROJECT.
      projectId: process.env.GOOGLE_CLOUD_PROJECT || undefined,
    });

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadObject(file: File, cacheTtlSec: number = 3600): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === "public";

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": (metadata.contentType as string) || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers["Content-Length"] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async uploadBuffer(
    buffer: Buffer,
    _filename: string,
    contentType: string
  ): Promise<string> {
    const privateDir = this.getPrivateObjectDir();
    const objectId = randomUUID();
    const fullPath = `${privateDir}/uploads/${objectId}`;
    const normalized = fullPath.startsWith("/") ? fullPath : `/${fullPath}`;
    const parts = normalized.split("/");
    const bucketName = parts[1];
    const objectName = parts.slice(2).join("/");
    const bucket = objectStorageClient.bucket(bucketName);
    const gcsFile = bucket.file(objectName);
    await gcsFile.save(buffer, { contentType, resumable: false });
    return `/objects/uploads/${objectId}`;
  }

  async downloadBuffer(objectPath: string): Promise<Buffer> {
    const file = await this.getObjectEntityFile(objectPath);
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = file.createReadStream();
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  // On Replit, the sidecar can mint signed URLs without a service-account key.
  if (useReplitSidecar) {
    const request = {
      bucket_name: bucketName,
      object_name: objectName,
      method,
      expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
    };
    const response = await fetch(
      `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(30_000),
      }
    );
    if (!response.ok) {
      throw new Error(
        `Replit sidecar failed to sign object URL (status ${response.status})`
      );
    }
    const { signed_url: signedURL } = await response.json() as any;
    return signedURL;
  }

  // Off Replit: use the standard Google Cloud Storage V4 signing flow.
  // This requires Application Default Credentials with a service account
  // key (GOOGLE_APPLICATION_CREDENTIALS) — workload-identity creds without
  // a private key cannot sign URLs. If signing fails for that reason,
  // provide a service-account JSON key.
  const file = objectStorageClient.bucket(bucketName).file(objectName);
  const [signedUrl] = await file.getSignedUrl({
    version: "v4",
    action:
      method === "PUT"
        ? "write"
        : method === "DELETE"
          ? "delete"
          : "read",
    expires: Date.now() + ttlSec * 1000,
  });
  return signedUrl;
}
