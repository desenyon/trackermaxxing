import { ghRepoCreate, isGhCliAuthenticated, isGhCliInstalled } from "@/lib/github/gh-cli";

export async function githubCreateRepo(name: string, options: { private?: boolean; description?: string; push?: boolean; source?: string }) {
  if (!isGhCliInstalled()) {
    throw new Error("The GitHub CLI (gh) is required for this command. Install it from https://cli.github.com, then run `gh auth login`.");
  }
  if (!isGhCliAuthenticated()) {
    throw new Error("gh is installed but not authenticated. Run `gh auth login` first.");
  }

  const args = [name, options.private ? "--private" : "--public"];
  if (options.description) args.push("--description", options.description);
  if (options.push) args.push("--source", options.source ?? ".", "--remote", "origin", "--push");

  if (!ghRepoCreate(args)) throw new Error("gh repo create failed - see output above.");
}
