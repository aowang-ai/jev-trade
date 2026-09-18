import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // The repo root also has a bun.lock; pin the workspace root to this app.
  turbopack: { root: path.resolve(__dirname) },
  // Agent rules live in the repo-root CLAUDE.md. Do not emit web/AGENTS.md.
  agentRules: false,
};

export default nextConfig;
