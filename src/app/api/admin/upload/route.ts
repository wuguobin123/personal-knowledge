import OSS from "ali-oss";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { getAdminSession } from "@/lib/auth";

export const runtime = "nodejs";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function normalizeFilename(name: string) {
  const ext = path.extname(name).toLowerCase();
  const base = path.basename(name, ext).toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const safeBase = base.replace(/-+/g, "-").replace(/^-|-$/g, "") || "image";
  return { safeBase, ext: ext || ".png" };
}

function buildObjectKey(fileName: string) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const { safeBase, ext } = normalizeFilename(fileName);
  return `uploads/${year}/${month}/${Date.now()}-${safeBase}-${randomUUID().slice(0, 8)}${ext}`;
}

async function uploadToLocal(objectKey: string, buffer: Buffer) {
  const absolutePath = path.join(process.cwd(), "public", objectKey);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, buffer);
  return `/${objectKey}`;
}

async function uploadToOss(objectKey: string, buffer: Buffer, contentType: string) {
  const region = process.env.OSS_REGION;
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;
  const bucket = process.env.OSS_BUCKET;

  if (!region || !accessKeyId || !accessKeySecret || !bucket) {
    throw new Error(
      "OSS config missing. Required: OSS_REGION, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_BUCKET.",
    );
  }

  const client = new OSS({
    region,
    accessKeyId,
    accessKeySecret,
    bucket,
  });

  const result = await client.put(objectKey, buffer, {
    headers: {
      "Content-Type": contentType,
    },
  });

  const customDomain = String(process.env.OSS_PUBLIC_URL || "").trim().replace(/\/$/, "");
  if (customDomain) {
    return `${customDomain}/${objectKey}`;
  }
  if (result.url) {
    return result.url;
  }
  return `https://${bucket}.${region}.aliyuncs.com/${objectKey}`;
}

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return Response.json({ error: "No file uploaded." }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return Response.json(
      { error: "Unsupported file type. Use png/jpeg/webp/gif." },
      { status: 400 },
    );
  }

  if (file.size > MAX_IMAGE_SIZE) {
    return Response.json({ error: "Image too large. Max size is 5MB." }, { status: 400 });
  }

  const objectKey = buildObjectKey(file.name);
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  try {
    const provider = (process.env.STORAGE_PROVIDER || "local").toLowerCase();
    const url =
      provider === "oss"
        ? await uploadToOss(objectKey, buffer, file.type)
        : await uploadToLocal(objectKey, buffer);

    return Response.json({ url, provider, objectKey });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
