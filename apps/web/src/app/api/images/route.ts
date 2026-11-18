import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
type HubRepo = { repo_name: string; short_description?: string; is_official?: boolean; pull_count?: number };
type HubTag = { name: string; last_updated?: string; images?: Array<{ architecture?: string; os?: string }> };

const featured = ["nginx", "caddy", "httpd", "node", "python", "alpine", "ubuntu", "redis", "postgres", "traefik"];

function normalizedName(repo: HubRepo) {
  return repo.is_official ? repo.repo_name : repo.repo_name;
}

async function newestTag(repository: string): Promise<HubTag | null> {
  const parts = repository.split("/");
  const namespace = parts.length > 1 ? parts[0] : "library";
  const name = parts.length > 1 ? parts.slice(1).join("/") : parts[0];
  try {
    const response = await fetch(
      `https://hub.docker.com/v2/namespaces/${encodeURIComponent(namespace)}/repositories/${encodeURIComponent(name)}/tags?page_size=20&ordering=last_updated`,
      { next: { revalidate: 300 }, headers: { accept: "application/json" } }
    );
    if (!response.ok) return null;
    const data = await response.json() as { results?: HubTag[] };
    const candidates = (data.results || []).filter(tag => tag.name && tag.images?.some(image => image.os === "linux"));
    candidates.sort((a, b) => Date.parse(b.last_updated || "") - Date.parse(a.last_updated || ""));
    return candidates[0] || data.results?.[0] || null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const query = (request.nextUrl.searchParams.get("q") || "").trim().slice(0, 80);
  const repositories: HubRepo[] = [];
  if (!query) {
    for (const repo_name of featured) repositories.push({ repo_name, is_official: true });
  } else {
    try {
      const response = await fetch(
        `https://hub.docker.com/v2/search/repositories/?query=${encodeURIComponent(query)}&page_size=12&ordering=-pull_count`,
        { next: { revalidate: 120 }, headers: { accept: "application/json" } }
      );
      if (!response.ok) return NextResponse.json({ error: "Docker Hub não respondeu à busca de imagens." }, { status: 502 });
      const data = await response.json() as { results?: HubRepo[] };
      repositories.push(...(data.results || []));
    } catch {
      return NextResponse.json({ error: "Não foi possível consultar o catálogo Docker Hub agora." }, { status: 502 });
    }
  }
  const unique = [...new Map(repositories.map(repo => [normalizedName(repo), repo])).values()].slice(0, 12);
  const images = await Promise.all(unique.map(async repo => {
    const name = repo.is_official ? `library/${repo.repo_name}` : repo.repo_name;
    const tag = await newestTag(name);
    const displayName = repo.is_official ? repo.repo_name : repo.repo_name;
    return {
      name: displayName,
      reference: tag?.name ? `${displayName}:${tag.name}` : `${displayName}:latest`,
      tag: tag?.name || "latest",
      updated_at: tag?.last_updated || null,
      description: repo.short_description || (repo.is_official ? "Imagem oficial do Docker Hub." : "Imagem publicada no Docker Hub."),
      pull_count: repo.pull_count || 0,
      source: "Docker Hub",
    };
  }));
  return NextResponse.json({ images });
}
