import "./style.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

const app = document.querySelector("#app");

app.innerHTML = `
  <main class="container">
    <h1>New Post</h1>
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
