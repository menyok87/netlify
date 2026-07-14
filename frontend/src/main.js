import "./style.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

const TOKEN_STORAGE_KEY = "netlifyAccessToken";

const app = document.querySelector("#app");

app.innerHTML = `
  <main class="container">
    <h1>Post Manager</h1>

    <h2>Netlify Settings</h2>
    <form id="token-form">
      <label>
        Netlify Personal Access Token
        <input type="password" name="token" placeholder="Paste your Netlify personal access token" autocomplete="off" />
      </label>
      <div class="actions">
        <button type="submit">Save token</button>
        <button type="button" id="clear-token">Clear</button>
      </div>
      <p class="hint">Stored only in this browser (localStorage), never sent to the backend.</p>
      <p id="token-status" class="status" hidden></p>
    </form>

    <h2>New Post</h2>
    <form id="post-form">
      <label>
        Title
        <input type="text" name="title" required placeholder="Post title" />
      </label>
      <label>
        Description
        <textarea name="description" rows="4" placeholder="Post description"></textarea>
      </label>
      <label>
        Image URL
        <input type="url" name="imageUrl" placeholder="https://example.com/image.jpg" />
      </label>
      <label>
        Original URL
        <input type="url" name="originalUrl" placeholder="https://example.com/source" />
      </label>
      <button type="submit">Submit</button>
      <p id="form-error" class="error" hidden></p>
    </form>

    <h2>Posts</h2>
    <div id="items"></div>
  </main>
`;

const tokenForm = document.querySelector("#token-form");
const tokenInput = tokenForm.querySelector('input[name="token"]');
const tokenStatus = document.querySelector("#token-status");
const clearTokenButton = document.querySelector("#clear-token");

const storedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
if (storedToken) tokenInput.value = storedToken;

tokenForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const token = tokenInput.value.trim();

  if (!token) {
    showTokenStatus("Enter a token before saving.");
    return;
  }

  localStorage.setItem(TOKEN_STORAGE_KEY, token);
  showTokenStatus("Token saved.");
});

clearTokenButton.addEventListener("click", () => {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  tokenInput.value = "";
  showTokenStatus("Token cleared.");
});

function showTokenStatus(message) {
  tokenStatus.textContent = message;
  tokenStatus.hidden = false;
}

const form = document.querySelector("#post-form");
const errorEl = document.querySelector("#form-error");
const itemsEl = document.querySelector("#items");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.hidden = true;

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  try {
    const response = await fetch(`${API_URL}/api/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Failed to submit");
    }

    form.reset();
    await loadItems();
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.hidden = false;
  }
});

itemsEl.addEventListener("click", async (event) => {
  if (!event.target.matches(".delete")) return;
  const id = event.target.dataset.id;
  await fetch(`${API_URL}/api/items/${id}`, { method: "DELETE" });
  await loadItems();
});

async function loadItems() {
  const response = await fetch(`${API_URL}/api/items`);
  const items = await response.json();

  itemsEl.innerHTML = items.map(renderItem).join("");
}

function renderItem(item) {
  return `
    <article class="card">
      ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title)}" />` : ""}
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.description)}</p>
      ${item.originalUrl ? `<a href="${escapeHtml(item.originalUrl)}" target="_blank" rel="noopener noreferrer">View original</a>` : ""}
      <div><button data-id="${item.id}" class="delete">Delete</button></div>
    </article>
  `;
}

function escapeHtml(value = "") {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

loadItems();
