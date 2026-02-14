module.exports = [
"[externals]/next/dist/compiled/next-server/app-route-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-route-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/@opentelemetry/api [external] (next/dist/compiled/@opentelemetry/api, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/@opentelemetry/api", () => require("next/dist/compiled/@opentelemetry/api"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[project]/src/lib/auth.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "ADMIN_SESSION_COOKIE",
    ()=>ADMIN_SESSION_COOKIE,
    "createAdminSessionToken",
    ()=>createAdminSessionToken,
    "getAdminSession",
    ()=>getAdminSession,
    "verifyAdminSessionToken",
    ()=>verifyAdminSessionToken
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$jose$2f$dist$2f$webapi$2f$jwt$2f$verify$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/jose/dist/webapi/jwt/verify.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$jose$2f$dist$2f$webapi$2f$jwt$2f$sign$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/jose/dist/webapi/jwt/sign.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$headers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/headers.js [app-route] (ecmascript)");
;
;
const ADMIN_SESSION_COOKIE = "admin_session";
function getAuthSecret() {
    const secret = process.env.AUTH_SECRET;
    if (!secret || secret.length < 16) {
        throw new Error("AUTH_SECRET is not set or too short.");
    }
    return new TextEncoder().encode(secret);
}
async function createAdminSessionToken(username) {
    return new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$jose$2f$dist$2f$webapi$2f$jwt$2f$sign$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["SignJWT"]({
        role: "admin"
    }).setProtectedHeader({
        alg: "HS256"
    }).setSubject(username).setIssuedAt().setExpirationTime("7d").sign(getAuthSecret());
}
async function verifyAdminSessionToken(token) {
    try {
        const { payload } = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$jose$2f$dist$2f$webapi$2f$jwt$2f$verify$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["jwtVerify"])(token, getAuthSecret());
        if (payload.role !== "admin" || typeof payload.sub !== "string") {
            return null;
        }
        return {
            username: payload.sub
        };
    } catch  {
        return null;
    }
}
async function getAdminSession() {
    const cookieStore = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$headers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["cookies"])();
    const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
    if (!token) {
        return null;
    }
    return verifyAdminSessionToken(token);
}
}),
"[project]/src/lib/prisma.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "prisma",
    ()=>prisma
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__ = __turbopack_context__.i("[externals]/@prisma/client [external] (@prisma/client, cjs, [project]/node_modules/@prisma/client)");
;
const globalForPrisma = globalThis;
const prisma = globalForPrisma.prisma ?? new __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__["PrismaClient"]();
if ("TURBOPACK compile-time truthy", 1) {
    globalForPrisma.prisma = prisma;
}
}),
"[project]/src/app/api/articles/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "GET",
    ()=>GET,
    "POST",
    ()=>POST
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__ = __turbopack_context__.i("[externals]/@prisma/client [external] (@prisma/client, cjs, [project]/node_modules/@prisma/client)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$auth$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/auth.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$prisma$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/prisma.ts [app-route] (ecmascript)");
;
;
;
function toSlug(input) {
    return input.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
const sourceTypeSet = new Set([
    "ORIGINAL",
    "CRAWLER",
    "TRANSCRIPT"
]);
function normalizeCategory(input) {
    const category = String(input ?? "").trim();
    return (category || "未分类").slice(0, 80);
}
function normalizeTags(input) {
    const raw = Array.isArray(input) ? input : typeof input === "string" ? input.split(/[,，\n]/g) : [];
    const tags = new Set();
    for (const item of raw){
        const tag = String(item ?? "").trim().slice(0, 40);
        if (tag) {
            tags.add(tag);
        }
    }
    return Array.from(tags).slice(0, 12);
}
function normalizeSourceType(input) {
    const sourceType = String(input ?? "").trim().toUpperCase();
    return sourceTypeSet.has(sourceType) ? sourceType : "ORIGINAL";
}
function normalizeSourceDetail(input) {
    const detail = String(input ?? "").trim().slice(0, 500);
    return detail || null;
}
function jsonToTags(tags) {
    if (!Array.isArray(tags)) {
        return [];
    }
    return tags.filter((tag)=>typeof tag === "string").map((tag)=>tag.trim()).filter(Boolean);
}
async function GET() {
    const articles = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$prisma$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["prisma"].article.findMany({
        where: {
            published: true
        },
        orderBy: {
            publishedAt: "desc"
        },
        select: {
            id: true,
            title: true,
            slug: true,
            category: true,
            tags: true,
            sourceType: true,
            sourceDetail: true,
            excerpt: true,
            publishedAt: true
        }
    });
    return Response.json(articles.map((article)=>({
            ...article,
            tags: jsonToTags(article.tags)
        })));
}
async function POST(request) {
    const session = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$auth$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["getAdminSession"])();
    if (!session) {
        return Response.json({
            error: "Unauthorized."
        }, {
            status: 401
        });
    }
    const payload = await request.json();
    const title = String(payload.title || "").trim();
    const excerpt = String(payload.excerpt || "").trim();
    const content = String(payload.content || "").trim();
    const published = payload.published !== false;
    const customSlug = String(payload.slug || "").trim();
    const category = normalizeCategory(payload.category);
    const tags = normalizeTags(payload.tags);
    const sourceType = normalizeSourceType(payload.sourceType);
    const sourceDetail = normalizeSourceDetail(payload.sourceDetail);
    const normalizedSlug = customSlug ? toSlug(customSlug) : toSlug(title);
    const slug = normalizedSlug || `article-${Date.now()}`;
    if (!title || !excerpt || !content) {
        return Response.json({
            error: "title/excerpt/content are required."
        }, {
            status: 400
        });
    }
    try {
        const article = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$prisma$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["prisma"].article.create({
            data: {
                title,
                slug,
                category,
                tags: tags.length > 0 ? tags : null,
                sourceType,
                sourceDetail,
                excerpt,
                content,
                published
            },
            select: {
                id: true,
                title: true,
                slug: true,
                category: true,
                tags: true,
                sourceType: true,
                sourceDetail: true
            }
        });
        return Response.json({
            ...article,
            tags: jsonToTags(article.tags)
        }, {
            status: 201
        });
    } catch (error) {
        if (error instanceof __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__["Prisma"].PrismaClientKnownRequestError && error.code === "P2002") {
            return Response.json({
                error: `slug "${slug}" already exists.`
            }, {
                status: 409
            });
        }
        return Response.json({
            error: "Failed to create article."
        }, {
            status: 500
        });
    }
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__656fc3ed._.js.map