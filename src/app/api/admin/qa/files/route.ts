import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getAdminSession } from "@/lib/auth";
import { createQaFileRecord, deleteQaFileForUser, listQaFilesForUser } from "@/lib/qa/qa-files";
import { isSupportedTabularFile, parseTabularFileMeta } from "@/lib/qa/tabular-file";

export const runtime = "nodejs";

const MAX_TABULAR_SIZE = 20 * 1024 * 1024;
const STORAGE_ROOT = path.join(process.cwd(), "storage", "qa-files");
const MANIFEST_ROOT = path.join(STORAGE_ROOT, "manifest");

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

function normalizeFileName(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  const baseName = path.basename(fileName, ext).replace(/[^\w.-]/g, "-");
  const normalized = baseName.replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "file";
  return {
    ext: ext || ".xlsx",
    baseName: normalized,
  };
}

function buildStorageName(fileName: string) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const { ext, baseName } = normalizeFileName(fileName);
  return path.join(String(year), month, day, `${Date.now()}-${baseName}-${randomUUID().slice(0, 8)}${ext}`);
}

function toFilePayload(input: {
  id: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
  sheetMeta: unknown;
}) {
  return {
    id: input.id,
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    createdAt: input.createdAt.toISOString(),
    sheetMeta: input.sheetMeta,
  };
}

export async function GET(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parsedQuery = listQuerySchema.safeParse({
    limit: searchParams.get("limit") || undefined,
  });
  if (!parsedQuery.success) {
    return Response.json(
      { error: "Invalid request query.", details: parsedQuery.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const files = await listQaFilesForUser({
      userId: session.username,
      limit: parsedQuery.data.limit,
    });
    return Response.json({
      files: files.map((item) =>
        toFilePayload({
          id: item.id,
          fileName: item.fileName,
          mimeType: item.mimeType,
          sizeBytes: item.sizeBytes,
          createdAt: item.createdAt,
          sheetMeta: item.sheetMeta,
        }),
      ),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list files.";
    return Response.json({ error: message }, { status: 500 });
  }
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

  if (file.size <= 0) {
    return Response.json({ error: "File is empty." }, { status: 400 });
  }

  if (file.size > MAX_TABULAR_SIZE) {
    return Response.json(
      { error: `File is too large. Max size is ${Math.floor(MAX_TABULAR_SIZE / (1024 * 1024))}MB.` },
      { status: 400 },
    );
  }

  if (!isSupportedTabularFile({ fileName: file.name, mimeType: file.type })) {
    return Response.json(
      { error: "Unsupported file type. Please upload .xlsx, .xls or .csv." },
      { status: 400 },
    );
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const parsedMeta = parseTabularFileMeta(buffer, file.name);
    const relativeStoragePath = buildStorageName(file.name);
    const absoluteStoragePath = path.join(STORAGE_ROOT, relativeStoragePath);
    await mkdir(path.dirname(absoluteStoragePath), { recursive: true });
    await writeFile(absoluteStoragePath, buffer);

    const created = await createQaFileRecord({
      userId: session.username,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      storagePath: absoluteStoragePath,
      sheetMeta: parsedMeta,
    });

    await mkdir(MANIFEST_ROOT, { recursive: true });
    const manifestPath = path.join(MANIFEST_ROOT, `${created.id}.json`);
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          id: created.id,
          userId: created.userId,
          fileName: created.fileName,
          storagePath: created.storagePath,
          createdAt: created.createdAt.toISOString(),
          sheetMeta: created.sheetMeta,
        },
        null,
        2,
      ),
    );

    return Response.json({
      file: toFilePayload({
        id: created.id,
        fileName: created.fileName,
        mimeType: created.mimeType,
        sizeBytes: created.sizeBytes,
        createdAt: created.createdAt,
        sheetMeta: created.sheetMeta,
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}

const deleteQuerySchema = z.object({
  fileId: z.coerce.number().int().min(1),
});

export async function DELETE(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = deleteQuerySchema.safeParse({
    fileId: searchParams.get("fileId") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request. Provide fileId as query parameter." },
      { status: 400 },
    );
  }

  try {
    const result = await deleteQaFileForUser({
      userId: session.username,
      fileId: parsed.data.fileId,
    });
    if (!result) {
      return Response.json({ error: "File not found or already deleted." }, { status: 404 });
    }

    try {
      await unlink(result.storagePath);
    } catch {
      // ignore if file already missing on disk
    }
    const manifestPath = path.join(MANIFEST_ROOT, `${result.id}.json`);
    try {
      await unlink(manifestPath);
    } catch {
      // ignore if manifest missing
    }

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delete failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
