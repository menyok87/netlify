#!/usr/bin/env node
import { existsSync } from "node:fs";
import { basename, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { execa } from "execa";
import "dotenv/config";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const program = new Command()
  .name("netlify-auto-upload")
  .description(
    "Scaffold a Vite project (or use an existing one), build it, and automatically upload it to Netlify as a new site"
  )
  .option("-n, --name <name>", "project and Netlify site name")
  .option("-t, --template <template>", "Vite template to scaffold", "vanilla")
  .option("-p, --path <path>", "deploy an existing project instead of scaffolding a new one")
  .option("--account-slug <slug>", "Netlify team/account slug")
  .option("--dir <dir>", "build output directory", "dist")
  .option("--no-prod", "create a draft deploy instead of a production deploy")
  .parse(process.argv);

const options = program.opts();

function run(command, args, opts = {}) {
  return execa(command, args, {
    stdio: "inherit",
    preferLocal: true,
    localDir: REPO_ROOT,
    ...opts,
  });
}

function runJson(command, args, opts = {}) {
  return execa(command, args, {
    preferLocal: true,
    localDir: REPO_ROOT,
    ...opts,
  });
}

async function main() {
  if (!process.env.NETLIFY_AUTH_TOKEN) {
    console.error(
      "Missing NETLIFY_AUTH_TOKEN.\n" +
        "Create a Personal Access Token at https://app.netlify.com/user/applications#personal-access-tokens\n" +
        "then set it via `export NETLIFY_AUTH_TOKEN=...` or a .env file (see .env.example)."
    );
    process.exit(1);
  }

  if (!options.path && !options.name) {
    console.error("You must provide --name <name> or --path <existing-project-path>.");
    process.exit(1);
  }

  const netlifyEnv = { ...process.env };

  let projectDir;
  let projectName;

  if (options.path) {
    projectDir = resolve(process.cwd(), options.path);
    projectName = options.name || basename(projectDir);
    if (!existsSync(projectDir)) {
      console.error(`Path not found: ${projectDir}`);
      process.exit(1);
    }
  } else {
    projectName = options.name;
    projectDir = resolve(process.cwd(), projectName);

    if (existsSync(projectDir)) {
      console.log(`Directory "${projectName}" already exists, skipping scaffold step.`);
    } else {
      console.log(`Scaffolding new Vite project "${projectName}" (template: ${options.template})...`);
      await run("npm", [
        "create",
        "vite@latest",
        projectName,
        "--",
        "--template",
        options.template,
        "--yes",
      ]);
    }
  }

  console.log("Installing dependencies...");
  await run("npm", ["install"], { cwd: projectDir });

  console.log("Building project...");
  await run("npm", ["run", "build"], { cwd: projectDir });

  const buildDir = resolve(projectDir, options.dir);
  if (!existsSync(buildDir)) {
    console.error(`Build output directory not found: ${buildDir}`);
    process.exit(1);
  }

  console.log(`Creating new Netlify site "${projectName}"...`);
  const createArgs = [
    "sites:create",
    "--name",
    projectName,
    "--disable-linking",
    "--json",
  ];
  if (options.accountSlug) {
    createArgs.push("--account-slug", options.accountSlug);
  }

  const { stdout: createStdout } = await runJson("netlify", createArgs, {
    cwd: projectDir,
    env: netlifyEnv,
  });
  const site = JSON.parse(createStdout);
  console.log(`Site created: ${site.name} (${site.site_id})`);

  console.log(`Deploying "${options.dir}" to Netlify${options.prod ? " (production)" : " (draft)"}...`);
  const deployArgs = [
    "deploy",
    `--dir=${options.dir}`,
    "--site",
    site.site_id,
    "--json",
  ];
  if (options.prod) deployArgs.push("--prod");

  const { stdout: deployStdout } = await runJson("netlify", deployArgs, {
    cwd: projectDir,
    env: netlifyEnv,
  });
  const deploy = JSON.parse(deployStdout);

  console.log("\nDeploy complete!");
  console.log(`  Site admin: ${deploy.admin_url ?? site.admin_url}`);
  console.log(`  Live URL:   ${deploy.deploy_url ?? deploy.url ?? site.url}`);
}

main().catch((error) => {
  console.error("\nDeploy failed:", error.shortMessage ?? error.message);
  process.exit(1);
});
