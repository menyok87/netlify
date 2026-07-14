import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ZipArchive } from "archiver";
import cors from "cors";
import express from "express";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = resolve(__dirname, "data", "items.json");
const TEMPLATE_FILE = resolve(__dirname, "templates", "item.html");
const NETLIFY_API = "https://api.netlify.com/api/v1";

async function ensureDataFile() {
  if (!existsSync(dirname(DATA_FILE))) {
    await mkdir(dirname(DATA_FILE), { recursive: true });
  }
  if (!existsSync(DATA_FILE)) {
    await writeFile(DATA_FILE, "[]");
  }
}

// In-memory cache backed by the JSON file: reads are served straight from
// memory (no disk I/O per request), and writes go through writeLock so
// concurrent requests can't race and clobber each other's changes.
let itemsCache = null;
let loadingPromise = null;
let writeLock = Promise.resolve();

async function getItems() {
  if (itemsCache) return itemsCache;

  if (!loadingPromise) {
    loadingPromise = (async () => {
      await ensureDataFile();
      const raw = await readFile(DATA_FILE, "utf-8");
      itemsCache = JSON.parse(raw);
    })();
  }

  await loadingPromise;
  return itemsCache;
}

function withWriteLock(task) {
  const run = writeLock.then(task, task);
  writeLock = run.then(
    () => {},
    () => {}
  );
  return run;
}

async function persistItems() {
  await writeFile(DATA_FILE, JSON.stringify(itemsCache, null, 2));
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

function formatDate(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

async function renderItemHtml(item) {
  const template = await readFile(TEMPLATE_FILE, "utf-8");

  const imageTag = item.imageUrl
    ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title)}" />`
    : "";
  const ctaBlock = item.originalUrl
    ? `<a class="cta" href="${escapeHtml(item.originalUrl)}" target="_blank" rel="noopener noreferrer">Visit original &#8599;</a>`
    : "";

  return template
    .replaceAll("{{title}}", escapeHtml(item.title))
    .replaceAll("{{description}}", escapeHtml(item.description))
    .replaceAll("{{imageTag}}", imageTag)
    .replaceAll("{{heroClass}}", item.imageUrl ? "" : " no-image")
    .replaceAll("{{ctaBlock}}", ctaBlock)
    .replaceAll("{{publishedDate}}", escapeHtml(formatDate(item.createdAt)));
}

function zipFile(filename, content) {
  return new Promise((resolvePromise, reject) => {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks = [];
    const stream = new PassThrough();

    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolvePromise(Buffer.concat(chunks)));
    archive.on("error", reject);

    archive.pipe(stream);
    archive.append(content, { name: filename });
    archive.finalize();
  });
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get(
  "/api/items",
  asyncHandler(async (req, res) => {
    const items = await getItems();
    res.json(items);
  })
);

app.post(
  "/api/items",
  asyncHandler(async (req, res) => {
    const { title, description = "", imageUrl = "", originalUrl = "" } = req.body ?? {};

    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: "title is required" });
    }

    const item = {
      id: randomUUID(),
      title: String(title).trim(),
      description: String(description).trim(),
      imageUrl: String(imageUrl).trim(),
      originalUrl: String(originalUrl).trim(),
      createdAt: new Date().toISOString(),
    };

    await withWriteLock(async () => {
      const items = await getItems();
      items.unshift(item);
      await persistItems();
    });

    res.status(201).json(item);
  })
);

app.delete(
  "/api/items/:id",
  asyncHandler(async (req, res) => {
    let found = false;

    await withWriteLock(async () => {
      const items = await getItems();
      const index = items.findIndex((entry) => entry.id === req.params.id);
      if (index === -1) return;
      found = true;
      items.splice(index, 1);
      await persistItems();
    });

    if (!found) {
      return res.status(404).json({ error: "item not found" });
    }

    res.status(204).end();
  })
);

app.post(
  "/api/items/:id/deploy",
  asyncHandler(async (req, res) => {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    if (!token) {
      return res.status(401).json({ error: "Missing Netlify access token" });
    }

    const items = await getItems();
    const item = items.find((entry) => entry.id === req.params.id);

    if (!item) {
      return res.status(404).json({ error: "item not found" });
    }

    try {
      const html = await renderItemHtml(item);
      const zipBuffer = await zipFile("index.html", html);
      const siteName = `${slugify(item.title) || "item"}-${item.id.slice(0, 8)}`;

      const createResponse = await fetch(`${NETLIFY_API}/sites`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: siteName }),
      });

      if (!createResponse.ok) {
        throw new Error(`Failed to create Netlify site (${createResponse.status}): ${await createResponse.text()}`);
      }

      const site = await createResponse.json();

      const deployResponse = await fetch(`${NETLIFY_API}/sites/${site.id}/deploys`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/zip",
        },
        body: zipBuffer,
      });

      if (!deployResponse.ok) {
        throw new Error(`Failed to deploy to Netlify (${deployResponse.status}): ${await deployResponse.text()}`);
      }

      const updatedItem = {
        ...item,
        deployUrl: site.ssl_url || site.url,
        adminUrl: site.admin_url,
        deployedAt: new Date().toISOString(),
      };

      await withWriteLock(async () => {
        const currentItems = await getItems();
        const index = currentItems.findIndex((entry) => entry.id === item.id);
        if (index !== -1) currentItems[index] = updatedItem;
        await persistItems();
      });

      res.json(updatedItem);
    } catch (error) {
      res.status(502).json({ error: error.message });
    }
  })
);

// Safety net: never let an unexpected error take the whole process down.
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
