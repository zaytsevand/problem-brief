#!/usr/bin/env node
/**
 * Add, or remove, the brief sidebar: a Claude Code plugin that shows the open
 * questions of this session's briefs beside the conversation, lets you reply to
 * or rule on each one, and reminds the model to keep the brief up to date.
 *
 *   node install-sidebar.mjs                  load it in every session
 *   node install-sidebar.mjs --remove         stop loading it
 *   node install-sidebar.mjs --settings FILE  use another settings file
 *
 * Claude Code loads every folder named in CLAUDE_CODE_PLUGIN_DIRS, read from the
 * `env` block of ~/.claude/settings.json. This adds the plugin's folder there,
 * beside any folders already listed, and never adds it twice. The previous file
 * is kept beside it as settings.json.bak-problem-brief. A session already running
 * picks it up when it next starts.
 *
 * Zero dependencies. Node 18+.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const i = args.indexOf("--settings");
const settingsPath = i > -1 ? args[i + 1] : join(homedir(), ".claude", "settings.json");
const remove = args.includes("--remove");

const here = dirname(fileURLToPath(import.meta.url));
const plugin = resolve(here, "..", "plugin", "brief-sidebar");
const KEY = "CLAUDE_CODE_PLUGIN_DIRS";

if (!remove && !existsSync(join(plugin, ".claude-plugin", "plugin.json"))) {
  console.error(`The sidebar plugin is not at ${plugin}; install the skill with its plugin folder first.`);
  process.exit(1);
}

let settings = {};
if (existsSync(settingsPath)) {
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch (err) {
    console.error(`${settingsPath} is not valid JSON, so it was left alone.\n  ${err.message}`);
    process.exit(1);
  }
  copyFileSync(settingsPath, settingsPath + ".bak-problem-brief");
}

const env = settings.env ?? {};
/* Any earlier copy of this plugin is dropped, wherever it was installed from. */
const isOurs = (dir) => dir.replace(/[\\/]+$/, "").endsWith(join("plugin", "brief-sidebar"));
const dirs = String(env[KEY] ?? "").split(delimiter).filter((d) => d && !isOurs(d));
if (!remove) dirs.push(plugin);

if (dirs.length) env[KEY] = dirs.join(delimiter); else delete env[KEY];
if (Object.keys(env).length) settings.env = env; else delete settings.env;

mkdirSync(dirname(settingsPath), { recursive: true });
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
console.log(remove ? `removed the brief sidebar from ${KEY} in ${settingsPath}`
  : `added the brief sidebar (${plugin}) to ${KEY} in ${settingsPath}; it loads from the next session`);
