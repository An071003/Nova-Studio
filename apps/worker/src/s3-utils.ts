import { S3Client } from '@aws-sdk/client-s3';

export interface S3ConnectionOptions {
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3AccessKey: string;
  s3SecretKey: string;
  s3ForcePathStyle: boolean;
}

/** Instantiates an S3 client configured for MinIO/S3 worker access. */
export function createWorkerS3Client(options: S3ConnectionOptions): S3Client {
  return new S3Client({
    endpoint: options.s3Endpoint,
    region: options.s3Region,
    forcePathStyle: options.s3ForcePathStyle,
    credentials: {
      accessKeyId: options.s3AccessKey,
      secretAccessKey: options.s3SecretKey,
    },
  });
}

/** Reads an AWS SDK S3 response Body stream/buffer into a Node Buffer. */
export async function readS3BodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) {
    throw new Error('Empty S3 response body');
  }
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }
  if (
    typeof body === 'object' &&
    body !== null &&
    'transformToByteArray' in body &&
    typeof (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray ===
      'function'
  ) {
    const arr = await (
      body as { transformToByteArray: () => Promise<Uint8Array> }
    ).transformToByteArray();
    return Buffer.from(arr);
  }
  throw new Error('Unsupported S3 body stream type');
}
