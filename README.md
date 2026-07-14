# netlify

Automatic new project upload — scaffold a [Vite](https://vitejs.dev) project, build it, and deploy it to [Netlify](https://netlify.com) as a brand new site, all in one Node.js command.

## Setup

```bash
npm install
cp .env.example .env
```

Create a Netlify Personal Access Token at https://app.netlify.com/user/applications#personal-access-tokens and put it in `.env`:

```
NETLIFY_AUTH_TOKEN=your-token-here
```

## Usage

### Scaffold a new Vite project and deploy it

```bash
npm run deploy -- --name my-app --template react
```

This will:
1. Run `npm create vite@latest my-app -- --template react` to scaffold a new project
2. `npm install` and `npm run build` inside it
3. Create a new Netlify site named `my-app`
4. Deploy the `dist` folder to that site as a production deploy

Available `--template` values match Vite's own templates: `vanilla`, `vanilla-ts`, `vue`, `vue-ts`, `react`, `react-ts`, `preact`, `preact-ts`, `lit`, `lit-ts`, `svelte`, `svelte-ts`, `solid`, `solid-ts`, `qwik`, `qwik-ts`.

### Deploy an existing project

```bash
npm run deploy -- --path ./my-existing-app --name my-existing-app
```

Skips scaffolding and builds/deploys whatever is already in that folder.

### Options

| Flag | Description | Default |
| --- | --- | --- |
| `-n, --name <name>` | Project & Netlify site name | — |
| `-t, --template <template>` | Vite template to scaffold | `vanilla` |
| `-p, --path <path>` | Deploy an existing project instead of scaffolding | — |
| `--account-slug <slug>` | Netlify team/account slug | your default account |
| `--dir <dir>` | Build output directory to deploy | `dist` |
| `--no-prod` | Create a draft deploy instead of a production deploy | production |

## How it works

`scripts/deploy.js` is a small Node.js CLI built on top of the official [`netlify-cli`](https://www.npmjs.com/package/netlify-cli):

1. `npm create vite@latest` — scaffolds the project non-interactively
2. `npm install` / `npm run build` — installs deps and builds
3. `netlify sites:create --json` — creates a fresh Netlify site
4. `netlify deploy --dir=dist --prod --json` — uploads the build output

Each run creates a new, independent Netlify site — useful for spinning up demo/preview projects automatically.

## Sample app: `frontend/` + `backend/`

A small full-stack example lives alongside the CLI: a form to submit a post (title, description, image URL, original URL) backed by a REST API.

### Backend (`backend/`)

Express API storing submissions in `backend/data/items.json`.

```bash
cd backend
npm install
npm run dev   # http://localhost:3001
```

Endpoints:
- `GET /api/items` — list all submitted posts
- `POST /api/items` — create a post, body: `{ title, description, imageUrl, originalUrl }` (`title` required)
- `DELETE /api/items/:id` — remove a post
- `POST /api/items/:id/deploy` — render `backend/templates/item.html` with that post's data, zip it, and publish it as a brand new Netlify site via the Netlify API. Requires header `Authorization: Bearer <netlify-personal-access-token>`. Persists `deployUrl`/`adminUrl` back onto the item.

### Frontend (`frontend/`)

Vanilla JS + Vite form for `title`, `description`, `url image`, `url original`, with a live list of submitted posts below it.

```bash
cd frontend
npm install
cp .env.example .env   # VITE_API_URL, defaults to http://localhost:3001
npm run dev             # http://localhost:5173
```

Run the backend first, then the frontend, and submit the form — new posts appear instantly below it.

Each post has a **Deploy to Netlify** button: it reads the token you saved in the Netlify Settings section and calls `POST /api/items/:id/deploy`, which publishes a standalone page (`backend/templates/item.html`, filled in with that post's title/description/image/original link) as a new Netlify site and shows the live URL under the post.

Once you're happy with `frontend/` itself, you can also deploy the whole app with the CLI above:

```bash
npm run deploy -- --path ./frontend --name my-posts-app
```

## Continuous deployment from GitHub

`.github/workflows/deploy-netlify.yml` builds `frontend/` and deploys it to Netlify automatically on every push to `master` that touches `frontend/` (also runnable manually via "Run workflow").

One-time setup:

1. Create the Netlify site once, e.g. locally:
   ```bash
   npm run deploy -- --path ./frontend --name my-posts-app
   ```
   Note the site ID printed (or find it later under Site settings → General → Site details → Site ID).
2. Create a Netlify Personal Access Token: https://app.netlify.com/user/applications#personal-access-tokens
3. In the GitHub repo, go to **Settings → Secrets and variables → Actions → New repository secret** and add:
   - `NETLIFY_AUTH_TOKEN` — the token from step 2
   - `NETLIFY_SITE_ID` — the site ID from step 1

After that, every push to `master` touching `frontend/` redeploys the site automatically — no local Netlify CLI needed.
