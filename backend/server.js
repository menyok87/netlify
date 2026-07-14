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

async function readItems() {
  await ensureDataFile();
  const raw = await readFile(DATA_FILE, "utf-8");
  return JSON.parse(raw);
}

async function writeItems(items) {
  await writeFile(DATA_FILE, JSON.stringify(items, null, 2));
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

async function renderItemHtml(item) {
  const template = await readFile(TEMPLATE_FILE, "utf-8");

  const imageBlock = item.imageUrl
    ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title)}" />`
    : "";
  const originalBlock = item.originalUrl
    ? `<a class="original" href="${escapeHtml(item.originalUrl)}" target="_blank" rel="noopener noreferrer">View original</a>`
    : "";

  return template
    .replaceAll("{{title}}", escapeHtml(item.title))
    .replaceAll("{{description}}", escapeHtml(item.description))
    .replaceAll("{{imageBlock}}", imageBlock)
    .replaceAll("{{originalBlock}}", originalBlock);
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

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/items", async (req, res) => {
  const items = await readItems();
  res.json(items);
});

app.post("/api/items", async (req, res) => {
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

  const items = await readItems();
  items.unshift(item);
  await writeItems(items);

  res.status(201).json(item);
});

app.delete("/api/items/:id", async (req, res) => {
  const items = await readItems();
  const next = items.filter((item) => item.id !== req.params.id);

  if (next.length === items.length) {
    return res.status(404).json({ error: "item not found" });
  }

  await writeItems(next);
  res.status(204).end();
});

app.post("/api/items/:id/deploy", async (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!token) {
    return res.status(401).json({ error: "Missing Netlify access token" });
  }

  const items = await readItems();
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

    const nextItems = items.map((entry) => (entry.id === item.id ? updatedItem : entry));
    await writeItems(nextItems);

    res.json(updatedItem);
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
