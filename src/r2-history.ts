import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { config } from "./config";

function client(): S3Client | null {
  const endpoint = process.env.R2_S3_ENDPOINT?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  return new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export async function readR2Object(key: string): Promise<Uint8Array | null> {
  const bucket = config.historyR2Bucket;
  if (!bucket) return null;
  const c = client();
  if (!c) return null;
  try {
    const res = await c.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = res.Body;
    if (!body) return null;
    return new Uint8Array(await body.transformToByteArray());
  } catch (e) {
    console.warn(`r2 read ${key}: ${(e as Error).message.slice(0, 120)}`);
    return null;
  }
}

export async function writeR2Object(key: string, bytes: Uint8Array, contentType: string) {
  const bucket = config.historyR2Bucket;
  if (!bucket) return false;
  const c = client();
  if (!c) return false;
  try {
    await c.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
    }));
    return true;
  } catch (e) {
    console.warn(`r2 write ${key}: ${(e as Error).message.slice(0, 120)}`);
    return false;
  }
}

/** Persist merged on-disk history bundle for restart survival (does not touch mig archive). */
export async function persistHistoryBundle(key: string, json: string) {
  const bytes = new TextEncoder().encode(json);
  return writeR2Object(key, bytes, "application/json");
}

export async function loadHistoryBundle(key: string): Promise<string | null> {
  const raw = await readR2Object(key);
  if (!raw) return null;
  return new TextDecoder().decode(raw);
}
