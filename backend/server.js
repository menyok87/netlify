import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = resolve(__dirname, "data", "items.json");

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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
